// Pure, framework-free game logic. No Firebase, no React — fully unit-testable.
import type { Cell, PlayerDoc } from '../types';

export const GRID = 5;
export const CENTER = 12;

/**
 * Minimum active, non-free Prompt pool needed to deal a Board: 24 = the 25 cells
 * minus the free center (ADR 0003). Below this, `dealBoard` fails fast (ADR 0004
 * guard) rather than persisting a card with blank cells. Exported so the Board
 * render can surface the same threshold instead of duplicating the literal.
 */
export const MIN_POOL = 24;

/** The 12 winning lines (5 rows, 5 cols, 2 diagonals) as cell indices. */
export const LINES: number[][] = (() => {
  const L: number[][] = [];
  for (let r = 0; r < GRID; r++) L.push([0, 1, 2, 3, 4].map((k) => r * GRID + k));
  for (let c = 0; c < GRID; c++) L.push([0, 1, 2, 3, 4].map((k) => k * GRID + c));
  L.push([0, 6, 12, 18, 24]);
  L.push([4, 8, 12, 16, 20]);
  return L;
})();

/** mulberry32 — tiny deterministic PRNG so a board is reproducible from its seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(arr: T[], rnd: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export interface DealItem {
  id: string;
  text: string;
}

/** Deal a frozen 5x5 board: 24 sampled prompts + free center (index 12). */
export function dealBoard(pool: DealItem[], freeText: string, seed: number): Cell[] {
  // A board needs MIN_POOL (24) non-free prompts; dealing from a smaller pool
  // would leave blank cells (itemId: null, empty text). Fail fast so callers
  // (joinAndDeal) never persist a broken board.
  if (pool.length < MIN_POOL) {
    throw new Error(`dealBoard needs at least ${MIN_POOL} prompts, received ${pool.length}.`);
  }
  const rnd = mulberry32(seed);
  const picks = shuffle(pool, rnd).slice(0, 24);
  const cells: Cell[] = [];
  let p = 0;
  for (let i = 0; i < 25; i++) {
    if (i === CENTER) {
      cells.push({ index: i, itemId: null, text: freeText, free: true, marked: true, markedAt: null });
    } else {
      const item = picks[p++];
      cells.push({
        index: i,
        itemId: item ? item.id : null,
        text: item ? item.text : '',
        free: false,
        marked: false,
        markedAt: null,
      });
    }
  }
  return cells;
}

/** A cell counts as "on" if it's the free center, or marked and not pending. */
export function markedMask(cells: Cell[]): boolean[] {
  return cells.map((c) => c.free || (c.marked && c.status !== 'pending'));
}

export function completedLines(cells: Cell[]): number[][] {
  const m = markedMask(cells);
  return LINES.filter((line) => line.every((i) => m[i]));
}

export function hasBingo(cells: Cell[]): boolean {
  return completedLines(cells).length > 0;
}

/** Set of cell indices that are part of any completed line (for highlighting). */
export function winningCells(cells: Cell[]): Set<number> {
  const s = new Set<number>();
  for (const line of completedLines(cells)) for (const i of line) s.add(i);
  return s;
}

export function isBlackout(cells: Cell[]): boolean {
  return markedMask(cells).every(Boolean);
}

/** Squares the player actively marked (free center excluded). */
export function countMarked(cells: Cell[]): number {
  return cells.filter((c) => !c.free && c.marked && c.status !== 'pending').length;
}

export type Rankable = Pick<PlayerDoc, 'bingoCount' | 'squaresMarked' | 'firstBingoAt'>;

/** Leaderboard order: bingos desc, then squares desc, then earliest first-bingo. */
export function comparePlayers(a: Rankable, b: Rankable): number {
  if (b.bingoCount !== a.bingoCount) return b.bingoCount - a.bingoCount;
  if (b.squaresMarked !== a.squaresMarked) return b.squaresMarked - a.squaresMarked;
  const af = a.firstBingoAt ?? Number.POSITIVE_INFINITY;
  const bf = b.firstBingoAt ?? Number.POSITIVE_INFINITY;
  return af - bf;
}

export function sortPlayers<T extends Rankable>(players: T[]): T[] {
  return players.slice().sort(comparePlayers);
}
