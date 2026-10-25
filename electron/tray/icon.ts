// AiCursor standalone project file.
import { app, nativeImage } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { NativeImage } from 'electron';

// Icons are STATIC ASSETS now, baked once during development via
// `scripts/bake-icons.cjs` and committed under assets/. The runtime no
// longer pulls in `sharp` / libvips — that native binding was the source
// of repeated Windows/Linux build failures (electron-builder couldn't
// always copy the per-platform libvips binary into the asar-unpacked
// node_modules slot, leading to "cannot find module sharp" crashes in
// distributed builds). Reading a pre-rendered PNG via Electron's built-in
// `nativeImage` has zero native-binding surface, so the same source tree
// produces clean DMGs, EXEs, and AppImages regardless of build host.
//
// Files this module expects in assets/:
//   - icon.png                          (1024x1024, app icon, About panel,
//                                        electron-builder dist source)
//   - tray-icon-Template.png            (22x22, monochrome — macOS template)
//   - tray-icon-Template@2x.png         (44x44 retina — same)

let cachedTrayImage: NativeImage | null = null;
let cachedAppIconPath: string | null = null;

// Try the standard candidate paths for an asset file. In dev (vite-plugin-
// electron) main runs out of dist-electron/, so assets/ is one level up.
// In a packaged build assets/ is alongside the app bundle root and
// app.getAppPath() points there. We probe both so the same code works in
// every mode.
function findAsset(name: string): string | null {
  const candidates = [
    join(app.getAppPath(), 'assets', name),
    join(__dirname, '..', 'assets', name),
    join(__dirname, '..', '..', 'assets', name),
    join(process.resourcesPath ?? '', 'assets', name),
  ];
  for (const c of candidates) {
    try {
      if (existsSync(c)) return c;
    } catch {
      /* permission denied, etc. */
    }
  }
  return null;
}

export async function getTrayIcon(): Promise<NativeImage> {
  if (cachedTrayImage) return cachedTrayImage;
  const path22 = findAsset('tray-icon-Template.png');
  const path44 = findAsset('tray-icon-Template@2x.png');
  if (!path22) {
    console.warn('[icon] tray-icon-Template.png missing in assets/');
    // Empty placeholder so Tray construction doesn't blow up; the tray will
    // render as a blank slot until the user reinstalls.
    cachedTrayImage = nativeImage.createEmpty();
    return cachedTrayImage;
  }
  const image = nativeImage.createFromPath(path22);
  if (path44) {
    try {
      const retina = nativeImage.createFromPath(path44);
      if (!retina.isEmpty()) {
        image.addRepresentation({
          scaleFactor: 2.0,
          width: 44,
          height: 44,
          buffer: retina.toPNG(),
        });
      }
    } catch (err) {
      console.warn('[icon] tray @2x add-rep failed:', err);
    }
  }
  // macOS template image flag — the OS draws it in the menubar tint and
  // auto-inverts in dark mode. No-op on Windows/Linux.
  image.setTemplateImage(true);
  cachedTrayImage = image;
  return image;
}

export async function getAppIconPath(): Promise<string> {
  if (cachedAppIconPath) return cachedAppIconPath;
  const found = findAsset('icon.png');
  if (!found) {
    console.warn('[icon] icon.png missing in assets/');
    return '';
  }
  cachedAppIconPath = found;
  return found;
}
