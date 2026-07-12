import { describe, it, expect } from 'vitest';
import {
  lastCallStandingsCopy,
  buildPodiumPayload,
  DEFAULT_FREEZE_PHRASE,
  type FinaleDay,
  type FinaleDayHonorDoc,
  type FinalePlayer,
} from '../../functions/src/finaleContent';

// Covers specs/d15-finale.md, functions layer: the pure content the scheduler's
// 20:00-D9 / 08:00-D10 triggers call into. No firebase-admin, no live backend.

const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;

// A 3-Day cruise: embark (Day 0, tutorial), one main Day (Day 1), farewell
// (Day 2, tutorial). Mirrors the client fixture in src/data/d15-finale.test.ts.
const DAYS: FinaleDay[] = [
  { index: 0, pool: 'embark', tutorial: true },
  { index: 1, pool: 'main' },
  { index: 2, pool: 'farewell', tutorial: true },
];

function player(p: Partial<FinalePlayer> & Pick<FinalePlayer, 'uid'>): FinalePlayer {
  return {
    displayName: p.uid,
    bingoCount: 0,
    squaresMarked: 0,
    firstBingoAt: null,
    ...p,
  };
}

describe('lastCallStandingsCopy', () => {
  it('names the leader and their bingo margin (spec example shape)', () => {
    const players = [
      player({ uid: 'Jess', bingoCount: 4, squaresMarked: 30, firstBingoAt: NOW }),
      player({ uid: 'Rex', bingoCount: 2, squaresMarked: 28, firstBingoAt: NOW + HOUR }),
    ];
    expect(lastCallStandingsCopy(players)).toBe(
      `Jess leads by 2 bingos—${DEFAULT_FREEZE_PHRASE}.`,
    );
  });

  it('singularizes a one-bingo margin', () => {
    const players = [
      player({ uid: 'Jess', bingoCount: 2, squaresMarked: 30 }),
      player({ uid: 'Rex', bingoCount: 1, squaresMarked: 28 }),
    ];
    expect(lastCallStandingsCopy(players)).toContain('leads by 1 bingo—');
  });

  it('falls back to a square margin when bingos tie', () => {
    const players = [
      player({ uid: 'Jess', bingoCount: 1, squaresMarked: 22 }),
      player({ uid: 'Rex', bingoCount: 1, squaresMarked: 15 }),
    ];
    expect(lastCallStandingsCopy(players)).toContain('Jess leads by 7 squares—');
  });

  it('degrades to a generic line on a dead heat at the top', () => {
    const players = [
      player({ uid: 'Jess', bingoCount: 2, squaresMarked: 20 }),
      player({ uid: 'Rex', bingoCount: 2, squaresMarked: 20 }),
    ];
    expect(lastCallStandingsCopy(players)).toBe(
      `It's neck and neck at the top going into the final night—${DEFAULT_FREEZE_PHRASE}.`,
    );
  });

  it('degrades to a generic line on an empty board', () => {
    expect(lastCallStandingsCopy([])).toContain('wide open going into the final night');
    expect(lastCallStandingsCopy([player({ uid: 'Ghost' })])).toContain('wide open');
  });

  it('honors an injected freeze phrase', () => {
    const players = [player({ uid: 'Jess', bingoCount: 2 }), player({ uid: 'Rex', bingoCount: 1 })];
    expect(lastCallStandingsCopy(players, { freezePhrase: 'standings freeze at noon' })).toBe(
      'Jess leads by 1 bingo—standings freeze at noon.',
    );
  });
});

describe('buildPodiumPayload', () => {
  const HONORS: FinaleDayHonorDoc[] = Array.from({ length: 10 }, (_, i) => ({
    dayIndex: i,
    firstBingo: { uid: `w${i}`, displayName: `Winner ${i}`, at: NOW + i },
  }));

  it('crowns the top of the standings as champion', () => {
    const players = [
      player({ uid: 'alice', bingoCount: 3, squaresMarked: 20, firstBingoAt: NOW }),
      player({ uid: 'bob', bingoCount: 1, squaresMarked: 30, firstBingoAt: NOW }),
    ];
    expect(buildPodiumPayload(players, DAYS, HONORS).champion?.uid).toBe('alice');
  });

  it('excludes an embark/farewell-only first-bingo from the cruise-wide honor', () => {
    const players = [
      player({
        uid: 'tammy',
        bingoCount: 1,
        squaresMarked: 24,
        firstBingoAt: NOW,
        dayStats: { 0: { bingoCount: 1, squaresMarked: 24, firstBingoAt: NOW } },
      }),
      player({
        uid: 'gary',
        bingoCount: 1,
        squaresMarked: 10,
        firstBingoAt: NOW + HOUR,
        dayStats: { 1: { bingoCount: 1, squaresMarked: 10, firstBingoAt: NOW + HOUR } },
      }),
    ];
    const payload = buildPodiumPayload(players, DAYS, HONORS);
    expect(payload.firstBingo?.uid).toBe('gary');
  });

  it('freezes out the farewell Day from the champion totals', () => {
    const players = [
      player({
        uid: 'fran',
        bingoCount: 5,
        squaresMarked: 40,
        firstBingoAt: NOW,
        dayStats: {
          1: { bingoCount: 1, squaresMarked: 8, firstBingoAt: NOW },
          2: { bingoCount: 4, squaresMarked: 32, firstBingoAt: NOW + HOUR },
        },
      }),
      player({
        uid: 'ed',
        bingoCount: 2,
        squaresMarked: 20,
        firstBingoAt: NOW + HOUR,
        dayStats: { 1: { bingoCount: 2, squaresMarked: 20, firstBingoAt: NOW + HOUR } },
      }),
    ];
    const payload = buildPodiumPayload(players, DAYS, HONORS);
    expect(payload.champion?.uid).toBe('ed');
    expect(payload.champion?.bingoCount).toBe(2);
  });

  it('includes all ten daily honors when present, sorted by Day index', () => {
    const shuffled = [...HONORS].reverse();
    const payload = buildPodiumPayload([player({ uid: 'a', bingoCount: 1 })], DAYS, shuffled);
    expect(payload.dailyHonors).toHaveLength(10);
    expect(payload.dailyHonors.map((h) => h.dayIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('omits Days with no pinned honor', () => {
    const sparse: FinaleDayHonorDoc[] = [
      { dayIndex: 1, firstBingo: { uid: 'w1', displayName: 'W1', at: NOW } },
      { dayIndex: 2, firstBingo: null },
      { dayIndex: 3 },
    ];
    const payload = buildPodiumPayload([player({ uid: 'a', bingoCount: 1 })], DAYS, sparse);
    expect(payload.dailyHonors.map((h) => h.dayIndex)).toEqual([1]);
  });

  it('returns a null champion for an empty board', () => {
    expect(buildPodiumPayload([player({ uid: 'ghost' })], DAYS, []).champion).toBeNull();
  });
});
