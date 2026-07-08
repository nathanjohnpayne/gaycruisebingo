import { describe, it, expect } from 'vitest';
import { comparePlayers, sortPlayers, type Rankable } from './logic';

// specs/w2-leaderboard.md — issue #35. comparePlayers/sortPlayers already
// exist and ship the PRD tie-break (bingos desc -> squares desc -> earliest
// firstBingoAt); this file is the verification layer the ticket asks for
// ("under verification, not change"), not a rewrite. src/game/logic.test.ts
// already has a smaller 'leaderboard ordering' block — this file is the
// basename-aligned, more exhaustive tie-break table plus the null-last rule
// pinned in isolation.

function player(over: Partial<Rankable>): Rankable {
  return { bingoCount: 0, squaresMarked: 0, firstBingoAt: null, ...over };
}

describe('comparePlayers — bingos desc, then squares desc, then earliest firstBingoAt', () => {
  it('ranks strictly by bingoCount first, regardless of squares or firstBingoAt', () => {
    const more = player({ bingoCount: 3, squaresMarked: 1, firstBingoAt: 9000 });
    const fewer = player({ bingoCount: 2, squaresMarked: 20, firstBingoAt: 100 });
    expect(comparePlayers(more, fewer)).toBeLessThan(0); // `more` sorts first
    expect(comparePlayers(fewer, more)).toBeGreaterThan(0);
  });

  it('falls through to squaresMarked desc once bingoCount ties', () => {
    const moreSquares = player({ bingoCount: 1, squaresMarked: 10, firstBingoAt: 9000 });
    const fewerSquares = player({ bingoCount: 1, squaresMarked: 5, firstBingoAt: 100 });
    expect(comparePlayers(moreSquares, fewerSquares)).toBeLessThan(0);
    expect(comparePlayers(fewerSquares, moreSquares)).toBeGreaterThan(0);
  });

  it('falls through to earliest firstBingoAt once bingoCount AND squaresMarked both tie', () => {
    const earlier = player({ bingoCount: 2, squaresMarked: 8, firstBingoAt: 100 });
    const later = player({ bingoCount: 2, squaresMarked: 8, firstBingoAt: 200 });
    expect(comparePlayers(earlier, later)).toBeLessThan(0);
    expect(comparePlayers(later, earlier)).toBeGreaterThan(0);
  });

  it('is exactly 0 for two fully-tied Players', () => {
    const a = player({ bingoCount: 1, squaresMarked: 4, firstBingoAt: 500 });
    const b = player({ bingoCount: 1, squaresMarked: 4, firstBingoAt: 500 });
    expect(comparePlayers(a, b)).toBe(0);
    expect(comparePlayers(b, a)).toBe(0);
  });

  describe('a null firstBingoAt (no bingo yet) sorts LAST among an equal bingoCount/squaresMarked tie', () => {
    it('a null firstBingoAt sorts after a numeric one', () => {
      const noBingo = player({ bingoCount: 0, squaresMarked: 3, firstBingoAt: null });
      const hasBingo = player({ bingoCount: 0, squaresMarked: 3, firstBingoAt: 1 });
      expect(comparePlayers(noBingo, hasBingo)).toBeGreaterThan(0);
      expect(comparePlayers(hasBingo, noBingo)).toBeLessThan(0);
    });

    it('a null firstBingoAt sorts after even a very late numeric one (no Infinity-adjacent surprise)', () => {
      const noBingo = player({ bingoCount: 2, squaresMarked: 6, firstBingoAt: null });
      const veryLate = player({ bingoCount: 2, squaresMarked: 6, firstBingoAt: Number.MAX_SAFE_INTEGER });
      expect(comparePlayers(noBingo, veryLate)).toBeGreaterThan(0);
    });

    it('two null-firstBingoAt Players: the raw comparator is NaN (Infinity - Infinity), not 0 — a pre-existing arithmetic quirk of the `?? Infinity` fallback, pinned honestly rather than asserted as a clean tie', () => {
      // comparePlayers is under verification, not change, here — this is the
      // function's REAL behavior on current `main`, not a bug this ticket
      // introduces or a spec this ticket sets. The sortPlayers-level test
      // below confirms the quirk is harmless for the Leaderboard: engines
      // (V8 included) treat a NaN comparator result like "equal" (no swap),
      // so the overall order still comes out stable.
      const a = player({ bingoCount: 0, squaresMarked: 3, firstBingoAt: null });
      const b = player({ bingoCount: 0, squaresMarked: 3, firstBingoAt: null });
      expect(Number.isNaN(comparePlayers(a, b))).toBe(true);
      expect(Number.isNaN(comparePlayers(b, a))).toBe(true);
    });
  });
});

