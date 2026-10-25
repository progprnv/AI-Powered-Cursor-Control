// AiCursor standalone project file.
import { useEffect, useState } from 'react';
import { ipc } from '../lib/ipc';

export function useAIMode(): { active: boolean } {
  const [active, setActive] = useState(false);

  useEffect(() => {
    const offStart = ipc.onAIModeStart(() => setActive(true));
    const offEnd = ipc.onAIModeEnd(() => setActive(false));
    return () => {
      offStart();
      offEnd();
    };
  }, []);

  return { active };
}
