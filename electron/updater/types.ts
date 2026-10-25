// AiCursor standalone project file.
// Auto-updater types.
//
// The manifest at https://aipointer.app/updates/latest.json uses flat platform
// keys (windows / mac_arm64 / mac_intel / linux) instead of a nested platforms
// map. This is the proven Skales pattern that survived multiple iterations
// and is friendlier to manual editing on shared hosting.
//
// CRITICAL: the sha512 field is a 128-character HEX string. Not Base64. The
// downloader hashes the file with crypto.createHash('sha512').digest('hex')
// and compares case-insensitively. Mismatched encodings cost real time to
// debug; the release-build.sh script emits hex via `shasum -a 512` so the
// hosted manifest and the local verifier agree by construction.

export type UpdatePlatformAsset = {
  url: string;
  sha512: string; // 128-char hex
  size: number;
};

export type UpdateManifest = {
  version: string;
  // ISO date string, e.g. "2026-05-13T18:00:00Z". The shorter `date` field
  // is also tolerated for human-edited manifests.
  releaseDate?: string;
  date?: string;
  changelog?: string;
  windows?: UpdatePlatformAsset;
  mac_arm64?: UpdatePlatformAsset;
  mac_intel?: UpdatePlatformAsset;
  linux?: UpdatePlatformAsset;
};

export type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'available'; version: string; changelog?: string; size: number }
  | { status: 'downloading'; version: string; percent: number; bytesPerSecond: number }
  | { status: 'downloaded'; version: string; path: string }
  | { status: 'up-to-date'; version: string }
  | { status: 'error'; message: string };

export type PlatformKey = 'windows' | 'mac_arm64' | 'mac_intel' | 'linux';

export function platformKey(): PlatformKey | null {
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') {
    return process.arch === 'arm64' ? 'mac_arm64' : 'mac_intel';
  }
  if (process.platform === 'linux') return 'linux';
  return null;
}

// Dependency-free semver compare. Returns >0 if a > b, <0 if a < b, 0 equal.
// Handles "1.0.0", "1.0.0-beta.2", "1.0.0+build". Pre-release suffixes count
// as lower than the same version without one. Good enough for the AICursor
// release cadence; full RFC compliance not needed.
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [main, pre] = String(v || '0').split('-');
    const [coreNoBuild] = main.split('+');
    const parts = coreNoBuild.split('.').map((n) => parseInt(n, 10) || 0);
    return { parts, pre: pre ?? '' };
  };
  const pa = parse(a);
  const pb = parse(b);
  const len = Math.max(pa.parts.length, pb.parts.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa.parts[i] ?? 0) - (pb.parts[i] ?? 0);
    if (diff !== 0) return diff;
  }
  // Same core. No pre-release > with pre-release.
  if (pa.pre === '' && pb.pre !== '') return 1;
  if (pa.pre !== '' && pb.pre === '') return -1;
  if (pa.pre === pb.pre) return 0;
  return pa.pre < pb.pre ? -1 : 1;
}
