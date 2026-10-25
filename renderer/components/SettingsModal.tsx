import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { popTransition, popVariants } from '../lib/animations';
import { ipc } from '../lib/ipc';
import { FAQ } from './FAQ';
import type {
  ProviderId,
  ProviderSettings,
  Settings,
  TriggerHotkey,
  UserProfile,
} from '../../electron/types';

const VOICE_LANGUAGES: Array<{ value: string; label: string }> = [
  { value: 'auto', label: 'Auto-detect' },
  { value: 'en', label: 'English' },
  { value: 'de', label: 'German' },
  { value: 'fr', label: 'French' },
  { value: 'es', label: 'Spanish' },
  { value: 'it', label: 'Italian' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'nl', label: 'Dutch' },
  { value: 'pl', label: 'Polish' },
  { value: 'sv', label: 'Swedish' },
  { value: 'tr', label: 'Turkish' },
  { value: 'ja', label: 'Japanese' },
  { value: 'zh', label: 'Chinese' },
  { value: 'ko', label: 'Korean' },
  { value: 'ru', label: 'Russian' },
  { value: 'ar', label: 'Arabic' },
  { value: 'hi', label: 'Hindi' },
];

const TRIGGER_HOTKEYS: Array<{ value: TriggerHotkey; label: string }> = [
  { value: 'MetaRight', label: 'Right Cmd / Meta · default on macOS' },
  { value: 'CtrlLeft', label: 'Left Ctrl · default on Windows / Linux' },
  { value: 'CtrlRight', label: 'Right Ctrl' },
  { value: 'AltRight', label: 'Right Option / Alt' },
  { value: 'ShiftRight', label: 'Right Shift' },
];

type Props = {
  initial: Settings | null;
  onClose: () => void;
  onSaved: (s: Settings) => void;
};

type ProviderMeta = {
  id: ProviderId;
  name: string;
  defaultModel: string;
  capableModel: string;
  caps: { vision: boolean; tools: boolean; web: boolean };
  keyPlaceholder: string;
  keyPrefix?: string;
  getKey: string;
};

const PROVIDERS: ProviderMeta[] = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    defaultModel: 'google/gemini-3-flash-preview',
    capableModel: 'google/gemini-3-flash-preview',
    caps: { vision: true, tools: true, web: true },
    keyPlaceholder: 'sk-or-v1-…',
    keyPrefix: 'sk-or-',
    getKey: 'openrouter.ai/keys',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    defaultModel: 'claude-haiku-4-5',
    capableModel: 'claude-sonnet-4-6',
    caps: { vision: true, tools: true, web: false },
    keyPlaceholder: 'sk-ant-…',
    keyPrefix: 'sk-ant-',
    getKey: 'console.anthropic.com/settings/keys',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    defaultModel: 'gpt-5-mini',
    capableModel: 'gpt-5',
    caps: { vision: true, tools: true, web: false },
    keyPlaceholder: 'sk-…',
    keyPrefix: 'sk-',
    getKey: 'platform.openai.com/api-keys',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    defaultModel: 'gemini-2.5-flash',
    capableModel: 'gemini-2.5-pro',
    caps: { vision: true, tools: true, web: true },
    keyPlaceholder: 'AIza…',
    getKey: 'aistudio.google.com/apikey',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    defaultModel: 'deepseek-flash',
    capableModel: 'deepseek-flash',
    caps: { vision: true, tools: true, web: false },
    keyPlaceholder: 'sk-…',
    keyPrefix: 'sk-',
    getKey: 'platform.deepseek.com/api_keys',
  },
];

const CAPABILITIES = [
  { name: 'Vision Q&A', description: 'Read what is near your cursor.' },
  { name: 'Web search', description: 'Google-grounded answers via :online.' },
  { name: 'Function calling', description: 'fetch_url, open_url, copy, save, reveal.' },
  { name: 'Templates · 10 modes', description: 'summary, brief, translate, explain, code, improve, define, solve, reply, identify.' },
  { name: 'Voice input', description: 'Speak your query — transcribed via Gemini / OpenAI / OR.' },
  { name: 'Read aloud (TTS)', description: 'OpenAI / Gemini TTS plays the response back.' },
  { name: 'Link previews', description: 'Auto-fetch OG image, title, description.' },
  { name: 'Document save', description: 'Export as HTML (A4), PDF, or Markdown.' },
  { name: 'Clipboard context', description: 'Include selected text alongside the screenshot.' },
  { name: 'Tool approval', description: 'Green check / red x before destructive actions.' },
  { name: 'Provider fallback', description: 'OpenRouter primary, others as automatic backup.' },
  { name: 'Session memory', description: 'Multi-turn within a session, optional JSON/HTML history.' },
];

