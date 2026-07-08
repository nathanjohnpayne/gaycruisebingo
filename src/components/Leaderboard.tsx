import { useState } from 'react';
import { useLeaderboard } from '../hooks/useData';
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

export default function Leaderboard() {
  const { players, loading } = useLeaderboard();
  const [filter, setFilter] = useState<LeaderboardFilter>('all');

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

  return (
    <>
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
