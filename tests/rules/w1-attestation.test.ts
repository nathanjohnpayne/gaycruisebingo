import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';

// Covers specs/w1-attestation.md — the rules half of the 18+ attestation (#23).
// This PINS the EXISTING users/{uid} owner self-write that already covers
// `attestedAdultAt` (firestore.rules), so the honor-system self-attestation
// (ADR 0001) ships with NO rules change: the owner may record their own numeric
// ms-epoch stamp (create OR the merge-update the attest flow uses), a cross-user
// write is denied by isOwner, and a non-numeric stamp is denied by the shape
// guard. A reviewer who "locks down" this self-write trips a named test.

const RULES_PATH = fileURLToPath(new URL('../../firestore.rules', import.meta.url));
const [ALICE, BOB] = ['alice', 'bob'];
const NOW = () => Date.now();

let testEnv: RulesTestEnvironment;
const db = (uid: string) => testEnv.authenticatedContext(uid).firestore();

beforeAll(async () => {
  // Under `firebase emulators:exec` the host is exported here; fall back to the
  // firebase.json firestore port so a direct run still connects.
  const host = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
  const [hostname, port] = host.split(':');
  testEnv = await initializeTestEnvironment({
    // A suite-specific projectId keeps this suite's clearFirestore() from racing
    // the other rules suites' under Vitest's default file parallelism (the same
    // reason self-writable.test.ts / w0-storage-rules.test.ts use their own ids).
    projectId: 'demo-gcb-w1-attestation',
    firestore: { host: hostname, port: Number(port), rules: readFileSync(RULES_PATH, 'utf8') },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

// Seed Alice's base profile row (as ensureUserProfile would) so the attest UPDATE
// path — the real flow, where the row already exists — has a doc to stamp.
beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), `users/${ALICE}`), {
      displayName: 'Alice',
      photoURL: null,
      createdAt: NOW(),
    });
  });
});

describe('firestore.rules — 18+ self-attestation owner self-write (w1-attestation)', () => {
  it('the owner may UPDATE their own users/{uid} with a numeric attestedAdultAt', async () => {
    await assertSucceeds(
      setDoc(doc(db(ALICE), `users/${ALICE}`), { attestedAdultAt: NOW() }, { merge: true }),
    );
  });

  it('the owner may CREATE their users/{uid} carrying attestedAdultAt', async () => {
    // Bob has no seeded row; a create that includes the stamp is allowed.
    await assertSucceeds(
      setDoc(doc(db(BOB), `users/${BOB}`), {
        displayName: 'Bob',
        photoURL: null,
        createdAt: NOW(),
        attestedAdultAt: NOW(),
      }),
    );
  });

  it('a non-owner may NOT write another User’s attestedAdultAt', async () => {
    await assertFails(
      setDoc(doc(db(BOB), `users/${ALICE}`), { attestedAdultAt: NOW() }, { merge: true }),
    );
  });

  it('a non-numeric attestedAdultAt is denied by the shape guard', async () => {
    await assertFails(
      setDoc(doc(db(ALICE), `users/${ALICE}`), { attestedAdultAt: 'yes' }, { merge: true }),
    );
  });
});
