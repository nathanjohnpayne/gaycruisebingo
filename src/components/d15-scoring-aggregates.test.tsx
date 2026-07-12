import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { DayDef, EventDoc, PlayerDoc } from '../types';

// specs/d15-scoring-aggregates.md, RTL/jsdom layer. Leaderboard is presentational
// over useLeaderboard's already-ranked roster; the cruise-wide restriction and
// per-Day honors math are unit-tested directly in
// src/game/d15-scoring-aggregates.test.ts. These two tests pin the SURFACES this
// ticket adds: (1) the per-Day First to BINGO honors strip renders each Day's
// pinned Player, and (2) the cruise-wide "1st BINGO" pin never lands on an
// embark/farewell-only first bingo (it tracks the earliest MAIN-GAME bingo, which
// need not be rank #1). Same single-hook-stub precedent as w2-leaderboard.test.tsx.

const days: DayDef[] = Array.from({ length: 10 }, (_, index) => ({
  index,
  date: '2026-07-16',
  port: index === 0 ? 'Embark' : index === 9 ? 'Farewell' : `Port ${index}`,
  portEmoji: '🇭🇷',
  theme: 'neon-playground',
  pool: index === 0 ? 'embark' : index === 9 ? 'farewell' : 'main',
  tutorial: index === 0 || index === 9,
  unlockAt: 0,
}));

function mkPlayer(over: Partial<PlayerDoc> & Pick<PlayerDoc, 'uid' | 'displayName'>): PlayerDoc {
  return {
    photoURL: null,
    joinedAt: 0,
    bingoCount: 0,
    squaresMarked: 0,
    firstBingoAt: null,
    ...over,
  };
}

// Pre-ranked as sortPlayers would: both hold 1 bingo, so more-squares wins — the
// embark-only Player ranks #1 by squares (12 > 6), yet the cruise pin must land on
// the main-game Player below them. `embarker` bingoed first in wall-clock terms
// (10 < 900) but ONLY on the embark card, so it is excluded from the headline.
const embarker = mkPlayer({
  uid: 'embarker',
  displayName: 'Embarker',
  bingoCount: 1,
  squaresMarked: 12,
  firstBingoAt: null, // root already excludes the embark-only bingo
  dayStats: { 0: { bingoCount: 1, squaresMarked: 12, firstBingoAt: 10 } },
});
const champ = mkPlayer({
  uid: 'champ',
  displayName: 'Champ',
  bingoCount: 1,
  squaresMarked: 6,
  firstBingoAt: 900,
  dayStats: { 2: { bingoCount: 1, squaresMarked: 6, firstBingoAt: 900 } },
});

const event: EventDoc = {
  name: 'Med 2026',
  sailStart: '2026-07-16',
  sailEnd: '2026-07-25',
  status: 'active',
  defaultTheme: 'neon-playground',
  claimMode: 'honor',
  admins: [],
  timezone: 'Europe/Rome',
  days,
  bannedUids: [],
  settings: { reportHideThreshold: 5 },
};

const H = vi.hoisted(() => ({
  players: [] as PlayerDoc[],
  event: null as EventDoc | null,
}));

vi.mock('../analytics', () => ({ track: vi.fn() }));
vi.mock('../hooks/useData', () => ({
  useLeaderboard: () => ({ players: H.players, loading: false }),
  useEventDoc: () => ({ data: H.event, loading: false }),
  // #218: no Proofs fixtured in this scoring-aggregates suite — an empty map
  // keeps every row chip-less, which is exactly what these tests assert on.
  useLatestProofByUid: () => ({ latestByUid: {}, loading: false }),
  isBanned: (uid: string | null | undefined, bannedUids: readonly string[] | undefined) =>
    !!uid && Array.isArray(bannedUids) && bannedUids.includes(uid),
}));

import Leaderboard from './Leaderboard';

describe('Leaderboard cruise-wide honors (#212)', () => {
  it("renders a per-Day honors strip pinning each Day's first-bingo Player", () => {
    H.players = [embarker, champ];
    H.event = event;
    render(
      <MemoryRouter>
        <Leaderboard />
      </MemoryRouter>,
    );

    const strip = screen.getByLabelText('Daily First to BINGO');
    // Each Day's own honoree — tutorial Day 0 included (its exclusion is only from
    // the cruise-wide pin), plus main-game Day 2.
    expect(strip).toHaveTextContent('Embarker');
    expect(strip).toHaveTextContent('Champ');
    expect(strip).toHaveTextContent('Day 1'); // dayIndex 0 → "Day 1 · Embark"
    expect(strip).toHaveTextContent('Day 3'); // dayIndex 2 → "Day 3 · Port 2"
  });

  it('never lands the cruise "1st BINGO" pin on an embark/farewell-only first bingo', () => {
    H.players = [embarker, champ];
    H.event = event;
    const { container } = render(
      <MemoryRouter>
        <Leaderboard />
      </MemoryRouter>,
    );
    const list = container.querySelector('.list') as HTMLElement;

    // The pin is on the main-game Player (Champ), NOT the embark-only Player who
    // bingoed earlier in wall-clock terms and ranks above them.
    const champRow = within(list).getByText('Champ').closest('.row');
    const embarkerRow = within(list).getByText('Embarker').closest('.row');
    expect(champRow?.querySelector('.badge')).toHaveTextContent('1st BINGO');
    expect(embarkerRow?.querySelector('.badge')).toBeNull();
  });
});
