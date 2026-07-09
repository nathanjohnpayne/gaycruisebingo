import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import type { User } from 'firebase/auth';
import type { BoardDoc, Cell, DoubtDoc, PlayerDoc, ProofDoc, TallyEntry } from '../types';

// specs/w2-doubts.md, Board wiring layer (RTL-jsdom). Drives the REAL Board with
// the REAL Doubt derivation (isDoubtSatisfied/openDoubts/doubtStatusFor); only the
// SDK/data boundaries are mocked (useData subscriptions, the raiseDoubt write, and
// setMark). Pins the three surfaces #33 adds (ADR 0001 — a Doubt is social pressure,
// never a gate, so none of this blocks/unmarks the Square):
//   1. the open-Doubt COUNT renders on a marked, non-free Square (the DoubtBadge);
//   2. a Doubt is RAISED from another Player's Tally-sheet entry (never one's own);
//   3. an answered Doubt renders a DISTINCT satisfied state vs an open one.

const H = vi.hoisted(() => ({
  user: null as User | null,
  board: null as BoardDoc | null,
  player: null as PlayerDoc | null,
  markers: [] as TallyEntry[],
  doubts: [] as DoubtDoc[],
  proofs: [] as Array<Pick<ProofDoc, 'uid' | 'itemText' | 'createdAt'>>,
  raiseDoubt: vi.fn(),
  setMark: vi.fn(),
}));

vi.mock('../firebase', () => ({ db: {}, EVENT_ID: 'test-event' }));
vi.mock('../analytics', () => ({ track: vi.fn() }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user: H.user, loading: false }) }));
vi.mock('../hooks/useData', () => ({
  useBoard: () => ({ data: H.board, loading: false, hasServerData: true }),
  useMyPlayer: () => ({ data: H.player, loading: false, hasServerData: true }),
  // honor mode so a tap marks straight through (no ProofSheet detour).
  useEventDoc: () => ({ data: { claimMode: 'honor' }, loading: false }),
  useItems: () => ({ items: [], loading: false, hasServerData: true }),
  useTally: () => ({ markers: H.markers, count: H.markers.length, loading: false, hasServerData: true }),
  useLeaderboard: () => ({ players: [], loading: false }),
  useDoubts: () => ({ doubts: H.doubts, count: H.doubts.length, loading: false, hasServerData: true }),
  useProofFeed: () => ({ proofs: H.proofs, loading: false }),
}));
// Keep the REAL resolveDisplayName (Board feeds its output as the doubter's name);
// stub only the write.
vi.mock('../data/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data/api')>();
  return { ...actual, setMark: H.setMark };
});
// Keep the REAL Doubt derivation (the component renders open vs satisfied from it);
// stub only the raise write so the click is observable without Firestore.
vi.mock('../data/doubts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data/doubts')>();
  return { ...actual, raiseDoubt: H.raiseDoubt };
});
vi.mock('./ProofSheet', () => ({ default: () => null }));

import Board from './Board';

// A dealt board with cell 0 marked and non-free (itemId 'i0', text 'p0') plus the
// free centre — one line short of a bingo, so no Moment edge fires.
function dealt(): Cell[] {
  return Array.from({ length: 25 }, (_, index) => ({
    index,
    itemId: index === 12 ? null : `i${index}`,
    text: index === 12 ? 'FREE' : `p${index}`,
    free: index === 12,
    marked: index === 12 || index === 0,
    markedAt: index === 0 ? 1 : null,
  }));
}

const mkDoubt = (over: Partial<DoubtDoc>): DoubtDoc => ({
  id: 'd',
  itemId: 'i0',
  cellIndex: 0,
  fromUid: 'u1',
  fromDisplayName: 'Me',
  targetUid: 'bob',
  targetDisplayName: 'Bob',
  createdAt: 100,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  H.user = { uid: 'u1', displayName: 'Me', photoURL: null } as unknown as User;
  H.board = { uid: 'u1', seed: 1, createdAt: 0, cells: dealt() };
  H.player = { uid: 'u1', displayName: 'Me', photoURL: null } as unknown as PlayerDoc;
  H.markers = [];
  H.doubts = [];
  H.proofs = [];
});

