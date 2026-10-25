import { forwardRef, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

type Props = {
  hasKey: boolean;
  webOn: boolean;
  active: boolean;
  expanded: boolean;
  onTrigger: () => void;
};

export const BottomPill = forwardRef<HTMLDivElement, Props>(function BottomPill(
  { hasKey, webOn, active, expanded: externalExpanded, onTrigger },
  ref,
) {
  // Show full pill briefly after mount as an intro flourish.
  const [introExpanded, setIntroExpanded] = useState(true);
  useEffect(() => {
    const t = window.setTimeout(() => setIntroExpanded(false), 2200);
    return () => window.clearTimeout(t);
  }, []);

  const expanded = externalExpanded || introExpanded;
  const statusColor = active ? 'bg-rose-400' : !hasKey ? 'bg-amber-400' : webOn ? 'bg-accent' : 'bg-accent/85';

  return (
    <div
      ref={ref}
      className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2"
      data-aipointer-hit="bottom-pill"
    >
      <motion.button
        type="button"
        layout
        onClick={onTrigger}
        transition={{
          layout: { type: 'spring', damping: 28, stiffness: 320, mass: 0.65 },
          backgroundColor: { duration: 0.18 },
        }}
        className={[
          'pointer-events-auto flex items-center overflow-hidden border shadow-glass cursor-pointer',
          'border-white/12 bg-neutral-900 text-white/88',
          'dark:border-neutral-900/15 dark:bg-white dark:text-neutral-900/85',
          expanded ? 'gap-2 rounded-full px-3.5 py-1.5' : 'h-6 w-6 justify-center rounded-full p-0',
        ].join(' ')}
        aria-label="Trigger AICursor"
      >
        <motion.span
          layout="position"
          className={[
            'inline-block shrink-0 rounded-full transition-colors',
            statusColor,
            expanded ? 'h-1.5 w-1.5' : 'h-2 w-2 shadow-halo',
          ].join(' ')}
        />
        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              key="label"
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -4 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="flex items-center gap-2 whitespace-nowrap text-[11px]"
            >
              <span className="font-medium tracking-wide text-white dark:text-neutral-900">AICursor</span>
              <span className="opacity-75">
                {hasKey ? 'hold Left Mouse · click here' : 'no API key · /settings'}
              </span>
              {webOn && hasKey && (
                <span className="rounded-full border border-accent/40 bg-accent/15 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider text-accent">
                  Web
                </span>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.button>
    </div>
  );
});
