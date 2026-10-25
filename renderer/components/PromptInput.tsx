// AiCursor standalone project file.
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useDragControls } from 'framer-motion';
import {
  COMMANDS,
  HELP_TEXT,
  isTemplateCommand,
  matchCommands,
  parseCommand,
  type Command,
  type CommandId,
} from '../lib/commands';
import { LinkCard } from './LinkCard';
import { Markdown } from './Markdown';
import { ToolActivity } from './ToolActivity';
import { ToolApproval } from './ToolApproval';
import { useLinkMetas } from '../hooks/useLinkMetas';
import { useVoiceInput } from '../hooks/useVoiceInput';
import { useTTS } from '../hooks/useTTS';
import type { ToolActivityRow } from '../hooks/useLLMQuery';
import type { TemplateId, ToolApprovalRequest } from '../../electron/types';
import { ipc } from '../lib/ipc';

const BOX_WIDTH = 460;
const DROPDOWN_MAX_VISIBLE = 4;

type Props = {
  x: number;
  y: number;
  loading: boolean;
  streaming: boolean;
  response: string;
  error: string | null;
  webOnDefault: boolean;
  // When true, the box auto-starts the microphone on mount, auto-submits the
  // transcript, reads the answer back via TTS, and re-opens the mic for a
  // follow-up. Hands-free voice loop. ESC always breaks out.
  audioMode: boolean;
  lastPrompt: string;
  lastWasWeb: boolean;
  activities: ToolActivityRow[];
  approvals: ToolApprovalRequest[];
  clipboardPreview: string | null;
  clipboardLength: number;
  onApprove: (id: string, approved: boolean) => void;
  onDismissClipboard: () => void;
  onSubmit: (text: string, options?: { web?: boolean; templateId?: TemplateId }) => void;
  onCommand: (id: CommandId, args: string) => void;
  onCancel: () => void;
};

