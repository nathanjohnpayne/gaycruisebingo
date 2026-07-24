import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, writeBatch } from 'firebase/firestore';

// specs/echo-marks.md — the rules side of Echo Marks (#446):
//   1. the day-board write gate accepts the MULTI-BOARD echo batch (the mark's
//      board + echoed sibling boards + the ONE player write + the Tally
//      marker), each board write carrying ITS OWN markSeed;
//   2. a stale or BORROWED markSeed on an echoed board is rejected — the
//      stale-write gate is per-board;
//   3. `boardPristine()`'s echo exemption: an echo-only card is still
//      reshuffleable, a manually-marked one is not.
//
// The PERMISSION_DENIED lines the SDK logs to stderr are the expected
// assertFails denials, not test failures.

const RULES_PATH = fileURLToPath(new URL('../../firestore.rules', import.meta.url));
const EVENT = 'cruise';
const ALICE = 'alice';
const NOW = () => Date.now();
const PAST = () => NOW() - 3_600_000;

let testEnv: RulesTestEnvironment;
const db = (uid: string) => testEnv.authenticatedContext(uid).firestore();

/** A 25-cell board; overrides are per-index patches. */
function cells(overrides: Record<number, Record<string, unknown>> = {}) {
  return Array.from({ length: 25 }, (_, index) => ({
    index,
    itemId: index === 12 ? null : `i${index}`,
    text: index === 12 ? 'FREE' : `Prompt ${index}`,
    free: index === 12,
    marked: index === 12,
    markedAt: null,
    ...(overrides[index] ?? {}),
  }));
}

const board = (uid: string, dayIndex: number, seed: number, overrides: Record<number, Record<string, unknown>> = {}) => ({
  uid,
  dayIndex,
  seed,
  createdAt: NOW(),
  cells: cells(overrides),
});

const dayBoardPath = (dayIndex: number, uid: string) => `events/${EVENT}/days/${dayIndex}/boards/${uid}`;

beforeAll(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
  const [hostname, port] = host.split(':');
  testEnv = await initializeTestEnvironment({
    // Unique per-file projectId so this suite's clearFirestore never races
    // another concurrently-running rules file's seed (the house convention).
    projectId: 'demo-gaycruisebingo-echo-marks',
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

// Three unlocked Days; Alice holds a card on each with distinct seeds, and a
// player row with zeroed aggregates.
beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.firestore();
    await setDoc(doc(d, `events/${EVENT}`), {
      name: 'Cruise',
      status: 'active',
      admins: [],
      days: [
        { index: 0, unlockAt: PAST(), pool: 'main', tutorial: false },
        { index: 1, unlockAt: PAST(), pool: 'main', tutorial: false },
        { index: 2, unlockAt: PAST(), pool: 'main', tutorial: false },
      ],
    });
    await setDoc(doc(d, `events/${EVENT}/players/${ALICE}`), {
      uid: ALICE,
      displayName: 'Alice',
      bingoCount: 0,
      squaresMarked: 0,
      firstBingoAt: null,
      reshufflesUsed: 0,
    });
    await setDoc(doc(d, dayBoardPath(0, ALICE)), board(ALICE, 0, 100));
    await setDoc(doc(d, dayBoardPath(1, ALICE)), board(ALICE, 1, 111));
    await setDoc(doc(d, dayBoardPath(2, ALICE)), board(ALICE, 2, 222));
  });
});

