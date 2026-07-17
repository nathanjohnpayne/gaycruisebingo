import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteDoc, deleteField, doc, runTransaction, setDoc, writeBatch } from 'firebase/firestore';

// specs/reshuffle.md — the Reshuffle write gate (#378).
//
// Two halves, and the split is the whole point:
//   - the BOARD rule binds the pair: a Board write that changes `seed` is a
//     reshuffle, allowed only for the owner, on an unlocked canonical Day, when
//     the EXISTING board is pristine, and when the player's counter goes exactly
//     +1 (<= 3) IN THE SAME BATCH (via getAfter);
//   - the PLAYERS rule holds the counter MONOTONIC: hold or +1 only, never down,
//     never past 3.
//
// The PERMISSION_DENIED lines the SDK logs to stderr are the expected
// assertFails denials, not test failures.

const RULES_PATH = fileURLToPath(new URL('../../firestore.rules', import.meta.url));
const EVENT = 'cruise';
const ALICE = 'alice';
const BOB = 'bob';
const NOW = () => Date.now();
const PAST = () => NOW() - 3_600_000;
const FUTURE = () => NOW() + 3_600_000;

const UNLOCKED_DAY = 0;
const LOCKED_DAY = 1;

let testEnv: RulesTestEnvironment;
const db = (uid: string) => testEnv.authenticatedContext(uid).firestore();

/** A 25-cell board. `markedIndex` marks one PLAYER square (index 12 is the free
 *  centre, always marked, and never counts against pristine). */
function cells(markedIndex?: number) {
  return Array.from({ length: 25 }, (_, index) => ({
    index,
    itemId: index === 12 ? null : `i${index}`,
    text: index === 12 ? 'FREE' : `Prompt ${index}`,
    free: index === 12,
    marked: index === 12 || index === markedIndex,
    markedAt: index === markedIndex ? NOW() : null,
  }));
}

const board = (uid: string, dayIndex: number, seed: number, markedIndex?: number) => ({
  uid,
  dayIndex,
  seed,
  createdAt: NOW(),
  cells: cells(markedIndex),
});

beforeAll(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
  const [hostname, port] = host.split(':');
  testEnv = await initializeTestEnvironment({
    // Unique per-file projectId so this suite's clearFirestore never races
    // another concurrently-running rules file's seed (the house convention).
    projectId: 'demo-gaycruisebingo-reshuffle',
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

// Day 0 unlocked (unlockAt in the past), Day 1 locked (future). Alice holds a
// pristine Day-0 card and has spent no reshuffles.
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
        { index: 1, unlockAt: FUTURE(), pool: 'main', tutorial: false },
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
    await setDoc(doc(d, `events/${EVENT}/days/${UNLOCKED_DAY}/boards/${ALICE}`), board(ALICE, UNLOCKED_DAY, 111));
    await setDoc(doc(d, `events/${EVENT}/days/${LOCKED_DAY}/boards/${ALICE}`), board(ALICE, LOCKED_DAY, 222));
  });
});

/** The legitimate shape: replace the board with a new seed AND bump the counter,
 *  in ONE batch — exactly what `reshuffleBoard` commits. */
function reshuffle(
  uid: string,
  opts: { dayIndex?: number; seed?: number; nextUsed?: number; asUid?: string } = {},
) {
  const { dayIndex = UNLOCKED_DAY, seed = 999, nextUsed = 1, asUid = uid } = opts;
  const d = db(asUid);
  const b = writeBatch(d);
  b.set(doc(d, `events/${EVENT}/days/${dayIndex}/boards/${uid}`), board(uid, dayIndex, seed));
  b.set(doc(d, `events/${EVENT}/players/${uid}`), { reshufflesUsed: nextUsed }, { merge: true });
  return b.commit();
}

async function seedCounter(used: number) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(
      doc(ctx.firestore(), `events/${EVENT}/players/${ALICE}`),
      { reshufflesUsed: used },
      { merge: true },
    );
  });
}

async function seedBoard(dayIndex: number, seed: number, markedIndex?: number) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(
      doc(ctx.firestore(), `events/${EVENT}/days/${dayIndex}/boards/${ALICE}`),
      board(ALICE, dayIndex, seed, markedIndex),
    );
  });
}

