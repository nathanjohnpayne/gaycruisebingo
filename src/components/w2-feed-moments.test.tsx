import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { User } from 'firebase/auth';
import type { BoardDoc, Cell, MomentDoc, MomentKind, PlayerDoc, ProofDoc } from '../types';
import type { FeedEntry } from '../hooks/useData';

// specs/w2-feed-moments.md, component layer (RTL-jsdom). Two surfaces:
//
// Board — broadcasts a Moment at the EXISTING BINGO/Blackout edge (Board's
// wasBingo/wasBlackout refs + celebrate effect): a first BINGO fires exactly ONE
// bingo Moment on the TRANSITION into having a bingo (not on every completed line
// or every render); a Blackout fires one; First-to-BINGO fires only when the
// known-players roster (the same data the Leaderboard pin reads) shows no other
// Player has bingoed yet; and a bare Mark that completes no line broadcasts
// nothing. The broadcasts themselves are stubbed (the write shape is
// src/data/w2-feed-moments.test.ts); the board updates arrive the way the live
// listener delivers them — a new board snapshot — so we drive them via rerender.
//
// ProofFeed — Proofs and Moments render merged newest-first; a Moment shows as a
// celebratory line with NO media and NO report/delete affordances, a Proof keeps
// them; an empty Feed (what a bare Mark leaves) shows the empty state. The
// newest-first SORT itself is unit-tested on mergeFeed in the data suite; here we
// feed an already-merged list and pin that ProofFeed renders it in order + per kind.

const H = vi.hoisted(() => ({
  user: null as User | null,
  board: null as BoardDoc | null,
  player: null as PlayerDoc | null,
  playerLoading: false,
  playerConfirmed: true,
  players: [] as PlayerDoc[],
  rosterConfirmed: true,
  feedEntries: [] as FeedEntry[],
  setMark: vi.fn(),
  broadcastBingo: vi.fn(),
  broadcastBlackout: vi.fn(),
  broadcastFirstBingo: vi.fn(),
}));

vi.mock('../firebase', () => ({ db: {}, EVENT_ID: 'test-event' }));
vi.mock('../analytics', () => ({ track: vi.fn() }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user: H.user, loading: false }) }));
vi.mock('../hooks/useData', () => ({
  useBoard: () => ({ data: H.board, loading: false, hasServerData: true }),
  useMyPlayer: () => ({ data: H.player, loading: H.playerLoading, hasServerData: H.playerConfirmed }),
  // honor mode so a completed line marks straight through (no ProofSheet detour).
  useEventDoc: () => ({ data: { claimMode: 'honor' }, loading: false }),
  useItems: () => ({ items: [], loading: false, hasServerData: true }),
  useTally: () => ({ markers: [], count: 0, loading: false, hasServerData: true }),
  useLeaderboard: () => ({ players: H.players, loading: false, hasServerData: H.rosterConfirmed }),
  useFeed: () => ({ entries: H.feedEntries, loading: false }),
}));
// Keep the REAL resolveDisplayName (Board feeds its resolved output to the actor);
// stub the write path.
vi.mock('../data/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data/api')>();
  return { ...actual, setMark: H.setMark };
});
vi.mock('../data/moments', () => ({
  broadcastBingo: H.broadcastBingo,
  broadcastBlackout: H.broadcastBlackout,
  broadcastFirstBingo: H.broadcastFirstBingo,
}));
vi.mock('../data/proofs', () => ({
  reportProof: vi.fn(() => Promise.resolve()),
  deleteProof: vi.fn(() => Promise.resolve()),
}));
vi.mock('./ProofSheet', () => ({ default: () => null }));
vi.mock('./Celebration', () => ({ default: () => null }));

import Board from './Board';
import ProofFeed from './ProofFeed';

