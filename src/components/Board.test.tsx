import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { BoardDoc, Cell, DayDef, EventDoc, PlayerDoc } from '../types';
import { ThemeProvider } from '../theme/ThemeContext';

// specs/d15-day-switcher.md: Board mounting the Day switcher (daily-cards-
// spec § "Day switcher") and the locked-Day preview (§ "Locked Day
// preview"). Covers the two invariants the AC section calls out: selecting
// a Day chip retints ONLY the board's own container — never `<html>`, which
// stays on the Player's own app-wide Theme (ThemeContext) — and a locked
// viewed Day renders a themed, blank 5x5 grid (only the free space
// populated) with the Theme's description and an "Unlocks…" badge, with NO
// write path (`setMark`) reachable from any of its Squares.

const H = vi.hoisted(() => ({
  user: { uid: 'u1', displayName: 'Deck Daddy', photoURL: null } as {
    uid: string;
    displayName: string | null;
    photoURL: string | null;
  },
  board: null as BoardDoc | null,
  player: null as PlayerDoc | null,
  event: null as EventDoc | null,
  setMark: vi.fn(),
  attachProof: vi.fn(),
  track: vi.fn(),
}));

vi.mock('../hooks/useData', () => ({
  useBoard: () => ({ data: H.board, loading: false, hasServerData: true }),
  // In daily mode Board reads the VIEWED Day's board here (#246). The suite's
  // fixtures set `H.board` with a `dayIndex` matching the viewed Day, so returning
  // it for any requested index renders that Day's card exactly as before.
  useDayBoard: () => ({ data: H.board, loading: false, hasServerData: true }),
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
vi.mock('../data/doubts', () => ({
  raiseDoubt: vi.fn(),
  openDoubts: () => [],
  doubtStatusFor: () => 'none',
}));
vi.mock('../data/api', () => ({
  setMark: H.setMark,
  // Lazy per-Day deal (#246): the suite pre-sets `H.board`, so the deal effect's
  // `if (board) return` guard short-circuits and this is never actually invoked;
  // stubbed so the import resolves.
  dealDayCard: vi.fn(() => Promise.resolve(false)),
  resolveDisplayName: (
    profile: { displayName?: unknown } | null | undefined,
    fallback: string | null | undefined,
  ) =>
    typeof profile?.displayName === 'string' && profile.displayName.trim().length > 0
      ? profile.displayName
      : (fallback ?? 'Anonymous'),
}));
vi.mock('../data/proofs', () => ({ attachProof: H.attachProof }));
vi.mock('../analytics', () => ({ track: H.track }));
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: H.user, loading: false, signIn: vi.fn(), signOutUser: vi.fn() }),
}));
// CoachOverlay (#214) imports EVENT_ID from '../firebase' — mocked so
// mounting Board here never touches the real Firebase app init.
vi.mock('../firebase', () => ({ EVENT_ID: 'test-event' }));

import Board from './Board';

const DAY_MS = 24 * 60 * 60 * 1000;

function dealt(pool = 'i'): Cell[] {
  return Array.from({ length: 25 }, (_, index) => ({
    index,
    itemId: index === 12 ? null : `${pool}${index}`,
    text: index === 12 ? 'FREE' : `Prompt ${pool}${index}`,
    free: index === 12,
    marked: index === 12,
    markedAt: null,
  }));
}

function day(overrides: Partial<DayDef> & Pick<DayDef, 'index' | 'unlockAt' | 'theme'>): DayDef {
  return {
    date: `2026-07-${String(15 + overrides.index).padStart(2, '0')}`,
    port: `Port ${overrides.index}`,
    portEmoji: '🇭🇷',
    pool: 'main',
    tutorial: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  H.user = { uid: 'u1', displayName: 'Deck Daddy', photoURL: null };
  H.event = { claimMode: 'honor', timezone: 'UTC', days: [] } as unknown as EventDoc;
  H.board = null;
  H.player = null;
  H.setMark.mockResolvedValue({ cells: [], bingo: false, blackout: false });
  H.attachProof.mockResolvedValue(undefined);
});

afterEach(() => {
  // ThemeProvider (mounted only by the retint test below) writes
  // `<html data-theme>` on mount — this repo's jsdom project leaves
  // `window.localStorage` unset (see src/theme/w1-themes.test.tsx), so
  // ThemeContext's own defensive try/catch handles persistence here; this
  // just resets the DOM side effect between tests.
  delete document.documentElement.dataset.theme;
});

