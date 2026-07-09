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

// specs/w2-doubts.md — the Doubts rules contract (ADR 0001). A Doubt is one Player
// publicly asking ANOTHER to back up a marked Prompt ("pics or it didn't happen"):
// social pressure, never a gate. Pinned against the block that ships from #16/#18:
//   - create: raised BY the caller (own fromUid), ON someone else (targetUid is a
//     string ≠ the caller — no self-doubt), with a string itemId + numeric
//     cellIndex + createdAt. A forged fromUid or a self-doubt is denied.
//   - read: public (the group sees the social heat).
//   - update: the doubted Player (or an admin) may set ONLY satisfiedAt/
//     satisfiedProofId — the social "answered" resolution — nothing else.
//   - delete: the doubter (fromUid) may retract; an admin may moderate.
// The design-critical isolation this suite PINS: a Doubt write reaches the doubts
// collection ONLY. A doubter can neither mutate the target's PRIVATE board nor their
// self-writable player row, so a Doubt structurally cannot block, unmark, or discount
// the Mark (ADR 0001). The PERMISSION_DENIED lines the SDK logs are the expected
// assertFails denials.

const RULES_PATH = fileURLToPath(new URL('../../firestore.rules', import.meta.url));
const EVENT = 'cruise';
const ITEM = 'item1';
const [ADMIN, ALICE, BOB, CAROL] = ['admin-uid', 'alice', 'bob', 'carol'];
const NOW = () => Date.now();

let testEnv: RulesTestEnvironment;
const db = (uid: string) => testEnv.authenticatedContext(uid).firestore();
const at = (p: string) => `events/${EVENT}/${p}`;
const doubtPath = (id: string) => at(`doubts/${id}`);
// The Doubt shape raiseDoubt writes (src/data/doubts.ts): the rules require
// fromUid/targetUid/itemId/cellIndex/createdAt; the display names ride along.
const doubt = (fromUid: string, targetUid: string, over: Record<string, unknown> = {}) => ({
  itemId: ITEM,
  cellIndex: 3,
  fromUid,
  fromDisplayName: fromUid,
  targetUid,
  targetDisplayName: targetUid,
  createdAt: NOW(),
  ...over,
});

beforeAll(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
  const [hostname, port] = host.split(':');
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-gaycruisebingo-w2-doubts',
    firestore: { host: hostname, port: Number(port), rules: readFileSync(RULES_PATH, 'utf8') },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

// Each test starts clean with a canonical Event, a Prompt, and a foreign Doubt
// (Carol doubting Bob) so the public-read + target-satisfies + doubter-deletes
// invariants have something to act on.
beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const s = ctx.firestore();
    await setDoc(doc(s, `events/${EVENT}`), {
      name: 'Cruise', sailStart: '2026-01-01', sailEnd: '2026-01-07', status: 'active',
      defaultTheme: 'neon-playground', claimMode: 'honor', admins: [ADMIN],
      settings: { reportHideThreshold: 3 },
    });
    await setDoc(doc(s, at(`items/${ITEM}`)), {
      text: 'Saw a drag show', createdBy: ALICE, createdAt: NOW(), isFreeSpace: false,
      status: 'active', reportCount: 0,
    });
    await setDoc(doc(s, doubtPath('seed')), doubt(CAROL, BOB));
  });
});

