// AiCursor standalone project file.
import { app, dialog, ipcMain, screen, shell, BrowserWindow } from 'electron';
import { CHANNELS } from './channels';
import { getAllOverlays, getOverlayEntries, getOverlayForDisplay, setOverlayInteractive, setAllOverlaysAlwaysOnTop } from '../windows/overlay';
import { getPermissions, openSystemSettings, resetScreenRecordingCache } from '../permissions';
import { endAIMode, setActiveBoxBounds, startAIModeManually } from '../input/trigger';
import { getSettings, setSettings } from '../store/settings';
import { captureAroundCursor, captureRectFromDisplay } from '../capture/screenshot';
import { readClipboardText } from '../capture/clipboard';
import { streamCompletion, type StreamHandle } from '../llm/providers/router';
import { testProviderKey } from '../llm/providers/test-key';
import { fetchLinkMeta } from '../llm/link-meta';
import { saveResponse, withOverlaysLowered } from '../save/save';
import { getTemplate } from '../llm/templates';
import { transcribeAudio } from '../voice/transcribe';
import { synthesizeSpeech } from '../voice/tts';
import { describeToolForUI } from '../llm/tools';
import {
  clearAllSessions,
  getMaxContextTokens,
  listSessions,
  newSessionId,
  persistSession,
  resolveSessionRelativePath,
  shouldPersist,
  truncateForBudget,
  type ActiveSession,
} from '../memory/sessions';
import { SYSTEM_PROMPT, buildMessages, type Message } from '../llm/prompt';
import { getUpdater } from '../updater';
import type {
  CursorPosition,
  ProviderId,
  Settings,
  TemplateId,
  ToolActivity,
  ToolApprovalRequest,
} from '../types';

let currentStream: StreamHandle | null = null;
let pendingScreenshot: { b64: string; ts: number } | null = null;
let pendingScreenshotError: string | null = null;
let pendingClipboard: string = '';
// When the user clicks the X on the clipboard chip we remember the exact text
// they dismissed. The 400ms poller treats that text as "already seen" so it
// doesn't keep re-pushing the same clipboard into the box. As soon as the
// clipboard *changes* (user copies something new), the dismissed flag clears
// and the new value gets surfaced again. Submits while dismissed go in WITHOUT
// clipboard context so the LLM doesn't get text the user explicitly hid.
let dismissedClipboard: string | null = null;
let activeSession: ActiveSession | null = null;

const pendingApprovals = new Map<string, (approved: boolean) => void>();

function startNewSession(imageB64: string, clip: string): void {
  activeSession = {
    id: newSessionId(),
    startedAt: Date.now(),
    imageB64,
    clipboard: clip,
    messages: [],
    firstPrompt: '',
    turnCount: 0,
    templateId: null,
    web: false,
  };
}

async function endActiveSession(): Promise<void> {
  if (!activeSession) return;
  const session = activeSession;
  activeSession = null;
  if (session.turnCount === 0) return;
  if (shouldPersist()) {
    await persistSession(session);
  }
}

export function triggerAIModeFromMenu(): void {
  // Bring at least one overlay to front and start AI mode as if uiohook
  // detected the long-press. This is what the tray icon / bottom pill use.
  startAIModeManually();
}

export function cancelCurrentStream(): void {
  if (currentStream) {
    currentStream.cancel();
    currentStream = null;
  }
}

export async function capturePendingScreenshot(cursor: { x: number; y: number }): Promise<void> {
  pendingScreenshot = null;
  pendingScreenshotError = null;
  try {
    const b64 = await captureAroundCursor(cursor);
    pendingScreenshot = { b64, ts: Date.now() };
  } catch (err) {
    pendingScreenshotError = err instanceof Error ? err.message : 'Screenshot failed';
    console.error('[handlers] pending screenshot failed:', pendingScreenshotError);
  }
}

export function clearPendingScreenshot(): void {
  pendingScreenshot = null;
  pendingScreenshotError = null;
}

export async function finalizeActiveSession(): Promise<void> {
  await endActiveSession();
}

const CLIPBOARD_PREVIEW_LEN = 80;

export function snapshotClipboard(): { preview: string | null; length: number } {
  pendingClipboard = readClipboardText();
  const length = pendingClipboard.length;
  if (length === 0) return { preview: null, length: 0 };
  const oneLine = pendingClipboard.replace(/\s+/g, ' ').trim();
  const preview = oneLine.length > CLIPBOARD_PREVIEW_LEN
    ? oneLine.slice(0, CLIPBOARD_PREVIEW_LEN) + '…'
    : oneLine;
  return { preview, length };
}

