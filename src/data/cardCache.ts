import type { Cell } from '../types';

// The active Event id, derived the SAME way src/firebase.ts does. Read inline
// (not imported from ../firebase) so this pure localStorage helper never pulls
// the Firebase app-init module into a consumer's import graph — a bare
// save/load round-trip must run in a unit test without Firebase config.
const EVENT_ID = import.meta.env.VITE_EVENT_ID || 'med-2026';

// Bump when the stored shape changes: an older-version blob reads as a MISS
// (null), never as a mis-shaped card.
const SNAPSHOT_VERSION = 1;

// One key per (event, user): the LATEST card this device painted for the
// current cruise. Event-scoped exactly like `hasCachedCard` (src/data/api.ts)
// so a PRIOR cruise's snapshot can never render for a new Event, and uid-scoped
// so account B never sees account A's saved card.
function keyFor(uid: string): string {
  return `gcb:card-snapshot:${EVENT_ID}:${uid}`;
}

// The presentational Day header the fallback paints — a tiny subset of DayDef
// (no snapshotItemIds or scoring inputs) so the stored blob stays small. Null
// for a legacy single-board Event with no day schedule.
export interface CardSnapshotDay {
  number: number; // day.index + 1 (1..10)
  port: string;
  portEmoji: string;
  theme: string; // ThemeId string — drives the `data-theme` gradient theming
  label: string; // resolved theme label for the header line
}

export interface CardSnapshot {
  v: number;
  uid: string;
  eventId: string;
  dayIndex: number | null; // null for a legacy single board
  savedAt: number;
  bingoCount: number;
  cells: Cell[];
  day: CardSnapshotDay | null;
}

// localStorage access throws in some privacy modes (and is absent under SSR),
// so every touch is guarded — a missing store means "no durable cache", never
// a crash. The durable cache is an ENHANCEMENT over the live Firestore-cached
// Board, never a dependency of it.
function store(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/**
 * Persist the card the Player is currently looking at, so a later transient
 * deal failure or offline reload can render it in place of the full-screen
 * "we couldn't deal your card" reload screen (#434). Best-effort: an empty
 * card, a missing store, or a quota/serialization failure is swallowed.
 */
export function saveCardSnapshot(input: {
  uid: string;
  dayIndex: number | null;
  cells: Cell[];
  bingoCount: number;
  day: CardSnapshotDay | null;
}): void {
  const ls = store();
  if (!ls || !input.uid || input.cells.length === 0) return;
  const snapshot: CardSnapshot = {
    v: SNAPSHOT_VERSION,
    uid: input.uid,
    eventId: EVENT_ID,
    dayIndex: input.dayIndex,
    savedAt: Date.now(),
    bingoCount: input.bingoCount,
    cells: input.cells,
    day: input.day,
  };
  try {
    ls.setItem(keyFor(input.uid), JSON.stringify(snapshot));
  } catch {
    /* quota exceeded / serialization failure — skip; the live Board still renders */
  }
}

/**
 * This device's durable card snapshot for (event, user), or null on ANY miss:
 * absent, unparseable, a stale schema version, or a uid/event mismatch (so
 * another account's or another cruise's card is never rendered). Reads the
 * local store only — no network, never throws.
 */
export function loadCardSnapshot(uid: string): CardSnapshot | null {
  const ls = store();
  if (!ls || !uid) return null;
  try {
    const raw = ls.getItem(keyFor(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CardSnapshot> | null;
    if (
      !parsed ||
      parsed.v !== SNAPSHOT_VERSION ||
      parsed.uid !== uid ||
      parsed.eventId !== EVENT_ID ||
      !Array.isArray(parsed.cells) ||
      parsed.cells.length === 0
    ) {
      return null;
    }
    return parsed as CardSnapshot;
  } catch {
    return null;
  }
}

/** True when a renderable card snapshot exists for this (event, user). */
export function hasCardSnapshot(uid: string): boolean {
  return loadCardSnapshot(uid) !== null;
}
