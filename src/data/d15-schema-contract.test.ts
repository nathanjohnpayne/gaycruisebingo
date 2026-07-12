import { describe, it, expect } from 'vitest';
import type { QueryDocumentSnapshot } from 'firebase/firestore';
import { eventConverter, itemConverter } from './converters';
import type { EventDoc, ItemDoc } from '../types';
import { THEMES } from '../theme/themes';

// Covers specs/d15-schema-contract.md: the Phase 1.5 domain type contract's
// read-side converter defaults (daily-cards-spec § "Data model" / "Migration")
// and the ThemeMeta.description presence guarantee (§ "Theme reference"). The
// passthrough/read converters only ever call snap.data()/snap.id, so a
// two-method stand-in exercises the read path without a live Firestore
// snapshot — the same seam w0-type-contract.test.ts uses.
const snapshotOf = (data: unknown, id = 'doc-id') =>
  ({ id, data: () => data }) as unknown as QueryDocumentSnapshot;

// A current-contract Item minus its `pool` — the legacy shape a Prompt seeded
// before Phase 1.5 persists (no pool key at all).
const legacyItem: Omit<ItemDoc, 'id' | 'pool'> = {
  text: 'Lost passport',
  createdBy: 'seed',
  createdAt: 0,
  isFreeSpace: false,
  status: 'active',
  reportCount: 0,
  spicy: false,
};

// A current-contract Event minus the two Phase 1.5 additions — the legacy shape
// an Event seeded before this ticket persists (no days/timezone keys).
const legacyEvent: Omit<EventDoc, 'days' | 'timezone'> = {
  name: 'Test Sailing',
  sailStart: '2026-07-15',
  sailEnd: '2026-07-25',
  status: 'active',
  defaultTheme: 'neon-playground',
  claimMode: 'honor',
  admins: [],
  bannedUids: [],
  settings: { reportHideThreshold: 4 },
};

describe('itemConverter (Phase 1.5 pool default)', () => {
  it('defaults a missing pool (legacy Item doc, pre-Phase-1.5) to main', () => {
    const item = itemConverter.fromFirestore(snapshotOf(legacyItem, 'p1'));
    expect(item.pool).toBe('main');
    expect(item.id).toBe('p1'); // still pins the doc id like the pre-1.5 converter
  });

  it('preserves a present pool rather than overriding it', () => {
    for (const pool of ['main', 'embark', 'farewell'] as const) {
      const item = itemConverter.fromFirestore(snapshotOf({ ...legacyItem, pool }));
      expect(item.pool).toBe(pool);
    }
  });
});

describe('eventConverter (Phase 1.5 days/timezone defaults)', () => {
  it('defaults a missing days/timezone (legacy Event doc) rather than throwing', () => {
    const event = eventConverter.fromFirestore(snapshotOf(legacyEvent));
    expect(event.days).toEqual([]);
    expect(event.timezone).toBe('Europe/Rome');
  });

  it('coerces a malformed days to [] and preserves a present schedule/zone', () => {
    const malformed = eventConverter.fromFirestore(
      snapshotOf({ ...legacyEvent, days: 'nope', timezone: 42 }),
    );
    expect(malformed.days).toEqual([]);
    expect(malformed.timezone).toBe('Europe/Rome');

    const day = {
      index: 0,
      date: '2026-07-16',
      port: 'Split',
      portEmoji: '🇭🇷',
      theme: 'get-sporty' as const,
      pool: 'main' as const,
      tutorial: false,
      unlockAt: 0,
    };
    const present = eventConverter.fromFirestore(
      snapshotOf({ ...legacyEvent, days: [day], timezone: 'America/Los_Angeles' }),
    );
    expect(present.days).toEqual([day]);
    expect(present.timezone).toBe('America/Los_Angeles');
  });
});

describe('ThemeMeta.description (Phase 1.5 dress-code blurb)', () => {
  it('every THEMES entry carries a non-empty description', () => {
    expect(THEMES.length).toBeGreaterThan(0);
    for (const theme of THEMES) {
      expect(typeof theme.description).toBe('string');
      expect(theme.description.trim().length).toBeGreaterThan(0);
    }
  });
});
