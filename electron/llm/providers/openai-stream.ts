// AiCursor standalone project file.
import type { ProviderRoundResult } from './types';

// Shared SSE parser for OpenAI-compatible chat completions streams.
// Both OpenRouter and OpenAI direct emit this exact format.

type ToolCallAcc = {
  id: string;
  name: string;
  argsText: string;
};

export async function parseOpenAIStream(
  body: ReadableStream<Uint8Array>,
  onChunk: (text: string) => void,
  signal?: AbortSignal,
): Promise<ProviderRoundResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let contentText = '';
  let finishReason: string | null = null;
  const tools: ToolCallAcc[] = [];

  // When the caller aborts (ESC during a stream) we cancel the reader so the
  // underlying connection closes immediately. Without this the read loop
  // continues to drain bytes for hundreds of ms after fetch is aborted,
  // burning the user's provider quota.
  const onAbort = () => {
    try {
      void reader.cancel('aborted by user');
    } catch {
      /* reader may already be closed */
    }
  };
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    while (!signal?.aborted) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const raw of lines) {
        const line = raw.trim();
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '' || data === '[DONE]') continue;

        let json: any;
        try {
          json = JSON.parse(data);
        } catch {
          continue;
        }
        const choice = json?.choices?.[0];
        if (!choice) continue;
        if (choice.finish_reason) finishReason = choice.finish_reason;

        const delta = choice.delta;
        if (!delta) continue;

        const text: unknown = delta.content;
        if (typeof text === 'string' && text.length > 0) {
          contentText += text;
          onChunk(text);
        }

        const dtc: unknown = delta.tool_calls;
        if (Array.isArray(dtc)) {
          for (const tc of dtc) {
            const index = typeof tc.index === 'number' ? tc.index : 0;
            while (tools.length <= index) tools.push({ id: '', name: '', argsText: '' });
            const acc = tools[index];
            if (typeof tc.id === 'string' && tc.id) acc.id = tc.id;
            if (typeof tc.function?.name === 'string') acc.name = tc.function.name;
            if (typeof tc.function?.arguments === 'string') acc.argsText += tc.function.arguments;
          }
        }
      }
    }
  } finally {
    if (signal) signal.removeEventListener('abort', onAbort);
    try {
      reader.releaseLock();
    } catch {
      /* already released */
    }
  }

  const toolCalls: ProviderRoundResult['toolCalls'] = [];
  for (const acc of tools) {
    if (!acc.name) continue;
    let args: Record<string, unknown> = {};
    if (acc.argsText.trim()) {
      try {
        args = JSON.parse(acc.argsText);
      } catch {
        args = { _raw: acc.argsText };
      }
    }
    toolCalls.push({ id: acc.id || `call_${toolCalls.length}`, name: acc.name, args });
  }

  return { contentText, toolCalls, finishReason };
}