describe('reshuffle — the board-side pairing gate', () => {
  it('ALLOWS a pristine reshuffle paired with a +1 counter write in one batch', async () => {
    await assertSucceeds(reshuffle(ALICE));
  });

  it('DENIES a board reshuffle with NO counter write in the batch', async () => {
    const d = db(ALICE);
    const b = writeBatch(d);
    b.set(doc(d, `events/${EVENT}/days/${UNLOCKED_DAY}/boards/${ALICE}`), board(ALICE, UNLOCKED_DAY, 999));
    await assertFails(b.commit());
  });

  it('DENIES a LONE (non-batched) board reshuffle — getAfter cannot pair it', async () => {
    const d = db(ALICE);
    await assertFails(
      setDoc(doc(d, `events/${EVENT}/days/${UNLOCKED_DAY}/boards/${ALICE}`), board(ALICE, UNLOCKED_DAY, 999)),
    );
  });

  it('DENIES a reshuffle when ANY player square is marked (card not pristine)', async () => {
    await seedBoard(UNLOCKED_DAY, 111, 0);
    await assertFails(reshuffle(ALICE));
  });

  it('DENIES a reshuffle of a LOCKED Day', async () => {
    await assertFails(reshuffle(ALICE, { dayIndex: LOCKED_DAY, seed: 888 }));
  });

  it('DENIES a reshuffle by a NON-OWNER', async () => {
    // Bob drives the batch against Alice's board + Alice's counter.
    await assertFails(reshuffle(ALICE, { asUid: BOB }));
  });

  it('DENIES the 4th reshuffle — the resulting counter would exceed the allowance', async () => {
    await seedCounter(3);
    await assertFails(reshuffle(ALICE, { nextUsed: 4 }));
  });

  it('ALLOWS the 3rd reshuffle — the resulting counter is exactly at the allowance', async () => {
    await seedCounter(2);
    await assertSucceeds(reshuffle(ALICE, { nextUsed: 3 }));
  });

  it('DENIES a reshuffle whose counter jumps by 2 rather than exactly 1', async () => {
    await assertFails(reshuffle(ALICE, { nextUsed: 2 }));
  });

  it('DENIES a reshuffle that leaves the counter UNCHANGED', async () => {
    await assertFails(reshuffle(ALICE, { nextUsed: 0 }));
  });
});

// `reshuffleBoard` commits via runTransaction, not writeBatch (Codex P1 on #383 —
// a batch queues offline, a transaction rejects). The `getAfter()` pairing is
// documented for both, but "documented" is what the day-agnostic unroll was too:
// this exercises the ACTUAL production shape against the emulator so the rule is
// proven on the path the app really takes, not merely on a cousin of it.
describe('reshuffle — the pairing holds through a TRANSACTION (the production path)', () => {
  it('ALLOWS a pristine reshuffle + paired +1 committed in one transaction', async () => {
    const d = db(ALICE);
    await assertSucceeds(
      runTransaction(d, async (tx) => {
        const boardRef = doc(d, `events/${EVENT}/days/${UNLOCKED_DAY}/boards/${ALICE}`);
        const playerRef = doc(d, `events/${EVENT}/players/${ALICE}`);
        await tx.get(boardRef);
        await tx.get(playerRef);
        tx.set(boardRef, board(ALICE, UNLOCKED_DAY, 4242));
        tx.set(playerRef, { reshufflesUsed: 1 }, { merge: true });
      }),
    );
  });

  it('DENIES a transactional board reshuffle with NO counter write', async () => {
    const d = db(ALICE);
    await assertFails(
      runTransaction(d, async (tx) => {
        const boardRef = doc(d, `events/${EVENT}/days/${UNLOCKED_DAY}/boards/${ALICE}`);
        await tx.get(boardRef);
        tx.set(boardRef, board(ALICE, UNLOCKED_DAY, 4242));
      }),
    );
  });

  it('DENIES a transactional reshuffle past the allowance', async () => {
    await seedCounter(3);
    const d = db(ALICE);
    await assertFails(
      runTransaction(d, async (tx) => {
        const boardRef = doc(d, `events/${EVENT}/days/${UNLOCKED_DAY}/boards/${ALICE}`);
        const playerRef = doc(d, `events/${EVENT}/players/${ALICE}`);
        await tx.get(boardRef);
        await tx.get(playerRef);
        tx.set(boardRef, board(ALICE, UNLOCKED_DAY, 4242));
        tx.set(playerRef, { reshufflesUsed: 4 }, { merge: true });
      }),
    );
  });
});

