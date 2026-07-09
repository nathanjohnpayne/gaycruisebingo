import { useRef, useState } from 'react';
import { useEventDoc, useLeaderboard } from '../hooks/useData';
import { track } from '../analytics';
import { renderLeaderboardShareCard, shareCardBlob, SHARE_CARD_APP_NAME, type LeaderboardShareRow } from './ShareCard';
import Avatar from './Avatar';
import type { PlayerDoc } from '../types';

function when(ts: number | null): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

type LeaderboardFilter = 'all' | 'bingo' | 'blackout';

const FILTERS: Array<{ id: LeaderboardFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'bingo', label: 'With BINGO' },
  { id: 'blackout', label: 'Blackout' },
];

/**
 * Presentational-only predicate (ADR 0001: the Leaderboard is a for-fun tally,
 * not a tamper-proof record). It decides which already-ranked rows are
 * visible; it never reorders or re-ranks — `sortPlayers` (src/game/logic.ts)
 * stays the single source of order.
 */
function matchesFilter(p: PlayerDoc, filter: LeaderboardFilter): boolean {
  switch (filter) {
    case 'bingo':
      return p.bingoCount > 0;
    case 'blackout':
      return !!p.blackout;
    default:
      return true;
  }
}

// Share Card row cap (issue #36): a fixed-size card can't fit the whole
// roster, so the card shows the top MAX_SHARE_ROWS by rank.
const MAX_SHARE_ROWS = 8;

function toShareRow(p: PlayerDoc, rank: number, firstBingoUid: string | undefined): LeaderboardShareRow {
  return {
    uid: p.uid,
    rank,
    displayName: p.displayName,
    bingoCount: p.bingoCount,
    squaresMarked: p.squaresMarked,
    blackout: !!p.blackout,
    firstToBingo: p.uid === firstBingoUid,
  };
}

/**
 * Shapes the Share Card's row list from the FULL (already `sortPlayers`-
 * ordered) roster — independent of the presentational filter above, same
 * principle as the pin itself (specs/w2-leaderboard.md): the top `maxRows`
 * by rank, plus the First to BINGO Player appended at the end when their
 * rank falls outside that slice, so the pin can never silently drop off the
 * card just because its holder isn't otherwise a top-ranked Player.
 */
function buildShareStandings(
  players: PlayerDoc[],
  firstBingoUid: string | undefined,
  maxRows: number,
): LeaderboardShareRow[] {
  const ranked = players.map((p, i) => toShareRow(p, i + 1, firstBingoUid));
  const top = ranked.slice(0, maxRows);
  if (firstBingoUid && !top.some((r) => r.uid === firstBingoUid)) {
    const pinned = ranked.find((r) => r.uid === firstBingoUid);
    if (pinned) top.push(pinned);
  }
  return top;
}

