import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { User } from 'firebase/auth';
import type { BoardDoc, EventDoc, ItemDoc, PlayerDoc } from '../types';

// Covers specs/w1-board-deal-join.md: Board render (24 sampled Prompts + the
// always-marked "Complain about Circuit Music" Free Space centre, no re-deal /
// Square-swap — ADR 0003), the Board-side pool<MIN_POOL deal guard (ADR 0004),
// and `joinAndDeal` freeze-at-join semantics (deal once; re-joining never
// re-deals; a thin pool never persists a blank Board).

// Hoisted so the vi.mock factories (Vitest lifts them above the imports) can
// close over the same mutable fixtures and spies the test bodies drive.
const H = vi.hoisted(() => ({
  authUser: null as User | null,
  data: {
    board: null as BoardDoc | null,
    boardLoading: false,
    player: null as PlayerDoc | null,
    event: null as EventDoc | null,
    items: [] as ItemDoc[],
    poolLoading: false,
  },
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  batchSet: vi.fn(),
  batchCommit: vi.fn(async () => {}),
}));

// Neutralize Firebase init (firebase.ts calls initializeApp at import) and the
// Firestore SDK so `../data/api` (real) exercises its freeze/deal logic against
// controllable stubs rather than a live backend.
vi.mock('../firebase', () => ({
  db: {},
  EVENT_ID: 'test-event',
  storage: {},
  auth: {},
  googleProvider: {},
  analytics: null,
}));

vi.mock('firebase/firestore', () => {
  const makeRef = (kind: string, args: unknown[]) => {
    const ref: Record<string, unknown> = { kind, args };
    ref.withConverter = () => ref; // paths.ts chains .withConverter on refs
    return ref;
  };
  return {
    doc: (...args: unknown[]) => makeRef('doc', args),
    collection: (...args: unknown[]) => makeRef('collection', args),
    query: (...args: unknown[]) => ({ query: args }),
    where: (...args: unknown[]) => ({ where: args }),
    getDoc: H.getDoc,
    getDocs: H.getDocs,
    writeBatch: () => ({ set: H.batchSet, commit: H.batchCommit }),
    addDoc: vi.fn(),
    increment: vi.fn(),
    runTransaction: vi.fn(),
    setDoc: vi.fn(),
    updateDoc: vi.fn(),
    deleteDoc: vi.fn(),
    onSnapshot: vi.fn(),
    serverTimestamp: vi.fn(),
    getFirestore: vi.fn(),
  };
});

vi.mock('../analytics', () => ({ track: vi.fn() }));

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: H.authUser, loading: false, signIn: vi.fn(), signOutUser: vi.fn() }),
}));

// Inject Board's live data through the hooks so the render test drives a real
// dealt Board (and the guard's thin-pool path) without a Firestore listener.
vi.mock('../hooks/useData', () => ({
  useBoard: () => ({ data: H.data.board, loading: H.data.boardLoading }),
  useMyPlayer: () => ({ data: H.data.player, loading: false }),
  useEventDoc: () => ({ data: H.data.event, loading: false }),
  useItems: () => ({ items: H.data.items, loading: H.data.poolLoading }),
}));

// Real modules under test — imported after the mocks are declared.
import Board from './Board';
import { joinAndDeal } from '../data/api';
import { dealBoard, MIN_POOL, CENTER, type DealItem } from '../game/logic';
import { FREE_TEXT, SEED_ITEMS } from '../data/seed';

const SIGNED_IN = { uid: 'sailor-1', displayName: 'Sailor', photoURL: null } as unknown as User;

function mkItem(id: string, isFreeSpace = false): ItemDoc {
  return {
    id,
    text: isFreeSpace ? FREE_TEXT : `prompt ${id}`,
    createdBy: 'seed',
    createdAt: 0,
    isFreeSpace,
    status: 'active',
    reportCount: 0,
  };
}

const activeItems = (n: number): ItemDoc[] => Array.from({ length: n }, (_, i) => mkItem(`a${i}`));

const dealPool: DealItem[] = SEED_ITEMS.map((text, i) => ({ id: `seed${i}`, text }));

beforeEach(() => {
  H.authUser = SIGNED_IN;
  H.data.board = null;
  H.data.boardLoading = false;
  H.data.player = null;
  H.data.event = null;
  H.data.items = [];
  H.data.poolLoading = false;
  H.getDoc.mockReset();
  H.getDocs.mockReset();
  H.batchSet.mockReset();
  H.batchCommit.mockReset();
  H.batchCommit.mockResolvedValue(undefined);
});