export const PromptInput = forwardRef<HTMLDivElement, Props>(function PromptInput(
  {
    x,
    y,
    loading,
    streaming,
    response,
    error,
    webOnDefault,
    audioMode,
    lastPrompt,
    lastWasWeb,
    activities,
    approvals,
    clipboardPreview,
    clipboardLength,
    onApprove,
    onDismissClipboard,
    onSubmit,
    onCommand,
    onCancel,
  },
  forwardedRef,
) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const voice = useVoiceInput();
  const tts = useTTS();
  const dragControls = useDragControls();

  // Conversation loop state. Tracks where we are in the audio-mode cycle so
  // we don't double-arm the mic or speak twice. A single ref also lets us
  // gate the "voice transcript arrives → auto-submit" callback on whether
  // we still want it (the user can ESC out mid-cycle).
  const audioActiveRef = useRef(audioMode);
  useEffect(() => {
    audioActiveRef.current = audioMode;
  }, [audioMode]);
  // Snapshot of streaming so we can detect the streaming=true → streaming=false
  // transition (= LLM finished this turn).
  const prevStreamingRef = useRef(false);
  // Once we've spoken a given response we mark it consumed so re-renders don't
  // restart TTS for the same text.
  const spokenResponseRef = useRef<string>('');
  // Once we've spoken THIS turn we want to re-arm the mic exactly once after
  // playback ends; this ref tracks that promise so we don't loop on idle.
  const armNextRef = useRef(false);

  // On macOS the overlay window can be visually on top but not the system
  // "key window" yet at the moment React mounts the input — a single
  // setTimeout focus call then silently fails and the user lands in the box
  // with no caret. We retry at staggered intervals so AT LEAST ONE of them
  // lands after the window has become the key window. Cancelled if the user
  // clicks somewhere else before focus actually takes (focus() on an already
  // focused input is a no-op).
  useEffect(() => {
    const timers: number[] = [];
    const tryFocus = () => inputRef.current?.focus();
    for (const delay of [30, 100, 220, 400]) {
      timers.push(window.setTimeout(tryFocus, delay));
    }
    // Also focus when the window itself gains focus — covers the case where
    // macOS hands us key-window status later than 400ms (slow display wake).
    const onWindowFocus = () => tryFocus();
    window.addEventListener('focus', onWindowFocus);
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      window.removeEventListener('focus', onWindowFocus);
    };
  }, []);

  // A successful drag-rectangle screenshot has just been written into the
  // pending-screenshot slot. The user's mouse was busy drawing the rect, so
  // the input lost focus. Pull it back so the next keystroke immediately
  // lands in the prompt and they don't have to mouse over to it.
  useEffect(() => {
    return window.aipointer.onSelectionDone((result) => {
      if (result.ok) {
        // A small delay lets the toast / feedback render first, then we steal
        // focus back. Without the delay the focus call sometimes lands before
        // the pointer-capture release in App.tsx, and macOS ignores it.
        window.setTimeout(() => inputRef.current?.focus(), 40);
      }
    });
  }, []);

  const completions = useMemo(() => matchCommands(value), [value]);
  const showCompletions = completions.length > 0;

  useEffect(() => {
    if (highlight >= completions.length) setHighlight(0);
  }, [completions, highlight]);

  // Keep the highlighted item scrolled into view inside the dropdown.
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const item = list.children[highlight] as HTMLElement | undefined;
    if (item) item.scrollIntoView({ block: 'nearest' });
  }, [highlight]);

  const hasResponse = response.length > 0;
  const busy = loading || streaming;
  const showExpanded =
    busy || hasResponse || error !== null || activities.length > 0 || approvals.length > 0;

  const { metas, reset: resetMetas } = useLinkMetas(response, !busy && !error && hasResponse);
  useEffect(() => {
    if (!hasResponse) resetMetas();
  }, [hasResponse, resetMetas]);

  const linkList = useMemo(() => Object.values(metas), [metas]);

  const copy = async () => {
    if (!response) return;
    try {
      await navigator.clipboard.writeText(response);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  const save = async () => {
    if (!response || saving) return;
    setSaving(true);
    setSavedPath(null);
    try {
      const result = await ipc.saveResponse({
        prompt: lastPrompt || 'AICursor response',
        markdown: response,
        web: lastWasWeb,
      });
      if (result.ok) {
        setSavedPath(result.path);
        window.setTimeout(() => setSavedPath(null), 2500);
      }
    } finally {
      setSaving(false);
    }
  };

  const insertCompletion = (cmd: Command) => {
    setValue(cmd.name + (cmd.argsHint ? ' ' : ''));
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const executeCommandImmediate = (cmd: Command) => {
    if (cmd.argsHint) {
      insertCompletion(cmd);
      return;
    }
    onCommand(cmd.id, '');
    setValue('');
  };

  const handleEnter = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    const parsed = parseCommand(trimmed);
    if (parsed) {
      const { command, args } = parsed;
      if (command.id === 'web') {
        const q = args.trim();
        if (!q) {
          setValue(command.name + ' ');
          return;
        }
        setValue('');
        onSubmit(q, { web: true });
        return;
      }
      if (isTemplateCommand(command.id)) {
        const q = args.trim();
        if (!q) {
          setValue(command.name + ' ');
          return;
        }
        setValue('');
        onSubmit(q, { templateId: command.id });
        return;
      }
      onCommand(command.id, args);
      setValue('');
      return;
    }
    setValue('');
    onSubmit(trimmed, { web: webOnDefault });
  };

  // Use a ref so the auto-start effect doesn't have to depend on `value`,
  // `webOnDefault`, etc. — otherwise it would re-fire on every keystroke.
  const submitRef = useRef(onSubmit);
  useEffect(() => {
    submitRef.current = onSubmit;
  }, [onSubmit]);
  const webOnDefaultRef = useRef(webOnDefault);
  useEffect(() => {
    webOnDefaultRef.current = webOnDefault;
  }, [webOnDefault]);

  // Manual voice toggle (microphone icon in the prompt). In audio mode the
  // transcript is submitted automatically; in normal mode it appends to the
  // input field for the user to review and press Enter.
  const handleVoiceTranscript = useCallback(
    (transcript: string) => {
      const text = transcript.trim();
      if (!text) return;
      if (audioActiveRef.current) {
        setValue('');
        submitRef.current(text, { web: webOnDefaultRef.current });
      } else {
        setValue((v) => (v ? v + ' ' + text : text));
        window.setTimeout(() => inputRef.current?.focus(), 0);
      }
    },
    [],
  );

  const toggleVoice = () => {
    if (voice.state === 'recording') {
      voice.stop();
    } else if (voice.state === 'idle' || voice.state === 'error') {
      void voice.start(handleVoiceTranscript);
    }
  };

  // --- AUDIO-MODE CONVERSATION LOOP -----------------------------------------
  // Phase 1: on mount, if audio mode is on, start the mic so the user can
  // speak immediately.
  useEffect(() => {
    if (!audioMode) return;
    void voice.start(handleVoiceTranscript);
    return () => {
      voice.stop();
      tts.stop();
      armNextRef.current = false;
    };
    // We only want this to run once per box-mount. Future re-arms come from
    // the TTS-finish effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Phase 2: when the LLM finishes streaming an answer, speak it aloud
  // (audio mode only). One TTS per response — guarded by spokenResponseRef.
  useEffect(() => {
    const wasStreaming = prevStreamingRef.current;
    prevStreamingRef.current = streaming;
    if (!audioMode) return;
    if (!wasStreaming || streaming) return;
    if (!response || response === spokenResponseRef.current) return;
    if (error) return;
    spokenResponseRef.current = response;
    armNextRef.current = true;
    void tts.speak(response);
  }, [streaming, response, error, audioMode, tts]);

  // Phase 3: when TTS playback finishes, re-open the mic for the user's next
  // turn. Only re-arm once per response (armNextRef), and only if the box is
  // still open and we're still in audio mode.
  const ttsPrevStateRef = useRef(tts.state);
  useEffect(() => {
    const prev = ttsPrevStateRef.current;
    ttsPrevStateRef.current = tts.state;
    if (!audioMode) return;
    if (!armNextRef.current) return;
    // Transition: playing → idle  OR  loading → error/idle without playback.
    // We accept any path back to idle, since that means "TTS work is done".
    if (prev !== 'idle' && tts.state === 'idle') {
      armNextRef.current = false;
      if (voice.state === 'idle' || voice.state === 'error') {
        void voice.start(handleVoiceTranscript);
      }
    }
  }, [tts.state, audioMode, voice, handleVoiceTranscript]);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96, x, y }}
      animate={{ opacity: 1, scale: 1, x, y }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{
        type: 'spring',
        damping: 28,
        stiffness: 360,
        mass: 0.65,
        opacity: { duration: 0.15 },
        scale: { duration: 0.15 },
      }}
      style={{ width: BOX_WIDTH, position: 'absolute', left: 0, top: 0 }}
      className="pointer-events-auto"
    >
      <motion.div
        // forwardedRef goes on the INNER (draggable) motion.div, not the
        // outer (anchor) one. After the user drags, only the inner element
        // gets a CSS transform — the outer stays at the entry-anchor
        // position. Hit-testing in App.tsx uses getBoundingClientRect() to
        // decide whether the cursor is over the box; if the ref pointed to
        // the outer, the bounds would still report the original anchor
        // position after every drag, hover would test false, the overlay
        // would flip to click-through, and the user couldn't click the
        // input or initiate a second drag. Putting the ref on the inner
        // (transformed) element makes the bounds follow the visible box.
        ref={forwardedRef}
        // `layout="position"` instead of `layout`. The plain `layout` prop
        // told Framer to spring-animate every size change too — every time
        // the clipboard chip mounted/unmounted, the response area grew, or a
        // tool activity appeared, the entire box squashed and expanded with a
        // bouncy spring. Combined with the 400ms clipboard poll surfacing the
        // chip on a slight delay, that produced a constant vertical "pumping"
        // the user perceived as flicker. `position` keeps the smooth slide
        // when the box is repositioned, but lets size changes apply instantly
        // without animation.
        layout="position"
        drag
        dragListener={false}
        dragControls={dragControls}
        dragMomentum={false}
        dragElastic={0}
        // Free drag anywhere within the overlay window. Very large bounds so
        // the user can pull the box across the whole screen without snapping.
        // Multi-monitor: each display has its own overlay window, dragging
        // beyond a screen edge is clamped by the OS window bounds.
        dragConstraints={{ left: -window.innerWidth, right: window.innerWidth, top: -window.innerHeight, bottom: window.innerHeight }}
        transition={{ layout: { type: 'spring', damping: 32, stiffness: 340, mass: 0.75 } }}
        className={[
          'overflow-hidden rounded-2xl border shadow-glass',
          'border-white/14 bg-neutral-900',
          'dark:border-neutral-900/15 dark:bg-white',
        ].join(' ')}
      >
        {/* Drag handle — grip indicator at the top edge. Click+drag here (or
            any other empty area of the box) repositions the panel so the user
            can pull it out of a screen corner. */}
        <div
          onPointerDown={(e) => dragControls.start(e)}
          className="group flex cursor-grab justify-center pt-1.5 active:cursor-grabbing"
          title="Drag to move"
        >
          <span className="block h-[3px] w-9 rounded-full bg-white/15 transition-colors group-hover:bg-white/30 dark:bg-neutral-900/15 dark:group-hover:bg-neutral-900/30" />
        </div>

        {audioMode && (
          <ConversationPhasePill
            voiceState={voice.state}
            voiceLevel={voice.level}
            busy={busy}
            ttsState={tts.state}
            hasResponse={hasResponse}
          />
        )}

        <AnimatePresence initial={false}>
          {clipboardPreview && !busy && (
            <motion.div
              key="clipboard-chip"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{
                height: { type: 'spring', damping: 30, stiffness: 380 },
                opacity: { duration: 0.15 },
              }}
              className="overflow-hidden"
            >
              <div className="flex items-stretch gap-2 px-4 pt-3">
                <div
                  className={[
                    // `w-full` makes the chip span the full row width so the
                    // X button always sits at the right edge regardless of
                    // text length. `min-w-0` on the row plus `flex-1 min-w-0`
                    // on the text span lets `truncate` actually engage —
                    // without min-w-0 a flex child won't shrink below its
                    // intrinsic content width and ellipsis never appears.
                    'flex w-full min-w-0 items-center gap-1.5 rounded-md border px-2 py-1 text-[11px]',
                    'border-accent/30 bg-accent/12 text-white/85',
                    'dark:border-accent/45 dark:bg-accent/18 dark:text-neutral-900/85',
                  ].join(' ')}
                >
                  <span className="flex h-3 w-3 shrink-0 items-center justify-center text-accent">
                    <svg viewBox="0 0 12 12" fill="none" className="h-2.5 w-2.5">
                      <path
                        d="M3 1.5h4.5l2 2v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Z"
                        stroke="currentColor"
                        strokeWidth="1"
                      />
                      <path d="M7 1.5v2h2" stroke="currentColor" strokeWidth="1" />
                    </svg>
                  </span>
                  <span
                    className="min-w-0 flex-1 truncate font-medium opacity-95"
                    title={clipboardPreview}
                  >
                    {clipboardPreview}
                  </span>
                  <span className="shrink-0 opacity-50">{formatLen(clipboardLength)}</span>
                  <button
                    type="button"
                    onClick={onDismissClipboard}
                    aria-label="Don't include clipboard"
                    className={[
                      'ml-0.5 -mr-0.5 shrink-0 rounded p-0.5 leading-none transition',
                      'text-white/55 hover:bg-white/10 hover:text-white',
                      'dark:text-neutral-900/55 dark:hover:bg-neutral-900/10 dark:hover:text-neutral-900',
                    ].join(' ')}
                  >
                    <svg viewBox="0 0 10 10" fill="none" className="h-2.5 w-2.5">
                      <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <motion.div
          layout="position"
          className="flex items-center gap-3 px-4 py-3"
          onPointerDown={(e) => {
            // Allow drag-init unless the user pressed on an actual interactive
            // child (input / button / kbd). This keeps the box "drag from
            // anywhere empty" while preserving normal focus behaviour.
            const target = e.target as HTMLElement;
            if (!target.closest('input, button, a, kbd, [data-no-drag]')) {
              dragControls.start(e);
            }
          }}
        >
          <span
            className={[
              'inline-block h-2 w-2 shrink-0 rounded-full transition-all duration-200',
              busy ? 'bg-accent animate-pulse shadow-halo' : 'bg-accent/85',
            ].join(' ')}
          />
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={busy}
            placeholder={
              voice.state === 'recording'
                ? 'Listening…'
                : voice.state === 'transcribing'
                  ? 'Transcribing…'
                  : webOnDefault
                    ? 'Ask anything · web on · / for commands'
                    : 'Ask about what you see · / for commands'
            }
            spellCheck={false}
            onKeyDown={(e) => {
              if (showCompletions) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setHighlight((h) => (h + 1) % completions.length);
                  return;
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setHighlight((h) => (h - 1 + completions.length) % completions.length);
                  return;
                }
                if (e.key === 'Tab') {
                  e.preventDefault();
                  insertCompletion(completions[highlight]);
                  return;
                }
              }
              if (e.key === 'Enter') {
                e.preventDefault();
                const exact = parseCommand(value.trim());
                if (exact) {
                  handleEnter();
                  return;
                }
                if (showCompletions && completions.length > 0 && /^\/\w*$/.test(value)) {
                  executeCommandImmediate(completions[highlight]);
                  return;
                }
                handleEnter();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onCancel();
              }
            }}
            className={[
              'flex-1 bg-transparent text-[13px] outline-none disabled:opacity-60',
              'text-white placeholder:text-[12px] placeholder:text-white/42',
              'dark:text-neutral-900 dark:placeholder:text-neutral-900/45',
            ].join(' ')}
          />
          <button
            type="button"
            onClick={toggleVoice}
            disabled={busy || voice.state === 'transcribing'}
            aria-label={voice.state === 'recording' ? 'Stop recording' : 'Voice input'}
            className={[
              'relative shrink-0 rounded-md border p-1 transition',
              voice.state === 'recording'
                ? 'border-rose-400/45 bg-rose-500/15 text-rose-300 dark:text-rose-600'
                : 'border-white/12 text-white/55 hover:bg-white/8 hover:text-white dark:border-neutral-900/15 dark:text-neutral-900/55 dark:hover:bg-neutral-900/8 dark:hover:text-neutral-900',
            ].join(' ')}
          >
            {voice.state === 'recording' && (
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 rounded-md ring-1 ring-rose-400/60 transition-opacity"
                style={{ opacity: 0.25 + voice.level * 0.75 }}
              />
            )}
            {voice.state === 'transcribing' ? (
              <span className="block h-3 w-3 animate-spin rounded-full border-[1.5px] border-accent border-t-transparent" />
            ) : voice.state === 'recording' ? (
              <svg viewBox="0 0 14 14" fill="currentColor" className="h-3 w-3">
                <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
              </svg>
            ) : (
              <svg viewBox="0 0 14 14" fill="none" className="h-3 w-3">
                <rect
                  x="5"
                  y="1.5"
                  width="4"
                  height="7"
                  rx="2"
                  stroke="currentColor"
                  strokeWidth="1.3"
                />
                <path
                  d="M3 7c0 2.2 1.8 4 4 4s4-1.8 4-4M7 11v1.5"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                />
              </svg>
            )}
          </button>
          {busy ? (
            <button
              type="button"
              onClick={onCancel}
              aria-label="Stop"
              title="Stop (Esc)"
              className="group relative inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-rose-400/45 bg-rose-500/15 text-rose-300 transition hover:bg-rose-500/30 hover:text-rose-200 dark:text-rose-600 dark:hover:text-rose-500"
            >
              <span
                aria-hidden
                className="absolute -inset-[1px] rounded-md ring-1 ring-rose-400/40 opacity-60 transition-opacity group-hover:opacity-100"
              />
              <svg viewBox="0 0 14 14" className="h-3 w-3" fill="none">
                <path
                  d="M3 3l8 8M11 3l-8 8"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          ) : (
            <kbd
              className={[
                'shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium',
                'border-white/14 text-white/55',
                'dark:border-neutral-900/18 dark:text-neutral-900/60',
              ].join(' ')}
            >
              ↵
            </kbd>
          )}
        </motion.div>

        <AnimatePresence initial={false}>
          {showCompletions && !busy && (
            <motion.div
              key="completions"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ height: { type: 'spring', damping: 30, stiffness: 380 }, opacity: { duration: 0.12 } }}
              className="overflow-hidden"
            >
              <ul
                ref={listRef}
                className={[
                  'border-t px-1 py-1',
                  'border-white/8',
                  'dark:border-neutral-900/10',
                ].join(' ')}
                style={{
                  maxHeight: `${DROPDOWN_MAX_VISIBLE * 32 + 8}px`,
                  overflowY: 'auto',
                  scrollbarWidth: 'thin',
                }}
              >
                {completions.map((c, i) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onMouseEnter={() => setHighlight(i)}
                      onClick={() => executeCommandImmediate(c)}
                      className={[
                        'flex w-full items-center justify-between gap-3 rounded-md px-3 py-1.5 text-left text-[12.5px] transition',
                        i === highlight
                          ? 'bg-accent/18 text-white dark:bg-accent/22 dark:text-neutral-900'
                          : 'text-white/82 hover:bg-white/8 dark:text-neutral-900/82 dark:hover:bg-neutral-900/8',
                      ].join(' ')}
                    >
                      <span className="flex items-baseline gap-2 truncate">
                        <span
                          className={[
                            'font-medium',
                            i === highlight
                              ? 'text-white dark:text-neutral-900'
                              : 'text-white/95 dark:text-neutral-900/90',
                          ].join(' ')}
                        >
                          {c.name}
                        </span>
                        {c.argsHint && (
                          <span
                            className={[
                              i === highlight
                                ? 'text-white/65 dark:text-neutral-900/65'
                                : 'text-white/45 dark:text-neutral-900/55',
                            ].join(' ')}
                          >
                            {c.argsHint}
                          </span>
                        )}
                      </span>
                      <span
                        className={[
                          'truncate text-[11px]',
                          i === highlight
                            ? 'text-white/75 dark:text-neutral-900/70'
                            : 'text-white/55 dark:text-neutral-900/55',
                        ].join(' ')}
                      >
                        {c.description}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence initial={false}>
          {showExpanded && !showCompletions && (
            <motion.section
              key="expanded"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{
                height: { type: 'spring', damping: 30, stiffness: 320, mass: 0.7 },
                opacity: { duration: 0.18 },
              }}
              className="overflow-hidden"
            >
              <div
                className={[
                  'border-t px-4 py-3',
                  'border-white/8',
                  'dark:border-neutral-900/10',
                ].join(' ')}
              >
                <AnimatePresence initial={false}>
                  {approvals.map((req) => (
                    <ToolApproval key={req.id} request={req} onDecide={onApprove} />
                  ))}
                </AnimatePresence>

                {error ? (
                  <p className="text-sm leading-relaxed text-rose-300 dark:text-rose-700">{error}</p>
                ) : !hasResponse && activities.length === 0 ? (
                  <div className="flex items-center gap-1.5 py-1.5">
                    <TypingDot delay={0} />
                    <TypingDot delay={0.15} />
                    <TypingDot delay={0.3} />
                  </div>
                ) : !hasResponse ? (
                  <div>
                    <ToolActivity activities={activities} />
                    {busy && (
                      <div className="flex items-center gap-1.5 py-1.5">
                        <TypingDot delay={0} />
                        <TypingDot delay={0.15} />
                        <TypingDot delay={0.3} />
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="relative">
                    <div
                      className="max-h-[360px] select-text overflow-y-auto pr-1"
                      style={{ scrollbarWidth: 'thin' }}
                    >
                      <ToolActivity activities={activities} />
                      <Markdown text={response} />
                      {streaming && (
                        <span className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-[2px] bg-accent align-middle motion-safe:animate-pulse" />
                      )}

                      {linkList.length > 0 && (
                        <div className="mt-3 flex flex-col gap-1.5">
                          {linkList.map((m, i) => (
                            <LinkCard key={m.url} meta={m} index={i} />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
              {hasResponse && !busy && !error && (
                <div
                  className={[
                    'flex items-center justify-end gap-1.5 border-t px-3 py-2',
                    'border-white/8 bg-neutral-900',
                    'dark:border-neutral-900/10 dark:bg-white',
                  ].join(' ')}
                >
                  <ActionButton
                    label={
                      tts.state === 'loading'
                        ? 'Loading…'
                        : tts.state === 'playing'
                          ? 'Stop'
                          : 'Read'
                    }
                    ok={tts.state === 'playing'}
                    disabled={tts.state === 'loading'}
                    onClick={() => void tts.speak(response)}
                    icon={
                      tts.state === 'playing' ? (
                        <svg viewBox="0 0 14 14" className="h-3 w-3" fill="currentColor">
                          <rect x="3.5" y="3.5" width="7" height="7" rx="1.2" />
                        </svg>
                      ) : tts.state === 'loading' ? (
                        <span className="block h-3 w-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
                      ) : (
                        <svg viewBox="0 0 14 14" className="h-3 w-3" fill="none">
                          <path
                            d="M2 5.5h2.5l3-2.5v8l-3-2.5H2v-3Z"
                            stroke="currentColor"
                            strokeWidth="1.3"
                            strokeLinejoin="round"
                          />
                          <path
                            d="M9.5 4.5c.9.7 1.5 1.6 1.5 2.5s-.6 1.8-1.5 2.5"
                            stroke="currentColor"
                            strokeWidth="1.3"
                            strokeLinecap="round"
                          />
                        </svg>
                      )
                    }
                  />
                  <ActionButton
                    label={saving ? 'Saving…' : savedPath ? 'Saved' : 'Save'}
                    ok={!!savedPath}
                    disabled={saving}
                    onClick={() => void save()}
                    icon={
                      savedPath ? (
                        <svg viewBox="0 0 14 14" className="h-3 w-3" fill="none">
                          <path
                            d="M2.5 7.2l3 3 6.2-6.4"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 14 14" className="h-3 w-3" fill="none">
                          <path
                            d="M7 1.5v8M3.6 6.1L7 9.5l3.4-3.4M2 12.5h10"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )
                    }
                  />
                  <ActionButton
                    label={copied ? 'Copied' : 'Copy'}
                    onClick={copy}
                    icon={
                      copied ? (
                        <svg viewBox="0 0 14 14" className="h-3 w-3" fill="none">
                          <path
                            d="M2.5 7.2l3 3 6.2-6.4"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 14 14" className="h-3 w-3" fill="none">
                          <rect
                            x="3.5"
                            y="2.5"
                            width="7"
                            height="9"
                            rx="1.2"
                            stroke="currentColor"
                            strokeWidth="1.3"
                          />
                          <path
                            d="M6 1.5h3.5a1.5 1.5 0 0 1 1.5 1.5"
                            stroke="currentColor"
                            strokeWidth="1.3"
                            strokeLinecap="round"
                          />
                        </svg>
                      )
                    }
                  />
                </div>
              )}
            </motion.section>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
});

function TypingDot({ delay }: { delay: number }) {
  return (
    <motion.span
      className="block h-1.5 w-1.5 rounded-full bg-accent/85"
      animate={{ opacity: [0.3, 1, 0.3], scale: [0.85, 1.05, 0.85] }}
      transition={{ duration: 1.0, repeat: Infinity, delay, ease: 'easeInOut' }}
    />
  );
}

function ActionButton({
  label,
  icon,
  onClick,
  disabled,
  ok,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  ok?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={[
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-1 text-[10.5px] font-medium transition disabled:opacity-50',
        ok
          ? 'border-accent/40 bg-accent/15 text-accent hover:bg-accent/25'
          : 'border-white/12 bg-white/8 text-white/82 hover:bg-white/14 hover:text-white dark:border-neutral-900/12 dark:bg-neutral-900/8 dark:text-neutral-900/80 dark:hover:bg-neutral-900/14 dark:hover:text-neutral-900',
      ].join(' ')}
    >
      <span className="flex h-3 w-3 items-center justify-center">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function formatLen(n: number): string {
  if (n < 1000) return `${n} chars`;
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}

// Inline phase indicator rendered just below the drag handle while voice-
// first mode is active. Tells the user at a glance which leg of the loop
// they're in (listening → thinking → speaking → back to listening) without
// them having to look at the input placeholder or guess from the streaming
// text. The dot pulses with the live mic level while listening.
function ConversationPhasePill({
  voiceState,
  voiceLevel,
  busy,
  ttsState,
  hasResponse,
}: {
  voiceState: 'idle' | 'recording' | 'transcribing' | 'error';
  voiceLevel: number;
  busy: boolean;
  ttsState: 'idle' | 'loading' | 'playing' | 'error';
  hasResponse: boolean;
}) {
  let label = 'Ready';
  let dotClass = 'bg-white/40 dark:bg-neutral-900/40';
  let pulse = false;
  if (voiceState === 'recording') {
    label = 'Listening…';
    dotClass = 'bg-accent';
    pulse = true;
  } else if (voiceState === 'transcribing') {
    label = 'Transcribing…';
    dotClass = 'bg-accent/80';
  } else if (busy) {
    label = 'Thinking…';
    dotClass = 'bg-accent/85 animate-pulse';
  } else if (ttsState === 'loading' || ttsState === 'playing') {
    label = 'Speaking…';
    dotClass = 'bg-accent';
    pulse = true;
  } else if (hasResponse) {
    label = 'Done · say a follow-up';
    dotClass = 'bg-accent/60';
  }
  const dotScale = pulse ? 1 + voiceLevel * 0.6 : 1;
  return (
    <div className="flex items-center justify-center gap-1.5 px-3 pt-1 pb-0.5">
      <span
        className={['inline-block h-1.5 w-1.5 rounded-full transition-transform', dotClass].join(' ')}
        style={{ transform: `scale(${dotScale})` }}
      />
      <span className="text-[10.5px] font-medium uppercase tracking-wider text-white/55 dark:text-neutral-900/60">
        {label}
      </span>
    </div>
  );
}

export { HELP_TEXT };
export { COMMANDS };
