import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Cell, ClaimDoc, DayDef } from '../types';

// specs/echo-marks.md — the three propagation write paths (mark-time in
// setMark, deal-time in dealDayCard + reshuffleBoard, open-time in
// reconcileEchoes) plus the confirmClaim echo, the marker-preservation unmark,
// and the no-repeated-Prompts byte-identical regression. Mock-Firestore unit
// tests; the pure math is proven in src/game/echo-marks.test.ts and the rules
// gate in tests/rules/echo-marks.test.ts.

const EVENT_ID = 'test-event';

const H = vi.hoisted(() => ({
  event: null as Record<string, unknown> | null,
  itemsById: new Map<string, Record<string, unknown>>(),
  dayBoards: new Map<number, Record<string, unknown> | null>(),
  player: null as Record<string, unknown> | null,
  batchSet: vi.fn(),
  batchDelete: vi.fn(),
  batchCommit: vi.fn(async () => {}),
  txSet: vi.fn(),
  txDelete: vi.fn(),
  txGet: vi.fn(),
}));

vi.mock('../firebase', () => ({
  db: {},
  EVENT_ID: 'test-event',
  functions: {},
  storage: {},
  auth: {},
  googleProvider: {},
  analytics: null,
}));

vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }));

vi.mock('firebase/firestore', () => {
  const makeRef = (kind: string, args: unknown[]) => {
    const ref: Record<string, unknown> = { kind, args };
    ref.withConverter = () => ref;
    return ref;
  };
  return {
    doc: (...args: unknown[]) => makeRef('doc', args),
    collection: (...args: unknown[]) => makeRef('collection', args),
    collectionGroup: (...args: unknown[]) => makeRef('collectionGroup', args),
    query: (...args: unknown[]) => ({ query: args }),
    where: (...args: unknown[]) => ({ where: args }),
    getDoc: vi.fn(async (ref: { args?: unknown[] }) => route(ref)),
    getDocFromCache: vi.fn(async (ref: { args?: unknown[] }) => route(ref)),
    getDocFromServer: vi.fn(),
    getDocs: vi.fn(),
    getDocsFromCache: vi.fn(),
    writeBatch: () => ({ set: H.batchSet, delete: H.batchDelete, commit: H.batchCommit }),
    addDoc: vi.fn(),
    increment: vi.fn(),
    deleteField: vi.fn(),
    deleteDoc: vi.fn(),
    updateDoc: vi.fn(),
    arrayUnion: vi.fn(),
    arrayRemove: vi.fn(),
    runTransaction: async (_db: unknown, fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        get: async (ref: { args?: unknown[] }) => {
          H.txGet(ref);
          return route(ref);
        },
        set: H.txSet,
        delete: H.txDelete,
      };
      return fn(tx);
    },
    setDoc: vi.fn(),
    onSnapshot: vi.fn(),
    serverTimestamp: vi.fn(),
    getFirestore: vi.fn(),
  };
});

const snap = (exists: boolean, id = '', data: unknown = undefined) => ({
  exists: () => exists,
  id,
  data: () => data,
});

function route(ref: { args?: unknown[] }) {
  const a = (ref.args ?? []).filter((x): x is string => typeof x === 'string');
  if (a.length === 2 && a[0] === 'events') return H.event ? snap(true, EVENT_ID, H.event) : snap(false);
  if (a[2] === 'items') {
    const item = H.itemsById.get(a[3]);
    return item ? snap(true, a[3], item) : snap(false);
  }
  if (a[2] === 'days' && a[4] === 'boards') {
    const board = H.dayBoards.get(Number(a[3]));
    return board ? snap(true, a[5], board) : snap(false);
  }
  if (a[2] === 'players') return H.player ? snap(true, a[3], H.player) : snap(false);
  return snap(false);
}

/** String segments of a captured write ref. */
const segs = (call: unknown[]): string[] =>
  (((call[0] as { args?: unknown[] }).args ?? []) as unknown[]).filter(
    (x): x is string => typeof x === 'string',
  );
