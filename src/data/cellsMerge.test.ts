import { describe, it, expect } from 'vitest';
import { FieldPath } from 'firebase/firestore';
import type { Cell } from '../types';
import { cellsMergeSet } from './cellsMerge';
import { cellsPatch } from '../game/cells';

// specs/cells-map.md — the write-options boundary (#458 4b rounds 1 + 8):
// a per-cell patch must be written with a mergeFields mask (one FieldPath per
// changed cell, replacing that cell WHOLESALE so omission-removed fields like
// `echo` cannot survive a deep merge), and an empty patch must contribute
// neither a `cells` key nor any cell field path.

function cell(index: number, overrides: Partial<Cell> = {}): Cell {
  return {
    index,
    itemId: `item-${index}`,
    text: `Prompt ${index}`,
    free: false,
    marked: false,
    markedAt: null,
    ...overrides,
  };
}

describe('cellsMergeSet', () => {
  it('builds data + a per-cell FieldPath mask, replacing each changed cell wholesale', () => {
    const [data, options] = cellsMergeSet(cellsPatch([cell(3, { marked: true, markedAt: 7 }), cell(9)]), {
      markSeed: 42,
    });
    expect(Object.keys((data as { cells: Record<string, Cell> }).cells)).toEqual(['3', '9']);
    expect(data.markSeed).toBe(42);
    expect(options.mergeFields).toHaveLength(3);
    // Cell masks are FieldPath('cells', i) — the REPLACE-wholesale form; a
    // string 'cells' path (or { merge: true }) would deep-merge field-by-field
    // and let omission-removed fields (echo, echoOptOut, proofId) survive.
    expect(options.mergeFields[0]).toBeInstanceOf(FieldPath);
    expect((options.mergeFields[0] as FieldPath).isEqual(new FieldPath('cells', '3'))).toBe(true);
    expect((options.mergeFields[1] as FieldPath).isEqual(new FieldPath('cells', '9'))).toBe(true);
    expect(options.mergeFields[2]).toBe('markSeed');
  });

  it('an EMPTY patch contributes no cells key and no cell paths — extras still write', () => {
    const [data, options] = cellsMergeSet(cellsPatch([]), { markSeed: 42 });
    expect('cells' in data).toBe(false);
    expect(data.markSeed).toBe(42);
    expect(options.mergeFields).toEqual(['markSeed']);
  });

  it('no extras: the pair degenerates to just the patch and its cell paths', () => {
    const [data, options] = cellsMergeSet(cellsPatch([cell(5)]));
    expect(Object.keys(data)).toEqual(['cells']);
    expect(options.mergeFields).toHaveLength(1);
  });
});
