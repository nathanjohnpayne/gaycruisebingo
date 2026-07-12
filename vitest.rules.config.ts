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
    hookTimeout: 30000,
    // Run the rules test FILES serially. Every file talks to the ONE shared
    // Firestore emulator, and several suites call `clearFirestore()` in
    // `beforeEach`, which wipes an entire emulator project namespace. When two
    // files that share a projectId run concurrently, one file's clear can delete
    // the event/items doc another file's rule `get()` (isAdmin, the day-unlock
    // lookup) is mid-evaluation on, surfacing as a nondeterministic
    // "Null value error" PERMISSION_DENIED on legitimate writes. Suites already
    // use per-file projectIds to isolate data, but serial file execution is the
    // belt-and-suspenders that makes the whole layer deterministic regardless of
    // any id reuse. This is the emulator-backed analogue of a shared-fixture race.
    fileParallelism: false
  }
});
