import { uIOhook, UiohookKey, type UiohookKeyboardEvent, type UiohookMouseEvent } from 'uiohook-napi';
import { screen } from 'electron';
import { getSettings } from '../store/settings';

const HOLD_KEY_MS = 200;
const LEFT_MOUSE_BUTTON = 1;
const HOLD_MOUSE_MS = 200;
const MOUSE_TRIGGER_MOVE_PX = 6;
const DOUBLE_CLICK_MS = 450;
const OUTSIDE_HALO_PX = 14;

// Active-box bounds in display-local coords. Renderer pushes these whenever
// the box position changes (it's draggable). When set, a left mouse click
// outside these bounds during AI mode counts towards the dismiss-by-click
// gesture — single or double depending on settings.dismissOnDoubleClick.
type BoxBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  displayId: number;
};
let activeBoxBounds: BoxBounds | null = null;
let lastOutsideClickMs = 0;

export function setActiveBoxBounds(b: BoxBounds | null): void {
  activeBoxBounds = b;
  // Only reset the double-click accumulator when the box truly goes away
  // (renderer sent null). Resetting it on every bounds update was a bug —
  // the renderer pushes bounds at ~60fps via requestAnimationFrame, which
  // wiped lastOutsideClickMs between click 1 and click 2 every single time
  // and made "click outside to dismiss" effectively impossible to trigger.
  if (b === null) lastOutsideClickMs = 0;
}

// User-selectable trigger. Read from settings every keydown so settings
// changes take effect immediately without restarting the app.
const HOTKEY_MAP: Record<string, number> = {
  MetaRight: UiohookKey.MetaRight,
  CtrlLeft: UiohookKey.Ctrl,
  CtrlRight: UiohookKey.CtrlRight,
  AltRight: UiohookKey.AltRight,
  ShiftRight: UiohookKey.ShiftRight,
};

function currentTriggerKeycode(): number {
  const hk = getSettings().triggerHotkey;
  return HOTKEY_MAP[hk] ?? (process.platform === 'darwin' ? UiohookKey.MetaRight : UiohookKey.Ctrl);
}

type State = 'idle' | 'pending' | 'active';
type PendingKind = 'key' | 'mouse';

type Listeners = {
  onStart: () => void;
  onEnd: () => void;
  // Fired when the trigger key is pressed AGAIN while the box is already
  // open. We use that as a "modifier" to switch the overlay into selection-
  // capture mode: hold the trigger key + drag → defines a rectangle for
  // an ad-hoc screenshot. Lets users keep click-through to background apps
  // for normal mouse work while still having a clean way to escape into
  // selection mode on demand.
  onSelectionArm?: (armed: boolean) => void;
};

let state: State = 'idle';
let pendingTimer: NodeJS.Timeout | null = null;
let pendingKind: PendingKind | null = null;
let listeners: Listeners | null = null;
let attached = false;
let selectionArmed = false;
let pendingMouseOrigin: { x: number; y: number } | null = null;

function clearPending(): void {
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  pendingKind = null;
  pendingMouseOrigin = null;
  if (state === 'pending') state = 'idle';
}

function fireStart(): void {
  if (state === 'active') return;
  state = 'active';
  listeners?.onStart();
}

function fireEnd(): void {
  if (state !== 'active') return;
  state = 'idle';
  if (selectionArmed) {
    selectionArmed = false;
    listeners?.onSelectionArm?.(false);
  }
  listeners?.onEnd();
}

function onKeydown(e: UiohookKeyboardEvent): void {
  if (e.keycode === UiohookKey.Escape) {
    if (state === 'active') fireEnd();
    else clearPending();
    return;
  }
  if (e.keycode !== currentTriggerKeycode()) return;
  // Trigger-key pressed while the box is already open → arm selection mode.
  // The renderer listens for this and force-makes the overlay interactive so
  // the drag rectangle handler can fire. Releasing the key disarms.
  if (state === 'active') {
    if (!selectionArmed) {
      selectionArmed = true;
      listeners?.onSelectionArm?.(true);
    }
    return;
  }
  if (state !== 'idle') return;
  state = 'pending';
  pendingKind = 'key';
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    pendingKind = null;
    fireStart();
  }, HOLD_KEY_MS);
}