// A dealt board with `marked` non-free Squares on (plus the always-on free centre).
function dealtWith(marked: number[]): Cell[] {
  const on = new Set(marked);
  return Array.from({ length: 25 }, (_, index) => ({
    index,
    itemId: index === 12 ? null : `i${index}`,
    text: index === 12 ? 'FREE' : `p${index}`,
    free: index === 12,
    marked: index === 12 || on.has(index),
    markedAt: index === 12 || on.has(index) ? 1 : null,
  }));
}
const boardWith = (marked: number[]): BoardDoc => ({ uid: 'u1', seed: 1, createdAt: 0, cells: dealtWith(marked) });
const ROW0 = [0, 1, 2, 3, 4]; // a completed line → BINGO
const FULL_CARD = Array.from({ length: 25 }, (_, i) => i).filter((i) => i !== 12); // → Blackout

beforeEach(() => {
  vi.clearAllMocks();
  H.user = { uid: 'u1', displayName: 'Sailor', photoURL: null } as unknown as User;
  H.board = null;
  H.player = { displayName: 'Deck Daddy', photoURL: null, firstBingoAt: null } as unknown as PlayerDoc;
  H.playerLoading = false;
  H.playerConfirmed = true;
  H.players = [];
  H.rosterConfirmed = true;
  H.feedEntries = [];
  H.setMark.mockResolvedValue({ cells: [], bingo: false, blackout: false });
});

