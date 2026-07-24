import { describe, it, expect } from 'vitest';
import type { Cell } from '../types';
import { cellsToMap, cellsPatch, cellsPatchField, changedCells, cellsFromData, type CellsMap } from './cells';

// specs/cells-map.md — the pure wire-shape boundary: array↔map conversion,
// the changed-cell diff every partial write derives from, and the tolerant
// read normalization. No Firebase anywhere.

function board(overrides: Partial<Record<number, Partial<Cell>>> = {}): Cell[] {
  return Array.from({ length: 25 }, (_, index) => {
    const base: Cell =
      index === 12
        ? { index, itemId: null, text: 'FREE', free: true, marked: true, markedAt: null }
        : { index, itemId: `item-${index}`, text: `Prompt ${index}`, free: false, marked: false, markedAt: null };
    return { ...base, ...(overrides[index] ?? {}) };
  });
}

describe('cellsToMap / cellsFromData — the wire round-trip', () => {
  it('round-trips a full board losslessly, keyed by canonical decimal index', () => {
    const cells = board({ 3: { marked: true, markedAt: 9 } });
    const map = cellsToMap(cells);
    expect(Object.keys(map)).toHaveLength(25);
    expect(map['3'].marked).toBe(true);
    expect(cellsFromData(map)).toEqual(cells);
  });

  it('normalizes the LEGACY array shape unchanged (pre-migration docs and caches)', () => {
    const cells = board();
    expect(cellsFromData(cells)).toBe(cells); // identity — no copy for arrays
  });

  it('sorts map values by index regardless of key insertion order', () => {
    const cells = board();
    const shuffled: CellsMap = {};
    for (const i of [24, 0, 12, 7, 19]) shuffled[String(i)] = cells[i];
    for (const c of cells) shuffled[String(c.index)] ??= c;
    expect(cellsFromData(shuffled).map((c) => c.index)).toEqual(cells.map((c) => c.index));
  });

  it('reads absent and malformed values as an empty board, dropping junk entries', () => {
    expect(cellsFromData(undefined)).toEqual([]);
    expect(cellsFromData(null)).toEqual([]);
    expect(cellsFromData(7)).toEqual([]);
    expect(cellsFromData({ a: 'junk', '3': board()[3] })).toHaveLength(1);
  });
});

describe('changedCells / cellsPatch — the partial-write derivation', () => {
  it('collects exactly the reference-changed cells, positionally', () => {
    const before = board();
    const after = before.map((c) => (c.index === 5 ? { ...c, marked: true, markedAt: 1 } : c));
    const changed = changedCells(before, after);
    expect(changed).toHaveLength(1);
    expect(changed[0].index).toBe(5);
    // The patch keys the changed cell for a { merge: true } write.
    expect(cellsPatch(changed)).toEqual({ '5': after[5] });
  });

  it('an untouched transform yields an EMPTY patch — nothing to write, nothing to clobber', () => {
    const before = board();
    expect(changedCells(before, before)).toEqual([]);
    expect(cellsPatch([])).toEqual({});
  });

  it('cellsPatchField OMITS the cells key entirely for an empty patch (Phase 4b P1 on #458)', () => {
    // An explicit empty nested map in a { merge: true } write is NOT a no-op —
    // the field enters the write mask and would wipe every cell on the server.
    expect(cellsPatchField([])).toEqual({});
    expect('cells' in cellsPatchField([])).toBe(false);
    const changed = changedCells(board(), board({ 5: { marked: true, markedAt: 1 } }).map((c, i) => (i === 5 ? c : board()[i])));
    void changed; // shape sanity for the non-empty half below
    const nonEmpty = cellsPatchField([board({ 5: { marked: true, markedAt: 1 } })[5]]);
    expect('cells' in nonEmpty && Object.keys((nonEmpty as { cells: CellsMap }).cells)).toEqual(['5']);
  });
});
