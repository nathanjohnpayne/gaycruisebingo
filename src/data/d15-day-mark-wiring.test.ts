import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Cell, ClaimMode } from '../types';

// Regression for #246 — the launch-blocking corruption. The per-Day Day Card
// machinery existed but setMark still wrote the single LEGACY board
// (events/{eventId}/boards/{uid}) and folded onto whatever board was cached, so
// switching Day tabs and marking summed the SAME board's marks into multiple
// `dayStats` buckets — inflating the cruise leaderboard. These tests pin the
// wiring the bug was missing:
//   1. In daily mode a Mark writes the DAY-SCOPED board
//      events/{eventId}/days/{dayIndex}/boards/{uid} — never the legacy path.
//   2. Marking Day 0 then Day 1 folds into SEPARATE `dayStats` buckets, and the
//      cruise-wide root total is their SUM, not a double-count.
// The fold math itself is proven in src/game/logic; this file proves the
// Firestore-facing routing setMark now does with `daily`/`dayIndex`.

const EVENT_ID = 'test-event';

const H = vi.hoisted(() => ({
  dayBoards: new Map<number, { uid: string; cells: Cell[]; dayIndex: number } | null>(),
  player: null as unknown,
  getDocFromCache: vi.fn(),
  batchSet: vi.fn(),
  batchCommit: vi.fn(async () => {}),
}));

vi.mock('../firebase', () => ({
  db: {},
  EVENT_ID: 'test-event',
  storage: {},
  auth: {},
  googleProvider: {},
  analytics: null,
}));

vi.mock('firebase/firestore', () => {
  const makeRef = (kind: string, args: unknown[]) => {
    const ref: Record<string, unknown> = { kind, args };
    ref.withConverter = () => ref;
    return ref;
  };
  return {
    doc: (...args: unknown[]) => makeRef('doc', args),
    collection: (...args: unknown[]) => makeRef('collection', args),
    query: (...args: unknown[]) => ({ query: args }),
    where: (...args: unknown[]) => ({ where: args }),
    getDoc: vi.fn(),
    getDocFromCache: H.getDocFromCache,
    getDocFromServer: vi.fn(),
    getDocs: vi.fn(),
    writeBatch: () => ({ set: H.batchSet, commit: H.batchCommit }),
    addDoc: vi.fn(),
    increment: vi.fn(),
    runTransaction: vi.fn(),
    setDoc: vi.fn(),
    updateDoc: vi.fn(),
    deleteField: vi.fn(),
    onSnapshot: vi.fn(),
    serverTimestamp: vi.fn(),
    getFirestore: vi.fn(),
  };
});

import { setMark } from './api';

const snap = (exists: boolean, data: unknown = undefined) => ({ exists: () => exists, data: () => data });

// Route a cache read by its path args to the right fixture.
function route(ref: { args?: unknown[] }) {
  const a = (ref.args ?? []).filter((x): x is string => typeof x === 'string');
  if (a[2] === 'days' && a[4] === 'boards') {
    const board = H.dayBoards.get(Number(a[3]));
    return board ? snap(true, board) : snap(false);
  }
  if (a[2] === 'players') {
    return H.player != null ? snap(true, H.player) : snap(false);
  }
  return snap(false);
}

// 25 cells: free centre (12) marked, plus non-free cells 0..markedCount-1 marked.
function dayCells(markedCount: number): Cell[] {
  return Array.from({ length: 25 }, (_, index) => {
    const free = index === 12;
    const marked = free || (index < markedCount);
    return {
      index,
      itemId: free ? null : `d-i${index}`,
      text: free ? 'FREE' : `Prompt ${index}`,
      free,
      marked,
      markedAt: marked ? 0 : null,
    };
  });
}

const U = 'sailor-1';

