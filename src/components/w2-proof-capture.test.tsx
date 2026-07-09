import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BoardDoc, Cell, EventDoc, PlayerDoc } from '../types';

// w2-proof-capture, capture + gating layer (RTL-jsdom). Two real components:
//   1. ProofSheet — each capture type (photo / audio / text) produces a valid
//      submit that calls attachProof and closes the sheet; Cancel closes WITHOUT
//      attaching (so the Square is never marked); and a failed submit KEEPS the
//      capture (capture-then-retry — the offline story: attachProof can't queue,
//      so the Player retries when signal returns without re-capturing).
//   2. Board proof-to-mark gating — in proof_required an unmarked Square opens
//      ProofSheet instead of marking (friction, not trust — ADR 0001), a
//      cancelled sheet leaves it unmarked, and unmark stays instant; in honor a
//      Square marks directly with NO sheet (a Proof never gates credit).
// attachProof / setMark are stubbed so the assertions are about the flow, not
// the write (that is w2-proof-capture.test.ts / w1-board-mark-win.test.ts).

const H = vi.hoisted(() => ({
  user: { uid: 'u1', displayName: 'Deck Daddy', photoURL: null } as { uid: string; displayName: string | null; photoURL: string | null },
  board: null as BoardDoc | null,
  player: null as PlayerDoc | null,
  event: null as EventDoc | null,
  setMark: vi.fn(),
  attachProof: vi.fn(),
  track: vi.fn(),
}));

vi.mock('../hooks/useData', () => ({
  useBoard: () => ({ data: H.board, loading: false, hasServerData: true }),
  useMyPlayer: () => ({ data: H.player, loading: false, hasServerData: true }),
  useEventDoc: () => ({ data: H.event, loading: false }),
  useItems: () => ({ items: [], loading: false, hasServerData: true }),
  // Board renders the per-Prompt TallyBadge on a marked, non-free Square (ADR
  // 0002, #31), so a test that marks a Square exercises useTally; an empty Tally
  // keeps these gating tests focused on the mark flow, not the count.
  useTally: () => ({ markers: [], count: 0, loading: false, hasServerData: true }),
  // Board reads the roster for the First-to-BINGO Moment (#34); these gating
  // tests never cross a bingo edge, so an empty roster suffices.
  useLeaderboard: () => ({ players: [], loading: false }),
}));
// Stub the Moment broadcasts (#34): these tests never cross a bingo/blackout edge
// so none fires, and mocking the module also keeps Board's real
// src/data/moments.ts (which imports the prod ../firebase singleton) from loading
// getAuth() into this suite, which does not stub ../firebase.
// hasPriorBingoWitness (the finding-D durable-witness check) is stubbed to the
// no-witness default for the same reason; with no edge crossed it is never called.
// The pending-Moment queue exports (issue #104) are stubbed too: Board's drain runs
// on mount and doMark enqueues on every honor mark, so peekPendingMoments must
// resolve to an empty triple (these gating tests never cross an edge, so the stubs'
// behaviour is inert — no broadcast fires).
vi.mock('../data/moments', () => ({
  broadcastBingo: vi.fn(),
  broadcastBlackout: vi.fn(),
  broadcastFirstBingo: vi.fn(),
  hasPriorBingoWitness: vi.fn(() => Promise.resolve(false)),
  enqueueWinMoments: vi.fn(),
  enqueueFirstBingoMoment: vi.fn(),
  peekPendingMoments: vi.fn(() => ({ bingo: false, blackout: false, firstBingo: false })),
  clearPendingMoment: vi.fn(),
  // PR #110 hardening: doMark drops fallen wins on every unmark (dropPendingWins),
  // reads the action generation around the witness await, and the drain checks the
  // ceremonial candidate's enqueue stamp (firstBingoCandidateCurrent); inert here.
  dropPendingWins: vi.fn(),
  pendingActionGeneration: vi.fn(() => 0),
  firstBingoCandidateCurrent: vi.fn(() => false),
}));
// Board resolves the caller's display name via resolveDisplayName (fed the player
// row) for BOTH the Tally marker and ProofSheet (#31/#78). Stub it here to mirror
// the real resolver for the mark flow; its validated behaviour is unit-tested in
// src/data/w2-tally.test.ts and against the rules in tests/rules/w2-tally.test.ts.
vi.mock('../data/api', () => ({
  setMark: H.setMark,
  resolveDisplayName: (
    profile: { displayName?: unknown } | null | undefined,
    fallback: string | null | undefined,
  ) =>
    typeof profile?.displayName === 'string' &&
    profile.displayName.trim().length > 0 &&
    profile.displayName.length <= 100
      ? profile.displayName
      : (fallback ?? 'Anonymous'),
}));
vi.mock('../data/proofs', () => ({ attachProof: H.attachProof }));
vi.mock('../analytics', () => ({ track: H.track }));
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: H.user, loading: false, signIn: vi.fn(), signOutUser: vi.fn() }),
}));

