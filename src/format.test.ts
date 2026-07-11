import { describe, it, expect } from 'vitest';
import { formatSailRange, eventTitle } from './format';

describe('formatSailRange', () => {
  it('collapses a shared month and year to a day range with an en dash', () => {
    // The med-2026 event window.
    expect(formatSailRange('2026-07-15', '2026-07-24')).toBe('July 15–24, 2026');
  });

  it('handles a single-day window', () => {
    expect(formatSailRange('2026-07-15', '2026-07-15')).toBe('July 15–15, 2026');
  });

  it('spans two months in the same year', () => {
    expect(formatSailRange('2026-07-28', '2026-08-03')).toBe('July 28 – August 3, 2026');
  });

  it('spans a year boundary', () => {
    expect(formatSailRange('2026-12-30', '2027-01-02')).toBe(
      'December 30, 2026 – January 2, 2027',
    );
  });

  it('does not shift the day across timezones (parses ISO parts directly)', () => {
    // new Date('2026-07-15') is UTC-midnight and would render as the 14th in
    // negative-offset zones; the direct parse keeps the 15th.
    expect(formatSailRange('2026-07-15', '2026-07-15')).toContain('15');
  });

  it('degrades to an empty range for missing or malformed dates (never throws)', () => {
    expect(formatSailRange('', '')).toBe('');
    expect(formatSailRange('', '2026-07-24')).toBe('');
    expect(formatSailRange(undefined as unknown as string, undefined as unknown as string)).toBe('');
    expect(formatSailRange('not-a-date', '2026-07-24')).toBe('');
  });
});

describe('eventTitle', () => {
  it('joins the event name to its sail range with an em dash (no spaces)', () => {
    expect(eventTitle('Atlantis Med—Trieste to Barcelona', '2026-07-15', '2026-07-24')).toBe(
      'Atlantis Med—Trieste to Barcelona—July 15–24, 2026',
    );
  });

  it('falls back to just the name when the sail range is unavailable', () => {
    expect(eventTitle('Atlantis Med—Trieste to Barcelona', '', '')).toBe(
      'Atlantis Med—Trieste to Barcelona',
    );
  });
});