describe('Board — broadcasts Moments on the BINGO/Blackout edge (specs/w2-feed-moments.md)', () => {
  it('a first BINGO broadcasts exactly one bingo Moment on the transition — not on init, not on every render', () => {
    H.board = boardWith([]); // no line yet
    const { rerender } = render(<Board />);
    // Initialisation must NOT broadcast (a returning Player whose bingo already
    // stood on first paint mustn't re-announce it).
    expect(H.broadcastBingo).not.toHaveBeenCalled();

    H.board = boardWith(ROW0); // cross into having a BINGO
    rerender(<Board />);
    expect(H.broadcastBingo).toHaveBeenCalledTimes(1);
    expect(H.broadcastBingo).toHaveBeenCalledWith({ uid: 'u1', displayName: 'Deck Daddy', photoURL: null });

    // A further Mark while the bingo still stands is NOT a new edge.
    H.board = boardWith([...ROW0, 5]);
    rerender(<Board />);
    expect(H.broadcastBingo).toHaveBeenCalledTimes(1);
  });

  it('a bare Mark that completes no line broadcasts nothing (ADR 0002)', () => {
    H.board = boardWith([]);
    const { rerender } = render(<Board />);
    H.board = boardWith([0]); // one Square marked, no line
    rerender(<Board />);
    expect(H.broadcastBingo).not.toHaveBeenCalled();
    expect(H.broadcastBlackout).not.toHaveBeenCalled();
    expect(H.broadcastFirstBingo).not.toHaveBeenCalled();
  });

  it('claims First-to-BINGO when the roster shows no other Player has bingoed yet', () => {
    H.players = [{ uid: 'u1', firstBingoAt: null } as unknown as PlayerDoc];
    H.board = boardWith([]);
    const { rerender } = render(<Board />);
    H.board = boardWith(ROW0);
    rerender(<Board />);
    expect(H.broadcastBingo).toHaveBeenCalledTimes(1);
    expect(H.broadcastFirstBingo).toHaveBeenCalledTimes(1);
  });

  it('does NOT claim First-to-BINGO when another Player already has a firstBingoAt', () => {
    H.players = [{ uid: 'someone-else', firstBingoAt: 123 } as unknown as PlayerDoc];
    H.board = boardWith([]);
    const { rerender } = render(<Board />);
    H.board = boardWith(ROW0);
    rerender(<Board />);
    expect(H.broadcastBingo).toHaveBeenCalledTimes(1); // their own first BINGO still posts
    expect(H.broadcastFirstBingo).not.toHaveBeenCalled(); // but not the ceremonial first
  });

  it('a Blackout broadcasts one blackout Moment on the full-card edge, without re-firing the BINGO', () => {
    H.board = boardWith([]);
    const { rerender } = render(<Board />);
    H.board = boardWith(ROW0); // BINGO edge first (real boards reach a line before a full card)
    rerender(<Board />);
    expect(H.broadcastBingo).toHaveBeenCalledTimes(1);

    H.board = boardWith(FULL_CARD); // now the Blackout edge
    rerender(<Board />);
    expect(H.broadcastBlackout).toHaveBeenCalledTimes(1);
    expect(H.broadcastBingo).toHaveBeenCalledTimes(1); // not re-announced
  });

  it('HOLDS a broadcast fired while identity is UNKNOWN, then fires it once with the SAVED name (PR #99 finding 1)', () => {
    // Identity UNKNOWN: the player row is still loading, so `displayName` has fallen
    // back to the auth/Google name — the same window in which setMark passes
    // `undefined` rather than stamp it. A BINGO edge here must NOT write that stale
    // name into an immutable Moment; it holds (never dropped) until identity resolves.
    H.playerLoading = true;
    H.player = null;
    H.board = boardWith([]);
    const { rerender } = render(<Board />);

    H.board = boardWith(ROW0); // BINGO edge crosses WHILE identity is unknown
    rerender(<Board />);
    expect(H.broadcastBingo).not.toHaveBeenCalled(); // held — not dropped, not stale

    // Identity resolves to the SAVED player-row name: the held broadcast fires ONCE.
    H.playerLoading = false;
    H.playerConfirmed = true;
    H.player = { displayName: 'Deck Daddy', photoURL: null, firstBingoAt: null } as unknown as PlayerDoc;
    rerender(<Board />);
    expect(H.broadcastBingo).toHaveBeenCalledTimes(1);
    expect(H.broadcastBingo).toHaveBeenCalledWith({ uid: 'u1', displayName: 'Deck Daddy', photoURL: null });
  });

  it('HOLDS First-to-BINGO while the roster is unconfirmed, then does NOT claim it if the confirmed roster shows an earlier bingo (PR #99 finding 2)', () => {
    // An initial empty roster from a still-loading subscription is NOT proof nobody
    // has bingoed. The player's own BINGO posts (identity is known), but the
    // ceremonial First-to-BINGO is held until the roster is server-confirmed.
    H.rosterConfirmed = false;
    H.players = [];
    H.board = boardWith([]);
    const { rerender } = render(<Board />);

    H.board = boardWith(ROW0); // BINGO edge WHILE the roster is unconfirmed
    rerender(<Board />);
    expect(H.broadcastBingo).toHaveBeenCalledTimes(1); // own BINGO posts
    expect(H.broadcastFirstBingo).not.toHaveBeenCalled(); // ceremonial claim held, not guessed

    // Roster confirms — and another Player already had a firstBingoAt: not first.
    H.rosterConfirmed = true;
    H.players = [{ uid: 'someone-else', firstBingoAt: 123 } as unknown as PlayerDoc];
    rerender(<Board />);
    expect(H.broadcastFirstBingo).not.toHaveBeenCalled(); // no ceremonial Moment
  });

  it('HOLDS First-to-BINGO while the roster is unconfirmed, then CLAIMS it once the confirmed roster shows no earlier bingo (PR #99 finding 2)', () => {
    H.rosterConfirmed = false;
    H.players = [];
    H.board = boardWith([]);
    const { rerender } = render(<Board />);

    H.board = boardWith(ROW0);
    rerender(<Board />);
    expect(H.broadcastFirstBingo).not.toHaveBeenCalled(); // held while unconfirmed

    H.rosterConfirmed = true;
    H.players = [{ uid: 'u1', firstBingoAt: null } as unknown as PlayerDoc]; // only self, no earlier bingo
    rerender(<Board />);
    expect(H.broadcastFirstBingo).toHaveBeenCalledTimes(1);
  });

  it('resets the edge refs on account switch — a new uid whose board already has a standing bingo does NOT fire a spurious edge (PR #99 finding 5)', () => {
    // u1 has NO bingo standing: init leaves wasBingo=false (the baseline).
    H.board = boardWith([]);
    const { rerender } = render(<Board />);
    expect(H.broadcastBingo).not.toHaveBeenCalled();

    // Switch to u2 whose FIRST snapshot already has a standing bingo. Without a
    // per-uid reset, the carried-over wasBingo=false + bingo=true would read as a
    // fresh edge and fire a spurious Moment attributed to u2; the reset re-establishes
    // init (no fire) before the cells effect re-runs.
    H.user = { uid: 'u2', displayName: 'Sailor', photoURL: null } as unknown as User;
    H.player = { displayName: 'Second Sailor', photoURL: null, firstBingoAt: null } as unknown as PlayerDoc;
    H.board = boardWith(ROW0); // u2's board, bingo already standing
    rerender(<Board />);
    expect(H.broadcastBingo).not.toHaveBeenCalled(); // no spurious edge for u2
    expect(H.broadcastFirstBingo).not.toHaveBeenCalled();
  });
});

