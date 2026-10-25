// AiCursor standalone project file.
import { promises as fs } from 'node:fs';
import { join, relative } from 'node:path';
import type { Message } from '../llm/prompt';
import { getSettings, getWorkspaceFolder } from '../store/settings';
import { renderHtmlDocument } from '../save/template';
import type { SessionSummary } from '../types';

// Sessions are stored under <workspace>/sessions/ as JSON + an optional HTML
// transcript. Both are auto-generated on session end if memorySaveEnabled.

type SessionTurn = {
  user: string;
  assistant: string;
};

export type ActiveSession = {
  id: string;
  startedAt: number;
  imageB64: string;
  clipboard: string;
  // Full message history including system, alternating user/assistant, and tool messages.
  messages: Message[];
  firstPrompt: string;
  turnCount: number;
  templateId: string | null;
  web: boolean;
};

function sessionsDir(): string {
  return join(getWorkspaceFolder(), 'sessions');
}

export async function ensureSessionsDir(): Promise<string> {
  const dir = sessionsDir();
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export function newSessionId(): string {
  // Sortable timestamp + short random suffix.
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const rand = Math.random().toString(36).slice(2, 6);
  return `${ts}-${rand}`;
}

function safeName(input: string, fallback: string): string {
  const cleaned = input
    .replace(/[\s/\\:*?"<>|]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
    .toLowerCase();
  return cleaned || fallback;
}

// Approximate token counting: 4 chars ≈ 1 token. Image blocks counted as a
// fixed 1500 tokens (vision inputs are encoded differently per provider but
// this is close enough for budgeting).
const CHARS_PER_TOKEN = 4;
const IMAGE_TOKEN_COST = 1500;

function estimateTokens(message: Message): number {
  if (message.role === 'system' || message.role === 'user') {
    if (typeof message.content === 'string') {
      return Math.ceil(message.content.length / CHARS_PER_TOKEN);
    }
    let total = 0;
    for (const part of message.content) {
      if (part.type === 'text') total += Math.ceil(part.text.length / CHARS_PER_TOKEN);
      else if (part.type === 'image_url') total += IMAGE_TOKEN_COST;
    }
    return total;
  }
  if (message.role === 'assistant') {
    const text = typeof message.content === 'string' ? message.content : '';
    let total = Math.ceil(text.length / CHARS_PER_TOKEN);
    if (message.tool_calls) {
      for (const tc of message.tool_calls) {
        total += Math.ceil((tc.function.name.length + tc.function.arguments.length) / CHARS_PER_TOKEN);
      }
    }
    return total;
  }
  // tool messages
  return Math.ceil(message.content.length / CHARS_PER_TOKEN);
}

// Trim the messages array to fit under `maxTokens`. Always preserves:
//   - system message (index 0)
//   - the FIRST user message (it carries the screenshot — recreating it is
//     impossible since the box is in the way of the screen now).
// Drops oldest middle-turn pairs (user + assistant + tool messages) until
// the total fits.
export function truncateForBudget(messages: Message[], maxTokens: number): Message[] {
  if (messages.length <= 2) return messages;

  const total = () => messages.reduce((s, m) => s + estimateTokens(m), 0);
  if (total() <= maxTokens) return messages;

  const sys = messages[0];
  const firstUser = messages[1];
  let middle = messages.slice(2);

  while (middle.length > 0 && estimateTokens(sys) + estimateTokens(firstUser) + middle.reduce((s, m) => s + estimateTokens(m), 0) > maxTokens) {
    // Drop the oldest turn — that means up to and including the next user msg
    // so we never leave a stray assistant or tool message at the head.
    let dropTo = 1;
    while (dropTo < middle.length && middle[dropTo].role !== 'user') dropTo++;
    middle = middle.slice(dropTo);
  }

  return [sys, firstUser, ...middle];
}

export async function persistSession(active: ActiveSession): Promise<SessionSummary | null> {
  try {
    const dir = await ensureSessionsDir();
    const baseName = `${active.id}-${safeName(active.firstPrompt, 'session')}`;
    const jsonPath = join(dir, `${baseName}.json`);

    // Compose a transcript JSON + a markdown body for the HTML export.
    const turns = collectTurns(active.messages);
    const json = {
      id: active.id,
      startedAt: active.startedAt,
      endedAt: Date.now(),
      firstPrompt: active.firstPrompt,
      turnCount: turns.length,
      web: active.web,
      templateId: active.templateId,
      turns,
    };
    await fs.writeFile(jsonPath, JSON.stringify(json, null, 2), 'utf-8');

    let htmlPath: string | null = null;
    if (turns.length > 0) {
      htmlPath = join(dir, `${baseName}.html`);
      const markdown = turnsToMarkdown(active.firstPrompt, turns);
      const html = await renderHtmlDocument({
        prompt: active.firstPrompt,
        markdown,
        web: active.web,
        generatedAt: new Date(active.startedAt),
      });
      await fs.writeFile(htmlPath, html, 'utf-8');
    }

    const workspace = getWorkspaceFolder();
    return {
      id: active.id,
      startedAt: active.startedAt,
      endedAt: json.endedAt,
      firstPrompt: active.firstPrompt,
      turnCount: turns.length,
      jsonRelativePath: relative(workspace, jsonPath),
      htmlRelativePath: htmlPath ? relative(workspace, htmlPath) : null,
    };
  } catch (err) {
    console.error('[sessions] persist failed:', err);
    return null;
  }
}

function collectTurns(messages: Message[]): SessionTurn[] {
  const turns: SessionTurn[] = [];
  let pendingUser: string | null = null;
  for (const msg of messages) {
    if (msg.role === 'user') {
      if (typeof msg.content === 'string') pendingUser = msg.content;
      else {
        const textPart = msg.content.find((p) => p.type === 'text');
        pendingUser = textPart && 'text' in textPart ? textPart.text : '';
      }
    } else if (msg.role === 'assistant') {
      const text = typeof msg.content === 'string' ? msg.content : '';
      if (pendingUser !== null) {
        turns.push({ user: pendingUser, assistant: text });
        pendingUser = null;
      }
    }
  }
  return turns;
}

function turnsToMarkdown(_firstPrompt: string, turns: SessionTurn[]): string {
  const lines: string[] = [];
  turns.forEach((t, i) => {
    lines.push(`## Turn ${i + 1}`);
    lines.push('');
    lines.push('**You asked:**');
    lines.push('');
    lines.push(`> ${t.user.replace(/\n/g, '\n> ')}`);
    lines.push('');
    lines.push('**AICursor:**');
    lines.push('');
    lines.push(t.assistant);
    lines.push('');
    if (i < turns.length - 1) lines.push('---');
    lines.push('');
  });
  return lines.join('\n');
}

export async function listSessions(): Promise<SessionSummary[]> {
  try {
    const workspace = getWorkspaceFolder();
    const dir = sessionsDir();
    const entries = await fs.readdir(dir).catch(() => [] as string[]);
    const jsons = entries.filter((f) => f.endsWith('.json'));
    const summaries: SessionSummary[] = [];
    for (const name of jsons) {
      try {
        const jsonPath = join(dir, name);
        const raw = await fs.readFile(jsonPath, 'utf-8');
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const htmlPath = jsonPath.replace(/\.json$/, '.html');
        const hasHtml = await fs
          .access(htmlPath)
          .then(() => true)
          .catch(() => false);
        // Migration: if a legacy v1.0.0 session JSON ever stored absolute
        // jsonPath / htmlPath fields inside its body, rewrite the file
        // without those fields. Current writer never emits them, so this is
        // a one-shot belt-and-braces cleanup.
        if ('jsonPath' in parsed || 'htmlPath' in parsed) {
          delete parsed.jsonPath;
          delete parsed.htmlPath;
          await fs.writeFile(jsonPath, JSON.stringify(parsed, null, 2), 'utf-8').catch(() => undefined);
        }
        summaries.push({
          id: String(parsed.id ?? name),
          startedAt: Number(parsed.startedAt ?? 0),
          endedAt: Number(parsed.endedAt ?? 0),
          firstPrompt: String(parsed.firstPrompt ?? ''),
          turnCount: Number(parsed.turnCount ?? 0),
          jsonRelativePath: relative(workspace, jsonPath),
          htmlRelativePath: hasHtml ? relative(workspace, htmlPath) : null,
        });
      } catch {
        /* skip malformed */
      }
    }
    summaries.sort((a, b) => b.startedAt - a.startedAt);
    return summaries.slice(0, 50);
  } catch (err) {
    console.error('[sessions] list failed:', err);
    return [];
  }
}

// Resolve a renderer-supplied relative path against the workspace and refuse
// anything that escapes the workspace boundary. Returns the resolved absolute
// path, or null if the input is rejected.
export function resolveSessionRelativePath(rel: string): string | null {
  if (typeof rel !== 'string' || rel.length === 0) return null;
  const workspace = getWorkspaceFolder();
  const resolved = join(workspace, rel);
  const back = relative(workspace, resolved);
  if (back.startsWith('..') || back.startsWith('/') || back.includes('..\\')) return null;
  return resolved;
}

export async function clearAllSessions(): Promise<{ removed: number }> {
  try {
    const dir = sessionsDir();
    const entries = await fs.readdir(dir).catch(() => [] as string[]);
    let removed = 0;
    for (const name of entries) {
      if (name.endsWith('.json') || name.endsWith('.html')) {
        await fs.unlink(join(dir, name)).catch(() => undefined);
        removed++;
      }
    }
    return { removed };
  } catch (err) {
    console.error('[sessions] clear failed:', err);
    return { removed: 0 };
  }
}

export function shouldPersist(): boolean {
  return getSettings().memorySaveEnabled === true;
}

export function getMaxContextTokens(): number {
  return getSettings().maxContextTokens ?? 8000;
}
