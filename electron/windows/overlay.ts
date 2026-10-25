// AiCursor standalone project file.
import { BrowserWindow, app, screen, shell, type Display } from 'electron';
import { join } from 'node:path';

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

// Sandbox the renderer in packaged builds. Dev keeps sandbox:false because
// Vite's HMR client needs Node module access in the renderer process. In
// production the renderer only loads bundled JS through preload, so the
// sandbox restricts attack surface without breaking functionality. The
// preload itself uses only contextBridge/ipcRenderer which work in sandboxed
// renderers (no node:fs or similar imports).
const ENABLE_SANDBOX = app.isPackaged;

const overlayWindows = new Map<number, BrowserWindow>();

export function createOverlayForDisplay(display: Display): BrowserWindow {
  const win = new BrowserWindow({
    x: display.workArea.x,
    y: display.workArea.y,
    width: display.workArea.width,
    height: display.workArea.height,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    fullscreenable: false,
    skipTaskbar: true,
    // Always focusable so the DOM input inside the box can receive keyboard
    // focus. We used to flip this on/off per hover via setFocusable() — that
    // call repaints the macOS window frame and was a major contributor to
    // the flicker the user was seeing. The `panel` type already keeps this
    // window from stealing focus from the underlying app, so leaving focusable
    // permanently on is safe.
    focusable: true,
    show: false,
    type: process.platform === 'darwin' ? 'panel' : undefined,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: ENABLE_SANDBOX,
      backgroundThrottling: false,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });

  // Belt-and-braces: hide the macOS traffic-light buttons (red/yellow/green
  // close/minimise/maximise). With frame:false they should already be gone,
  // but some macOS versions leak them through for transparent panel windows.
  if (process.platform === 'darwin') {
    try {
      win.setWindowButtonVisibility(false);
    } catch {
      /* not available on all builds */
    }
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Defense in depth: prevent any in-frame navigation. The renderer is
  // expected to live entirely on the bundled index.html (file://) in prod or
  // on the local Vite dev server in dev. Any other URL navigation attempt is
  // either a bug or a successful injection; either way we refuse and route
  // through openExternal for http(s) destinations.
  win.webContents.on('will-navigate', (event, url) => {
    const allowed =
      (VITE_DEV_SERVER_URL && url.startsWith(VITE_DEV_SERVER_URL)) ||
      url.startsWith('file://');
    if (allowed) return;
    event.preventDefault();
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url);
    }
  });

  // Likewise block redirects within the same webContents that try to leave
  // the bundled app surface.
  win.webContents.on('will-redirect', (event, url) => {
    const allowed =
      (VITE_DEV_SERVER_URL && url.startsWith(VITE_DEV_SERVER_URL)) ||
      url.startsWith('file://');
    if (allowed) return;
    event.preventDefault();
  });

  win.once('ready-to-show', () => {
    win.showInactive();
  });

  // While DevTools is open we drop alwaysOnTop on every overlay, otherwise
  // the screen-saver-level overlay covers the DevTools window and clicks
  // there land on the (mostly transparent) overlay instead of the DevTools
  // UI. That made DevTools effectively unusable. Listening per webContents
  // is fine because both overlay-attached and detached DevTools fire these
  // events.
  win.webContents.on('devtools-opened', () => {
    setAllOverlaysAlwaysOnTop(false);
  });
  win.webContents.on('devtools-closed', () => {
    setAllOverlaysAlwaysOnTop(true);
  });

  const isPrimary = display.id === screen.getPrimaryDisplay().id ? '1' : '0';
  const query = `?displayId=${display.id}&primary=${isPrimary}`;
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(`${VITE_DEV_SERVER_URL}${query}`);
  } else {
    win.loadFile(join(__dirname, '../dist/index.html'), {
      query: { displayId: String(display.id), primary: isPrimary },
    });
  }

  overlayWindows.set(display.id, win);

  win.on('closed', () => {
    overlayWindows.delete(display.id);
    interactiveState.delete(display.id);
  });

  return win;
}

export function createOverlayForAllDisplays(): BrowserWindow[] {
  return screen.getAllDisplays().map(createOverlayForDisplay);
}

export function getOverlayForDisplay(displayId: number): BrowserWindow | undefined {
  return overlayWindows.get(displayId);
}

export function getAllOverlays(): BrowserWindow[] {
  return Array.from(overlayWindows.values());
}

export function getOverlayEntries(): Array<[number, BrowserWindow]> {
  return Array.from(overlayWindows.entries());
}

// Per-window cache of the most recently applied interactive state. Without
// this we'd call setIgnoreMouseEvents/setFocusable/focus/blur on every
// renderer tick — and on macOS each of those triggers a window-frame repaint.
// The user saw that as the box "flickering" on hover and drag. We now no-op
// when the state hasn't actually changed.
const interactiveState = new Map<number, boolean>();
const lastInteractiveChangeAt = new Map<number, number>();

export function setOverlayInteractive(displayId: number, interactive: boolean): void {
  const win = overlayWindows.get(displayId);
  if (!win) return;
  if (interactiveState.get(displayId) === interactive) return;
  interactiveState.set(displayId, interactive);
  const now = Date.now();
  const prev = lastInteractiveChangeAt.get(displayId) ?? 0;
  const dtMs = prev > 0 ? now - prev : -1;
  lastInteractiveChangeAt.set(displayId, now);
  console.log(`[overlay] display=${displayId} interactive=${interactive} dt=${dtMs}ms`);
  // ONLY toggle setIgnoreMouseEvents. Earlier versions also called
  // setFocusable() and focus()/blur() on every transition — on macOS each
  // of those forces a full window-frame repaint, which the user saw as
  // the box "flickering" every time the cursor crossed the hover halo.
  // setFocusable(true) is now set once at construction (see below) and left
  // alone; DOM focus inside the box is handled by the input element itself.
  if (interactive) {
    win.setIgnoreMouseEvents(false);
  } else {
    win.setIgnoreMouseEvents(true, { forward: true });
  }
}

// Lower or raise every overlay's alwaysOnTop level. Used to let the user
// Cmd+Tab to another app (e.g. Chrome to copy their API key) while the
// Settings panel is open — otherwise our screen-saver-level overlay sits
// in front of every other window and blocks the world.
export function setAllOverlaysAlwaysOnTop(on: boolean): void {
  for (const win of overlayWindows.values()) {
    if (win.isDestroyed()) continue;
    if (on) {
      win.setAlwaysOnTop(true, 'screen-saver');
      try { win.moveTop(); } catch { /* ignore */ }
    } else {
      win.setAlwaysOnTop(false);
    }
  }
}

export function destroyAllOverlays(): void {
  for (const win of overlayWindows.values()) {
    if (!win.isDestroyed()) win.destroy();
  }
  overlayWindows.clear();
}
