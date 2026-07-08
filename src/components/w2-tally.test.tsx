import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import type { User } from 'firebase/auth';
import type { BoardDoc, Cell, PlayerDoc } from '../types';

// specs/w2-tally.md, Board wiring layer (RTL-jsdom). Pins the loading-window
// attribution rule for the per-Prompt Tally marker (Codex P2, PR #87): Board
// passes a displayName to setMark ONLY when the saved player-row identity is
// KNOWN — the same tri-state knownFirstBingoAt uses (unknown while the
// subscription is loading, or while a cache-only "absent" row lacks server
// confirmation). While UNKNOWN it passes `undefined`, so setMark's
// markerDisplayName falls back to the CACHED player row (the saved name), then
// 'Anonymous' — never stamping the possibly-stale auth name over a returning
// Player's customized identity. A loaded row (or a server-confirmed none, or a
// cached row) is KNOWN, and the resolved name flows through. setMark itself is
// stubbed: the write-side resolution is src/data/w2-tally.test.ts.

const H = vi.hoisted(() => ({
  user: null as User | null,
  board: null as BoardDoc | null,
  player: null as PlayerDoc | null,
  playerLoading: false,
  playerConfirmed: true,
  setMark: vi.fn(),
}));

vi.mock('../firebase', () => ({ db: {}, EVENT_ID: 'test-event' }));
vi.mock('../analytics', () => ({ track: vi.fn() }));
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: H.user, loading: false }),
}));
vi.mock('../hooks/useData', () => ({
  useBoard: () => ({ data: H.board, loading: false, hasServerData: true }),
  useMyPlayer: () => ({ data: H.player, loading: H.playerLoading, hasServerData: H.playerConfirmed }),
  // honor mode so a tap marks directly through setMark (no ProofSheet detour).
  useEventDoc: () => ({ data: { claimMode: 'honor' }, loading: false }),
  useItems: () => ({ items: [], loading: false, hasServerData: true }),
  useTally: () => ({ markers: [], count: 0, loading: false, hasServerData: true }),
  // Board reads the roster to derive the First-to-BINGO Moment (#34); this suite's
  // single non-winning tap never crosses a bingo edge, so an empty roster suffices.
  useLeaderboard: () => ({ players: [], loading: false }),
}));
// Keep the REAL resolveDisplayName (the validated resolver under test feeds the
// prop) and stub only the write.
vi.mock('../data/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data/api')>();
  return { ...actual, setMark: H.setMark };
});
vi.mock('./ProofSheet', () => ({ default: () => null }));

import Board from './Board';

// A dealt board: cell 0 is the non-free Square the tests tap.
function dealt(): Cell[] {
  return Array.from({ length: 25 }, (_, index) => ({
    index,
    itemId: index === 12 ? null : `i${index}`,
    text: index === 12 ? 'FREE' : `p${index}`,
    free: index === 12,
    marked: index === 12,
    markedAt: null,
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  H.user = { uid: 'u1', displayName: 'Sailor', photoURL: null } as unknown as User;
  H.board = { uid: 'u1', seed: 1, createdAt: 0, cells: dealt() };
  H.player = null;
  H.playerLoading = false;
  H.playerConfirmed = true;
  H.setMark.mockResolvedValue({ cells: [], bingo: false, blackout: false });
});

async function tapFirstSquare() {
  const { container } = render(<Board />);
  fireEvent.click(container.querySelectorAll('.grid .cell')[0]);
  await waitFor(() => expect(H.setMark).toHaveBeenCalledTimes(1));
  return H.setMark.mock.calls[0][0] as { displayName?: string };
}

describe('Board → setMark marker attribution across the player-row loading window (specs/w2-tally.md)', () => {
  it('passes undefined while the player row is still LOADING — never the possibly-stale auth name', async () => {
    H.player = null;
    H.playerLoading = true;
    H.playerConfirmed = false;

    const args = await tapFirstSquare();

    // markerDisplayName then resolves from the cached player row (the saved
    // name), then 'Anonymous' — see src/data/w2-tally.test.ts.
    expect(args.displayName).toBeUndefined();
  });

  it('passes undefined for a cache-only ABSENT row without server confirmation (still unknown)', async () => {
    H.player = null;
    H.playerLoading = false;
    H.playerConfirmed = false; // settled from cache as "absent" — not real knowledge

    const args = await tapFirstSquare();

    expect(args.displayName).toBeUndefined();
  });

  it('passes the saved player-row name once the row has loaded', async () => {
    H.player = { displayName: 'Deck Daddy', photoURL: null } as unknown as PlayerDoc;

    const args = await tapFirstSquare();

    expect(args.displayName).toBe('Deck Daddy');
  });

  it('a CACHED row is real knowledge even without server confirmation', async () => {
    H.player = { displayName: 'Deck Daddy', photoURL: null } as unknown as PlayerDoc;
    H.playerConfirmed = false; // cache-only, but the row itself is the saved identity

    const args = await tapFirstSquare();

    expect(args.displayName).toBe('Deck Daddy');
  });

  it('a loaded-NULL row is a KNOWN "no saved row": the auth name is then the legitimate attribution', async () => {
    H.player = null;
    H.playerLoading = false;
    H.playerConfirmed = true; // the server really says there is no row

    const args = await tapFirstSquare();

    expect(args.displayName).toBe('Sailor');
  });
});
