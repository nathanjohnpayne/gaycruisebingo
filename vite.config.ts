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
  // Only src/ unit + component specs run here; the Firestore-emulator rules
  // layer lives in vitest.rules.config.ts (node env) and the Playwright e2e
  // layer in playwright.config.ts, so `npm test` never needs a running
  // emulator or browser.
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts']
  }
});