function onKeyup(e: UiohookKeyboardEvent): void {
  if (e.keycode !== currentTriggerKeycode()) return;
  if (selectionArmed) {
    selectionArmed = false;
    listeners?.onSelectionArm?.(false);
  }
  if (state === 'pending' && pendingKind === 'key') {
    clearPending();
  }
}

function onMousedown(e: UiohookMouseEvent): void {
  // Left-mouse click outside the box during AI mode → dismiss accumulator.
  // Settings controls single- vs. double-click.
  if (e.button === LEFT_MOUSE_BUTTON && state === 'active' && activeBoxBounds) {
    handleOutsideClick();
    return;
  }

  // Left-mouse long-press triggers AI mode from idle.
  if (e.button !== LEFT_MOUSE_BUTTON) return;
  if (state !== 'idle') return;
  state = 'pending';
  pendingKind = 'mouse';
  pendingMouseOrigin = { x: e.x, y: e.y };
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    pendingKind = null;
    pendingMouseOrigin = null;
    fireStart();
  }, HOLD_MOUSE_MS);
}

function onMousemove(e: UiohookMouseEvent): void {
  if (state !== 'pending' || pendingKind !== 'mouse' || !pendingMouseOrigin) return;
  const dx = e.x - pendingMouseOrigin.x;
  const dy = e.y - pendingMouseOrigin.y;
  if (Math.hypot(dx, dy) > MOUSE_TRIGGER_MOVE_PX) {
    clearPending();
  }
}

function handleOutsideClick(): void {
  if (!activeBoxBounds) return;
  let cursor: Electron.Point;
  try {
    cursor = screen.getCursorScreenPoint();
  } catch {
    return;
  }
  const display = screen.getDisplayNearestPoint(cursor);
  let inside = false;
  if (display.id === activeBoxBounds.displayId) {
    const lx = cursor.x - display.workArea.x;
    const ly = cursor.y - display.workArea.y;
    inside =
      lx >= activeBoxBounds.left - OUTSIDE_HALO_PX &&
      lx <= activeBoxBounds.right + OUTSIDE_HALO_PX &&
      ly >= activeBoxBounds.top - OUTSIDE_HALO_PX &&
      ly <= activeBoxBounds.bottom + OUTSIDE_HALO_PX;
  }
  if (inside) {
    lastOutsideClickMs = 0;
    return;
  }
  // Outside the box. Single- or double-click based on user setting.
  const requireDouble = getSettings().dismissOnDoubleClick !== false;
  if (!requireDouble) {
    fireEnd();
    return;
  }
  const now = Date.now();
  if (now - lastOutsideClickMs < DOUBLE_CLICK_MS) {
    fireEnd();
    lastOutsideClickMs = 0;
  } else {
    lastOutsideClickMs = now;
  }
}

function onMouseup(e: UiohookMouseEvent): void {
  if (e.button !== LEFT_MOUSE_BUTTON) return;
  if (state === 'pending' && pendingKind === 'mouse') {
    clearPending();
  }
}

export function startTriggerDetection(l: Listeners): void {
  if (attached) return;
  listeners = l;
  uIOhook.on('keydown', onKeydown);
  uIOhook.on('keyup', onKeyup);
  uIOhook.on('mousedown', onMousedown);
  uIOhook.on('mouseup', onMouseup);
  uIOhook.on('mousemove', onMousemove);
  attached = true;
}

export function stopTriggerDetection(): void {
  if (!attached) return;
  uIOhook.off('keydown', onKeydown);
  uIOhook.off('keyup', onKeyup);
  uIOhook.off('mousedown', onMousedown);
  uIOhook.off('mouseup', onMouseup);
  uIOhook.off('mousemove', onMousemove);
  attached = false;
  clearPending();
  state = 'idle';
  listeners = null;
}

export function endAIMode(): void {
  fireEnd();
}

export function startAIModeManually(): void {
  if (state === 'active') return;
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  pendingKind = null;
  fireStart();
}

export function getAIModeState(): State {
  return state;
}
