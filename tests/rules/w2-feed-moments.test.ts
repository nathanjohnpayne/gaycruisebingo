import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc } from 'firebase/firestore';

// specs/w2-feed-moments.md — the Moments rules contract (ADR 0002). Pinned against
// the block that shipped from #16/#18, was TIGHTENED in PR #99 (Codex P2) — the
// create rule bounds createdAt near request.time (finding 3) and the update path was
// removed so a Moment is fully immutable (finding 4) — and was tightened again in #103
// to bind the doc id to the payload kind. A Moment is an own-beat, self-published
// broadcast: a Player may create ONLY a Moment carrying their own uid (a forged uid is
// denied), at the deterministic id its kind implies (issue #103), with a valid kind +
// non-empty ≤100 displayName + a numeric, near-now createdAt; reads are public; a
// Moment is fully immutable (no update path); deletable by its owner or an admin.
//
// Two design-critical facts this suite PINS honestly (see the spec):
//   1. The create rule BINDS the doc id to the payload kind (issue #103): the event-
//      singleton `first_bingo` must carry kind 'first_bingo', and every other id must
//      equal `${uid}-${kind}` — the writer's deterministic scheme (src/data/moments.ts).
//      With `update` DENIED for everyone, a re-broadcast to an already-written
//      deterministic id hits the deny-all `update` rule and is denied (admins included),
//      so the once-only dedup is STRUCTURAL — and the id can no longer be squatted with
//      a mismatched kind (the first_bingo denial-of-ceremony hole #103 closes). This is
//      the strongest dedup the rules allow.
//   2. The create rule has NO hasOnly/keys() constraint, so it does NOT reject a
//      Moment carrying extra media/proofId fields. The ADR 0002 "a Moment carries
//      no evidence" guarantee is therefore a WRITER + TYPE contract (moments.ts
//      writes exactly the MomentDoc fields; MomentDoc has no media/proofId), NOT a
//      rules-layer one — pinned here so no one mistakes the rule for enforcing it.
// The PERMISSION_DENIED lines the SDK logs are the expected assertFails denials.

const RULES_PATH = fileURLToPath(new URL('../../firestore.rules', import.meta.url));
const EVENT = 'cruise';
const [ADMIN, ALICE, BOB, CAROL] = ['admin-uid', 'alice', 'bob', 'carol'];
const NOW = () => Date.now();

let testEnv: RulesTestEnvironment;
const db = (uid: string) => testEnv.authenticatedContext(uid).firestore();
const at = (p: string) => `events/${EVENT}/${p}`;
const momentPath = (id: string) => at(`moments/${id}`);
// The Moment shape moments.ts writes: { kind, uid, displayName, photoURL, createdAt }.
const moment = (uid: string, over: Record<string, unknown> = {}) => ({
  kind: 'bingo',
  uid,
  displayName: uid,
  photoURL: null,
  createdAt: NOW(),
  ...over,
});

beforeAll(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
  const [hostname, port] = host.split(':');
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-gaycruisebingo-w2-feed-moments',
    firestore: { host: hostname, port: Number(port), rules: readFileSync(RULES_PATH, 'utf8') },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

// Each test starts clean with a canonical Event and a foreign Moment (Carol's) so
// the public-read + owner/admin-delete invariants have something to read against.
beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const s = ctx.firestore();
    await setDoc(doc(s, `events/${EVENT}`), {
      name: 'Cruise', sailStart: '2026-01-01', sailEnd: '2026-01-07', status: 'active',
      defaultTheme: 'neon-playground', claimMode: 'honor', admins: [ADMIN],
      settings: { reportHideThreshold: 3 },
      // Ten minimal Days: the per-card blackout id arm (#267) bounds its Day to
      // the schedule (`dayIndex < days.size()`), so the fixture needs a real
      // array. Entries stay minimal — only event UPDATES run the schedule lock.
      days: Array.from({ length: 10 }, (_, index) => ({ index })),
    });
    await setDoc(doc(s, momentPath(`${CAROL}-bingo`)), moment(CAROL));
  });
});

