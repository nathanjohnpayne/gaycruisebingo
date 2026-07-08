import { describe, it, expect } from 'vitest';
import {
  LINES,
  dealBoard,
  hasBingo,
  isBlackout,
  countMarked,
  winningCells,
  sortPlayers,
  comparePlayers,
  CENTER,
  type DealItem,
} from './logic';

const pool: DealItem[] = Array.from({ length: 32 }, (_, i) => ({
  id: `i${i}`,
  text: `prompt ${i}`,
}));

describe('LINES', () => {
  it('has 12 winning lines of 5', () => {
    expect(LINES).toHaveLength(12);
    for (const l of LINES) expect(l).toHaveLength(5);
  });
});

describe('dealBoard', () => {
  it('produces 25 cells with a free, pre-marked center', () => {
    const cells = dealBoard(pool, 'FREE', 123);
    expect(cells).toHaveLength(25);
    expect(cells[CENTER].free).toBe(true);
    expect(cells[CENTER].marked).toBe(true);
    expect(cells[CENTER].text).toBe('FREE');
  });

  it('is deterministic for a given seed and varies across seeds', () => {
    const a = dealBoard(pool, 'FREE', 42).map((c) => c.itemId);
    const b = dealBoard(pool, 'FREE', 42).map((c) => c.itemId);
    const c = dealBoard(pool, 'FREE', 43).map((x) => x.itemId);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('draws 24 unique prompts + null center', () => {
    const ids = dealBoard(pool, 'FREE', 7).filter((c) => !c.free).map((c) => c.itemId);
    expect(ids).toHaveLength(24);
    expect(new Set(ids).size).toBe(24);
  });

  it('throws when the active pool has fewer than 24 prompts', () => {
    // Guard at logic.ts: a board needs 24 non-free prompts; a smaller pool would
    // leave blank cells, so dealBoard must fail fast rather than persist a broken
    // board. 23 is the boundary just under the minimum.
    const tooFew = pool.slice(0, 23);
    expect(tooFew).toHaveLength(23);
    expect(() => dealBoard(tooFew, 'FREE', 1)).toThrow(/at least 24 prompts/);
  });
});

describe('win detection', () => {
  it('detects a bingo only when a full line (incl. free center) is marked', () => {
    const cells = dealBoard(pool, 'FREE', 1);
    // Middle row is 10,11,12,13,14; center (12) already free.
    expect(hasBingo(cells)).toBe(false);
    for (const i of [10, 11, 13, 14]) cells[i].marked = true;
    expect(hasBingo(cells)).toBe(true);
    expect(winningCells(cells).has(12)).toBe(true);
  });

  it('ignores pending marks in admin-confirmed mode', () => {
    const cells = dealBoard(pool, 'FREE', 2);
    for (const i of [10, 11, 13, 14]) {
      cells[i].marked = true;
      cells[i].status = 'pending';
    }
    expect(hasBingo(cells)).toBe(false);
  });

  it('counts marked squares excluding the free center', () => {
    const cells = dealBoard(pool, 'FREE', 3);
    cells[0].marked = true;
    cells[1].marked = true;
    expect(countMarked(cells)).toBe(2);
  });

  it('recognizes a blackout', () => {
    const cells = dealBoard(pool, 'FREE', 4);
    for (const c of cells) c.marked = true;
    expect(isBlackout(cells)).toBe(true);
  });
});

describe('leaderboard ordering', () => {
  it('ranks by bingos, then squares, then earliest first-bingo', () => {
    const players = [
      { bingoCount: 1, squaresMarked: 5, firstBingoAt: 200 },
      { bingoCount: 2, squaresMarked: 3, firstBingoAt: 300 },
      { bingoCount: 1, squaresMarked: 5, firstBingoAt: 100 },
      { bingoCount: 1, squaresMarked: 9, firstBingoAt: 400 },
    ];
    const sorted = sortPlayers(players);
    expect(sorted[0].bingoCount).toBe(2); // most bingos wins
    expect(sorted[1].squaresMarked).toBe(9); // then most squares
    expect(sorted[2].firstBingoAt).toBe(100); // tie broken by earliest
    expect(sorted[3].firstBingoAt).toBe(200);
  });

  it('treats no-bingo (null) as last among equals', () => {
    expect(
      comparePlayers(
        { bingoCount: 0, squaresMarked: 2, firstBingoAt: null },
        { bingoCount: 0, squaresMarked: 2, firstBingoAt: 500 },
      ),
    ).toBeGreaterThan(0);
  });
});
