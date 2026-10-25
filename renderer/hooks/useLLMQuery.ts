// AiCursor standalone project file.
import { useCallback, useEffect, useState } from 'react';
import { ipc } from '../lib/ipc';
import type { TemplateId } from '../../electron/types';

export type LLMState = 'idle' | 'loading' | 'streaming' | 'done' | 'error';

export type ToolActivityRow = {
  id: string;
  name: string;
  label: string;
  status: 'running' | 'done' | 'error';
  summary?: string;
};

export type SubmitOptions = { web?: boolean; templateId?: TemplateId };

export function useLLMQuery() {
  const [state, setState] = useState<LLMState>('idle');
  const [response, setResponse] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [activities, setActivities] = useState<ToolActivityRow[]>([]);

  useEffect(() => {
    const offChunk = ipc.onLLMChunk(({ text }) => {
      setResponse((r) => r + text);
      setState((s) => (s === 'loading' || s === 'streaming' ? 'streaming' : s));
    });
    const offDone = ipc.onLLMDone(() => {
      setState((s) => (s === 'streaming' || s === 'loading' ? 'done' : s));
    });
    const offError = ipc.onLLMError(({ message }) => {
      setError(message);
      setState('error');
    });
    const offActivity = ipc.onToolActivity((a) => {
      if (a.kind === 'start') {
        setActivities((rows) => [
          ...rows,
          { id: a.id, name: a.name, label: a.label, status: 'running' },
        ]);
      } else {
        setActivities((rows) =>
          rows.map((row) =>
            row.id === a.id
              ? { ...row, status: a.ok ? 'done' : 'error', summary: a.summary }
              : row,
          ),
        );
      }
    });
    return () => {
      offChunk();
      offDone();
      offError();
      offActivity();
    };
  }, []);

  const submit = useCallback(async (prompt: string, options?: SubmitOptions) => {
    setResponse('');
    setError(null);
    setActivities([]);
    setState('loading');
    try {
      if (options?.web !== undefined || options?.templateId) {
        await ipc.queryLLMWithOptions(prompt, {
          web: options.web,
          templateId: options.templateId,
        });
      } else {
        await ipc.queryLLM(prompt);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send query');
      setState('error');
    }
  }, []);

  const reset = useCallback(() => {
    setState('idle');
    setResponse('');
    setError(null);
    setActivities([]);
  }, []);

  return { state, response, error, activities, submit, reset };
}
