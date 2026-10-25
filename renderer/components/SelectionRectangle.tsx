// AiCursor standalone project file.
import { motion } from 'framer-motion';

type Props = {
  x: number;
  y: number;
  width: number;
  height: number;
};

// Visual rectangle the user is drawing while drag-selecting a custom
// screenshot region. Sits on top of the click-through overlay so it doesn't
// obstruct the underlying app being framed. Style is intentionally restrained
// (translucent fill, soft glow, lime-green border to match the AICursor
// accent) so the user sees exactly what's being captured without the rect
// itself dominating the screenshot they're about to make.
export function SelectionRectangle({ x, y, width, height }: Props) {
  return (
    <motion.div
      className="pointer-events-none absolute"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.08 }}
      style={{
        left: x,
        top: y,
        width,
        height,
        borderRadius: 8,
        border: '1.5px solid rgba(167,245,107,0.95)',
        background:
          'linear-gradient(135deg, rgba(167,245,107,0.10) 0%, rgba(167,245,107,0.04) 100%)',
        boxShadow:
          '0 0 0 1px rgba(167,245,107,0.18), 0 8px 36px -8px rgba(167,245,107,0.45), inset 0 0 0 1px rgba(255,255,255,0.04)',
        willChange: 'left, top, width, height',
      }}
    >
      <div
        className="absolute right-2 top-2 rounded-md px-1.5 py-0.5 text-[10px] font-medium leading-none"
        style={{
          background: 'rgba(20,22,18,0.78)',
          color: 'rgba(167,245,107,0.95)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
        }}
      >
        {Math.round(width)} × {Math.round(height)}
      </div>
    </motion.div>
  );
}
