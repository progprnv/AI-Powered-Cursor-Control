import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

type FAQItem = {
  q: string;
  a: React.ReactNode;
};

const FAQ_ITEMS: FAQItem[] = [
  {
    q: 'How do I invoke AICursor?',
    a: (
      <>
        Hold the <b>left mouse button</b> for 200ms over the content you want to ask
        about. You can also click the small status pill at the bottom-center of
        your screen (it expands on hover).
      </>
    ),
  },
  {
    q: 'Which provider should I pick?',
    a: (
      <>
        <b>OpenRouter</b> is recommended. One key, automatic routing across all
        major model families, cheapest viable model is picked per request. Add
        direct Anthropic / OpenAI / Gemini keys as automatic fallback if you
        also want resilience when OpenRouter has an outage.
      </>
    ),
  },
  {
    q: 'How do I save an answer?',
    a: (
      <>
        After AICursor answers, hover the response and click <b>Save</b>.
        Choose <b>HTML</b> (A4-styled, ready to print to PDF), <b>PDF</b>, or
        <b> Markdown</b>. The default workspace folder is{' '}
        <code>~/Documents/AICursor</code> — change it in the Workspace
        section above.
      </>
    ),
  },
  {
    q: 'What commands are available?',
    a: (
      <>
        Type <code>/</code> in the prompt to see live autocomplete. Commands:{' '}
        <code>/web</code> (force web search), <code>/summary</code>,{' '}
        <code>/brief</code>, <code>/translate</code>, <code>/explain</code>,{' '}
        <code>/code</code>, <code>/improve</code>, <code>/settings</code>,{' '}
        <code>/help</code>, <code>/clear</code>, <code>/quit</code>. You can
        also just type the request in plain language — AICursor auto-routes
        intent.
      </>
    ),
  },
  {
    q: 'What about my data? Is it private?',
    a: (
      <>
        Screenshots (1024×768 region around your cursor) and any clipboard
        text you don't dismiss go only to the LLM provider you configured —
        nowhere else. No telemetry, no analytics, no auto-updater. The config
        file is stored locally and obfuscation-encrypted. AICursor is open
        source; verify yourself at{' '}
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            void window.aipointer?.openExternal('https://github.com/talentsache/aipointer');
          }}
          className="text-accent hover:underline"
        >
          github.com/talentsache/aipointer
        </a>
        .
      </>
    ),
  },
  {
    q: 'What if my provider fails?',
    a: (
      <>
        AICursor auto-falls-back to the next enabled provider in the fixed
        priority order: OpenRouter → Anthropic → OpenAI → Google Gemini → DeepSeek. Retry
        triggers on 408 / 429 / 5xx errors and on auth errors so a stale key
        in slot 1 still lets slot 2 answer.
      </>
    ),
  },
  {
    q: 'Tools and approvals?',
    a: (
      <>
        AICursor ships six tools: <code>fetch_url</code> (read a page),{' '}
        <code>open_url</code> (open in browser), <code>copy_to_clipboard</code>,{' '}
        <code>save_document</code>, <code>reveal_in_finder</code>,{' '}
        <code>read_clipboard</code>. Read-only tools run automatically. Action
        tools require a green-check / red-x approval per call. Toggle
        <b> Auto-approve actions</b> above to skip the prompt.
      </>
    ),
  },
  {
    q: 'Voice input?',
    a: (
      <>
        Click the microphone icon in the prompt. Speak. AICursor auto-stops
        ~1.5s after you fall silent, transcribes via your preferred provider
        (Gemini direct → OpenAI Whisper → OpenRouter), and fills the input.
        You can then edit and press Enter.
      </>
    ),
  },
  {
    q: 'Voice-first conversation mode?',
    a: (
      <>
        Turn on <b>Voice-first conversation mode</b> in Behaviour. Triggering
        AICursor then opens the box already listening: speak your question,
        the transcript auto-submits, the answer is read back aloud, and the
        mic re-opens for a follow-up. A small phase pill at the top of the
        box shows you which leg of the loop you're in
        (<i>Listening · Thinking · Speaking · Ready</i>). Press <kbd>ESC</kbd>{' '}
        to break out. Requires microphone permission.
      </>
    ),
  },
  {
    q: 'How do I screenshot a specific region instead of the default crop?',
    a: (
      <>
        While the box is open, <b>hold the trigger key a second time</b>{' '}
        (left mouse button). The cursor switches to a crosshair and a
        small hint pill appears. Click and drag a rectangle over the content
        you want — a lime-bordered selection follows the drag with a live size
        readout. Release the mouse to capture; that region replaces the
        default 1024×768 crop for the current query. Press ESC to cancel
        mid-drag without dismissing the box.
      </>
    ),
  },
  {
    q: 'What does AICursor actually "see"?',
    a: (
      <>
        At trigger time it takes <b>one</b> JPEG screenshot of the display
        under your cursor (1024×768 default, or your drag-rectangle if you
        used the region gesture). It also reads your current clipboard text
        — if you don't want that, click the X on the clipboard chip in the
        box and AICursor will skip clipboard until you copy something new.
        Multi-turn follow-ups in the same session reuse the original
        screenshot (no re-capture of AICursor's own box). Nothing else is
        recorded.
      </>
    ),
  },
  {
    q: 'What can AICursor do on its own (tools)?',
    a: (
      <>
        The model can decide mid-answer to use one of six tools:
        <ul className="mt-1.5 list-disc pl-4">
          <li><code>fetch_url</code> — read a page silently (read-only, auto)</li>
          <li><code>read_clipboard</code> — re-read clipboard (read-only, auto)</li>
          <li><code>open_url</code> — open a link in your browser (asks first)</li>
          <li><code>copy_to_clipboard</code> — write to clipboard (asks first)</li>
          <li><code>save_document</code> — save the answer as HTML / PDF / Markdown (asks first)</li>
          <li><code>reveal_in_finder</code> — open the workspace folder (asks first)</li>
        </ul>
        Approvals are per-call, green ✓ / red ✕ inline in the response.
        Toggle <b>Auto-approve actions</b> above to silence the prompts.
      </>
    ),
  },
  {
    q: 'Multi-display: where does the box appear?',
    a: (
      <>
        AICursor creates an invisible overlay on every connected display.
        When you trigger, the halo and prompt box appear on whichever display
        the cursor is on. Drag the box wherever you want — it stays within
        that display. Settings always opens on your primary display.
      </>
    ),
  },
  {
    q: 'Power and performance impact?',
    a: (
      <>
        Idle CPU is ~0%; the global keyboard hook costs almost nothing. The
        cursor halo and clipboard polling only run while the box is open. A
        single LLM query is one network round-trip plus token-streaming
        bytes. Voice transcription stays local-to-provider — no audio is ever
        stored. No background services, no scheduled tasks.
      </>
    ),
  },
  {
    q: 'How do I uninstall? Where is data stored?',
    a: (
      <>
        Drag <code>AICursor.app</code> to Trash (macOS) or uninstall from
        Programs (Windows / Linux). Per-user data lives at{' '}
        <code>~/Library/Application Support/aipointer</code> (macOS) /{' '}
        <code>%APPDATA%/aipointer</code> (Windows) / <code>~/.config/aipointer</code>{' '}
        (Linux). Your saved sessions live in your workspace folder (see above)
        and stay put unless you delete them yourself.
      </>
    ),
  },
  {
    q: 'Keyboard shortcuts',
    a: (
      <>
        Hold the <b>left mouse button</b> for 200ms → trigger.
        Hold again over an open box → arm region selection. <kbd>ESC</kbd> →
        dismiss. <kbd>Enter</kbd> → submit. <kbd>↑</kbd> / <kbd>↓</kbd> →
        navigate the command autocomplete. <kbd>Tab</kbd> → complete a
        command. <kbd>Cmd+C</kbd> on the response → copy.
      </>
    ),
  },
];

