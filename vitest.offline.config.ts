import { defineConfig } from 'vitest/config';

// Vitest "offline" layer (ADR 0006): the Firestore offline-persistence
// integration test talks to the Firestore + Auth emulators over the network, so
// it runs in Node (not jsdom) and is kept out of the default `npm test` run.
// Boot it via:
//   firebase emulators:exec --only auth,firestore \
//     "vitest run --config vitest.offline.config.ts"
// which exports the emulator host env vars the test reads. Scoped to
// tests/offline/ so it never claims the app (src/**), rules (tests/rules/**), or
// e2e (tests/e2e/**) layers, nor they it.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/offline/**/*.test.ts'],
    // A cold emulator boot plus the offline→reconnect round trip is slower than
    // a pure unit test.
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