describe('the multi-board echo batch (spec § Mark-time)', () => {
  it('accepts the full mark-time batch: acted board + two echoed boards + player + marker, each board with ITS OWN markSeed', async () => {
    const d = db(ALICE);
    const batch = writeBatch(d);
    // The acted Mark on Day 0 (manual, confirmed).
    batch.set(
      doc(d, dayBoardPath(0, ALICE)),
      { cells: cells({ 3: { marked: true, markedAt: NOW(), status: 'confirmed' } }), markSeed: 100 },
      { merge: true },
    );
    // The echoes on Days 1 and 2, each stamped with THAT board's seed.
    batch.set(
      doc(d, dayBoardPath(1, ALICE)),
      { cells: cells({ 5: { marked: true, markedAt: NOW(), status: 'confirmed', echo: true } }), markSeed: 111 },
      { merge: true },
    );
    batch.set(
      doc(d, dayBoardPath(2, ALICE)),
      { cells: cells({ 8: { marked: true, markedAt: NOW(), status: 'confirmed', echo: true } }), markSeed: 222 },
      { merge: true },
    );
    // The ONE aggregated player write.
    batch.set(
      doc(d, `events/${EVENT}/players/${ALICE}`),
      {
        dayStats: {
          0: { bingoCount: 0, squaresMarked: 1, firstBingoAt: null },
          1: { bingoCount: 0, squaresMarked: 1, firstBingoAt: null },
          2: { bingoCount: 0, squaresMarked: 1, firstBingoAt: null },
        },
        bingoCount: 0,
        squaresMarked: 3,
        firstBingoAt: null,
        blackout: false,
      },
      { merge: true },
    );
    // The acted Mark's Tally marker (the single per-(Prompt, Player) slot).
    batch.set(doc(d, `events/${EVENT}/tally/i3/markers/${ALICE}`), {
      uid: ALICE,
      displayName: 'Alice',
      markedAt: NOW(),
      itemText: 'Prompt 3',
      dayIndex: 0,
    });
    await assertSucceeds(batch.commit());
  });

  it('REJECTS an echoed board write that borrows the SOURCE board\'s seed as its markSeed', async () => {
    const d = db(ALICE);
    const batch = writeBatch(d);
    batch.set(
      doc(d, dayBoardPath(0, ALICE)),
      { cells: cells({ 3: { marked: true, markedAt: NOW(), status: 'confirmed' } }), markSeed: 100 },
      { merge: true },
    );
    batch.set(
      doc(d, dayBoardPath(1, ALICE)),
      // markSeed 100 is Day 0's seed — Day 1's board is seeded 111, so this is
      // the stale/borrowed-seed write the per-board gate exists to reject.
      { cells: cells({ 5: { marked: true, markedAt: NOW(), status: 'confirmed', echo: true } }), markSeed: 100 },
      { merge: true },
    );
    await assertFails(batch.commit());
  });

  it('REJECTS an echoed board write with no markSeed at all on a seeded board', async () => {
    await assertFails(
      setDoc(
        doc(db(ALICE), dayBoardPath(1, ALICE)),
        { cells: cells({ 5: { marked: true, markedAt: NOW(), status: 'confirmed', echo: true } }) },
        { merge: true },
      ),
    );
  });
});

describe("boardPristine()'s echo exemption (spec § Reshuffle pristine-ness)", () => {
  const reshuffle = async (dayIndex: number, existingSeed: number) => {
    const d = db(ALICE);
    const batch = writeBatch(d);
    batch.set(doc(d, dayBoardPath(dayIndex, ALICE)), board(ALICE, dayIndex, existingSeed + 1));
    batch.set(doc(d, `events/${EVENT}/players/${ALICE}`), { reshufflesUsed: 1 }, { merge: true });
    return batch.commit();
  };

  it('an ECHO-ONLY card is still pristine — the reshuffle is allowed', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), dayBoardPath(1, ALICE)),
        board(ALICE, 1, 111, { 5: { marked: true, markedAt: NOW(), status: 'confirmed', echo: true } }),
      );
    });
    await assertSucceeds(reshuffle(1, 111));
  });

  it('a MANUALLY-marked card is not pristine — the reshuffle is denied', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), dayBoardPath(1, ALICE)),
        board(ALICE, 1, 111, { 5: { marked: true, markedAt: NOW(), status: 'confirmed' } }),
      );
    });
    await assertFails(reshuffle(1, 111));
  });

  it('one manual Mark among echoes still blocks — the exemption is per-cell, not per-card', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), dayBoardPath(1, ALICE)),
        board(ALICE, 1, 111, {
          5: { marked: true, markedAt: NOW(), status: 'confirmed', echo: true },
          7: { marked: true, markedAt: NOW(), status: 'confirmed' },
        }),
      );
    });
    await assertFails(reshuffle(1, 111));
  });

  it('a proof-backed Echo is not pristine — the proof cannot be stranded by a reshuffle', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), dayBoardPath(1, ALICE)),
        board(ALICE, 1, 111, {
          5: { marked: true, markedAt: NOW(), status: 'confirmed', echo: true, proofId: 'proof-1' },
        }),
      );
    });
    await assertFails(reshuffle(1, 111));
  });
});