import Board from './Board';
import ProofSheet from './ProofSheet';

// A dealt board: every non-free Square unmarked, the free center (12) "on".
function dealt(): Cell[] {
  return Array.from({ length: 25 }, (_, index) => ({
    index,
    itemId: index === 12 ? null : `i${index}`,
    text: index === 12 ? 'FREE' : `Prompt ${index}`,
    free: index === 12,
    marked: index === 12,
    markedAt: null,
  }));
}

const cell = (over: Partial<Cell> = {}): Cell => ({
  index: 0,
  itemId: 'i0',
  text: 'Saw a sailor in Speedos',
  free: false,
  marked: false,
  markedAt: null,
  ...over,
});

// jsdom lacks these browser APIs ProofSheet touches. Stub them once.
class FakeMediaRecorder {
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  state = 'inactive';
  constructor(public stream: unknown) {}
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['audio'], { type: 'audio/webm' }) });
    this.onstop?.();
  }
}

beforeAll(() => {
  (globalThis.URL as unknown as { createObjectURL: () => string }).createObjectURL = () => 'blob:mock';
  (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = FakeMediaRecorder;
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }) },
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  H.user = { uid: 'u1', displayName: 'Deck Daddy', photoURL: null };
  H.board = null;
  H.player = null;
  H.event = null;
  H.setMark.mockResolvedValue({ cells: [], bingo: false, blackout: false });
  H.attachProof.mockResolvedValue(undefined);
  vi.spyOn(window, 'alert').mockImplementation(() => {});
});

describe('ProofSheet — each capture type produces a valid submit and closes', () => {
  const baseProps = () => ({
    uid: 'u1',
    displayName: 'Deck Daddy',
    photoURL: null,
    cells: dealt(),
    cell: cell(),
    claimMode: 'proof_required' as const,
    currentFirstBingoAt: null,
    onClose: vi.fn(),
  });

  it('a photo submit attaches a photo Proof and closes the sheet', async () => {
    const user = userEvent.setup();
    const props = baseProps();
    const { container } = render(<ProofSheet {...props} />);

    const file = new File(['img'], 'proof.jpg', { type: 'image/jpeg' });
    await user.upload(container.querySelector('input[type="file"]') as HTMLInputElement, file);

    await user.click(screen.getByRole('button', { name: /mark it/i }));

    await waitFor(() => expect(H.attachProof).toHaveBeenCalledTimes(1));
    expect(H.attachProof.mock.calls[0][0]).toMatchObject({
      uid: 'u1',
      cellIndex: 0,
      itemText: 'Saw a sailor in Speedos',
      proof: { type: 'photo', blob: file },
    });
    expect(props.onClose).toHaveBeenCalled();
  });

  it('a text submit attaches a trimmed text Proof and closes the sheet', async () => {
    const user = userEvent.setup();
    const props = baseProps();
    render(<ProofSheet {...props} />);

    await user.click(screen.getByRole('button', { name: /callout/i }));
    await user.type(screen.getByRole('textbox'), '  he did NOT  ');
    await user.click(screen.getByRole('button', { name: /mark it/i }));

    await waitFor(() => expect(H.attachProof).toHaveBeenCalledTimes(1));
    expect(H.attachProof.mock.calls[0][0].proof).toEqual({ type: 'text', text: 'he did NOT' });
    expect(props.onClose).toHaveBeenCalled();
  });

  it('an audio submit attaches a recorded audio Proof and closes the sheet', async () => {
    const user = userEvent.setup();
    const props = baseProps();
    render(<ProofSheet {...props} />);

    await user.click(screen.getByRole('button', { name: /sound/i }));
    await user.click(screen.getByRole('button', { name: /record/i }));
    // startRec awaits getUserMedia; once recording, a Stop button appears.
    await user.click(await screen.findByRole('button', { name: /stop/i }));
    await user.click(screen.getByRole('button', { name: /mark it/i }));

    await waitFor(() => expect(H.attachProof).toHaveBeenCalledTimes(1));
    expect(H.attachProof.mock.calls[0][0].proof.type).toBe('audio');
    expect(H.attachProof.mock.calls[0][0].proof.blob).toBeInstanceOf(Blob);
    expect(props.onClose).toHaveBeenCalled();
  });

  it('Cancel closes the sheet WITHOUT attaching a Proof (the Square stays unmarked)', async () => {
    const user = userEvent.setup();
    const props = baseProps();
    render(<ProofSheet {...props} />);

    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(H.attachProof).not.toHaveBeenCalled();
    expect(props.onClose).toHaveBeenCalled();
  });

  it('keeps the capture for retry when a submit fails, then closes on the retry (capture-then-retry, ADR 0006)', async () => {
    // attachProof cannot queue offline (transaction + media upload need signal),
    // so a failed submit must not lose the captured photo — the sheet stays open
    // with the preview so the Player retries when signal returns.
    const user = userEvent.setup();
    const props = baseProps();
    const { container } = render(<ProofSheet {...props} />);

    const file = new File(['img'], 'proof.jpg', { type: 'image/jpeg' });
    await user.upload(container.querySelector('input[type="file"]') as HTMLInputElement, file);

    H.attachProof.mockRejectedValueOnce(new Error('offline'));
    await user.click(screen.getByRole('button', { name: /mark it/i }));

    // The sheet stays open (not closed) and the captured preview is retained.
    await waitFor(() => expect(window.alert).toHaveBeenCalled());
    expect(props.onClose).not.toHaveBeenCalled();
    expect(container.querySelector('img.preview')).toBeInTheDocument();

    // Retry now succeeds — same capture, no re-shoot — and the sheet closes.
    H.attachProof.mockResolvedValueOnce(undefined);
    await user.click(screen.getByRole('button', { name: /mark it/i }));
    await waitFor(() => expect(props.onClose).toHaveBeenCalled());
    expect(H.attachProof).toHaveBeenCalledTimes(2);
  });

  it('never frames the Proof as required for credit (flavour, not enforcement — ADR 0001)', () => {
    render(<ProofSheet {...baseProps()} />);
    expect(screen.queryByText(/required for credit/i)).toBeNull();
    expect(screen.queryByText(/must.*(prove|proof)/i)).toBeNull();
  });
});