describe('firestore.rules — Feed Moments (specs/w2-feed-moments.md)', () => {
  it('a Player self-publishes their OWN Moment (BINGO / Blackout / First-to-BINGO)', async () => {
    await assertSucceeds(setDoc(doc(db(ALICE), momentPath(`${ALICE}-bingo`)), moment(ALICE)));
    await assertSucceeds(
      setDoc(doc(db(ALICE), momentPath(`${ALICE}-blackout`)), moment(ALICE, { kind: 'blackout' })),
    );
    await assertSucceeds(
      setDoc(doc(db(ALICE), momentPath('first_bingo')), moment(ALICE, { kind: 'first_bingo' })),
    );
  });

  it('denies a forged uid — a Player cannot broadcast a Moment as someone else', async () => {
    // isOwner(request.resource.data.uid) requires the doc's uid == the caller.
    await assertFails(setDoc(doc(db(ALICE), momentPath(`${BOB}-bingo`)), moment(BOB)));
    await assertFails(setDoc(doc(db(ALICE), momentPath('spoof')), moment(BOB)));
  });

  it('binds the doc id to the payload kind on create — the first_bingo singleton cannot be squatted (issue #103)', async () => {
    // The create rule binds momentId to the payload, mirroring the writer's
    // deterministic scheme (src/data/moments.ts): the event singleton `first_bingo`
    // requires kind 'first_bingo', and every other id must be `${uid}-${kind}`. Without
    // it any signed-in Player could create moments/first_bingo with a MISMATCHED kind —
    // the read-side filter (useData.ts hasCanonicalMomentId) would hide it, but a Moment
    // is fully immutable, so the legitimate First-to-BINGO create would then be denied
    // FOREVER as a doc-exists update (a denial-of-ceremony squat). Each assertion below
    // turns SOLELY on the id↔kind binding — uid, kind, displayName and createdAt are all
    // otherwise valid, so the binding is the only clause that can flip the outcome.
    const p = (id: string) => doc(db(ALICE), momentPath(id));
    // The squat: the singleton id carrying a non-first_bingo kind is DENIED (the hole).
    await assertFails(setDoc(p('first_bingo'), moment(ALICE, { kind: 'bingo' })));
    // The canonical singleton create (kind first_bingo AT id first_bingo) is ALLOWED.
    await assertSucceeds(setDoc(p('first_bingo'), moment(ALICE, { kind: 'first_bingo' })));
    // A per-Player id whose kind does not match its `${uid}-${kind}` id is DENIED:
    // `${ALICE}-bingo` carrying kind 'blackout' is not `${ALICE}-blackout`.
    await assertFails(setDoc(p(`${ALICE}-bingo`), moment(ALICE, { kind: 'blackout' })));
    // The matching per-Player create (the deterministic id the writer uses) is ALLOWED.
    await assertSucceeds(setDoc(p(`${ALICE}-blackout`), moment(ALICE, { kind: 'blackout' })));
    // The documented HARMLESS ORPHAN (specs/w2-feed-moments.md): `${uid}-first_bingo`
    // satisfies the per-Player binding (uid + '-' + kind), so the rules ALLOW the
    // create — the writer never targets it and hasCanonicalMomentId keeps it out of
    // every Feed (first_bingo renders only from the literal singleton id). Pinned so
    // a future edit cannot silently tighten or loosen this documented allowance
    // (CodeRabbit nitpick, PR #105).
    await assertSucceeds(setDoc(p(`${ALICE}-first_bingo`), moment(ALICE, { kind: 'first_bingo' })));
  });

  it('allows the PER-CARD blackout id `${uid}-blackout-d${dayIndex}` only when the id Day matches the payload (#267)', async () => {
    const p = (id: string) => doc(db(ALICE), momentPath(id));
    // The canonical per-card create: day-scoped id, matching integer dayIndex.
    await assertSucceeds(setDoc(p(`${ALICE}-blackout-d3`), moment(ALICE, { kind: 'blackout', dayIndex: 3 })));
    // A SECOND Day's card posts its own Moment — distinct id, same Player.
    await assertSucceeds(setDoc(p(`${ALICE}-blackout-d7`), moment(ALICE, { kind: 'blackout', dayIndex: 7 })));
    // The id's Day must equal the payload's dayIndex — a mismatch is denied.
    // A FRESH id (d8), not one created above: a reused id would be denied as an
    // immutable-doc update regardless, masking the create-rule condition under
    // test (Codex P3 on #277).
    await assertFails(setDoc(p(`${ALICE}-blackout-d8`), moment(ALICE, { kind: 'blackout', dayIndex: 5 })));
    // A day-suffixed id with NO dayIndex field is denied (nothing to bind to).
    await assertFails(setDoc(p(`${ALICE}-blackout-d4`), moment(ALICE, { kind: 'blackout' })));
    // A non-integer dayIndex is denied.
    await assertFails(setDoc(p(`${ALICE}-blackout-d4`), moment(ALICE, { kind: 'blackout', dayIndex: '4' })));
    // Out-of-schedule Days are denied (Codex P2 on #277): the Day must index a
    // real entry of the Event's `days` — no unbounded junk-doc minting.
    await assertFails(setDoc(p(`${ALICE}-blackout-d10`), moment(ALICE, { kind: 'blackout', dayIndex: 10 })));
    await assertFails(setDoc(p(`${ALICE}-blackout-d999999`), moment(ALICE, { kind: 'blackout', dayIndex: 999999 })));
    await assertFails(setDoc(p(`${ALICE}-blackout-d-1`), moment(ALICE, { kind: 'blackout', dayIndex: -1 })));
    // The day-scoped form is for the PER-CARD kinds only (#372 added bingo — see
    // its own test below): the event-wide `first_bingo` singleton cannot ride it,
    // or the ceremony would mint one per Day instead of one per Event.
    await assertFails(setDoc(p(`${ALICE}-first_bingo-d3`), moment(ALICE, { kind: 'first_bingo', dayIndex: 3 })));
    // Forged owner: Alice cannot create Bob's per-card blackout id.
    await assertFails(setDoc(p(`${BOB}-blackout-d3`), moment(ALICE, { kind: 'blackout', dayIndex: 3 })));
    // The legacy day-less per-Player id still works (asserted above too) — and a
    // legacy id carrying a dayIndex payload stays valid: the binding constrains
    // the day-SUFFIXED id form, not the field's presence.
    await assertSucceeds(
      setDoc(doc(db(BOB), momentPath(`${BOB}-blackout`)), moment(BOB, { kind: 'blackout', dayIndex: 2 })),
    );
  });

  it('allows the PER-CARD bingo id `${uid}-bingo-d${dayIndex}` only when the id Day matches the payload (#372)', async () => {
    const p = (id: string) => doc(db(ALICE), momentPath(id));
    // The canonical per-card create: day-scoped id, matching integer dayIndex.
    await assertSucceeds(setDoc(p(`${ALICE}-bingo-d3`), moment(ALICE, { kind: 'bingo', dayIndex: 3 })));
    // The bug this closes (#372): a SECOND Day's bingo posts its own Moment.
    // Under the pre-#372 once-per-Player `${uid}-bingo` id this create was a
    // doc-exists update on an immutable Moment, so every bingo after a Player's
    // first was silently denied and never reached the Feed.
    await assertSucceeds(setDoc(p(`${ALICE}-bingo-d7`), moment(ALICE, { kind: 'bingo', dayIndex: 7 })));
    // The id's Day must equal the payload's dayIndex — a mismatch is denied. A
    // FRESH id (d8), not one created above: a reused id would be denied as an
    // immutable-doc update regardless, masking the create-rule condition under
    // test (Codex P3 on #277).
    await assertFails(setDoc(p(`${ALICE}-bingo-d8`), moment(ALICE, { kind: 'bingo', dayIndex: 5 })));
    // A day-suffixed id with NO dayIndex field is denied (nothing to bind to).
    await assertFails(setDoc(p(`${ALICE}-bingo-d4`), moment(ALICE, { kind: 'bingo' })));
    // A non-integer dayIndex is denied.
    await assertFails(setDoc(p(`${ALICE}-bingo-d4`), moment(ALICE, { kind: 'bingo', dayIndex: '4' })));
    // Out-of-schedule Days are denied (the #277 Codex P2 bound, inherited by the
    // shared arm): the Day must index a real entry of the Event's `days`.
    await assertFails(setDoc(p(`${ALICE}-bingo-d10`), moment(ALICE, { kind: 'bingo', dayIndex: 10 })));
    await assertFails(setDoc(p(`${ALICE}-bingo-d999999`), moment(ALICE, { kind: 'bingo', dayIndex: 999999 })));
    await assertFails(setDoc(p(`${ALICE}-bingo-d-1`), moment(ALICE, { kind: 'bingo', dayIndex: -1 })));
    // Forged owner: Alice cannot create Bob's per-card bingo id.
    await assertFails(setDoc(p(`${BOB}-bingo-d3`), moment(ALICE, { kind: 'bingo', dayIndex: 3 })));
    // The legacy day-less per-Player id still works — pre-#372 clients keep
    // writing it, and a legacy id carrying a dayIndex payload stays valid: the
    // binding constrains the day-SUFFIXED id form, not the field's presence.
    await assertSucceeds(
      setDoc(doc(db(BOB), momentPath(`${BOB}-bingo`)), moment(BOB, { kind: 'bingo', dayIndex: 2 })),
    );
  });

  it('enforces the shape — valid kind, non-empty ≤100 displayName, numeric createdAt', async () => {
    // Every id here SATISFIES the #103 id↔kind binding (`${uid}-${kind}`), so the only
    // clause that can deny is the shape rule under test — never the binding. The denied
    // writes persist nothing, so they can share `${ALICE}-bingo`; the accepted one is last.
    const p = (id: string) => doc(db(ALICE), momentPath(id));
    await assertFails(setDoc(p(`${ALICE}-streak`), moment(ALICE, { kind: 'streak' }))); // not a MomentKind
    await assertFails(setDoc(p(`${ALICE}-bingo`), moment(ALICE, { displayName: '' }))); // empty name
    await assertFails(setDoc(p(`${ALICE}-bingo`), moment(ALICE, { displayName: 'x'.repeat(101) }))); // over cap
    await assertFails(setDoc(p(`${ALICE}-bingo`), moment(ALICE, { createdAt: 'now' }))); // non-numeric stamp
    await assertSucceeds(setDoc(p(`${ALICE}-bingo`), moment(ALICE, { displayName: 'x'.repeat(100) }))); // exactly the cap
  });

  it('is FULLY immutable — the deterministic id + create-only rule is the once-only backstop, and NO ONE (not even an admin) can update (PR #99 finding 4)', async () => {
    // The strongest dedup the rules allow: a deterministic id makes a re-broadcast a
    // doc-exists `update`, which is DENIED for everyone — a Moment has no update
    // path. So a duplicate BINGO / First-to-BINGO can never post, and an admin
    // cannot overwrite an existing Moment (which would clobber the first_bingo
    // singleton under a stale-roster race). MomentDoc has no moderation field to
    // change; moderation here is delete-only (a status field is deferred to #37/#41).
    // moments.ts relies on exactly this.
    const id = `${ALICE}-bingo`;
    await assertSucceeds(setDoc(doc(db(ALICE), momentPath(id)), moment(ALICE))); // create wins
    await assertFails(setDoc(doc(db(ALICE), momentPath(id)), moment(ALICE, { displayName: 'again' }))); // owner re-broadcast denied
    // An admin repeat-broadcast AND an admin content rewrite are BOTH denied now —
    // the admin update path is gone, so an admin-player is dedup'd like everyone else.
    await assertFails(setDoc(doc(db(ADMIN), momentPath(id)), moment(ALICE))); // admin repeat-broadcast denied
    await assertFails(setDoc(doc(db(ADMIN), momentPath(id)), moment(ALICE, { displayName: 'moderated' }))); // admin content rewrite denied
  });

  it('bounds createdAt near request.time like proofs — in-bounds accepted, far-future and far-past denied (PR #99 finding 3)', async () => {
    // An unbounded createdAt let a bad clock or a forged far-future stamp pin a
    // Moment above all Feed activity forever; the create rule now requires the same
    // +60s / -24h window proofs uses. The client writes Date.now() (in bounds by
    // construction); an offline Moment drains with its ORIGINAL stamp, so a >24h
    // offline queue would trip the lower bound (accepted residual — see the spec).
    const p = (id: string) => doc(db(ALICE), momentPath(id));
    const now = Date.now();
    // Canonical id (`${uid}-bingo`) so only the createdAt bound decides each outcome —
    // the #103 id↔kind binding is satisfied. The denied writes persist nothing, so the
    // accepted case reuses the same id last.
    await assertFails(setDoc(p(`${ALICE}-bingo`), moment(ALICE, { createdAt: now + 3600000 }))); // +1h > +60s: denied
    await assertFails(setDoc(p(`${ALICE}-bingo`), moment(ALICE, { createdAt: now - 172800000 }))); // -2d < -24h: denied
    await assertSucceeds(setDoc(p(`${ALICE}-bingo`), moment(ALICE, { createdAt: now }))); // near-now: accepted
  });

  it('does NOT reject extra media/proofId fields — no-evidence is a writer/type contract, not a rules one', async () => {
    // The create rule has no hasOnly()/keys() constraint, so extra fields pass.
    // The ADR 0002 guarantee that a Moment carries no evidence is enforced by
    // moments.ts (writes only the MomentDoc fields) and the MomentDoc type — the
    // unit test src/data/w2-feed-moments.test.ts pins the writer side.
    await assertSucceeds(
      // Canonical id (`${uid}-bingo`, kind bingo) — the id↔kind binding (#103) still
      // does not gate extra fields; that stays a writer/type contract, not a rules one.
      setDoc(doc(db(ALICE), momentPath(`${ALICE}-bingo`)), moment(ALICE, {
        mediaURL: 'https://firebasestorage.example/x.jpg',
        proofId: 'p1',
      })),
    );
  });

  it('Moment reads are public — the Feed everyone watches (ADR 0002)', async () => {
    await assertSucceeds(getDoc(doc(db(BOB), momentPath(`${CAROL}-bingo`)))); // Bob reads Carol's beat
  });

  it('an owner deletes their own Moment; a peer cannot delete another’s', async () => {
    const mine = doc(db(ALICE), momentPath(`${ALICE}-bingo`));
    await assertSucceeds(setDoc(mine, moment(ALICE)));
    await assertSucceeds(deleteDoc(mine)); // owner may retract their own
    await assertFails(deleteDoc(doc(db(BOB), momentPath(`${CAROL}-bingo`)))); // a peer may not moderate
  });

  it('an admin may delete any Moment', async () => {
    await assertSucceeds(deleteDoc(doc(db(ADMIN), momentPath(`${CAROL}-bingo`))));
  });
});