export function clearPendingClipboard(): void {
  pendingClipboard = '';
  dismissedClipboard = null;
}

// Called when the user clicks the X on the clipboard chip. We don't actually
// touch the OS pasteboard (that would be hostile); we just remember the
// dismissed text so the poller and the next submit both ignore it. The flag
// auto-clears as soon as the clipboard contents differ.
export function dismissCurrentClipboard(): void {
  dismissedClipboard = readClipboardText();
  pendingClipboard = '';
}

// Polled by main while AI mode is active so the renderer can show the user's
// freshly copied text (Cmd+C) without them having to re-trigger the box.
// Returns the new preview payload when the clipboard text actually changed,
// or null when nothing changed (so we don't flood the IPC channel every tick).
export function pollClipboardIfChanged(): { preview: string | null; length: number } | null {
  const fresh = readClipboardText();
  // While a dismissed snapshot is active, swallow polls until the OS clipboard
  // actually changes. The moment it does, we clear the dismissal and let the
  // new value flow through normally.
  if (dismissedClipboard !== null) {
    if (fresh === dismissedClipboard) return null;
    dismissedClipboard = null;
  }
  if (fresh === pendingClipboard) return null;
  pendingClipboard = fresh;
  const length = fresh.length;
  if (length === 0) return { preview: null, length: 0 };
  const oneLine = fresh.replace(/\s+/g, ' ').trim();
  const preview = oneLine.length > CLIPBOARD_PREVIEW_LEN
    ? oneLine.slice(0, CLIPBOARD_PREVIEW_LEN) + '…'
    : oneLine;
  return { preview, length };
}

export function broadcastClipboardContext(payload: { preview: string | null; length: number }): void {
  for (const win of getAllOverlays()) {
    if (!win.isDestroyed()) win.webContents.send(CHANNELS.ClipboardContext, payload);
  }
}

function buildPayload(): CursorPosition {
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  return {
    x: cursor.x - display.workArea.x,
    y: cursor.y - display.workArea.y,
    displayId: display.id,
  };
}

