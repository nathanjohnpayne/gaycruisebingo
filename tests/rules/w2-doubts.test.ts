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
// social pressure, never a gate. Pinned against the block from #16/#18 as TIGHTENED
// on PR #106 (Codex P2): createdAt is bounded near request.time (finding 3), and
// the doc id is BOUND to the payload triple `${fromUid}_${targetUid}_${itemId}`
// (round 2 finding 2 — the deterministic once-only slot raiseDoubt writes;
// mirroring the moments id↔kind binding #103/#105 so no one can squat another
// doubter's slot):
//   - create: raised BY the caller (own fromUid), ON someone else (targetUid is a
//     string ≠ the caller — no self-doubt), AGAINST a STANDING Mark (the target's
//     tally/{itemId}/markers/{targetUid} doc must exist — round 3 finding 1), with
//     a string itemId + numeric cellIndex + a near-now createdAt, AT the bound
//     slot id. A forged fromUid, a self-doubt, an unbound id, a squat of another
//     doubter's slot, and a Doubt against an unmarked (target, Prompt) pair are
//     each denied.
//   - once-only: a second create on an existing slot is a doc-exists UPDATE,
//     denied for the doubter — the cross-client duplicate backstop; counts cannot
//     inflate. The doubter's own retract (delete) + fresh create is the structural
//     re-raise escape the settled semantic keeps.
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
// The deterministic once-only slot raiseDoubt writes (src/data/doubts.ts
// doubtDocId) — the create rule binds the doc id to exactly this triple.
const slot = (fromUid: string, targetUid: string, itemId: string = ITEM) =>
  doubtPath(`${fromUid}_${targetUid}_${itemId}`);
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
// (Carol doubting Bob, at its canonical slot) so the public-read + target-satisfies
// + doubter-deletes + retract-then-re-raise invariants have something to act on.
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
    // Standing Marks for every doubt-create fixture (PR #106 round 3 finding 1):
    // the create rule requires the TARGET's Tally marker to exist, so each player
    // a test legitimately doubts is seeded as a marker of that Prompt — Alice too,
    // so the self-doubt denial turns on the self-doubt rule, not a missing marker.
    // Dave is deliberately NOT a marker anywhere (the marker-binding denial), and
    // item2 is marked by Bob only.
    const marker = (uid: string) => ({ uid, displayName: uid, markedAt: NOW() });
    await setDoc(doc(s, at(`tally/${ITEM}/markers/${ALICE}`)), marker(ALICE));
    await setDoc(doc(s, at(`tally/${ITEM}/markers/${BOB}`)), marker(BOB));
    await setDoc(doc(s, at(`tally/${ITEM}/markers/${CAROL}`)), marker(CAROL));
    await setDoc(doc(s, at(`tally/item2/markers/${BOB}`)), marker(BOB));
    await setDoc(doc(s, slot(CAROL, BOB)), doubt(CAROL, BOB));
  });
});