// The two laundering paths Codex found on #383. Both defeated the cap COMPLETELY —
// not a nibble at the edges — by getting a Board replaced without the write ever
// being classified as a reshuffle.
describe('reshuffle — the cap cannot be laundered around', () => {
  it('DENIES an owner DELETING their board (the delete-then-create bypass)', async () => {
    // Delete, and the replacement is a CREATE: no `resource`, so the reshuffle arm
    // never fires and the new card skips both the pristine check and the counter —
    // an unlimited re-roll, even with all three spent. Delete is admin-only now.
    await assertFails(
      deleteDoc(doc(db(ALICE), `events/${EVENT}/days/${UNLOCKED_DAY}/boards/${ALICE}`)),
    );
  });

  it('DENIES dropping `seed` from an existing board (step 1 of the two-step)', async () => {
    // A full replace that OMITS seed. Comparing values alone read "no incoming key"
    // as "not a reshuffle"; presence changes are gated now.
    const d = db(ALICE);
    await assertFails(
      setDoc(doc(d, `events/${EVENT}/days/${UNLOCKED_DAY}/boards/${ALICE}`), {
        uid: ALICE,
        dayIndex: UNLOCKED_DAY,
        createdAt: NOW(),
        cells: cells(),
      }),
    );
  });

  it('DENIES ADDING a seed to a seedless board (step 2 of the two-step)', async () => {
    // Seed the seedless state directly (step 1 is denied above, but a legacy row
    // could legitimately lack the key), then try to launder a fresh card in.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `events/${EVENT}/days/${UNLOCKED_DAY}/boards/${ALICE}`), {
        uid: ALICE,
        dayIndex: UNLOCKED_DAY,
        createdAt: NOW(),
        cells: cells(0), // and MARKED, so a legitimate reshuffle is impossible
      });
    });
    const d = db(ALICE);
    await assertFails(
      setDoc(doc(d, `events/${EVENT}/days/${UNLOCKED_DAY}/boards/${ALICE}`), board(ALICE, UNLOCKED_DAY, 555)),
    );
  });

  it('still ALLOWS a seedless legacy board to be MARKED (no seed on either side)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `events/${EVENT}/days/${UNLOCKED_DAY}/boards/${ALICE}`), {
        uid: ALICE,
        dayIndex: UNLOCKED_DAY,
        createdAt: NOW(),
        cells: cells(),
      });
    });
    const d = db(ALICE);
    await assertSucceeds(
      setDoc(
        doc(d, `events/${EVENT}/days/${UNLOCKED_DAY}/boards/${ALICE}`),
        { cells: cells(0) },
        { merge: true },
      ),
    );
  });
});

describe('reshuffle — ordinary board writes are unaffected', () => {
  it('ALLOWS a MARK that carries the current board seed guard with no counter write', async () => {
    const d = db(ALICE);
    await assertSucceeds(
      setDoc(
        doc(d, `events/${EVENT}/days/${UNLOCKED_DAY}/boards/${ALICE}`),
        { cells: cells(0), markSeed: 111 },
        { merge: true },
      ),
    );
  });

  it('ALLOWS a MARK on an already-marked (non-pristine) card — pristine gates reshuffles only', async () => {
    await seedBoard(UNLOCKED_DAY, 111, 0);
    const d = db(ALICE);
    await assertSucceeds(
      setDoc(
        doc(d, `events/${EVENT}/days/${UNLOCKED_DAY}/boards/${ALICE}`),
        { cells: cells(1), markSeed: 111 },
        { merge: true },
      ),
    );
  });

  it('DENIES a seeded-board MARK with no seed guard', async () => {
    const d = db(ALICE);
    await assertFails(
      setDoc(
        doc(d, `events/${EVENT}/days/${UNLOCKED_DAY}/boards/${ALICE}`),
        { cells: cells(0) },
        { merge: true },
      ),
    );
  });

  it('DENIES a stale queued MARK from the pre-reshuffle seed', async () => {
    await seedBoard(UNLOCKED_DAY, 222);
    const d = db(ALICE);
    await assertFails(
      setDoc(
        doc(d, `events/${EVENT}/days/${UNLOCKED_DAY}/boards/${ALICE}`),
        { cells: cells(0), markSeed: 111 },
        { merge: true },
      ),
    );
  });
});

