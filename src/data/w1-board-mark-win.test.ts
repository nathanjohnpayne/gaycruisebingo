import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Cell } from '../types';

// w1-board-mark-win, unit layer. Three concerns, no Firestore and no emulator:
//   1. computeMark — the pure fold of one Mark toggle into the next Board cells
//      + denormalized Player stats (win detection). Deterministic via injected
//      `now`.
//   2. setMark's write SHAPE — captured through batch spies so we can prove the
//      write set is exactly {board, player} and NOTHING else (no Feed doc, ADR
//      0002) and that it is a plain batch, never a `runTransaction`
//      (offline-queueable, ADR 0006). The durable-across-reload proof is the
//      emulator sibling `tests/offline/w1-board-mark-win.test.ts`.
//   3. setMark's cache-precedence wiring — a caller's `cells` prop can be
//      stale relative to a Mark that already landed in the persistent local
//      cache (two fast taps before the caller's onSnapshot listener has
//      re-rendered it). setMark must fold onto that cache, not the stale
//      prop, or a later write's full-array replacement silently clobbers the
//      earlier Mark. The end-to-end proof against a real emulator + real
//      persistent cache is the same emulator sibling file.

const EVENT_ID = 'med-2026'; // src/firebase.ts default when VITE_EVENT_ID is unset

// A stand-in for the DocumentSnapshot shape setMark actually reads (`exists()`
// + `data()`); typed explicitly so `getDocFromCacheSpy.mockResolvedValueOnce`
// accepts a fake snapshot literal instead of inferring `never` from the
// default rejection below.
type FakeSnap = { exists: () => boolean; data: () => unknown };

const { setSpy, commitSpy, getDocFromCacheSpy } = vi.hoisted(() => ({
  setSpy: vi.fn(),
  commitSpy: vi.fn(() => Promise.resolve()),
  // Rejects by default (nothing cached), matching a fresh test double with no
  // real persistent cache; individual tests override with mockResolvedValueOnce
  // to prove the write folds onto a cached Board instead of a stale `cells` arg.
  getDocFromCacheSpy: vi.fn((): Promise<FakeSnap> => Promise.reject(new Error('no cache in this test double'))),
}));

// Keep the module graph loadable but the write path inspectable: real
// firebase/firestore except `doc` (→ a bare { path }), `writeBatch` (→ our
// spies), `getDocFromCache` (→ our spy), and the write fns we assert are NEVER
// called.
vi.mock('../firebase', () => ({ db: {}, EVENT_ID: 'med-2026' }));
vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return {
    ...actual,
    doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
    writeBatch: () => ({ set: setSpy, commit: commitSpy }),
    getDocFromCache: getDocFromCacheSpy,
    addDoc: vi.fn(),
    runTransaction: vi.fn(),
  };
});

import { computeMark, setMark } from './api';
import { addDoc, runTransaction } from 'firebase/firestore';

// A dealt board: every non-free Square unmarked, the free center (12) "on".
function dealt(): Cell[] {
  return Array.from({ length: 25 }, (_, index) => ({
    index,
    itemId: index === 12 ? null : `i${index}`,
    text: index === 12 ? 'FREE' : `p${index}`,
    free: index === 12,
    marked: index === 12,
    markedAt: null,
  }));
}

// A dealt board with `indices` already marked-confirmed.
function withMarked(indices: number[]): Cell[] {
  const cells = dealt();
  for (const i of indices) cells[i] = { ...cells[i], marked: true, markedAt: 1, status: 'confirmed' };
  return cells;
}

