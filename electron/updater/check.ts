// AiCursor standalone project file.
import { app } from 'electron';
import { request } from 'node:https';
import { URL } from 'node:url';
import {
  compareVersions,
  platformKey,
  type UpdateManifest,
  type UpdatePlatformAsset,
} from './types';

const FEED_URL = 'https://aipointer.app/updates/latest.json';
const FEED_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

// Manifest fetch over plain Node https so the updater has zero non-built-in
// dependencies. Same reason as Skales: bundling electron-updater pulled in a
// chunky native chain and made notarization steps more brittle.
async function fetchManifest(url: string, hop = 0): Promise<UpdateManifest> {
  return new Promise<UpdateManifest>((resolve, reject) => {
    let target: URL;
    try {
      target = new URL(url);
    } catch (e) {
      reject(new Error(`Invalid feed URL: ${url}`));
      return;
    }
    if (target.protocol !== 'https:') {
      reject(new Error(`Feed must be https (got ${target.protocol})`));
      return;
    }
    const ua = `AICursor/${app.getVersion()} (${process.platform}-${process.arch})`;
    const req = request(
      target,
      {
        method: 'GET',
        headers: { 'User-Agent': ua, Accept: 'application/json' },
        timeout: FEED_TIMEOUT_MS,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if ([301, 302, 307, 308].includes(status) && res.headers.location) {
          res.resume();
          if (hop >= MAX_REDIRECTS) {
            reject(new Error('Too many redirects on update feed'));
            return;
          }
          fetchManifest(new URL(res.headers.location, target).href, hop + 1).then(
            resolve,
            reject,
          );
          return;
        }
        if (status !== 200) {
          res.resume();
          // 401 / 403 / 404 are silent: most likely the domain is not yet
          // hosting a manifest, or the user is offline behind a captive
          // portal. We do not want to bother the user about it.
          reject(new ManifestUnavailableError(status));
          return;
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body) as UpdateManifest;
            resolve(parsed);
          } catch (e) {
            reject(new Error('Update feed returned invalid JSON'));
          }
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('Update feed timeout'));
    });
    req.end();
  });
}

// Thrown for "no update info available" cases (offline, 404, etc.). The
// caller swallows this category silently because the user did not ask us to
// check; we volunteered.
export class ManifestUnavailableError extends Error {
  status: number;
  constructor(status: number) {
    super(`Update manifest unavailable (HTTP ${status})`);
    this.status = status;
  }
}

export type CheckResult =
  | { kind: 'up-to-date'; version: string }
  | { kind: 'available'; manifest: UpdateManifest; asset: UpdatePlatformAsset; current: string };

// Single-shot check. Returns either "up-to-date" or "available". Throws
// ManifestUnavailableError on silent failures and a plain Error on parse /
// schema problems.
export async function checkForUpdate(): Promise<CheckResult> {
  const manifest = await fetchManifest(FEED_URL);
  if (!manifest || typeof manifest.version !== 'string') {
    throw new Error('Malformed update manifest (missing version)');
  }
  const current = app.getVersion();
  if (compareVersions(manifest.version, current) <= 0) {
    return { kind: 'up-to-date', version: current };
  }
  const key = platformKey();
  if (!key) throw new Error(`Unsupported platform: ${process.platform}-${process.arch}`);
  const asset = manifest[key];
  if (!asset || typeof asset.url !== 'string' || typeof asset.sha512 !== 'string') {
    throw new Error(`No update asset for platform ${key}`);
  }
  if (!/^https:\/\//.test(asset.url)) {
    throw new Error(`Refusing to download non-https asset: ${asset.url}`);
  }
  if (!/^[0-9a-f]{128}$/i.test(asset.sha512)) {
    // The Skales-learned gotcha: a base64 sha512 is ~88 chars; hex is 128.
    // Reject anything that does not look like hex so we never download a
    // file we cannot verify.
    throw new Error('Manifest sha512 is not a 128-char hex string');
  }
  return { kind: 'available', manifest, asset, current };
}
