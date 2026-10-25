// AiCursor standalone project file.
import { contextBridge, ipcRenderer } from 'electron';
import type {
  AICursorAPI,
  ClipboardContext,
  CursorPosition,
  LLMChunk,
  LLMError,
  LinkMeta,
  PermissionsStatus,
  SaveResult,
  Settings,
  ToolActivity,
  ToolApprovalRequest,
  UpdateStateMessage,
} from './types';

function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: AICursorAPI = {
  onAIModeStart: (cb) => on<CursorPosition>('ai-mode:start', cb),
  onAIModeEnd: (cb) => on<void>('ai-mode:end', () => cb()),
  onCursorPosition: (cb) => on<CursorPosition>('cursor:position', cb),
  onLLMChunk: (cb) => on<LLMChunk>('llm:chunk', cb),
  onLLMDone: (cb) => on<void>('llm:done', () => cb()),
  onLLMError: (cb) => on<LLMError>('llm:error', cb),

  queryLLM: (prompt: string) => ipcRenderer.invoke('llm:query', prompt),
  cancelAIMode: () => ipcRenderer.invoke('ai-mode:cancel'),

  getSettings: () => ipcRenderer.invoke('settings:get') as Promise<Settings>,
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch) as Promise<Settings>,

  getPermissions: () => ipcRenderer.invoke('permissions:get') as Promise<PermissionsStatus>,
  openSystemSettings: (kind) => ipcRenderer.invoke('permissions:open', kind),
  openExternal: (url: string) => ipcRenderer.invoke('external:open', url),
  fetchLinkMeta: (url: string) => ipcRenderer.invoke('external:fetch-meta', url) as Promise<LinkMeta | null>,

  onSettingsOpen: (cb) => on<void>('settings:open', () => cb()),
  onClipboardContext: (cb) => on<ClipboardContext>('clipboard:context', cb),
  onToolActivity: (cb) => on<ToolActivity>('llm:tool-activity', cb),
  onToolApprovalRequest: (cb) =>
    on<ToolApprovalRequest>('llm:tool-approval-request', cb),
  onToolApprovalCleared: (cb) => on<string>('llm:tool-approval-cleared', cb),
  respondToolApproval: (id: string, approved: boolean) =>
    ipcRenderer.send('llm:tool-approval-respond', id, approved),
  triggerAIMode: () => ipcRenderer.send('ai-mode:trigger'),
  transcribeAudio: (audioBase64: string, mimeType: string) =>
    ipcRenderer.invoke('voice:transcribe', audioBase64, mimeType) as Promise<string>,
  dismissClipboard: () => ipcRenderer.invoke('clipboard:dismiss'),

  queryLLMWithOptions: (prompt: string, options: { web?: boolean }) =>
    ipcRenderer.invoke('llm:query-options', prompt, options),
  quit: () => ipcRenderer.send('app:quit'),
  openSettings: () => ipcRenderer.send('settings:request-open'),
  saveResponse: (payload) =>
    ipcRenderer.invoke('response:save', payload) as Promise<SaveResult>,
  pickWorkspaceFolder: () => ipcRenderer.invoke('workspace:pick') as Promise<string | null>,
  getAppVersion: () => ipcRenderer.invoke('app:version') as Promise<string>,
  listSessions: () => ipcRenderer.invoke('sessions:list'),
  revealSession: (path: string) => ipcRenderer.invoke('sessions:reveal', path),
  clearAllSessions: () => ipcRenderer.invoke('sessions:clear'),
  synthesizeSpeech: (text: string) => ipcRenderer.invoke('voice:synthesize', text) as Promise<
    { audioBase64: string; mimeType: string } | { error: string }
  >,

  setInteractive: (interactive: boolean) => {
    ipcRenderer.send('overlay:set-interactive', interactive);
  },

  checkForUpdates: () => ipcRenderer.invoke('updates:check') as Promise<UpdateStateMessage>,
  installPendingUpdate: () => ipcRenderer.invoke('updates:install') as Promise<void>,
  onUpdateState: (cb) => on<UpdateStateMessage>('updates:state', cb),

  sendBoxBounds: (bounds) => ipcRenderer.send('box:bounds', bounds),
  setOverlaySettingsMode: (open: boolean) => ipcRenderer.send('overlay:settings-mode', open),

  captureSelection: (rect, displayId) =>
    ipcRenderer.invoke('selection:capture', { rect, displayId }) as Promise<
      { ok: true } | { ok: false; error: string }
    >,
  onSelectionDone: (cb) =>
    on<{ ok: true } | { ok: false; error: string }>('selection:done', cb),
  onSelectionArm: (cb) => on<boolean>('selection:arm', cb),

  testProviderKey: (provider, apiKey) =>
    ipcRenderer.invoke('provider:test-key', { provider, apiKey }) as Promise<
      { ok: true; label?: string } | { ok: false; error: string }
    >,

  platform: process.platform,
};

contextBridge.exposeInMainWorld('aipointer', api);
