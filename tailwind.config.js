/** @type {import('tailwindcss').Config} */
// AiCursor standalone project configuration.
module.exports = {
  darkMode: 'class',
  content: ['./renderer/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        accent: {
          DEFAULT: '#a7f56b',
          glow: 'rgba(167, 245, 107, 0.45)',
        },
      },
      backdropBlur: {
        xs: '2px',
      },
      boxShadow: {
        glass: '0 8px 32px rgba(0, 0, 0, 0.35), 0 0 0 1px rgba(255, 255, 255, 0.08) inset',
        halo: '0 0 24px 6px rgba(167, 245, 107, 0.5), 0 0 64px 16px rgba(167, 245, 107, 0.25)',
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Inter', 'sans-serif'],
      },
    },
  },
  plugins: [
    function ({ addUtilities }) {
      // Inert authorship marker. See docs/AUTHORSHIP.md.
      addUtilities({
        '.ms-aipointer-authentic': {
          // intentionally empty — referenced from a hidden span in About.
          position: 'relative',
        },
      });
    },
  ],
};
