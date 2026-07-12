import { describe, it, expect } from 'vitest';
import { DAYS, EMBARK_ITEMS, FAREWELL_ITEMS, SEED_ITEMS } from './seed';
// scripts/seed.mjs is a plain-JS node script with no type declarations
// (tsconfig sets no allowJs); Vitest resolves and executes it natively, and
// importing it is side-effect-free because seeding only runs when the
// script is the entry module.
// @ts-expect-error — no type declarations for this plain-JS script (see above)
import { EVENT_SEED, EMBARK_ITEMS as SCRIPT_EMBARK_ITEMS, FAREWELL_ITEMS as SCRIPT_FAREWELL_ITEMS } from '../../scripts/seed.mjs';

// Covers specs/d15-tutorial-seed.md (#207): the two curated tutorial pools
// (embark/farewell, 28 entries each) and the ten-Day `EventDoc.timezone`/`days[]`
// mapping, per plans/daily-cards-spec.md § "Tutorial item lists", "Itinerary and
// schedule", and "Free space per day".

describe('EMBARK_ITEMS — the curated Welcome Aboard pool (28)', () => {
  it('has exactly 28 entries, all tame, all tagged pool: embark', () => {
    expect(EMBARK_ITEMS).toHaveLength(28);
    expect(EMBARK_ITEMS.every((i) => i.spicy === false)).toBe(true);
    expect(EMBARK_ITEMS.every((i) => i.pool === 'embark')).toBe(true);
  });

  it('has no duplicate text within the pool', () => {
    expect(new Set(EMBARK_ITEMS.map((i) => i.text)).size).toBe(28);
  });
});

describe('FAREWELL_ITEMS — the curated So Long, Farewell pool (28)', () => {
  it('has exactly 28 entries, all tame, all tagged pool: farewell', () => {
    expect(FAREWELL_ITEMS).toHaveLength(28);
    expect(FAREWELL_ITEMS.every((i) => i.spicy === false)).toBe(true);
    expect(FAREWELL_ITEMS.every((i) => i.pool === 'farewell')).toBe(true);
  });

  it('has no duplicate text within the pool', () => {
    expect(new Set(FAREWELL_ITEMS.map((i) => i.text)).size).toBe(28);
  });
});

describe('EMBARK_ITEMS / FAREWELL_ITEMS — no cross-pool or main-pool duplicates', () => {
  it('has no duplicate text across embark and farewell', () => {
    const combined = [...EMBARK_ITEMS.map((i) => i.text), ...FAREWELL_ITEMS.map((i) => i.text)];
    expect(new Set(combined).size).toBe(56);
  });

  it('has no duplicate text against the frozen main pool (SEED_ITEMS)', () => {
    const mainTexts = new Set(SEED_ITEMS.map((i) => i.text));
    for (const item of [...EMBARK_ITEMS, ...FAREWELL_ITEMS]) {
      expect(mainTexts.has(item.text)).toBe(false);
    }
  });
});

describe('scripts/seed.mjs — tutorial pool literals stay in sync with src/data/seed.ts', () => {
  it('exports the same 28-entry EMBARK_ITEMS as src/data/seed.ts', () => {
    expect(SCRIPT_EMBARK_ITEMS.length).toBe(28);
    expect(SCRIPT_EMBARK_ITEMS).toEqual(EMBARK_ITEMS);
  });

  it('exports the same 28-entry FAREWELL_ITEMS as src/data/seed.ts', () => {
    expect(SCRIPT_FAREWELL_ITEMS.length).toBe(28);
    expect(SCRIPT_FAREWELL_ITEMS).toEqual(FAREWELL_ITEMS);
  });
});

describe('DAYS — the ten-Day itinerary mapping', () => {
  it('has exactly 10 entries, indexed 0..9 in order', () => {
    expect(DAYS).toHaveLength(10);
    expect(DAYS.map((d) => d.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('matches the itinerary table field-for-field', () => {
    const expected = [
      ['2026-07-15', 'Trieste', '🇮🇹', 'welcome-aboard', 'embark', true],
      ['2026-07-16', 'Split', '🇭🇷', 'get-sporty', 'main', false],
      ['2026-07-17', 'Valletta', '🇲🇹', 'duty-free', 'main', false],
      ['2026-07-18', 'Palermo', '🇮🇹', 'glamiators', 'main', false],
      ['2026-07-19', 'Sorrento', '🇮🇹', 'neon-playground', 'main', false],
      ['2026-07-20', 'Rome (Civitavecchia)', '🇮🇹', 'summer-white', 'main', false],
      ['2026-07-21', 'Nice', '🇫🇷', 'dog-tag', 'main', false],
      ['2026-07-22', 'Marseille', '🇫🇷', 'revival-disco', 'main', false],
      ['2026-07-23', 'Sea Day', '🌊', 'seriously-pink', 'main', false],
      ['2026-07-24', 'Barcelona', '🇪🇸', 'so-long-farewell', 'farewell', true],
    ] as const;

    expected.forEach(([date, port, portEmoji, theme, pool, tutorial], i) => {
      const day = DAYS[i];
      expect(day.date).toBe(date);
      expect(day.port).toBe(port);
      expect(day.portEmoji).toBe(portEmoji);
      expect(day.theme).toBe(theme);
      expect(day.pool).toBe(pool);
      expect(day.tutorial).toBe(tutorial);
    });
  });

  it('unlocks index 0 (embark) immediately and every other Day at 08:00 Europe/Rome on its date', () => {
    expect(DAYS[0].unlockAt).toBe(0);
    for (let i = 1; i < DAYS.length; i++) {
      const day = DAYS[i];
      expect(day.unlockAt).toBe(Date.parse(`${day.date}T08:00:00+02:00`));
    }
  });

  it('carries the two freeText overrides on exactly Day 0 and Day 9, and none elsewhere', () => {
    expect(DAYS[0].freeText).toBe('You made it aboard');
    expect(DAYS[9].freeText).toBe('We had the best damn time');
    for (let i = 1; i < 9; i++) {
      expect(DAYS[i].freeText).toBeUndefined();
    }
  });
});

describe('scripts/seed.mjs — EVENT_SEED carries the Phase 1.5 timezone + days[]', () => {
  it('seeds timezone: Europe/Rome', () => {
    expect(EVENT_SEED.timezone).toBe('Europe/Rome');
  });

  it('seeds a 10-entry days[] matching src/data/seed.ts DAYS exactly', () => {
    expect(EVENT_SEED.days).toHaveLength(10);
    expect(EVENT_SEED.days).toEqual(DAYS);
  });
});
