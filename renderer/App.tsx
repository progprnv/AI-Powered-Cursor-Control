// AiCursor standalone project file.
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useAIMode } from './hooks/useAIMode';
import { useCursorPosition } from './hooks/useCursorPosition';
import { useSettings } from './hooks/useSettings';
import { useLLMQuery } from './hooks/useLLMQuery';
import { useClipboardContext } from './hooks/useClipboardContext';
import { useToolApprovals } from './hooks/useToolApprovals';
import { CursorHalo } from './components/CursorHalo';
import { PermissionsBanner } from './components/PermissionsBanner';
import { SettingsModal } from './components/SettingsModal';
import { PromptInput } from './components/PromptInput';
import { BottomPill } from './components/BottomPill';
import { Splash } from './components/Splash';
import { SelectionRectangle } from './components/SelectionRectangle';
import { HELP_TEXT, type CommandId } from './lib/commands';
import { computeAnchor } from './lib/positioning';
import { formatHistoryMarkdown } from './hooks/useHistory';
import { ipc } from './lib/ipc';
import type { PermissionsStatus, TemplateId } from '../electron/types';

// DOMRect equality with a 1px tolerance. `getBoundingClientRect` returns a
// fresh object every call, so without this the box-bounds RAF loop fires a
// state update 60× per second even when nothing moved — which made the box
// flicker on hover and flooded the IPC bridge.
function sameRect(a: DOMRect | null, b: DOMRect | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    Math.abs(a.left - b.left) < 1 &&
    Math.abs(a.top - b.top) < 1 &&
    Math.abs(a.right - b.right) < 1 &&
    Math.abs(a.bottom - b.bottom) < 1
  );
}