export function FAQ() {
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  return (
    <div className="flex flex-col gap-1.5">
      {FAQ_ITEMS.map((item, i) => {
        const open = openIdx === i;
        return (
          <div
            key={i}
            className={[
              'rounded-lg border transition-colors',
              open
                ? 'border-accent/35 bg-accent/8 dark:border-accent/40 dark:bg-accent/8'
                : 'border-white/8 bg-white/3 hover:bg-white/5 dark:border-neutral-900/10 dark:bg-neutral-900/3 dark:hover:bg-neutral-900/5',
            ].join(' ')}
          >
            <button
              type="button"
              onClick={() => setOpenIdx(open ? null : i)}
              className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left"
            >
              <span className="text-[12.5px] font-medium text-white dark:text-neutral-900">
                {item.q}
              </span>
              <span
                className={[
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded-md transition-transform',
                  open ? 'rotate-180 text-accent' : 'text-white/55 dark:text-neutral-900/55',
                ].join(' ')}
              >
                <svg viewBox="0 0 10 10" fill="none" className="h-2.5 w-2.5">
                  <path
                    d="M2 4l3 3 3-3"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            </button>
            <AnimatePresence initial={false}>
              {open && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{
                    height: { type: 'spring', damping: 28, stiffness: 360 },
                    opacity: { duration: 0.15 },
                  }}
                  className="overflow-hidden"
                >
                  <div className="px-3.5 pb-3 text-[12px] leading-relaxed text-white/75 dark:text-neutral-900/80 [&_kbd]:rounded [&_kbd]:border [&_kbd]:border-white/15 [&_kbd]:bg-white/8 [&_kbd]:px-1 [&_kbd]:py-0.5 [&_kbd]:text-[10.5px] dark:[&_kbd]:border-neutral-900/15 dark:[&_kbd]:bg-neutral-900/8 [&_code]:rounded [&_code]:bg-white/10 [&_code]:px-1 [&_code]:py-px [&_code]:font-mono [&_code]:text-[11px] dark:[&_code]:bg-neutral-900/8 [&_b]:font-semibold [&_b]:text-white dark:[&_b]:text-neutral-900">
                    {item.a}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}
