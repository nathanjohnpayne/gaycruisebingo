import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc } from 'firebase/firestore';

// Rules-emulator harness smoke. This ticket only proves the four-layer harness
// boots: the emulator comes up, firestore.rules loads, and a signed-in
// RulesTestContext can be constructed and actually talks to the emulator. The
// substantive honor-system invariants (self-writable boards/players per ADR
// 0001, every Mark publishes to the public Tally per ADR 0002) are asserted by
// the dependent w0-firestore-rules ticket that builds on this wiring.

const RULES_PATH = fileURLToPath(new URL('../../firestore.rules', import.meta.url));

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  // Under `firebase emulators:exec` the emulator host is exported here; fall
  // back to the firebase.json firestore port so a direct run still connects.
  const host = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
  const [hostname, port] = host.split(':');
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-gaycruisebingo-rules',
    firestore: {
      host: hostname,
      port: Number(port),
      rules: readFileSync(RULES_PATH, 'utf8'),
    },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

describe('firestore rules emulator harness', () => {
  it('constructs a signed-in RulesTestContext against the emulator', () => {
    const alice = testEnv.authenticatedContext('alice');
    expect(alice).toBeDefined();
    expect(alice.firestore()).toBeDefined();
  });

  it('lets a signed-in context read a profile the rules allow', async () => {
    const alice = testEnv.authenticatedContext('alice');
    // firestore.rules: `match /users/{uid} { allow read: if signedIn(); }`
    await assertSucceeds(getDoc(doc(alice.firestore(), 'users/alice')));
  });

  it('denies the same read to an unauthenticated context', async () => {
    const anon = testEnv.unauthenticatedContext();
    // Proves the emulator is enforcing firestore.rules, not open-by-default.
    await assertFails(getDoc(doc(anon.firestore(), 'users/alice')));
  });
});
