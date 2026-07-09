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
  spicy: boolean;
}

/**
 * Stratified sample of 24 picks from `pool`: `spicyRatio` of them (rounded)
 * drawn from the spicy category, the rest from tame, each category shuffled
 * independently with the SAME seeded `rnd` for determinism. Backfills from
 * the other category when one runs short (so a thin category still yields a
 * full 24, so long as the pool overall has >= MIN_POOL), then re-shuffles the
 * chosen 24 so spicy/tame interleave across grid positions instead of
 * clustering (e.g. all spicy picks landing in the shuffled pool's front).
 */
function stratifiedPicks(pool: DealItem[], spicyRatio: number, rnd: () => number): DealItem[] {
  const spicyPool = shuffle(pool.filter((p) => p.spicy), rnd);
  const tamePool = shuffle(pool.filter((p) => !p.spicy), rnd);
  const targetSpicy = Math.round(24 * spicyRatio);
  const targetTame = 24 - targetSpicy;
  let spicyTaken = Math.min(spicyPool.length, targetSpicy);
  let tameTaken = Math.min(tamePool.length, targetTame + (targetSpicy - spicyTaken));
  const remaining = 24 - spicyTaken - tameTaken;
  if (remaining > 0) {
    spicyTaken += Math.min(spicyPool.length - spicyTaken, remaining);
  }
  const picks = [...spicyPool.slice(0, spicyTaken), ...tamePool.slice(0, tameTaken)];
  return shuffle(picks, rnd); // re-shuffle so spicy/tame interleave across grid positions, not cluster
}

/** Deal a frozen 5x5 board: 24 sampled prompts + free center (index 12). */
export function dealBoard(
  pool: DealItem[],
  freeText: string,
  seed: number,
  spicyRatio: number = 0.4,
): Cell[] {
  // A board needs MIN_POOL (24) non-free prompts; dealing from a smaller pool
  // would leave blank cells (itemId: null, empty text). Fail fast so callers
  // (joinAndDeal) never persist a broken board. This guard fires before any
  // stratification, so it is unaffected by ratio/backfill.
  if (pool.length < MIN_POOL) {
    throw new Error(`dealBoard needs at least ${MIN_POOL} prompts, received ${pool.length}.`);
  }
  const rnd = mulberry32(seed);
  // A malformed events/{id}.settings.spicyRatio (join-side only checks
  // typeof === 'number', so NaN/Infinity/out-of-0..1 values can reach here)
  // must not corrupt the slice math below (Math.round(NaN) etc. would starve
  // both categories and let MIN_POOL pass while the board still gets blank
  // non-free cells, Codex #135). Clamp to a finite 0..1, falling back to the
  // default ratio when the value isn't usably numeric at all.
  const ratio = Number.isFinite(spicyRatio) ? Math.min(1, Math.max(0, spicyRatio)) : 0.4;
  const picks = stratifiedPicks(pool, ratio, rnd);
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

/** Leaderboard order: bingos desc, then squares desc, then earliest first-bingo; two no-bingo Players tie at exactly 0. */
export function comparePlayers(a: Rankable, b: Rankable): number {
  if (b.bingoCount !== a.bingoCount) return b.bingoCount - a.bingoCount;
  if (b.squaresMarked !== a.squaresMarked) return b.squaresMarked - a.squaresMarked;
  // Both no-bingo: an explicit stable 0. Without this guard the `?? Infinity`
  // fallback below computes Infinity - Infinity = NaN, and a NaN comparator
  // result gives Array.prototype.sort unspecified order for the pair (#93).
  if (a.firstBingoAt == null && b.firstBingoAt == null) return 0;
  const af = a.firstBingoAt ?? Number.POSITIVE_INFINITY;
  const bf = b.firstBingoAt ?? Number.POSITIVE_INFINITY;
  return af - bf;
}

export function sortPlayers<T extends Rankable>(players: T[]): T[] {
  return players.slice().sort(comparePlayers);
}
