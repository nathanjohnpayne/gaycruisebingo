// Minimal copy of the pure game logic the client uses, for authoritative
// server-side recomputation. Keep in sync with ../../src/game/logic.ts.

export interface Cell {
  index: number;
  free: boolean;
  marked: boolean;
  status?: 'confirmed' | 'pending';
}

const GRID = 5;

const LINES: number[][] = (() => {
  const L: number[][] = [];
  for (let r = 0; r < GRID; r++) L.push([0, 1, 2, 3, 4].map((k) => r * GRID + k));
  for (let c = 0; c < GRID; c++) L.push([0, 1, 2, 3, 4].map((k) => k * GRID + c));
  L.push([0, 6, 12, 18, 24]);
  L.push([4, 8, 12, 16, 20]);
  return L;
})();

function mask(cells: Cell[]): boolean[] {
  return cells.map((c) => c.free || (c.marked && c.status !== 'pending'));
}

export function completedLines(cells: Cell[]): number[][] {
  const m = mask(cells);
  return LINES.filter((line) => line.every((i) => m[i]));
}

export function countMarked(cells: Cell[]): number {
  return cells.filter((c) => !c.free && c.marked && c.status !== 'pending').length;
}

export function isBlackout(cells: Cell[]): boolean {
  return mask(cells).every(Boolean);
}