const isDayBoardWrite = (call: unknown[], day: number) => {
  const a = segs(call);
  return a[2] === 'days' && a[3] === String(day) && a[4] === 'boards';
};
const isPlayerWrite = (call: unknown[]) => segs(call)[2] === 'players';
const isMarkerWrite = (call: unknown[]) => segs(call)[2] === 'tally';

import { setMark, dealDayCard, reshuffleBoard, reconcileEchoes, computeMark } from './api';
import { confirmClaim, rejectClaim } from './admin';
import { resetPendingMoments, peekPendingMoments, pendingBingoDayIndexes } from './moments';

const PAST = Date.now() - 3_600_000;

/** A 25-cell card with explicit per-index item ids and overrides. */
function card(
  idFor: (i: number) => string,
  overrides: Partial<Record<number, Partial<Cell>>> = {},
): Cell[] {
  return Array.from({ length: 25 }, (_, index) => {
    const base: Cell =
      index === 12
        ? { index, itemId: null, text: 'FREE', free: true, marked: true, markedAt: null }
        : { index, itemId: idFor(index), text: `Prompt ${index}`, free: false, marked: false, markedAt: null };
    return { ...base, ...(overrides[index] ?? {}) };
  });
}

const day = (index: number, over: Partial<DayDef> = {}): DayDef =>
  ({
    index,
    date: '2026-07-16',
    port: 'Split',
    portEmoji: '🇭🇷',
    theme: 'get-sporty',
    tonight: ['A', 'B'],
    pool: 'main',
    tutorial: false,
    unlockAt: PAST,
    snapshotItemIds: [],
    ...over,
  }) as DayDef;

beforeEach(() => {
  vi.clearAllMocks();
  resetPendingMoments();
  H.event = { days: [day(0), day(1), day(2), day(3)], settings: { spicyRatio: 0.4 } };
  H.itemsById.clear();
  H.dayBoards = new Map();
  H.player = null;
});

describe('computeMark strips the echo flag on a manual toggle (spec § Reshuffle pristine-ness)', () => {
  it('unmarking an echo, and manually re-marking it, both drop the key', () => {
    const cells = card((i) => `i${i}`, {
      2: { marked: true, markedAt: 5, status: 'confirmed', echo: true },
    });
    const unmarked = computeMark({
      cells,
      index: 2,
      nextMarked: false,
      claimMode: 'honor',
      currentFirstBingoAt: null,
      now: 10,
    });
    expect('echo' in unmarked.cells.find((c) => c.index === 2)!).toBe(false);
    const remarked = computeMark({
      cells: unmarked.cells,
      index: 2,
      nextMarked: true,
      claimMode: 'honor',
      currentFirstBingoAt: null,
      now: 11,
    });
    const cell = remarked.cells.find((c) => c.index === 2)!;
    expect(cell.marked).toBe(true);
    expect('echo' in cell).toBe(false);
  });
});

