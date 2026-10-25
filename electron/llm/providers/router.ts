// AiCursor standalone project file.
import { getSettings } from '../../store/settings';
import { buildMessages, type Message } from '../prompt';
import { getTemplate } from '../templates';
import {
  describeToolForUI,
  executeTool,
  getToolDeclarations,
  type ToolDeclaration,
} from '../tools';
import { getApprovalRequiredTools } from '../tools/approval';
import type {
  AgentContext,
  ProviderClient,
  ProviderId,
  RequestRequirements,
  StreamHandlers,
} from './types';
import { ProviderHttpError, shouldRetryStatus } from './types';
import { getAllProviders, getProvider, PROVIDER_ORDER } from './registry';
import { REQUEST_TIMEOUT_MS } from '../models';
import type { TemplateId } from '../../types';

const MAX_AGENT_ITERATIONS = 6;

export type StreamHandle = { cancel: () => void };

export type StreamOptions = {
  web?: boolean;
  templateId?: TemplateId;
  // Hook so the router can ask the renderer for approval before a destructive
  // tool runs. Returning false aborts that tool with a benign "user declined"
  // message but the conversation continues.
  requestToolApproval?: (
    callId: string,
    name: string,
    args: Record<string, unknown>,
  ) => Promise<boolean>;
  // Pre-built message history for multi-turn sessions. When provided the
  // router skips the initial buildMessages call and uses this as-is.
  existingMessages?: Message[];
};

// Build the prioritized list of providers the user has actually configured.
// Order is fixed; presence and `enabled` is the user's choice.
function resolveProviderChain(): Array<{ provider: ProviderClient; apiKey: string }> {
  const settings = getSettings();
  const chain: Array<{ provider: ProviderClient; apiKey: string }> = [];
  for (const id of PROVIDER_ORDER) {
    const cfg = settings.providers[id];
    if (!cfg || !cfg.enabled || !cfg.apiKey) continue;
    chain.push({ provider: getProvider(id), apiKey: cfg.apiKey });
  }
  return chain;
}

function filterToolsForProvider(
  provider: ProviderClient,
  tools: ToolDeclaration[],
  req: RequestRequirements,
): ToolDeclaration[] {
  if (!provider.supports('tools', req)) return [];
  return tools;
}

export function streamCompletion(
  userPrompt: string,
  imageB64: string,
  clip: string,
  handlers: StreamHandlers,
  options: StreamOptions = {},
): StreamHandle {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('timeout')), REQUEST_TIMEOUT_MS);

  (async () => {
    const chain = resolveProviderChain();
    if (chain.length === 0) {
      handlers.onError(
        'No provider configured. Type /settings to add an OpenRouter, Anthropic, OpenAI, Google Gemini, or DeepSeek key.',
      );
      return;
    }

    let systemPromptOverride: string | undefined;
    let tier: 'fast' | 'capable' = 'fast';
    let effectiveWeb = options.web ?? getSettings().webSearch;
    if (options.templateId) {
      const tpl = getTemplate(options.templateId);
      systemPromptOverride = tpl.systemPrompt;
      if (options.web === undefined) effectiveWeb = tpl.preferWeb;
      // Templates that produce long-form output deserve the capable tier.
      if (tpl.id === 'summary' || tpl.id === 'explain' || tpl.id === 'code') tier = 'capable';
    }

    const baseRequirements: RequestRequirements = {
      web: effectiveWeb,
      vision: imageB64.length > 0,
      allowTools: true,
      tier,
    };

    // Profile data only leaves the device when the user has explicitly opted
    // in via the "Personalize prompts" toggle in Settings. Default is off so
    // a populated profile from a previous version is never sent to the chosen
    // provider without an affirmative consent action.
    const personalize = getSettings().personalizePrompts === true;
    const profile = personalize ? getSettings().userProfile : null;
    const profileLine =
      profile && (profile.name || profile.role || profile.preferredLanguage)
        ? `# User profile\nThe person using AICursor is${profile.name ? ` ${profile.name}` : ''}${
            profile.role ? `, a ${profile.role}` : ''
          }${
            profile.preferredLanguage
              ? `. Prefer replies in ${profile.preferredLanguage} unless the request itself is in another language.`
              : '.'
          } Address them naturally when relevant; don't repeat the profile back at them.`
        : undefined;

    const messages: Message[] =
      options.existingMessages && options.existingMessages.length > 0
        ? options.existingMessages
        : buildMessages(userPrompt, imageB64, clip, systemPromptOverride, profileLine);
    let accumulated = '';

    const ctx: AgentContext = {
      latestAssistantText: '',
      originalPrompt: userPrompt,
      abort: controller.signal,
      requireToolApproval: async (id, name, args) => {
        if (!options.requestToolApproval) return true;
        // Read-only tools are always allowed without prompting.
        if (!getApprovalRequiredTools().has(name)) return true;
        // Destructive tools (open_url, copy_to_clipboard, save_document,
        // reveal_in_finder) ALWAYS need explicit user approval. The
        // autoApproveTools setting is intentionally not consulted here,
        // because a malicious screenshot / prompt injection could otherwise
        // drive the model into destructive actions without the user seeing.
        return options.requestToolApproval(id, name, args);
      },
    };

    let firstError: unknown = null;

    for (const { provider, apiKey } of chain) {
      const tools = filterToolsForProvider(provider, getToolDeclarations(), baseRequirements);
      try {
        await runAgenticLoopWithProvider(
          provider,
          apiKey,
          messages,
          baseRequirements,
          tools,
          controller.signal,
          handlers,
          ctx,
          (t) => {
            accumulated += t;
            ctx.latestAssistantText = accumulated;
          },
        );
        handlers.onDone();
        return;
      } catch (err) {
        if (controller.signal.aborted) {
          handlers.onError('Canceled.');
          return;
        }
        if (err instanceof ProviderHttpError && (err.status === 401 || err.status === 403)) {
          // Auth failures stop the chain. Retrying with the next provider on
          // 401 just burns more quota when the next key is likely also wrong
          // or empty. Surface the auth error cleanly so the user fixes it in
          // /settings.
          handlers.onError(
            `Auth failed for ${provider.displayName} (${err.status}). Check the API key in /settings.`,
          );
          return;
        }
        if (err instanceof ProviderHttpError && shouldRetryStatus(err.status)) {
          // Retryable status (408 / 425 / 429 / 5xx). Try the next configured
          // provider.
          console.warn(`[router] ${provider.id} failed: ${err.message}, trying next provider`);
          firstError = err;
          continue;
        }
        handlers.onError(err instanceof Error ? err.message : String(err));
        return;
      }
    }

    handlers.onError(
      firstError instanceof Error
        ? `All providers failed. Last error: ${firstError.message}`
        : 'All providers failed.',
    );
  })().finally(() => clearTimeout(timeout));

  return { cancel: () => controller.abort() };
}

