import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

// specs/feed-hearts.md — the Hearts rules contract. A Heart is one Player's
// like on a Feed post (a Proof or a Moment): the Doubt slot's structure
// without the accusation. Pinned invariants:
//   - create: OWN uid only, exactly the contract's four fields, a real
//     targetKind, the doc id BOUND to `${uid}_${targetKind}_${targetId}` (no
//     squatting another Player's slot), the hearted post must EXIST as its
//     declared kind, and createdAt sits in the shared +60s/-24h window.
//   - once-only: a second create on an existing slot is a doc-exists UPDATE —
//     denied (there is NO update rule at all; a Heart is immutable), so "a
//     user may heart many posts, but may heart them only once" is structural.
//   - toggle: the owner (or an admin) deletes; unheart-then-reheart is
//     delete + fresh create.
//   - read: public (the group sees the love).

const RULES_PATH = fileURLToPath(new URL('../../firestore.rules', import.meta.url));
const EVENT = 'cruise';
const [ADMIN, ALICE, BOB] = ['admin-uid', 'alice', 'bob'];
const PROOF = 'proof1';
const MOMENT = 'moment1';
const NOW = () => Date.now();

let testEnv: RulesTestEnvironment;
const db = (uid: string) => testEnv.authenticatedContext(uid).firestore();
const at = (p: string) => `events/${EVENT}/${p}`;
// The deterministic once-only slot toggleHeart writes (src/data/hearts.ts
// heartDocId) — the create rule binds the doc id to exactly this triple.
const slot = (uid: string, kind: string, targetId: string) =>
  at(`hearts/${uid}_${kind}_${targetId}`);
const heart = (uid: string, kind: string, targetId: string, over: Record<string, unknown> = {}) => ({
  uid,
  targetKind: kind,
  targetId,
  createdAt: NOW(),
  ...over,
});

beforeAll(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
  const [hostname, port] = host.split(':');
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-gaycruisebingo-feed-hearts',
    firestore: { host: hostname, port: Number(port), rules: readFileSync(RULES_PATH, 'utf8') },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

// Each test starts clean with a canonical Event, one Proof, one Moment, and
// Bob's standing heart on the Proof (at its canonical slot), so the read /
// once-only / delete invariants have something to act on.
beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const s = ctx.firestore();
    await setDoc(doc(s, `events/${EVENT}`), {
      name: 'Cruise', sailStart: '2026-01-01', sailEnd: '2026-01-07', status: 'active',
      defaultTheme: 'neon-playground', claimMode: 'honor', admins: [ADMIN],
      settings: { reportHideThreshold: 3 },
    });
    await setDoc(doc(s, at(`proofs/${PROOF}`)), {
      uid: BOB, displayName: BOB, photoURL: null, itemText: 'Saw a drag show',
      type: 'text', text: 'It happened.', status: 'active', reportCount: 0, createdAt: NOW(),
    });
    await setDoc(doc(s, at(`moments/${MOMENT}`)), {
      kind: 'bingo', uid: BOB, displayName: BOB, photoURL: null, createdAt: NOW(),
    });
    await setDoc(doc(s, slot(BOB, 'proof', PROOF)), heart(BOB, 'proof', PROOF));
  });
});

describe('firestore.rules — Hearts (specs/feed-hearts.md)', () => {
  it('a signed-in Player may heart an existing Proof at their bound slot', async () => {
    await assertSucceeds(setDoc(doc(db(ALICE), slot(ALICE, 'proof', PROOF)), heart(ALICE, 'proof', PROOF)));
  });

  it('a signed-in Player may heart an existing Moment at their bound slot', async () => {
    await assertSucceeds(setDoc(doc(db(ALICE), slot(ALICE, 'moment', MOMENT)), heart(ALICE, 'moment', MOMENT)));
  });

  it('denies a forged uid — a Player cannot heart as someone else', async () => {
    await assertFails(setDoc(doc(db(ALICE), slot(BOB, 'moment', MOMENT)), heart(BOB, 'moment', MOMENT)));
  });

  it('denies an unbound doc id — no squatting another Player’s slot', async () => {
    // Alice's own valid payload, parked at Bob's would-be slot id.
    await assertFails(setDoc(doc(db(ALICE), slot(BOB, 'proof', PROOF)), heart(ALICE, 'proof', PROOF)));
    // ...and at an arbitrary id.
    await assertFails(setDoc(doc(db(ALICE), at('hearts/free-form-id')), heart(ALICE, 'proof', PROOF)));
  });

  it('denies hearting a post that does not exist (either kind)', async () => {
    await assertFails(setDoc(doc(db(ALICE), slot(ALICE, 'proof', 'ghost')), heart(ALICE, 'proof', 'ghost')));
    await assertFails(setDoc(doc(db(ALICE), slot(ALICE, 'moment', 'ghost')), heart(ALICE, 'moment', 'ghost')));
    // A real doc id under the WRONG declared kind is a phantom too.
    await assertFails(setDoc(doc(db(ALICE), slot(ALICE, 'moment', PROOF)), heart(ALICE, 'moment', PROOF)));
  });

  it('denies an unknown targetKind and extra fields', async () => {
    await assertFails(setDoc(doc(db(ALICE), slot(ALICE, 'tally', PROOF)), heart(ALICE, 'tally', PROOF)));
    await assertFails(
      setDoc(doc(db(ALICE), slot(ALICE, 'proof', PROOF)), heart(ALICE, 'proof', PROOF, { displayName: 'Alice' })),
    );
  });

  it('denies a far-future or ancient createdAt (the shared clock window)', async () => {
    await assertFails(
      setDoc(doc(db(ALICE), slot(ALICE, 'proof', PROOF)), heart(ALICE, 'proof', PROOF, { createdAt: NOW() + 3600000 })),
    );
    await assertFails(
      setDoc(doc(db(ALICE), slot(ALICE, 'proof', PROOF)), heart(ALICE, 'proof', PROOF, { createdAt: NOW() - 172800000 })),
    );
  });

  it('once-only: a second create on the standing slot is a doc-exists update — denied', async () => {
    await assertFails(setDoc(doc(db(BOB), slot(BOB, 'proof', PROOF)), heart(BOB, 'proof', PROOF)));
  });

  it('no update path at all — not even the owner mutates a Heart in place', async () => {
    await assertFails(updateDoc(doc(db(BOB), slot(BOB, 'proof', PROOF)), { createdAt: NOW() }));
    await assertFails(updateDoc(doc(db(ADMIN), slot(BOB, 'proof', PROOF)), { createdAt: NOW() }));
  });

  it('the owner unhearts (deletes) their own Heart; others cannot', async () => {
    await assertFails(deleteDoc(doc(db(ALICE), slot(BOB, 'proof', PROOF))));
    await assertSucceeds(deleteDoc(doc(db(BOB), slot(BOB, 'proof', PROOF))));
  });

  it('unheart-then-reheart works: delete + fresh create at the same slot', async () => {
    await assertSucceeds(deleteDoc(doc(db(BOB), slot(BOB, 'proof', PROOF))));
    await assertSucceeds(setDoc(doc(db(BOB), slot(BOB, 'proof', PROOF)), heart(BOB, 'proof', PROOF)));
  });

  it('an admin may delete any Heart (moderation)', async () => {
    await assertSucceeds(deleteDoc(doc(db(ADMIN), slot(BOB, 'proof', PROOF))));
  });

  it('hearts are publicly readable to signed-in Players, never to signed-out', async () => {
    await assertSucceeds(getDoc(doc(db(ALICE), slot(BOB, 'proof', PROOF))));
    await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), slot(BOB, 'proof', PROOF))));
  });
});
