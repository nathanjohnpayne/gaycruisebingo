import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BoardDoc, Cell, EventDoc, PlayerDoc } from '../types';

// specs/w2-share-cards.md (issue #36): on-device Share Cards (BINGO +
// Leaderboard) rasterized with html-to-image and handed to the native share
// sheet, replacing the old text+URL-only navigator.share (ADR 0005 — no
// server render, no public URL). html-to-image's `toBlob` is the ONLY thing
// mocked at a module boundary (jsdom has no real canvas rasterizer); every
// other piece under test — ShareCard's DOM builders, shareCardBlob's
// fallback chain, and Celebration's/Leaderboard's own share handlers — runs
// for real, so the DOM node captured from `toBlob`'s call arguments below is
// always ShareCard's genuine output, never a stand-in.

const { toBlobMock } = vi.hoisted(() => ({ toBlobMock: vi.fn() }));
vi.mock('html-to-image', () => ({ toBlob: toBlobMock }));

const { track } = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock('../analytics', () => ({ track }));

// data/api.ts (Celebration's resolveDisplayName import) only needs a real
// Firestore CONNECTION for its read/write functions, none of which this
// suite calls — but it imports `../firebase` at module scope, so that alone
// needs a safe stand-in (mirrors the w2-feed-moments.test.tsx precedent).
vi.mock('../firebase', () => ({ db: {}, EVENT_ID: 'test-event' }));

type AuthUser = { uid: string; displayName: string | null; photoURL: string | null } | null;

const H = vi.hoisted(() => ({
  // Celebration's hooks.
  user: null as AuthUser,
  board: null as BoardDoc | null,
  player: null as PlayerDoc | null,
  event: null as EventDoc | null,
  // Leaderboard's hook.
  players: [] as PlayerDoc[],
  leaderboardLoading: false,
}));

vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user: H.user, loading: false }) }));
vi.mock('../hooks/useData', () => ({
  useBoard: () => ({ data: H.board, loading: false, hasServerData: true }),
  useMyPlayer: () => ({ data: H.player, loading: false, hasServerData: true }),
  useEventDoc: () => ({ data: H.event, loading: false }),
  useLeaderboard: () => ({ players: H.players, loading: H.leaderboardLoading }),
}));

import Celebration from './Celebration';
import Leaderboard from './Leaderboard';
import {
  renderBingoShareCard,
  renderLeaderboardShareCard,
  shareCardBlob,
  SHARE_CARD_APP_NAME,
  type LeaderboardShareRow,
} from './ShareCard';

// Same shape/rationale as w2-feed-moments.test.tsx's dealtWith: a dealt board
// with the free center (index 12) always on, plus whichever indices are
// explicitly marked.
function makeCells(marked: number[] = []): Cell[] {
  const on = new Set(marked);
  return Array.from({ length: 25 }, (_, index) => ({
    index,
    itemId: index === 12 ? null : `item-${index}`,
    text: index === 12 ? 'FREE' : `Prompt ${index}`,
    free: index === 12,
    marked: index === 12 || on.has(index),
    markedAt: index === 12 || on.has(index) ? 1 : null,
  }));
}

// Same shape as w2-leaderboard.test.tsx's mkPlayer.
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

function toBlobNode(): HTMLElement {
  return toBlobMock.mock.calls[0][0] as HTMLElement;
}

beforeEach(() => {
  toBlobMock.mockReset();
  toBlobMock.mockResolvedValue(new Blob(['fake-png-bytes'], { type: 'image/png' }));
  track.mockReset();
  H.user = null;
  H.board = null;
  H.player = null;
  H.event = null;
  H.players = [];
  H.leaderboardLoading = false;
});

afterEach(() => {
  Reflect.deleteProperty(window.navigator, 'share');
  Reflect.deleteProperty(window.navigator, 'canShare');
  Reflect.deleteProperty(window.navigator, 'clipboard');
});

// ---------------------------------------------------------------------------
// ShareCard — renderBingoShareCard
// ---------------------------------------------------------------------------

