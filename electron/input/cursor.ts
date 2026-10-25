// AiCursor standalone project file.
import { screen } from 'electron';
import { broadcastCursorPosition } from '../ipc/handlers';

// 33ms ~= 30Hz: low enough to keep IPC cheap when idle, high enough that
// hit-testing the bottom pill feels instant on hover. We still re-broadcast
// on every actual position change.
const POLL_INTERVAL_MS = 33;

let interval: NodeJS.Timeout | null = null;
let lastX = -1;
let lastY = -1;
let lastDisplayId = -1;

function tick(): void {
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  if (cursor.x === lastX && cursor.y === lastY && display.id === lastDisplayId) return;
  lastX = cursor.x;
  lastY = cursor.y;
  lastDisplayId = display.id;
  broadcastCursorPosition();
}

export function startCursorTracking(): void {
  if (interval) return;
  lastX = -1;
  lastY = -1;
  lastDisplayId = -1;
  broadcastCursorPosition();
  interval = setInterval(tick, POLL_INTERVAL_MS);
}

export function stopCursorTracking(): void {
  if (!interval) return;
  clearInterval(interval);
  interval = null;
}

export function isCursorTrackingActive(): boolean {
  return interval !== null;
}
