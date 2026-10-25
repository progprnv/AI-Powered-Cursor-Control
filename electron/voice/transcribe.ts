// AiCursor standalone project file.
import { Buffer } from 'node:buffer';
import { getSettings } from '../store/settings';
import { HTTP_HEADERS_BASE } from '../llm/providers/types';

// Voice transcription. We prefer Gemini direct (cheapest + works with the
// user's existing key), then OpenAI Whisper, then OpenRouter.

const LANGUAGE_LABEL: Record<string, string> = {
  en: 'English',
  de: 'German',
  fr: 'French',
  es: 'Spanish',
  it: 'Italian',
  pt: 'Portuguese',
  nl: 'Dutch',
  pl: 'Polish',
  sv: 'Swedish',
  tr: 'Turkish',
  ja: 'Japanese',
  zh: 'Chinese',
  ko: 'Korean',
  ru: 'Russian',
  ar: 'Arabic',
  hi: 'Hindi',
};

export async function transcribeAudio(audioBase64: string, mimeType: string): Promise<string> {
  const settings = getSettings();
  const language = settings.voiceLanguage && settings.voiceLanguage !== 'auto' ? settings.voiceLanguage : null;

  if (settings.providers.gemini?.enabled && settings.providers.gemini.apiKey) {
    return transcribeWithGemini(audioBase64, mimeType, settings.providers.gemini.apiKey, language);
  }
  if (settings.providers.openai?.enabled && settings.providers.openai.apiKey) {
    return transcribeWithOpenAI(audioBase64, mimeType, settings.providers.openai.apiKey, language);
  }
  if (settings.providers.openrouter?.enabled && settings.providers.openrouter.apiKey) {
    return transcribeWithOpenRouterWhisper(
      audioBase64,
      mimeType,
      settings.providers.openrouter.apiKey,
      language,
    );
  }
  throw new Error(
    'No voice-capable provider configured. Add a Gemini, OpenAI, or OpenRouter key in /settings.',
  );
}

async function transcribeWithGemini(
  audioBase64: string,
  mimeType: string,
  apiKey: string,
  language: string | null,
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    'gemini-2.5-flash',
  )}:generateContent`;
  const langHint = language
    ? `The audio is in ${LANGUAGE_LABEL[language] ?? language}. `
    : 'Detect the spoken language automatically. ';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'Content-Type': 'application/json',
      ...HTTP_HEADERS_BASE,
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `${langHint}Transcribe this audio exactly into the same language as the speaker. Output only the transcribed text, no preamble, no translation.`,
            },
            { inlineData: { mimeType, data: audioBase64 } },
          ],
        },
      ],
      generationConfig: { temperature: 0.0, maxOutputTokens: 800 },
    }),
  });
  if (!res.ok) throw new Error(`Gemini transcribe ${res.status}: ${await res.text().catch(() => '')}`);
  const json = (await res.json()) as any;
  const text = json?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? '').join('') ?? '';
  return text.trim();
}

async function transcribeWithOpenAI(
  audioBase64: string,
  mimeType: string,
  apiKey: string,
  language: string | null,
): Promise<string> {
  const blob = new Blob([Buffer.from(audioBase64, 'base64')], { type: mimeType });
  const form = new FormData();
  form.append('file', blob, `audio.${mimeType.split('/')[1]?.split(';')[0] || 'webm'}`);
  form.append('model', 'whisper-1');
  form.append('response_format', 'text');
  if (language) form.append('language', language);

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'User-Agent': HTTP_HEADERS_BASE['User-Agent'],
    },
    body: form,
  });
  if (!res.ok) throw new Error(`OpenAI transcribe ${res.status}: ${await res.text().catch(() => '')}`);
  return (await res.text()).trim();
}

async function transcribeWithOpenRouterWhisper(
  audioBase64: string,
  mimeType: string,
  apiKey: string,
  language: string | null,
): Promise<string> {
  // OpenRouter currently has no dedicated audio endpoint; fall back to using
  // the chat completions endpoint with a model that can transcribe via vision-
  // like inputs (gemini-2.5-flash via OR also accepts inline audio data URLs).
  const langHint = language
    ? `The audio is in ${LANGUAGE_LABEL[language] ?? language}. `
    : 'Detect the spoken language automatically. ';
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...HTTP_HEADERS_BASE,
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `${langHint}Transcribe the audio exactly into the same language as the speaker. Output only the transcribed text.`,
            },
            {
              type: 'input_audio',
              input_audio: { data: audioBase64, format: mimeType.includes('webm') ? 'webm' : 'wav' },
            },
          ],
        },
      ],
      max_tokens: 800,
      temperature: 0.0,
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter transcribe ${res.status}: ${await res.text().catch(() => '')}`);
  const json = (await res.json()) as any;
  return (json?.choices?.[0]?.message?.content ?? '').trim();
}
