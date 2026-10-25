// AiCursor standalone project file.
export const MODELS = {
  PRIMARY: 'google/gemini-3-flash-preview',
  FALLBACK: 'google/gemini-3.1-flash-lite-preview',
} as const;

export const REASONING_EFFORT = 'minimal' as const;
export const MAX_TOKENS = 800;
export const REQUEST_TIMEOUT_MS = 30_000;
