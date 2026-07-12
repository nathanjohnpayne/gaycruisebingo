import { describe, it, expect } from 'vitest';
import { todaysDayTheme } from './autoTheme';
import type { DayDef, EventDoc } from '../types';

// Covers specs/d15-more-menu.md (#208) — the Theme row's "Auto: match the
// day" resolution. Pure and Firestore-free, like the module under test: no
// component render, no ThemeContext, just the Day → ThemeId derivation.

function day(partial: Partial<DayDef> & Pick<DayDef, 'index' | 'unlockAt' | 'theme'>): DayDef {
  return {
    date: '2027-01-01',
    port: 'Test Port',
    portEmoji: '🚢',
    pool: 'main',
    tutorial: false,
    ...partial,
  };
}

describe('todaysDayTheme (specs/d15-more-menu.md § Theme — Auto)', () => {
  it('returns null with no days configured', () => {
    expect(todaysDayTheme({ days: [] }, 1000)).toBeNull();
    expect(todaysDayTheme(undefined, 1000)).toBeNull();
    expect(todaysDayTheme(null, 1000)).toBeNull();
  });

  it('returns null before the first Day unlocks (pre-cruise)', () => {
    const event: Pick<EventDoc, 'days'> = {
      days: [day({ index: 0, unlockAt: 1000, theme: 'neon-playground' })],
    };
    expect(todaysDayTheme(event, 500)).toBeNull();
  });

  it('is a Day\'s theme from its own unlockAt through the next Day\'s unlockAt', () => {
    const event: Pick<EventDoc, 'days'> = {
      days: [
        day({ index: 0, unlockAt: 1000, theme: 'neon-playground' }),
        day({ index: 1, unlockAt: 2000, theme: 'get-sporty' }),
      ],
    };
    expect(todaysDayTheme(event, 1000)).toBe('neon-playground'); // exactly at unlock
    expect(todaysDayTheme(event, 1999)).toBe('neon-playground'); // right up to the next unlock
    expect(todaysDayTheme(event, 2000)).toBe('get-sporty'); // flips exactly at the next unlock
  });

  it('resolves the LAST unlocked Day, not the first, when several have unlocked', () => {
    const event: Pick<EventDoc, 'days'> = {
      days: [
        day({ index: 0, unlockAt: 1000, theme: 'neon-playground' }),
        day({ index: 1, unlockAt: 2000, theme: 'get-sporty' }),
        day({ index: 2, unlockAt: 3000, theme: 'seriously-pink' }),
      ],
    };
    expect(todaysDayTheme(event, 5000)).toBe('seriously-pink');
  });

  it('does not depend on days[] being sorted', () => {
    const event: Pick<EventDoc, 'days'> = {
      days: [
        day({ index: 2, unlockAt: 3000, theme: 'seriously-pink' }),
        day({ index: 0, unlockAt: 1000, theme: 'neon-playground' }),
        day({ index: 1, unlockAt: 2000, theme: 'get-sporty' }),
      ],
    };
    expect(todaysDayTheme(event, 3500)).toBe('seriously-pink');
    expect(todaysDayTheme(event, 1500)).toBe('neon-playground');
  });

  it('defaults `now` to Date.now() when omitted', () => {
    const event: Pick<EventDoc, 'days'> = {
      days: [day({ index: 0, unlockAt: Date.now() - 1000, theme: 'get-sporty' })],
    };
    expect(todaysDayTheme(event)).toBe('get-sporty');
  });
});