describe('ShareCard — renderBingoShareCard', () => {
  it('produces a non-empty blob and rasterizes at retina (3x) pixelRatio', async () => {
    const blob = await renderBingoShareCard({
      kind: 'bingo',
      playerName: 'Deck Daddy',
      eventName: 'Allure of the Seas',
      cells: makeCells(),
    });

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
    expect(toBlobMock).toHaveBeenCalledTimes(1);
    expect(toBlobMock.mock.calls[0][1]).toMatchObject({ pixelRatio: 3 });
  });

  it('the DOM node handed to html-to-image carries the player, event, title, and all 25 cells', async () => {
    await renderBingoShareCard({
      kind: 'bingo',
      playerName: 'Deck Daddy',
      eventName: 'Allure of the Seas',
      cells: makeCells(),
    });

    const node = toBlobNode();
    expect(node.textContent).toContain('Deck Daddy');
    expect(node.textContent).toContain('Allure of the Seas');
    expect(node.textContent).toContain('BINGO!');
    expect(node.querySelectorAll('.share-card-cell')).toHaveLength(25);
    expect(node.querySelector('.share-card-cell.free')).not.toBeNull();
  });

  it('shows BLACKOUT (not BINGO!) for a blackout win, and marks a marked non-free cell distinctly', async () => {
    await renderBingoShareCard({
      kind: 'blackout',
      playerName: 'Sam',
      eventName: 'E',
      cells: makeCells([0]),
    });

    const node = toBlobNode();
    expect(node.textContent).toContain('BLACKOUT');
    expect(node.textContent).not.toContain('BINGO!');
    // Index 12 (free) is always marked, plus the explicit index 0 above.
    expect(node.querySelectorAll('.share-card-cell.marked')).toHaveLength(2);
  });

  it('mounts the card off-screen for the render and tears the host down afterward', async () => {
    let hostSeenDuringRender: Element | null = null;
    toBlobMock.mockImplementationOnce(async () => {
      hostSeenDuringRender = document.querySelector('.share-card-host');
      return new Blob(['x'], { type: 'image/png' });
    });

    await renderBingoShareCard({ kind: 'bingo', playerName: 'A', eventName: 'E', cells: makeCells() });

    expect(hostSeenDuringRender).not.toBeNull();
    expect(document.querySelector('.share-card-host')).toBeNull();
  });

  it('rejects (and still tears the host down) when html-to-image cannot produce image data', async () => {
    toBlobMock.mockResolvedValueOnce(null);

    await expect(
      renderBingoShareCard({ kind: 'bingo', playerName: 'A', eventName: 'E', cells: makeCells() }),
    ).rejects.toThrow();
    expect(document.querySelector('.share-card-host')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ShareCard — renderLeaderboardShareCard
// ---------------------------------------------------------------------------

describe('ShareCard — renderLeaderboardShareCard', () => {
  const rows: LeaderboardShareRow[] = [
    {
      uid: 'top-dog',
      rank: 1,
      displayName: 'Top Dog',
      bingoCount: 3,
      squaresMarked: 20,
      blackout: true,
      firstToBingo: false,
    },
    {
      uid: 'early-bird',
      rank: 2,
      displayName: 'Early Bird',
      bingoCount: 2,
      squaresMarked: 15,
      blackout: false,
      firstToBingo: true,
    },
  ];

  it('produces a non-empty blob whose node lists the event name and one row per given Player', async () => {
    const blob = await renderLeaderboardShareCard({ eventName: 'Allure of the Seas', rows });

    expect(blob.size).toBeGreaterThan(0);
    const node = toBlobNode();
    expect(node.textContent).toContain('Allure of the Seas');
    expect(node.textContent).toContain('LEADERBOARD');
    expect(node.querySelectorAll('.share-card-row')).toHaveLength(2);
    expect(node.textContent).toContain('Top Dog');
    expect(node.textContent).toContain('BLACKOUT');
  });

  it('pins the "★ 1st BINGO" badge on exactly the row flagged firstToBingo', async () => {
    await renderLeaderboardShareCard({ eventName: 'E', rows });

    const node = toBlobNode();
    const pinned = node.querySelectorAll('.share-card-row.pinned');
    expect(pinned).toHaveLength(1);
    expect(pinned[0].textContent).toContain('Early Bird');
    expect(pinned[0].textContent).toContain('1st BINGO');

    const topDogRow = Array.from(node.querySelectorAll('.share-card-row')).find((r) =>
      r.textContent?.includes('Top Dog'),
    );
    expect(topDogRow).not.toHaveClass('pinned');
  });

  it('renders zero rows without crashing when given an empty row list', async () => {
    const blob = await renderLeaderboardShareCard({ eventName: 'E', rows: [] });

    expect(blob.size).toBeGreaterThan(0);
    expect(toBlobNode().querySelectorAll('.share-card-row')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// ShareCard — shareCardBlob (native share sheet + fallback chain)
// ---------------------------------------------------------------------------

describe('shareCardBlob — native share sheet + fallback chain', () => {
  const blob = new Blob(['fake-image-bytes'], { type: 'image/png' });

  function stubNavigator(overrides: {
    canShare?: (data: ShareData) => boolean;
    share?: (data: ShareData) => Promise<void>;
    clipboard?: { writeText: (text: string) => Promise<void> };
  }) {
    if (overrides.canShare) {
      Object.defineProperty(window.navigator, 'canShare', { value: overrides.canShare, configurable: true });
    }
    if (overrides.share) {
      Object.defineProperty(window.navigator, 'share', { value: overrides.share, configurable: true });
    }
    if (overrides.clipboard) {
      Object.defineProperty(window.navigator, 'clipboard', { value: overrides.clipboard, configurable: true });
    }
  }

  it('shares the image via navigator.share({ files }) when canShare reports true', async () => {
    const shareMock = vi.fn().mockResolvedValue(undefined);
    const canShareMock = vi.fn().mockReturnValue(true);
    stubNavigator({ canShare: canShareMock, share: shareMock });

    const outcome = await shareCardBlob({
      blob,
      filename: 'card.png',
      title: 'T',
      text: 'body',
      url: 'https://x.test',
    });

    expect(outcome).toBe('files');
    expect(canShareMock).toHaveBeenCalledWith({ files: [expect.any(File)] });
    expect(shareMock).toHaveBeenCalledTimes(1);
    const shareArg = shareMock.mock.calls[0][0];
    expect(shareArg).toMatchObject({ title: 'T', text: 'body' });
    expect(shareArg.files).toHaveLength(1);
    expect(shareArg.files[0]).toBeInstanceOf(File);
    expect(shareArg.files[0].name).toBe('card.png');
  });

  it('stops at "cancelled" when the native file share throws — no further fallback', async () => {
    const shareMock = vi.fn().mockRejectedValue(Object.assign(new Error('cancel'), { name: 'AbortError' }));
    const clipboardMock = vi.fn();
    stubNavigator({ canShare: () => true, share: shareMock, clipboard: { writeText: clipboardMock } });

    const outcome = await shareCardBlob({
      blob,
      filename: 'card.png',
      title: 'T',
      text: 'body',
      url: 'https://x.test',
    });

    expect(outcome).toBe('cancelled');
    expect(clipboardMock).not.toHaveBeenCalled();
  });

  it('falls back to a text/URL share when file sharing is unsupported', async () => {
    const shareMock = vi.fn().mockResolvedValue(undefined);
    stubNavigator({ share: shareMock }); // no canShare at all

    const outcome = await shareCardBlob({
      blob,
      filename: 'card.png',
      title: 'T',
      text: 'body',
      url: 'https://x.test',
    });

    expect(outcome).toBe('text');
    expect(shareMock).toHaveBeenCalledWith({ title: 'T', text: 'body', url: 'https://x.test' });
  });

  it('falls back to the clipboard when there is no Web Share API at all', async () => {
    const clipboardMock = vi.fn().mockResolvedValue(undefined);
    stubNavigator({ clipboard: { writeText: clipboardMock } });

    const outcome = await shareCardBlob({
      blob,
      filename: 'card.png',
      title: 'T',
      text: 'body',
      url: 'https://x.test',
    });

    expect(outcome).toBe('clipboard');
    expect(clipboardMock).toHaveBeenCalledWith('https://x.test');
  });

  it('falls back to a direct download as the last resort', async () => {
    (globalThis.URL as unknown as { createObjectURL: () => string }).createObjectURL = () => 'blob:mock';
    (globalThis.URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    // No `url` — proves the download leg does not depend on the clipboard leg
    // having been skippable only because a URL happened to be present.
    const outcome = await shareCardBlob({ blob, filename: 'card.png', title: 'T', text: 'body' });

    expect(outcome).toBe('download');
    expect(clickSpy).toHaveBeenCalledTimes(1);
    clickSpy.mockRestore();
  });

  it('returns "none" when there is no image, no Share API, and no Clipboard API', async () => {
    const outcome = await shareCardBlob({ blob: null, filename: 'card.png', title: 'T', text: 'body' });
    expect(outcome).toBe('none');
  });
});

// ---------------------------------------------------------------------------
// Celebration — image share + fallback
// ---------------------------------------------------------------------------

describe('Celebration — image share + fallback', () => {
  beforeEach(() => {
    H.user = { uid: 'u1', displayName: 'Google Name', photoURL: null };
    H.board = { uid: 'u1', seed: 1, createdAt: 0, cells: makeCells([0, 1, 2]) };
    H.player = {
      uid: 'u1',
      displayName: 'Deck Daddy',
      photoURL: null,
      joinedAt: 0,
      bingoCount: 1,
      squaresMarked: 3,
      firstBingoAt: 1000,
    };
    H.event = { name: 'Allure of the Seas' } as EventDoc;
  });

  it('renders the real BINGO card and shares it via navigator.share({ files }) when canShare reports true', async () => {
    const shareMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'canShare', { value: () => true, configurable: true });
    Object.defineProperty(window.navigator, 'share', { value: shareMock, configurable: true });
    const user = userEvent.setup();

    render(<Celebration kind="bingo" onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Share' }));

    await waitFor(() => expect(shareMock).toHaveBeenCalledTimes(1));
    const shareArg = shareMock.mock.calls[0][0];
    expect(shareArg.files).toHaveLength(1);

    // The node handed to html-to-image is ShareCard's REAL output (this
    // suite never mocks ./ShareCard), carrying the Player/Event name
    // resolved from the mocked board/player/event/auth hooks above.
    const node = toBlobNode();
    expect(node.textContent).toContain('Deck Daddy');
    expect(node.textContent).toContain('Allure of the Seas');
    expect(node.querySelectorAll('.share-card-cell')).toHaveLength(25);

    await waitFor(() => expect(track).toHaveBeenCalledWith('share_click', { surface: 'celebration' }));
    expect(track).toHaveBeenCalledTimes(1);
  });

  it('falls back to a text/URL share when file sharing is unsupported, and still fires share_click', async () => {
    const shareMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'share', { value: shareMock, configurable: true }); // no canShare
    const user = userEvent.setup();

    render(<Celebration kind="blackout" onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Share' }));

    await waitFor(() => expect(shareMock).toHaveBeenCalledTimes(1));
    const shareArg = shareMock.mock.calls[0][0];
    expect(shareArg.files).toBeUndefined();
    expect(shareArg.url).toBe(window.location.origin);
    expect(shareArg.text).toMatch(/BLACKOUT/i);

    await waitFor(() => expect(track).toHaveBeenCalledWith('share_click', { surface: 'celebration' }));
    expect(track).toHaveBeenCalledTimes(1);
  });

  it('fires share_click exactly once, and still falls back to a text/URL share, when the on-device render itself fails', async () => {
    toBlobMock.mockRejectedValueOnce(new Error('rasterize failed'));
    const shareMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'share', { value: shareMock, configurable: true });
    const user = userEvent.setup();

    render(<Celebration kind="bingo" onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Share' }));

    await waitFor(() => expect(track).toHaveBeenCalledTimes(1));
    expect(track).toHaveBeenCalledWith('share_click', { surface: 'celebration' });
    expect(shareMock).toHaveBeenCalledWith(expect.objectContaining({ url: window.location.origin }));
  });

  it('falls back to the app name on the card when the Event has not loaded yet', async () => {
    H.event = null;
    Object.defineProperty(window.navigator, 'canShare', { value: () => true, configurable: true });
    Object.defineProperty(window.navigator, 'share', { value: vi.fn().mockResolvedValue(undefined), configurable: true });
    const user = userEvent.setup();

    render(<Celebration kind="bingo" onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Share' }));

    await waitFor(() => expect(toBlobMock).toHaveBeenCalledTimes(1));
    // Assert on the `.share-card-event` node specifically, not just
    // `textContent` at large — the card's footer always renders
    // `${SHARE_CARD_APP_NAME} 🚢` regardless of `eventName`, so a whole-node
    // substring check would pass even if the eventName fallback were broken.
    expect(toBlobNode().querySelector('.share-card-event')?.textContent).toBe(SHARE_CARD_APP_NAME);
  });

  it('"Keep playing" closes without generating or sharing a card', async () => {
    const shareMock = vi.fn();
    Object.defineProperty(window.navigator, 'share', { value: shareMock, configurable: true });
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(<Celebration kind="bingo" onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: 'Keep playing' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(shareMock).not.toHaveBeenCalled();
    expect(toBlobMock).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Leaderboard — share affordance
// ---------------------------------------------------------------------------

describe('Leaderboard — share affordance', () => {
  const topDog = mkPlayer({
    uid: 'top-dog',
    displayName: 'Top Dog',
    bingoCount: 5,
    squaresMarked: 20,
    firstBingoAt: 9000,
  });
  const earlyBird = mkPlayer({
    uid: 'early-bird',
    displayName: 'Early Bird',
    bingoCount: 4,
    squaresMarked: 18,
    firstBingoAt: 1000,
  });

  beforeEach(() => {
    H.players = [topDog, earlyBird];
    H.event = { name: 'Allure of the Seas' } as EventDoc;
  });

  it('renders a "Share leaderboard" button', () => {
    render(<Leaderboard />);
    expect(screen.getByRole('button', { name: 'Share leaderboard' })).toBeInTheDocument();
  });

  it('clicking Share renders the real Leaderboard card and fires share_click', async () => {
    const shareMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'canShare', { value: () => true, configurable: true });
    Object.defineProperty(window.navigator, 'share', { value: shareMock, configurable: true });
    const user = userEvent.setup();

    render(<Leaderboard />);
    await user.click(screen.getByRole('button', { name: 'Share leaderboard' }));

    await waitFor(() => expect(shareMock).toHaveBeenCalledTimes(1));
    const node = toBlobNode();
    expect(node.textContent).toContain('Allure of the Seas');
    expect(node.textContent).toContain('Top Dog');
    expect(node.textContent).toContain('Early Bird');
    // Early Bird has the earliest firstBingoAt (1000 < 9000) — the same
    // Player the on-screen "1st BINGO" badge pins.
    const pinned = node.querySelectorAll('.share-card-row.pinned');
    expect(pinned).toHaveLength(1);
    expect(pinned[0].textContent).toContain('Early Bird');

    await waitFor(() => expect(track).toHaveBeenCalledWith('share_click', { surface: 'leaderboard' }));
    expect(track).toHaveBeenCalledTimes(1);
  });

  it('includes the First to BINGO Player on the card even when their rank falls outside the top 8', async () => {
    // 9 Players, already in rank order (bingos desc): topDog, 7 "Mid"
    // Players tied at 4 bingos, then Late Bloomer — who has the fewest
    // bingos (rank #9, outside the card's top-8 slice) but the EARLIEST
    // firstBingoAt of anyone, so they still hold the pin.
    const mids = Array.from({ length: 7 }, (_, i) =>
      mkPlayer({ uid: `mid-${i}`, displayName: `Mid ${i}`, bingoCount: 4, squaresMarked: 10, firstBingoAt: 5000 + i }),
    );
    const lateBloomer = mkPlayer({
      uid: 'late-bloomer',
      displayName: 'Late Bloomer',
      bingoCount: 1,
      squaresMarked: 2,
      firstBingoAt: 100,
    });
    H.players = [topDog, ...mids, lateBloomer];
    const shareMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'canShare', { value: () => true, configurable: true });
    Object.defineProperty(window.navigator, 'share', { value: shareMock, configurable: true });
    const user = userEvent.setup();

    render(<Leaderboard />);
    await user.click(screen.getByRole('button', { name: 'Share leaderboard' }));

    await waitFor(() => expect(shareMock).toHaveBeenCalledTimes(1));
    const node = toBlobNode();
    // Top 8 by rank + Late Bloomer appended as the 9th, pinned row.
    expect(node.querySelectorAll('.share-card-row')).toHaveLength(9);
    const pinned = node.querySelectorAll('.share-card-row.pinned');
    expect(pinned).toHaveLength(1);
    expect(pinned[0].textContent).toContain('Late Bloomer');
  });

  it('shares the FULL standings even while a filter narrows the on-screen list', async () => {
    const shareMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'canShare', { value: () => true, configurable: true });
    Object.defineProperty(window.navigator, 'share', { value: shareMock, configurable: true });
    const user = userEvent.setup();

    render(<Leaderboard />);
    await user.click(screen.getByRole('button', { name: 'Blackout' })); // neither fixture Player has one
    expect(screen.getByText(/no one matches this filter/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Share leaderboard' }));

    await waitFor(() => expect(shareMock).toHaveBeenCalledTimes(1));
    // Both Players appear on the shared card even though the ON-SCREEN
    // filter is currently showing neither.
    expect(toBlobNode().querySelectorAll('.share-card-row')).toHaveLength(2);
  });

  it('falls back to a text/URL share when file sharing is unsupported, and still fires share_click', async () => {
    const shareMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'share', { value: shareMock, configurable: true }); // no canShare
    const user = userEvent.setup();

    render(<Leaderboard />);
    await user.click(screen.getByRole('button', { name: 'Share leaderboard' }));

    await waitFor(() => expect(shareMock).toHaveBeenCalled());
    const shareArg = shareMock.mock.calls[0][0];
    expect(shareArg.files).toBeUndefined();
    expect(shareArg.url).toBe(window.location.origin);

    await waitFor(() => expect(track).toHaveBeenCalledWith('share_click', { surface: 'leaderboard' }));
  });
});
