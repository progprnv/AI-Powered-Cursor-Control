// AiCursor standalone project file.
import { shell } from 'electron';
import type { ToolDefinition } from './index';

export const openUrlTool: ToolDefinition = {
  declaration: {
    type: 'function',
    function: {
      name: 'open_url',
      description:
        'Open a URL in the user\'s default browser. Use this when the user asks to "open", "show me", or "go to" a website. Always confirm the intent is clear before opening multiple URLs.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'Absolute https:// or http:// URL to open.',
          },
        },
        required: ['url'],
      },
    },
  },
  uiLabel: (args) => {
    const u = String(args.url ?? '');
    try {
      const parsed = new URL(u);
      // Show scheme + host explicitly so a phishing URL like
      // https://google.com.attacker.com/... cannot hide behind "Opening
      // google.com". The user always sees the actual origin.
      return `Opening ${parsed.protocol}//${parsed.host}`;
    } catch {
      return 'Opening URL';
    }
  },
  async execute(args) {
    const url = String(args.url ?? '').trim();
    if (!url) return 'Error: open_url requires a "url" argument.';
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return `Error: only http/https URLs can be opened.`;
      }
      await shell.openExternal(parsed.href);
      return `Opened ${parsed.href} in the user's default browser.`;
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