describe('Board render', () => {
  it('renders 25 Squares with the Free Space centre marked and reading FREE', () => {
    const cells = dealBoard(dealPool, FREE_TEXT, 20260707);
    H.data.board = { uid: SIGNED_IN.uid, seed: 20260707, createdAt: 0, cells };

    const { container } = render(<Board />);

    expect(container.querySelectorAll('.cell')).toHaveLength(25);
    const free = container.querySelectorAll('.cell.free');
    expect(free).toHaveLength(1); // exactly one Free Space
    expect(container.querySelectorAll('.grid .cell')[CENTER]).toHaveClass('free');
    expect(free[0]).toHaveTextContent('FREE');
    expect(free[0]).toHaveClass('marked'); // the centre is always marked
  });

  it('exposes no re-deal / Square-swap affordance (ADR 0003)', () => {
    const cells = dealBoard(dealPool, FREE_TEXT, 11);
    H.data.board = { uid: SIGNED_IN.uid, seed: 11, createdAt: 0, cells };

    render(<Board />);

    const reDeal = /re-?deal|deal again|shuffle|swap|redraw|re-?roll|new card|regenerate/i;
    expect(screen.queryByRole('button', { name: reDeal })).toBeNull();
    expect(screen.queryByText(reDeal)).toBeNull();
    // A freshly dealt card (only the free centre marked) surfaces no controls at
    // all — no proof buttons, and certainly no re-deal button.
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});

describe('Board deal guard (ADR 0004)', () => {
  it('surfaces the guard, not a blank card, when the active pool is < MIN_POOL', () => {
    H.data.board = null;
    H.data.items = activeItems(MIN_POOL - 1); // 23 — one short
    H.data.poolLoading = false;

    render(<Board />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/not enough prompts/i);
    expect(alert).toHaveTextContent(String(MIN_POOL));
    expect(screen.queryByText(/dealing your card/i)).toBeNull();
  });

  it('excludes the Free Space item when counting the pool against MIN_POOL', () => {
    H.data.board = null;
    // 23 real Prompts + a Free Space item = 24 items, but only 23 count toward
    // the deal floor, so the guard must still fire.
    H.data.items = [...activeItems(MIN_POOL - 1), mkItem('free', true)];
    H.data.poolLoading = false;

    render(<Board />);

    expect(screen.getByRole('alert')).toHaveTextContent(/not enough prompts/i);
  });

  it('suppresses the guard while the board is still loading (returning player, thin pool)', () => {
    // A returning Player who already has a dealt board, fetched while the pool
    // has since gone < MIN_POOL: the board load must win over the thin-pool
    // guard so the guard never flashes before the board resolves.
    H.data.board = null;
    H.data.boardLoading = true;
    H.data.items = activeItems(MIN_POOL - 1);
    H.data.poolLoading = false;

    render(<Board />);

    expect(screen.getByText(/dealing your card/i)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the neutral dealing state (no guard) while the pool is loading', () => {
    H.data.board = null;
    H.data.items = [];
    H.data.poolLoading = true; // count unknown — must not false-positive the guard

    render(<Board />);

    expect(screen.getByText(/dealing your card/i)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the neutral dealing state (no guard) for a healthy pool mid-deal', () => {
    H.data.board = null;
    H.data.items = activeItems(MIN_POOL + 6); // healthy — a deal is simply in flight
    H.data.poolLoading = false;

    render(<Board />);

    expect(screen.getByText(/dealing your card/i)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('joinAndDeal freeze-at-join', () => {
  it('does not re-deal when a Board already exists for the uid', async () => {
    H.getDoc.mockResolvedValueOnce({ exists: () => true });

    await joinAndDeal(SIGNED_IN);

    expect(H.getDocs).not.toHaveBeenCalled(); // never reads the pool
    expect(H.batchSet).not.toHaveBeenCalled(); // never re-writes the Board
    expect(H.batchCommit).not.toHaveBeenCalled();
  });

  it('deals once from the active non-free pool (24 Prompts + marked Free Space)', async () => {
    H.getDoc.mockResolvedValueOnce({ exists: () => false });
    const docs = [...activeItems(30), mkItem('free', true)].map((it) => ({ data: () => it }));
    H.getDocs.mockResolvedValueOnce({ docs });

    await joinAndDeal(SIGNED_IN);

    expect(H.getDocs).toHaveBeenCalledTimes(1);
    expect(H.batchCommit).toHaveBeenCalledTimes(1);
    const boardWrite = H.batchSet.mock.calls[0][1] as BoardDoc;
    expect(boardWrite.cells).toHaveLength(25);
    expect(boardWrite.cells[CENTER]).toMatchObject({ free: true, marked: true, text: FREE_TEXT });
    const dealtIds = boardWrite.cells.filter((c) => !c.free).map((c) => c.itemId);
    expect(dealtIds).toHaveLength(24);
    expect(dealtIds).not.toContain('free'); // the Free Space item is never sampled
  });

  it('propagates the pool<MIN_POOL guard and never persists a blank Board', async () => {
    H.getDoc.mockResolvedValueOnce({ exists: () => false });
    const docs = activeItems(MIN_POOL - 1).map((it) => ({ data: () => it }));
    H.getDocs.mockResolvedValueOnce({ docs });

    await expect(joinAndDeal(SIGNED_IN)).rejects.toThrow(/at least 24 prompts/);
    expect(H.batchCommit).not.toHaveBeenCalled(); // no broken Board written
  });
});
