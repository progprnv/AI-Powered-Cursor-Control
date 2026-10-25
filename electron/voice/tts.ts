// AiCursor standalone project file.
import { Buffer } from 'node:buffer';
import { getSettings } from '../store/settings';
import { HTTP_HEADERS_BASE } from '../llm/providers/types';

// Text-to-speech. Provider priority for synthesis:
//   1. OpenAI (gpt-4o-mini-tts) — fastest, cheapest, best voices
//   2. Gemini (gemini-2.5-flash-preview-tts) — works with the Gemini key
//   3. OpenRouter (forwards to providers that expose TTS)
// Returns base64-encoded MP3 audio.

const DEFAULT_OPENAI_VOICE = 'alloy';
const DEFAULT_GEMINI_VOICE = 'Charon';

export type SynthesisResult = {
  audioBase64: string;
  mimeType: string;
};

export async function synthesizeSpeech(text: string): Promise<SynthesisResult> {
  if (!text.trim()) throw new Error('Nothing to read aloud.');
  const trimmed = text.trim().slice(0, 4000);
  const settings = getSettings();

  if (settings.providers.openai?.enabled && settings.providers.openai.apiKey) {
    return synthesizeWithOpenAI(trimmed, settings.providers.openai.apiKey);
  }
  if (settings.providers.gemini?.enabled && settings.providers.gemini.apiKey) {
    return synthesizeWithGemini(trimmed, settings.providers.gemini.apiKey);
  }
  if (settings.providers.openrouter?.enabled && settings.providers.openrouter.apiKey) {
    return synthesizeWithOpenRouter(trimmed, settings.providers.openrouter.apiKey);
  }
  throw new Error(
    'No TTS-capable provider configured. Add an OpenAI, Gemini, or OpenRouter key in /settings.',
  );
}

async function synthesizeWithOpenAI(text: string, apiKey: string): Promise<SynthesisResult> {
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': HTTP_HEADERS_BASE['User-Agent'],
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini-tts',
      input: text,
      voice: DEFAULT_OPENAI_VOICE,
      response_format: 'mp3',
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenAI TTS ${res.status}: ${body.slice(0, 200) || res.statusText}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return { audioBase64: buf.toString('base64'), mimeType: 'audio/mpeg' };
}

async function synthesizeWithGemini(text: string, apiKey: string): Promise<SynthesisResult> {
  // Gemini's preview TTS model uses generateContent with audio responseModality.
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    'gemini-2.5-flash-preview-tts',
  )}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'Content-Type': 'application/json',
      ...HTTP_HEADERS_BASE,
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: DEFAULT_GEMINI_VOICE } },
        },
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Gemini TTS ${res.status}: ${body.slice(0, 200) || res.statusText}`);
  }
  const json = (await res.json()) as any;
  const part = json?.candidates?.[0]?.content?.parts?.find((p: any) => p?.inlineData);
  if (!part?.inlineData?.data) throw new Error('Gemini TTS returned no audio.');
  const mimeType = part.inlineData.mimeType ?? 'audio/wav';
  return { audioBase64: String(part.inlineData.data), mimeType };
}

async function synthesizeWithOpenRouter(text: string, apiKey: string): Promise<SynthesisResult> {
  // OpenRouter exposes OpenAI-compatible /audio/speech in 2026.
  const res = await fetch('https://openrouter.ai/api/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...HTTP_HEADERS_BASE,
    },
    body: JSON.stringify({
      model: 'openai/gpt-4o-mini-tts',
      input: text,
      voice: DEFAULT_OPENAI_VOICE,
      response_format: 'mp3',
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenRouter TTS ${res.status}: ${body.slice(0, 200) || res.statusText}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return { audioBase64: buf.toString('base64'), mimeType: 'audio/mpeg' };
}