describe('Day switcher retint', () => {
  it('selecting a Day chip sets data-theme on the board container only, never on <html> (the app-wide Theme is unchanged)', () => {
    const now = Date.now();
    H.event = {
      claimMode: 'honor',
      timezone: 'UTC',
      days: [
        day({ index: 0, theme: 'welcome-aboard', unlockAt: now - 3 * DAY_MS, tutorial: true, pool: 'embark' }),
        day({ index: 1, theme: 'get-sporty', unlockAt: now - 2 * DAY_MS }),
        day({ index: 2, theme: 'glamiators', unlockAt: now - 1 * DAY_MS }), // today
        day({ index: 3, theme: 'dog-tag', unlockAt: now + 1 * DAY_MS }), // locked
      ],
    } as unknown as EventDoc;
    H.board = { uid: 'u1', dayIndex: 2, seed: 1, createdAt: 0, cells: dealt() };

    render(
      <ThemeProvider>
        <Board />
      </ThemeProvider>,
    );

    // App-wide Theme, set by ThemeContext on <html>, defaults to neon-playground.
    expect(document.documentElement.getAttribute('data-theme')).toBe('neon-playground');
    // today's Day (index 2, glamiators) is the default-selected viewed Day.
    expect(document.querySelector('.board-area')?.getAttribute('data-theme')).toBe('glamiators');

    const chips = screen.getAllByRole('tab');
    fireEvent.click(chips[1]); // a past, unlocked Day — get-sporty

    expect(document.querySelector('.board-area')?.getAttribute('data-theme')).toBe('get-sporty');
    // The Player's own app-wide Theme choice never moves with the viewed Day.
    expect(document.documentElement.getAttribute('data-theme')).toBe('neon-playground');
  });
});

describe('Locked-Day preview', () => {
  it('renders a themed blank 5x5 grid (only the free space populated), the Theme description, and an Unlocks badge; a Square tap never calls setMark', () => {
    const now = Date.now();
    H.event = {
      claimMode: 'honor',
      timezone: 'UTC',
      days: [
        day({
          index: 0,
          theme: 'get-sporty',
          unlockAt: now + DAY_MS,
          freeText: 'A per-day free space override',
        }),
      ],
    } as unknown as EventDoc;
    H.board = null; // a locked Day never has a dealt Board

    render(<Board />);

    expect(screen.getByText(/unlocks/i)).toBeInTheDocument();
    // get-sporty's ThemeMeta description (src/theme/themes.ts), verbatim.
    expect(screen.getByText(/locker-room fantasy/i)).toBeInTheDocument();
    expect(screen.getByText('A per-day free space override')).toBeInTheDocument();

    // specs/d15-icons-lucide.md: the unlock badge shows a Lucide `Lock`
    // icon, not the `🔒` emoji.
    const lockBadge = document.querySelector('.day-lock-badge');
    expect(lockBadge?.querySelector('svg.day-lock-icon')).toBeTruthy();
    expect(lockBadge?.textContent).not.toContain('🔒');

    const lockedCells = document.querySelectorAll('.locked-grid .cell');
    expect(lockedCells).toHaveLength(25);
    // Only the center (free space) square carries text; the rest are blank.
    expect(lockedCells[12].textContent).toContain('A per-day free space override');
    expect(lockedCells[0].textContent?.trim()).toBe('');

    fireEvent.click(lockedCells[0]);
    fireEvent.click(lockedCells[12]);
    expect(H.setMark).not.toHaveBeenCalled();
  });
});

// specs/d15-tutorial-banners.md: Board mounts the tutorial banner + the
// "Warm-up" board-header tag above the grid, gated on the VIEWED Day's
// `tutorial` flag — an unlocked, dealt tutorial Day gets both; an unlocked
// main Day gets neither.
describe('Tutorial banner + board header', () => {
  it('mounts the embark banner and the "Warm-up" board-header tag on an unlocked Welcome Aboard Day', () => {
    const now = Date.now();
    H.event = {
      claimMode: 'honor',
      timezone: 'UTC',
      days: [day({ index: 0, theme: 'welcome-aboard', unlockAt: now - DAY_MS, tutorial: true, pool: 'embark' })],
    } as unknown as EventDoc;
    H.board = { uid: 'u1', dayIndex: 0, seed: 1, createdAt: 0, cells: dealt() };

    render(<Board />);

    expect(screen.getByText(/mark what happens/i)).toBeInTheDocument();
    expect(document.querySelector('.board-header')).not.toBeNull();
    expect(document.querySelector('.board-header')?.textContent).toContain('Warm-up');
  });

  it('renders neither the tutorial banner nor the board-header tag on an unlocked main Day', () => {
    const now = Date.now();
    H.event = {
      claimMode: 'honor',
      timezone: 'UTC',
      days: [day({ index: 2, theme: 'glamiators', unlockAt: now - DAY_MS })],
    } as unknown as EventDoc;
    H.board = { uid: 'u1', dayIndex: 2, seed: 1, createdAt: 0, cells: dealt() };

    render(<Board />);

    expect(screen.queryByText(/mark what happens/i)).not.toBeInTheDocument();
    expect(document.querySelector('.board-header')).toBeNull();
  });
});

