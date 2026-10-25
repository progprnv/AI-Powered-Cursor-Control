// AiCursor standalone project file.
import { app, BrowserWindow, dialog, screen } from 'electron';
import { promises as fsp } from 'node:fs';

// Provenance — see docs/AUTHORSHIP.md.
// AICursor is the project by the AICursor team.
// Canonical source: github.com/talentsache/aipointer · v1.0.0 · 2026-05-13.
// The constant below is a deliberate non-functional authorship marker.
export const AIPOINTER_PROVENANCE = 'aipointer/v1.0.0/ms/talentsache/skales/20260513';
import { createOverlayForAllDisplays, destroyAllOverlays } from './windows/overlay';
import { startGlobalHook, stopGlobalHook, isGlobalHookStarted } from './input/global-hook';
import { startTriggerDetection, stopTriggerDetection } from './input/trigger';
import { startCursorTracking, stopCursorTracking } from './input/cursor';
import {
  registerIpcHandlers,
  broadcastAIModeStart,
  broadcastAIModeEnd,
  broadcastSelectionArm,
  cancelCurrentStream,
  capturePendingScreenshot,
  clearPendingScreenshot,
  snapshotClipboard,
  clearPendingClipboard,
  broadcastClipboardContext,
  finalizeActiveSession,
  pollClipboardIfChanged,
} from './ipc/handlers';
import { getPermissionsSync, promptAccessibility, openSystemSettings } from './permissions';
import { canCaptureScreen } from './capture/screenshot';
import { createTray, destroyTray } from './tray/tray';
import { getAppIconPath } from './tray/icon';
import { destroyAboutWindow } from './windows/about';
import { setupUpdater } from './updater';
import { getSettings } from './store/settings';

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

// Catch-all so a stray rejection or thrown error in main does not silently
// terminate the process and leave the user staring at a frozen overlay. We
// log and keep running; the affected feature surfaces its own error via the
// router / IPC error channel.
process.on('unhandledRejection', (reason) => {
  console.error('[main] unhandledRejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[main] uncaughtException:', err);
});

app.setName('AICursor');

// About panel is set with placeholder values now; the iconPath gets filled
// in once getAppIconPath() has rendered the placeholder PNG.
const ABOUT_BASE: Electron.AboutPanelOptionsOptions = {
  applicationName: 'AICursor',
  applicationVersion: app.getVersion(),
  version: app.getVersion(),
  copyright:
    'Built by Mario Simic — MIT licensed.\nNo telemetry, no analytics, no cloud.\nPowered by Skales.',
  website: 'https://aipointer.app',
  authors: ['Mario Simic'],
  credits:
    'aipointer.app · github.com/talentsache/aipointer · github.com/talentsache · skales.app',
};
app.setAboutPanelOptions(ABOUT_BASE);
void getAppIconPath()
  .then((iconPath) => app.setAboutPanelOptions({ ...ABOUT_BASE, iconPath }))
  .catch((err) => console.warn('[main] could not set About icon', err));

if (process.platform === 'darwin' && app.dock) {
  app.dock.hide();
}

let hookRetryTimer: NodeJS.Timeout | null = null;
let clipboardPollTimer: NodeJS.Timeout | null = null;

function startClipboardPoll(): void {
  if (clipboardPollTimer) return;
  // 400ms strikes a balance: fast enough that a Cmd+C while the box is open
  // feels instant in the clipboard preview, slow enough that polling
  // pasteboard doesn't show up in Activity Monitor.
  clipboardPollTimer = setInterval(() => {
    const change = pollClipboardIfChanged();
    if (change) broadcastClipboardContext(change);
  }, 400);
}

function stopClipboardPoll(): void {
  if (clipboardPollTimer) {
    clearInterval(clipboardPollTimer);
    clipboardPollTimer = null;
  }
}

