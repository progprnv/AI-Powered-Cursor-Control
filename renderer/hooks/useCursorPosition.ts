// AiCursor standalone project file.
import { useEffect, useState } from 'react';
import { ipc } from '../lib/ipc';
import type { CursorPosition } from '../../electron/types';

export function useCursorPosition(): CursorPosition | null {
  const [pos, setPos] = useState<CursorPosition | null>(null);

  useEffect(() => {
    // Dedupe identical positions before calling setState. Every IPC payload
    // is a freshly-allocated object — React would treat each one as a state
    // change even when the cursor didn't actually move, which kept the whole
    // App tree re-rendering at 30Hz unnecessarily and made downstream
    // useEffects (boxBounds, hover hit-test) fire in lock-step.
    const update = (p: CursorPosition) => {
      setPos((prev) => {
        if (
          prev &&
          prev.x === p.x &&
          prev.y === p.y &&
          prev.displayId === p.displayId
        ) {
          return prev;
        }
        return p;
      });
    };
    const offStart = ipc.onAIModeStart(update);
    const offCursor = ipc.onCursorPosition(update);
    const offEnd = ipc.onAIModeEnd(() => setPos(null));
    return () => {
      offStart();
      offCursor();
      offEnd();
    };
  }, []);

  return pos;
}