export function SettingsModal({ initial, onClose, onSaved }: Props) {
  const [providers, setProviders] = useState<Record<ProviderId, ProviderSettings>>({
    openrouter: { apiKey: '', enabled: true },
    anthropic: { apiKey: '', enabled: false },
    openai: { apiKey: '', enabled: false },
    gemini: { apiKey: '', enabled: false },
    deepseek: { apiKey: '', enabled: false },
  });
  const [showKeys, setShowKeys] = useState<Record<ProviderId, boolean>>({
    openrouter: false,
    anthropic: false,
    openai: false,
    gemini: false,
    deepseek: false,
  });
  // Per-provider test state: idle (no test run yet for the current key),
  // testing (request in flight), ok with optional label (e.g. "$3.42 left"
  // for OpenRouter), or err with the failure reason. We key the cache by
  // (providerId + apiKey) so editing the key resets the displayed status —
  // a result for one key is meaningless for a different one.
  type TestState =
    | { status: 'idle' }
    | { status: 'testing' }
    | { status: 'ok'; label?: string }
    | { status: 'err'; error: string };
  const [testState, setTestState] = useState<Record<ProviderId, TestState>>({
    openrouter: { status: 'idle' },
    anthropic: { status: 'idle' },
    openai: { status: 'idle' },
    gemini: { status: 'idle' },
    deepseek: { status: 'idle' },
  });
  const [testedKey, setTestedKey] = useState<Record<ProviderId, string>>({
    openrouter: '',
    anthropic: '',
    openai: '',
    gemini: '',
    deepseek: '',
  });
  const [webSearch, setWebSearch] = useState(false);
  const [autoApproveTools, setAutoApproveTools] = useState(false);
  const [dismissOnDoubleClick, setDismissOnDoubleClick] = useState(true);
  const [audioMode, setAudioMode] = useState(false);
  const [memorySaveEnabled, setMemorySaveEnabled] = useState(false);
  const [maxContextTokens, setMaxContextTokens] = useState(8000);
  const [voiceLanguage, setVoiceLanguage] = useState('auto');
  const [triggerHotkey, setTriggerHotkey] = useState<TriggerHotkey>('MetaRight');
  const [userProfile, setUserProfile] = useState<UserProfile>({
    name: '',
    role: '',
    preferredLanguage: '',
  });
  const [personalizePrompts, setPersonalizePrompts] = useState(false);
  const [autoCheckUpdates, setAutoCheckUpdates] = useState(true);
  const [workspace, setWorkspace] = useState('');
  const [version, setVersion] = useState('1.0.0');
  const [saving, setSaving] = useState(false);
  const [clearingHistory, setClearingHistory] = useState(false);
  const [clearedCount, setClearedCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // JSON snapshot of the form state at the moment it was last loaded from
  // disk OR last successfully saved. We compare this against the current
  // serialized state on each render to derive `isDirty` — when nothing has
  // changed, the primary footer button switches from "Save" to "Close" so
  // the user doesn't have to remember whether they actually edited anything.
  const [savedSerial, setSavedSerial] = useState<string | null>(null);

  useEffect(() => {
    const baseProviders =
      initial?.providers ?? {
        openrouter: { apiKey: '', enabled: true },
        anthropic: { apiKey: '', enabled: false },
        openai: { apiKey: '', enabled: false },
        gemini: { apiKey: '', enabled: false },
        deepseek: { apiKey: '', enabled: false },
      };
    const baseUserProfile =
      initial?.userProfile ?? { name: '', role: '', preferredLanguage: '' };
    setProviders(baseProviders);
    setWebSearch(initial?.webSearch ?? false);
    setAutoApproveTools(initial?.autoApproveTools ?? false);
    setDismissOnDoubleClick(initial?.dismissOnDoubleClick ?? true);
    setAudioMode(initial?.audioMode ?? false);
    setMemorySaveEnabled(initial?.memorySaveEnabled ?? false);
    setMaxContextTokens(initial?.maxContextTokens ?? 8000);
    setVoiceLanguage(initial?.voiceLanguage ?? 'auto');
    setTriggerHotkey(initial?.triggerHotkey ?? 'MetaRight');
    setUserProfile(baseUserProfile);
    setPersonalizePrompts(initial?.personalizePrompts ?? false);
    setAutoCheckUpdates(initial?.autoCheckUpdates ?? true);
    setWorkspace(initial?.workspaceFolder ?? '');
    setError(null);
    // Snapshot the just-loaded state. We compute the JSON from the `initial`
    // values directly rather than from the React state (which won't reflect
    // the setX calls above until the next render), so the snapshot matches
    // the very next render and `isDirty` starts at false.
    setSavedSerial(
      JSON.stringify({
        providers: baseProviders,
        webSearch: initial?.webSearch ?? false,
        autoApproveTools: initial?.autoApproveTools ?? false,
        dismissOnDoubleClick: initial?.dismissOnDoubleClick ?? true,
        audioMode: initial?.audioMode ?? false,
        memorySaveEnabled: initial?.memorySaveEnabled ?? false,
        maxContextTokens: initial?.maxContextTokens ?? 8000,
        voiceLanguage: initial?.voiceLanguage ?? 'auto',
        triggerHotkey: initial?.triggerHotkey ?? 'MetaRight',
        userProfile: baseUserProfile,
        personalizePrompts: initial?.personalizePrompts ?? false,
        autoCheckUpdates: initial?.autoCheckUpdates ?? true,
        workspace: initial?.workspaceFolder ?? '',
      }),
    );
    void ipc.getAppVersion().then((v) => setVersion(v)).catch(() => undefined);
  }, [initial]);

  // Serialise current form state so we can compare against `savedSerial` to
  // know whether the user has unsaved edits. Memoised by the form fields so
  // we don't re-stringify on every cursor blink. The footer button reads
  // `isDirty` to decide between Save (still has work to do) and Close
  // (everything's already on disk).
  const currentSerial = useMemo(
    () =>
      JSON.stringify({
        providers,
        webSearch,
        autoApproveTools,
        dismissOnDoubleClick,
        audioMode,
        memorySaveEnabled,
        maxContextTokens,
        voiceLanguage,
        triggerHotkey,
        userProfile,
        personalizePrompts,
        autoCheckUpdates,
        workspace,
      }),
    [
      providers,
      webSearch,
      autoApproveTools,
      dismissOnDoubleClick,
      audioMode,
      memorySaveEnabled,
      maxContextTokens,
      voiceLanguage,
      triggerHotkey,
      userProfile,
      personalizePrompts,
      autoCheckUpdates,
      workspace,
    ],
  );
  const isDirty = savedSerial !== null && savedSerial !== currentSerial;

  const onSave = async () => {
    // At least one enabled provider with key.
    const enabled = (Object.keys(providers) as ProviderId[]).filter(
      (id) => providers[id].enabled && providers[id].apiKey.trim().length > 0,
    );
    if (enabled.length === 0) {
      setError('Enable at least one provider and paste its API key.');
      return;
    }
    for (const id of enabled) {
      const meta = PROVIDERS.find((p) => p.id === id);
      const key = providers[id].apiKey.trim();
      if (meta?.keyPrefix && !key.startsWith(meta.keyPrefix)) {
        setError(`${meta.name} keys start with "${meta.keyPrefix}". Double-check the key.`);
        return;
      }
    }
    setSaving(true);
    setError(null);
    try {
      const next = await ipc.setSettings({
        providers,
        webSearch,
        autoApproveTools,
        dismissOnDoubleClick,
        audioMode,
        memorySaveEnabled,
        maxContextTokens,
        voiceLanguage,
        triggerHotkey,
        userProfile,
        personalizePrompts,
        autoCheckUpdates,
        workspaceFolder: workspace || undefined,
      });
      onSaved(next);
      // Mark the form as clean by snapshotting the just-saved serialization.
      // The panel STAYS OPEN — the user explicitly closes it via Cancel / X /
      // Close. Saving and closing are two separate intents now.
      setSavedSerial(currentSerial);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  const pickWorkspace = async () => {
    const picked = await ipc.pickWorkspaceFolder();
    if (picked) setWorkspace(picked);
  };

  const setProviderField = <K extends keyof ProviderSettings>(
    id: ProviderId,
    key: K,
    value: ProviderSettings[K],
  ) => {
    setProviders((prev) => ({ ...prev, [id]: { ...prev[id], [key]: value } }));
    // Editing the API key invalidates the previously displayed test result.
    // We don't auto-rerun the test (cost / rate-limit reasons); we just hide
    // the stale label until the user clicks Test again.
    if (key === 'apiKey') {
      setTestState((prev) => ({ ...prev, [id]: { status: 'idle' } }));
    }
  };

  const runTest = async (id: ProviderId) => {
    const key = providers[id].apiKey.trim();
    if (!key) {
      setTestState((prev) => ({ ...prev, [id]: { status: 'err', error: 'Empty key' } }));
      return;
    }
    setTestState((prev) => ({ ...prev, [id]: { status: 'testing' } }));
    setTestedKey((prev) => ({ ...prev, [id]: key }));
    try {
      const res = await window.aipointer.testProviderKey(id, key);
      // Drop the response if the user has since edited the key (the result
      // would be misleading — it validates an outdated string).
      const currentKey = providers[id].apiKey.trim();
      if (currentKey !== key) return;
      if (res.ok) {
        setTestState((prev) => ({ ...prev, [id]: { status: 'ok', label: res.label } }));
      } else {
        setTestState((prev) => ({ ...prev, [id]: { status: 'err', error: res.error } }));
      }
    } catch (err) {
      setTestState((prev) => ({
        ...prev,
        [id]: { status: 'err', error: err instanceof Error ? err.message : 'Test failed' },
      }));
    }
  };

  const enabledCount = (Object.values(providers) as ProviderSettings[]).filter(
    (p) => p.enabled && p.apiKey.trim().length > 0,
  ).length;

  return (
    <div
      className="absolute inset-0 flex items-center justify-center bg-black/65 pointer-events-auto dark:bg-neutral-900/40"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <motion.div
        initial="hidden"
        animate="visible"
        exit="hidden"
        variants={popVariants}
        transition={popTransition}
        className={[
          'flex h-[720px] w-[760px] max-w-[92vw] max-h-[92vh] flex-col overflow-hidden rounded-2xl border shadow-glass',
          'border-white/12 bg-neutral-900',
          'dark:border-neutral-900/15 dark:bg-white',
        ].join(' ')}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
      >
        <header className="flex items-center justify-between border-b border-white/10 px-7 py-5 dark:border-neutral-900/10">
          <div className="flex items-center gap-3">
            <span className="relative flex h-7 w-7 items-center justify-center rounded-full bg-accent/20">
              <span className="h-2.5 w-2.5 rounded-full bg-accent shadow-halo" />
            </span>
            <div>
              <h1 className="text-[15px] font-semibold tracking-tight text-white dark:text-neutral-900">
                AICursor
              </h1>
              <p className="text-[11px] text-white/50 dark:text-neutral-900/55">
                Settings · v{version} ·{' '}
                <span className={enabledCount > 0 ? 'text-accent' : 'text-amber-400'}>
                  {enabledCount} provider{enabledCount === 1 ? '' : 's'} active
                </span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1.5 text-white/60 transition hover:bg-white/10 hover:text-white dark:text-neutral-900/60 dark:hover:bg-neutral-900/8 dark:hover:text-neutral-900"
          >
            <svg viewBox="0 0 16 16" fill="none" className="h-4 w-4">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-7 py-6" style={{ scrollbarWidth: 'thin' }}>
          {/* PROVIDERS */}
          <Section
            title="Providers"
            subtitle="OpenRouter is tried first — it routes to the cheapest, fastest model. Direct provider keys are used as automatic fallback in the listed order. You don't pick models, AICursor does."
          >
            <div className="flex flex-col gap-3">
              {PROVIDERS.map((meta, i) => {
                const p = providers[meta.id];
                const isPrimary = i === 0;
                return (
                  <div
                    key={meta.id}
                    className={[
                      'rounded-lg border p-3.5 transition',
                      'border-white/10 bg-white/3',
                      'dark:border-neutral-900/10 dark:bg-neutral-900/3',
                    ].join(' ')}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <Toggle
                          checked={p.enabled}
                          onChange={(v) => setProviderField(meta.id, 'enabled', v)}
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[13px] font-semibold text-white dark:text-neutral-900">
                              {meta.name}
                            </span>
                            {isPrimary && (
                              <span className="rounded-full border border-accent/35 bg-accent/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-accent">
                                primary
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10.5px] text-white/55 dark:text-neutral-900/55">
                            <span>
                              Fast: <code className="font-mono">{meta.defaultModel}</code>
                            </span>
                            <span>
                              Capable: <code className="font-mono">{meta.capableModel}</code>
                            </span>
                            <span className="flex items-center gap-1.5">
                              <Cap label="vision" on={meta.caps.vision} />
                              <Cap label="tools" on={meta.caps.tools} />
                              <Cap label="web" on={meta.caps.web} />
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                    {p.enabled && (
                      <div className="mt-3 flex gap-2">
                        <input
                          type={showKeys[meta.id] ? 'text' : 'password'}
                          value={p.apiKey}
                          onChange={(e) => setProviderField(meta.id, 'apiKey', e.target.value)}
                          placeholder={meta.keyPlaceholder}
                          spellCheck={false}
                          className={[
                            'flex-1 rounded-md border px-2.5 py-1.5 font-mono text-[12px] outline-none transition',
                            'border-white/14 bg-black/40 text-white placeholder:text-white/30 focus:border-accent/60 focus:bg-black/55',
                            'dark:border-neutral-900/18 dark:bg-neutral-900/5 dark:text-neutral-900 dark:placeholder:text-neutral-900/35 dark:focus:border-accent dark:focus:bg-neutral-900/8',
                          ].join(' ')}
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setShowKeys((s) => ({ ...s, [meta.id]: !s[meta.id] }))
                          }
                          className={[
                            'rounded-md border px-2.5 text-[11px] font-medium transition',
                            'border-white/14 bg-black/30 text-white/70 hover:text-white',
                            'dark:border-neutral-900/18 dark:bg-neutral-900/4 dark:text-neutral-900/70 dark:hover:text-neutral-900',
                          ].join(' ')}
                        >
                          {showKeys[meta.id] ? 'hide' : 'show'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void ipc.openExternal('https://' + meta.getKey)}
                          className={[
                            'rounded-md border px-2.5 text-[11px] font-medium transition',
                            'border-white/14 bg-black/30 text-accent/85 hover:text-accent',
                            'dark:border-neutral-900/18 dark:bg-neutral-900/4',
                          ].join(' ')}
                        >
                          Get key ↗
                        </button>
                        <button
                          type="button"
                          onClick={() => void runTest(meta.id)}
                          disabled={!p.apiKey.trim() || testState[meta.id].status === 'testing'}
                          className={[
                            'rounded-md border px-2.5 text-[11px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40',
                            'border-white/14 bg-black/30 text-white/85 hover:text-white',
                            'dark:border-neutral-900/18 dark:bg-neutral-900/4 dark:text-neutral-900/85 dark:hover:text-neutral-900',
                          ].join(' ')}
                          title="Validate the API key against the provider"
                        >
                          {testState[meta.id].status === 'testing' ? 'Testing…' : 'Test'}
                        </button>
                      </div>
                    )}
                    {p.enabled && testState[meta.id].status !== 'idle' && (
                      <TestResultLine
                        state={testState[meta.id]}
                        testedKey={testedKey[meta.id]}
                        currentKey={p.apiKey.trim()}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </Section>

          {/* BEHAVIOUR */}
          <Section title="Behaviour" subtitle="How AICursor responds and asks for permission.">
            <div className="flex flex-col gap-2">
              <ToggleRow
                label="Web search on every query"
                hint="Force-route through :online for Google-grounded answers. You can also use /web per query."
                checked={webSearch}
                onChange={setWebSearch}
              />
              <ToggleRow
                label="Auto-approve read-only tool runs"
                hint="Skip the activity-row check for read-only tools (fetch_url, read_clipboard). Destructive actions (open_url, copy_to_clipboard, save_document, reveal_in_finder) ALWAYS require explicit approval and this toggle does not change that."
                checked={autoApproveTools}
                onChange={setAutoApproveTools}
              />
              <ToggleRow
                label="Require double-click to dismiss"
                hint="Default. A single click into the empty area while the box is open is ignored — useful for selecting / copying text outside the box without losing your session. Turn off to dismiss on a single click."
                checked={dismissOnDoubleClick}
                onChange={setDismissOnDoubleClick}
              />
              <ToggleRow
                label="Voice-first conversation mode"
                hint="When on, triggering AICursor opens the box already listening — speak, the transcript auto-submits, the answer is read back, and the mic auto-reopens for a follow-up. Hands-free. ESC stops the loop at any time. Microphone permission is required."
                checked={audioMode}
                onChange={setAudioMode}
              />
            </div>
          </Section>

          <Section
            title="Memory"
            subtitle="Each session keeps context across follow-up turns until you dismiss the box. Optionally save sessions to your workspace so you can revisit them with /history."
          >
            <div className="flex flex-col gap-2">
              <ToggleRow
                label="Save sessions to workspace"
                hint="On dismiss, AICursor writes a JSON transcript + a styled HTML version to <workspace>/sessions/. Off by default — nothing is written to disk."
                checked={memorySaveEnabled}
                onChange={setMemorySaveEnabled}
              />
              <div
                className={[
                  'rounded-lg border px-3 py-2.5',
                  'border-white/8 bg-white/3',
                  'dark:border-neutral-900/10 dark:bg-neutral-900/3',
                ].join(' ')}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[12.5px] font-medium text-white dark:text-neutral-900">
                      Context budget
                    </div>
                    <div className="mt-0.5 text-[11px] text-white/55 dark:text-neutral-900/60">
                      Older turns get dropped (system + first user kept) once total exceeds this. Image counts as ~1500 tokens.
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={2000}
                      max={64000}
                      step={1000}
                      value={maxContextTokens}
                      onChange={(e) => {
                        const v = parseInt(e.target.value, 10);
                        if (!Number.isNaN(v)) setMaxContextTokens(v);
                      }}
                      className={[
                        'w-24 rounded-md border px-2 py-1 text-right text-[12px] font-mono outline-none transition',
                        'border-white/14 bg-black/40 text-white focus:border-accent/60',
                        'dark:border-neutral-900/18 dark:bg-neutral-900/5 dark:text-neutral-900 dark:focus:border-accent',
                      ].join(' ')}
                    />
                    <span className="text-[11px] text-white/55 dark:text-neutral-900/55">tokens</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-white/8 bg-white/3 px-3 py-2.5 dark:border-neutral-900/10 dark:bg-neutral-900/3">
                <div>
                  <div className="text-[12.5px] font-medium text-white dark:text-neutral-900">
                    History on disk
                  </div>
                  <div className="mt-0.5 text-[11px] text-white/55 dark:text-neutral-900/60">
                    {clearedCount !== null
                      ? `Removed ${clearedCount} file(s).`
                      : 'Delete every saved session JSON + HTML from your workspace.'}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={clearingHistory}
                  onClick={async () => {
                    setClearingHistory(true);
                    setClearedCount(null);
                    try {
                      const { removed } = await ipc.clearAllSessions();
                      setClearedCount(removed);
                      window.setTimeout(() => setClearedCount(null), 3000);
                    } finally {
                      setClearingHistory(false);
                    }
                  }}
                  className={[
                    'rounded-md border px-3 py-1.5 text-[11.5px] font-medium transition disabled:opacity-50',
                    'border-rose-400/40 bg-rose-500/12 text-rose-200 hover:bg-rose-500/20 hover:text-rose-100',
                    'dark:border-rose-500/35 dark:bg-rose-500/14 dark:text-rose-700 dark:hover:bg-rose-500/22',
                  ].join(' ')}
                >
                  {clearingHistory ? 'Clearing…' : 'Clear all'}
                </button>
              </div>
            </div>
          </Section>

          {/* WORKSPACE */}
          <Section title="Workspace" subtitle="Where AICursor suggests saving documents.">
            <div className="flex gap-2">
              <div
                className={[
                  'flex-1 truncate rounded-lg border px-3 py-2 text-[12.5px]',
                  'border-white/12 bg-black/30 text-white/85',
                  'dark:border-neutral-900/15 dark:bg-neutral-900/4 dark:text-neutral-900/85',
                ].join(' ')}
              >
                {workspace || 'Not set'}
              </div>
              <button
                type="button"
                onClick={() => void pickWorkspace()}
                className={[
                  'rounded-lg border px-3 text-[12px] font-medium transition',
                  'border-white/14 bg-black/30 text-white/75 hover:text-white',
                  'dark:border-neutral-900/18 dark:bg-neutral-900/4 dark:text-neutral-900/75 dark:hover:text-neutral-900',
                ].join(' ')}
              >
                Change…
              </button>
            </div>
            <p className="mt-1.5 text-[11px] text-white/50 dark:text-neutral-900/50">
              Folder is created on first save. Default Save format: HTML (A4-styled, prints to PDF).
            </p>
          </Section>

          <Section
            title="Profile"
            subtitle="Optional. Used to personalize replies when the toggle below is on. Stays on this machine unless personalization is enabled."
          >
            <div className="mb-3">
              <ToggleRow
                label="Personalize prompts"
                hint="When on, your name, role, and preferred language are added to every prompt and sent to your AI provider. Off by default for privacy."
                checked={personalizePrompts}
                onChange={setPersonalizePrompts}
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[10.5px] font-semibold uppercase tracking-wider text-white/55 dark:text-neutral-900/55">
                  Name
                </span>
                <input
                  type="text"
                  value={userProfile.name}
                  onChange={(e) => setUserProfile((p) => ({ ...p, name: e.target.value }))}
                  placeholder="Mario"
                  className={[
                    'rounded-md border px-2.5 py-1.5 text-[12.5px] outline-none transition',
                    'border-white/14 bg-black/40 text-white placeholder:text-white/30 focus:border-accent/60',
                    'dark:border-neutral-900/18 dark:bg-neutral-900/5 dark:text-neutral-900 dark:placeholder:text-neutral-900/35 dark:focus:border-accent',
                  ].join(' ')}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10.5px] font-semibold uppercase tracking-wider text-white/55 dark:text-neutral-900/55">
                  Role
                </span>
                <input
                  type="text"
                  value={userProfile.role}
                  onChange={(e) => setUserProfile((p) => ({ ...p, role: e.target.value }))}
                  placeholder="solo founder"
                  className={[
                    'rounded-md border px-2.5 py-1.5 text-[12.5px] outline-none transition',
                    'border-white/14 bg-black/40 text-white placeholder:text-white/30 focus:border-accent/60',
                    'dark:border-neutral-900/18 dark:bg-neutral-900/5 dark:text-neutral-900 dark:placeholder:text-neutral-900/35 dark:focus:border-accent',
                  ].join(' ')}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10.5px] font-semibold uppercase tracking-wider text-white/55 dark:text-neutral-900/55">
                  Reply language
                </span>
                <input
                  type="text"
                  value={userProfile.preferredLanguage}
                  onChange={(e) =>
                    setUserProfile((p) => ({ ...p, preferredLanguage: e.target.value }))
                  }
                  placeholder="English"
                  className={[
                    'rounded-md border px-2.5 py-1.5 text-[12.5px] outline-none transition',
                    'border-white/14 bg-black/40 text-white placeholder:text-white/30 focus:border-accent/60',
                    'dark:border-neutral-900/18 dark:bg-neutral-900/5 dark:text-neutral-900 dark:placeholder:text-neutral-900/35 dark:focus:border-accent',
                  ].join(' ')}
                />
              </label>
            </div>
          </Section>

          <Section title="Input" subtitle="Trigger key and voice transcription language.">
            <div className="flex flex-col gap-3">
              <div
                className={[
                  'rounded-lg border px-3 py-2.5',
                  'border-white/8 bg-white/3',
                  'dark:border-neutral-900/10 dark:bg-neutral-900/3',
                ].join(' ')}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] font-medium text-white dark:text-neutral-900">
                      Trigger hotkey
                    </div>
                    <div className="mt-0.5 text-[11px] text-white/55 dark:text-neutral-900/60">
                      Hold for 200ms anywhere on your system to invoke AICursor over what your cursor is on.
                    </div>
                  </div>
                  <SelectField
                    value={triggerHotkey}
                    options={TRIGGER_HOTKEYS}
                    onChange={(v) => setTriggerHotkey(v as TriggerHotkey)}
                  />
                </div>
              </div>

              <div
                className={[
                  'rounded-lg border px-3 py-2.5',
                  'border-white/8 bg-white/3',
                  'dark:border-neutral-900/10 dark:bg-neutral-900/3',
                ].join(' ')}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] font-medium text-white dark:text-neutral-900">
                      Voice transcription language
                    </div>
                    <div className="mt-0.5 text-[11px] text-white/55 dark:text-neutral-900/60">
                      Auto-detect figures out the spoken language each time. Pick a specific language for more accurate short clips.
                    </div>
                  </div>
                  <SelectField
                    value={voiceLanguage}
                    options={VOICE_LANGUAGES}
                    onChange={setVoiceLanguage}
                  />
                </div>
              </div>
            </div>
          </Section>

          {/* CAPABILITIES */}
          <Section title="Capabilities" subtitle="Everything active in this build.">
            <ul className="grid grid-cols-2 gap-2">
              {CAPABILITIES.map((c) => (
                <li
                  key={c.name}
                  className={[
                    'rounded-lg border px-3 py-2.5',
                    'border-accent/25 bg-accent/8',
                    'dark:border-accent/35 dark:bg-accent/8',
                  ].join(' ')}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[12.5px] font-medium text-white dark:text-neutral-900">
                      {c.name}
                    </span>
                    <span className="shrink-0 rounded-full bg-accent/25 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider text-accent">
                      active
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] leading-snug text-white/60 dark:text-neutral-900/60">
                    {c.description}
                  </p>
                </li>
              ))}
            </ul>
          </Section>

          <Section
            title="Updates"
            subtitle="AICursor can check aipointer.app/updates/latest.json for new versions. Manual checks via the tray menu work regardless of this setting."
          >
            <ToggleRow
              label="Auto-check for updates"
              hint="Checks 30 seconds after launch and then once a day while the app is running. The update file contains a version string, a download link, and a SHA-512 hash. No user data is sent."
              checked={autoCheckUpdates}
              onChange={setAutoCheckUpdates}
            />
          </Section>

          {/* PROJECT ABOUT */}
          <Section title="About AICursor" subtitle="Our project team">
            <div className="space-y-4">
              <div className="rounded-lg border border-white/8 bg-white/3 p-3.5 dark:border-neutral-900/10 dark:bg-neutral-900/3">
                <p className="text-[11.5px] leading-relaxed text-white/70 dark:text-neutral-900/70">
                  AICursor is an AI-powered cursor companion designed to help you understand and
                  interact with the content around your cursor.
                </p>
                <p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-accent">
                  Project team
                </p>
                <ul className="mt-2 grid grid-cols-1 gap-1 text-[12px] text-white/80 dark:text-neutral-900/80 sm:grid-cols-2">
                  <li>Omar Abdullah K A</li>
                  <li>Pranav Jayan</li>
                  <li>Varunsankar J</li>
                  <li>Zeba Saithalavi</li>
                </ul>
              </div>

              <div
                className={[
                  'rounded-lg border p-3.5',
                  'border-white/8 bg-white/3',
                  'dark:border-neutral-900/10 dark:bg-neutral-900/3',
                ].join(' ')}
              >
                <p className="text-[11.5px] leading-relaxed text-white/60 dark:text-neutral-900/65">
                  <span className="font-semibold text-white/85 dark:text-neutral-900">Privacy.</span>{' '}
                  AICursor collects nothing. There is no telemetry, no analytics, no tracking.
                  AICursor does not send any data to aipointer.app servers (the only contact with
                  that domain is the optional update check, which fetches a small JSON manifest and
                  carries no user data).
                </p>
                <p className="mt-2 text-[11.5px] leading-relaxed text-white/60 dark:text-neutral-900/65">
                  When you use AI features, the following data is sent to your chosen AI provider
                  (OpenRouter, Anthropic, OpenAI, Google Gemini, or DeepSeek), and only to that provider:
                  your typed or spoken prompt, a screenshot of the area around your cursor, the
                  current clipboard contents if used as context, voice recordings if you use voice
                  input (for transcription), text you ask AICursor to read aloud if you use TTS,
                  and your name, role, and language only if "Personalize prompts" is enabled in
                  the Profile section above.
                </p>
                <p className="mt-2 text-[11.5px] leading-relaxed text-white/60 dark:text-neutral-900/65">
                  Each provider has its own privacy policy. AICursor cannot guarantee how a
                  provider handles your data once it leaves your device. Choose your provider
                  accordingly. Tool actions (web search, page fetch, document save, open URL, copy
                  to clipboard, reveal in Finder) run locally on your machine under your system
                  permissions and require your explicit approval. AICursor is open-source under
                  the MIT license. You are responsible for the queries you make, the costs
                  incurred on your provider account, and any actions you authorise. Provided
                  as-is, without warranty.
                </p>
                <p className="mt-2 text-[11.5px] leading-relaxed">
                  <button
                    type="button"
                    onClick={() => void ipc.openExternal('https://aipointer.app/privacy')}
                    className="text-accent transition hover:text-accent/80"
                  >
                    Privacy Policy ↗
                  </button>
                </p>
              </div>

              <div className="flex items-center justify-between text-[10.5px] text-white/45 dark:text-neutral-900/45">
                <span>AICursor v{version} · MIT · Open source · No telemetry</span>
                <button
                  type="button"
                  onClick={() => void ipc.openExternal('https://skales.app')}
                  className="font-medium tracking-wide transition hover:text-white/75 dark:hover:text-neutral-900/75"
                >
                  Powered by Skales ↗
                </button>
              </div>
            </div>
          </Section>

          <Section title="How to use & FAQ" subtitle="Click a question to expand.">
            <FAQ />
          </Section>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-white/10 px-7 py-4 dark:border-neutral-900/10">
          {error ? (
            <p className="text-[12px] text-rose-300 dark:text-rose-700">{error}</p>
          ) : (
            <p className="text-[11px] text-white/50 dark:text-neutral-900/55">
              Press{' '}
              <kbd className="rounded border border-white/15 px-1 py-0.5 text-[10px] text-white/75 dark:border-neutral-900/20 dark:text-neutral-900/75">
                ESC
              </kbd>{' '}
              to close
            </p>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3 py-2 text-[12.5px] font-medium text-white/75 transition hover:text-white dark:text-neutral-900/75 dark:hover:text-neutral-900"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                // Two modes: dirty → save; clean → just close. The label
                // mirrors which one this click will do, so the user never
                // wonders whether unsaved work is about to be discarded.
                if (isDirty) void onSave();
                else onClose();
              }}
              className="rounded-lg bg-accent px-4 py-2 text-[12.5px] font-semibold text-neutral-900 transition hover:bg-accent/90 disabled:opacity-50"
            >
              {saving ? 'Saving…' : isDirty ? 'Save' : 'Close'}
            </button>
          </div>
        </footer>
      </motion.div>
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-7 last:mb-2">
      <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-white/55 dark:text-neutral-900/60">
        {title}
      </h2>
      {subtitle && (
        <p className="mt-1 text-[11.5px] text-white/50 dark:text-neutral-900/55">{subtitle}</p>
      )}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={[
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition',
        checked ? 'bg-accent' : 'bg-white/15 dark:bg-neutral-900/15',
      ].join(' ')}
    >
      <span
        className={[
          'absolute inline-block h-4 w-4 transform rounded-full bg-white shadow transition',
          checked ? 'translate-x-[18px]' : 'translate-x-[2px]',
        ].join(' ')}
      />
    </button>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      className={[
        'flex cursor-pointer items-start gap-3 select-none rounded-lg border px-3 py-2.5 transition',
        'border-white/8 bg-white/3 hover:bg-white/6',
        'dark:border-neutral-900/10 dark:bg-neutral-900/3 dark:hover:bg-neutral-900/6',
      ].join(' ')}
    >
      <Toggle checked={checked} onChange={onChange} />
      <span className="flex flex-col">
        <span className="text-[12.5px] font-medium text-white dark:text-neutral-900">{label}</span>
        <span className="mt-0.5 text-[11px] text-white/55 dark:text-neutral-900/60">{hint}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only"
      />
    </label>
  );
}

function SelectField<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className={[
        'shrink-0 rounded-md border bg-black/40 px-2 py-1.5 text-[12px] outline-none transition',
        'border-white/14 text-white focus:border-accent/60',
        'dark:border-neutral-900/18 dark:bg-neutral-900/5 dark:text-neutral-900 dark:focus:border-accent',
      ].join(' ')}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} className="bg-neutral-900 text-white dark:bg-white dark:text-neutral-900">
          {o.label}
        </option>
      ))}
    </select>
  );
}