describe('reshuffle — the counter is monotonic (Option A, #378)', () => {
  it('DENIES a counter DECREMENT — the reset-to-zero exploit the pairing existed to stop', async () => {
    await seedCounter(2);
    const d = db(ALICE);
    await assertFails(
      setDoc(doc(d, `events/${EVENT}/players/${ALICE}`), { reshufflesUsed: 0 }, { merge: true }),
    );
  });

  it('DENIES a counter write ABOVE the allowance', async () => {
    await seedCounter(3);
    const d = db(ALICE);
    await assertFails(
      setDoc(doc(d, `events/${EVENT}/players/${ALICE}`), { reshufflesUsed: 4 }, { merge: true }),
    );
  });

  it('DENIES a counter JUMP of 2', async () => {
    const d = db(ALICE);
    await assertFails(
      setDoc(doc(d, `events/${EVENT}/players/${ALICE}`), { reshufflesUsed: 2 }, { merge: true }),
    );
  });

  // The reset-to-zero exploit by OMISSION (CodeRabbit 🔴, PR #383). `usedCount()`
  // reads a missing key as 0, so dropping the field is a decrement wearing a
  // disguise: it would hand a spent-out Player three fresh reshuffles, defeating
  // the whole monotonic contract. Both removal shapes are pinned.
  it('DENIES a full (non-merge) replacement that OMITS the counter — dropping it is a decrement', async () => {
    await seedCounter(3);
    const d = db(ALICE);
    await assertFails(
      setDoc(doc(d, `events/${EVENT}/players/${ALICE}`), {
        uid: ALICE,
        displayName: 'Alice',
        bingoCount: 0,
        squaresMarked: 0,
        firstBingoAt: null,
      }),
    );
  });

  it('DENIES deleteField() on the counter', async () => {
    await seedCounter(2);
    const d = db(ALICE);
    await assertFails(
      setDoc(
        doc(d, `events/${EVENT}/players/${ALICE}`),
        { reshufflesUsed: deleteField() },
        { merge: true },
      ),
    );
  });

  it('still ALLOWS a legacy row that never carried the counter to be updated without it', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `events/${EVENT}/players/${ALICE}`), {
        uid: ALICE,
        displayName: 'Alice',
        bingoCount: 0,
      });
    });
    const d = db(ALICE);
    await assertSucceeds(
      setDoc(doc(d, `events/${EVENT}/players/${ALICE}`), { squaresMarked: 3 }, { merge: true }),
    );
  });

  it('DENIES a non-numeric counter', async () => {
    const d = db(ALICE);
    await assertFails(
      setDoc(doc(d, `events/${EVENT}/players/${ALICE}`), { reshufflesUsed: 'lots' }, { merge: true }),
    );
  });

  it('ALLOWS an ordinary stat write that leaves the counter untouched', async () => {
    await seedCounter(2);
    const d = db(ALICE);
    await assertSucceeds(
      setDoc(doc(d, `events/${EVENT}/players/${ALICE}`), { squaresMarked: 7 }, { merge: true }),
    );
  });

  it('ALLOWS a create that starts the counter at 0, and DENIES one that starts it higher', async () => {
    const d = db(BOB);
    await assertSucceeds(
      setDoc(doc(d, `events/${EVENT}/players/${BOB}`), {
        uid: BOB,
        displayName: 'Bob',
        reshufflesUsed: 0,
      }),
    );
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(`events/${EVENT}/players/${BOB}`).delete();
    });
    await assertFails(
      setDoc(doc(db(BOB), `events/${EVENT}/players/${BOB}`), {
        uid: BOB,
        displayName: 'Bob',
        reshufflesUsed: 2,
      }),
    );
  });

  // The ACCEPTED RESIDUAL, pinned so it is a decision on the record rather than a
  // gap someone later "discovers": an unpaired +1 is permitted. It burns the
  // Player's own allowance and writes no board — self-harm, not an exploit. See
  // specs/reshuffle.md § Residuals for why the paired check is not expressible.
  it('PERMITS an unpaired +1 — the documented residual (a self-burn, not an exploit)', async () => {
    const d = db(ALICE);
    await assertSucceeds(
      setDoc(doc(d, `events/${EVENT}/players/${ALICE}`), { reshufflesUsed: 1 }, { merge: true }),
    );
  });
});

describe('reshuffle — legacy player rows with no counter', () => {
  it('treats a MISSING counter as 0: a first reshuffle to 1 is allowed', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `events/${EVENT}/players/${ALICE}`), {
        uid: ALICE,
        displayName: 'Alice',
        bingoCount: 0,
      });
    });
    await assertSucceeds(reshuffle(ALICE, { nextUsed: 1 }));
  });

  it('treats a MISSING counter as 0: a jump straight to 2 is denied', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `events/${EVENT}/players/${ALICE}`), {
        uid: ALICE,
        displayName: 'Alice',
        bingoCount: 0,
      });
    });
    await assertFails(reshuffle(ALICE, { nextUsed: 2 }));
  });
});