// The board write's (dayIndex path segment, cells) — the day-scoped Board doc.
function boardWrite(): { dayIndexSegment: string; cells: Cell[] } | null {
  for (const call of H.batchSet.mock.calls) {
    const ref = call[0] as { args?: unknown[] };
    const a = (ref.args ?? []).filter((x): x is string => typeof x === 'string');
    if (a[2] === 'days' && a[4] === 'boards') {
      return { dayIndexSegment: a[3], cells: (call[1] as { cells: Cell[] }).cells };
    }
  }
  return null;
}
// Any write to the LEGACY single board path — must NEVER happen in daily mode.
function legacyBoardWritten(): boolean {
  return H.batchSet.mock.calls.some((call) => {
    const a = ((call[0] as { args?: unknown[] }).args ?? []).filter((x): x is string => typeof x === 'string');
    return a[1] === EVENT_ID && a[2] === 'boards';
  });
}
function playerWrite(): { dayStats?: Record<number, { squaresMarked: number }>; squaresMarked?: number } {
  for (const call of H.batchSet.mock.calls) {
    const a = ((call[0] as { args?: unknown[] }).args ?? []).filter((x): x is string => typeof x === 'string');
    if (a[2] === 'players') return call[1] as { dayStats?: Record<number, { squaresMarked: number }>; squaresMarked?: number };
  }
  return {};
}

async function mark(dayIndex: number, cells: Cell[], index: number) {
  return setMark({
    uid: U,
    cells,
    index,
    nextMarked: true,
    claimMode: 'honor' as ClaimMode,
    currentFirstBingoAt: null,
    dayIndex,
    daily: true,
    tutorialDayIndexes: [],
  });
}

beforeEach(() => {
  H.dayBoards.clear();
  H.player = null;
  H.getDocFromCache.mockReset();
  H.getDocFromCache.mockImplementation(async (ref: { args?: unknown[] }) => route(ref));
  H.batchSet.mockReset();
  H.batchCommit.mockReset();
  H.batchCommit.mockResolvedValue(undefined);
});

describe('setMark — day-scoped write + per-Day fold (#246)', () => {
  it('writes the DAY-SCOPED board for the viewed Day, never the legacy single board', async () => {
    H.dayBoards.set(3, { uid: U, dayIndex: 3, cells: dayCells(2) });

    await mark(3, dayCells(2), /* mark non-free cell */ 2);

    const bw = boardWrite();
    expect(bw).not.toBeNull();
    expect(bw!.dayIndexSegment).toBe('3'); // events/{id}/days/3/boards/{uid}
    expect(legacyBoardWritten()).toBe(false); // the pre-fix path is never touched
  });

  it('marking Day 0 then Day 1 keeps SEPARATE buckets and sums the cruise total (no double-count)', async () => {
    // `countMarked` excludes the free centre. Day 0: base has non-free 0,1 marked.
    // Marking cell 2 → 3 marked squares.
    H.dayBoards.set(0, { uid: U, dayIndex: 0, cells: dayCells(2) });
    await mark(0, dayCells(2), 2);
    const afterDay0 = playerWrite();
    expect(afterDay0.dayStats?.[0]?.squaresMarked).toBe(3); // non-free 0,1,2
    expect(afterDay0.squaresMarked).toBe(3); // cruise total = just Day 0 so far

    H.batchSet.mockReset();

    // Day 1 has its OWN board: non-free 0,1,2 marked. Marking cell 3 → 4 marked.
    // The player row now carries Day 0's settled bucket (the read setMark folds onto).
    H.dayBoards.set(1, { uid: U, dayIndex: 1, cells: dayCells(3) });
    H.player = { dayStats: { 0: { bingoCount: 0, squaresMarked: 3, firstBingoAt: null } } };

    await mark(1, dayCells(3), 3);
    const afterDay1 = playerWrite();

    // The Day-1 Mark writes the Day-1 board, folds ONLY the Day-1 bucket, and the
    // cruise-wide root is Day 0 + Day 1 — never Day 1 re-counted onto Day 0's board.
    expect(boardWrite()!.dayIndexSegment).toBe('1');
    expect(afterDay1.dayStats?.[1]?.squaresMarked).toBe(4); // non-free 0,1,2,3
    expect(afterDay1.dayStats?.[0]).toBeUndefined(); // merge preserves Day 0; the write carries only Day 1
    expect(afterDay1.squaresMarked).toBe(7); // 3 (Day 0) + 4 (Day 1), summed — not doubled
  });
});
