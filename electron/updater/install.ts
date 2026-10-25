// AiCursor standalone project file.
import { app } from 'electron';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

// Platform-specific install launcher. We do not auto-replace the running
// binary ourselves; we hand off to the installer (Windows) or to the OS
// (macOS: open the DMG so the user drags into Applications; Linux: open the
// folder so the user can swap the AppImage). Then we quit so the installer
// can replace the running binary on Windows.
//
// Auto-replacing a running .app on macOS without Sparkle is a rabbit hole.
// The drag-to-Applications flow is what the user already expects from a DMG
// install and is the same pattern Skales ships.
export function installAndRelaunch(installerPath: string): void {
  if (!installerPath || !existsSync(installerPath)) {
    throw new Error('Installer path missing or no longer exists');
  }
  if (process.platform === 'win32') {
    // NSIS one-click installer. /S = silent. --force-run reopens AICursor
    // after the install finishes. detached so the child outlives us.
    const child = spawn(installerPath, ['/S', '--force-run'], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  } else if (process.platform === 'darwin') {
    const child = spawn('open', [installerPath], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  } else {
    // Linux: AppImage is the supported target. We surface the file to the
    // user via the file manager rather than try to overwrite in place; the
    // user controls where the AppImage lives.
    const child = spawn('xdg-open', [dirname(installerPath)], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  }
  // Quit shortly after so the installer can replace the running binary on
  // Windows. macOS and Linux do not need the quit (the DMG opens in Finder,
  // the AppImage swap is manual), but quitting is fine: the user is
  // installing a new version anyway.
  setTimeout(() => {
    try {
      app.quit();
    } catch {
      /* ignore */
    }
  }, 800);
}
