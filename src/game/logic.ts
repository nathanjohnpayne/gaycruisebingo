// Pure, framework-free game logic. No Firebase, no React — fully unit-testable.
import type { Cell, DayDef, PlayerDoc } from '../types';

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

function interleavePicks(spicyPicks: DealItem[], tamePicks: DealItem[]): DealItem[] {
  const total = spicyPicks.length + tamePicks.length;
  const slots: (DealItem | null)[] = Array(total).fill(null);

  // Place the smaller category first, spread evenly across the 24 non-free
  // positions, then fill the rest. This guarantees the composition pattern
  // cannot collapse into a random row-sized cluster for unlucky seeds while
  // keeping each category's own seeded shuffle order intact.
  const primary = spicyPicks.length <= tamePicks.length ? spicyPicks : tamePicks;
  const secondary = spicyPicks.length <= tamePicks.length ? tamePicks : spicyPicks;
  const primarySlots = new Set<number>();
  for (let i = 0; i < primary.length; i++) {
    primarySlots.add(Math.floor(((i + 0.5) * total) / primary.length));
  }
  let primaryIndex = 0;
  let secondaryIndex = 0;
  for (let i = 0; i < total; i++) {
    slots[i] = primarySlots.has(i) ? primary[primaryIndex++] : secondary[secondaryIndex++];
  }

  return slots as DealItem[];
}

/**
 * Stratified sample of 24 picks from `pool`: `spicyRatio` of them (rounded)
 * drawn from the spicy category, the rest from tame, each category shuffled
 * independently with the SAME seeded `rnd` for determinism. Backfills from
 * the other category when one runs short (so a thin category still yields a
 * full 24, so long as the pool overall has >= MIN_POOL), then lays out the
 * chosen categories evenly across the 24 non-free positions so spicy/tame
 * interleave instead of clustering.
 */
function stratifiedPicks(pool: DealItem[], spicyRatio: number, rnd: () => number): DealItem[] {
  const spicyPool = shuffle(
    pool.filter((p) => p.spicy),
    rnd,
  );
  const tamePool = shuffle(
    pool.filter((p) => !p.spicy),
    rnd,
  );
  const targetSpicy = Math.round(24 * spicyRatio);
  const targetTame = 24 - targetSpicy;
  let spicyTaken = Math.min(spicyPool.length, targetSpicy);
  let tameTaken = Math.min(tamePool.length, targetTame + (targetSpicy - spicyTaken));
  const remaining = 24 - spicyTaken - tameTaken;
  if (remaining > 0) {
    spicyTaken += Math.min(spicyPool.length - spicyTaken, remaining);
  }
  return interleavePicks(spicyPool.slice(0, spicyTaken), tamePool.slice(0, tameTaken));
}

/** Shuffle the whole pool and take the first 24 — no spicy/tame target. Used
 * for tutorial (embark/farewell) Day Snapshots, which are seeded all-tame, so
 * forcing a spicy ratio against them is meaningless (daily-cards-spec §
 * "Unlock mechanics": "tutorial pools are all tame so they deal unstratified").
 */
function unstratifiedPicks(pool: DealItem[], rnd: () => number): DealItem[] {
  return shuffle(pool, rnd).slice(0, 24);
}

/**
 * Options for a per-Day deal (daily-cards-spec § "Unlock mechanics").
 *   - `excludeIds`: Prompt ids already on this Player's earlier Day Cards, to be
 *     kept off the new card (no-repeat-across-the-cruise). Exclusion is best-effort:
 *     if honoring it would drop the usable pool below `MIN_POOL`, the pool is
 *     exhausted (~80 main items ÷ 24/day ≈ 3⅓ Days) and the exclusion RESETS —
 *     the full pool is used again, exactly the spec's reset boundary.
 *   - `stratify`: false for all-tame tutorial pools (no spicy/tame target); the
 *     default (true) keeps the 10-spicy/14-tame stratified composition.
 */
export interface DealOptions {
  excludeIds?: ReadonlySet<string>;
  stratify?: boolean;
}

/**
 * Apply the no-repeat exclusion with the pool-exhaustion reset: drop every id in
 * `excludeIds`, but if that would leave fewer than `MIN_POOL` Prompts to deal
 * from, discard the exclusion and return the full pool (the cruise has cycled
 * through the pool; repeats resume rather than starving the card). Returns the
 * original array reference when there is nothing to exclude.
 */
function applyExclusion(pool: DealItem[], excludeIds?: ReadonlySet<string>): DealItem[] {
  if (!excludeIds || excludeIds.size === 0) return pool;
  const remaining = pool.filter((p) => !excludeIds.has(p.id));
  return remaining.length >= MIN_POOL ? remaining : pool;
}