export function App() {
  const [displayId, setDisplayId] = useState<number | null>(null);
  const [isPrimary, setIsPrimary] = useState(false);
  const [platform, setPlatform] = useState<string>('?');
  const [perms, setPerms] = useState<PermissionsStatus | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [autoShowChecked, setAutoShowChecked] = useState(false);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const [screenSize, setScreenSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [overrideResponse, setOverrideResponse] = useState<string | null>(null);
  const [lastPrompt, setLastPrompt] = useState<string>('');
  const [lastWasWeb, setLastWasWeb] = useState<boolean>(false);
  const [bottomPillBounds, setBottomPillBounds] = useState<DOMRect | null>(null);
  const [bottomPillHovered, setBottomPillHovered] = useState(false);
  const [boxBounds, setBoxBounds] = useState<DOMRect | null>(null);
  const [boxHovered, setBoxHovered] = useState(false);
  const [splashDone, setSplashDone] = useState(false);
  // Drag-screenshot state. Tracks an in-progress rectangle the user is
  // drawing on top of the underlying app. When the drag passes a minimum
  // threshold the rectangle visibly mounts; if the drag stays below that
  // threshold the gesture is treated as a regular backdrop click (dismiss).
  // `selectionFeedback` shows a brief confirmation toast after capture.
  const [selection, setSelection] = useState<
    | { startX: number; startY: number; currX: number; currY: number; pointerId: number; armed: boolean }
    | null
  >(null);
  const [selectionFeedback, setSelectionFeedback] = useState<
    | { kind: 'ok'; rect: { width: number; height: number } }
    | { kind: 'error'; message: string }
    | null
  >(null);
  // True while user is holding the trigger key on top of an already-open
  // box — switches the overlay into "drag a rectangle to screenshot" mode.
  const [selectionMode, setSelectionMode] = useState(false);
  const dismissTimer = useRef<number | null>(null);
  const bottomPillRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const backdropClickTimer = useRef<number | null>(null);
  const backdropClickCount = useRef<number>(0);
  const selectionFeedbackTimer = useRef<number | null>(null);

  const { active } = useAIMode();
  const pos = useCursorPosition();
  const { settings, loading: settingsLoading, save: saveSettings } = useSettings();
  const {
    state: llmState,
    response,
    error: llmError,
    activities,
    submit,
    reset,
  } = useLLMQuery();
  const { ctx: clipboardCtx, dismiss: dismissClipboard } = useClipboardContext();
  const { requests: approvals, decide: decideApproval, clearAll: clearApprovals } =
    useToolApprovals();

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = (isDark: boolean) => {
      document.documentElement.classList.toggle('dark', isDark);
    };
    apply(mq.matches);
    const handler = (e: MediaQueryListEvent) => apply(e.matches);
    mq.addEventListener('change', handler);

    const params = new URLSearchParams(window.location.search);
    const idStr = params.get('displayId');
    setDisplayId(idStr ? parseInt(idStr, 10) : null);
    setIsPrimary(params.get('primary') === '1');
    setPlatform(window.aipointer?.platform ?? '?');

    const onResize = () => setScreenSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);

    return () => {
      mq.removeEventListener('change', handler);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  useEffect(() => {
    const poll = async () => {
      try {
        setPerms(await ipc.getPermissions());
      } catch {
        /* preload not ready */
      }
    };
    poll();
    const t = window.setInterval(poll, 2000);
    return () => window.clearInterval(t);
  }, []);

  const hasAnyProviderKey = useMemo(() => {
    if (!settings) return false;
    return Object.values(settings.providers).some((p) => p.enabled && p.apiKey.trim().length > 0);
  }, [settings]);

  useEffect(() => {
    if (!isPrimary || settingsLoading || autoShowChecked) return;
    // First-run UX: let the splash play to completion before auto-opening
    // Settings. Otherwise the user lands straight inside Settings with an
    // overlay that blocks every other window — they can't even reach a
    // browser to copy their OpenRouter key.
    if (!splashDone) return;
    setAutoShowChecked(true);
    if (!hasAnyProviderKey) setSettingsOpen(true);
  }, [isPrimary, settingsLoading, hasAnyProviderKey, autoShowChecked, splashDone]);

  useEffect(() => {
    const off = ipc.onSettingsOpen(() => {
      console.log('[settings] open IPC received, isPrimary=', isPrimary);
      // Always open on whatever overlay receives this — earlier we restricted
      // it to isPrimary, but if the user is working on a non-primary monitor
      // the panel would silently open on the primary display they can't see
      // and feel like "settings won't open". Settings is global state anyway,
      // the IPC handler in main only fires it on the explicit request paths
      // (tray menu, /settings command), so it's safe to always honor it on
      // whichever overlay's renderer process picked it up first.
      setSettingsOpen(true);
    });
    return off;
  }, [isPrimary]);

  useEffect(() => {
    return window.aipointer.onSelectionArm((armed) => setSelectionMode(armed));
  }, []);

  const onThisDisplay = pos !== null && pos.displayId === displayId;
  const aiActiveHere = active && onThisDisplay;

  useEffect(() => {
    if (aiActiveHere && anchor === null && pos) {
      setAnchor({ x: pos.x, y: pos.y });
    }
    if (!active && anchor !== null) {
      setAnchor(null);
      reset();
      setOverrideResponse(null);
      clearApprovals();
    }
  }, [aiActiveHere, active, anchor, pos, reset, clearApprovals]);

  // Hit-test the bottom pill region. The pill lives inside a click-through
  // overlay, so we use the global cursor position to know when the user is
  // hovering it; while hovering we make the overlay interactive so DOM hover
  // and click work, otherwise we keep click-through to underlying apps.
  useEffect(() => {
    if (active) return;
    let raf = 0;
    const measure = () => {
      const el = bottomPillRef.current;
      if (el) {
        const r = el.getBoundingClientRect();
        setBottomPillBounds((prev) => sameRect(prev, r) ? prev : r);
      }
      raf = window.requestAnimationFrame(measure);
    };
    measure();
    return () => window.cancelAnimationFrame(raf);
  }, [active, isPrimary]);

  useEffect(() => {
    if (!isPrimary) return;
    if (active) {
      if (bottomPillHovered) setBottomPillHovered(false);
      return;
    }
    if (!pos || !bottomPillBounds) return;
    // Add a generous 12px halo so the user doesn't lose hover at the edges.
    const pad = 12;
    const inside =
      pos.x >= bottomPillBounds.left - pad &&
      pos.x <= bottomPillBounds.right + pad &&
      pos.y >= bottomPillBounds.top - pad &&
      pos.y <= bottomPillBounds.bottom + pad;
    if (inside !== bottomPillHovered) setBottomPillHovered(inside);
  }, [pos, bottomPillBounds, bottomPillHovered, active, isPrimary]);

  // While AI mode is active, watch the box bounds so we know when the cursor
  // is over it. Cursor-over-box = interactive overlay (DOM events reach the
  // input/buttons). Cursor outside = click-through so the user can interact
  // with whatever's underneath (highlight text, copy with Cmd+C, etc.).
  //
  // We measure at 60fps but only push a state update when the rect actually
  // changed by ≥1px. Without the dedupe, every frame produced a new DOMRect
  // instance and re-fired every downstream effect — that caused the box to
  // flicker on hover and spammed 60Hz IPC traffic to main.
  useEffect(() => {
    if (!aiActiveHere) {
      setBoxBounds(null);
      return;
    }
    let raf = 0;
    const measure = () => {
      if (boxRef.current) {
        const r = boxRef.current.getBoundingClientRect();
        setBoxBounds((prev) => sameRect(prev, r) ? prev : r);
      }
      raf = window.requestAnimationFrame(measure);
    };
    measure();
    return () => window.cancelAnimationFrame(raf);
  }, [aiActiveHere]);

  useEffect(() => {
    if (!aiActiveHere) {
      if (boxHovered) setBoxHovered(false);
      return;
    }
    if (!pos || !boxBounds) return;
    // Hysteresis: 14px halo to ENTER hover, 80px halo to LEAVE it. Without
    // hysteresis the cursor wobbling 1px back and forth at the edge made
    // `boxHovered` flip every frame, which toggled setIgnoreMouseEvents on
    // and off — macOS repaints the window frame on focus/blur, and the user
    // saw that as the box "flickering" on hover and drag. The wide leave
    // halo also tolerates the natural lag between cursor position (33ms IPC)
    // and box position during a fast drag.
    const pad = boxHovered ? 80 : 14;
    const inside =
      pos.x >= boxBounds.left - pad &&
      pos.x <= boxBounds.right + pad &&
      pos.y >= boxBounds.top - pad &&
      pos.y <= boxBounds.bottom + pad;
    if (inside !== boxHovered) {
      console.log(
        `[flicker] boxHovered flip → ${inside} cursor=(${pos.x},${pos.y}) box=(${Math.round(boxBounds.left)},${Math.round(boxBounds.top)})-(${Math.round(boxBounds.right)},${Math.round(boxBounds.bottom)}) pad=${pad}`,
      );
      setBoxHovered(inside);
    }
  }, [pos, boxBounds, boxHovered, aiActiveHere]);

  const lastInteractive = useRef<boolean | null>(null);
  useEffect(() => {
    // Interactivity rule:
    //  - settings modal open → always interactive (whole screen)
    //  - idle + hovering bottom pill → interactive (small zone)
    //  - AI mode active + cursor over box → interactive (so input / buttons work)
    //  - AI mode active + selection mode armed → interactive (so drag-rect
    //    pointer handlers fire on the backdrop)
    //  - AI mode active + cursor outside box → click-through (underlying apps usable)
    const interactiveDuringAI = aiActiveHere && (boxHovered || selectionMode || selection !== null);
    const next = interactiveDuringAI || settingsOpen || bottomPillHovered;
    if (lastInteractive.current !== next) {
      console.log(
        `[flicker] setInteractive ${lastInteractive.current ?? 'init'} → ${next} aiActive=${aiActiveHere} boxHovered=${boxHovered} selMode=${selectionMode} settingsOpen=${settingsOpen} pillHovered=${bottomPillHovered}`,
      );
      lastInteractive.current = next;
    }
    ipc.setInteractive(next);
  }, [aiActiveHere, boxHovered, selectionMode, selection, settingsOpen, bottomPillHovered]);

  // Tell the main process when Settings opens / closes. While Settings is up
  // the overlay lowers its alwaysOnTop level so the user can Cmd+Tab to a
  // browser (e.g. to copy their OpenRouter API key) without our screen-saver-
  // level window blocking it.
  useEffect(() => {
    window.aipointer?.setOverlaySettingsMode?.(settingsOpen);
  }, [settingsOpen]);

  // Push the box's display-local bounds to main whenever they change so the
  // global uiohook can detect a click that lands outside the box (the overlay
  // is click-through, so the renderer never sees those clicks itself). Sending
  // null clears the bounds (box hidden, or Settings covering it).
  useEffect(() => {
    if (!aiActiveHere || !boxBounds || displayId === null || settingsOpen) {
      window.aipointer?.sendBoxBounds?.(null);
      return;
    }
    window.aipointer?.sendBoxBounds?.({
      left: Math.round(boxBounds.left),
      top: Math.round(boxBounds.top),
      right: Math.round(boxBounds.right),
      bottom: Math.round(boxBounds.bottom),
      displayId,
    });
  }, [aiActiveHere, boxBounds, displayId, settingsOpen]);

  useEffect(() => {
    if (dismissTimer.current !== null) {
      window.clearTimeout(dismissTimer.current);
      dismissTimer.current = null;
    }
    if (llmState === 'done') {
      dismissTimer.current = window.setTimeout(() => {
        void ipc.cancelAIMode();
      }, 30_000);
    }
    return () => {
      if (dismissTimer.current !== null) {
        window.clearTimeout(dismissTimer.current);
        dismissTimer.current = null;
      }
    };
  }, [llmState]);

  const layout = useMemo(() => {
    if (!anchor) return null;
    return computeAnchor(anchor.x, anchor.y, screenSize.w, screenSize.h);
  }, [anchor, screenSize]);

  const needsAccessibility = perms !== null && !perms.accessibility && platform === 'darwin';
  const needsScreenRecording = perms !== null && !perms.screenRecording && platform === 'darwin';
  const showHalo = active && pos !== null && pos.displayId === displayId;
  const webOnDefault = !!settings?.webSearch;

  const handleSubmit = (prompt: string, options?: { web?: boolean; templateId?: TemplateId }) => {
    setOverrideResponse(null);
    setLastPrompt(prompt);
    setLastWasWeb(!!options?.web);
    void submit(prompt, options);
  };

  const handleCommand = (id: CommandId, _args: string) => {
    void _args;
    switch (id) {
      case 'settings':
        setSettingsOpen(true);
        break;
      case 'help':
        reset();
        setOverrideResponse(HELP_TEXT);
        break;
      case 'history':
        reset();
        setOverrideResponse('## Loading sessions…');
        void (async () => {
          try {
            const list = await ipc.listSessions();
            setOverrideResponse(formatHistoryMarkdown(list));
          } catch (e) {
            setOverrideResponse(
              `## History\n\nCould not load sessions: ${e instanceof Error ? e.message : 'unknown error'}.`,
            );
          }
        })();
        break;
      case 'clear':
        reset();
        setOverrideResponse(null);
        break;
      case 'quit':
        window.aipointer?.quit?.();
        break;
      case 'origin':
        // Hidden authorship trap — see docs/AUTHORSHIP.md.
        reset();
        setOverrideResponse(
          `## Provenance

**AICursor** is our collaborative AI cursor assistant.

- Version: **1.0.0**
- Tagged: **2026-05-13**
- Canonical source: [github.com/talentsache/aipointer](https://github.com/talentsache/aipointer)
- Site: [aipointer.app](https://aipointer.app)
- Sibling project (same author): [skales.app](https://skales.app) · [github.com/skalesapp/skales](https://github.com/skalesapp/skales)
- License: **MIT** — see \`LICENSE\` in the repo.

**Provenance string**

\`\`\`
aipointer/v1.0.0/ms/talentsache/skales/20260513
\`\`\`

This command is not listed in \`/help\` or in autocomplete. It exists as a record of authorship — see \`docs/AUTHORSHIP.md\` for the full set of DNA marks.`,
        );
        break;
      case 'web':
      case 'summary':
      case 'brief':
      case 'translate':
      case 'explain':
      case 'code':
      case 'improve':
      case 'define':
      case 'solve':
      case 'reply':
      case 'identify':
        // Handled inline in PromptInput before reaching here.
        break;
    }
  };

  const handleCancel = () => {
    void ipc.cancelAIMode();
  };

  const registerDismissClick = () => {
    // Default behaviour: require a double-click to dismiss, so a single
    // click into the empty area doesn't tear down the box. The user can
    // switch to single-click in Settings → Behaviour.
    const requireDouble = settings?.dismissOnDoubleClick ?? true;
    if (!requireDouble) {
      handleCancel();
      return;
    }
    backdropClickCount.current += 1;
    if (backdropClickCount.current >= 2) {
      backdropClickCount.current = 0;
      if (backdropClickTimer.current !== null) {
        window.clearTimeout(backdropClickTimer.current);
        backdropClickTimer.current = null;
      }
      handleCancel();
      return;
    }
    if (backdropClickTimer.current !== null) {
      window.clearTimeout(backdropClickTimer.current);
    }
    backdropClickTimer.current = window.setTimeout(() => {
      backdropClickCount.current = 0;
      backdropClickTimer.current = null;
    }, 450);
  };

  // Drag-screenshot gesture handlers. Three outcomes possible per pointerdown:
  //   - released within 6px of start  → treated as backdrop click (dismiss)
  //   - drag of ≥6px released         → capture rect screenshot, replace
  //                                      pendingScreenshot, broadcast confirm
  //   - ESC while dragging            → cancel selection cleanly
  //
  // We use pointerCapture so a fast drag that overshoots the overlay window
  // (e.g. flicks to the screen edge) keeps firing pointermove/up at us
  // instead of vanishing into the underlying app halfway through.
  const SELECTION_THRESHOLD_PX = 6;

  const handleBackdropPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || !aiActiveHere) return;
    if (e.button !== 0) return;
    // Two-mode behaviour:
    //  - selectionMode armed (trigger key held) → start a rectangle for
    //    ad-hoc screenshot capture
    //  - otherwise → register a backdrop click toward the dismiss counter
    //    (the uiohook outside-click handler in main does the same thing for
    //    clicks that don't reach this React tree at all)
    if (!selectionMode) {
      registerDismissClick();
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    setSelection({
      startX: e.clientX,
      startY: e.clientY,
      currX: e.clientX,
      currY: e.clientY,
      pointerId: e.pointerId,
      armed: false,
    });
  };

  const handleBackdropPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!selection || e.pointerId !== selection.pointerId) return;
    const dx = e.clientX - selection.startX;
    const dy = e.clientY - selection.startY;
    const armed = selection.armed || Math.abs(dx) >= SELECTION_THRESHOLD_PX || Math.abs(dy) >= SELECTION_THRESHOLD_PX;
    setSelection({
      ...selection,
      currX: e.clientX,
      currY: e.clientY,
      armed,
    });
  };

  const handleBackdropPointerUp = async (e: React.PointerEvent<HTMLDivElement>) => {
    if (!selection || e.pointerId !== selection.pointerId) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* pointer may already be released if cancelled */
    }
    const wasArmed = selection.armed;
    const rect = {
      x: Math.min(selection.startX, selection.currX),
      y: Math.min(selection.startY, selection.currY),
      width: Math.abs(selection.currX - selection.startX),
      height: Math.abs(selection.currY - selection.startY),
    };
    setSelection(null);
    if (!wasArmed || displayId === null || rect.width < 4 || rect.height < 4) {
      return;
    }
    const result = await window.aipointer.captureSelection(rect, displayId);
    if (result.ok) {
      setSelectionFeedback({ kind: 'ok', rect: { width: rect.width, height: rect.height } });
    } else {
      setSelectionFeedback({ kind: 'error', message: result.error });
    }
  };

  // Toast auto-dismiss after 2s. Clears any pending timer first so back-to-
  // back captures don't stack timers.
  useEffect(() => {
    if (!selectionFeedback) return;
    if (selectionFeedbackTimer.current !== null) {
      window.clearTimeout(selectionFeedbackTimer.current);
    }
    selectionFeedbackTimer.current = window.setTimeout(() => {
      setSelectionFeedback(null);
      selectionFeedbackTimer.current = null;
    }, 2000);
  }, [selectionFeedback]);

  // ESC during selection cancels the in-progress rect without dismissing AI
  // mode (ESC outside a selection still dismisses the box via the uiohook
  // handler in main).
  useEffect(() => {
    if (!selection) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelection(null);
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [selection]);

  const handleBottomPillClick = () => {
    if (active) return;
    window.aipointer?.triggerAIMode?.();
  };

  const displayResponse = overrideResponse ?? response;
  const displayLoading = overrideResponse ? false : llmState === 'loading';
  const displayStreaming = overrideResponse ? false : llmState === 'streaming';
  const displayError = overrideResponse ? null : llmError;

  const selRect = selection
    ? {
        x: Math.min(selection.startX, selection.currX),
        y: Math.min(selection.startY, selection.currY),
        width: Math.abs(selection.currX - selection.startX),
        height: Math.abs(selection.currY - selection.startY),
      }
    : null;

  return (
    <div
      className="fixed inset-0"
      style={{ cursor: aiActiveHere && selectionMode ? 'crosshair' : undefined }}
      onPointerDown={aiActiveHere ? handleBackdropPointerDown : undefined}
      onPointerMove={aiActiveHere && selection ? handleBackdropPointerMove : undefined}
      onPointerUp={aiActiveHere && selection ? handleBackdropPointerUp : undefined}
      onPointerCancel={aiActiveHere && selection ? handleBackdropPointerUp : undefined}
    >
      <AnimatePresence>
        {aiActiveHere && selectionMode && !selection && (
          <motion.div
            key="selection-hint"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="pointer-events-none absolute left-1/2 top-6 -translate-x-1/2 rounded-full px-3 py-1.5 text-[12px] font-medium shadow-glass backdrop-blur-md"
            style={{
              background: 'rgba(20,22,18,0.78)',
              color: 'rgba(167,245,107,0.95)',
              border: '1px solid rgba(167,245,107,0.35)',
            }}
          >
            Drag to capture a region
          </motion.div>
        )}
      </AnimatePresence>
      {isPrimary && !splashDone && (
        <Splash enabled onDismiss={() => setSplashDone(true)} />
      )}

      <AnimatePresence>
        {showHalo && pos && <CursorHalo key="halo" x={pos.x} y={pos.y} />}
      </AnimatePresence>

      {selRect && selection?.armed && (
        <SelectionRectangle
          x={selRect.x}
          y={selRect.y}
          width={selRect.width}
          height={selRect.height}
        />
      )}

      <AnimatePresence>
        {selectionFeedback && (
          <motion.div
            key="selection-feedback"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
            className="pointer-events-none absolute left-1/2 top-6 -translate-x-1/2 rounded-full px-3 py-1.5 text-[12px] font-medium shadow-glass backdrop-blur-md"
            style={
              selectionFeedback.kind === 'ok'
                ? {
                    background: 'rgba(20,22,18,0.78)',
                    color: 'rgba(167,245,107,0.95)',
                    border: '1px solid rgba(167,245,107,0.35)',
                  }
                : {
                    background: 'rgba(40,16,16,0.85)',
                    color: 'rgba(255,180,180,0.95)',
                    border: '1px solid rgba(255,120,120,0.4)',
                  }
            }
          >
            {selectionFeedback.kind === 'ok'
              ? `Selection captured · ${Math.round(selectionFeedback.rect.width)}×${Math.round(selectionFeedback.rect.height)} px`
              : `Selection failed · ${selectionFeedback.message}`}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {aiActiveHere && layout && (
          <PromptInput
            key="prompt"
            ref={boxRef}
            x={layout.x}
            y={layout.y}
            loading={displayLoading}
            streaming={displayStreaming}
            response={displayResponse}
            error={displayError}
            webOnDefault={webOnDefault}
            audioMode={!!settings?.audioMode}
            lastPrompt={overrideResponse ? 'AICursor · help' : lastPrompt}
            lastWasWeb={lastWasWeb}
            activities={overrideResponse ? [] : activities}
            approvals={overrideResponse ? [] : approvals}
            clipboardPreview={clipboardCtx.preview}
            clipboardLength={clipboardCtx.length}
            onApprove={decideApproval}
            onDismissClipboard={() => void dismissClipboard()}
            onSubmit={handleSubmit}
            onCommand={handleCommand}
            onCancel={handleCancel}
          />
        )}
      </AnimatePresence>

      {!active && isPrimary && (
        <BottomPill
          ref={bottomPillRef}
          hasKey={hasAnyProviderKey}
          webOn={webOnDefault}
          active={active}
          expanded={bottomPillHovered}
          onTrigger={handleBottomPillClick}
        />
      )}

      {needsAccessibility && (
        <PermissionsBanner
          message="Accessibility permission required"
          hint="System Settings was opened. Grant access, then quit AICursor and relaunch."
        />
      )}
      {!needsAccessibility && needsScreenRecording && (
        <PermissionsBanner
          message="Screen Recording permission required"
          hint="System Settings was opened. Grant access, then quit AICursor and relaunch."
        />
      )}

      <AnimatePresence>
        {settingsOpen && (
          <SettingsModal
            key="settings"
            initial={settings}
            onClose={() => setSettingsOpen(false)}
            onSaved={(s) => saveSettings(s)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
