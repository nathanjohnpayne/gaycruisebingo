// The Board `cells` WIRE SHAPE (#457): a MAP keyed by the canonical decimal
// cell index ('0'..'24'), not an array. Pure, framework-free converters —
// no Firebase, fully unit-testable (src/game/cells.test.ts).
//
// WHY A MAP. A Cell[] array can only be written wholesale, so every Mark was
// a full-array replacement and two DEVICES of the same account writing from
// different cache states could silently erase each other's Marks — the class
// PR #447's review loop proved unclosable by any version-counter scheme
// (#447 rounds 1/6; the markVersion guard this schema RETIRES). A map merges:
// a Mark is a per-cell `{ merge: true }` write of ONLY the touched cells, so
// concurrent writes to DIFFERENT cells commute under Firestore's merge
// semantics and a same-cell conflict collapses to last-write-wins on that one
// square (same player, same square — self-evident, not data loss).
//
// The APP-SIDE contract stays `Cell[]` (BoardDoc.cells, src/types.ts): the
// pure game logic, win masks, and rendering all index arrays. These helpers
// are the boundary — reads normalize (either wire shape, plus the pre-#457
// array shape still present in caches and any straggler doc the migration
// missed), writes emit the map.

import type { Cell } from '../types';

/** The wire shape: cells keyed by canonical decimal index ('0'..'24'). */
export type CellsMap = Record<string, Cell>;

/** Full-board write shape (deal / reshuffle / the migration): every cell. */
export function cellsToMap(cells: readonly Cell[]): CellsMap {
  const map: CellsMap = {};
  for (const cell of cells) map[String(cell.index)] = cell;
  return map;
}

/**
 * Partial write shape (a Mark, an echo, a claim resolve): ONLY the changed
 * cells, keyed for a `{ merge: true }` set that leaves every sibling cell
 * untouched on the server — the whole point of the map schema.
 */
export function cellsPatch(changed: readonly Cell[]): CellsMap {
  return cellsToMap(changed);
}

/**
 * The `cells` FIELD of a merge payload — or NOTHING when the patch is empty.
 * An explicitly empty nested map in a `{ merge: true }` write is NOT a no-op:
 * the SDK puts the field itself in the write mask, which would SET `cells` to
 * `{}` and wipe every cell on the server (Phase 4b P1 on #458). Spread this
 * into the payload so a no-op transform writes no `cells` key at all.
 */
export function cellsPatchField(changed: readonly Cell[]): { cells: CellsMap } | Record<string, never> {
  return changed.length > 0 ? { cells: cellsPatch(changed) } : {};
}

/**
 * The cells a pure transform actually CHANGED, by reference identity: every
 * transform in this codebase (`computeMark`, `applyEchoes`, the claim-resolve
 * mappers) maps the array and returns UNTOUCHED cells by the same reference,
 * so identity inequality is exactly "this cell was rewritten". Positional —
 * both arrays are the same board before/after.
 */
export function changedCells(before: readonly Cell[], after: readonly Cell[]): Cell[] {
  const changed: Cell[] = [];
  for (let i = 0; i < after.length; i++) {
    if (after[i] !== before[i]) changed.push(after[i]);
  }
  return changed;
}

/**
 * Normalize a raw Firestore `cells` value to the app-side `Cell[]`, in index
 * order. Accepts BOTH wire shapes — the #457 map and the legacy array (still
 * in persistent caches, pre-migration docs, and the localStorage card
 * snapshot) — plus absent/malformed values, which read as an empty board.
 * The single read boundary every raw (converter-free) `snap.data()` access
 * goes through; `boardConverter` routes through it too.
 */
export function cellsFromData(value: unknown): Cell[] {
  if (Array.isArray(value)) return value as Cell[];
  if (value != null && typeof value === 'object') {
    return (Object.values(value) as Cell[])
      .filter((c) => c != null && typeof c === 'object' && typeof (c as Cell).index === 'number')
      .sort((a, b) => a.index - b.index);
  }
  return [];
}
