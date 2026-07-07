import { useLeaderboard } from '../hooks/useData';
import Avatar from './Avatar';

function when(ts: number | null): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function Leaderboard() {
  const { players, loading } = useLeaderboard();

  if (loading) return <div className="center muted">Loading…</div>;
  if (!players.length) return <div className="center muted">No players yet. Be the first.</div>;

  const withBingo = players
    .filter((p) => p.firstBingoAt != null)
    .sort((a, b) => (a.firstBingoAt as number) - (b.firstBingoAt as number));
  const firstBingoUid = withBingo[0]?.uid;

  return (
    <div className="list">
      {players.map((p, i) => {
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
  );
}
