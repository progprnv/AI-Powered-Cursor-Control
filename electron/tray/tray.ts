// AiCursor standalone project file.
import { Menu, Tray, app, shell } from 'electron';
import { getTrayIcon } from './icon';
import { broadcastSettingsOpen, triggerAIModeFromMenu } from '../ipc/handlers';
import { showAboutWindow } from '../windows/about';
import { getUpdater } from '../updater';

let tray: Tray | null = null;

export async function createTray(): Promise<void> {
  if (tray) return;
  const icon = await getTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip('AICursor');
  rebuildMenu();
  // Rebuild the menu whenever the updater state changes so "Install update"
  // appears the moment a download completes and disappears after install.
  getUpdater().onChange(() => rebuildMenu());
}

export function rebuildMenu(): void {
  if (!tray) return;
  const updater = getUpdater();
  const state = updater.getState();

  const updateLabel = (() => {
    if (state.status === 'available') return `Install update (v${state.version})`;
    if (state.status === 'downloading') {
      const pct = Math.round((state as Extract<typeof state, { status: 'downloading' }>).percent);
      return `Downloading update… ${pct}%`;
    }
    if (state.status === 'downloaded')
      return `Restart to install v${(state as Extract<typeof state, { status: 'downloaded' }>).version}`;
    return null;
  })();

  const items: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'Trigger AICursor',
      accelerator: 'CmdOrCtrl+Shift+A',
      click: () => triggerAIModeFromMenu(),
    },
    {
      label: 'Settings…',
      click: () => broadcastSettingsOpen(),
    },
    {
      label: 'Privacy Policy',
      click: () => void shell.openExternal('https://aipointer.app/privacy'),
    },
    { type: 'separator' },
    {
      label: 'Check for updates',
      enabled: state.status !== 'checking' && state.status !== 'downloading',
      click: () => {
        void updater.runCheck(false);
      },
    },
  ];

  if (updateLabel) {
    items.push({
      label: updateLabel,
      enabled: state.status !== 'downloading',
      click: () => {
        if (state.status === 'downloaded') {
          updater.installDownloaded();
        } else {
          void updater.downloadPending().then((s) => {
            if (s.status === 'downloaded') updater.installDownloaded();
          });
        }
      },
    });
  }

  items.push(
    { type: 'separator' },
    {
      label: `About AICursor v${app.getVersion()}`,
      click: () => void showAboutWindow(),
    },
    {
      label: 'Open aipointer.app',
      click: () => void shell.openExternal('https://aipointer.app'),
    },
    {
      label: 'Open GitHub repo',
      click: () => void shell.openExternal('https://github.com/talentsache/aipointer'),
    },
    {
      label: 'Built by Mario Simic',
      click: () => void shell.openExternal('https://github.com/talentsache'),
    },
    {
      label: 'Powered by Skales',
      click: () => void shell.openExternal('https://skales.app'),
    },
    { type: 'separator' },
    {
      label: 'Quit AICursor',
      accelerator: 'CmdOrCtrl+Q',
      click: () => app.quit(),
    },
  );

  const menu = Menu.buildFromTemplate(items);
  tray.setContextMenu(menu);
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}