describe('computeMark (win detection + stats)', () => {
  it('marks the target Square confirmed and counts it', () => {
    const r = computeMark({
      cells: dealt(),
      index: 0,
      nextMarked: true,
      claimMode: 'honor',
      currentFirstBingoAt: null,
      now: 1000,
    });
    expect(r.cells[0]).toMatchObject({ marked: true, markedAt: 1000, status: 'confirmed' });
    expect(r.player).toEqual({ squaresMarked: 1, bingoCount: 0, firstBingoAt: null, blackout: false });
    expect(r.bingo).toBe(false);
  });

  it('completing a line is a BINGO and stamps firstBingoAt with now', () => {
    const r = computeMark({
      cells: withMarked([0, 1, 2, 3]), // top row minus the last Square
      index: 4,
      nextMarked: true,
      claimMode: 'honor',
      currentFirstBingoAt: null,
      now: 2000,
    });
    expect(r.bingo).toBe(true);
    expect(r.player.bingoCount).toBe(1);
    expect(r.player.squaresMarked).toBe(5);
    expect(r.player.firstBingoAt).toBe(2000);
  });

  it('preserves an existing firstBingoAt while a BINGO still stands', () => {
    const r = computeMark({
      cells: withMarked([0, 1, 2, 3, 4]), // a standing top-row BINGO
      index: 5,
      nextMarked: true,
      claimMode: 'honor',
      currentFirstBingoAt: 111,
      now: 3000,
    });
    expect(r.bingo).toBe(true);
    expect(r.player.firstBingoAt).toBe(111); // not re-stamped to now
  });

  it('unmarking away the last BINGO clears firstBingoAt', () => {
    const r = computeMark({
      cells: withMarked([0, 1, 2, 3, 4]),
      index: 4,
      nextMarked: false,
      claimMode: 'honor',
      currentFirstBingoAt: 111,
      now: 4000,
    });
    expect(r.cells[4]).toMatchObject({ marked: false, markedAt: null });
    expect(r.player.bingoCount).toBe(0);
    expect(r.player.firstBingoAt).toBeNull();
  });

  it('admin_confirmed marks start pending, so they do not yet count', () => {
    const r = computeMark({
      cells: dealt(),
      index: 0,
      nextMarked: true,
      claimMode: 'admin_confirmed',
      currentFirstBingoAt: null,
      now: 5000,
    });
    expect(r.cells[0].status).toBe('pending');
    expect(r.player.squaresMarked).toBe(0); // pending is excluded from the mask
    expect(r.bingo).toBe(false);
  });

  it('marking the final Square is a Blackout', () => {
    const all = Array.from({ length: 25 }, (_, i) => i).filter((i) => i !== 12 && i !== 0);
    const r = computeMark({
      cells: withMarked(all), // everything but the free center and Square 0
      index: 0,
      nextMarked: true,
      claimMode: 'honor',
      currentFirstBingoAt: 111,
      now: 6000,
    });
    expect(r.blackout).toBe(true);
    expect(r.player.blackout).toBe(true);
  });
});

describe('setMark (write shape)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes only the board + player docs in one batch — no Feed doc, no transaction', async () => {
    const res = await setMark({
      uid: 'u1',
      cells: dealt(),
      index: 3,
      nextMarked: true,
      claimMode: 'honor',
      currentFirstBingoAt: null,
    });

    // Exactly two writes: the board, then the player — both partial merges.
    expect(setSpy).toHaveBeenCalledTimes(2);
    expect(setSpy.mock.calls[0][0].path).toBe(`events/${EVENT_ID}/boards/u1`);
    expect(setSpy.mock.calls[1][0].path).toBe(`events/${EVENT_ID}/players/u1`);
    expect(setSpy.mock.calls[0][2]).toEqual({ merge: true });
    expect(setSpy.mock.calls[1][2]).toEqual({ merge: true });
    expect((setSpy.mock.calls[0][1].cells as Cell[])[3].marked).toBe(true);
    expect(setSpy.mock.calls[1][1]).toMatchObject({
      squaresMarked: 1,
      bingoCount: 0,
      firstBingoAt: null,
      blackout: false,
    });

    // ADR 0002: a bare Mark posts nothing to the Feed (no addDoc to moments/proofs).
    expect(addDoc).not.toHaveBeenCalled();
    // ADR 0006: offline-queueable — a batch, never a transaction.
    expect(runTransaction).not.toHaveBeenCalled();
    // Fire-and-forget commit; the win result comes back from the local compute.
    expect(commitSpy).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ cells: expect.any(Array), bingo: false, blackout: false });
  });
});

