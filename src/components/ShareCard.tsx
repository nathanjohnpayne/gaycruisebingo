import { toBlob } from 'html-to-image';
import type { Cell } from '../types';

/**
 * On-device Share Card renderer (ADR 0005, issue #36). Given a BINGO/Blackout
 * win or a Leaderboard snapshot, builds a real (off-screen) DOM node styled
 * with the app's own CSS classes — so it automatically inherits whichever
 * [data-theme] palette is currently applied to <html> (theme/ThemeContext.tsx)
 * — then rasterizes it with html-to-image into a retina PNG blob ready for
 * `navigator.share({ files })`. Everything happens on the Player's own
 * device: no server render, no public URL (ADR 0005). `shareCardBlob` below
 * hands that blob to the native share sheet, or degrades through a fallback
 * chain when the platform can't take image files.
 *
 * The card DOM is built with plain `document.createElement` calls rather
 * than a React render pass: html-to-image needs one real, already-laid-out
 * element to walk and inline computed styles from, and building it directly
 * avoids standing up a second React root (and its act()/lifecycle baggage)
 * just to produce one throwaway node. This mirrors the rest of the app's
 * image work — `data/storage.ts`'s `downscaleImage` also reaches for raw
 * canvas/DOM APIs rather than React for a one-shot image transform.
 */

// "Retina" per the ticket's 2-3x pixelRatio ask — the resulting PNG is a
// static image dropped into a chat thread, so the extra crispness is worth
// the larger file when a Player pinches to zoom on someone else's card.
const PIXEL_RATIO = 3;
const CARD_WIDTH = 600;
const CARD_HEIGHT = 750;
export const SHARE_CARD_APP_NAME = 'Gay Cruise Bingo';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Mounts `node` off-screen (real layout, so html-to-image can measure it — never `display:none`, which would size it to 0x0) and returns its teardown. */
function mountOffscreen(node: HTMLElement): () => void {
  const host = el('div', 'share-card-host');
  host.appendChild(node);
  document.body.appendChild(host);
  return () => host.remove();
}

async function rasterize(node: HTMLElement): Promise<Blob> {
  const unmount = mountOffscreen(node);
  try {
    const blob = await toBlob(node, { pixelRatio: PIXEL_RATIO });
    if (!blob) throw new Error('Share Card render produced no image data.');
    return blob;
  } finally {
    unmount();
  }
}

// ---------------------------------------------------------------------------
// BINGO / Blackout card
// ---------------------------------------------------------------------------

export interface BingoShareCardData {
  kind: 'bingo' | 'blackout';
  playerName: string;
  eventName: string;
  /** The Player's own 25-cell board (index order, free center included). */
  cells: Cell[];
}

function buildBingoCardNode(data: BingoShareCardData): HTMLDivElement {
  const card = el('div', 'share-card share-card-bingo');
  card.style.width = `${CARD_WIDTH}px`;
  card.style.height = `${CARD_HEIGHT}px`;
  card.append(el('div', 'share-card-event', data.eventName));
  card.append(el('div', 'share-card-title', data.kind === 'blackout' ? 'BLACKOUT' : 'BINGO!'));
  card.append(el('div', 'share-card-player', data.playerName));
  const bhead = el('div', 'share-card-bhead');
  for (const letter of ['B', 'I', 'N', 'G', 'O']) bhead.append(el('span', undefined, letter));
  card.append(bhead);
  const grid = el('div', 'share-card-grid');
  for (const c of data.cells) {
    const cls = 'share-card-cell' + (c.free ? ' free' : '') + (c.marked ? ' marked' : '');
    grid.append(el('div', cls, c.text));
  }
  card.append(grid);
  card.append(el('div', 'share-card-footer', `${SHARE_CARD_APP_NAME} 🚢`));
  return card;
}

export async function renderBingoShareCard(data: BingoShareCardData): Promise<Blob> {
  return rasterize(buildBingoCardNode(data));
}

// ---------------------------------------------------------------------------
// Leaderboard card
// ---------------------------------------------------------------------------