export function registerIpcHandlers(): void {
  ipcMain.handle(CHANNELS.PermissionsGet, () => getPermissions());

  ipcMain.handle(CHANNELS.PermissionsOpen, (_e, kind: 'accessibility' | 'screen-recording') => {
    resetScreenRecordingCache();
    return openSystemSettings(kind);
  });

  ipcMain.handle(CHANNELS.AIModeCancel, () => {
    cancelCurrentStream();
    endAIMode();
  });

  ipcMain.handle(CHANNELS.ClipboardDismiss, () => {
    dismissCurrentClipboard();
  });

  ipcMain.on(CHANNELS.OverlaySetInteractive, (e, interactive: boolean) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return;
    for (const [displayId, overlay] of getOverlayEntries()) {
      if (overlay === win) {
        setOverlayInteractive(displayId, interactive);
        return;
      }
    }
  });

  ipcMain.handle(CHANNELS.SettingsGet, () => getSettings());
  ipcMain.handle(CHANNELS.SettingsSet, (_e, patch: Partial<Settings>) => setSettings(patch));
  ipcMain.handle(CHANNELS.ExternalOpen, async (_e, url: string) => {
    if (!/^https?:\/\//.test(url)) return;
    await shell.openExternal(url);
  });

  const runQuery = async (
    e: Electron.IpcMainInvokeEvent,
    prompt: string,
    options: { web?: boolean; templateId?: TemplateId },
  ) => {
    cancelCurrentStream();
    const sender = e.sender;

    // First turn of a new session: needs the screenshot from the trigger.
    // Subsequent turns reuse the same screenshot (the actual screen is now
    // partially covered by AICursor itself, so recapturing would be wrong).
    if (!activeSession) {
      let imageB64: string;
      if (pendingScreenshot) {
        imageB64 = pendingScreenshot.b64;
      } else if (pendingScreenshotError) {
        sender.send(CHANNELS.LLMError, { message: pendingScreenshotError });
        return;
      } else {
        try {
          const cursor = screen.getCursorScreenPoint();
          imageB64 = await captureAroundCursor(cursor);
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Screenshot failed';
          sender.send(CHANNELS.LLMError, { message });
          return;
        }
      }
      startNewSession(imageB64, pendingClipboard);
    }

    if (!activeSession) return;

    const sendActivity = (activity: ToolActivity) => {
      if (!sender.isDestroyed()) sender.send(CHANNELS.ToolActivity, activity);
    };

    const requestToolApproval = (
      id: string,
      name: string,
      args: Record<string, unknown>,
    ) =>
      new Promise<boolean>((resolve) => {
        const req: ToolApprovalRequest = {
          id,
          name,
          label: describeToolForUI(name, args),
          args,
        };
        pendingApprovals.set(id, resolve);
        if (!sender.isDestroyed()) sender.send(CHANNELS.ToolApprovalRequest, req);
      });

    // Build the messages array for this turn:
    //  - first turn: [system, user(screenshot + clip + prompt)]
    //  - later turns: existing messages + new user(text only)
    // Re-read the clipboard on each submit so that copying text (Cmd+C)
    // while the box is open is picked up — the user can highlight text in
    // another app and ask AICursor about it without restarting the session.
    // BUT: if the user clicked the X on the chip and the clipboard hasn't
    // changed since, treat it as empty for this turn. Otherwise dismissing
    // would only hide the chip visually while still leaking the text to the
    // LLM, which is the opposite of what the user asked for.
    const liveClipboardRaw = readClipboardText();
    const liveClipboard =
      dismissedClipboard !== null && liveClipboardRaw === dismissedClipboard
        ? ''
        : liveClipboardRaw;
    if (liveClipboard !== activeSession.clipboard) {
      activeSession.clipboard = liveClipboard;
      const preview = liveClipboard.replace(/\s+/g, ' ').trim();
      const previewCap = preview.length > 80 ? preview.slice(0, 80) + '…' : preview;
      for (const win of getAllOverlays()) {
        if (!win.isDestroyed()) {
          win.webContents.send(CHANNELS.ClipboardContext, {
            preview: liveClipboard ? previewCap : null,
            length: liveClipboard.length,
          });
        }
      }
    }

    let messages: Message[];
    if (activeSession.messages.length === 0) {
      const initial = buildMessages(prompt, activeSession.imageB64, activeSession.clipboard);
      messages = initial;
      activeSession.firstPrompt = prompt;
      activeSession.templateId = options.templateId ?? null;
      activeSession.web = !!options.web;
    } else {
      // For follow-up turns include the latest clipboard inline so the
      // model sees the user's freshly copied snippet alongside the new prompt.
      const turnText = activeSession.clipboard
        ? `${prompt}\n\nSelected text from clipboard:\n${activeSession.clipboard}`
        : prompt;
      messages = [...activeSession.messages, { role: 'user', content: turnText }];
    }
    messages = truncateForBudget(messages, getMaxContextTokens());

    // Track this turn's assistant text so we can append a clean assistant
    // message to the session when streaming completes.
    let turnAssistantText = '';
    activeSession.turnCount += 1;

    currentStream = streamCompletion(
      prompt,
      activeSession.imageB64,
      activeSession.clipboard,
      {
        onChunk: (text) => {
          turnAssistantText += text;
          if (!sender.isDestroyed()) sender.send(CHANNELS.LLMChunk, { text });
        },
        onToolStart: (id, label, name, args) => {
          sendActivity({ kind: 'start', id, name, label, args });
        },
        onToolEnd: (id, name, ok, summary) => {
          if (!sender.isDestroyed()) sender.send(CHANNELS.ToolApprovalCleared, id);
          sendActivity({ kind: 'end', id, name, ok, summary });
        },
        onDone: () => {
          currentStream = null;
          if (activeSession) {
            // Append this turn's user message and assistant reply to the
            // running history so the next turn carries context.
            const sess = activeSession;
            if (sess.messages.length === 0) {
              // First turn: pull system + user that were just sent.
              sess.messages = messages.slice();
            } else {
              sess.messages.push({ role: 'user', content: prompt });
            }
            sess.messages.push({ role: 'assistant', content: turnAssistantText });
          }
          if (!sender.isDestroyed()) sender.send(CHANNELS.LLMDone);
        },
        onError: (message) => {
          currentStream = null;
          if (!sender.isDestroyed()) sender.send(CHANNELS.LLMError, { message });
        },
      },
      {
        web: options.web,
        templateId: options.templateId,
        requestToolApproval,
        existingMessages: messages,
      },
    );
  };

  ipcMain.handle(CHANNELS.LLMQuery, async (e, prompt: string) => {
    await runQuery(e, prompt, {});
  });

  ipcMain.handle(
    CHANNELS.LLMQueryOptions,
    async (
      e,
      prompt: string,
      options: { web?: boolean; templateId?: TemplateId },
    ) => {
      await runQuery(e, prompt, options ?? {});
    },
  );

  ipcMain.handle(CHANNELS.FetchLinkMeta, async (_e, url: string) => {
    if (typeof url !== 'string') return null;
    return await fetchLinkMeta(url);
  });

  ipcMain.on(CHANNELS.Quit, () => {
    app.quit();
  });

  ipcMain.on(CHANNELS.OpenSettings, () => {
    broadcastSettingsOpen();
  });

  ipcMain.handle(
    CHANNELS.SaveResponse,
    async (
      _e,
      payload: { prompt: string; markdown: string; web: boolean },
    ) => {
      return await saveResponse(payload);
    },
  );

  ipcMain.handle(CHANNELS.PickWorkspaceFolder, async () => {
    const result = await withOverlaysLowered(() =>
      dialog.showOpenDialog({
        title: 'Choose AICursor workspace folder',
        defaultPath: getSettings().workspaceFolder,
        properties: ['openDirectory', 'createDirectory'],
        buttonLabel: 'Choose folder',
      }),
    );
    if (result.canceled || result.filePaths.length === 0) return null;
    const folder = result.filePaths[0];
    setSettings({ workspaceFolder: folder });
    return folder;
  });

  ipcMain.handle(CHANNELS.AppVersion, () => app.getVersion());

  // Test a provider API key. The handler is intentionally stateless — it does
  // NOT persist anything; the renderer decides what to do with the result. We
  // also explicitly don't read the key from getSettings(); the renderer hands
  // it in so an unsaved typing-in-progress can be validated without forcing
  // the user to save first.
  ipcMain.handle(
    CHANNELS.TestProviderKey,
    async (_e, payload: { provider: ProviderId; apiKey: string }) => {
      return await testProviderKey(payload.provider, payload.apiKey);
    },
  );

  ipcMain.handle(CHANNELS.ListSessions, () => listSessions());
  ipcMain.handle(CHANNELS.RevealSession, async (_e, rel: string) => {
    // Renderer passes a relative path (relative to the workspace folder).
    // The main process resolves it and enforces workspace containment so a
    // crafted relative input cannot reveal arbitrary filesystem locations.
    const resolved = resolveSessionRelativePath(rel);
    if (!resolved) return;
    shell.showItemInFolder(resolved);
  });
  ipcMain.handle(CHANNELS.ClearSessions, () => clearAllSessions());

  ipcMain.handle(CHANNELS.SynthesizeSpeech, async (_e, text: string) => {
    try {
      const result = await synthesizeSpeech(text);
      return result;
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'TTS failed' };
    }
  });

  ipcMain.handle(CHANNELS.UpdatesCheck, async () => {
    // Manual check from the renderer or tray. Not silent: surface a brief
    // error if something fails so the user knows what happened.
    const result = await getUpdater().runCheck(false);
    return result;
  });

  ipcMain.handle(CHANNELS.UpdatesInstall, async () => {
    const updater = getUpdater();
    if (updater.hasPendingInstall()) {
      updater.installDownloaded();
      return;
    }
    // No file ready yet. Download first (state events stream through
    // `updates:state` so the UI can render progress). Then install.
    const state = await updater.downloadPending();
    if (state.status === 'downloaded') {
      updater.installDownloaded();
    }
  });

  ipcMain.on(CHANNELS.ToolApprovalRespond, (_e, id: string, approved: boolean) => {
    const resolve = pendingApprovals.get(id);
    if (!resolve) return;
    pendingApprovals.delete(id);
    resolve(!!approved);
  });

  ipcMain.on(CHANNELS.TriggerAIMode, () => {
    triggerAIModeFromMenu();
  });

  // Renderer pushes the box's current bounds (in display-local coords) so the
  // main process can detect clicks that land outside the box even when the
  // overlay is click-through. Sending null clears the bounds (box hidden or
  // settings panel covering it).
  ipcMain.on(CHANNELS.BoxBounds, (_e, payload: { left: number; top: number; right: number; bottom: number; displayId: number } | null) => {
    setActiveBoxBounds(payload);
  });

  // While the Settings panel is open, lower every overlay's alwaysOnTop level
  // so the user can Cmd+Tab to their browser (e.g. to copy an OpenRouter API
  // key) without our screen-saver-level overlays blocking the way.
  ipcMain.on(CHANNELS.OverlaySettingsMode, (_e, opening: boolean) => {
    setAllOverlaysAlwaysOnTop(!opening);
  });

  // User dragged a custom selection rectangle on top of the underlying app.
  // We re-capture exactly that region and substitute it for the default
  // cursor-centered 1024x768 crop. Works either:
  //  - BEFORE the first submit → replaces pendingScreenshot, the next submit
  //    picks it up automatically
  //  - DURING an active session → replaces activeSession.imageB64 AND clears
  //    the message history so the new image becomes the basis of the
  //    follow-up conversation (otherwise the LLM would still be reasoning
  //    about the old picture in its earlier turns).
  ipcMain.handle(
    CHANNELS.SelectionCapture,
    async (
      e,
      payload: { rect: { x: number; y: number; width: number; height: number }; displayId: number },
    ) => {
      try {
        const b64 = await captureRectFromDisplay(payload.rect, payload.displayId);
        pendingScreenshot = { b64, ts: Date.now() };
        pendingScreenshotError = null;
        if (activeSession) {
          activeSession.imageB64 = b64;
          activeSession.messages = [];
          activeSession.turnCount = 0;
        }
        if (!e.sender.isDestroyed()) {
          e.sender.send(CHANNELS.SelectionDone, { ok: true });
        }
        return { ok: true } as const;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Selection capture failed';
        console.error('[handlers] selection capture failed:', message);
        if (!e.sender.isDestroyed()) {
          e.sender.send(CHANNELS.SelectionDone, { ok: false, error: message });
        }
        return { ok: false, error: message } as const;
      }
    },
  );

  ipcMain.handle(
    CHANNELS.TranscribeAudio,
    async (_e, audioBase64: string, mimeType: string) => {
      try {
        return await transcribeAudio(audioBase64, mimeType);
      } catch (err) {
        return err instanceof Error ? `__error__:${err.message}` : '__error__:unknown';
      }
    },
  );
}

