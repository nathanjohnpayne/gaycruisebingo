import { useProofFeed } from '../hooks/useData';
import { useAuth } from '../auth/AuthContext';
import { reportProof, deleteProof } from '../data/proofs';
import { track } from '../analytics';
import Avatar from './Avatar';
import { safeMediaUrl } from './safeMediaUrl';

function ago(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function ProofFeed() {
  const { proofs, loading } = useProofFeed();
  const { user } = useAuth();

  if (loading) return <div className="center muted">Loading…</div>;
  if (!proofs.length) return <div className="center muted">No proof yet. Somebody do something.</div>;

  return (
    <div className="list">
      {proofs.map((p) => {
        // Scheme-guard the Feed's stored media URL before it reaches an
        // <img>/<audio> src (CodeQL js/xss-through-dom #1). mediaURL is resolved
        // from a Firestore doc, so a forged non-media scheme (javascript:, …) is
        // dropped here rather than rendered as an active-scheme URL.
        const media = safeMediaUrl(p.mediaURL);
        return (
          <div key={p.id} className="proof">
            <div className="row" style={{ border: 'none', background: 'none', padding: 0 }}>
              <Avatar name={p.displayName} src={p.photoURL} size={30} />
              <div className="grow">
                <div className="name" style={{ fontSize: 14 }}>
                  {p.displayName}{' '}
                  <span className="muted" style={{ fontWeight: 400 }}>marked “{p.itemText}”</span>
                </div>
                <div className="sub">{ago(p.createdAt)}</div>
              </div>
              <button className="iconbtn" title="Report" onClick={() => { reportProof(p.id).catch(console.error); track('report_item'); }}>
                ⚑
              </button>
              {user?.uid === p.uid && (
                <button className="iconbtn" title="Delete" onClick={() => deleteProof(p.id, p.storagePath).catch(console.error)}>
                  🗑
                </button>
              )}
            </div>
            {p.type === 'photo' && media && <img className="proof-media" src={media} alt="proof" loading="lazy" />}
            {p.type === 'audio' && media && <audio className="proof-media" controls src={media} />}
            {p.type === 'text' && p.text && <blockquote className="proof-quote">“{p.text}”</blockquote>}
            {p.status === 'flagged' && <div className="badge" style={{ color: '#ff6b6b' }}>flagged for review</div>}
          </div>
        );
      })}
    </div>
  );
}
