// AiCursor standalone project file.
import { useCallback, useEffect, useState } from 'react';
import { ipc } from '../lib/ipc';
import type { Settings } from '../../electron/types';

export function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const s = await ipc.getSettings();
      setSettings(s);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const save = useCallback(async (patch: Partial<Settings>) => {
    const next = await ipc.setSettings(patch);
    setSettings(next);
    return next;
  }, []);

  return { settings, loading, save, refresh };
}
