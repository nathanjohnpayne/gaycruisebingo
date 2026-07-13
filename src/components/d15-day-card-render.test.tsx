import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { BoardDoc, Cell, DayDef, EventDoc, PlayerDoc } from '../types';

// Integration cover for #246 — the wiring the launch-blocking bug was missing:
// Board must render the VIEWED Day's OWN day-scoped board (so different Days show
// different squares, not one retinted board), deal a ready-but-undealt Day lazily,
// leave a locked future Day at the preview (dealing nothing), and route every Mark
// to the viewed Day (daily + dayIndex) so the leaderboard never double-counts.

const H = vi.hoisted(() => ({
  user: { uid: 'u1', displayName: 'Deck Daddy', photoURL: null } as {
    uid: string;
    displayName: string | null;
    photoURL: string | null;
  },
  // Per-Day boards, keyed by dayIndex — the fixture that proves each Day has its own.
  dayBoards: new Map<number, BoardDoc | null>(),
  player: null as PlayerDoc | null,
  event: null as EventDoc | null,
  setMark: vi.fn(),
  dealDayCard: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('../hooks/useData', () => ({
  // #264: day-meta honor reads — inert stubs (no pinned honors).
  useDayMeta: () => ({ data: null, loading: false, hasServerData: true }),
  useDayMetas: () => new Map(),
  useDayMetasStatus: () => ({ metas: new Map(), loaded: true }),
  useBoard: () => ({ data: null, loading: false, hasServerData: true }),
  // The heart of the fix: Board reads the VIEWED Day's board here. Returning a
  // different board per dayIndex is exactly what "a different card per Day" means.
  useDayBoard: (_uid: string | undefined, dayIndex: number | undefined) => ({
    data: dayIndex === undefined ? null : (H.dayBoards.get(dayIndex) ?? null),
    loading: false,
    hasServerData: true,
  }),
  useMyPlayer: () => ({ data: H.player, loading: false, hasServerData: true }),
  useEventDoc: () => ({ data: H.event, loading: false }),
  useItems: () => ({ items: [], loading: false, hasServerData: true }),
  useTally: () => ({ markers: [], count: 0, loading: false, hasServerData: true }),
  useLeaderboard: () => ({ players: [], loading: false }),
  useDoubts: () => ({ doubts: [], count: 0, loading: false, hasServerData: true }),
  useMyProofs: () => ({ proofs: [], loading: false, hasServerData: true }),
  useProofsForItemText: () => ({ proofs: [], loading: false, hasServerData: true }),
}));
vi.mock('../data/moments', () => ({
  // #267: the per-card blackout queue reads — inert stubs (empty queue).
  pendingBlackoutDayIndexes: vi.fn(() => []),
  removePendingBlackoutDay: vi.fn(),
  broadcastBingo: vi.fn(),
  broadcastBlackout: vi.fn(),
  broadcastFirstBingo: vi.fn(),
  hasPriorBingoWitness: vi.fn(() => Promise.resolve(false)),
  enqueueWinMoments: vi.fn(),
  enqueueFirstBingoMoment: vi.fn(),
  peekPendingMoments: vi.fn(() => ({ bingo: false, blackout: false, firstBingo: false })),
  clearPendingMoment: vi.fn(),
  dropPendingWins: vi.fn(),
  pendingActionGeneration: vi.fn(() => 0),
  firstBingoCandidateCurrent: vi.fn(() => false),
}));
vi.mock('../data/doubts', () => ({ raiseDoubt: vi.fn(), openDoubts: () => [], doubtStatusFor: () => 'none' }));
vi.mock('../data/api', () => ({
  setMark: H.setMark,
  dealDayCard: H.dealDayCard,
  resolveDisplayName: (p: { displayName?: unknown } | null | undefined, f: string | null | undefined) =>
    typeof p?.displayName === 'string' && p.displayName.trim().length > 0 ? p.displayName : (f ?? 'Anonymous'),
}));
vi.mock('../data/proofs', () => ({ attachProof: vi.fn() }));
vi.mock('../analytics', () => ({ track: vi.fn() }));
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: H.user, loading: false, signIn: vi.fn(), signOutUser: vi.fn() }),
}));
vi.mock('../firebase', () => ({ EVENT_ID: 'test-event' }));

import Board from './Board';

const DAY_MS = 24 * 60 * 60 * 1000;

