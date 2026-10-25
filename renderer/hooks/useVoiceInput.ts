// AiCursor standalone project file.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ipc } from '../lib/ipc';

type State = 'idle' | 'recording' | 'transcribing' | 'error';

// Web Audio voice-activity detection. We auto-stop after the user has spoken
// at least once and then been silent for SILENCE_HOLD_MS. The "level" value
// is a 0..1 RMS used by the UI to render a live waveform pulse.
const SAMPLE_INTERVAL_MS = 60;
const SILENCE_THRESHOLD = 0.018; // empirically: typing/ambient hum stays under this
const SPEECH_THRESHOLD = 0.04; // higher bar to flip "they actually spoke"
const SILENCE_HOLD_MS = 1500;
const MAX_RECORDING_MS = 25_000;

export function useVoiceInput() {
  const [state, setState] = useState<State>('idle');
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const vadIntervalRef = useRef<number | null>(null);
  const maxTimerRef = useRef<number | null>(null);

  const cleanup = () => {
    if (vadIntervalRef.current !== null) {
      window.clearInterval(vadIntervalRef.current);
      vadIntervalRef.current = null;
    }
    if (maxTimerRef.current !== null) {
      window.clearTimeout(maxTimerRef.current);
      maxTimerRef.current = null;
    }
    if (audioCtxRef.current) {
      try {
        void audioCtxRef.current.close();
      } catch {
        /* ignore */
      }
      audioCtxRef.current = null;
      analyserRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
    setLevel(0);
  };

  const stop = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') rec.stop();
    else cleanup();
  }, []);

  const start = useCallback(async (onTranscript: (text: string) => void) => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      analyserRef.current = analyser;
      const data = new Uint8Array(analyser.fftSize);

      let hasSpoken = false;
      let silenceMs = 0;

      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      const rec = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];

      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      rec.onstop = async () => {
        if (vadIntervalRef.current !== null) {
          window.clearInterval(vadIntervalRef.current);
          vadIntervalRef.current = null;
        }
        setState('transcribing');
        try {
          const blob = new Blob(chunksRef.current, { type: mime });
          if (blob.size < 1000) {
            // Effectively silence — drop quietly.
            setState('idle');
            cleanup();
            return;
          }
          const buffer = new Uint8Array(await blob.arrayBuffer());
          let binary = '';
          for (let i = 0; i < buffer.byteLength; i++) binary += String.fromCharCode(buffer[i]);
          const base64 = btoa(binary);
          const result = await ipc.transcribeAudio(base64, mime);
          if (result.startsWith('__error__:')) {
            setError(result.slice('__error__:'.length));
            setState('error');
            cleanup();
            return;
          }
          if (result.trim()) onTranscript(result.trim());
          setState('idle');
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Transcription failed');
          setState('error');
        } finally {
          cleanup();
        }
      };

      recorderRef.current = rec;
      rec.start();
      setState('recording');

      vadIntervalRef.current = window.setInterval(() => {
        analyser.getByteTimeDomainData(data);
        // RMS around 128 midpoint.
        let sumSq = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sumSq += v * v;
        }
        const rms = Math.sqrt(sumSq / data.length);
        setLevel(Math.min(1, rms * 4));

        if (rms > SPEECH_THRESHOLD) {
          hasSpoken = true;
          silenceMs = 0;
        } else if (rms < SILENCE_THRESHOLD && hasSpoken) {
          silenceMs += SAMPLE_INTERVAL_MS;
          if (silenceMs >= SILENCE_HOLD_MS) {
            stop();
          }
        } else if (!hasSpoken) {
          silenceMs = 0;
        }
      }, SAMPLE_INTERVAL_MS);

      maxTimerRef.current = window.setTimeout(() => stop(), MAX_RECORDING_MS);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Microphone access denied');
      setState('error');
      cleanup();
    }
  }, [stop]);

  useEffect(() => {
    return () => cleanup();
  }, []);

  return { state, error, level, start, stop };
}
