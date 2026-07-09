import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'og-default.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Gay Cruise Bingo',
        short_name: 'Cruise Bingo',
        description: 'Live multiplayer bingo for the high seas.',
        theme_color: '#07060d',
        background_color: '#07060d',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: 'index.html'
      }
    })
  ],
  // Vitest "app" layer: jsdom so React Testing Library can mount components.
  // Only src/ specs run here — self-contained on ROOT deps alone (CI runs just
  // `npm ci` at the root). The functions specs (tests/functions/) import
  // functions/src, which pulls resend/firebase-admin declared only in
  // functions/package.json, so they run separately via `npm run test:functions`
  // (vitest.functions.config.ts, which installs functions deps first). The
  // emulator rules layer lives in vitest.rules.config.ts and the Playwright e2e
  // layer in playwright.config.ts, so `npm test` never needs a functions
  // install, a running emulator, or a browser.
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts']
  }
});