describe('Board — proof-to-mark gating (ADR 0001: friction, not trust)', () => {
  const clickCell = (index: number) => {
    const cells = document.querySelectorAll('.grid .cell');
    fireEvent.click(cells[index]);
  };

  it('proof_required: tapping an unmarked Square opens ProofSheet and does NOT mark', async () => {
    H.event = { claimMode: 'proof_required' } as EventDoc;
    H.board = { uid: 'u1', seed: 1, createdAt: 0, cells: dealt() };

    render(<Board />);
    clickCell(0); // a non-free, unmarked Square

    expect(await screen.findByText(/proof for/i)).toBeInTheDocument();
    expect(H.setMark).not.toHaveBeenCalled(); // no Mark until a Proof is attached
  });

  it('proof_required: cancelling the sheet leaves the Square unmarked', async () => {
    const user = userEvent.setup();
    H.event = { claimMode: 'proof_required' } as EventDoc;
    H.board = { uid: 'u1', seed: 1, createdAt: 0, cells: dealt() };

    render(<Board />);
    clickCell(0);
    await screen.findByText(/proof for/i);

    await user.click(screen.getByRole('button', { name: /cancel/i }));

    await waitFor(() => expect(screen.queryByText(/proof for/i)).toBeNull());
    expect(H.setMark).not.toHaveBeenCalled();
    expect(H.attachProof).not.toHaveBeenCalled();
  });

  it('proof_required: unmarking an already-marked Square stays instant (no proof gate on unmark)', async () => {
    H.event = { claimMode: 'proof_required' } as EventDoc;
    const cells = dealt();
    cells[0] = { ...cells[0], marked: true, markedAt: 1, status: 'confirmed' };
    H.board = { uid: 'u1', seed: 1, createdAt: 0, cells };

    render(<Board />);
    clickCell(0);

    await waitFor(() => expect(H.setMark).toHaveBeenCalledTimes(1));
    expect(H.setMark.mock.calls[0][0]).toMatchObject({ index: 0, nextMarked: false });
    expect(screen.queryByText(/proof for/i)).toBeNull(); // no sheet on unmark
  });

  it('honor: tapping an unmarked Square marks directly with NO sheet (a Proof never gates credit)', async () => {
    H.event = { claimMode: 'honor' } as EventDoc;
    H.board = { uid: 'u1', seed: 1, createdAt: 0, cells: dealt() };

    render(<Board />);
    clickCell(0);

    await waitFor(() => expect(H.setMark).toHaveBeenCalledTimes(1));
    expect(H.setMark.mock.calls[0][0]).toMatchObject({ index: 0, nextMarked: true, claimMode: 'honor' });
    expect(screen.queryByText(/proof for/i)).toBeNull();
  });
});
