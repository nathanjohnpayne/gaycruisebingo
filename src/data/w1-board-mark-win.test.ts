import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Cell } from '../types';

// w1-board-mark-win, unit layer. Two concerns, no Firestore and no emulator:
//   1. computeMark — the pure fold of one Mark toggle into the next Board cells
//      + denormalized Player stats (win detection). Deterministic via injected
//      `now`.
//   2. setMark's write SHAPE — captured through batch spies so we can prove the
//      write set is exactly {board, player} and NOTHING else (no Feed doc, ADR
//      0002) and that it is a plain batch, never a `runTransaction`
//      (offline-queueable, ADR 0006). The durable-across-reload proof is the
//      emulator sibling `tests/offline/w1-board-mark-win.test.ts`.

const EVENT_ID = 'med-2026'; // src/firebase.ts default when VITE_EVENT_ID is unset

const { setSpy, commitSpy } = vi.hoisted(() => ({
  setSpy: vi.fn(),
  commitSpy: vi.fn(() => Promise.resolve()),
}));

// Keep the module graph loadable but the write path inspectable: real
// firebase/firestore except `doc` (→ a bare { path }), `writeBatch` (→ our
// spies), and the write fns we assert are NEVER called.
vi.mock('../firebase', () => ({ db: {}, EVENT_ID: 'med-2026' }));
vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return {
    ...actual,
    doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
    writeBatch: () => ({ set: setSpy, commit: commitSpy }),
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