function Cap({ label, on }: { label: string; on: boolean }) {
  return (
    <span
      className={[
        'rounded px-1 py-0.5 text-[9.5px] font-medium uppercase tracking-wider',
        on
          ? 'bg-accent/15 text-accent'
          : 'bg-white/8 text-white/40 line-through dark:bg-neutral-900/8 dark:text-neutral-900/40',
      ].join(' ')}
    >
      {label}
    </span>
  );
}

type TestStateUnion =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'ok'; label?: string }
  | { status: 'err'; error: string };

// Renders the row underneath a provider's API-key input that tells the user
// whether the key is valid + (for OpenRouter) how much credit is left.
// Hidden when the key was edited since the last test — a stale result for a
// different key would be misleading.
function TestResultLine({
  state,
  testedKey,
  currentKey,
}: {
  state: TestStateUnion;
  testedKey: string;
  currentKey: string;
}) {
  if (state.status === 'idle') return null;
  if (state.status !== 'testing' && testedKey !== currentKey) return null;

  let icon = '';
  let body = '';
  let tone = '';
  if (state.status === 'testing') {
    icon = '·';
    body = 'Checking key…';
    tone = 'text-white/55 dark:text-neutral-900/55';
  } else if (state.status === 'ok') {
    icon = '✓';
    body = state.label && state.label !== 'connected' ? state.label : 'Key valid';
    tone = 'text-accent';
  } else {
    icon = '✕';
    body = state.error;
    tone = 'text-red-300 dark:text-red-500';
  }

  return (
    <div className={['mt-2 flex items-center gap-1.5 text-[11px] font-medium', tone].join(' ')}>
      <span className="font-bold">{icon}</span>
      <span className="truncate">{body}</span>
    </div>
  );
}
