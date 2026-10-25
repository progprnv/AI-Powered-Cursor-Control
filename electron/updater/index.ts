// AiCursor standalone project file.
import { app, BrowserWindow } from 'electron';
import { checkForUpdate, ManifestUnavailableError } from './check';
import { downloadAsset } from './download';
import { installAndRelaunch } from './install';
import type { UpdateManifest, UpdatePlatformAsset, UpdateState } from './types';

// Auto-updater orchestration. Holds a small in-memory state machine and is
// the only module the rest of the app talks to. The renderer never sees the
// manifest directly; it only sees a UpdateState snapshot via IPC.
//
// Behaviour, as specified for v1.0.0:
//  - Wait 30 seconds after app start before the first check (do not slow
//    startup).
//  - When `autoCheckUpdates` is on (default true), schedule another check
//    every 24 hours while the app runs.
//  - Connection failures (offline, 401/403/404, parse error) are silent in
//    the auto path. Manual checks via the tray still surface a brief error
//    so the user knows what happened.

const FIRST_CHECK_DELAY_MS = 30_000;
const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000;

type Listener = (state: UpdateState) => void;

class Updater {
  private state: UpdateState = { status: 'idle' };
  private pending: { manifest: UpdateManifest; asset: UpdatePlatformAsset } | null = null;
  private downloaded: { path: string; version: string } | null = null;
  private listeners = new Set<Listener>();
  private firstCheckTimer: NodeJS.Timeout | null = null;
  private dailyTimer: NodeJS.Timeout | null = null;
  private getAutoEnabled: () => boolean = () => true;
  private checking = false;

  configure(getAutoEnabled: () => boolean): void {
    this.getAutoEnabled = getAutoEnabled;
  }

  getState(): UpdateState {
    return this.state;
  }

  hasPendingInstall(): boolean {
    return this.downloaded !== null;
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setState(next: UpdateState): void {
    this.state = next;
    for (const cb of this.listeners) {
      try {
        cb(next);
      } catch (err) {
        console.warn('[updater] listener threw:', err);
      }
    }
    // Renderer mirror: broadcast on a fixed channel so the small "Update
    // ready" banner can light up without polling.
    const wins = BrowserWindow.getAllWindows();
    for (const w of wins) {
      if (!w.isDestroyed()) {
        try {
          w.webContents.send('updates:state', next);
        } catch {
          /* renderer may not be ready yet */
        }
      }
    }
  }

  // Single check pass. `silent` swallows ManifestUnavailableError-class
  // failures so the user is never bothered by auto-checks they did not
  // request.
  async runCheck(silent: boolean): Promise<UpdateState> {
    if (this.checking) return this.state;
    this.checking = true;
    this.setState({ status: 'checking' });
    try {
      const result = await checkForUpdate();
      if (result.kind === 'up-to-date') {
        this.pending = null;
        this.setState({ status: 'up-to-date', version: result.version });
        return this.state;
      }
      this.pending = { manifest: result.manifest, asset: result.asset };
      this.setState({
        status: 'available',
        version: result.manifest.version,
        changelog: result.manifest.changelog,
        size: result.asset.size,
      });
      return this.state;
    } catch (err) {
      if (silent && err instanceof ManifestUnavailableError) {
        // 401 / 403 / 404 / offline. Log and reset to idle.
        console.log(`[updater] silent skip: ${err.message}`);
        this.setState({ status: 'idle' });
        return this.state;
      }
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[updater] check failed:', message);
      this.setState({ status: 'error', message });
      return this.state;
    } finally {
      this.checking = false;
    }
  }

  async downloadPending(): Promise<UpdateState> {
    if (!this.pending) {
      this.setState({ status: 'error', message: 'No update available to download.' });
      return this.state;
    }
    const { asset, manifest } = this.pending;
    try {
      this.setState({
        status: 'downloading',
        version: manifest.version,
        percent: 0,
        bytesPerSecond: 0,
      });
      const result = await downloadAsset(asset, manifest.version, (p) => {
        this.setState({
          status: 'downloading',
          version: manifest.version,
          percent: p.percent,
          bytesPerSecond: p.bytesPerSecond,
        });
      });
      this.downloaded = { path: result.path, version: manifest.version };
      this.setState({ status: 'downloaded', version: manifest.version, path: result.path });
      return this.state;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[updater] download failed:', message);
      this.setState({ status: 'error', message });
      return this.state;
    }
  }

  installDownloaded(): void {
    if (!this.downloaded) {
      this.setState({ status: 'error', message: 'No downloaded installer to launch.' });
      return;
    }
    try {
      installAndRelaunch(this.downloaded.path);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[updater] install failed:', message);
      this.setState({ status: 'error', message });
    }
  }

  startScheduler(): void {
    if (this.firstCheckTimer || this.dailyTimer) return;
    this.firstCheckTimer = setTimeout(() => {
      this.firstCheckTimer = null;
      if (!this.getAutoEnabled()) return;
      void this.runCheck(true);
      this.dailyTimer = setInterval(() => {
        if (!this.getAutoEnabled()) return;
        void this.runCheck(true);
      }, DAILY_INTERVAL_MS);
    }, FIRST_CHECK_DELAY_MS);
  }

  stopScheduler(): void {
    if (this.firstCheckTimer) {
      clearTimeout(this.firstCheckTimer);
      this.firstCheckTimer = null;
    }
    if (this.dailyTimer) {
      clearInterval(this.dailyTimer);
      this.dailyTimer = null;
    }
  }
}

const updater = new Updater();

// Entry point called from main. Does nothing in unpackaged dev builds: an
// in-place asar swap on a source tree would be destructive, and the version
// in package.json is the dev version which would always look "older" than
// the hosted one.
export function setupUpdater(getAutoEnabled: () => boolean): Updater {
  if (!app.isPackaged) {
    console.log('[updater] dev build: auto-update disabled.');
  } else {
    updater.configure(getAutoEnabled);
    updater.startScheduler();
  }
  return updater;
}

export function getUpdater(): Updater {
  return updater;
}

export type { Updater };
