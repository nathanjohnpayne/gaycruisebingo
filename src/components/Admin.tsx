import { useAuth } from '../auth/AuthContext';
import { useEventDoc, usePendingClaims, useReportedProofs, useAllItems } from '../hooks/useData';
import {
  confirmClaim,
  rejectClaim,
  hideProof,
  restoreProof,
  hideItem,
  restoreItem,
  deleteItem,
  setClaimMode,
  setEventTheme,
} from '../data/admin';
import { deleteProof } from '../data/proofs';
import { THEMES } from '../theme/themes';
import type { ClaimMode } from '../types';

export default function Admin() {
  const { user } = useAuth();
  const { data: event } = useEventDoc();
  const { claims } = usePendingClaims();
  const { flagged } = useReportedProofs();
  const { items } = useAllItems();

  const isAdmin = !!(user && event?.admins?.includes(user.uid));
  if (!isAdmin) return <div className="center muted">Admins only.</div>;

  const modes: ClaimMode[] = ['honor', 'proof_required', 'admin_confirmed'];
  const modeLabel: Record<ClaimMode, string> = {
    honor: 'Honor',
    proof_required: 'Proof req.',
    admin_confirmed: 'Admin-confirmed',
  };

  return (
    <div>
      <div className="admin-section">
        <h3>Claim mode</h3>
        <div className="seg">
          {modes.map((m) => (
            <button
              key={m}
              className={'seg-btn' + (event?.claimMode === m ? ' on' : '')}
              onClick={() => setClaimMode(m)}
            >
              {modeLabel[m]}
            </button>
          ))}
        </div>
      </div>

      <div className="admin-section">
        <h3>Default theme</h3>
        <div className="themes">
          {THEMES.map((t) => (
            <button
              key={t.id}
              className={'chip' + (event?.defaultTheme === t.id ? ' active' : '')}
              onClick={() => setEventTheme(t.id)}
            >
              {t.emoji} {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="admin-section">
        <h3>Pending claims{claims.length ? ` (${claims.length})` : ''}</h3>
        {!claims.length && <p className="muted" style={{ fontSize: 12 }}>Nothing to confirm.</p>}
        <div className="list">
          {claims.map((c) => (
            <div key={c.id} className="row">
              <div className="grow">
                <div className="name">{c.displayName}</div>
                <div className="sub">{c.itemText}</div>
              </div>
              <button className="btn" onClick={() => user && confirmClaim(c, user.uid)}>
                Confirm
              </button>
              <button className="iconbtn" title="Reject" onClick={() => user && rejectClaim(c, user.uid)}>
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="admin-section">
        <h3>Flagged / reported proofs{flagged.length ? ` (${flagged.length})` : ''}</h3>
        {!flagged.length && <p className="muted" style={{ fontSize: 12 }}>All clear.</p>}
        <div className="list">
          {flagged.map((p) => (
            <div key={p.id} className="row">
              <div className="grow">
                <div className="name">
                  {p.displayName}
                  <span className="pill">{p.reportCount} ⚑</span>
                  {p.visionFlag && <span className="pill">{p.visionFlag}</span>}
                </div>
                <div className="sub">
                  {p.type} · {p.itemText}
                </div>
              </div>
              {p.status === 'hidden' ? (
                <button className="btn" onClick={() => restoreProof(p.id)}>
                  Restore
                </button>
              ) : (
                <button className="btn" onClick={() => hideProof(p.id)}>
                  Hide
                </button>
              )}
              <button className="iconbtn" title="Delete" onClick={() => deleteProof(p.id, p.storagePath)}>
                🗑
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="admin-section">
        <h3>Prompts ({items.length})</h3>
        <div className="list">
          {items.map((it) => (
            <div key={it.id} className="row">
              <div className="grow">
                <div className="name" style={{ fontWeight: 500 }}>
                  {it.text}
                </div>
                <div className="sub">
                  {it.status}
                  {it.reportCount ? ` · ${it.reportCount} ⚑` : ''}
                </div>
              </div>
              {it.status === 'hidden' ? (
                <button className="btn" onClick={() => restoreItem(it.id)}>
                  Restore
                </button>
              ) : (
                <button className="btn" onClick={() => hideItem(it.id)}>
                  Hide
                </button>
              )}
              <button className="iconbtn" title="Delete" onClick={() => deleteItem(it.id)}>
                🗑
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
