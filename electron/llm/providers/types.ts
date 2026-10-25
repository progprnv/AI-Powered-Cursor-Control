// AiCursor standalone project file.
import type { Message } from '../prompt';
import type { ToolDeclaration } from '../tools';

export type ProviderId = 'openrouter' | 'anthropic' | 'openai' | 'gemini' | 'deepseek';

export type ModelCapability = 'vision' | 'tools' | 'web';

export type ProviderConfig = {
  id: ProviderId;
  apiKey: string;
  enabled: boolean;
};

export type StreamHandlers = {
  onChunk: (text: string) => void;
  onToolStart: (id: string, label: string, name: string, args: unknown) => void;
  onToolEnd: (id: string, name: string, ok: boolean, summary: string) => void;
  onDone: () => void;
  onError: (msg: string) => void;
};

export type RequestRequirements = {
  // Whether the user wants web-grounded answer.
  web: boolean;
  // True if the request has an image (vision needed).
  vision: boolean;
  // True if tool use is desired for this turn (default true).
  allowTools: boolean;
  // 'fast' for quick Q&A, 'capable' for /summary, /brief etc.
  tier: 'fast' | 'capable';
};

export type ProviderRoundResult = {
  contentText: string;
  toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }>;
  finishReason: string | null;
};

export type AgentContext = {
  latestAssistantText: string;
  originalPrompt: string;
  abort: AbortSignal;
  requireToolApproval: (
    callId: string,
    name: string,
    args: Record<string, unknown>,
  ) => Promise<boolean>;
};

export interface ProviderClient {
  id: ProviderId;
  displayName: string;
  // Pick the best model for the request. Returns the provider-specific
  // model identifier the provider's runRound will use.
  pickModel(req: RequestRequirements): string;
  // Whether this provider+model can handle the given capability for this
  // request. The router uses this to gate which tools are advertised
  // (e.g. drop tools entirely if the chosen model has no tool support).
  supports(capability: ModelCapability, req: RequestRequirements): boolean;
  // Run one streaming round against the provider. Returns the model's
  // content + any tool calls it requested. The router handles the
  // multi-turn agentic loop on top of this.
  runRound(
    model: string,
    messages: Message[],
    apiKey: string,
    tools: ToolDeclaration[] | undefined,
    signal: AbortSignal,
    onChunk: (text: string) => void,
  ): Promise<ProviderRoundResult>;
}

export const HTTP_HEADERS_BASE = {
  'HTTP-Referer': 'https://aipointer.app',
  'X-Title': 'AICursor',
  'User-Agent': 'AICursor/1.0.0 (https://aipointer.app)',
} as const;

export class ProviderHttpError extends Error {
  constructor(
    message: string,
    public status: number,
    public provider: ProviderId,
  ) {
    super(message);
  }
}

export function shouldRetryStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status < 600);
}
