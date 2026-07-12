import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';

// Phase 1.5 firestore.rules invariants (d15-firestore-rules): the day-scoped
// Board model. Boards move under events/{eventId}/days/{dayIndex}/boards/{uid},
// gated on that Day's `unlockAt`; Pending/Rejected Prompts stay invisible outside
// the Admin queue and (for `pending` only) their own submitter; and the per-day
// `firstBingo` honor doc is write-once, mirroring the Moment immutability pattern.
// This ticket is rules-only — it proves the rule SHAPE with hand-built payloads;
// the client write paths that produce them are separate Wave-1/2 tickets.
//
// The PERMISSION_DENIED lines the SDK logs to stderr are the expected assertFails
// denials, not test failures.

const RULES_PATH = fileURLToPath(new URL('../../firestore.rules', import.meta.url));
const EVENT = 'cruise';
const [ADMIN, ALICE, BOB] = ['admin-uid', 'alice', 'bob'];
const NOW = () => Date.now();

// Day 0 is UNLOCKED (unlockAt an hour in the past); Day 1 is LOCKED (an hour in
// the future). The Event doc carries `days` as a DayDef[] array, indexed by the
// path's {dayIndex} — this is the shape the Board write gate reads `unlockAt` from.
const PAST = () => NOW() - 3600_000;
const FUTURE = () => NOW() + 3600_000;

let testEnv: RulesTestEnvironment;
const db = (uid: string) => testEnv.authenticatedContext(uid).firestore();
const at = (p: string) => `events/${EVENT}/${p}`;

const board = (uid: string, dayIndex: number) => ({
  uid,
  dayIndex,
  seed: 1,
  createdAt: NOW(),
  cells: [],
});

beforeAll(async () => {
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

// Each test starts clean with a canonical Event whose `days` array has an
// unlocked Day 0 and a locked Day 1, plus pending/rejected item fixtures whose
// submitter is ALICE.
beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const s = ctx.firestore();
    await setDoc(doc(s, `events/${EVENT}`), {
      name: 'Cruise',
      status: 'active',
      admins: [ADMIN],
      settings: { reportHideThreshold: 3 },
      timezone: 'Europe/Rome',
      days: [
        { index: 0, unlockAt: PAST() },
        { index: 1, unlockAt: FUTURE() },
      ],
    });
    // A pending item submitted by ALICE, and a rejected item ALICE once submitted.
    await setDoc(doc(s, at('items/pending1')), {
      text: 'Awaiting review',
      createdBy: ALICE,
      createdAt: NOW(),
      status: 'pending',
      reportCount: 0,
      spicy: false,
    });
    await setDoc(doc(s, at('items/rejected1')), {
      text: 'Rejected for audit',
      createdBy: ALICE,
      createdAt: NOW(),
      status: 'rejected',
      reportCount: 0,
      spicy: false,
    });
  });
});

describe('d15-firestore-rules — day-scoped boards + unlock gate', () => {
  it('DENIES a Board write before that Day unlockAt (locked Day 1)', async () => {
    // Deal (create) and mark (update) both denied while the Day is locked.
    await assertFails(setDoc(doc(db(ALICE), at(`days/1/boards/${ALICE}`)), board(ALICE, 1)));
  });

  it('ALLOWS a deal (no existing doc) at/after unlockAt on an unlocked Day', async () => {
    await assertSucceeds(setDoc(doc(db(ALICE), at(`days/0/boards/${ALICE}`)), board(ALICE, 0)));
  });

  it('ALLOWS a Mark on the owner’s existing Board on an unlocked Day', async () => {
    // Seed ALICE's Day-0 board, then a self-update (a Mark) is allowed post-unlock.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), at(`days/0/boards/${ALICE}`)), board(ALICE, 0));
    });
    await assertSucceeds(
      setDoc(doc(db(ALICE), at(`days/0/boards/${ALICE}`)), board(ALICE, 0)),
    );
  });

  it('DENIES a non-owner Board write regardless of unlock state', async () => {
    // BOB cannot write ALICE's board even on the unlocked Day 0…
    await assertFails(setDoc(doc(db(BOB), at(`days/0/boards/${ALICE}`)), board(ALICE, 0)));
    // …nor on the locked Day 1.
    await assertFails(setDoc(doc(db(BOB), at(`days/1/boards/${ALICE}`)), board(ALICE, 1)));
  });
});

describe('d15-firestore-rules — pending/rejected item visibility', () => {
  it('pending item: admin ALLOWED, own submitter ALLOWED, other non-admin DENIED', async () => {
    await assertSucceeds(getDoc(doc(db(ADMIN), at('items/pending1'))));
    await assertSucceeds(getDoc(doc(db(ALICE), at('items/pending1'))));
    await assertFails(getDoc(doc(db(BOB), at('items/pending1'))));
  });

  it('rejected item: admin ALLOWED, own (former) submitter DENIED, other non-admin DENIED', async () => {
    await assertSucceeds(getDoc(doc(db(ADMIN), at('items/rejected1'))));
    await assertFails(getDoc(doc(db(ALICE), at('items/rejected1'))));
    await assertFails(getDoc(doc(db(BOB), at('items/rejected1'))));
  });
});

describe('d15-firestore-rules — day-meta firstBingo write-once', () => {
  const honor = (uid: string) => ({
    firstBingo: { uid, displayName: 'Alice', at: NOW() },
  });

  it('ALLOWS the first firstBingo write, DENIES a second write by owner or admin', async () => {
    // The achieving Player claims the per-day honor once.
    await assertSucceeds(setDoc(doc(db(ALICE), at('days/0/meta/0')), honor(ALICE)));
    // A second write to the SAME doc is a doc-exists update — denied for everyone,
    // including the original owner and an admin (no update path at all).
    await assertFails(setDoc(doc(db(ALICE), at('days/0/meta/0')), honor(ALICE)));
    await assertFails(setDoc(doc(db(ADMIN), at('days/0/meta/0')), honor(ADMIN)));
  });

  it('DENIES a forged-attribution firstBingo create (uid != caller)', async () => {
    await assertFails(setDoc(doc(db(ALICE), at('days/0/meta/0')), honor(BOB)));
  });

  it('DENIES a firstBingo create whose doc id != dayIndex', async () => {
    // The honor doc is bound to its Day (metaId == dayIndex): a self-attributed
    // payload written to any other id under days/0 is denied, so parallel honor
    // docs can't be minted at arbitrary ids to duplicate the once-per-day slot.
    await assertFails(setDoc(doc(db(ALICE), at('days/0/meta/notzero')), honor(ALICE)));
  });

  it('DENIES a firstBingo create before that Day unlockAt (locked Day 1)', async () => {
    // A future day's canonical honor doc can't be squatted before it unlocks —
    // the create is gated on unlockAt exactly like the Board write.
    await assertFails(setDoc(doc(db(ALICE), at('days/1/meta/1')), honor(ALICE)));
  });
});

describe('d15-firestore-rules — ADR-0001 posture unchanged under day scoping', () => {
  it('owner Board write ALLOWED, cross-uid DENIED, on the day-scoped path', async () => {
    // The self-writable-by-design posture still holds — now with the time gate on
    // top (Day 0 is unlocked), so the owner write is allowed and the cross-uid
    // write is denied, exactly as before the move under days/{dayIndex}.
    await assertSucceeds(setDoc(doc(db(ALICE), at(`days/0/boards/${ALICE}`)), board(ALICE, 0)));
    await assertFails(setDoc(doc(db(ALICE), at(`days/0/boards/${BOB}`)), board(BOB, 0)));
  });
});
