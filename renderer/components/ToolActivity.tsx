// AiCursor standalone project file.
import { motion, AnimatePresence } from 'framer-motion';
import type { ToolActivityRow } from '../hooks/useLLMQuery';

type Props = {
  activities: ToolActivityRow[];
};

export function ToolActivity({ activities }: Props) {
  if (activities.length === 0) return null;
  return (
    <ul className="mb-2 flex flex-col gap-1">
      <AnimatePresence initial={false}>
        {activities.map((a) => (
          <motion.li
            key={a.id}
            initial={{ opacity: 0, y: -2, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <ActivityRow row={a} />
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}

function ActivityRow({ row }: { row: ToolActivityRow }) {
  const isError = row.status === 'error';
  const isRunning = row.status === 'running';
  const isDone = row.status === 'done';

  return (
    <div
      className={[
        'flex items-center gap-2 rounded-md border px-2.5 py-1 text-[11.5px]',
        'border-white/10 bg-white/5',
        'dark:border-neutral-900/10 dark:bg-neutral-900/5',
      ].join(' ')}
    >
      <span className="relative inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center">
        {isRunning && (
          <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-accent border-t-transparent" />
        )}
        {isDone && (
          <svg viewBox="0 0 12 12" className="h-3 w-3 text-accent" fill="none">
            <path
              d="M2.5 6.5l2.5 2.5 4.5-5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
        {isError && (
          <svg viewBox="0 0 12 12" className="h-3 w-3 text-rose-400" fill="none">
            <path
              d="M3 3l6 6M9 3l-6 6"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        )}
      </span>

      <span
        className={[
          'font-medium',
          isError
            ? 'text-rose-300 dark:text-rose-700'
            : 'text-white/90 dark:text-neutral-900/90',
        ].join(' ')}
      >
        {row.label}
      </span>

      {row.summary && !isRunning && (
        <span className="truncate text-white/55 dark:text-neutral-900/55">
          · {row.summary}
        </span>
      )}
    </div>
  );
}
