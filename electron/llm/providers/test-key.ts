// AiCursor standalone project file.
import { net } from 'electron';
import type { ProviderId } from '../../types';

// Minimal "is this key valid" probe for each provider plus, when meaningful,
// a useful extra (OpenRouter credit balance). Each probe is intentionally
// the cheapest possible call — usually a GET on a list-models or account
// endpoint — and never spends real tokens beyond the listing call.

export type ProviderTestResult =
  | { ok: true; label?: string }
  | { ok: false; error: string };

// Network helper using Electron's `net` module so the request goes through
// Chrome's network stack (same TLS/CA/proxy chain as the rest of the app)
// and doesn't depend on the renderer being open.
function request(
  url: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const r = net.request({
      url,
      method: options.method ?? 'GET',
      redirect: 'follow',
    });
    if (options.headers) {
      for (const [k, v] of Object.entries(options.headers)) {
        r.setHeader(k, v);
      }
    }
    let body = '';
    let status = 0;
    r.on('response', (res) => {
      status = res.statusCode;
      res.on('data', (chunk) => {
        body += chunk.toString('utf8');
      });
      res.on('end', () => resolve({ status, body }));
      res.on('error', reject);
    });
    r.on('error', reject);
    if (options.body) r.write(options.body);
    r.end();
  });
}

// Compact "$X.XX remaining" style label from OpenRouter's /credits payload.
// `usage` is amount spent on this key so far, `limit` is the credit cap (or
// null for pay-as-you-go). When limit is null we show usage only.
function formatOpenRouterCredits(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return 'connected';
  const data = (payload as { data?: { total_credits?: number; total_usage?: number } }).data;
  if (!data) return 'connected';
  const credits = typeof data.total_credits === 'number' ? data.total_credits : null;
  const usage = typeof data.total_usage === 'number' ? data.total_usage : null;
  if (credits !== null && usage !== null) {
    const remaining = Math.max(0, credits - usage);
    return `$${remaining.toFixed(2)} left`;
  }
  if (usage !== null) {
    return `$${usage.toFixed(2)} used`;
  }
  return 'connected';
}

async function testOpenRouter(apiKey: string): Promise<ProviderTestResult> {
  try {
    const res = await request('https://openrouter.ai/api/v1/credits', {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://aipointer.app',
        'X-Title': 'AICursor',
      },
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: 'Invalid API key' };
    }
    if (res.status >= 400) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    try {
      const json = JSON.parse(res.body);
      return { ok: true, label: formatOpenRouterCredits(json) };
    } catch {
      return { ok: true, label: 'connected' };
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

async function testAnthropic(apiKey: string): Promise<ProviderTestResult> {
  try {
    // Anthropic has no GET endpoint that validates the key without spending
    // tokens, so we hit /v1/models which authorizes but is free.
    const res = await request('https://api.anthropic.com/v1/models', {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: 'Invalid API key' };
    }
    if (res.status >= 400) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    return { ok: true, label: 'connected' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

async function testOpenAI(apiKey: string): Promise<ProviderTestResult> {
  try {
    const res = await request('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: 'Invalid API key' };
    }
    if (res.status >= 400) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    return { ok: true, label: 'connected' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

async function testGemini(apiKey: string): Promise<ProviderTestResult> {
  try {
    // Gemini takes the key as a query param, not a header.
    const res = await request(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
    );
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      return { ok: false, error: 'Invalid API key' };
    }

    if (res.status >= 400) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    return { ok: true, label: 'connected' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

async function testDeepSeek(apiKey: string): Promise<ProviderTestResult> {
  try {
    const res = await request('https://api.deepseek.com/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: 'Invalid API key' };
    }
    if (res.status >= 400) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    return { ok: true, label: 'connected' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function testProviderKey(
  provider: ProviderId,
  apiKey: string,
): Promise<ProviderTestResult> {
  const trimmed = apiKey.trim();
  if (!trimmed) return { ok: false, error: 'Empty API key' };
  switch (provider) {
    case 'openrouter':
      return testOpenRouter(trimmed);
    case 'anthropic':
      return testAnthropic(trimmed);
    case 'openai':
      return testOpenAI(trimmed);
    case 'gemini':
      return testGemini(trimmed);
    case 'deepseek':
      return testDeepSeek(trimmed);
  }
}