describe('firestore.rules — Doubts (specs/w2-doubts.md)', () => {
  it('a signed-in Player may raise a Doubt against ANOTHER Player’s marked Prompt (at its bound slot)', async () => {
    await assertSucceeds(setDoc(doc(db(ALICE), slot(ALICE, BOB)), doubt(ALICE, BOB)));
  });

  it('denies a forged fromUid — a Player cannot raise a Doubt as someone else', async () => {
    // fromUid must equal the caller (request.auth.uid) — denied twice over here:
    // the payload forges fromUid AND the slot id embeds a uid that is not Alice's.
    await assertFails(setDoc(doc(db(ALICE), slot(BOB, CAROL)), doubt(BOB, CAROL)));
  });

  it('denies a self-doubt — targetUid must be another Player (ADR 0001)', async () => {
    await assertFails(setDoc(doc(db(ALICE), slot(ALICE, ALICE)), doubt(ALICE, ALICE)));
  });

  it('enforces the shape — string itemId + numeric cellIndex + createdAt, string targetUid', async () => {
    // Each malformed write targets the slot its VALID fields would bind to, so the
    // denial turns on the shape check under test. (For a non-string itemId or
    // targetUid the id binding itself cannot even be evaluated — string + number
    // concatenation is a rules evaluation error — which also denies; either way
    // the malformed Doubt never lands.)
    await assertFails(setDoc(doc(db(ALICE), slot(ALICE, BOB)), doubt(ALICE, BOB, { itemId: 5 }))); // itemId not a string
    await assertFails(setDoc(doc(db(ALICE), slot(ALICE, BOB)), doubt(ALICE, BOB, { cellIndex: 'x' }))); // cellIndex not a number
    await assertFails(setDoc(doc(db(ALICE), slot(ALICE, BOB)), doubt(ALICE, BOB, { createdAt: 'now' }))); // createdAt not a number
    await assertFails(setDoc(doc(db(ALICE), slot(ALICE, BOB)), doubt(ALICE, BOB, { targetUid: 42 }))); // targetUid not a string
    await assertSucceeds(setDoc(doc(db(ALICE), slot(ALICE, BOB)), doubt(ALICE, BOB))); // the well-formed Doubt
  });

  it('requires the target’s STANDING Mark — a Doubt against an unmarked (target, Prompt) pair is denied (PR #106 round 3 finding 1)', async () => {
    // A Doubt is an accusation against a standing Mark (the spec's social model):
    // the create rule requires tally/{itemId}/markers/{targetUid} to EXIST, so a
    // direct-write client can no longer pre-seed Doubts against pairs the target
    // never marked and ambush their Square badge the moment they later mark it.
    const DAVE = 'dave'; // marked nothing (see the fixture seed)
    // An unmarked PLAYER on a marked Prompt: denied.
    await assertFails(setDoc(doc(db(ALICE), slot(ALICE, DAVE)), doubt(ALICE, DAVE)));
    // A marked Player on a Prompt THEY have not marked (Carol marked item1 only):
    // denied — the binding is per (target, Prompt), not per target.
    await assertFails(
      setDoc(doc(db(ALICE), slot(ALICE, CAROL, 'item2')), doubt(ALICE, CAROL, { itemId: 'item2' })),
    );
    // The same Doubt against a STANDING Mark: allowed (Bob marked item1).
    await assertSucceeds(setDoc(doc(db(ALICE), slot(ALICE, BOB)), doubt(ALICE, BOB)));
  });

  it('binds the doc id to the (doubter, target, Prompt) triple — an unbound id and a slot squat are denied (PR #106 round 2 finding 2)', async () => {
    // A well-formed payload at an arbitrary (auto-id style) doc id: denied — the
    // id must be the deterministic slot raiseDoubt writes.
    await assertFails(setDoc(doc(db(ALICE), doubtPath('d1')), doubt(ALICE, BOB)));
    // A well-formed OWN payload parked at ANOTHER doubter's slot: denied. Without
    // the binding this squat would permanently deny Carol's own raise (her create
    // would land on the doc-exists update rule) — the same denial-of-service shape
    // the moments id↔kind binding closed (#103/#105).
    await assertFails(
      setDoc(doc(db(ALICE), slot(CAROL, BOB, 'item2')), doubt(ALICE, BOB, { itemId: 'item2' })),
    );
    // The same payload at its OWN slot: allowed.
    await assertSucceeds(
      setDoc(doc(db(ALICE), slot(ALICE, BOB, 'item2')), doubt(ALICE, BOB, { itemId: 'item2' })),
    );
  });

  it('a second raise on the same slot is a doc-exists update — denied for the doubter (the cross-client duplicate backstop, round 2 finding 2)', async () => {
    await assertSucceeds(setDoc(doc(db(ALICE), slot(ALICE, BOB)), doubt(ALICE, BOB))); // the first tab wins
    // The second tab/device (same triple, fresh createdAt): doc-exists → update →
    // the doubter is neither the target nor an admin → denied. The open count can
    // never inflate, and a satisfied Doubt cannot be re-stamped open in place.
    await assertFails(setDoc(doc(db(ALICE), slot(ALICE, BOB)), doubt(ALICE, BOB, { createdAt: NOW() + 1 })));
  });

  it('the doubter may retract (delete) and re-raise the same slot — the structural re-raise escape', async () => {
    // The settled semantic (round 2 finding 2): once raised — and once satisfied —
    // the slot cannot be re-stamped in place. A FRESH demand is retract + re-raise,
    // both already allowed: the doubter deletes their own Doubt, then a create on
    // the now-empty slot is a plain create and lands with a fresh createdAt.
    await assertSucceeds(deleteDoc(doc(db(CAROL), slot(CAROL, BOB)))); // Carol retracts her seeded Doubt
    await assertSucceeds(setDoc(doc(db(CAROL), slot(CAROL, BOB)), doubt(CAROL, BOB))); // and raises it anew
  });

  it('bounds createdAt near request.time like proofs/moments — near-now accepted, far-future and far-past denied (PR #106 finding 3)', async () => {
    // An unbounded createdAt let a fast doubter clock stamp a far-future Doubt that
    // a Proof (proof.createdAt >= doubt.createdAt) can never satisfy until that
    // instant; the create rule now requires the SAME +60s / -24h window of
    // request.time that proofs + moments use. The client writes Date.now() (in
    // bounds by construction); a >24h offline queue trips the lower bound on drain
    // (accepted residual — see specs/w2-doubts.md). Three DISTINCT slots, so the
    // once-only doc-exists denial can never mask the bound under test.
    const now = Date.now();
    await assertSucceeds(setDoc(doc(db(ALICE), slot(ALICE, BOB)), doubt(ALICE, BOB, { createdAt: now }))); // near-now: accepted
    await assertFails(setDoc(doc(db(ALICE), slot(ALICE, CAROL)), doubt(ALICE, CAROL, { createdAt: now + 3600000 }))); // +1h > +60s: denied
    await assertFails(
      setDoc(doc(db(ALICE), slot(ALICE, BOB, 'item2')), doubt(ALICE, BOB, { itemId: 'item2', createdAt: now - 172800000 })),
    ); // -2d < -24h: denied
  });

  it('a Doubt write never mutates the target’s board or player — isolation (ADR 0001)', async () => {
    // Raising a Doubt is a write to the doubts collection ONLY. The doubter can
    // reach NEITHER the target's PRIVATE board (owner/admin-only) NOR their
    // self-writable player row (cross-Player writes denied by isOwner) — so a Doubt
    // structurally cannot block, unmark, or discount the Mark, nor touch stats.
    await assertSucceeds(setDoc(doc(db(ALICE), slot(ALICE, BOB)), doubt(ALICE, BOB))); // the Doubt lands
    await assertFails(
      setDoc(doc(db(ALICE), at(`boards/${BOB}`)), { uid: BOB, seed: 1, createdAt: NOW(), cells: [] }),
    ); // cannot touch the target's Board
    await assertFails(setDoc(doc(db(ALICE), at(`players/${BOB}`)), { squaresMarked: 0 })); // nor their player row
  });

  it('Doubt reads are public — the group sees the social heat (ADR 0001)', async () => {
    await assertSucceeds(getDoc(doc(db(ALICE), slot(CAROL, BOB)))); // Alice reads Carol’s Doubt of Bob
  });

  it('the doubted Player (or an admin) marks it satisfied via satisfiedAt/satisfiedProofId ONLY', async () => {
    // Bob is the target of the seeded Doubt: he answers it by attaching a Proof,
    // recorded as a satisfied* update — the social resolution, not a gate.
    await assertSucceeds(
      updateDoc(doc(db(BOB), slot(CAROL, BOB)), { satisfiedAt: NOW(), satisfiedProofId: 'p1' }),
    );
    // A non-target Player cannot mark someone else's Doubt satisfied.
    await assertFails(updateDoc(doc(db(ALICE), slot(CAROL, BOB)), { satisfiedAt: NOW() }));
    // Even the target may change ONLY the satisfied* keys — not the Doubt's content.
    await assertFails(updateDoc(doc(db(BOB), slot(CAROL, BOB)), { itemId: 'other' }));
  });

  it('the doubter (fromUid) or an admin may delete; the target may not', async () => {
    await assertFails(deleteDoc(doc(db(BOB), slot(CAROL, BOB)))); // the target is not the doubter
    await assertSucceeds(deleteDoc(doc(db(CAROL), slot(CAROL, BOB)))); // Carol raised it — she may retract
  });

  it('an admin may delete any Doubt (moderation)', async () => {
    await assertSucceeds(deleteDoc(doc(db(ADMIN), slot(CAROL, BOB))));
  });
});