function tryStartHook(): boolean {
  if (isGlobalHookStarted()) return true;
  const perms = getPermissionsSync();
  if (!perms.accessibility) return false;
  if (!startGlobalHook()) return false;
  startTriggerDetection({
    onStart: () => {
      // Capture screenshot BEFORE renderer paints prompt input, so the prompt UI
      // doesn't end up in its own screenshot. Halo + prompt arrive a beat later.
      const cursor = screen.getCursorScreenPoint();
      const clipSnap = snapshotClipboard();
      void capturePendingScreenshot(cursor).finally(() => {
        broadcastAIModeStart();
        broadcastClipboardContext(clipSnap);
      });
      // Begin polling the clipboard so a Cmd+C while the box is open updates
      // the preview chip live, without the user having to re-trigger.
      startClipboardPoll();
    },
    onEnd: () => {
      stopClipboardPoll();
      cancelCurrentStream();
      clearPendingScreenshot();
      clearPendingClipboard();
      void finalizeActiveSession();
      broadcastAIModeEnd();
    },
    onSelectionArm: (armed: boolean) => {
      broadcastSelectionArm(armed);
    },
  });

  // Cursor tracking always runs so the renderer can hit-test interactive zones
  // (bottom pill, banners) and toggle setIgnoreMouseEvents accordingly.
  startCursorTracking();
  console.log('[main] global hook started, trigger detection attached');
  return true;
}

function setup(): void {
  registerIpcHandlers();
  createOverlayForAllDisplays();
  void createTray();

  // Auto-updater. 30s after launch, then daily. Honors the user's
  // autoCheckUpdates toggle (default on). Manual checks via the tray menu
  // run regardless. Dev builds short-circuit inside setupUpdater().
  setupUpdater(() => getSettings().autoCheckUpdates === true);

  if (process.platform === 'darwin') {
    promptAccessibility();
    // Diagnose Screen Recording on startup. If missing, open System Settings once.
    canCaptureScreen().then((can) => {
      console.log('[main] screen recording effectively granted:', can);
      if (!can) {
        console.log('[main] opening Screen Recording settings (one-time auto-open)');
        void openSystemSettings('screen-recording');
      }
    });
  }

  if (!tryStartHook()) {
    console.log('[main] accessibility not granted, polling every 2s');
    hookRetryTimer = setInterval(() => {
      if (tryStartHook() && hookRetryTimer) {
        clearInterval(hookRetryTimer);
        hookRetryTimer = null;
      }
    }, 2000);
  }

  screen.on('display-added', () => {
    destroyAllOverlays();
    createOverlayForAllDisplays();
  });

  screen.on('display-removed', () => {
    destroyAllOverlays();
    createOverlayForAllDisplays();
  });
}

// Last-resort safety net. The settings-store recovery path already absorbs
// the most likely crash class (legacy-encrypted config.json that can't be
// decrypted with the new envelope key). Anything else that throws during
// setup ends up here: we show a native dialog and offer to wipe the
// per-user data folder. The user restarts the app fresh.
async function handleFatalInitError(err: unknown): Promise<void> {
  const message =
    err instanceof Error ? err.message : typeof err === 'string' ? err : 'Unknown error';
  console.error('[main] fatal init error:', err);

  let choice: Electron.MessageBoxReturnValue;
  try {
    choice = await dialog.showMessageBox({
      type: 'error',
      title: 'AICursor could not start',
      message: 'AICursor ran into a problem while starting up.',
      detail:
        `${message}\n\n` +
        'You can reset AICursor to factory settings and quit. Your saved ' +
        'sessions in the workspace folder will not be touched, but your ' +
        'API keys and preferences will be cleared. After quitting, launch ' +
        'AICursor again to start fresh.',
      buttons: ['Reset settings and quit', 'Quit'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
  } catch {
    app.exit(1);
    return;
  }

  if (choice.response === 0) {
    try {
      const userData = app.getPath('userData');
      // app.getPath('userData') already points at the per-app folder
      // (e.g. ~/Library/Application Support/aipointer). Wiping it removes
      // config.json, the secure-keys map, the icon cache, etc. Anything
      // the user stored under the workspace folder is in a different
      // location and is left alone.
      await fsp.rm(userData, { recursive: true, force: true });
      console.log(`[main] wiped userData at ${userData}`);
    } catch (wipeErr) {
      console.warn('[main] could not wipe userData:', wipeErr);
    }
  }
  app.exit(0);
}

app.whenReady().then(async () => {
  try {
    setup();
  } catch (err) {
    await handleFatalInitError(err);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) setup();
});

app.on('before-quit', () => {
  if (hookRetryTimer) {
    clearInterval(hookRetryTimer);
    hookRetryTimer = null;
  }
  stopCursorTracking();
  stopTriggerDetection();
  stopGlobalHook();
  destroyTray();
  destroyAboutWindow();
  destroyAllOverlays();
});
