// AiCursor standalone project file.
import { BrowserWindow, shell, app } from 'electron';
import { promises as fsp } from 'node:fs';
import { getAppIconPath } from '../tray/icon';

let aboutWindow: BrowserWindow | null = null;

// Branded About window. We can't rely on `app.showAboutPanel()` because the
// dock is hidden (LSUIElement-style) and the system panel won't render for
// accessory apps. A small custom BrowserWindow with our own HTML always
// works and is on-brand. Light/dark adaptive via prefers-color-scheme.

export async function showAboutWindow(): Promise<void> {
  if (aboutWindow && !aboutWindow.isDestroyed()) {
    aboutWindow.show();
    aboutWindow.focus();
    return;
  }

  // We embed the icon as a base64 data-URL rather than referencing it via
  // `file://`. The About page itself is loaded from a `data:text/html` URL,
  // which has an opaque origin — Chromium refuses to load `file://`
  // resources from there. Reading the PNG bytes here and inlining them as
  // `data:image/png;base64,...` keeps everything same-origin and works.
  let iconDataUrl = '';
  try {
    const iconPath = await getAppIconPath();
    if (iconPath) {
      const bytes = await fsp.readFile(iconPath);
      iconDataUrl = 'data:image/png;base64,' + bytes.toString('base64');
    }
  } catch {
    /* fall through — About still renders, just without the icon glyph */
  }

  aboutWindow = new BrowserWindow({
    width: 460,
    height: 540,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'About AICursor',
    backgroundColor: '#0c0c0d',
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  aboutWindow.setMenuBarVisibility(false);

  aboutWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  aboutWindow.webContents.on('will-navigate', (event, url) => {
    event.preventDefault();
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void shell.openExternal(url);
    }
  });

  const html = renderAboutHtml(iconDataUrl, app.getVersion());
  void aboutWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));

  aboutWindow.once('ready-to-show', () => {
    aboutWindow?.show();
    aboutWindow?.focus();
  });

  aboutWindow.on('closed', () => {
    aboutWindow = null;
  });
}

export function destroyAboutWindow(): void {
  if (aboutWindow && !aboutWindow.isDestroyed()) {
    aboutWindow.destroy();
  }
  aboutWindow = null;
}

function renderAboutHtml(iconUrl: string, version: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>About AICursor</title>
<style>
  :root {
    --bg: #0c0c0d;
    --panel: #16161a;
    --ink: #f5f5f4;
    --ink-soft: rgba(245, 245, 244, 0.72);
    --ink-faint: rgba(245, 245, 244, 0.42);
    --accent: #a7f56b;
    --accent-soft: rgba(167, 245, 107, 0.12);
    --border: rgba(245, 245, 244, 0.08);
  }
  @media (prefers-color-scheme: light) {
    :root {
      --bg: #fafaf9;
      --panel: #ffffff;
      --ink: #18181b;
      --ink-soft: rgba(24, 24, 27, 0.7);
      --ink-faint: rgba(24, 24, 27, 0.45);
      --accent: #6aaf3a;
      --accent-soft: rgba(106, 175, 58, 0.14);
      --border: rgba(24, 24, 27, 0.08);
    }
  }
  * { box-sizing: border-box; -webkit-font-smoothing: antialiased; }
  html, body { margin: 0; padding: 0; height: 100vh; }
  body {
    font-family: -apple-system, system-ui, 'Segoe UI', Inter, sans-serif;
    background: radial-gradient(ellipse at top, var(--panel), var(--bg));
    color: var(--ink);
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: 40px 36px 28px;
    overflow: hidden;
    user-select: none;
    -webkit-user-select: none;
    -webkit-app-region: drag;
  }
  .icon-wrap {
    position: relative;
    width: 112px;
    height: 112px;
    margin-bottom: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .icon-wrap::before {
    content: "";
    position: absolute;
    inset: -16px;
    border-radius: 50%;
    background: radial-gradient(circle, var(--accent-soft), transparent 70%);
    pointer-events: none;
  }
  .icon {
    width: 96px;
    height: 96px;
    object-fit: contain;
    position: relative;
    z-index: 1;
    filter: drop-shadow(0 8px 24px rgba(0,0,0,0.35));
  }
  h1 {
    font-size: 26px;
    font-weight: 600;
    margin: 0 0 6px;
    letter-spacing: -0.015em;
    line-height: 1;
  }
  h1 .ai { color: var(--accent); }
  .ver {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: var(--ink-faint);
    margin-bottom: 22px;
    font-weight: 500;
  }
  .desc {
    font-size: 12.5px;
    line-height: 1.6;
    color: var(--ink-soft);
    max-width: 340px;
    margin: 0 auto 24px;
  }
  .links {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 24px;
    -webkit-app-region: no-drag;
  }
  .links a {
    color: var(--accent);
    text-decoration: none;
    font-size: 12.5px;
    padding: 6px 14px;
    border-radius: 999px;
    transition: background 0.15s ease;
    border: 1px solid transparent;
  }
  .links a:hover {
    background: var(--accent-soft);
    border-color: var(--accent);
  }
  .footer {
    margin-top: auto;
    font-size: 10px;
    color: var(--ink-faint);
    letter-spacing: 0.04em;
    -webkit-app-region: no-drag;
  }
  .footer a {
    color: var(--ink-soft);
    text-decoration: none;
    border-bottom: 1px dotted var(--border);
  }
  .footer a:hover {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }
  .copyright {
    margin-top: 8px;
    font-size: 10px;
    color: var(--ink-faint);
  }
</style>
</head>
<body>
  <div class="icon-wrap">
    ${iconUrl ? `<img class="icon" src="${iconUrl}" alt="AICursor">` : ''}
  </div>
  <h1><span class="ai">AI</span>Cursor</h1>
  <div class="ver">Version ${version} · MIT licensed</div>
  <div class="desc">
    AI-aware cursor companion for macOS, Windows, Linux. Hold a key, ask a question, get an answer about whatever your cursor is pointing at.
  </div>
  <div class="links">
    <a href="https://aipointer.app" target="_blank" rel="noreferrer">aipointer.app</a>
    <a href="https://github.com/talentsache/aipointer" target="_blank" rel="noreferrer">github.com/talentsache/aipointer</a>
    <span>Project team: Omar Abdullah K A · Pranav Jayan · Varunsankar J · Zeba Saithalavi</span>
  </div>
  <div class="footer">
    No telemetry · No analytics · No cloud · <a href="https://skales.app" target="_blank" rel="noreferrer">Powered by Skales</a>
  </div>
  <div class="copyright">© 2026 AICursor project team</div>
  <!-- Hidden authorship marker (paired with the .ms-aipointer-authentic Tailwind utility). -->
  <span class="ms-aipointer-authentic" aria-hidden="true" style="position:absolute;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;">aipointer/v1.0.0/ms/talentsache/skales/20260513</span>
</body>
</html>`;
}
