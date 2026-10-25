// AiCursor standalone project file.
import { saveResponse } from '../../save/save';
import type { ToolDefinition } from './index';

export const saveDocumentTool: ToolDefinition = {
  declaration: {
    type: 'function',
    function: {
      name: 'save_document',
      description:
        'Open a native Save dialog so the user can save the current response to disk. Use this when the user asks to "save this", "export as PDF/HTML/Markdown", "write me a brief", or finishes a long write-up. Default format is HTML (A4 styled, prints to PDF).',
      parameters: {
        type: 'object',
        properties: {
          suggested_name: {
            type: 'string',
            description:
              'Optional short filename suggestion (without extension), used as the dialog\'s default name.',
          },
          content: {
            type: 'string',
            description:
              'Optional markdown body to save. If omitted, the current assistant response is used.',
          },
        },
      },
    },
  },
  uiLabel: () => 'Saving document',
  async execute(args, ctx) {
    const markdown = String(args.content ?? '').trim() || ctx.latestAssistantText.trim();
    if (!markdown) {
      return 'Error: no content to save. Generate the document content first, then call save_document.';
    }
    const rawSuggested = String(args.suggested_name ?? '').trim();
    // Strip path-traversal markers and characters that confuse the save
    // dialog. The dialog itself normalizes the final path, but we keep the
    // suggestion clean so the user sees a sensible default filename.
    const suggested = rawSuggested
      .replace(/[\\/]/g, '-')
      .replace(/\.\.+/g, '')
      .replace(/[\x00-\x1F<>:"|?*]/g, '')
      .slice(0, 80)
      .trim();
    const promptForName = suggested || ctx.originalPrompt || 'AICursor response';
    const result = await saveResponse({
      prompt: promptForName,
      markdown,
      web: false,
    });
    if (result.ok) {
      return `Saved as ${result.format.toUpperCase()} to ${result.path}.`;
    }
    if (result.canceled) {
      return 'User canceled the save dialog.';
    }
    return `Error saving document: ${result.error ?? 'unknown'}`;
  },
};