export function broadcastAIModeStart(): void {
  const payload = buildPayload();
  // Re-assert top-level z-order on every trigger. The overlay is constructed
  // with `alwaysOnTop: 'screen-saver'`, but macOS can demote it back to a
  // regular level after a number of innocuous events (Cmd+Tab to another
  // app, DevTools open/close, Settings panel lowering the overlay, system
  // sleep/wake). When that happens the trigger still fires but the box
  // renders BEHIND whatever is currently focused — looks broken to the
  // user. Bumping the level + moveTop() here guarantees the box is visible
  // immediately and on every retrigger, not just the first one after launch.
  //
  // We also explicitly focus the overlay on the display the cursor is on.
  // Without that the window can be visually frontmost but NOT macOS's "key
  // window" — DOM `input.focus()` calls from the renderer then silently fail
  // and the user lands in the open box with no caret, having to click the
  // input before they can type. Only the overlay for the active display
  // gets focused; secondary overlays stay focusable but unfocused.
  for (const win of getAllOverlays()) {
    if (win.isDestroyed()) continue;
    try {
      win.setAlwaysOnTop(true, 'screen-saver');
      win.moveTop();
    } catch {
      /* ignore — best effort */
    }
    win.webContents.send(CHANNELS.AIModeStart, payload);
  }
  const activeWin = getOverlayForDisplay(payload.displayId);
  if (activeWin && !activeWin.isDestroyed()) {
    try {
      activeWin.focus();
      activeWin.webContents.focus();
    } catch {
      /* best effort */
    }
  }
}

export function broadcastAIModeEnd(): void {
  for (const win of getAllOverlays()) {
    if (!win.isDestroyed()) win.webContents.send(CHANNELS.AIModeEnd);
  }
}

export function broadcastCursorPosition(): void {
  const payload = buildPayload();
  for (const win of getAllOverlays()) {
    if (!win.isDestroyed()) win.webContents.send(CHANNELS.CursorPosition, payload);
  }
}

export function broadcastSettingsOpen(): void {
  for (const win of getAllOverlays()) {
    if (!win.isDestroyed()) win.webContents.send(CHANNELS.SettingsOpen);
  }
}

export function broadcastSelectionArm(armed: boolean): void {
  for (const win of getAllOverlays()) {
    if (!win.isDestroyed()) win.webContents.send(CHANNELS.SelectionArm, armed);
  }
}
