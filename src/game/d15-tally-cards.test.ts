import { describe, it, expect } from 'vitest';
import { nextDisplayBumpTime, BUMP_DEBOUNCE_MS } from './logic';

// specs/d15-tally-cards.md — the Tally Card bump-debounce (#216,
// daily-cards-spec § "Tally Cards"). `nextDisplayBumpTime` is the pure,
// clock-free sort-key function: a Tally Card's Feed POSITION moves to the top at
// most once per ~10 minutes, even as its COUNT keeps updating live. These pin the
// three behaviors the acceptance criteria call out.
describe('nextDisplayBumpTime — Tally Card bump debounce (specs/d15-tally-cards.md)', () => {
  const T0 = 1_000_000_000_000; // arbitrary base ms epoch

  it('a first appearance adopts its Mark time (no prior displayed bump)', () => {
    expect(nextDisplayBumpTime(undefined, T0)).toBe(T0);
  });

  it('a second Mark WITHIN the window does NOT move the card (debounce)', () => {
    const within = T0 + BUMP_DEBOUNCE_MS - 1;
    // The card is already displayed at T0; a fresh Mark 9m59s later holds T0 —
    // the count updates live elsewhere, but the Feed position does not jump.
    expect(nextDisplayBumpTime(T0, within)).toBe(T0);
  });

  it('a Mark at/after the window DOES bump the card toward the top', () => {
    const atEdge = T0 + BUMP_DEBOUNCE_MS; // exactly 10m later — bumps
    const beyond = T0 + BUMP_DEBOUNCE_MS * 3;
    expect(nextDisplayBumpTime(T0, atEdge)).toBe(atEdge);
    expect(nextDisplayBumpTime(T0, beyond)).toBe(beyond);
  });

  it('is monotonic — a Mark not newer than the displayed bump never slides down', () => {
    expect(nextDisplayBumpTime(T0, T0)).toBe(T0); // same time
    expect(nextDisplayBumpTime(T0, T0 - 5000)).toBe(T0); // an earlier/again Mark holds position
  });

  it('respects a custom window (the debounce is a parameter, not a constant)', () => {
    expect(nextDisplayBumpTime(T0, T0 + 100, 1000)).toBe(T0); // within a 1s window: hold
    expect(nextDisplayBumpTime(T0, T0 + 1000, 1000)).toBe(T0 + 1000); // at the 1s edge: bump
  });
});