describe('sortPlayers — purity and stability the presentational filter layer depends on', () => {
  it('returns a new array and never mutates the input array or its order', () => {
    const input: Rankable[] = [
      player({ bingoCount: 0, squaresMarked: 1, firstBingoAt: null }),
      player({ bingoCount: 2, squaresMarked: 1, firstBingoAt: null }),
    ];
    const before = [...input];

    const sorted = sortPlayers(input);

    expect(sorted).not.toBe(input);
    expect(input).toEqual(before); // the caller's array is untouched
  });

  it('is a stable sort: fully-tied Players keep their original relative order', () => {
    interface Tagged extends Rankable {
      id: string;
    }
    const a: Tagged = { id: 'a', bingoCount: 1, squaresMarked: 4, firstBingoAt: 500 };
    const b: Tagged = { id: 'b', bingoCount: 1, squaresMarked: 4, firstBingoAt: 500 };
    const c: Tagged = { id: 'c', bingoCount: 1, squaresMarked: 4, firstBingoAt: 500 };

    expect(sortPlayers([a, b, c]).map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(sortPlayers([c, b, a]).map((p) => p.id)).toEqual(['c', 'b', 'a']);
  });

  it('stays stable even when two null-firstBingoAt Players tie (comparePlayers is NaN for that pair, not 0)', () => {
    interface Tagged extends Rankable {
      id: string;
    }
    const a: Tagged = { id: 'a', bingoCount: 0, squaresMarked: 3, firstBingoAt: null };
    const b: Tagged = { id: 'b', bingoCount: 0, squaresMarked: 3, firstBingoAt: null };
    const c: Tagged = { id: 'c', bingoCount: 0, squaresMarked: 3, firstBingoAt: null };

    // No crash, and the input order survives — Array.prototype.sort treats a
    // NaN comparator result like "equal" (no swap) rather than throwing.
    expect(sortPlayers([a, b, c]).map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(sortPlayers([c, b, a]).map((p) => p.id)).toEqual(['c', 'b', 'a']);
  });
});

describe('sortPlayers — the full PRD tie-break table end to end (bingos desc, squares desc, earliest first-bingo, null last)', () => {
  it('orders a mixed roster through every tie-break level in one pass', () => {
    interface Tagged extends Rankable {
      id: string;
    }
    const mostBingos: Tagged = { id: 'most-bingos', bingoCount: 3, squaresMarked: 1, firstBingoAt: 9000 };
    const tieBingoMoreSquares: Tagged = {
      id: 'tie-bingo-more-squares',
      bingoCount: 1,
      squaresMarked: 20,
      firstBingoAt: 5000,
    };
    const tieBingoEarlier: Tagged = { id: 'tie-bingo-earlier', bingoCount: 1, squaresMarked: 10, firstBingoAt: 100 };
    const tieBingoLater: Tagged = { id: 'tie-bingo-later', bingoCount: 1, squaresMarked: 10, firstBingoAt: 200 };
    const tieBingoNull: Tagged = { id: 'tie-bingo-null', bingoCount: 1, squaresMarked: 10, firstBingoAt: null };
    const noBingoMoreSquares: Tagged = {
      id: 'no-bingo-more-squares',
      bingoCount: 0,
      squaresMarked: 15,
      firstBingoAt: null,
    };
    const noBingoFewerSquares: Tagged = {
      id: 'no-bingo-fewer-squares',
      bingoCount: 0,
      squaresMarked: 2,
      firstBingoAt: null,
    };

    // Shuffled input — sortPlayers must recover the canonical order below
    // regardless of input order.
    const shuffled = [
      noBingoFewerSquares,
      tieBingoLater,
      mostBingos,
      tieBingoNull,
      noBingoMoreSquares,
      tieBingoEarlier,
      tieBingoMoreSquares,
    ];

    const order = sortPlayers(shuffled).map((p) => p.id);

    expect(order).toEqual([
      'most-bingos', // bingoCount 3 beats everything
      'tie-bingo-more-squares', // bingoCount 1 tier, most squares (20)
      'tie-bingo-earlier', // bingoCount 1, squares 10, earlier firstBingoAt
      'tie-bingo-later', // bingoCount 1, squares 10, later firstBingoAt
      'tie-bingo-null', // bingoCount 1, squares 10, null firstBingoAt sorts LAST in this tier
      'no-bingo-more-squares', // bingoCount 0 tier, more squares
      'no-bingo-fewer-squares', // bingoCount 0 tier, fewer squares
    ]);
  });
});
