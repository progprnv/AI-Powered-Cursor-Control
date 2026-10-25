// AiCursor standalone project file.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ipc } from '../lib/ipc';

type State = 'idle' | 'loading' | 'playing' | 'error';

// Web Speech API is part of Chromium and works inside Electron without any
// provider call. We use it as the universal fallback so the Read button
// always works, even when the user only has an OpenRouter key (OpenRouter
// has no native TTS endpoint).
//
// We still try the higher-quality provider TTS first when available
// (OpenAI / Gemini direct). On any failure — including "OpenRouter doesn't
// expose this" — we fall through to Web Speech silently.

function stripMarkdownForTTS(s: string): string {
  return s
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/>/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function speakViaWebSpeech(text: string, onEnd: () => void, onErr: (m: string) => void): SpeechSynthesisUtterance | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    onErr('Speech synthesis not available in this browser');
    return null;
  }
  const cleaned = stripMarkdownForTTS(text);
  if (!cleaned) {
    onErr('Nothing to read');
    return null;
  }
  // Cancel anything already speaking before starting a new utterance.
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(cleaned);
  // Let the OS pick its best matching voice for whatever language the text is in.
  u.rate = 1.02;
  u.pitch = 1.0;
  u.volume = 1.0;
  u.onend = () => onEnd();
  u.onerror = (e) => onErr(`Speech: ${e.error || 'unknown'}`);
  window.speechSynthesis.speak(u);
  return u;
}

export function useTTS() {
  const [state, setState] = useState<State>('idle');
  const [error, setError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const urlRef = useRef<string | null>(null);

  const cleanup = () => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.src = '';
      audioRef.current = null;
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    if (utteranceRef.current) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        /* ignore */
      }
      utteranceRef.current = null;
    }
  };

  const stop = useCallback(() => {
    cleanup();
    setState('idle');
  }, []);

  const fallbackToWebSpeech = (text: string) => {
    const u = speakViaWebSpeech(
      text,
      () => {
        cleanup();
        setState('idle');
      },
      (m) => {
        cleanup();
        setError(m);
        setState('error');
      },
    );
    if (u) {
      utteranceRef.current = u;
      setState('playing');
    } else {
      setState('error');
    }
  };

  const speak = useCallback(async (text: string) => {
    if (state === 'playing' || state === 'loading') {
      cleanup();
      setState('idle');
      return;
    }
    setError(null);
    setState('loading');

    const clean = stripMarkdownForTTS(text);
    if (!clean) {
      setError('Nothing to read');
      setState('error');
      return;
    }

    // Try the provider TTS first (higher quality). If it returns an
    // error — e.g. user only has OpenRouter, which has no audio/speech
    // endpoint — fall back to local Web Speech immediately so the button
    // always does something.
    try {
      const result = await ipc.synthesizeSpeech(clean);
      if ('error' in result) {
        fallbackToWebSpeech(text);
        return;
      }
      const bytes = Uint8Array.from(atob(result.audioBase64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: result.mimeType });
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      const audio = new Audio(url);
      audio.onended = () => {
        cleanup();
        setState('idle');
      };
      audio.onerror = () => {
        // Provider audio decode failed — try local synthesis.
        cleanup();
        fallbackToWebSpeech(text);
      };
      audioRef.current = audio;
      await audio.play();
      setState('playing');
    } catch {
      fallbackToWebSpeech(text);
    }
  }, [state]);

  useEffect(() => cleanup, []);

  return { state, error, speak, stop };
}