// specs/d15-text-size.md (#215): the per-Square auto-fit guard always wins
// over the S/M/L base — a long prompt shrinks below the CSS-resolved
// ceiling rather than overflowing or clipping; a short one is left at the
// ceiling. jsdom reports 0x0 for every element and resolves no real
// stylesheet cascade, so both the cell's live box (`getBoundingClientRect`)
// and its CSS-resolved ceiling (`getComputedStyle(...).fontSize`, which
// would otherwise need index.css's `clamp()` + `--text-scale` actually
// applied) are stubbed to realistic values for these tests only.
describe('Text size auto-fit guard (specs/d15-text-size.md)', () => {
  const REALISTIC_CELL_SIZE = 70; // px — a typical on-screen phone Square (5-col grid, ~360px viewport)
  const CEILING_PX = 12; // px — the Large base's CSS-resolved ceiling

  function stubMeasurement() {
    const realGetComputedStyle = window.getComputedStyle;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: REALISTIC_CELL_SIZE,
      height: REALISTIC_CELL_SIZE,
      top: 0,
      left: 0,
      right: REALISTIC_CELL_SIZE,
      bottom: REALISTIC_CELL_SIZE,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element, pseudo?: string | null) => {
      if (el instanceof HTMLElement && el.classList.contains('cell-text')) {
        return { fontSize: `${CEILING_PX}px` } as CSSStyleDeclaration;
      }
      return realGetComputedStyle.call(window, el, pseudo ?? undefined);
    });
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shrinks a maximally long seeded prompt below the Large ceiling rather than overflowing its Square', () => {
    stubMeasurement();
    const now = Date.now();
    H.event = {
      claimMode: 'honor',
      timezone: 'UTC',
      days: [day({ index: 0, theme: 'glamiators', unlockAt: now - DAY_MS })],
    } as unknown as EventDoc;
    const cells = dealt();
    const longPrompt =
      'Convinced an entire pool deck of strangers to sing a full sea shanty together during the sail-away party while the DJ egged everyone on';
    cells[0] = { ...cells[0], text: longPrompt };
    H.board = { uid: 'u1', dayIndex: 0, seed: 1, createdAt: 0, cells };

    render(<Board />);

    const target = document.querySelector('.cell-text');
    expect(target).not.toBeNull();
    expect(target!.textContent).toBe(longPrompt);
    const shrunkSize = parseFloat((target as HTMLElement).style.fontSize);
    expect(shrunkSize).toBeGreaterThan(0);
    expect(shrunkSize).toBeLessThan(CEILING_PX);
  });

  it('leaves a short prompt at the ceiling, unshrunk', () => {
    stubMeasurement();
    const now = Date.now();
    H.event = {
      claimMode: 'honor',
      timezone: 'UTC',
      days: [day({ index: 0, theme: 'glamiators', unlockAt: now - DAY_MS })],
    } as unknown as EventDoc;
    const cells = dealt();
    cells[0] = { ...cells[0], text: 'Kissed a stranger' };
    H.board = { uid: 'u1', dayIndex: 0, seed: 1, createdAt: 0, cells };

    render(<Board />);

    const target = document.querySelector('.cell-text') as HTMLElement;
    expect(target.textContent).toBe('Kissed a stranger');
    expect(parseFloat(target.style.fontSize)).toBe(CEILING_PX);
  });
});

// --- #261: Feed → Board square-opening intent -------------------------------

import { requestOpenSquare, __resetOpenSquareForTests } from '../hooks/useOpenSquare';

describe('Feed → Board square-opening intent (#261)', () => {
  it('switches to the intended Day and opens the sheet on that Prompt, then clears the intent', () => {
    __resetOpenSquareForTests();
    const now = Date.now();
    H.event = {
      claimMode: 'honor',
      timezone: 'UTC',
      days: [
        day({ index: 0, theme: 'welcome-aboard', unlockAt: now - 2 * DAY_MS, tutorial: true, pool: 'embark' }),
        day({ index: 1, theme: 'get-sporty', unlockAt: now - DAY_MS }),
      ],
    } as unknown as EventDoc;
    // The suite's useDayBoard mock returns H.board for any requested Day; give
    // it the INTENDED Day's index so the switched view renders it.
    H.board = { uid: 'u1', dayIndex: 1, seed: 1, createdAt: 0, cells: dealt() };
    requestOpenSquare({ dayIndex: 1, itemId: 'i5' });

    render(<Board />);

    // The claim sheet opened on the intended Prompt (unmarked → pledge row).
    expect(screen.getByText(/Proof for/)).toBeInTheDocument();
    expect(screen.getByText(/Cross My Heart/)).toBeInTheDocument();
    __resetOpenSquareForTests();
  });

  it('drops the intent without opening anything when the Prompt is no longer on the card', () => {
    __resetOpenSquareForTests();
    const now = Date.now();
    H.event = {
      claimMode: 'honor',
      timezone: 'UTC',
      days: [day({ index: 0, theme: 'get-sporty', unlockAt: now - DAY_MS })],
    } as unknown as EventDoc;
    H.board = { uid: 'u1', dayIndex: 0, seed: 1, createdAt: 0, cells: dealt() };
    requestOpenSquare({ dayIndex: 0, itemId: 'not-on-this-card' });

    render(<Board />);

    expect(screen.queryByText(/Proof for/)).not.toBeInTheDocument();
    __resetOpenSquareForTests();
  });
});