async function runAgenticLoopWithProvider(
  provider: ProviderClient,
  apiKey: string,
  initialMessages: Message[],
  req: RequestRequirements,
  tools: ToolDeclaration[],
  signal: AbortSignal,
  handlers: StreamHandlers,
  ctx: AgentContext,
  onChunkSink: (text: string) => void,
): Promise<void> {
  const messages: Message[] = [...initialMessages];
  const model = provider.pickModel(req);

  for (let iteration = 0; iteration < MAX_AGENT_ITERATIONS; iteration++) {
    if (signal.aborted) throw new Error('Canceled');

    const round = await provider.runRound(
      model,
      messages,
      apiKey,
      tools.length > 0 ? tools : undefined,
      signal,
      (text) => {
        onChunkSink(text);
        handlers.onChunk(text);
      },
    );

    if (round.toolCalls.length === 0) return;

    messages.push({
      role: 'assistant',
      content: round.contentText || null,
      tool_calls: round.toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: JSON.stringify(tc.args) },
      })),
    });

    for (const call of round.toolCalls) {
      if (signal.aborted) throw new Error('Canceled');
      const label = describeToolForUI(call.name, call.args);
      handlers.onToolStart(call.id, label, call.name, call.args);

      const approved = await ctx.requireToolApproval(call.id, call.name, call.args);
      if (!approved) {
        const declineMsg = 'User declined this action.';
        handlers.onToolEnd(call.id, call.name, false, declineMsg);
        messages.push({ role: 'tool', tool_call_id: call.id, content: declineMsg });
        continue;
      }

      const result = await executeTool(call.name, call.args, ctx);
      const ok = !result.startsWith('Error:');
      const summary = ok
        ? summarizeOk(result)
        : result.replace(/^Error:\s*/, '');
      handlers.onToolEnd(call.id, call.name, ok, summary);
      // Wrap tool output in clear delimiters so the model can distinguish
      // tool-returned content from user / system instructions. Untrusted
      // text inside the delimiters must be treated as data, not as commands.
      // See system prompt "Tool output handling" section.
      const wrapped = wrapToolOutput(call.id, call.name, result);
      messages.push({ role: 'tool', tool_call_id: call.id, content: wrapped });
    }
  }

  throw new Error(`Reached the max of ${MAX_AGENT_ITERATIONS} tool iterations.`);
}

function summarizeOk(result: string): string {
  const firstLine = result.split('\n')[0]?.trim() ?? '';
  if (firstLine.length === 0) return 'done';
  if (firstLine.length > 80) return firstLine.slice(0, 80) + '…';
  return firstLine;
}

// Wrap every tool result in clearly-marked begin/end delimiters. The
// delimiters are the actual defense: paired with the system prompt's
// "tool output handling" section, they tell the model that everything in
// between is untrusted data, not instructions.
//
// We deliberately do NOT pattern-match for "ignore previous instructions"
// or similar tells. That heuristic gave false confidence: it was trivially
// bypassed by paraphrase, multilingual variants, or unicode substitution,
// and dropping it removes the temptation to lean on it instead of on the
// delimiter contract.
function wrapToolOutput(id: string, name: string, content: string): string {
  const safeId = id.replace(/[^A-Za-z0-9_-]/g, '');
  const safeName = name.replace(/[^A-Za-z0-9_-]/g, '');
  return `[TOOL_OUTPUT_BEGIN id=${safeId} name=${safeName}]\n${content}\n[TOOL_OUTPUT_END id=${safeId}]`;
}

export type { ProviderId };
