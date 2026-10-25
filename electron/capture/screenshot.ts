// AiCursor standalone project file.
import { desktopCapturer, screen } from 'electron';

const CROP_W = 1024;
const CROP_H = 768;
const JPEG_QUALITY = 80;

// All cropping + JPEG encoding goes through Electron's built-in `nativeImage`
// (Skia under the hood). Earlier versions used `sharp` for this, which pulled
// in libvips as a native binding — fine on macOS where we built locally, but
// a permanent thorn for cross-platform CI: the Windows/Linux artefacts of
// `sharp` weren't always copied into the asar-unpacked node_modules, and
// distributed builds would crash with "Cannot find module sharp" or a libvips
// load error. `nativeImage` is part of Electron itself, so it ships with the
// runtime by definition. No native modules to rebuild, no platform-specific
// binaries to package, no asarUnpack entries.

export async function captureAroundCursor(cursor: { x: number; y: number }): Promise<string> {
  const display = screen.getDisplayNearestPoint(cursor);
  console.log('[screenshot] cursor', cursor, 'display', display.id, 'size', display.size);

  let sources;
  try {
    sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: display.size.width,
        height: display.size.height,
      },
    });
  } catch (e) {
    console.error('[screenshot] getSources threw', e);
    throw new Error(`getSources failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  console.log(
    '[screenshot] got',
    sources.length,
    'sources:',
    sources.map((s) => ({ id: s.id, display_id: s.display_id, empty: s.thumbnail.isEmpty() })),
  );

  if (sources.length === 0) {
    throw new Error(
      'No screen sources returned. Screen Recording permission missing. Quit AICursor, grant the permission in System Settings, then relaunch.',
    );
  }

  const source =
    sources.find((s) => s.display_id === String(display.id)) ?? sources[0];

  const thumb = source.thumbnail;
  if (thumb.isEmpty()) {
    throw new Error(
      'Screen capture returned empty. Screen Recording permission missing or not yet inherited. Quit AICursor and relaunch after granting.',
    );
  }

  const size = thumb.getSize();
  console.log('[screenshot] thumb size', size);

  const localX = cursor.x - display.bounds.x;
  const localY = cursor.y - display.bounds.y;

  const cropW = Math.min(CROP_W, size.width);
  const cropH = Math.min(CROP_H, size.height);
  const left = Math.max(0, Math.min(size.width - cropW, Math.round(localX - cropW / 2)));
  const top = Math.max(0, Math.min(size.height - cropH, Math.round(localY - cropH / 2)));
  console.log('[screenshot] crop', { left, top, cropW, cropH });

  try {
    const cropped = thumb.crop({ x: left, y: top, width: cropW, height: cropH });
    const jpegBuf = cropped.toJPEG(JPEG_QUALITY);
    console.log('[screenshot] cropped jpeg bytes', jpegBuf.length);
    return jpegBuf.toString('base64');
  } catch (e) {
    console.error('[screenshot] crop failed', e);
    throw new Error(`Crop failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// User-defined selection rectangle (display-local coordinates, work-area
// frame, matching what the renderer's getBoundingClientRect returns). Lets
// the user drag a tight crop of exactly what they're asking about instead
// of relying on the 1024x768 cursor-centered default.
export async function captureRectFromDisplay(
  rect: { x: number; y: number; width: number; height: number },
  displayId: number,
): Promise<string> {
  const allDisplays = screen.getAllDisplays();
  const display = allDisplays.find((d) => d.id === displayId) ?? screen.getPrimaryDisplay();
  console.log('[screenshot] rect-capture', rect, 'display', display.id, 'size', display.size);

  let sources;
  try {
    sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: display.size.width,
        height: display.size.height,
      },
    });
  } catch (e) {
    console.error('[screenshot] getSources threw', e);
    throw new Error(`getSources failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (sources.length === 0) {
    throw new Error(
      'No screen sources returned. Screen Recording permission missing.',
    );
  }
  const source =
    sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
  const thumb = source.thumbnail;
  if (thumb.isEmpty()) {
    throw new Error('Screen capture returned empty.');
  }

  const size = thumb.getSize();

  // The renderer reports rect in work-area coords (the overlay window covers
  // workArea, not full display bounds). Convert to full-display coords for
  // the crop by adding back the work-area offset relative to bounds.
  const workOffsetX = display.workArea.x - display.bounds.x;
  const workOffsetY = display.workArea.y - display.bounds.y;
  const left = Math.max(0, Math.min(size.width - 1, Math.round(rect.x + workOffsetX)));
  const top = Math.max(0, Math.min(size.height - 1, Math.round(rect.y + workOffsetY)));
  const width = Math.max(1, Math.min(size.width - left, Math.round(rect.width)));
  const height = Math.max(1, Math.min(size.height - top, Math.round(rect.height)));
  console.log('[screenshot] rect-crop', { left, top, width, height });

  try {
    const cropped = thumb.crop({ x: left, y: top, width, height });
    const jpegBuf = cropped.toJPEG(JPEG_QUALITY);
    console.log('[screenshot] rect-cropped jpeg bytes', jpegBuf.length);
    return jpegBuf.toString('base64');
  } catch (e) {
    console.error('[screenshot] rect-crop failed', e);
    throw new Error(`Crop failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function canCaptureScreen(): Promise<boolean> {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 16, height: 16 },
    });
    if (sources.length === 0) return false;
    return !sources[0].thumbnail.isEmpty();
  } catch (e) {
    console.error('[screenshot] canCaptureScreen error', e);
    return false;
  }
}
