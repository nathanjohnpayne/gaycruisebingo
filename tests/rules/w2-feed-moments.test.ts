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
// the block that shipped from #16/#18 and was TIGHTENED in PR #99 (Codex P2): the
// create rule now bounds createdAt near request.time (finding 3), and the update
// path was removed so a Moment is fully immutable (finding 4). A Moment is an
// own-beat, self-published broadcast: a Player may create ONLY a Moment carrying
// their own uid (a forged uid is denied), with a valid kind + non-empty ≤100
// displayName + a numeric, near-now createdAt; reads are public; a Moment is fully
// immutable (no update path); deletable by its owner or an admin.
//
// Two design-critical facts this suite PINS honestly (see the spec):
//   1. The doc id is CALLER-CHOSEN (no rule constrains momentId), and `update` is
//      DENIED for everyone — so a deterministic id (`${uid}-bingo`, the event-
//      singleton `first_bingo`) makes the once-only STRUCTURAL: a re-broadcast hits
//      the deny-all `update` rule and is denied, for admins exactly like everyone
//      else. This is the strongest dedup the rules allow.
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

  it('enforces the shape — valid kind, non-empty ≤100 displayName, numeric createdAt', async () => {
    const p = (id: string) => doc(db(ALICE), momentPath(id));
    await assertFails(setDoc(p('bad-kind'), moment(ALICE, { kind: 'streak' }))); // not a MomentKind
    await assertFails(setDoc(p('empty-name'), moment(ALICE, { displayName: '' }))); // empty name
    await assertFails(setDoc(p('long-name'), moment(ALICE, { displayName: 'x'.repeat(101) }))); // over cap
    await assertFails(setDoc(p('nan-time'), moment(ALICE, { createdAt: 'now' }))); // non-numeric stamp
    await assertSucceeds(setDoc(p('cap-name'), moment(ALICE, { displayName: 'x'.repeat(100) }))); // exactly the cap
  });

  it('is FULLY immutable — the caller-chosen id + create-only rule is the once-only backstop, and NO ONE (not even an admin) can update (PR #99 finding 4)', async () => {
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
    await assertSucceeds(setDoc(p('ts-now'), moment(ALICE, { createdAt: now }))); // near-now: accepted
    await assertFails(setDoc(p('ts-future'), moment(ALICE, { createdAt: now + 3600000 }))); // +1h > +60s: denied
    await assertFails(setDoc(p('ts-past'), moment(ALICE, { createdAt: now - 172800000 }))); // -2d < -24h: denied
  });

  it('does NOT reject extra media/proofId fields — no-evidence is a writer/type contract, not a rules one', async () => {
    // The create rule has no hasOnly()/keys() constraint, so extra fields pass.
    // The ADR 0002 guarantee that a Moment carries no evidence is enforced by
    // moments.ts (writes only the MomentDoc fields) and the MomentDoc type — the
    // unit test src/data/w2-feed-moments.test.ts pins the writer side.
    await assertSucceeds(
      setDoc(doc(db(ALICE), momentPath(`${ALICE}-extra`)), moment(ALICE, {
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
