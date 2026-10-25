// AiCursor standalone project file.
import type { AICursorAPI } from '../../electron/types';

function getApi(): AICursorAPI {
  if (typeof window === 'undefined' || !window.aipointer) {
    throw new Error('window.aipointer is not available. Preload script did not load.');
  }
  return window.aipointer;
}

export const ipc = new Proxy<AICursorAPI>({} as AICursorAPI, {
  get(_t, prop: keyof AICursorAPI) {
    return getApi()[prop];
  },
});