export interface LeaderboardShareRow {
  uid: string;
  /** The Player's position in the FULL roster (ADR 0001 rank — bingos desc, squares desc, earliest first-bingo), not a renumbering of just the shared rows. */
  rank: number;
  displayName: string;
  bingoCount: number;
  squaresMarked: number;
  blackout: boolean;
  /** True for the roster's single earliest-first-bingo Player — a pin, not a rank (ADR 0001). */
  firstToBingo: boolean;
}

export interface LeaderboardShareCardData {
  eventName: string;
  /** Already the exact rows to render, in display order — shaping (top-N, pin inclusion) is the caller's job (Leaderboard.tsx), not this renderer's. */
  rows: LeaderboardShareRow[];
}

function buildLeaderboardCardNode(data: LeaderboardShareCardData): HTMLDivElement {
  const card = el('div', 'share-card share-card-leaderboard');
  card.style.width = `${CARD_WIDTH}px`;
  card.style.height = `${CARD_HEIGHT}px`;
  card.append(el('div', 'share-card-event', data.eventName));
  card.append(el('div', 'share-card-title', 'LEADERBOARD'));
  const rows = el('div', 'share-card-rows');
  for (const r of data.rows) {
    const row = el('div', 'share-card-row' + (r.firstToBingo ? ' pinned' : ''));
    row.append(el('span', 'share-card-rank', String(r.rank)));
    row.append(el('span', 'share-card-name', r.displayName));
    const subText =
      `${r.bingoCount} bingo${r.bingoCount === 1 ? '' : 's'} · ${r.squaresMarked} sq` +
      (r.blackout ? ' · BLACKOUT' : '');
    row.append(el('span', 'share-card-sub', subText));
    if (r.firstToBingo) row.append(el('span', 'share-card-pin', '★ 1st BINGO'));
    rows.append(row);
  }
  card.append(rows);
  card.append(el('div', 'share-card-footer', `${SHARE_CARD_APP_NAME} 🚢`));
  return card;
}

export async function renderLeaderboardShareCard(data: LeaderboardShareCardData): Promise<Blob> {
  return rasterize(buildLeaderboardCardNode(data));
}

// ---------------------------------------------------------------------------
// Native share sheet + fallback chain — shared by Celebration.tsx and
// Leaderboard.tsx so the degrade path lives exactly once.
// ---------------------------------------------------------------------------

export type ShareOutcome = 'files' | 'text' | 'clipboard' | 'download' | 'cancelled' | 'none';

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const a = el('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Hands a rendered Share Card to the OS share sheet when the platform can
 * take image files (`navigator.canShare({ files })`); otherwise degrades —
 * in order — through a text/URL share, the clipboard, then a direct
 * download, so the Player always ends up with something they can act on
 * (ADR 0005, issue #36). `blob` may be `null` when the on-device render
 * itself failed; the chain simply skips the file-share and download legs.
 * Never throws — every branch is self-contained, so a caller can await this
 * without its own try/catch.
 */
export async function shareCardBlob(opts: {
  blob: Blob | null;
  filename: string;
  title: string;
  text: string;
  url?: string;
}): Promise<ShareOutcome> {
  const { blob, filename, title, text, url } = opts;

  if (blob) {
    const file = new File([blob], filename, { type: blob.type || 'image/png' });
    if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title, text });
        return 'files';
      } catch {
        // The Player dismissed the native sheet (or it failed outright) —
        // respect that choice rather than surprising them with a second
        // fallback share/prompt right after they cancelled the first.
        return 'cancelled';
      }
    }
  }

  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return 'text';
    } catch {
      /* fall through to the clipboard/download legs */
    }
  }

  if (navigator.clipboard?.writeText && url) {
    try {
      await navigator.clipboard.writeText(url);
      return 'clipboard';
    } catch {
      /* fall through to the download leg */
    }
  }

  if (blob) {
    try {
      downloadBlob(blob, filename);
      return 'download';
    } catch {
      /* nothing left to try */
    }
  }

  return 'none';
}