function day(over: Partial<DayDef> & Pick<DayDef, 'index' | 'unlockAt' | 'theme'>): DayDef {
  return {
    date: `2026-07-${String(15 + over.index).padStart(2, '0')}`,
    port: `Port ${over.index}`,
    portEmoji: '🇭🇷',
    pool: 'main',
    tutorial: false,
    ...over,
  };
}

// A 25-cell board whose non-free squares are labelled with the Day's own tag, so
// "Day 0 vs Day 1 differ" is directly observable in the DOM. `marked` cell 0 lets
// a tap trigger an (unmark) setMark directly, without going through the ProofSheet.
function boardFor(dayIndex: number): BoardDoc {
  const tag = `D${dayIndex}`;
  const cells: Cell[] = Array.from({ length: 25 }, (_, index) => ({
    index,
    itemId: index === 12 ? null : `${tag}-i${index}`,
    text: index === 12 ? 'FREE' : `${tag} Prompt ${index}`,
    free: index === 12,
    marked: index === 12 || index === 0,
    markedAt: index === 0 ? 1 : null,
  }));
  return { uid: 'u1', dayIndex, seed: dayIndex + 1, createdAt: 0, cells };
}

beforeEach(() => {
  vi.clearAllMocks();
  H.user = { uid: 'u1', displayName: 'Deck Daddy', photoURL: null };
  H.dayBoards.clear();
  H.player = null;
  H.event = null;
  H.setMark.mockResolvedValue({ cells: [], bingo: false, blackout: false, bingoTransition: false, blackoutTransition: false });
  H.dealDayCard.mockResolvedValue(true);
});

describe('Board daily-cards wiring (#246)', () => {
  it('renders a DIFFERENT card per Day and routes each Mark to the viewed Day (daily + dayIndex)', () => {
    const now = Date.now();
    H.event = {
      claimMode: 'honor',
      timezone: 'UTC',
      days: [
        day({ index: 0, theme: 'get-sporty', unlockAt: now - 2 * DAY_MS, snapshotItemIds: ['x'] }),
        day({ index: 1, theme: 'glamiators', unlockAt: now - 1 * DAY_MS, snapshotItemIds: ['x'] }), // today (latest unlocked)
      ],
    } as unknown as EventDoc;
    H.dayBoards.set(0, boardFor(0));
    H.dayBoards.set(1, boardFor(1));

    render(<Board />);

    // Default view is today's Day (index 1) → the Day-1 board's squares.
    expect(screen.getByText('D1 Prompt 1')).toBeInTheDocument();
    expect(screen.queryByText('D0 Prompt 1')).not.toBeInTheDocument();

    // Unmark the marked Day-1 square → setMark with the viewed Day's index + daily.
    fireEvent.click(screen.getByText('D1 Prompt 0'));
    expect(H.setMark).toHaveBeenCalledTimes(1);
    expect(H.setMark.mock.calls[0][0]).toMatchObject({ daily: true, dayIndex: 1, nextMarked: false });

    // Switch to Day 0 → the OTHER board's squares, proving it's not one retinted card.
    fireEvent.click(screen.getAllByRole('tab')[0]);
    expect(screen.getByText('D0 Prompt 1')).toBeInTheDocument();
    expect(screen.queryByText('D1 Prompt 1')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('D0 Prompt 0'));
    expect(H.setMark).toHaveBeenCalledTimes(2);
    expect(H.setMark.mock.calls[1][0]).toMatchObject({ daily: true, dayIndex: 0, nextMarked: false });
  });

  it('lazily deals a ready Day with no card yet, and never deals a locked future Day', () => {
    const now = Date.now();
    H.event = {
      claimMode: 'honor',
      timezone: 'UTC',
      days: [
        day({ index: 0, theme: 'get-sporty', unlockAt: now - DAY_MS, snapshotItemIds: ['x'] }), // ready, no board
        day({ index: 1, theme: 'dog-tag', unlockAt: now + DAY_MS, snapshotItemIds: ['x'] }), // locked future
      ],
    } as unknown as EventDoc;
    // No board for Day 0 yet → the deal effect should fire dealDayCard(user, 0).
    H.dayBoards.set(0, null);

    render(<Board />);

    expect(H.dealDayCard).toHaveBeenCalledWith(H.user, 0);

    // The locked future Day shows the preview and deals nothing.
    H.dealDayCard.mockClear();
    fireEvent.click(screen.getAllByRole('tab')[1]);
    expect(screen.getByText(/unlocks/i)).toBeInTheDocument();
    expect(H.dealDayCard).not.toHaveBeenCalled();
    expect(H.setMark).not.toHaveBeenCalled();
  });
});
