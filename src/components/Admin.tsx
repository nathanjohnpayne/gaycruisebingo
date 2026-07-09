import { useAuth } from '../auth/AuthContext';
import { useEventDoc, usePendingClaims, useReportedProofs, useAllItems, isReportHidden } from '../hooks/useData';
import {
  confirmClaim,
  rejectClaim,
  hideProof,
  restoreProof,
  clearProofReports,
  hideItem,
  restoreItem,
  deleteItem,
  clearItemReports,
  setClaimMode,
  setEventTheme,
} from '../data/admin';
import { deleteProof } from '../data/proofs';
import { THEMES } from '../theme/themes';
import type { ClaimMode, ItemDoc, ProofDoc } from '../types';

// One report-queue row, tagged so the render can branch to the per-kind
// affordances (Proof vs Prompt writes) while a single list sorts across both
// kinds. `sortCount`/`sortAt` are hoisted so the most-reported-first sort (with a
// createdAt tiebreak) reads one flat stream (Codex P3, PR #107 finding 4).
type QueueRow =
  | { kind: 'proof'; sortCount: number; sortAt: number; proof: ProofDoc }
  | { kind: 'item'; sortCount: number; sortAt: number; item: ItemDoc };

/**
 * One reported-Proof row in the moderation queue. `Clear reports` lifts the ADR
 * 0004 Phase 0 community auto-hide by zeroing reportCount — rendered ONLY when the
 * row is actually auto-hidden (the only state with a hide to lift; Codex P2, PR
 * #107 finding 3). It is distinct from Restore, which lifts the `status` hard-hide,
 * so a doubly-hidden row (status hidden AND over threshold) shows both.
 */
function ProofQueueRow({ proof: p, threshold }: { proof: ProofDoc; threshold: number | undefined }) {
  const autoHidden = isReportHidden(p.reportCount, threshold);
  return (
    <div className="row">
      <div className="grow">
        <div className="name">
          {p.displayName}
          <span className="pill">{p.reportCount} ⚑</span>
          {p.visionFlag && <span className="pill">{p.visionFlag}</span>}
          {autoHidden && <span className="pill pill-hidden">auto-hidden</span>}
        </div>
        <div className="sub">
          proof · {p.type} · {p.itemText}
        </div>
      </div>
      {autoHidden && (
        <button className="btn" onClick={() => clearProofReports(p.id)}>
          Clear reports
        </button>
      )}
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
  );
}

/** One reported-Prompt row in the moderation queue — the Prompt-side twin of
 * `ProofQueueRow`, with the same `Clear reports` auto-hide lift (finding 3). */
function ItemQueueRow({ item: it, threshold }: { item: ItemDoc; threshold: number | undefined }) {
  const autoHidden = isReportHidden(it.reportCount, threshold);
  return (
    <div className="row">
      <div className="grow">
        <div className="name">
          {it.text}
          <span className="pill">{it.reportCount} ⚑</span>
          {autoHidden && <span className="pill pill-hidden">auto-hidden</span>}
        </div>
        <div className="sub">prompt · {it.status}</div>
      </div>
      {autoHidden && (
        <button className="btn" onClick={() => clearItemReports(it.id)}>
          Clear reports
        </button>
      )}
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
  );
}

export default function Admin() {
  const { user } = useAuth();
  const { data: event } = useEventDoc();
  const { claims } = usePendingClaims();
  const { flagged } = useReportedProofs();
  const { items } = useAllItems();

  const isAdmin = !!(user && event?.admins?.includes(user.uid));
  if (!isAdmin) return <div className="center muted">Admins only.</div>;

  // The community auto-hide threshold (ADR 0004 Phase 0). Content whose
  // reportCount has REACHED it is already gone from every Player's Feed/pool
  // (useProofFeed / useItems), yet stays reachable in the queue below so an Admin
  // can restore or delete it — the whole reason the Admin views skip the filter.
  const threshold = event?.settings?.reportHideThreshold;
  // Prompts needing moderation attention: reported at least once, or already
  // hard-hidden. Derived from useAllItems (already subscribed) so the queue opens
  // NO extra listener, and UNfiltered by the threshold so an auto-hidden Prompt
  // still surfaces here.
  const reportedItems = items.filter((it) => it.reportCount > 0 || it.status === 'hidden');
  const queueCount = flagged.length + reportedItems.length;
  // Merge reported Proofs and Prompts into ONE queue sorted most-reported-first
  // ACROSS both kinds, so a heavily-reported Prompt never buries below a
  // lightly-reported Proof (Codex P3, PR #107 finding 4). Ties break by createdAt
  // ascending (oldest first) for a deterministic order; each row keeps its
  // per-kind controls in the render below.
  const queueRows: QueueRow[] = [
    ...flagged.map(
      (p): QueueRow => ({ kind: 'proof', sortCount: p.reportCount, sortAt: p.createdAt, proof: p }),
    ),
    ...reportedItems.map(
      (it): QueueRow => ({ kind: 'item', sortCount: it.reportCount, sortAt: it.createdAt, item: it }),
    ),
  ].sort((a, b) => b.sortCount - a.sortCount || a.sortAt - b.sortAt);

  const modes: ClaimMode[] = ['honor', 'proof_required', 'admin_confirmed'];
  const modeLabel: Record<ClaimMode, string> = {
    honor: 'Honor',
    proof_required: 'Proof req.',
    admin_confirmed: 'Admin-confirmed',
  };

  return (
    <div>
      {/* Report queue — the moderation triage surface, surfaced FIRST and
          most-reported-first. ADR 0004 Phase 0: any row tagged "auto-hidden" has
          crossed reportHideThreshold and already self-hid on every Player's
          Feed/pool with no Admin action; it stays reachable here so an Admin can
          hide (hard), restore, or delete it. The community hide is presentational
          and bypassable by design — server-authoritative removal is #43. */}
      <div className="admin-section queue">
        <h3>Report queue{queueCount ? ` (${queueCount})` : ''}</h3>
        {!queueCount && <p className="muted" style={{ fontSize: 12 }}>Nothing reported. All clear.</p>}
        <div className="list">
          {queueRows.map((entry) =>
            entry.kind === 'proof' ? (
              <ProofQueueRow key={`proof-${entry.proof.id}`} proof={entry.proof} threshold={threshold} />
            ) : (
              <ItemQueueRow key={`item-${entry.item.id}`} item={entry.item} threshold={threshold} />
            ),
          )}
        </div>
      </div>

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
        <h3>Prompts ({items.length})</h3>
        <div className="list">
          {items.map((it) => (
            <div key={it.id} className="row">
              <div className="grow">
                <div className="name" style={{ fontWeight: 500 }}>
                  {it.text}
                  {isReportHidden(it.reportCount, threshold) && (
                    <span className="pill pill-hidden">auto-hidden</span>
                  )}
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