describe('setMark (folds onto the freshest cached Board, not a stale cells prop)', () => {
  // Two Marks issued in quick succession (two fast taps, or another of the
  // owner's own tabs) fire before the live listener has re-rendered the
  // caller with the first Mark, so a caller-supplied `cells` prop can be
  // stale relative to a Mark that ALREADY landed in the shared persistent
  // cache. setMark must fold onto that cache, not the stale prop, or the
  // second write's full-array replacement silently clobbers the first Mark.
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('a cached Board with a newer Mark wins over the caller-supplied stale cells', async () => {
    const cachedCells = dealt();
    cachedCells[5] = { ...cachedCells[5], marked: true, markedAt: 500, status: 'confirmed' };
    getDocFromCacheSpy.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ cells: cachedCells }),
    });

    await setMark({
      uid: 'u1',
      cells: dealt(), // stale: this caller does not know about index 5 yet
      index: 6,
      nextMarked: true,
      claimMode: 'honor',
      currentFirstBingoAt: null,
    });

    const boardWrite = setSpy.mock.calls[0][1] as { cells: Cell[] };
    expect(boardWrite.cells[5].marked).toBe(true); // survived, from the cache
    expect(boardWrite.cells[6].marked).toBe(true); // this Mark
    const playerWrite = setSpy.mock.calls[1][1] as { squaresMarked: number };
    expect(playerWrite.squaresMarked).toBe(2); // both count, not just this call's
  });

  // Overlap, not just staleness: Board.toggle fires doMark without awaiting,
  // so two Marks can BOTH pass getDocFromCache before either has issued its
  // batch — the cache fold alone cannot help if neither write has applied
  // yet. setMark serializes per board (Codex P1, PR #75); this test's fake
  // cache returns whatever the LAST board batch.set wrote (the latency-
  // compensation contract), so an unserialized setMark makes both reads see
  // the pristine board and the final write carries only one Mark.
  it('two unawaited overlapping Marks both land — the second folds onto the first (serialization)', async () => {
    getDocFromCacheSpy.mockImplementation((ref?: unknown) => {
      const path = (ref as { path?: string })?.path ?? '';
      if (path.endsWith('/boards/u1')) {
        const boardWrites = setSpy.mock.calls.filter((c) =>
          (c[0] as { path: string }).path.endsWith('/boards/u1'),
        );
        const last = boardWrites[boardWrites.length - 1];
        if (!last) return Promise.reject(new Error('not cached'));
        return Promise.resolve({
          exists: () => true,
          data: () => ({ cells: (last[1] as { cells: Cell[] }).cells }),
        });
      }
      return Promise.reject(new Error('not cached'));
    });

    const common = {
      uid: 'u1',
      cells: dealt(),
      nextMarked: true,
      claimMode: 'honor' as const,
      currentFirstBingoAt: null,
    };
    await Promise.all([setMark({ ...common, index: 3 }), setMark({ ...common, index: 7 })]);

    const boardWrites = setSpy.mock.calls.filter((c) =>
      (c[0] as { path: string }).path.endsWith('/boards/u1'),
    );
    expect(boardWrites).toHaveLength(2);
    const finalBoard = boardWrites[1][1] as { cells: Cell[] };
    expect(finalBoard.cells[3].marked).toBe(true); // first Mark survived into the second write
    expect(finalBoard.cells[7].marked).toBe(true);
    const playerWrites = setSpy.mock.calls.filter((c) =>
      (c[0] as { path: string }).path.endsWith('/players/u1'),
    );
    expect((playerWrites[playerWrites.length - 1][1] as { squaresMarked: number }).squaresMarked).toBe(2);
  });

  it('falls back to the caller-supplied cells when nothing is cached yet', async () => {
    getDocFromCacheSpy.mockRejectedValueOnce(new Error('not cached'));

    await setMark({
      uid: 'u1',
      cells: dealt(),
      index: 4,
      nextMarked: true,
      claimMode: 'honor',
      currentFirstBingoAt: null,
    });

    const boardWrite = setSpy.mock.calls[0][1] as { cells: Cell[] };
    expect(boardWrite.cells[4].marked).toBe(true);
  });

  it('falls back to the caller-supplied cells when the cache has no Board doc yet', async () => {
    getDocFromCacheSpy.mockResolvedValueOnce({ exists: () => false, data: () => undefined });

    await setMark({
      uid: 'u1',
      cells: dealt(),
      index: 8,
      nextMarked: true,
      claimMode: 'honor',
      currentFirstBingoAt: null,
    });

    const boardWrite = setSpy.mock.calls[0][1] as { cells: Cell[] };
    expect(boardWrite.cells[8].marked).toBe(true);
  });

  it('a cached Player firstBingoAt wins over a stale (null) currentFirstBingoAt prop', async () => {
    // A standing top-row BINGO already landed in the cache (from a Mark that
    // stamped firstBingoAt=777), but the caller's own `currentFirstBingoAt`
    // prop is still null -- its onSnapshot listener has not echoed that write
    // back yet. Marking another Square that does not break the standing line
    // must preserve 777, not re-stamp `now`, mirroring the cells fix above.
    getDocFromCacheSpy.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ cells: withMarked([0, 1, 2, 3, 4]) }),
    });
    getDocFromCacheSpy.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ firstBingoAt: 777 }),
    });

    await setMark({
      uid: 'u1',
      cells: dealt(), // stale: does not know about the standing bingo
      index: 6,
      nextMarked: true,
      claimMode: 'honor',
      currentFirstBingoAt: null, // stale: does not know firstBingoAt was stamped
    });

    const playerWrite = setSpy.mock.calls[1][1] as { firstBingoAt: number | null };
    expect(playerWrite.firstBingoAt).toBe(777); // preserved from the cache, not re-stamped
  });
});
