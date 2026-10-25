export type AIModeState = 'idle' | 'triggering' | 'active_input' | 'active_loading' | 'active_response';

export type TemplateId =
  | 'summary'
  | 'brief'
  | 'translate'
  | 'explain'
  | 'code'
  | 'improve'
  | 'define'
  | 'solve'
  | 'reply'
  | 'identify';

export type CursorPosition = {
  x: number;
  y: number;
  displayId: number;
};

export type LLMChunk = {
  text: string;
};

export type LLMError = {
  message: string;
  code?: string;
};

export type ToolActivity =
  | {
      kind: 'start';
      id: string;
      name: string;
      label: string;
      args: unknown;
    }
  | {
      kind: 'end';
      id: string;
      name: string;
      ok: boolean;
      summary: string;
    };

export type ToolApprovalRequest = {
  id: string;
  name: string;
  label: string;
  args: Record<string, unknown>;
};

export type ProviderId = 'openrouter' | 'anthropic' | 'openai' | 'gemini' | 'deepseek';

export type UserProfile = {
  name: string;
  role: string;
  preferredLanguage: string;
};

export type ProviderSettings = {
  apiKey: string;
  enabled: boolean;
};

export type TriggerHotkey =
  | 'MetaRight'
  | 'CtrlLeft'
  | 'CtrlRight'
  | 'AltRight'
  | 'ShiftRight';

export type Settings = {
  // legacy: keep openrouterApiKey writable for old config files
  openrouterApiKey: string;
  primaryModel: string;
  fallbackModel: string;
  webSearch: boolean;
  workspaceFolder: string;
  providers: Record<ProviderId, ProviderSettings>;
  autoApproveTools: boolean;
  memorySaveEnabled: boolean;
  maxContextTokens: number;
  voiceLanguage: string;
  triggerHotkey: TriggerHotkey;
  userProfile: UserProfile;
  // When false (the default), the user profile is never injected into the
  // system prompt and is never sent to the chosen provider. The settings UI
  // shows a toggle so users can opt in explicitly. EU defaults ship off.
  personalizePrompts: boolean;
  dismissOnDoubleClick: boolean;
  // Auto-update check on launch + once per 24h. Manual "Check for updates"
  // in the tray menu works regardless of this setting. Default on.
  autoCheckUpdates: boolean;
  // Voice-first mode. When on, triggering AICursor auto-starts the
  // microphone, the transcript auto-submits, and the response gets read
  // back via TTS so the user can run a hands-free conversation loop. Off
  // by default — voice is still available manually via the mic icon.
  audioMode: boolean;
};

// Snapshot the updater sends to the renderer over the `updates:state`
// channel. Renderer only ever knows the high-level status, never the
// manifest internals.
export type UpdateStateMessage =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'available'; version: string; changelog?: string; size: number }
  | { status: 'downloading'; version: string; percent: number; bytesPerSecond: number }
  | { status: 'downloaded'; version: string; path: string }
  | { status: 'up-to-date'; version: string }
  | { status: 'error'; message: string };

export type SessionSummary = {
  id: string;
  startedAt: number;
  endedAt: number;
  firstPrompt: string;
  turnCount: number;
  // Paths are stored relative to the workspace folder so the renderer never
  // sees the user's home directory. The main process resolves them at the
  // moment of reveal and enforces workspace containment. Relative form also
  // means a shared session JSON can move between machines without leaking
  // the original owner's filesystem layout.
  jsonRelativePath: string;
  htmlRelativePath: string | null;
};

export type LinkMeta = {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
  host: string;
};

export type SaveResult =
  | { ok: true; path: string; format: 'md' | 'html' | 'pdf' }
  | { ok: false; canceled?: boolean; error?: string };

export type ClipboardContext = {
  preview: string | null;
  length: number;
};

export type PermissionsStatus = {
  accessibility: boolean;
  screenRecording: boolean;
};

