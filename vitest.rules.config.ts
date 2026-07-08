import { defineConfig } from 'vitest/config';

// Vitest "rules" layer: Firestore/Storage security-rules tests that talk to the
// Firebase emulators over the network, so they run in Node (not jsdom) and are
// kept out of the default `npm test` run. Boot them via `npm run test:rules`,
// which wraps this config in `firebase emulators:exec` so the emulator host env
// vars are set for @firebase/rules-unit-testing.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/rules/**/*.test.ts'],
    // A cold emulator boot + rules load is slower than a pure unit test.
    testTimeout: 20000,
    hookTimeout: 30000
  }
});