export default function Leaderboard() {
  const { players, loading } = useLeaderboard();
  const { data: event } = useEventDoc();
  const [filter, setFilter] = useState<LeaderboardFilter>('all');
  // The most recent warmed-up card render, keyed by the inputs it was built
  // from (the roster array's identity + the resolved event name) so a tap
  // reuses it only while it still depicts the CURRENT standings — see
  // warmShareCard below (Codex P2, PR #111 round 2 finding 2).
  const warmedCard = useRef<{
    players: PlayerDoc[];
    eventName: string;
    promise: Promise<Blob | null>;
  } | null>(null);

  if (loading) return <div className="center muted">Loading…</div>;
  if (!players.length) return <div className="center muted">No players yet. Be the first.</div>;

  // First to BINGO is the earliest firstBingoAt across ALL Players — a
  // ceremonial, self-reported honour (ADR 0001), not a rank. It is computed
  // over the FULL roster (never the filtered `visible` subset below) so the
  // pin's identity can't shift depending on which filter happens to be
  // selected; only whether that Player's row is currently visible can change.
  const withBingo = players
    .filter((p) => p.firstBingoAt != null)
    .sort((a, b) => (a.firstBingoAt as number) - (b.firstBingoAt as number));
  const firstBingoUid = withBingo[0]?.uid;

  // Filters narrow this render's visible subset of the already-ranked
  // `players` array — a plain `.filter`, never a `.sort`, so the relative
  // order sortPlayers produced is always preserved.
  const visible = players.filter((p) => matchesFilter(p, filter));

  // Warm-on-intent pre-render (Codex P2, PR #111 round 2 finding 2): start
  // rasterizing when the Player signals intent to share — pointerenter
  // (mouse hover), focus (keyboard), or pointerdown (touch press) on the
  // Share button — so the tap's own `await` picks up an in-flight or
  // already-settled render and `navigator.share` runs within the browser's
  // transient user-activation window instead of expiring it mid-rasterize.
  // Deliberately NOT mount-eager like Celebration's card: this component
  // re-renders on every roster snapshot (any Player's Mark updates a player
  // row), so rasterizing per snapshot would burn phone CPU/battery for a
  // card that is rarely shared; Celebration's inputs are fixed for the
  // lifetime of a short-lived win modal, so mount-eager is cheap there. The
  // warmed promise is reused ONLY while its inputs (the roster array's
  // identity + event name) still match — a roster that moved between
  // warm-up and tap re-renders fresh at tap time so the card never shows
  // stale standings, accepting the (rare, slow-device) residual activation
  // risk on that path. `.catch(() => null)` lives inside the cached
  // promise: a render failure resolves null (shareCardBlob degrades to the
  // text/URL leg) and can never surface as an unhandled rejection from a
  // hover that was never followed by a tap.
  const warmShareCard = (): Promise<Blob | null> => {
    const eventName = event?.name ?? SHARE_CARD_APP_NAME;
    const cached = warmedCard.current;
    if (cached && cached.players === players && cached.eventName === eventName) {
      return cached.promise;
    }
    const promise = renderLeaderboardShareCard({
      eventName,
      rows: buildShareStandings(players, firstBingoUid, MAX_SHARE_ROWS),
    }).catch(() => null);
    warmedCard.current = { players, eventName, promise };
    return promise;
  };

  // The Share Card always reflects the top standings across the FULL roster
  // (buildShareStandings), independent of whatever filter is currently
  // selected — mirrors the pin's own full-roster scope above, so switching
  // filters can never change what a shared card shows.
  const shareLeaderboard = async () => {
    // Reuses the warmed render when its inputs still match, else renders
    // fresh (the cold-tap path — same behavior as before the warm-up).
    const blob = await warmShareCard();
    try {
      await shareCardBlob({
        blob,
        filename: 'gay-cruise-bingo-leaderboard.png',
        title: `${SHARE_CARD_APP_NAME} — Leaderboard`,
        text: 'Check out the Gay Cruise Bingo leaderboard 🏆',
        url: window.location.origin,
      });
    } catch {
      // shareCardBlob is designed to never throw, but a share failure must
      // never crash the Leaderboard regardless.
    } finally {
      track('share_click', { surface: 'leaderboard' });
    }
  };

  return (
    <>
      <div className="lb-actions">
        <button
          type="button"
          className="btn"
          onClick={shareLeaderboard}
          onPointerEnter={() => void warmShareCard()}
          onFocus={() => void warmShareCard()}
          onPointerDown={() => void warmShareCard()}
        >
          Share leaderboard
        </button>
      </div>
      <div className="lb-filters" role="group" aria-label="Filter leaderboard">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={'lb-filter-btn' + (filter === f.id ? ' on' : '')}
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>
      {visible.length === 0 ? (
        <div className="center muted">No one matches this filter yet.</div>
      ) : (
        <div className="list">
          {visible.map((p, i) => {
            const isFirst = p.uid === firstBingoUid;
            return (
              <div key={p.uid} className={'row' + (isFirst ? ' leader' : '')}>
                <div className="rank">{i + 1}</div>
                <Avatar name={p.displayName} src={p.photoURL} />
                <div className="grow">
                  <div className="name">{p.displayName}</div>
                  <div className="sub">
                    {p.bingoCount} bingo{p.bingoCount === 1 ? '' : 's'} · {p.squaresMarked} squares
                    {p.blackout ? ' · BLACKOUT' : ''} · {when(p.firstBingoAt)}
                  </div>
                </div>
                {isFirst && <div className="badge">1st BINGO</div>}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
