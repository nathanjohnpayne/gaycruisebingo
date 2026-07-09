import { defineConfig, devices } from '@playwright/test';
import { BASE_URL, EVENT_ID, FIRESTORE_PORT, PROJECT_ID, WEB_PORT } from './tests/e2e/support/env';

// Playwright e2e layer. `smoke.spec.ts` (w0-test-harness) needs neither
// webServer below — it drives page content directly. x-e2e-happy-path is the
// full join -> mark -> BINGO -> leaderboard round plus the ADR 0006
// offline-mark assertion, and needs both: the Firestore/Auth/Storage
// emulators `firebase.json` already pins ports for (mirrors the existing
// `npm run emulator` script — `--only auth,firestore,storage` — so this
// forks no new emulator invocation), and the app itself on a dev server.
// Both boot automatically under `npm run test:e2e` / `npx playwright test`,
// so the whole suite is a single self-contained command.
//
// KNOWN LIMITATION (specs/x-e2e-happy-path.md "Known limitation"): the
// VITE_FIREBASE_* values below point the served app at a `demo-`-prefixed,
// emulator-only project id so a stray call can never reach real Firebase —
// but `src/firebase.ts` (off-limits to this ticket) never calls
// `connectAuthEmulator`/`connectFirestoreEmulator`, so the served app still
// talks to production endpoints for that demo project (which simply do not
// exist) rather than the emulators these VITE_FIREBASE_* values might imply.
// Fixing that is a `src/firebase.ts` change outside this ticket's boundary.
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command: 'npm run emulator',
      port: FIRESTORE_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      // --host 127.0.0.1 pins the IPv4 loopback explicitly: Vite's default
      // `localhost` bind resolves to the IPv6 loopback ONLY on this host, and
      // BASE_URL (env.ts) — and every emulator host constant alongside it —
      // is the literal 127.0.0.1 Chromium then fails to reach.
      command: `npx vite dev --port ${WEB_PORT} --strictPort --host 127.0.0.1`,
      port: WEB_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        // Demo-prefixed per Firebase convention (never resolves to a real
        // Google Cloud project) — see the KNOWN LIMITATION note above.
        VITE_FIREBASE_API_KEY: 'demo-api-key',
        VITE_FIREBASE_AUTH_DOMAIN: `${PROJECT_ID}.firebaseapp.com`,
        VITE_FIREBASE_PROJECT_ID: PROJECT_ID,
        VITE_FIREBASE_STORAGE_BUCKET: `${PROJECT_ID}.appspot.com`,
        VITE_FIREBASE_MESSAGING_SENDER_ID: '000000000000',
        VITE_FIREBASE_APP_ID: '1:000000000000:web:0000000000000000000000',
        VITE_EVENT_ID: EVENT_ID,
      },
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
