import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import {
  useEventDoc,
  usePendingClaims,
  usePendingItems,
  useReportedProofs,
  useAllItems,
  isReportHidden,
  isBanned,
  isSystemAuthor,
} from '../hooks/useData';
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
  approveItem,
  rejectItem,
  bulkApproveItems,
  setItemSpicy,
  setClaimMode,
  setEventTheme,
  banUser,
  unbanUser,
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
 * Ban / Unban the AUTHOR of a queued row (#108). Banning is an admin action on the
 * CURRENT event: it adds/removes the content owner's uid on the event doc's
 * `bannedUids` roster (`data/admin` banUser/unbanUser → arrayUnion/arrayRemove), the
 * ADR 0004 Phase 0 presentational hide/mute the #113 rules landed. It is a
 * MODERATION / DISPUTE tool, NOT anti-cheat (ADR 0001) and NOT hard access
 * revocation (server-authoritative enforcement is #43/#44) — a banned Player's
 * content is filtered from every PUBLIC/player surface (the read hooks + the deal
 * path), yet stays reachable HERE so an Admin can review it and unban. The label
 * reflects the current banned state.
 */
function BanControl({
  uid,
  bannedUids,
  admins,
}: {
  uid: string;
  bannedUids: string[];
  admins: string[];
}) {
  // Two kinds of author are NOT bannable, so no Ban control renders for them:
  //  - System/sentinel authors ('seed', the createdBy on every seeded default
  //    Prompt) — Codex P1, PR #122: a single Ban click would add 'seed' to
  //    bannedUids and hide the ENTIRE default pool from useItems AND the deal path.
  //  - Fellow ADMINS — Codex P2, PR #122 round 2: #113's rules REJECT any resulting
  //    bannedUids that overlaps `admins` (firestore.rules `!bannedUids.hasAny(admins)`,
  //    pinned in tests/rules/w2-banned-uids.test.ts), so offering Ban on an
  //    admin-authored row is a doomed action that can only fail with a permission
  //    error. Suppress it so the admin never sees an action that cannot succeed.
  // A banned sentinel stays recoverable via the Banned players section's Unban
  // (not gated); an admin uid can never be in bannedUids in the first place.
  if (isSystemAuthor(uid) || admins.includes(uid)) return null;
  return isBanned(uid, bannedUids) ? (
    <button className="btn" title="Un-mute this player's content" onClick={() => unbanUser(uid)}>
      Unban author
    </button>
  ) : (
    <button
      className="btn"
      title="Mute this player's content on this event (moderation, not anti-cheat)"
      onClick={() => banUser(uid)}
    >
      Ban author
    </button>
  );
}

/**
 * One reported-Proof row in the moderation queue. `Clear reports` lifts the ADR
 * 0004 Phase 0 community auto-hide by zeroing reportCount — rendered ONLY when the
 * row is actually auto-hidden (the only state with a hide to lift; Codex P2, PR
 * #107 finding 3). It is distinct from Restore, which lifts the `status` hard-hide,
 * so a doubly-hidden row (status hidden AND over threshold) shows both. `Ban author`
 * mutes the Proof's owner across the event (#108); the row stays reachable after.
 */
function ProofQueueRow({
  proof: p,
  threshold,
  bannedUids,
  admins,
}: {
  proof: ProofDoc;
  threshold: number | undefined;
  bannedUids: string[];
  admins: string[];
}) {
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
      <BanControl uid={p.uid} bannedUids={bannedUids} admins={admins} />
      <button className="iconbtn" title="Delete" onClick={() => deleteProof(p.id, p.storagePath)}>
        🗑
      </button>
    </div>
  );
}

/** One reported-Prompt row in the moderation queue — the Prompt-side twin of
 * `ProofQueueRow`, with the same `Clear reports` auto-hide lift (finding 3) and the
 * same `Ban author` control (#108), keyed on the Prompt's `createdBy` owner. */
function ItemQueueRow({
  item: it,
  threshold,
  bannedUids,
  admins,
}: {
  item: ItemDoc;
  threshold: number | undefined;
  bannedUids: string[];
  admins: string[];
}) {
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
      <BanControl uid={it.createdBy} bannedUids={bannedUids} admins={admins} />
      <button className="iconbtn" title="Delete" onClick={() => deleteItem(it.id)}>
        🗑
      </button>
    </div>
  );
}

/**
 * One row in the Approvals queue (#210, daily-cards-spec § "Item pools and the
 * approval flow"): a pending main-pool Prompt with submitter attribution, a
 * spicy toggle, and Approve/Reject. `spicy` is client-editable here (via a
 * plain `updateDoc` through `data/admin`'s isAdmin-unconstrained write arm) so
 * an admin can correct a submitter's 🔞 tagging BEFORE approving it into the
 * live pool — after approval the spicy ratio sampling (`dealBoard`) already
 * treats it as authoritative, so getting it right pre-approve matters.
 */
function ApprovalQueueRow({
  item: it,
  adminUid,
  onToggleSpicy,
}: {
  item: ItemDoc;
  adminUid: string;
  onToggleSpicy: (id: string, spicy: boolean) => void;
}) {
  return (
    <div className="row">
      <div className="grow">
        <div className="name" style={{ fontWeight: 500 }}>
          {it.text}
        </div>
        <div className="sub">submitted by {it.createdBy}</div>
      </div>
      <label style={{ fontSize: 12 }}>
        <input
          type="checkbox"
          checked={it.spicy}
          onChange={(e) => onToggleSpicy(it.id, e.target.checked)}
        />{' '}
        🔞 Spicy
      </label>
      <button className="btn primary" onClick={() => approveItem(it.id, adminUid)}>
        Approve
      </button>
      <button className="iconbtn" title="Reject" onClick={() => rejectItem(it.id, adminUid)}>
        ✕
      </button>
    </div>
  );
}

