// AiCursor standalone project file.
import { marked } from 'marked';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Detect whether the response is already rich HTML (Gemini may emit HTML
// directly for /summary etc.) or needs markdown rendering.
function looksLikeHtml(s: string): boolean {
  const trimmed = s.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html')) return true;
  // Heuristic: HTML tag density > 1 per 200 chars of body.
  const tagMatches = trimmed.match(/<\/?(?:div|section|article|table|h[1-6]|p|ul|ol|li|figure|aside|nav|header|footer|main|span|button|input|form|svg)\b/gi);
  if (!tagMatches) return false;
  return tagMatches.length > Math.max(2, trimmed.length / 400);
}

export async function renderHtmlDocument(opts: {
  prompt: string;
  markdown: string;
  web: boolean;
  generatedAt: Date;
}): Promise<string> {
  const isHtml = looksLikeHtml(opts.markdown);
  const body = isHtml
    ? opts.markdown // already rich HTML, embed as-is
    : await marked.parse(opts.markdown, { gfm: true, breaks: false });
  const ts = opts.generatedAt.toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const safePrompt = escapeHtml(opts.prompt);
  const webBadge = opts.web
    ? '<span class="ai-badge ai-badge--web">web-grounded</span>'
    : '';

  return `<!DOCTYPE html>
<!-- aipointer-mark: ms/talentsache/aipointer.app/v1.0.0/20260513 -->
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="generator" content="AICursor 1.0.0">
<title>AICursor · ${safePrompt.slice(0, 80)}</title>
<style>
  :root {
    --bg: #fafaf9;
    --paper: #ffffff;
    --ink: #18181b;
    --ink-soft: rgba(24, 24, 27, 0.68);
    --ink-faint: rgba(24, 24, 27, 0.45);
    --accent: #6aaf3a;
    --accent-soft: rgba(106, 175, 58, 0.14);
    --accent-strong: rgba(106, 175, 58, 0.32);
    --border: rgba(24, 24, 27, 0.09);
    --border-strong: rgba(24, 24, 27, 0.18);
    --code-bg: rgba(24, 24, 27, 0.045);
    --warn: #b45309;
    --warn-soft: rgba(180, 83, 9, 0.1);
    --info: #1d4ed8;
    --info-soft: rgba(29, 78, 216, 0.08);
    --danger: #b91c1c;
    --danger-soft: rgba(185, 28, 28, 0.08);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0c0c0d;
      --paper: #16161a;
      --ink: #f5f5f4;
      --ink-soft: rgba(245, 245, 244, 0.72);
      --ink-faint: rgba(245, 245, 244, 0.42);
      --accent: #a7f56b;
      --accent-soft: rgba(167, 245, 107, 0.12);
      --accent-strong: rgba(167, 245, 107, 0.3);
      --border: rgba(245, 245, 244, 0.1);
      --border-strong: rgba(245, 245, 244, 0.18);
      --code-bg: rgba(245, 245, 244, 0.06);
      --warn: #fbbf24;
      --warn-soft: rgba(251, 191, 36, 0.08);
      --info: #93c5fd;
      --info-soft: rgba(147, 197, 253, 0.08);
      --danger: #fca5a5;
      --danger-soft: rgba(252, 165, 165, 0.08);
    }
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--ink); font-family: -apple-system, system-ui, 'Segoe UI', Inter, sans-serif; line-height: 1.55; -webkit-font-smoothing: antialiased; }
  body { padding: 48px 0; }
  .ai-doc {
    width: 210mm;
    min-height: 297mm;
    max-width: calc(100vw - 32px);
    margin: 0 auto;
    background: var(--paper);
    padding: 22mm 22mm 18mm 22mm;
    box-shadow: 0 24px 80px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.04);
    border-radius: 8px;
    position: relative;
  }
  .ai-doc__header { border-bottom: 1px solid var(--border); padding-bottom: 18px; margin-bottom: 28px; }
  .ai-doc__brand { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--ink-soft); }
  .ai-doc__brand .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 4px var(--accent-soft); }
  .ai-doc__title { margin: 14px 0 0 0; font-size: 30px; line-height: 1.18; letter-spacing: -0.015em; font-weight: 650; color: var(--ink); }
  .ai-doc__meta { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 12px; font-size: 12px; color: var(--ink-faint); align-items: center; }
  .ai-badge { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 999px; font-weight: 600; font-size: 10.5px; letter-spacing: 0.04em; text-transform: uppercase; }
  .ai-badge--web { background: var(--accent-soft); color: var(--accent); }
  .ai-doc__body { font-size: 14.5px; }
  .ai-doc__body h1, .ai-doc__body h2, .ai-doc__body h3 { color: var(--ink); letter-spacing: -0.008em; line-height: 1.25; margin: 1.6em 0 0.6em; }
  .ai-doc__body h1 { font-size: 24px; }
  .ai-doc__body h2 { font-size: 19px; padding-bottom: 6px; border-bottom: 1px solid var(--border); }
  .ai-doc__body h3 { font-size: 16px; color: var(--ink-soft); }
  .ai-doc__body p { margin: 0.75em 0; color: var(--ink); }
  .ai-doc__body a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; text-decoration-thickness: 1px; }
  .ai-doc__body a:hover { text-decoration-thickness: 2px; }
  .ai-doc__body ul, .ai-doc__body ol { margin: 0.85em 0; padding-left: 1.5em; }
  .ai-doc__body li { margin: 0.3em 0; }
  .ai-doc__body li::marker { color: var(--accent); }
  .ai-doc__body code { background: var(--code-bg); padding: 1.5px 6px; border-radius: 4px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9em; }
  .ai-doc__body pre { background: var(--code-bg); padding: 14px 16px; border-radius: 8px; overflow-x: auto; font-size: 13px; line-height: 1.5; margin: 1em 0; border: 1px solid var(--border); }
  .ai-doc__body pre code { background: transparent; padding: 0; }
  .ai-doc__body blockquote { border-left: 3px solid var(--accent); padding-left: 14px; margin: 1em 0; color: var(--ink-soft); font-style: italic; }
  .ai-doc__body hr { border: none; border-top: 1px solid var(--border); margin: 2em 0; }
  .ai-doc__body table { border-collapse: collapse; margin: 1em 0; width: 100%; font-size: 13.5px; }
  .ai-doc__body th, .ai-doc__body td { padding: 8px 12px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; }
  .ai-doc__body th { font-weight: 600; background: var(--code-bg); }
  .ai-doc__body tr:hover td { background: var(--accent-soft); }
  /* Card primitives Gemini can use directly with class names */
  .ai-doc__body .card { border: 1px solid var(--border); background: var(--paper); border-radius: 10px; padding: 16px 18px; margin: 1em 0; }
  .ai-doc__body .callout { border-left: 3px solid var(--accent); background: var(--accent-soft); padding: 12px 14px; border-radius: 0 8px 8px 0; margin: 1em 0; }
  .ai-doc__body .callout--warn { border-left-color: var(--warn); background: var(--warn-soft); color: var(--ink); }
  .ai-doc__body .callout--info { border-left-color: var(--info); background: var(--info-soft); color: var(--ink); }
  .ai-doc__body .callout--danger { border-left-color: var(--danger); background: var(--danger-soft); color: var(--ink); }
  .ai-doc__body .grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); margin: 1em 0; }
  .ai-doc__body .step { display: flex; gap: 12px; padding: 10px 0; }
  .ai-doc__body .step__num { flex: 0 0 28px; width: 28px; height: 28px; border-radius: 50%; background: var(--accent-soft); color: var(--accent); display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 12.5px; }
  .ai-doc__body .kpi { display: inline-flex; flex-direction: column; padding: 12px 16px; border-radius: 10px; background: var(--code-bg); margin-right: 12px; min-width: 110px; }
  .ai-doc__body .kpi__value { font-size: 22px; font-weight: 650; line-height: 1; color: var(--ink); }
  .ai-doc__body .kpi__label { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--ink-faint); margin-top: 4px; }
  .ai-doc__body svg { max-width: 100%; height: auto; }
  .ai-doc__footer { border-top: 1px solid var(--border); padding-top: 16px; margin-top: 48px; font-size: 11px; color: var(--ink-faint); display: flex; justify-content: space-between; align-items: center; }
  .ai-doc__footer .right { display: flex; gap: 8px; align-items: center; }
  @media print {
    body { padding: 0; background: white; }
    .ai-doc { box-shadow: none; border-radius: 0; width: auto; min-height: auto; max-width: none; margin: 0; padding: 18mm; }
    .ai-doc__title { font-size: 24px; }
    .ai-doc__body { font-size: 12.5pt; }
  }
  @page { size: A4; margin: 16mm; }
</style>
</head>
<body>
  <main class="ai-doc">
    <header class="ai-doc__header">
      <div class="ai-doc__brand"><span class="dot"></span> AICursor</div>
      <h1 class="ai-doc__title">${safePrompt || 'Response'}</h1>
      <div class="ai-doc__meta">
        <span>${ts}</span>
        ${webBadge}
      </div>
    </header>
    <article class="ai-doc__body">${body}</article>
    <footer class="ai-doc__footer">
      <span>Generated by AICursor · MIT · No telemetry</span>
      <span class="right">
        <a href="https://aipointer.app">aipointer.app</a>
        ·
        <a href="https://github.com/talentsache/aipointer">GitHub</a>
      </span>
    </footer>
  </main>
</body>
</html>`;
}