// Feed-entry builders matching the mergeFeed output shape.
function proofEntry(id: string, createdAt: number, over: Partial<ProofDoc> = {}): FeedEntry {
  return {
    feedKind: 'proof',
    createdAt,
    proof: {
      id,
      createdAt,
      uid: `u-${id}`,
      displayName: 'Someone',
      photoURL: null,
      type: 'text',
      cellIndex: 0,
      itemText: 'a prompt',
      storagePath: null,
      mediaURL: null,
      thumbURL: null,
      text: null,
      reportCount: 0,
      status: 'active',
      visionFlag: null,
      ...over,
    } as ProofDoc,
  };
}
function momentEntry(id: string, createdAt: number, kind: MomentKind, over: Partial<MomentDoc> = {}): FeedEntry {
  return {
    feedKind: 'moment',
    createdAt,
    moment: { id, kind, uid: `u-${id}`, displayName: 'Someone', photoURL: null, createdAt, ...over },
  };
}

describe('ProofFeed — the merged Feed (specs/w2-feed-moments.md)', () => {
  it('renders Moments and Proofs merged newest-first, each distinctly', () => {
    // Delivered already newest-first (mergeFeed's job, unit-tested separately).
    H.feedEntries = [
      momentEntry('m1', 3000, 'bingo', { displayName: 'Deck Daddy' }),
      proofEntry('p1', 2000, { displayName: 'Midge', itemText: 'Ordered a seventh cocktail' }),
      momentEntry('m2', 1000, 'first_bingo', { displayName: 'Barnacle Betty' }),
    ];
    render(<ProofFeed />);

    const cards = document.querySelectorAll('.list > .moment, .list > .proof');
    expect(cards).toHaveLength(3);
    expect(cards[0].className).toContain('moment');
    expect(cards[0]).toHaveTextContent('Deck Daddy');
    expect(cards[0]).toHaveTextContent(/got a BINGO/i);
    expect(cards[1].className).toContain('proof');
    expect(cards[1]).toHaveTextContent('Midge');
    expect(cards[1]).toHaveTextContent(/Ordered a seventh cocktail/);
    expect(cards[2].className).toContain('moment');
    expect(cards[2]).toHaveTextContent('Barnacle Betty');
    expect(cards[2]).toHaveTextContent(/First to BINGO/i);
  });

  it('a Moment carries no media and no report/delete affordances — it is a celebratory line', () => {
    H.feedEntries = [momentEntry('m1', 1, 'blackout', { displayName: 'Deck Daddy' })];
    render(<ProofFeed />);

    const moment = document.querySelector('.moment') as HTMLElement;
    expect(moment).toBeInTheDocument();
    // No attached evidence (ADR 0002) and nothing to dispute.
    expect(moment.querySelector('img.proof-media, audio.proof-media, .proof-quote')).toBeNull();
    expect(moment.querySelector('button')).toBeNull();
    expect(moment).toHaveTextContent(/blacked out the whole card/i);
  });

  it('a Proof keeps its report and owner-delete affordances in the Feed', () => {
    H.user = { uid: 'u-p1' } as unknown as User; // the viewer owns this Proof
    H.feedEntries = [proofEntry('p1', 1)]; // proof.uid === 'u-p1'
    render(<ProofFeed />);

    const proof = document.querySelector('.proof') as HTMLElement;
    expect(proof.querySelector('button[title="Report"]')).toBeInTheDocument();
    expect(proof.querySelector('button[title="Delete"]')).toBeInTheDocument();
  });

  it('a bare Mark produces no Feed entry — an empty Feed shows the empty state (ADR 0002)', () => {
    H.feedEntries = []; // a bare Mark writes neither a Proof nor a Moment
    render(<ProofFeed />);
    expect(screen.getByText(/nothing in the feed yet/i)).toBeInTheDocument();
  });
});
