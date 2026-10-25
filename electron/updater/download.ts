// AiCursor standalone project file.
import { app } from 'electron';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import { request } from 'node:https';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { URL } from 'node:url';
import type { UpdatePlatformAsset } from './types';

const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_REDIRECTS = 5;

export type DownloadProgress = {
  percent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
};

// Streams the binary into a temp file under <tmpdir>/aipointer-updates/. The
// caller verifies the sha512 hex after the stream ends and discards the file
// on mismatch.
async function streamToFile(
  url: string,
  destPath: string,
  onProgress: (p: DownloadProgress) => void,
  hop = 0,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      reject(new Error(`Invalid asset URL: ${url}`));
      return;
    }
    if (target.protocol !== 'https:') {
      reject(new Error(`Refusing non-https asset: ${target.protocol}`));
      return;
    }
    const ua = `AICursor/${app.getVersion()} (${process.platform}-${process.arch})`;
    const startedAt = Date.now();
    let transferred = 0;
    const file = createWriteStream(destPath);
    const req = request(
      target,
      {
        method: 'GET',
        headers: { 'User-Agent': ua },
        timeout: DOWNLOAD_TIMEOUT_MS,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if ([301, 302, 307, 308].includes(status) && res.headers.location) {
          res.resume();
          file.close(() => {
            fs.unlink(destPath).catch(() => undefined);
            if (hop >= MAX_REDIRECTS) {
              reject(new Error('Too many redirects on update asset'));
              return;
            }
            const next = new URL(res.headers.location as string, target).href;
            streamToFile(next, destPath, onProgress, hop + 1).then(resolve, reject);
          });
          return;
        }
        if (status !== 200) {
          res.resume();
          file.close(() => {
            fs.unlink(destPath).catch(() => undefined);
            reject(new Error(`Download HTTP ${status}`));
          });
          return;
        }
        const total = parseInt(res.headers['content-length'] ?? '0', 10) || 0;
        res.on('data', (chunk) => {
          transferred += chunk.length;
          const elapsedSec = Math.max(0.1, (Date.now() - startedAt) / 1000);
          try {
            onProgress({
              percent: total > 0 ? (transferred / total) * 100 : 0,
              bytesPerSecond: transferred / elapsedSec,
              transferred,
              total,
            });
          } catch {
            /* never let a progress callback derail the stream */
          }
        });
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve()));
        file.on('error', (err) => {
          file.close(() => {
            fs.unlink(destPath).catch(() => undefined);
            reject(err);
          });
        });
      },
    );
    req.on('error', (err) => {
      file.close(() => {
        fs.unlink(destPath).catch(() => undefined);
        reject(err);
      });
    });
    req.on('timeout', () => {
      req.destroy(new Error('Download timeout'));
    });
    req.end();
  });
}

async function sha512Hex(filePath: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const hash = createHash('sha512');
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

export type DownloadResult = { path: string };

export async function downloadAsset(
  asset: UpdatePlatformAsset,
  version: string,
  onProgress: (p: DownloadProgress) => void,
): Promise<DownloadResult> {
  const dir = join(tmpdir(), 'aipointer-updates');
  await fs.mkdir(dir, { recursive: true });

  const safeName =
    basename(new URL(asset.url).pathname).replace(/[^A-Za-z0-9._-]/g, '_') ||
    `aipointer-${version}.bin`;
  const destPath = join(dir, safeName);

  // If a previous attempt left a verified file, skip the re-download. The
  // hash check is cheap compared to a multi-tens-of-megabyte transfer.
  try {
    const stat = await fs.stat(destPath);
    if (stat.size === asset.size) {
      const existing = await sha512Hex(destPath);
      if (existing.toLowerCase() === asset.sha512.toLowerCase()) {
        return { path: destPath };
      }
    }
    await fs.unlink(destPath).catch(() => undefined);
  } catch {
    /* not present */
  }

  await streamToFile(asset.url, destPath, onProgress);

  // SHA-512 hex verification. The release-build.sh script emits hex; the
  // manifest stores hex; this comparison is case-insensitive on the hex
  // alphabet so a slight casing drift between hosting tools and our hash
  // does not cause a false negative.
  const actual = await sha512Hex(destPath);
  if (actual.toLowerCase() !== asset.sha512.toLowerCase()) {
    await fs.unlink(destPath).catch(() => undefined);
    throw new Error(
      'Downloaded update failed SHA-512 verification. File discarded for safety.',
    );
  }
  return { path: destPath };
}