export type AICursorAPI = {
  onAIModeStart: (cb: (pos: CursorPosition) => void) => () => void;
  onAIModeEnd: (cb: () => void) => () => void;
  onCursorPosition: (cb: (pos: CursorPosition) => void) => () => void;
  onLLMChunk: (cb: (chunk: LLMChunk) => void) => () => void;
  onLLMDone: (cb: () => void) => () => void;
  onLLMError: (cb: (err: LLMError) => void) => () => void;

  queryLLM: (prompt: string) => Promise<void>;
  cancelAIMode: () => Promise<void>;

  getSettings: () => Promise<Settings>;
  setSettings: (patch: Partial<Settings>) => Promise<Settings>;

  getPermissions: () => Promise<PermissionsStatus>;
  openSystemSettings: (kind: 'accessibility' | 'screen-recording') => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  fetchLinkMeta: (url: string) => Promise<LinkMeta | null>;

  onSettingsOpen: (cb: () => void) => () => void;
  onClipboardContext: (cb: (ctx: ClipboardContext) => void) => () => void;
  onToolActivity: (cb: (activity: ToolActivity) => void) => () => void;
  onToolApprovalRequest: (cb: (req: ToolApprovalRequest) => void) => () => void;
  onToolApprovalCleared: (cb: (id: string) => void) => () => void;
  respondToolApproval: (id: string, approved: boolean) => void;
  dismissClipboard: () => Promise<void>;
  triggerAIMode: () => void;
  transcribeAudio: (audioBase64: string, mimeType: string) => Promise<string>;

  queryLLMWithOptions: (
    prompt: string,
    options: { web?: boolean; templateId?: TemplateId },
  ) => Promise<void>;
  quit: () => void;
  openSettings: () => void;
  saveResponse: (payload: { prompt: string; markdown: string; web: boolean }) => Promise<SaveResult>;
  pickWorkspaceFolder: () => Promise<string | null>;
  getAppVersion: () => Promise<string>;

  listSessions: () => Promise<SessionSummary[]>;
  revealSession: (path: string) => Promise<void>;
  clearAllSessions: () => Promise<{ removed: number }>;
  synthesizeSpeech: (text: string) => Promise<
    | { audioBase64: string; mimeType: string }
    | { error: string }
  >;

  setInteractive: (interactive: boolean) => void;

  // Auto-updater. Renderer triggers manual checks / installs, listens for
  // state changes. The main process is the source of truth.
  checkForUpdates: () => Promise<UpdateStateMessage>;
  installPendingUpdate: () => Promise<void>;
  onUpdateState: (cb: (state: UpdateStateMessage) => void) => () => void;

  // Tell main the current box bounds (in display-local coords) so the global
  // mouse hook can detect outside-click dismiss. Pass null when the box is
  // hidden or temporarily covered (e.g. Settings open).
  sendBoxBounds: (
    bounds:
      | { left: number; top: number; right: number; bottom: number; displayId: number }
      | null,
  ) => void;
  // Signal that the Settings panel is opening/closing so main can lower the
  // overlay alwaysOnTop level — otherwise the screen-saver-level window blocks
  // the user from Cmd+Tabbing to their browser to copy an API key.
  setOverlaySettingsMode: (open: boolean) => void;

  // User-defined rectangle screenshot. The renderer hands main the display-
  // local rect (work-area frame); main re-captures from that region and
  // substitutes it for the default cursor-centered crop. ok=false means the
  // capture itself failed (permission missing, weird rect, etc.).
  captureSelection: (
    rect: { x: number; y: number; width: number; height: number },
    displayId: number,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  onSelectionDone: (
    cb: (result: { ok: true } | { ok: false; error: string }) => void,
  ) => () => void;
  // Main broadcasts true when the user presses the trigger key while AI mode
  // is already open (= "arm selection mode"), and false on release. The
  // renderer uses this to force the overlay interactive so the drag-to-select
  // pointer handlers can fire.
  onSelectionArm: (cb: (armed: boolean) => void) => () => void;

  // Validate an API key against the provider's account/list-models endpoint.
  // For OpenRouter the `label` includes the remaining credit balance
  // (e.g. "$3.42 left"). For the other providers `label` is "connected".
  // ok=false carries a short human-readable error.
  testProviderKey: (
    provider: ProviderId,
    apiKey: string,
  ) => Promise<{ ok: true; label?: string } | { ok: false; error: string }>;

  platform: NodeJS.Platform;
};

declare global {
  interface Window {
    aipointer: AICursorAPI;
  }
}