/**
 * The Approvals tab (#210): the pending main-pool queue, oldest-first
 * (`usePendingItems`), with a bulk-approve control for taste. A separate
 * subscription from the Moderation tab's `useAllItems` — see `usePendingItems`'s
 * doc comment for why.
 */
function ApprovalsTab({ adminUid }: { adminUid: string }) {
  const { items } = usePendingItems();

  return (
    <div className="admin-section">
      <h3>Approvals{items.length ? ` (${items.length})` : ''}</h3>
      {!items.length && (
        <p className="muted" style={{ fontSize: 12 }}>
          Nothing pending review.
        </p>
      )}
      {!!items.length && (
        <button className="btn" onClick={() => bulkApproveItems(items, adminUid)}>
          Approve all
        </button>
      )}
      <div className="list">
        {items.map((it) => (
          <ApprovalQueueRow key={it.id} item={it} adminUid={adminUid} onToggleSpicy={setItemSpicy} />
        ))}
      </div>
    </div>
  );
}

export default function Admin() {
  const { user } = useAuth();
  const { data: event } = useEventDoc();
  const { claims } = usePendingClaims();
  const { flagged } = useReportedProofs();
  const { items } = useAllItems();
  const [tab, setTab] = useState<'moderation' | 'approvals'>('moderation');

  const isAdmin = !!(user && event?.admins?.includes(user.uid));
  if (!isAdmin) return <div className="center muted">Admins only.</div>;

  // The community auto-hide threshold (ADR 0004 Phase 0). Content whose
  // reportCount has REACHED it is already gone from every Player's Feed/pool
  // (useProofFeed / useItems), yet stays reachable in the queue below so an Admin
  // can restore or delete it — the whole reason the Admin views skip the filter.
  const threshold = event?.settings?.reportHideThreshold;
  // The Admin ban roster (#108): the event's `bannedUids`, `[]` when absent (the
  // converter default). Drives each queue row's Ban/Unban control and the Banned
  // players section below. Admin views are UNfiltered — a banned Player's content
  // stays reachable here for review/unban (only PUBLIC/player reads filter).
  const bannedUids = event?.bannedUids ?? [];
  // The event admins roster (#113 contract), read from the SAME event doc. A ban
  // that overlaps admins is rejected by the rules, so BanControl suppresses the Ban
  // action for an admin-authored row (Codex P2, PR #122 round 2).
  const admins = event?.admins ?? [];
  // Prompts awaiting approval (#200 schema, #210 write path) — the SAME count
  // the More menu's Admin row badges (`usePendingItemCount`), derived here from
  // the console's own already-subscribed `items` (no extra listener) so the
  // console and the badge can never disagree. 0 until #210 starts writing
  // `status: 'pending'` items — expected, not broken.
  const pendingCount = items.filter((it) => it.status === 'pending').length;
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
      {/* Approvals tab (#210): a local sub-navigation inside the Admin console —
          Moderation (the existing report queue + console below) vs Approvals
          (the new pending-item queue). This does NOT touch the app-level bottom
          tab bar (src/components/tabs.ts is the frozen Wave-1+ mount-point
          contract) — Admin already mounts inside the More tab (#208); this is
          purely a within-page toggle. */}
      <div className="seg" style={{ marginBottom: 12 }}>
        <button
          className={'seg-btn' + (tab === 'moderation' ? ' on' : '')}
          onClick={() => setTab('moderation')}
        >
          Moderation
        </button>
        <button
          className={'seg-btn' + (tab === 'approvals' ? ' on' : '')}
          onClick={() => setTab('approvals')}
        >
          Approvals
        </button>
      </div>
      {tab === 'approvals' && user && <ApprovalsTab adminUid={user.uid} />}
      {tab !== 'moderation' ? null : <>
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
              <ProofQueueRow
                key={`proof-${entry.proof.id}`}
                proof={entry.proof}
                threshold={threshold}
                bannedUids={bannedUids}
                admins={admins}
              />
            ) : (
              <ItemQueueRow
                key={`item-${entry.item.id}`}
                item={entry.item}
                threshold={threshold}
                bannedUids={bannedUids}
                admins={admins}
              />
            ),
          )}
        </div>
      </div>

      {/* Banned players (#108): the current `bannedUids` roster, so an Admin can see
          who is muted and unban them — including a Player who has no queued content
          (their prompts/proofs may all be deleted, yet they can still be unbanned
          here). A ban is a presentational moderation/dispute tool (ADR 0004 Phase 0),
          NOT anti-cheat (ADR 0001) or hard access revocation (#43/#44). */}
      <div className="admin-section">
        <h3>Banned players{bannedUids.length ? ` (${bannedUids.length})` : ''}</h3>
        {!bannedUids.length ? (
          <p className="muted" style={{ fontSize: 12 }}>No one is banned.</p>
        ) : (
          <div className="list">
            {bannedUids.map((uid) => (
              <div key={uid} className="row">
                <div className="grow">
                  <div className="name">{uid}</div>
                  <div className="sub">content hidden from players (moderation, not anti-cheat)</div>
                </div>
                <button className="btn" onClick={() => unbanUser(uid)}>
                  Unban
                </button>
              </div>
            ))}
          </div>
        )}
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
        <h3>
          Prompts ({items.length})
          {pendingCount > 0 && <span className="pill">{pendingCount} pending</span>}
        </h3>
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
      </>}
    </div>
  );
}
