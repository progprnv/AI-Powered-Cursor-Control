// AiCursor standalone project file.
// Tool registry for OpenRouter function calling.
// Each tool has a JSON-schema declaration sent to the LLM, plus an executor
// that runs on the main process and returns a string result (which gets fed
// back into the agentic loop as a tool message).

import { fetchUrlTool } from './fetch-url';
import { openUrlTool } from './open-url';
import { copyClipboardTool } from './copy-clipboard';
import { saveDocumentTool } from './save-document';
import { revealInFinderTool } from './reveal-finder';
import { readClipboardTool } from './read-clipboard';

export type ToolDeclaration = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
};

export type ToolExecutionContext = {
  // The latest streamed response text so far. Useful for tools like
  // save_document that want to operate on the in-flight answer.
  latestAssistantText: string;
  originalPrompt: string;
  abort: AbortSignal;
};

export type ToolExecutor = (
  args: Record<string, unknown>,
  ctx: ToolExecutionContext,
) => Promise<string>;

export type ToolDefinition = {
  declaration: ToolDeclaration;
  execute: ToolExecutor;
  // Short verb shown in the activity UI: "Fetching", "Opening", "Saving" ...
  uiLabel: (args: Record<string, unknown>) => string;
};

export const TOOLS: Record<string, ToolDefinition> = {
  fetch_url: fetchUrlTool,
  open_url: openUrlTool,
  copy_to_clipboard: copyClipboardTool,
  save_document: saveDocumentTool,
  reveal_in_finder: revealInFinderTool,
  read_clipboard: readClipboardTool,
};

export function getToolDeclarations(): ToolDeclaration[] {
  return Object.values(TOOLS).map((t) => t.declaration);
}

export function getTool(name: string): ToolDefinition | undefined {
  return TOOLS[name];
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolExecutionContext,
): Promise<string> {
  const tool = TOOLS[name];
  if (!tool) {
    return `Error: unknown tool "${name}".`;
  }
  try {
    return await tool.execute(args, ctx);
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export function describeToolForUI(
  name: string,
  args: Record<string, unknown>,
): string {
  const tool = TOOLS[name];
  if (!tool) return `Calling ${name}…`;
  return tool.uiLabel(args);
}
