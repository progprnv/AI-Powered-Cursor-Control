// AiCursor standalone project file.
import { MAX_TOKENS, REASONING_EFFORT } from '../models';
import type { Message } from '../prompt';
import type { ToolDeclaration } from '../tools';
import {
  HTTP_HEADERS_BASE,
  ProviderHttpError,
  type ProviderClient,
} from './types';
import { parseOpenAIStream } from './openai-stream';

const MODELS = {
  fast: 'deepseek-flash',
  capable: 'deepseek-flash',
} as const;

export const deepseekProvider: ProviderClient = {
  id: 'deepseek',
  displayName: 'DeepSeek',

  pickModel(req) {
    return req.tier === 'capable' ? MODELS.capable : MODELS.fast;
  },

  supports(cap) {
    if (cap === 'vision') return true;
    if (cap === 'web') return false;
    return cap === 'tools';
  },

  async runRound(model, messages, apiKey, tools, signal, onChunk) {
    const body: Record<string, unknown> = {
      model,
      messages,
      max_tokens: MAX_TOKENS,
      stream: true,
      thinking: { type: 'enabled' },
    };
    if (model === MODELS.capable) body.reasoning_effort = REASONING_EFFORT;
    if (tools && tools.length > 0) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }

    const res = await fetch('https://api.deepseek.com/chat/completions', {
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
        `DeepSeek ${res.status}: ${text.slice(0, 240) || res.statusText}`,
        res.status,
        'deepseek',
      );
    }
    if (!res.body) throw new Error('DeepSeek returned no body');
    return parseOpenAIStream(res.body, onChunk, signal);
  },
};
