// AiCursor standalone project file.
import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useState } from 'react';

type Props = {
  // Show the splash only on the very first render after the app mounts.
  // It auto-dismisses after 6s and is suppressed during AI mode.
  enabled: boolean;
  onDismiss?: () => void;
};

export function Splash({ enabled, onDismiss }: Props) {
  const [visible, setVisible] = useState(enabled);

  useEffect(() => {
    if (!enabled) {
      setVisible(false);
      return;
    }
    const fadeOut = window.setTimeout(() => setVisible(false), 6000);
    return () => window.clearTimeout(fadeOut);
  }, [enabled]);

  return (
    <AnimatePresence onExitComplete={() => onDismiss?.()}>
      {visible && (
        <motion.div
          key="splash"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ opacity: { duration: 0.4, ease: 'easeOut' } }}
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
        >
          <motion.div
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.98, opacity: 0 }}
            transition={{ type: 'spring', damping: 22, stiffness: 240 }}
            className="flex flex-col items-center gap-6"
          >
            <div className="relative flex h-32 w-32 items-center justify-center">
              {/* Outer pulsing halo */}
              <motion.span
                className="absolute inset-0 rounded-full bg-accent/20"
                animate={{ scale: [0.8, 1.4, 0.8], opacity: [0.6, 0, 0.6] }}
                transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut' }}
              />
              {/* Middle pulsing halo, offset */}
              <motion.span
                className="absolute inset-3 rounded-full bg-accent/35"
                animate={{ scale: [0.7, 1.25, 0.7], opacity: [0.5, 0, 0.5] }}
                transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut', delay: 0.3 }}
              />
              {/* Core dot, gently breathing */}
              <motion.span
                className="relative block h-10 w-10 rounded-full bg-accent shadow-halo"
                animate={{ scale: [1, 1.08, 1] }}
                transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
              />
            </div>

            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25, duration: 0.4, ease: 'easeOut' }}
              className="flex flex-col items-center gap-1"
            >
              <h1
                className="text-[44px] font-semibold tracking-tight leading-none"
                style={{
                  fontFeatureSettings: '"ss01" on',
                  color: '#fff',
                  textShadow: '0 2px 8px rgba(0,0,0,0.45), 0 1px 2px rgba(0,0,0,0.3)',
                }}
              >
                <span className="text-accent">AI</span>
                <span className="text-white dark:text-white">Cursor</span>
              </h1>
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5, duration: 0.4 }}
                className="text-[12px] font-medium uppercase tracking-[0.3em]"
                style={{
                  color: '#fff',
                  textShadow: '0 1px 3px rgba(0,0,0,0.55), 0 1px 1px rgba(0,0,0,0.4)',
                }}
              >
                hold left mouse · ask anything
              </motion.p>
            </motion.div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
