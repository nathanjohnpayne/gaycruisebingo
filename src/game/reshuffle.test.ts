import { describe, it, expect } from 'vitest';
import { isPristine, countMarked } from './logic';
import type { Cell } from '../types';

// specs/reshuffle.md — the pristine predicate that decides Reshuffle eligibility,
// and which MUST agree with firestore.rules' boardPristine().
//
// Firestore-free by construction: game/logic.ts imports no firebase surface, so
// this suite needs no mocks. `reshuffleSeed` lives in data/api.ts (which does
// import firebase) and is therefore proven in src/data/reshuffle.test.ts, behind
// that file's module mocks, rather than dragged in here.

function cells(over: Partial<Cell> & { index: number }, ...rest: (Partial<Cell> & { index: number })[]): Cell[] {
  const base: Cell[] = Array.from({ length: 25 }, (_, index) => ({
    index,
    itemId: index === 12 ? null : `i${index}`,
    text: index === 12 ? 'FREE' : `Prompt ${index}`,
    free: index === 12,
    marked: index === 12,
    markedAt: null,
  }));
  for (const patch of [over, ...rest]) base[patch.index] = { ...base[patch.index], ...patch };
  return base;
}

const freshDeal = (): Cell[] => cells({ index: 0 });

describe('isPristine — the Reshuffle eligibility window', () => {
  it('is true for a freshly dealt card (only the free centre is marked)', () => {
    expect(isPristine(freshDeal())).toBe(true);
  });

  it('is false once any player square is marked', () => {
    expect(isPristine(cells({ index: 0, marked: true, markedAt: 1 }))).toBe(false);
  });

  it('is true again after that square is unmarked — the escape hatch is the existing unmark path', () => {
    const marked = cells({ index: 0, marked: true, markedAt: 1 });
    const unmarked = marked.map((c) => (c.index === 0 ? { ...c, marked: false, markedAt: null } : c));
    expect(isPristine(unmarked)).toBe(true);
  });

  it('does NOT count the free centre, which is always marked', () => {
    const deal = freshDeal();
    expect(deal[12].marked).toBe(true);
    expect(deal[12].free).toBe(true);
    expect(isPristine(deal)).toBe(true);
  });

  // The distinction that keeps the client gate honest against the rules: a
  // pending admin_confirmed Mark scores NOTHING (countMarked discounts it) but is
  // still a tap, and firestore.rules — which can only see `marked`/`free` — counts
  // it. If these two disagreed, the chip would render on a card whose reshuffle the
  // server then denies.
  it('counts a PENDING admin_confirmed mark as non-pristine, even though countMarked does not', () => {
    const pending = cells({ index: 0, marked: true, markedAt: 1, status: 'pending' });
    expect(countMarked(pending)).toBe(0);
    expect(isPristine(pending)).toBe(false);
  });

  it('agrees with the rules predicate shape: pristine iff every cell is free-or-unmarked', () => {
    const rulesEquivalent = (cs: Cell[]) => cs.every((c) => c.free === true || c.marked === false);
    for (const board of [
      freshDeal(),
      cells({ index: 0, marked: true }),
      cells({ index: 24, marked: true }),
      cells({ index: 3, marked: true, status: 'pending' }),
    ]) {
      expect(isPristine(board)).toBe(rulesEquivalent(board));
    }
  });
});
