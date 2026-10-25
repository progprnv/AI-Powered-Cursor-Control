// AiCursor standalone project file.
import { MAX_TOKENS, REASONING_EFFORT } from '../models';
import type { Message } from '../prompt';
import type { ToolDeclaration } from '../tools';
import {
  HTTP_HEADERS_BASE,
  ProviderHttpError,
  type ProviderClient,
  type ProviderRoundResult,
  type RequestRequirements,
} from './types';
import { parseOpenAIStream } from './openai-stream';

// OpenRouter routes to many underlying models. We pick the cheapest +
// fastest model that satisfies the request capabilities.

const MODELS = {
  fast: 'google/gemini-3-flash-preview',
  fastFallback: 'google/gemini-3.1-flash-lite-preview',
  capable: 'google/gemini-3-flash-preview',
} as const;

function applyOnlineSuffix(model: string, online: boolean): string {
  if (!online) return model;
  if (model.endsWith(':online')) return model;
  return `${model}:online`;
}

export const openRouterProvider: ProviderClient = {
  id: 'openrouter',
  displayName: 'OpenRouter',

  pickModel(req) {
    const base = req.tier === 'capable' ? MODELS.capable : MODELS.fast;
    return applyOnlineSuffix(base, req.web);
  },

  supports() {
    // OpenRouter's Gemini 3 Flash supports vision, tools, and :online web.
    return true;
  },

  async runRound(model, messages, apiKey, tools, signal, onChunk) {
    const body: Record<string, unknown> = {
      model,
      messages,
      reasoning: { effort: REASONING_EFFORT },
      max_tokens: MAX_TOKENS,
      stream: true,
    };
    if (tools && tools.length > 0) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...HTTP_HEADERS_BASE,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ProviderHttpError(
        `OpenRouter ${res.status}: ${text.slice(0, 240) || res.statusText}`,
        res.status,
        'openrouter',
      );
    }
    if (!res.body) throw new Error('OpenRouter returned no body');

    return parseOpenAIStream(res.body, onChunk, signal);
  },
};
