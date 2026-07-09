import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
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
  boardConfirmed: true,
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
  hasPriorBingoWitness: vi.fn(),
}));

vi.mock('../firebase', () => ({ db: {}, EVENT_ID: 'test-event' }));
vi.mock('../analytics', () => ({ track: vi.fn() }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user: H.user, loading: false }) }));
vi.mock('../hooks/useData', () => ({
  useBoard: () => ({ data: H.board, loading: false, hasServerData: H.boardConfirmed }),
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
// Keep the REAL module-scope pending queue (enqueue/peek/clear/reset) so the tests
// exercise the actual hold→drain machinery that survives unmounts (issue #104);
// stub only the terminal broadcasts + the durable-witness cache read. The queue
// functions are pure module state (no Firestore), so loading the real module is
// safe under the mocked ../firebase.
vi.mock('../data/moments', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data/moments')>();
  return {
    ...actual,
    broadcastBingo: H.broadcastBingo,
    broadcastBlackout: H.broadcastBlackout,
    broadcastFirstBingo: H.broadcastFirstBingo,
    hasPriorBingoWitness: H.hasPriorBingoWitness,
  };
});
vi.mock('../data/proofs', () => ({
  reportProof: vi.fn(() => Promise.resolve()),
  deleteProof: vi.fn(() => Promise.resolve()),
}));
vi.mock('./ProofSheet', () => ({ default: () => null }));
vi.mock('./Celebration', () => ({ default: () => null }));

import Board from './Board';
import ProofFeed from './ProofFeed';
import { resetPendingMoments } from '../data/moments';

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
// `uid` defaults to u1; the account-switch tests build the OTHER account's board
// (BoardDoc carries its owner's uid — the attribution Board checks, finding B).
const boardWith = (marked: number[], uid = 'u1'): BoardDoc => ({ uid, seed: 1, createdAt: 0, cells: dealtWith(marked) });
const ROW0 = [0, 1, 2, 3, 4]; // a completed line → BINGO
const FULL_CARD = Array.from({ length: 25 }, (_, i) => i).filter((i) => i !== 12); // → Blackout

// Drain microtasks: doMark awaits setMark, then the async durable-witness check
// (hasPriorBingoWitness, finding D), then drains the queue — assertions must let
// that whole chain settle first.
const flushAsync = () => act(async () => {});

// The default (non-winning) setMark verdict; each winning test overrides the win
// transition fields per click. Broadcasts now ride setMark's SYNCHRONOUS verdict
// (issue #104), so tests drive wins by CLICKING a Square with the verdict set.
type Verdict = { bingo: boolean; blackout: boolean; bingoTransition: boolean; blackoutTransition: boolean };
const NO_WIN: Verdict = { bingo: false, blackout: false, bingoTransition: false, blackoutTransition: false };

// Click a Square (honor mode marks straight through to doMark) with a given win
// verdict from setMark. `label` must be an on-screen Square text (`p<index>`); a
// non-marked Square marks, a marked Square unmarks. setMark is stubbed, so the
// board does NOT auto-advance — a test rerenders H.board to simulate the live
// listener's next snapshot, or clicks another Square for a further action.
async function clickMark(label: string, verdict: Partial<Verdict> = {}) {
  H.setMark.mockResolvedValueOnce({ cells: [], ...NO_WIN, ...verdict });
  await act(async () => {
    fireEvent.click(screen.getByText(label));
  });
  await flushAsync(); // settle doMark's setMark → witness → enqueue → drain chain
}

beforeEach(() => {
  vi.clearAllMocks();
  resetPendingMoments(); // the pending queue is module state that survives unmounts
  H.user = { uid: 'u1', displayName: 'Sailor', photoURL: null } as unknown as User;
  H.board = null;
  H.boardConfirmed = true;
  H.player = { displayName: 'Deck Daddy', photoURL: null, firstBingoAt: null } as unknown as PlayerDoc;
  H.playerLoading = false;
  H.playerConfirmed = true;
  H.players = [];
  H.rosterConfirmed = true;
  H.feedEntries = [];
  H.setMark.mockResolvedValue({ cells: [], ...NO_WIN });
  H.hasPriorBingoWitness.mockResolvedValue(false); // fresh device / no prior win
});

describe('Board — broadcasts Moments on the ACTION path (specs/w2-feed-moments.md, issue #104)', () => {
  // Moments now broadcast off setMark's SYNCHRONOUS win-transition verdict, consumed
  // in doMark (a click), NOT off snapshot diffing. So these tests drive wins by
  // CLICKING a Square (with the mocked verdict set) and assert a passive board
  // re-render never broadcasts. The prior snapshot-diff suite drove wins by
  // rerendering H.board; those cases are REPLACED here with click-driven equivalents,
  // or — where the mechanism is gone entirely — with the structural invariant that
  // survived (a passive snapshot is never a broadcast).

  it('broadcasts a first BINGO on the completing MARK — not on init, not on a passive re-render', async () => {
    H.board = boardWith([0, 1, 2, 3]); // row 0 one Square shy
    const { rerender } = render(<Board />);
    // Initialisation (a passive first paint) must NOT broadcast — a returning Player
    // whose bingo already stood mustn't re-announce it.
    expect(H.broadcastBingo).not.toHaveBeenCalled();

    // The player's tap completes the line → setMark's bingoTransition verdict fires it.
    await clickMark('p4', { bingo: true, bingoTransition: true });
    expect(H.broadcastBingo).toHaveBeenCalledTimes(1);
    expect(H.broadcastBingo).toHaveBeenCalledWith({ uid: 'u1', displayName: 'Deck Daddy', photoURL: null });

    // A passive snapshot reflecting the mark (the live listener's echo) is NOT a
    // fresh action — it must not re-broadcast.
    H.board = boardWith(ROW0);
    rerender(<Board />);
    await flushAsync();
    expect(H.broadcastBingo).toHaveBeenCalledTimes(1);
  });

  it('a bare Mark that completes no line broadcasts nothing (ADR 0002)', async () => {
    H.board = boardWith([]);
    render(<Board />);
    await clickMark('p0'); // NO_WIN verdict: neither transition
    expect(H.broadcastBingo).not.toHaveBeenCalled();
    expect(H.broadcastBlackout).not.toHaveBeenCalled();
    expect(H.broadcastFirstBingo).not.toHaveBeenCalled();
  });

  it('claims First-to-BINGO when the roster shows no other Player has bingoed yet', async () => {
    H.players = [{ uid: 'u1', firstBingoAt: null } as unknown as PlayerDoc];
    H.board = boardWith([0, 1, 2, 3]);
    render(<Board />);
    await clickMark('p4', { bingo: true, bingoTransition: true });
    expect(H.broadcastBingo).toHaveBeenCalledTimes(1);
    expect(H.broadcastFirstBingo).toHaveBeenCalledTimes(1);
    expect(H.hasPriorBingoWitness).toHaveBeenCalledWith('u1'); // the witness-gated candidate
  });

  it('does NOT claim First-to-BINGO when another Player already has a firstBingoAt', async () => {
    H.players = [{ uid: 'someone-else', firstBingoAt: 123 } as unknown as PlayerDoc];
    H.board = boardWith([0, 1, 2, 3]);
    render(<Board />);
    await clickMark('p4', { bingo: true, bingoTransition: true });
    expect(H.broadcastBingo).toHaveBeenCalledTimes(1); // their own first BINGO still posts
    expect(H.broadcastFirstBingo).not.toHaveBeenCalled(); // but not the ceremonial first
  });

  it('broadcasts a Blackout on the full-card MARK, without re-firing the BINGO', async () => {
    H.board = boardWith([0, 1, 2, 3]);
    const { rerender } = render(<Board />);
    await clickMark('p4', { bingo: true, bingoTransition: true }); // BINGO edge first
    expect(H.broadcastBingo).toHaveBeenCalledTimes(1);

    // The listener echoes the mark, then the player fills the rest of the card.
    H.board = boardWith(FULL_CARD.filter((i) => i !== 24));
    rerender(<Board />);
    await clickMark('p24', { bingo: true, blackout: true, blackoutTransition: true });
    expect(H.broadcastBlackout).toHaveBeenCalledTimes(1);
    expect(H.broadcastBingo).toHaveBeenCalledTimes(1); // not re-announced (bingoTransition false)
  });

  it('HOLDS a broadcast made while identity is UNKNOWN, then fires it once with the SAVED name (PR #99 finding 1)', async () => {
    // Identity UNKNOWN: the player row is still loading, so `displayName` has fallen
    // back to the auth name — the same window setMark passes `undefined`. A win here
    // must NOT stamp that stale name into an immutable Moment; the queue HOLDS it
    // until identity resolves (and — the #104 fix — the queue is module state, so the
    // hold survives an unmount; see the dedicated remount test below).
    H.playerLoading = true;
    H.player = null;
    H.board = boardWith([0, 1, 2, 3]);
    const { rerender } = render(<Board />);

    await clickMark('p4', { bingo: true, bingoTransition: true });
    expect(H.broadcastBingo).not.toHaveBeenCalled(); // held — not the stale name

    // Identity resolves to the SAVED name → the gate-open drain fires it ONCE.
    H.playerLoading = false;
    H.playerConfirmed = true;
    H.player = { displayName: 'Deck Daddy', photoURL: null, firstBingoAt: null } as unknown as PlayerDoc;
    rerender(<Board />);
    await flushAsync();
    expect(H.broadcastBingo).toHaveBeenCalledTimes(1);
    expect(H.broadcastBingo).toHaveBeenCalledWith({ uid: 'u1', displayName: 'Deck Daddy', photoURL: null });
  });

  it('the held broadcast SURVIVES a Board unmount and drains on remount — the headline #104 fix', async () => {
    // Win while identity is unknown → held in the MODULE queue…
    H.playerLoading = true;
    H.player = null;
    H.board = boardWith([0, 1, 2, 3]);
    const { unmount } = render(<Board />);
    await clickMark('p4', { bingo: true, bingoTransition: true });
    expect(H.broadcastBingo).not.toHaveBeenCalled(); // held

    // …the Player navigates off the Card route: Board UNMOUNTS. The old
    // component-ref queue died here (the bug this issue fixes); the module queue
    // does not.
    unmount();

    // Identity has since resolved; the Player returns to the Card — a fresh Board
    // MOUNT sees the gate open and drains the still-queued win exactly once, with the
    // saved name.
    H.playerLoading = false;
    H.playerConfirmed = true;
    H.player = { displayName: 'Deck Daddy', photoURL: null, firstBingoAt: null } as unknown as PlayerDoc;
    H.board = boardWith(ROW0);
    render(<Board />);
    await flushAsync();
    expect(H.broadcastBingo).toHaveBeenCalledTimes(1);
    expect(H.broadcastBingo).toHaveBeenCalledWith({ uid: 'u1', displayName: 'Deck Daddy', photoURL: null });
  });

  it('HOLDS First-to-BINGO while the roster is unconfirmed, then does NOT claim it if the confirmed roster shows an earlier bingo (PR #99 finding 2)', async () => {
    // An initial empty roster from a still-loading subscription is NOT proof nobody
    // has bingoed. The player's own BINGO posts (identity is known); the ceremonial
    // First-to-BINGO is held until the roster is server-confirmed.
    H.rosterConfirmed = false;
    H.players = [];
    H.board = boardWith([0, 1, 2, 3]);
    const { rerender } = render(<Board />);
    await clickMark('p4', { bingo: true, bingoTransition: true });
    expect(H.broadcastBingo).toHaveBeenCalledTimes(1); // own BINGO posts
    expect(H.broadcastFirstBingo).not.toHaveBeenCalled(); // ceremonial claim HELD, not guessed

    // Roster confirms — and another Player already had a firstBingoAt: not first.
    H.rosterConfirmed = true;
    H.players = [{ uid: 'someone-else', firstBingoAt: 123 } as unknown as PlayerDoc];
    rerender(<Board />);
    await flushAsync();
    expect(H.broadcastFirstBingo).not.toHaveBeenCalled();
  });

  it('HOLDS First-to-BINGO while the roster is unconfirmed, then CLAIMS it once the confirmed roster shows no earlier bingo (PR #99 finding 2)', async () => {
    H.rosterConfirmed = false;
    H.players = [];
    H.board = boardWith([0, 1, 2, 3]);
    const { rerender } = render(<Board />);
    await clickMark('p4', { bingo: true, bingoTransition: true });
    expect(H.broadcastFirstBingo).not.toHaveBeenCalled(); // held while unconfirmed

    H.rosterConfirmed = true;
    H.players = [{ uid: 'u1', firstBingoAt: null } as unknown as PlayerDoc]; // only self
    rerender(<Board />);
    await flushAsync();
    expect(H.broadcastFirstBingo).toHaveBeenCalledTimes(1);
  });

  it('a win completed while identity was UNKNOWN, then UNMARKED before it resolves, does NOT post (action-driven falling edge — finding A preserved)', async () => {
    H.playerLoading = true;
    H.player = null;
    H.board = boardWith([0, 1, 2, 3]);
    const { rerender } = render(<Board />);

    await clickMark('p4', { bingo: true, bingoTransition: true }); // held
    expect(H.broadcastBingo).not.toHaveBeenCalled();

    // The player unmarks a Square and LOSES the win while still held. The unmark's
    // verdict (no standing bingo) DROPS the queued broadcast — the ACTION-path
    // replacement for PR #99 round 2 finding A's snapshot falling edge + fire-time
    // revalidation.
    await clickMark('p0', { bingo: false, bingoTransition: false });

    // Identity resolves: the queue is empty, so nothing fires.
    H.playerLoading = false;
    H.playerConfirmed = true;
    H.player = { displayName: 'Deck Daddy', photoURL: null, firstBingoAt: null } as unknown as PlayerDoc;
    rerender(<Board />);
    await flushAsync();
    expect(H.broadcastBingo).not.toHaveBeenCalled();
    expect(H.broadcastFirstBingo).not.toHaveBeenCalled();
  });

  it('a lose-then-REGAIN while held re-queues legitimately — exactly one write once the gate opens (finding A)', async () => {
    H.playerLoading = true;
    H.player = null;
    H.board = boardWith([0, 1, 2, 3]);
    const { rerender } = render(<Board />);

    await clickMark('p4', { bingo: true, bingoTransition: true }); // queue while held
    await clickMark('p0', { bingo: false, bingoTransition: false }); // unmark drops it
    await clickMark('p4', { bingo: true, bingoTransition: true }); // remark re-queues
    expect(H.broadcastBingo).not.toHaveBeenCalled(); // still held (identity unknown)

    H.playerLoading = false;
    H.playerConfirmed = true;
    H.player = { displayName: 'Deck Daddy', photoURL: null, firstBingoAt: null } as unknown as PlayerDoc;
    rerender(<Board />);
    await flushAsync();
    expect(H.broadcastBingo).toHaveBeenCalledTimes(1); // the regained win, exactly once
  });

  it('suppresses the ceremonial First-to-BINGO for a REGAINED line when the durable witness exists (round 2 finding D)', async () => {
    // First win: no witness yet — both the bingo and the ceremonial first post.
    H.board = boardWith([0, 1, 2, 3]);
    render(<Board />);
    await clickMark('p4', { bingo: true, bingoTransition: true });
    expect(H.broadcastBingo).toHaveBeenCalledTimes(1);
    expect(H.broadcastFirstBingo).toHaveBeenCalledTimes(1);
    expect(H.hasPriorBingoWitness).toHaveBeenCalledWith('u1');

    // The player unmarks the line (firstBingoAt is volatile and clears with it)…
    await clickMark('p0', { bingo: false, bingoTransition: false });
    // …and the broadcast Moment doc is now the durable witness in the local cache.
    H.hasPriorBingoWitness.mockResolvedValue(true);

    // Regaining a line still attempts the plain bingo Moment (skipped by the writer's
    // write-once cache pre-check, or denied server-side on a cold cache — fine), but
    // must NOT re-queue the ceremonial event singleton: the player was not first EVER.
    await clickMark('p4', { bingo: true, bingoTransition: true });
    expect(H.broadcastBingo).toHaveBeenCalledTimes(2); // plain bingo write still attempted
    expect(H.broadcastFirstBingo).toHaveBeenCalledTimes(1); // NOT re-claimed
  });

  it('fires for the player’s OWN mark completing a line on a still-UNCONFIRMED board — the offline win is queued, not swallowed (round 3 finding A, now natural)', async () => {
    // Offline reload: the board hydrates from cache only and never confirms until
    // reconnect. The action path broadcasts off the mark's verdict regardless of
    // board confirmation — the Moment `setDoc` pends offline (ADR 0006). No
    // local-action-vs-hydration disambiguation is needed anymore (finding A moot).
    H.boardConfirmed = false;
    H.board = boardWith([0, 1, 2, 3]);
    const { rerender } = render(<Board />);
    await clickMark('p4', { bingo: true, bingoTransition: true });
    expect(H.broadcastBingo).toHaveBeenCalledTimes(1);
    expect(H.broadcastBingo).toHaveBeenCalledWith({ uid: 'u1', displayName: 'Deck Daddy', photoURL: null });

    // Reconnect: the server confirmation of the SAME standing win is a PASSIVE
    // snapshot, not a mark — nothing fires twice.
    H.boardConfirmed = true;
    H.board = boardWith(ROW0);
    rerender(<Board />);
    await flushAsync();
    expect(H.broadcastBingo).toHaveBeenCalledTimes(1);
  });

  it('each offline mark carries its own verdict — the winning tap fires, the non-winning one does not (round 4 finding A moot)', async () => {
    // Two fast offline taps: the first completes no line, the second completes row 0.
    // With broadcasts on the action path each mark's verdict is independent, so the
    // round-4 "count local snapshots so the winning one is still live" machinery is
    // gone — there is no shared snapshot counter to lose the winning edge to.
    H.boardConfirmed = false;
    H.board = boardWith([0, 1, 2]);
    const { rerender } = render(<Board />);

    await clickMark('p3', { bingo: false, bingoTransition: false }); // non-winning tap
    expect(H.broadcastBingo).not.toHaveBeenCalled();

    H.board = boardWith([0, 1, 2, 3]); // listener echoes the first tap
    rerender(<Board />);
    await clickMark('p4', { bingo: true, bingoTransition: true }); // the winning tap
    expect(H.broadcastBingo).toHaveBeenCalledTimes(1);
  });

  it('a passive board snapshot never broadcasts — cache-only → server-confirmed revealing a standing bingo stays silent (finding C, now structural)', async () => {
    // No click anywhere: broadcasts ride the action path, so a board arriving via the
    // listener (cache then server) — even one revealing a standing bingo — is never a
    // broadcast. This structurally subsumes the round-2 cache-hydration baseline and
    // the round-3 passive-unconfirmed-snapshot case.
    H.boardConfirmed = false;
    H.board = boardWith([]);
    const { rerender } = render(<Board />);

    H.boardConfirmed = true;
    H.board = boardWith(ROW0); // server confirmation reveals a standing bingo
    rerender(<Board />);
    await flushAsync();
    expect(H.broadcastBingo).not.toHaveBeenCalled();
    expect(H.broadcastBlackout).not.toHaveBeenCalled();
    expect(H.broadcastFirstBingo).not.toHaveBeenCalled();
  });

  it('an account switch onto a new uid’s standing-bingo board broadcasts nothing (findings 5 + B, now structural)', async () => {
    H.board = boardWith([], 'u1');
    const { rerender } = render(<Board />);
    expect(H.broadcastBingo).not.toHaveBeenCalled();

    // Switch to u2 whose FIRST snapshot already has a standing bingo — a PASSIVE
    // snapshot, not a mark, so nothing fires for u2. (The per-uid queue also keeps a
    // held u1 win from ever draining under u2.)
    H.user = { uid: 'u2', displayName: 'Sailor', photoURL: null } as unknown as User;
    H.player = { displayName: 'Second Sailor', photoURL: null, firstBingoAt: null } as unknown as PlayerDoc;
    H.board = boardWith(ROW0, 'u2');
    rerender(<Board />);
    await flushAsync();
    expect(H.broadcastBingo).not.toHaveBeenCalled();
    expect(H.broadcastFirstBingo).not.toHaveBeenCalled();
  });

  it('a held blackout fires from its completing mark’s verdict — the round 3 finding B vacuous isBlackout([]) hazard cannot arise', async () => {
    // The drain never recomputes isBlackout from cells (the decision was the mark's
    // verdict), so the empty-board vacuous-truth bug is structurally impossible. A
    // blackout completed while identity is unknown holds, and fires from the QUEUE
    // when identity resolves — even if the board doc has since vanished (a passive
    // deletion is not an unmark, so it does not clear the queued win).
    H.playerLoading = true;
    H.player = null;
    H.board = boardWith(FULL_CARD.filter((i) => i !== 24));
    const { rerender } = render(<Board />);
    await clickMark('p24', { bingo: true, blackout: true, blackoutTransition: true });
    expect(H.broadcastBlackout).not.toHaveBeenCalled(); // held (identity unknown)

    H.board = null; // the board doc disappears (a passive deletion)
    rerender(<Board />);

    H.playerLoading = false;
    H.playerConfirmed = true;
    H.player = { displayName: 'Deck Daddy', photoURL: null, firstBingoAt: null } as unknown as PlayerDoc;
    rerender(<Board />);
    await flushAsync();
    expect(H.broadcastBlackout).toHaveBeenCalledTimes(1); // from the verdict, no vacuous recompute
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
