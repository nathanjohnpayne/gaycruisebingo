import { defineConfig } from 'vitest/config';

// Vitest "offline" layer (ADR 0006): the Firestore offline-persistence
// integration test talks to the Firestore + Auth emulators over the network.
// It runs under jsdom + fake-indexeddb (see tests/offline/setup.ts) so the SDK
// takes its real IndexedDB persistence path — the durable-mutation-queue
// behavior under test — instead of silently falling back to the in-memory
// cache as it does in plain Node. Kept out of the default `npm test` run.
// Boot it via:
//   firebase emulators:exec --only auth,firestore \
//     "vitest run --config vitest.offline.config.ts"
// which exports the emulator host env vars the test reads. Scoped to
// tests/offline/ so it never claims the app (src/**), rules (tests/rules/**), or
// e2e (tests/e2e/**) layers, nor they it.
export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['tests/offline/setup.ts'],
    include: ['tests/offline/**/*.test.ts'],
    // A cold emulator boot plus the offline→reload→reconnect round trip is
    // slower than a pure unit test.
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
