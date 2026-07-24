import { describe, it, expect } from 'vitest';
// @ts-expect-error — dev-only admin script, ships no type declarations
import { toCellsMap, classifyCells, convertCells } from '../../scripts/migrate-cells-map.mjs';

// specs/cells-map.md § Migration — the pure classification/conversion core of
// scripts/migrate-cells-map.mjs. The 4b round-5 P1 contract on #458: only a
// CANONICAL conversion may ever be blessed or written — an array that cannot
// become the 25-key map (empty, short, duplicate/missing index, junk
// elements) must classify as unconvertible, and a partial map (a deploy-gap
// patch landed on a stray doc) must classify as malformed, so the script's
// pre-scan and VERIFY passes fail loudly instead of stranding boards behind
// the deployed canonicalCellsMap rules gate.

function cells25(): Array<Record<string, unknown>> {
  return Array.from({ length: 25 }, (_, index) => ({
    index,
    itemId: index === 12 ? null : `item-${index}`,
    text: index === 12 ? 'FREE' : `prompt ${index}`,
    free: index === 12,
    marked: index === 12,
    markedAt: null,
  }));
}

describe('migrate-cells-map — classifyCells', () => {
  it('classifies the canonical 25-key map as map', () => {
    expect(classifyCells(toCellsMap(cells25()))).toBe('map');
  });

  it('classifies a PARTIAL map as malformed, never safe (deploy-gap patch)', () => {
    expect(classifyCells({ '5': cells25()[5] })).toBe('malformed');
  });

  it('classifies a 25-key map with a mismatched index as malformed', () => {
    const map = toCellsMap(cells25());
    map['3'] = { ...map['3'], index: 4 };
    expect(classifyCells(map)).toBe('malformed');
  });

  it('classifies arrays as array and junk as malformed', () => {
    expect(classifyCells(cells25())).toBe('array');
    expect(classifyCells([])).toBe('array');
    expect(classifyCells(null)).toBe('malformed');
    expect(classifyCells(7)).toBe('malformed');
  });
});

describe('migrate-cells-map — convertCells (canonical or nothing)', () => {
  it('converts a legitimate legacy array to the canonical map', () => {
    const converted = convertCells(cells25());
    expect(classifyCells(converted)).toBe('map');
    expect(converted['12'].free).toBe(true);
  });

  it('refuses arrays that cannot become canonical: empty, short, duplicate index, junk elements', () => {
    expect(convertCells([])).toBeNull();
    expect(convertCells(cells25().slice(0, 24))).toBeNull();
    const dup = cells25();
    dup[3] = { ...dup[3], index: 4 }; // duplicate 4, missing 3
    expect(convertCells(dup)).toBeNull();
    expect(convertCells([...cells25().slice(0, 24), null])).toBeNull();
    expect(convertCells('not an array')).toBeNull();
  });
});
