import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DayIdentityLines, headerDayIdentity, isoDateInTz } from './dayIdentity';
import { DAYS } from '../data/seed';

// Covers #259 (daily-cards-spec § "Header"): the two stacked header lines
// always show TODAY's port and theme, with the spec's pre-cruise and
// post-cruise copy. Pinned against the real seeded 2026 schedule so a seed
// edit that breaks the header states fails here.

const EVENT = { days: DAYS, timezone: 'Europe/Rome' };

// The sailing is entirely CEST (UTC+2): local wall-clock = UTC + 2h.
const cest = (y: number, m: number, d: number, h = 12, min = 0) => Date.UTC(y, m - 1, d, h - 2, min);

describe('headerDayIdentity — the header is a "where are we" instrument', () => {
  it('pre-cruise reads "Sails Jul 15" / the embark theme line', () => {
    expect(headerDayIdentity(EVENT, cest(2026, 7, 10))).toEqual({
      port: 'Sails Jul 15',
      theme: '🛳️ Welcome Aboard',
    });
  });

  it('embark day names the port', () => {
    expect(headerDayIdentity(EVENT, cest(2026, 7, 15))).toEqual({
      port: '🇮🇹 Trieste',
      theme: '🛳️ Welcome Aboard',
    });
  });

  it('mid-cruise shows that calendar day, from midnight — not gated on the 8:00 unlock', () => {
    expect(headerDayIdentity(EVENT, cest(2026, 7, 16))).toEqual({
      port: '🇭🇷 Split',
      theme: '🏋️ Get Sporty',
    });
    // 06:00 on Day 3: the Day Card is still locked (unlocks 8:00) but the ship
    // is in Valletta — the header already says so.
    expect(headerDayIdentity(EVENT, cest(2026, 7, 17, 6))).toEqual({
      port: '🇲🇹 Valletta',
      theme: '✈️ Duty Free',
    });
  });

  it('sea day and farewell day render their own identities', () => {
    expect(headerDayIdentity(EVENT, cest(2026, 7, 23))).toEqual({
      port: '🌊 Sea Day',
      theme: '💖 Seriously Pink T-Dance',
    });
    expect(headerDayIdentity(EVENT, cest(2026, 7, 24))).toEqual({
      port: '🇪🇸 Barcelona',
      theme: '👋 So Long, Farewell',
    });
  });

  it('post-cruise reads "Barcelona" / "👋 Until next year"', () => {
    expect(headerDayIdentity(EVENT, cest(2026, 7, 25))).toEqual({
      port: 'Barcelona',
      theme: '👋 Until next year',
    });
    expect(headerDayIdentity(EVENT, cest(2026, 12, 1))).toEqual({
      port: 'Barcelona',
      theme: '👋 Until next year',
    });
  });

  it('resolves the date in the EVENT timezone, not UTC', () => {
    // 2026-07-15T22:30Z is already 00:30 on Jul 16 in Europe/Rome — Split, not
    // Trieste. A UTC-based resolver would still say Trieste.
    expect(headerDayIdentity(EVENT, Date.UTC(2026, 6, 15, 22, 30))).toEqual({
      port: '🇭🇷 Split',
      theme: '🏋️ Get Sporty',
    });
  });

  it('degrades to null with no event or no days (the placeholder state)', () => {
    expect(headerDayIdentity(null, cest(2026, 7, 16))).toBeNull();
    expect(headerDayIdentity({ days: [], timezone: 'Europe/Rome' }, cest(2026, 7, 16))).toBeNull();
  });

  it('an invalid timezone degrades to the host zone rather than throwing', () => {
    expect(() => isoDateInTz(cest(2026, 7, 16), 'Not/AZone')).not.toThrow();
    expect(headerDayIdentity({ days: DAYS, timezone: 'Not/AZone' }, cest(2026, 7, 20))).not.toBeNull();
  });
});

describe('DayIdentityLines — presentational states', () => {
  it('renders aria-hidden placeholder dashes with no identity', () => {
    const html = renderToStaticMarkup(<DayIdentityLines identity={null} />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('—');
  });

  it('renders the two live lines, port bold-line first', () => {
    const html = renderToStaticMarkup(<DayIdentityLines identity={{ port: '🇭🇷 Split', theme: '🏋️ Get Sporty' }} />);
    expect(html).not.toContain('aria-hidden');
    expect(html).toContain('🇭🇷 Split');
    expect(html).toContain('🏋️ Get Sporty');
    expect(html.indexOf('Split')).toBeLessThan(html.indexOf('Get Sporty'));
  });
});