describe('setMark — mark-time propagation (spec § Mark-time)', () => {
  // The acted Day-2 board and a Day-3 sibling SHARING prompt `shared` at
  // different positions; Day 1 shares nothing.
  const actedCells = card((i) => (i === 5 ? 'shared' : `a${i}`));
  const seedBoards = () => {
    H.dayBoards.set(2, { uid: 'u1', seed: 222, dayIndex: 2, cells: actedCells });
    H.dayBoards.set(3, { uid: 'u1', seed: 333, dayIndex: 3, cells: card((i) => (i === 8 ? 'shared' : `b${i}`)) });
    H.dayBoards.set(1, { uid: 'u1', seed: 111, dayIndex: 1, cells: card((i) => `c${i}`) });
    H.player = {
      uid: 'u1',
      displayName: 'Alice',
      firstBingoAt: null,
      dayStats: { 2: { bingoCount: 0, squaresMarked: 0, firstBingoAt: null } },
    };
  };
  const markShared = (over: Partial<Parameters<typeof setMark>[0]> = {}) =>
    setMark({
      uid: 'u1',
      cells: actedCells,
      index: 5,
      nextMarked: true,
      claimMode: 'honor',
      currentFirstBingoAt: null,
      displayName: 'Alice',
      dayIndex: 2,
      daily: true,
      boardSeed: 222,
      echoDayIndexes: [0, 1, 2, 3],
      ...over,
    });

  it('echoes the confirmed Prompt onto the sibling carrier in the SAME batch, with ITS OWN markSeed', async () => {
    seedBoards();
    await markShared();
    const sibWrite = H.batchSet.mock.calls.find((c) => isDayBoardWrite(c, 3));
    expect(sibWrite).toBeDefined();
    const payload = sibWrite![1] as { cells: Cell[]; markSeed: number };
    expect(payload.markSeed).toBe(333); // the SIBLING board's seed, never the acted board's
    const echoed = payload.cells.find((c) => c.index === 8)!;
    expect(echoed).toMatchObject({ marked: true, status: 'confirmed', echo: true, itemId: 'shared' });
    // The non-carrier sibling (Day 1) is untouched.
    expect(H.batchSet.mock.calls.some((c) => isDayBoardWrite(c, 1))).toBe(false);
  });

  it('writes ONE aggregated player doc: acted bucket + echoed bucket + re-derived roots', async () => {
    seedBoards();
    await markShared();
    const playerWrites = H.batchSet.mock.calls.filter(isPlayerWrite);
    expect(playerWrites).toHaveLength(1);
    const write = playerWrites[0][1] as {
      dayStats: Record<number, { bingoCount: number; squaresMarked: number }>;
      bingoCount: number;
      squaresMarked: number;
    };
    expect(write.dayStats[2].squaresMarked).toBe(1); // the acted Mark
    expect(write.dayStats[3].squaresMarked).toBe(1); // the echo
    expect(write.squaresMarked).toBe(2); // the ONE re-summed root
    expect(write.bingoCount).toBe(0);
  });

  it('writes the Tally marker ONCE, for the acted Day — echoes never move the single marker slot', async () => {
    seedBoards();
    await markShared();
    const markerWrites = H.batchSet.mock.calls.filter(isMarkerWrite);
    expect(markerWrites).toHaveLength(1);
    expect((markerWrites[0][1] as { dayIndex: number }).dayIndex).toBe(2);
  });

  it('routes an echo-completed line into the pending-Moment queue under the ECHOED Day', async () => {
    seedBoards();
    // Day 3's row 2 (10..14, crossing the free centre) is one echo short:
    // 10+11+13 manually marked, 14 carries the shared Prompt.
    H.dayBoards.set(3, {
      uid: 'u1',
      seed: 333,
      dayIndex: 3,
      cells: card((i) => (i === 14 ? 'shared' : `b${i}`), {
        10: { marked: true, markedAt: 1 },
        11: { marked: true, markedAt: 1 },
        13: { marked: true, markedAt: 1 },
      }),
    });
    await markShared();
    expect(peekPendingMoments('u1').bingo).toBe(true);
    expect(pendingBingoDayIndexes('u1')).toEqual([3]);
  });

  it('does NOT echo a pending (admin_confirmed) Mark', async () => {
    seedBoards();
    await markShared({ claimMode: 'admin_confirmed' });
    expect(H.batchSet.mock.calls.some((c) => isDayBoardWrite(c, 3))).toBe(false);
  });

  it('REGRESSION: with no repeated Prompts the batch is byte-identical to an echo-less call', async () => {
    // Pin the clock: the two runs stamp `markedAt: Date.now()`, and crossing a
    // millisecond boundary between them would fail the byte-identity check for
    // the wrong reason (observed CI-only).
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    try {
      seedBoards();
      H.dayBoards.set(3, { uid: 'u1', seed: 333, dayIndex: 3, cells: card((i) => `b${i}`) }); // no overlap
      await markShared();
      const withEchoParam = H.batchSet.mock.calls.map((c) => [segs(c), c[1], c[2]]);
      vi.clearAllMocks();
      await markShared({ echoDayIndexes: undefined });
      const withoutEchoParam = H.batchSet.mock.calls.map((c) => [segs(c), c[1], c[2]]);
      expect(withEchoParam).toEqual(withoutEchoParam);
      expect(withEchoParam.some(([a]) => (a as string[])[2] === 'days' && (a as string[])[3] === '3')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('unmark keeps the shared marker while a sibling still holds the Prompt confirmed, deletes when last', async () => {
    seedBoards();
    // The sibling holds `shared` CONFIRMED (an echo) — unmarking the acted copy
    // must NOT strip the marker from under it.
    H.dayBoards.set(3, {
      uid: 'u1',
      seed: 333,
      dayIndex: 3,
      cells: card((i) => (i === 8 ? 'shared' : `b${i}`), {
        8: { marked: true, markedAt: 2, status: 'confirmed', echo: true },
      }),
    });
    H.dayBoards.set(2, {
      uid: 'u1',
      seed: 222,
      dayIndex: 2,
      cells: card((i) => (i === 5 ? 'shared' : `a${i}`), { 5: { marked: true, markedAt: 1 } }),
    });
    await markShared({ nextMarked: false });
    expect(H.batchDelete).not.toHaveBeenCalled();

    vi.clearAllMocks();
    // Sibling no longer carries it marked — the last carrier's unmark deletes.
    H.dayBoards.set(3, { uid: 'u1', seed: 333, dayIndex: 3, cells: card((i) => (i === 8 ? 'shared' : `b${i}`)) });
    await markShared({ nextMarked: false });
    expect(H.batchDelete).toHaveBeenCalledTimes(1);
  });
});

describe('dealDayCard — deal-time echo (spec § Deal-time)', () => {
  // A 24-Prompt snapshot shared verbatim with the Day-1 card: the no-repeat
  // exclusion would leave 0 < MIN_POOL drawable, so it RESETS and the Day-0
  // deal redraws the same Prompts — the repeat case deal-time echo exists for.
  const SNAP = Array.from({ length: 24 }, (_, i) => `s${i}`);
  const seedDeal = (day1Overrides: Partial<Record<number, Partial<Cell>>> = {}) => {
    for (const id of SNAP) H.itemsById.set(id, { text: `P ${id}`, spicy: false, isFreeSpace: false });
    H.event = {
      days: [day(0, { snapshotItemIds: SNAP }), day(1, { snapshotItemIds: SNAP })],
      settings: { spicyRatio: 0.4 },
    };
    let cursor = 0;
    const ids: (string | null)[] = Array.from({ length: 25 }, (_, i) => (i === 12 ? null : SNAP[cursor++]));
    H.dayBoards.set(1, {
      uid: 'u1',
      seed: 111,
      dayIndex: 1,
      cells: card((i) => ids[i] as string, day1Overrides),
    });
    H.player = { uid: 'u1', dayStats: { 1: { bingoCount: 0, squaresMarked: 1, firstBingoAt: null } } };
  };
  const u = { uid: 'u1', displayName: 'Alice', photoURL: null } as never;

  it('the new card arrives pre-echoed for an achieved Prompt, with the bucket + roots in the player write', async () => {
    seedDeal({ 0: { marked: true, markedAt: 1, status: 'confirmed' } }); // s0 achieved on Day 1
    await expect(dealDayCard(u, 0)).resolves.toBe(true);
    const boardWrite = H.txSet.mock.calls.find((c) => isDayBoardWrite(c, 0));
    const cells = (boardWrite![1] as { cells: Cell[] }).cells;
    const echoed = cells.find((c) => c.itemId === 's0')!;
    expect(echoed).toMatchObject({ marked: true, status: 'confirmed', echo: true });
    const playerWrite = H.txSet.mock.calls.find(isPlayerWrite)![1] as {
      dayStats: Record<number, { squaresMarked: number }>;
      squaresMarked: number;
    };
    expect(playerWrite.dayStats[0].squaresMarked).toBe(1);
    expect(playerWrite.squaresMarked).toBe(2); // Day 1 prior bucket + this echo
  });

  it('REGRESSION: with nothing achieved the player write is the zeroed seed bucket, exactly as today', async () => {
    seedDeal(); // Day 1 card exists but nothing marked
    await expect(dealDayCard(u, 0)).resolves.toBe(true);
    const playerWrite = H.txSet.mock.calls.find(isPlayerWrite)![1];
    expect(playerWrite).toEqual({ dayStats: { 0: { bingoCount: 0, squaresMarked: 0, firstBingoAt: null } } });
    const cells = (H.txSet.mock.calls.find((c) => isDayBoardWrite(c, 0))![1] as { cells: Cell[] }).cells;
    expect(cells.some((c) => c.echo)).toBe(false);
  });
});

describe('reshuffleBoard — the post-Reshuffle re-deal echo (spec § Reshuffle pristine-ness)', () => {
  const SNAP = Array.from({ length: 24 }, (_, i) => `s${i}`);
  const seedShuffle = (params: {
    day1Cells?: Partial<Record<number, Partial<Cell>>>;
    day0Overrides?: Partial<Record<number, Partial<Cell>>>;
    playerExtra?: Record<string, unknown>;
  }) => {
    for (const id of SNAP) H.itemsById.set(id, { text: `P ${id}`, spicy: false, isFreeSpace: false });
    H.event = {
      days: [day(0, { snapshotItemIds: SNAP }), day(1, { snapshotItemIds: SNAP })],
      settings: { spicyRatio: 0.4 },
    };
    let cursor = 0;
    const ids: (string | null)[] = Array.from({ length: 25 }, (_, i) => (i === 12 ? null : SNAP[cursor++]));
    H.dayBoards.set(1, { uid: 'u1', seed: 111, dayIndex: 1, cells: card((i) => ids[i] as string, params.day1Cells) });
    if (params.day0Overrides !== undefined) {
      H.dayBoards.set(0, { uid: 'u1', seed: 100, dayIndex: 0, cells: card((i) => ids[i] as string, params.day0Overrides) });
    }
    H.player = { uid: 'u1', reshufflesUsed: 0, ...params.playerExtra };
  };

  it('an echo-only card is still reshuffleable, and the replacement re-echoes with its bucket re-derived', async () => {
    seedShuffle({
      // The Day-1 card wears an ECHO of s0 (achieved on Day 0) — pristine.
      day1Cells: { 0: { marked: true, markedAt: 1, status: 'confirmed', echo: true } },
      day0Overrides: { 0: { marked: true, markedAt: 1, status: 'confirmed' } },
      playerExtra: { dayStats: { 1: { bingoCount: 0, squaresMarked: 1, firstBingoAt: null } } },
    });
    await expect(reshuffleBoard({ uid: 'u1', dayIndex: 1, expectedSeed: 111 })).resolves.toBe(1);
    const boardWrite = H.txSet.mock.calls.find((c) => isDayBoardWrite(c, 1))![1] as { cells: Cell[] };
    // The peer Day-0 card still holds s0 confirmed, so the replacement (same
    // 24-Prompt pool after the exclusion reset) arrives echoing it again.
    const echoed = boardWrite.cells.find((c) => c.itemId === 's0')!;
    expect(echoed).toMatchObject({ marked: true, status: 'confirmed', echo: true });
    const playerWrite = H.txSet.mock.calls.find(isPlayerWrite)![1] as Record<string, unknown>;
    expect(playerWrite.reshufflesUsed).toBe(1);
    // The Day-1 bucket is RE-DERIVED from the replacement's echoes — the
    // discarded card's echo stats never survive as phantoms.
    expect((playerWrite.dayStats as Record<number, { squaresMarked: number }>)[1].squaresMarked).toBe(1);
  });

  it('REGRESSION: a no-echo reshuffle keeps the exact two-write shape — the counter write is bare', async () => {
    seedShuffle({ playerExtra: { dayStats: { 1: { bingoCount: 0, squaresMarked: 0, firstBingoAt: null } } } });
    await expect(reshuffleBoard({ uid: 'u1', dayIndex: 1, expectedSeed: 111 })).resolves.toBe(1);
    expect(H.txSet).toHaveBeenCalledTimes(2);
    expect(H.txSet.mock.calls.find(isPlayerWrite)![1]).toEqual({ reshufflesUsed: 1 });
  });
});

describe('reconcileEchoes — open-time backfill (spec § Open-time)', () => {
  const seedReconcile = () => {
    H.dayBoards.set(1, {
      uid: 'u1',
      seed: 111,
      dayIndex: 1,
      cells: card((i) => (i === 4 ? 'shared' : `c${i}`), { 4: { marked: true, markedAt: 1 } }),
    });
    H.dayBoards.set(2, { uid: 'u1', seed: 222, dayIndex: 2, cells: card((i) => (i === 9 ? 'shared' : `d${i}`)) });
    H.player = { uid: 'u1', dayStats: { 1: { bingoCount: 0, squaresMarked: 1, firstBingoAt: null } } };
  };

  it('writes the missing echo onto the opened board (its own markSeed) plus the aggregated player write', async () => {
    seedReconcile();
    const res = await reconcileEchoes({ uid: 'u1', dayIndex: 2, dayIndexes: [0, 1, 2] });
    expect(res.changed).toBe(true);
    const boardWrite = H.batchSet.mock.calls.find((c) => isDayBoardWrite(c, 2))![1] as {
      cells: Cell[];
      markSeed: number;
    };
    expect(boardWrite.markSeed).toBe(222);
    expect(boardWrite.cells.find((c) => c.index === 9)).toMatchObject({ marked: true, echo: true });
    const playerWrite = H.batchSet.mock.calls.find(isPlayerWrite)![1] as { squaresMarked: number };
    expect(playerWrite.squaresMarked).toBe(2);
    expect(H.batchCommit).toHaveBeenCalledTimes(1);
  });

  it('is a zero-write no-op on an already-reconciled board', async () => {
    seedReconcile();
    H.dayBoards.set(2, {
      uid: 'u1',
      seed: 222,
      dayIndex: 2,
      cells: card((i) => (i === 9 ? 'shared' : `d${i}`), {
        9: { marked: true, markedAt: 1, status: 'confirmed', echo: true },
      }),
    });
    const res = await reconcileEchoes({ uid: 'u1', dayIndex: 2, dayIndexes: [0, 1, 2] });
    expect(res.changed).toBe(false);
    expect(H.batchSet).not.toHaveBeenCalled();
    expect(H.batchCommit).not.toHaveBeenCalled();
  });
});

describe('confirmClaim — the admin_confirmed echo moment (spec § Contract)', () => {
  const claim = (over: Partial<ClaimDoc> = {}): ClaimDoc => ({
    id: 'claim-1',
    uid: 'u1',
    displayName: 'Alice',
    cellIndex: 5,
    itemText: 'P shared',
    proofId: null,
    status: 'pending',
    createdAt: PAST,
    dayIndex: 1,
    ...over,
  });
  const seedClaim = () => {
    H.dayBoards.set(1, {
      uid: 'u1',
      seed: 111,
      dayIndex: 1,
      cells: card((i) => (i === 5 ? 'shared' : `a${i}`), {
        5: { marked: true, markedAt: 1, status: 'pending' },
      }),
    });
    H.dayBoards.set(2, { uid: 'u1', seed: 222, dayIndex: 2, cells: card((i) => (i === 7 ? 'shared' : `b${i}`)) });
    H.player = { uid: 'u1', displayName: 'Alice', dayStats: {} };
  };

  it('confirming echoes the Prompt onto sibling carriers, born confirmed, in the ONE transaction', async () => {
    seedClaim();
    await confirmClaim(claim(), 'admin-1');
    const sibWrite = H.txSet.mock.calls.find((c) => isDayBoardWrite(c, 2));
    expect(sibWrite).toBeDefined();
    const payload = sibWrite![1] as { cells: Cell[]; markSeed: number };
    expect(payload.markSeed).toBe(222);
    expect(payload.cells.find((c) => c.index === 7)).toMatchObject({
      marked: true,
      status: 'confirmed',
      echo: true,
    });
    const playerWrites = H.txSet.mock.calls.filter(isPlayerWrite);
    expect(playerWrites).toHaveLength(1); // ONE aggregated write
    const write = playerWrites[0][1] as {
      dayStats: Record<number, { squaresMarked: number }>;
      squaresMarked: number;
    };
    expect(write.dayStats[1].squaresMarked).toBe(1);
    expect(write.dayStats[2].squaresMarked).toBe(1);
    expect(write.squaresMarked).toBe(2);
  });

  it('rejecting echoes NOTHING', async () => {
    seedClaim();
    await rejectClaim(claim(), 'admin-1');
    expect(H.txSet.mock.calls.some((c) => isDayBoardWrite(c, 2))).toBe(false);
  });
});