/** Deal a frozen 5x5 board: 24 sampled prompts + free center (index 12). */
export function dealBoard(
  pool: DealItem[],
  freeText: string,
  seed: number,
  spicyRatio: number = 0.4,
  opts: DealOptions = {},
): Cell[] {
  // Honor the no-repeat exclusion BEFORE the MIN_POOL guard so the guard checks
  // what will actually be dealt from; `applyExclusion` already resets the
  // exclusion (returns the full pool) when honoring it would starve the deal.
  const usablePool = applyExclusion(pool, opts.excludeIds);
  // A board needs MIN_POOL (24) non-free prompts; dealing from a smaller pool
  // would leave blank cells (itemId: null, empty text). Fail fast so callers
  // (joinAndDeal, dealDayCard) never persist a broken board. This guard fires
  // before any stratification, so it is unaffected by ratio/backfill.
  if (usablePool.length < MIN_POOL) {
    throw new Error(`dealBoard needs at least ${MIN_POOL} prompts, received ${usablePool.length}.`);
  }
  const rnd = mulberry32(seed);
  // A malformed events/{id}.settings.spicyRatio (join-side only checks
  // typeof === 'number', so NaN/Infinity/out-of-0..1 values can reach here)
  // must not corrupt the slice math below (Math.round(NaN) etc. would starve
  // both categories and let MIN_POOL pass while the board still gets blank
  // non-free cells, Codex #135). Clamp to a finite 0..1, falling back to the
  // default ratio when the value isn't usably numeric at all.
  const ratio = Number.isFinite(spicyRatio) ? Math.min(1, Math.max(0, spicyRatio)) : 0.4;
  const picks =
    opts.stratify === false
      ? unstratifiedPicks(usablePool, rnd)
      : stratifiedPicks(usablePool, ratio, rnd);
  const cells: Cell[] = [];
  let p = 0;
  for (let i = 0; i < 25; i++) {
    if (i === CENTER) {
      cells.push({
        index: i,
        itemId: null,
        text: freeText,
        free: true,
        marked: true,
        markedAt: null,
      });
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

/**
 * Cosmetic-celebration edge (#176). The animation must fire whenever the player
 * completes a NEW winning line, not only the first. Tracking a boolean "has any
 * bingo" flips false→true exactly once, so a 2nd/3rd line never re-triggered it.
 * Comparing the completed-line COUNT against the previous count fixes that:
 * `gained` is true iff a line was just added (a rising edge in the count), and
 * a line falling away (count decreasing) never fires. Returns `lines` so the
 * caller can store it as the next baseline.
 */
export function bingoLineEdge(
  cells: Cell[],
  prevLineCount: number,
): { lines: number; gained: boolean } {
  const lines = completedLines(cells).length;
  return { lines, gained: lines > prevLineCount };
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

/**
 * The four states a Day Card can be in for a given Player, derived purely from
 * the DayDef schedule, the current clock, and whether the Player already has a
 * Board for that Day (daily-cards-spec § "Unlock mechanics"). This is the single
 * gate both the deal write path (`dealDayCard`) and the client (`useDayCard`)
 * read, so "when do we deal / what do we render" has one source of truth.
 *
 *   - `locked` — `now < unlockAt`: the Day is not open. Render the locked
 *     preview; never deal.
 *   - `waking` — unlocked, but `snapshotItemIds` is still ABSENT (null/undefined
 *     — scheduler lag). This mirrors the scheduler's own `isDueForSnapshot`
 *     (`snapshotItemIds == null`) EXACTLY, so a Day the scheduler stamped with an
 *     empty pool is never classed `waking` forever. Show the "waking up" wait
 *     state; NEVER deal from a live pool.
 *   - `ready` — unlocked and the Day Snapshot is stamped (present — possibly an
 *     empty `[]` for a Day with no eligible Prompts), no Board yet: deal. An empty
 *     stamped pool falls through to the deal path's thin-pool failure rather than
 *     waiting on a scheduler write that will never come.
 *   - `dealt` — the Player already has a Board for this Day: a no-op (re-opening
 *     an already-dealt Day never re-deals).
 */
export type DayDealState = 'locked' | 'waking' | 'ready' | 'dealt';

export function dayDealState(params: {
  unlockAt: number;
  snapshotItemIds?: string[];
  now: number;
  hasBoard: boolean;
}): DayDealState {
  if (params.hasBoard) return 'dealt';
  if (params.now < params.unlockAt) return 'locked';
  if (params.snapshotItemIds == null) return 'waking';
  return 'ready';
}

// --- Cruise-wide scoring aggregation (daily-cards-spec § "Scoring and social
// surfaces", #212) -----------------------------------------------------------
//
// With ten Day Cards, a Player's `PlayerDoc.bingoCount`/`squaresMarked`/
// `firstBingoAt` root fields are no longer one Board's totals — they are
// cruise-wide aggregates over `PlayerDoc.dayStats`, one bucket per Day Card.
// These pure helpers own that derivation so the write path (`foldDayStat` in
// data/api.ts) and the read surfaces (Leaderboard) share ONE source of truth.
// The tie-break ORDER (`comparePlayers`) is unchanged — only its inputs are.

/** One Day Card's contribution to a Player's cruise totals. */
export type DayStat = { bingoCount: number; squaresMarked: number; firstBingoAt: number | null };
export type DayStats = Record<number, DayStat>;

/** The set of tutorial (embark/farewell) Day indexes from an Event's schedule.
 *  The cruise-wide First to BINGO honor excludes these Days (spec § "Resolved
 *  decisions" #2) — every other aggregate still counts them. */
export function tutorialDayIndexSet(days: readonly DayDef[] | undefined): Set<number> {
  const s = new Set<number>();
  for (const d of days ?? []) if (d.tutorial) s.add(d.index);
  return s;
}

/** Sum `bingoCount` + `squaresMarked` across EVERY Day Card, tutorial Days
 *  included — the embark card is real pre-freeze play (spec § "Implementation
 *  notes": cruise-wide totals). */
export function sumDayStats(dayStats: DayStats | undefined): {
  bingoCount: number;
  squaresMarked: number;
} {
  let bingoCount = 0;
  let squaresMarked = 0;
  for (const stat of Object.values(dayStats ?? {})) {
    bingoCount += stat.bingoCount;
    squaresMarked += stat.squaresMarked;
  }
  return { bingoCount, squaresMarked };
}

/** The cruise-wide First to BINGO time: the earliest `firstBingoAt` across the
 *  MAIN-GAME Days only — tutorial Days are excluded even when their bingo is
 *  numerically earlier (the embark card is trivially easy and live before anyone
 *  boards, so it must never decide the headline honor). Returns `null` when no
 *  main-game Day carries a first bingo. */
export function cruiseFirstBingoAt(
  dayStats: DayStats | undefined,
  isTutorialDay: (dayIndex: number) => boolean,
): number | null {
  let earliest: number | null = null;
  for (const [key, stat] of Object.entries(dayStats ?? {})) {
    if (isTutorialDay(Number(key))) continue;
    if (stat.firstBingoAt == null) continue;
    if (earliest == null || stat.firstBingoAt < earliest) earliest = stat.firstBingoAt;
  }
  return earliest;
}

/** Derive a Player's cruise-wide root totals from their per-Day `dayStats`:
 *  bingos/squares summed over all Days, First to BINGO restricted to main-game
 *  Days. This is exactly the `PlayerDoc` root shape the Leaderboard ranks on. */
export function aggregatePlayerStats(
  dayStats: DayStats | undefined,
  isTutorialDay: (dayIndex: number) => boolean,
): DayStat {
  return {
    ...sumDayStats(dayStats),
    firstBingoAt: cruiseFirstBingoAt(dayStats, isTutorialDay),
  };
}

/**
 * A Player's EFFECTIVE cruise First to BINGO for the Leaderboard pin: the
 * tutorial-excluded earliest over `dayStats` when the Player has any per-Day
 * breakdown, else the legacy root `firstBingoAt` (a pre-Phase-1.5 or
 * single-Board roster carries no `dayStats`, so its root value stands). This is
 * what makes the "1st BINGO" pin cruise-wide-restricted without regressing a
 * roster that predates Day Cards.
 */
export function effectiveCruiseFirstBingoAt(
  player: Pick<PlayerDoc, 'firstBingoAt' | 'dayStats'>,
  isTutorialDay: (dayIndex: number) => boolean,
): number | null {
  if (player.dayStats && Object.keys(player.dayStats).length > 0) {
    return cruiseFirstBingoAt(player.dayStats, isTutorialDay);
  }
  return player.firstBingoAt;
}

/** The uid of the cruise-wide First to BINGO holder across a roster — the
 *  earliest effective (tutorial-excluded) first bingo. `undefined` when nobody
 *  holds a qualifying main-game bingo. */
export function cruiseFirstBingoUid(
  players: readonly PlayerDoc[],
  isTutorialDay: (dayIndex: number) => boolean,
): string | undefined {
  let best: { uid: string; at: number } | undefined;
  for (const p of players) {
    const at = effectiveCruiseFirstBingoAt(p, isTutorialDay);
    if (at == null) continue;
    if (!best || at < best.at) best = { uid: p.uid, at };
  }
  return best?.uid;
}

/** A Player-write bucket: the day/root stats, with `firstBingoAt` OPTIONAL so a
 *  `{ merge: true }` write can OMIT it (the #75 unknown-state preserve). */
export type StatWrite = { bingoCount: number; squaresMarked: number; firstBingoAt?: number | null };

/**
 * Fold `computeMark`'s per-Board result (which IS one Day Card's stat bucket)
 * into a Player's `dayStats`, then re-derive the cruise-wide root totals — the
 * write-path composition the Mark path (`setMark`) commits. Returns a
 * `{ merge: true }`-friendly partial: `dayStats` carries ONLY the marked Day's
 * bucket (a nested merge preserves every other Day's entry on the server), plus
 * the summed root `bingoCount`/`squaresMarked` and the cruise-wide `firstBingoAt`.
 *
 * `firstBingoAt` is OMITTED — from BOTH the Day bucket and the root — exactly
 * when `computeMark` omitted it AND this Day has no prior stamp: the unknown-
 * local-state case (#75, a cache-miss Mark while a bingo already stood), so the
 * merge preserves whatever earlier stamp the server holds rather than writing a
 * value derived from unknown state. Every other case writes a concrete stamp.
 */
export function foldDayStat(params: {
  priorDayStats: DayStats | undefined;
  dayIndex: number;
  bucket: StatWrite;
  blackout: boolean;
  isTutorialDay?: (dayIndex: number) => boolean;
}): {
  dayStats: Record<number, StatWrite>;
  bingoCount: number;
  squaresMarked: number;
  blackout: boolean;
  firstBingoAt?: number | null;
} {
  const { priorDayStats, dayIndex, bucket, blackout } = params;
  const isTutorialDay = params.isTutorialDay ?? (() => false);
  const prior = priorDayStats ?? {};
  const priorBucket = prior[dayIndex];
  const omitFirst = !('firstBingoAt' in bucket);
  // Preserve only when the fold gave no value AND this Day holds no prior stamp
  // — otherwise there is a concrete value to write (the fold's, or the Day's own
  // earlier stamp on an unknown-while-standing further mark).
  const preserve = omitFirst && priorBucket?.firstBingoAt == null;
  const dayFirst = omitFirst ? (priorBucket?.firstBingoAt ?? null) : (bucket.firstBingoAt ?? null);

  const dayBucket: StatWrite = { bingoCount: bucket.bingoCount, squaresMarked: bucket.squaresMarked };
  if (!preserve) dayBucket.firstBingoAt = dayFirst;

  // The merged view for the SUM + earliest math (this Day resolved to dayFirst).
  const merged: DayStats = {
    ...prior,
    [dayIndex]: { bingoCount: bucket.bingoCount, squaresMarked: bucket.squaresMarked, firstBingoAt: dayFirst },
  };
  const { bingoCount, squaresMarked } = sumDayStats(merged);

  const out: {
    dayStats: Record<number, StatWrite>;
    bingoCount: number;
    squaresMarked: number;
    blackout: boolean;
    firstBingoAt?: number | null;
  } = { dayStats: { [dayIndex]: dayBucket }, bingoCount, squaresMarked, blackout };
  if (!preserve) out.firstBingoAt = cruiseFirstBingoAt(merged, isTutorialDay);
  return out;
}

/** One Day's pinned First to BINGO honor, derived from the roster's `dayStats`. */
export interface DayHonor {
  dayIndex: number;
  uid: string;
  displayName: string;
  firstBingoAt: number;
}

/**
 * The per-Day First to BINGO honors strip: for each Day any Player has bingoed
 * on, the Player with the earliest `firstBingoAt` on that Day. Every Day gets
 * its own daily honor — tutorial Days included (their exclusion is ONLY from the
 * cruise-wide headline, not their own per-Day pin). Sorted by Day index.
 */
export function perDayHonors(players: readonly PlayerDoc[]): DayHonor[] {
  const best = new Map<number, DayHonor>();
  for (const p of players) {
    for (const [key, stat] of Object.entries(p.dayStats ?? {})) {
      if (stat.firstBingoAt == null) continue;
      const dayIndex = Number(key);
      const cur = best.get(dayIndex);
      if (!cur || stat.firstBingoAt < cur.firstBingoAt) {
        best.set(dayIndex, {
          dayIndex,
          uid: p.uid,
          displayName: p.displayName,
          firstBingoAt: stat.firstBingoAt,
        });
      }
    }
  }
  return [...best.values()].sort((a, b) => a.dayIndex - b.dayIndex);
}
