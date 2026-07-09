import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Cell, EventDoc, PlayerDoc } from '../types';

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
  player: null as PlayerDoc | null,
  event: null as EventDoc | null,
  // Leaderboard's hook.
  players: [] as PlayerDoc[],
  leaderboardLoading: false,
}));

vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user: H.user, loading: false }) }));
vi.mock('../hooks/useData', () => ({
  // Celebration no longer calls useBoard (Codex P2, PR #111 finding 1) — it
  // takes `cells` as a prop instead, fed straight into every render below.
  // This stub permanently reports NO data (never `H`-configurable) so that
  // if a future change reintroduces a `useBoard(uid)` read inside
  // Celebration, the empty-card race this fixed comes back immediately and
  // loudly in the "fast-tap" regression test below, instead of silently
  // passing because the mock happened to have real board data queued.
  useBoard: () => ({ data: null, loading: true, hasServerData: false }),
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

  // Codex P2, PR #111 finding 1 — validity gate: refuse anything but a real
  // 25-cell board (free center + 24 prompts, dealBoard's own invariant)
  // rather than ever rasterizing a partial/empty grid.
  it('refuses to render — and never touches html-to-image — when cells is not exactly 25 entries', async () => {
    await expect(
      renderBingoShareCard({ kind: 'bingo', playerName: 'A', eventName: 'E', cells: [] }),
    ).rejects.toThrow(/25 cells/);

    expect(toBlobMock).not.toHaveBeenCalled();
    expect(document.querySelector('.share-card-host')).toBeNull();
  });

  it('refuses a partial (24-cell) board the same way as an empty one', async () => {
    await expect(
      renderBingoShareCard({ kind: 'bingo', playerName: 'A', eventName: 'E', cells: makeCells().slice(0, 24) }),
    ).rejects.toThrow(/25 cells/);

    expect(toBlobMock).not.toHaveBeenCalled();
  });

  // Codex P2, PR #111 finding 2 — a marked-but-unconfirmed square
  // (admin_confirmed claim mode) must not render as an indistinguishable
  // solid win square: game/logic.ts's markedMask already excludes
  // status: 'pending' from counting as "on" (hasBingo/isBlackout/
  // countMarked), so the card must not visually overstate it either.
  it('renders a pending mark distinctly from a confirmed mark', async () => {
    const cells = makeCells([0, 1]).map((c) => {
      if (c.index === 0) return { ...c, status: 'confirmed' as const };
      if (c.index === 1) return { ...c, status: 'pending' as const };
      return c;
    });

    await renderBingoShareCard({ kind: 'bingo', playerName: 'A', eventName: 'E', cells });

    const node = toBlobNode();
    const confirmedCell = node.querySelectorAll('.share-card-cell')[0];
    const pendingCell = node.querySelectorAll('.share-card-cell')[1];
    expect(confirmedCell).toHaveClass('share-card-cell', 'marked');
    expect(confirmedCell).not.toHaveClass('pending');
    expect(pendingCell).toHaveClass('share-card-cell', 'marked', 'pending');
  });
});

// ---------------------------------------------------------------------------
// ShareCard CSS — .share-card-title uses the theme ink token, not a
// hardcoded hex (Codex P2, PR #111 finding 4). jsdom never loads
// src/index.css into the document (no external stylesheet fetch), so — same
// technique as src/theme/w1-themes.test.tsx and src/og-theme-parity.test.ts
// — this reads the actual rule straight out of the CSS source rather than
// asserting on a jsdom `getComputedStyle` that would never reflect it.
// ---------------------------------------------------------------------------

// `join(dirname(fileURLToPath(import.meta.url)), ...)` rather than
// `new URL('../index.css', import.meta.url)` — src/theme/w1-themes.test.tsx's
// own precedent/warning: Vite statically rewrites that literal two-argument
// form into a dev-server asset URL, which isn't a file:// URL under Vitest.
const indexCssPath = join(dirname(fileURLToPath(import.meta.url)), '../index.css');
const indexCss = readFileSync(indexCssPath, 'utf8');

describe('ShareCard CSS — .share-card-title contrast', () => {
  it('fills the title with var(--ink), not a hardcoded hex', () => {
    // Hardcoded #fff was invisible against summer-white's light --bg — the
    // same failure specs/og-theme-parity.md/issue #71 already fixed for the
    // OG renderer's own `.title` rule by following the theme ink instead.
    const rule = indexCss.match(/\.share-card-title\s*\{([^}]*)\}/);
    expect(rule, '.share-card-title rule not found in src/index.css').not.toBeNull();
    expect(rule![1]).toMatch(/color:\s*var\(--ink\)/);
    expect(rule![1]).not.toMatch(/color:\s*#fff/);
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

  // Codex P2, PR #111 finding 3: the text/URL leg (reached when file
  // sharing is unsupported) used to catch EVERY rejection — including a
  // genuine AbortError cancellation — and unconditionally fall through to
  // the clipboard/download legs, silently clobbering the clipboard right
  // after the Player dismissed the share sheet. It now stops on a
  // cancellation, same as the file leg above.
  it('stops the chain (no clipboard write) when the text/URL share is cancelled (AbortError)', async () => {
    const shareMock = vi.fn().mockRejectedValue(Object.assign(new Error('cancel'), { name: 'AbortError' }));
    const clipboardMock = vi.fn();
    stubNavigator({ share: shareMock, clipboard: { writeText: clipboardMock } }); // no canShare -> text leg

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

  it('falls through to the clipboard when the text/URL share fails for a reason other than cancellation', async () => {
    const shareMock = vi.fn().mockRejectedValue(new Error('some genuine failure'));
    const clipboardMock = vi.fn().mockResolvedValue(undefined);
    stubNavigator({ share: shareMock, clipboard: { writeText: clipboardMock } });

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
  // Board.tsx's own `cells` at the moment it opens the modal (Codex P2, PR
  // #111 finding 1) — passed straight in as a prop below, exactly like
  // Board.tsx now does, rather than resolved through a listener.
  const cells = makeCells([0, 1, 2]);

  beforeEach(() => {
    H.user = { uid: 'u1', displayName: 'Google Name', photoURL: null };
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

    render(<Celebration kind="bingo" cells={cells} onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Share' }));

    await waitFor(() => expect(shareMock).toHaveBeenCalledTimes(1));
    const shareArg = shareMock.mock.calls[0][0];
    expect(shareArg.files).toHaveLength(1);

    // The node handed to html-to-image is ShareCard's REAL output (this
    // suite never mocks ./ShareCard), carrying the Player/Event name
    // resolved from the mocked player/event/auth hooks above.
    const node = toBlobNode();
    expect(node.textContent).toContain('Deck Daddy');
    expect(node.textContent).toContain('Allure of the Seas');
    expect(node.querySelectorAll('.share-card-cell')).toHaveLength(25);

    await waitFor(() => expect(track).toHaveBeenCalledWith('share_click', { surface: 'celebration' }));
    expect(track).toHaveBeenCalledTimes(1);
  });

  // Codex P2, PR #111 finding 1 (regression): Celebration used to open its
  // OWN useBoard(uid) listener, which — per the permanently-empty stub in
  // the ../hooks/useData mock above — never resolves any data. Had that code
  // path survived this fix, `board?.cells ?? []` would be `[]` here and the
  // card would share a ZERO-cell grid despite the Share tap happening
  // "instantly" (no waiting on any async board load). It shares the FULL
  // grid because `cells` now comes from the prop, available synchronously
  // from the very first render — there is no listener left to race.
  it('renders the full 25-cell grid on an immediate Share tap, even though useBoard reports no data', async () => {
    const shareMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'canShare', { value: () => true, configurable: true });
    Object.defineProperty(window.navigator, 'share', { value: shareMock, configurable: true });
    const user = userEvent.setup();

    render(<Celebration kind="bingo" cells={cells} onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Share' }));

    await waitFor(() => expect(shareMock).toHaveBeenCalledTimes(1));
    expect(toBlobNode().querySelectorAll('.share-card-cell')).toHaveLength(25);
    expect(shareMock.mock.calls[0][0].files).toHaveLength(1);
  });

  // Codex P2, PR #111 finding 1: the renderer's validity gate is the
  // backstop for any other way an incomplete board could reach Celebration.
  it('falls back to a text/URL share — never attempts an image share — when handed an invalid (non-25-cell) board', async () => {
    const shareMock = vi.fn().mockResolvedValue(undefined);
    // canShare would greenlight a FILE share if a blob existed — proves the
    // fallback below happens because no blob was ever produced, not because
    // canShare said no.
    Object.defineProperty(window.navigator, 'canShare', { value: () => true, configurable: true });
    Object.defineProperty(window.navigator, 'share', { value: shareMock, configurable: true });
    const user = userEvent.setup();

    render(<Celebration kind="bingo" cells={[]} onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Share' }));

    await waitFor(() => expect(shareMock).toHaveBeenCalledTimes(1));
    expect(toBlobMock).not.toHaveBeenCalled(); // no rasterization ever attempted
    const shareArg = shareMock.mock.calls[0][0];
    expect(shareArg.files).toBeUndefined(); // text/URL leg, not the files leg
    expect(shareArg.url).toBe(window.location.origin);

    await waitFor(() => expect(track).toHaveBeenCalledWith('share_click', { surface: 'celebration' }));
  });

  it('falls back to a text/URL share when file sharing is unsupported, and still fires share_click', async () => {
    const shareMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'share', { value: shareMock, configurable: true }); // no canShare
    const user = userEvent.setup();

    render(<Celebration kind="blackout" cells={cells} onClose={vi.fn()} />);
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

    render(<Celebration kind="bingo" cells={cells} onClose={vi.fn()} />);
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

    render(<Celebration kind="bingo" cells={cells} onClose={vi.fn()} />);
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

    render(<Celebration kind="bingo" cells={cells} onClose={onClose} />);
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
