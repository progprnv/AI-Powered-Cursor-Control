// AiCursor standalone project file.
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';
import { resolve } from 'node:path';

// Production CSP. Strict whitelist. Any outbound connect needs to be listed
// explicitly. Renderer itself does not make network calls (everything routes
// through main), but defense in depth blocks an attacker from exfiltrating
// through a sanitizer bypass plus an https: wildcard.
//
// Provider hosts listed here cover OpenRouter, Anthropic, OpenAI, Gemini, and
// the AICursor update channel. Adding a new provider means updating this
// list. The dev CSP in renderer/index.html is permissive enough to keep Vite
// HMR working; this build-time replacement only fires in production builds.
const PROD_CONNECT_SRC = [
  "'self'",
  'https://openrouter.ai',
  'https://api.anthropic.com',
  'https://api.openai.com',
  'https://generativelanguage.googleapis.com',
  'https://aipointer.app',
].join(' ');

const PROD_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  `connect-src ${PROD_CONNECT_SRC}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

// Replaces the dev CSP meta in index.html with the production CSP. Runs only
// when Vite's `command` is `build`. Dev server keeps the permissive CSP from
// renderer/index.html so HMR over ws://localhost works.
function prodCspPlugin(): Plugin {
  return {
    name: 'aipointer-prod-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        /<meta http-equiv="Content-Security-Policy"[^>]*>/i,
        `<meta http-equiv="Content-Security-Policy" content="${PROD_CSP}" />`
      );
    },
  };
}

export default defineConfig({
  root: resolve(__dirname, 'renderer'),
  base: './',
  publicDir: resolve(__dirname, 'assets'),
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    target: 'chrome120',
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'renderer'),
      '@shared': resolve(__dirname, 'electron'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  plugins: [
    react(),
    prodCspPlugin(),
    electron({
      main: {
        entry: resolve(__dirname, 'electron/main.ts'),
        vite: {
          build: {
            outDir: resolve(__dirname, 'dist-electron'),
            rollupOptions: {
              external: ['uiohook-napi', 'sharp', 'electron-store', 'electron'],
            },
          },
        },
      },
      preload: {
        input: resolve(__dirname, 'electron/preload.ts'),
        vite: {
          build: {
            outDir: resolve(__dirname, 'dist-electron'),
            rollupOptions: {
              external: ['electron'],
            },
          },
        },
      },
    }),
  ],
});