describe('Board Doubts wiring (specs/w2-doubts.md)', () => {
  it('renders the open-Doubt count on a marked, non-free Square', () => {
    // Two Doubts for the Prompt, no answering Proof → both open → the badge shows 2.
    H.doubts = [
      mkDoubt({ id: 'd1', targetUid: 'bob', createdAt: 100 }),
      mkDoubt({ id: 'd2', targetUid: 'carol', createdAt: 100 }),
    ];
    H.proofs = [];

    const { container } = render(<Board />);
    const badge = container.querySelector('.doubt-badge');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toBe('2');
  });

  it('does not render a Doubt count when every Doubt is answered by a Proof', () => {
    // The one Doubt is answered (bob proofed the Prompt after it) → 0 open → no badge.
    H.doubts = [mkDoubt({ id: 'd1', targetUid: 'bob', createdAt: 100 })];
    H.proofs = [{ uid: 'bob', itemText: 'p0', createdAt: 150 }];

    const { container } = render(<Board />);
    expect(container.querySelector('.doubt-badge')).toBeNull();
  });

  it('raises a Doubt from ANOTHER Player’s Tally-sheet entry — never one’s own', () => {
    // The Prompt's markers: me + Bob. No Doubts yet, so the button is enabled.
    H.markers = [
      { uid: 'u1', displayName: 'Me', markedAt: 1 },
      { uid: 'bob', displayName: 'Bob', markedAt: 2 },
    ];
    H.doubts = [];
    H.proofs = [];

    const { container } = render(<Board />);
    // Open the who-list sheet via the Tally count badge (no open Doubts yet, so no
    // DoubtBadge is shown to open it).
    fireEvent.click(container.querySelector('.tally-badge')!);

    // Exactly one raise affordance — Bob's; my own row offers none (no self-doubt).
    const doubtButtons = container.querySelectorAll('.doubt-btn');
    expect(doubtButtons.length).toBe(1);

    fireEvent.click(doubtButtons[0]);
    expect(H.raiseDoubt).toHaveBeenCalledTimes(1);
    expect(H.raiseDoubt).toHaveBeenCalledWith({
      fromUid: 'u1',
      fromDisplayName: 'Me',
      targetUid: 'bob',
      targetDisplayName: 'Bob',
      itemId: 'i0',
      cellIndex: 0,
    });
  });

  it('renders the satisfied state distinctly from an open one in the sheet', () => {
    H.markers = [
      { uid: 'u1', displayName: 'Me', markedAt: 1 },
      { uid: 'bob', displayName: 'Bob', markedAt: 2 },
      { uid: 'carol', displayName: 'Carol', markedAt: 3 },
    ];
    // Bob's Doubt is answered by his Proof (createdAt 150 ≥ 100); Carol's is open.
    H.doubts = [
      mkDoubt({ id: 'd1', targetUid: 'bob', createdAt: 100 }),
      mkDoubt({ id: 'd2', targetUid: 'carol', createdAt: 100 }),
    ];
    H.proofs = [{ uid: 'bob', itemText: 'p0', createdAt: 150 }];

    const { container } = render(<Board />);
    // One Doubt still open → the Square badge shows 1; open it.
    const badge = container.querySelector('.doubt-badge');
    expect(badge!.textContent).toBe('1');
    fireEvent.click(badge!);

    // Bob's row reads SATISFIED, Carol's reads OPEN — two distinct states.
    const satisfied = container.querySelector('.doubt-satisfied');
    const open = container.querySelector('.doubt-open');
    expect(satisfied).not.toBeNull();
    expect(open).not.toBeNull();
    expect(satisfied!.className).not.toBe(open!.className);
    // The header summary counts only the OPEN Doubt.
    expect(container.querySelector('.doubt-summary')!.textContent).toContain('1 open doubt');
  });
});