describe('firestore.rules — Doubts (specs/w2-doubts.md)', () => {
  it('a signed-in Player may raise a Doubt against ANOTHER Player’s marked Prompt', async () => {
    await assertSucceeds(setDoc(doc(db(ALICE), doubtPath('d1')), doubt(ALICE, BOB)));
  });

  it('denies a forged fromUid — a Player cannot raise a Doubt as someone else', async () => {
    // fromUid must equal the caller (request.auth.uid).
    await assertFails(setDoc(doc(db(ALICE), doubtPath('forged')), doubt(BOB, CAROL)));
  });

  it('denies a self-doubt — targetUid must be another Player (ADR 0001)', async () => {
    await assertFails(setDoc(doc(db(ALICE), doubtPath('self')), doubt(ALICE, ALICE)));
  });

  it('enforces the shape — string itemId + numeric cellIndex + createdAt, string targetUid', async () => {
    const p = (id: string) => doc(db(ALICE), doubtPath(id));
    await assertFails(setDoc(p('bad-item'), doubt(ALICE, BOB, { itemId: 5 }))); // itemId not a string
    await assertFails(setDoc(p('bad-cell'), doubt(ALICE, BOB, { cellIndex: 'x' }))); // cellIndex not a number
    await assertFails(setDoc(p('bad-time'), doubt(ALICE, BOB, { createdAt: 'now' }))); // createdAt not a number
    await assertFails(setDoc(p('bad-target'), doubt(ALICE, BOB, { targetUid: 42 }))); // targetUid not a string
    await assertSucceeds(setDoc(p('ok'), doubt(ALICE, BOB))); // the well-formed Doubt
  });

  it('bounds createdAt near request.time like proofs/moments — near-now accepted, far-future and far-past denied (PR #106 finding 3)', async () => {
    // An unbounded createdAt let a fast doubter clock stamp a far-future Doubt that
    // a Proof (proof.createdAt >= doubt.createdAt) can never satisfy until that
    // instant; the create rule now requires the SAME +60s / -24h window of
    // request.time that proofs + moments use. The client writes Date.now() (in
    // bounds by construction); a >24h offline queue trips the lower bound on drain
    // (accepted residual — see specs/w2-doubts.md).
    const p = (id: string) => doc(db(ALICE), doubtPath(id));
    const now = Date.now();
    await assertSucceeds(setDoc(p('ts-now'), doubt(ALICE, BOB, { createdAt: now }))); // near-now: accepted
    await assertFails(setDoc(p('ts-future'), doubt(ALICE, BOB, { createdAt: now + 3600000 }))); // +1h > +60s: denied
    await assertFails(setDoc(p('ts-past'), doubt(ALICE, BOB, { createdAt: now - 172800000 }))); // -2d < -24h: denied
  });

  it('a Doubt write never mutates the target’s board or player — isolation (ADR 0001)', async () => {
    // Raising a Doubt is a write to the doubts collection ONLY. The doubter can
    // reach NEITHER the target's PRIVATE board (owner/admin-only) NOR their
    // self-writable player row (cross-Player writes denied by isOwner) — so a Doubt
    // structurally cannot block, unmark, or discount the Mark, nor touch stats.
    await assertSucceeds(setDoc(doc(db(ALICE), doubtPath('d-iso')), doubt(ALICE, BOB))); // the Doubt lands
    await assertFails(
      setDoc(doc(db(ALICE), at(`boards/${BOB}`)), { uid: BOB, seed: 1, createdAt: NOW(), cells: [] }),
    ); // cannot touch the target's Board
    await assertFails(setDoc(doc(db(ALICE), at(`players/${BOB}`)), { squaresMarked: 0 })); // nor their player row
  });

  it('Doubt reads are public — the group sees the social heat (ADR 0001)', async () => {
    await assertSucceeds(getDoc(doc(db(ALICE), doubtPath('seed')))); // Alice reads Carol’s Doubt of Bob
  });

  it('the doubted Player (or an admin) marks it satisfied via satisfiedAt/satisfiedProofId ONLY', async () => {
    // Bob is the target of the seeded Doubt: he answers it by attaching a Proof,
    // recorded as a satisfied* update — the social resolution, not a gate.
    await assertSucceeds(
      updateDoc(doc(db(BOB), doubtPath('seed')), { satisfiedAt: NOW(), satisfiedProofId: 'p1' }),
    );
    // A non-target Player cannot mark someone else's Doubt satisfied.
    await assertFails(updateDoc(doc(db(ALICE), doubtPath('seed')), { satisfiedAt: NOW() }));
    // Even the target may change ONLY the satisfied* keys — not the Doubt's content.
    await assertFails(updateDoc(doc(db(BOB), doubtPath('seed')), { itemId: 'other' }));
  });

  it('the doubter (fromUid) or an admin may delete; the target may not', async () => {
    await assertFails(deleteDoc(doc(db(BOB), doubtPath('seed')))); // the target is not the doubter
    await assertSucceeds(deleteDoc(doc(db(CAROL), doubtPath('seed')))); // Carol raised it — she may retract
  });

  it('an admin may delete any Doubt (moderation)', async () => {
    await assertSucceeds(deleteDoc(doc(db(ADMIN), doubtPath('seed'))));
  });
});
