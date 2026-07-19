/**
 * Pure motion helpers for the slot-machine polish pass (specs/motion-polish.md).
 *
 * The animation system itself is CSS (index.css § "motion"); this module holds
 * the few numbers a component has to compute per element — the deal cascade's
 * per-Square delay, the winning line's shimmer order, and the celebration's
 * confetti burst — as pure functions so the timing contract is unit-testable
 * without mounting Board or Celebration (the same split fitText.ts uses for
 * the Square auto-fit guard).
 */

/** Column stagger for the deal-in cascade: Squares land column by column,
 * left to right — the slot-machine "reels settle in order" read. */
export const DEAL_COLUMN_STAGGER_MS = 60;
/** Row stagger layered on top, so each column's Squares also trickle top to
 * bottom instead of landing as one solid bar. */
export const DEAL_ROW_STAGGER_MS = 25;
/** Board grid dimension — the deal cascade derives column/row from a cell
 * index the same way game/logic.ts derives lines. */
const GRID_SIZE = 5;

/**
 * The deal-in delay for a Square at `index` (0..24, row-major). Bounded: the
 * whole cascade resolves within (4·60 + 4·25) = 340ms of delay plus the
 * animation's own duration, so a fresh card is fully landed well under a
 * second. Out-of-range indexes clamp into the grid rather than producing a
 * runaway delay from malformed data.
 */
export function dealDelayMs(index: number): number {
  const safe = Number.isFinite(index) ? Math.min(Math.max(Math.trunc(index), 0), GRID_SIZE * GRID_SIZE - 1) : 0;
  const col = safe % GRID_SIZE;
  const row = Math.floor(safe / GRID_SIZE);
  return col * DEAL_COLUMN_STAGGER_MS + row * DEAL_ROW_STAGGER_MS;
}

/**
 * Shimmer order for the winning line(s): cell index → position in the wave,
 * ascending by index so the glow sweeps the line in reading order. The CSS
 * (`.cell.win`) multiplies this by its own per-step delay.
 */
export function winOrder(wins: Iterable<number>): Map<number, number> {
  const order = new Map<number, number>();
  [...wins]
    .sort((a, b) => a - b)
    .forEach((index, position) => order.set(index, position));
  return order;
}

/** One confetti particle, expressed entirely in CSS-consumable values. Colors
 * are theme TOKENS, never literals, so every Theme's burst matches its own
 * palette (the same rule as every other color in the app — themes.css). */
export type ConfettiPiece = {
  /** Horizontal spawn point, percent of the overlay's width. */
  leftPct: number;
  /** Stagger before this piece starts falling. */
  delayMs: number;
  /** Fall duration — varied per piece so the burst rains, not marches. */
  durationMs: number;
  /** Horizontal drift across the fall, px (signed). */
  driftPx: number;
  /** Total rotation across the fall, deg (signed). */
  spinDeg: number;
  /** Particle width, px (height is 1.6× in CSS). */
  sizePx: number;
  /** A theme token reference (`var(--primary)` &c.). */
  color: string;
};

/** The token cycle a burst draws from — the Theme's own festival colors. */
export const CONFETTI_COLORS = [
  'var(--primary)',
  'var(--secondary)',
  'var(--accent)',
  'var(--ink)',
] as const;

/** Burst sizes: BINGO gets a shower, blackout gets the full jackpot. */
export const CONFETTI_COUNT_BINGO = 48;
export const CONFETTI_COUNT_BLACKOUT = 72;

/**
 * Build a confetti burst. `random` is injectable so tests can pin the output;
 * callers use the default. All ranges are bounded so no piece can outlive the
 * celebration's few-second attention span or spawn off-screen.
 */
export function confettiPieces(count: number, random: () => number = Math.random): ConfettiPiece[] {
  return Array.from({ length: Math.max(0, count) }, (_, i) => ({
    leftPct: random() * 100,
    delayMs: Math.round(random() * 500),
    durationMs: Math.round(2200 + random() * 1600),
    driftPx: Math.round((random() - 0.5) * 280),
    spinDeg: Math.round((random() - 0.5) * 2 * 900),
    sizePx: Math.round(6 + random() * 5),
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
  }));
}
