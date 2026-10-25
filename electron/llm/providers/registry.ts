// AiCursor standalone project file.
import { openRouterProvider } from './openrouter';
import { anthropicProvider } from './anthropic';
import { openaiProvider } from './openai';
import { geminiProvider } from './gemini';
import { deepseekProvider } from './deepseek';
import type { ProviderClient, ProviderId } from './types';

// Fixed priority order. Mario's rule: OpenRouter 100% first, then the rest.
export const PROVIDER_ORDER: ProviderId[] = ['openrouter', 'anthropic', 'openai', 'gemini', 'deepseek'];

const REGISTRY: Record<ProviderId, ProviderClient> = {
  openrouter: openRouterProvider,
  anthropic: anthropicProvider,
  openai: openaiProvider,
  gemini: geminiProvider,
  deepseek: deepseekProvider,
};

export function getProvider(id: ProviderId): ProviderClient {
  return REGISTRY[id];
}

export function getAllProviders(): ProviderClient[] {
  return PROVIDER_ORDER.map((id) => REGISTRY[id]);
}
