import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import {
  useEventDoc,
  usePendingClaims,
  usePendingItems,
  useReportedProofs,
  useAllItems,
} from '../hooks/useData';
import { adminSectionFromPath, type AdminSection } from './admin/route';
import AdminSheet from './admin/AdminSheet';
import AdminHub from './admin/AdminHub';
import ReviewQueue, { type QueueRow } from './admin/ReviewQueue';
import GameSettings from './admin/GameSettings';
import SchedulePanel from './admin/SchedulePanel';
import PromptPool from './admin/PromptPool';
import PlayersPanel from './admin/PlayersPanel';

/**
 * The admin console (specs/admin-console-ia.md): a hub-and-detail IA over REAL
 * routes. `/more/admin` renders the hub — five section cards with live badges —
 * and each card opens a detail surface at `/more/admin/<section>`, so the
 * browser/PWA back button walks detail → hub → More. This component is the
 * orchestrator: it owns the subscriptions (the same four the old tabbed console
 * held — event doc, pending claims, reported proofs, all items — plus the
 * pending-approvals query the old Approvals tab opened), derives the badge
 * math once, resolves the section from the URL, and renders the matching
 * section inside the shared `AdminSheet` chrome. The sections live in
 * `./admin/*` and keep every write path exactly as built (UI-only re-housing).
 */

const SECTION_TITLES: Record<AdminSection, string> = {
  queue: 'Review queue',
  settings: 'Game settings',
  schedule: 'Schedule',
  pool: 'Prompt pool',
  players: 'Players',
};

export default function Admin() {
  const { user } = useAuth();
  const { data: event } = useEventDoc();
  const { claims } = usePendingClaims();
  const { flagged } = useReportedProofs();
  const { items } = useAllItems();
  const { items: pendingItems } = usePendingItems();
  const location = useLocation();
  const navigate = useNavigate();

  const section = adminSectionFromPath(location.pathname) ?? 'hub';
  // Done closes the ENTIRE admin from any depth; `‹ Admin` backs a detail out
  // to the hub. Both are pushes, so the browser back button still walks the
  // real history (detail → hub → More) independently.
  const done = () => navigate('/more');
  const back = () => navigate('/more/admin');
  const openSection = (s: AdminSection) => navigate(`/more/admin/${s}`);

  const isAdmin = !!(user && event?.admins?.includes(user.uid));
  if (!isAdmin) {
    return (
      <AdminSheet title="Admin" onDone={done}>
        <div className="center muted">Admins only.</div>
      </AdminSheet>
    );
  }

  // The community auto-hide threshold (ADR 0004 Phase 0). Content whose
  // reportCount has REACHED it is already gone from every Player's Feed/pool
  // (useProofFeed / useItems), yet stays reachable in the Review queue so an
  // Admin can restore or delete it — the whole reason the Admin views skip the
  // filter.
  const threshold = event?.settings?.reportHideThreshold;
  const bannedUids = event?.bannedUids ?? [];
  // Prompts awaiting approval (#200 schema, #210 write path) — the SAME count
  // the More menu's Admin row badges (`usePendingItemCount`), derived here from
  // the console's own already-subscribed `items` (no extra listener) so the
  // console and the badge can never disagree.
  const pendingCount = items.filter((it) => it.status === 'pending').length;
  // #282 (Codex P2): prompt ids frozen into an UNLOCKED Day's stamped
  // snapshot — their text is deal-hydrated, so edits would split that Day's
  // squares by open time. Locked Days only; a future (locked) Day's snapshot
  // doesn't exist yet, and text stays editable until its Day opens.
  const nowMs = Date.now();
  const lockedSnapshotItemIds = new Set(
    (event?.days ?? [])
      .filter((d) => d.unlockAt <= nowMs)
      .flatMap((d) => d.snapshotItemIds ?? []),
  );
  // Prompts needing moderation attention: reported at least once, or already
  // hard-hidden. Derived from useAllItems (already subscribed) so the queue
  // opens NO extra listener, and UNfiltered by the threshold so an auto-hidden
  // Prompt still surfaces here.
  const reportedItems = items.filter((it) => it.reportCount > 0 || it.status === 'hidden');
  // Merge reported Proofs and Prompts into ONE Reports group ordered
  // OLDEST-FIRST across both kinds (createdAt asc) — the merged inbox's triage
  // order (specs/admin-console-ia.md § "Review queue"), matching the Approvals
  // and Pending-claims groups and superseding the old most-reported-first sort.
  const reports: QueueRow[] = [
    ...flagged.map((p): QueueRow => ({ kind: 'proof', sortAt: p.createdAt, proof: p })),
    ...reportedItems.map((it): QueueRow => ({ kind: 'item', sortAt: it.createdAt, item: it })),
  ].sort((a, b) => a.sortAt - b.sortAt);

  const title = section === 'hub' ? 'Admin' : SECTION_TITLES[section];

  return (
    <AdminSheet title={title} onBack={section === 'hub' ? undefined : back} onDone={done}>
      {section === 'hub' && (
        <AdminHub
          event={event}
          reportCount={reports.length}
          approvalCount={pendingItems.length}
          claimCount={claims.length}
          itemCount={items.length}
          pendingCount={pendingCount}
          onOpen={openSection}
        />
      )}
      {section === 'queue' && (
        <ReviewQueue
          event={event}
          reports={reports}
          pendingItems={pendingItems}
          claims={claims}
          adminUid={user.uid}
        />
      )}
      {section === 'settings' && <GameSettings event={event} />}
      {section === 'schedule' && <SchedulePanel days={event?.days ?? []} />}
      {section === 'pool' && (
        <PromptPool
          items={items}
          threshold={threshold}
          pendingCount={pendingCount}
          lockedSnapshotItemIds={lockedSnapshotItemIds}
          adminUid={user.uid}
        />
      )}
      {section === 'players' && <PlayersPanel bannedUids={bannedUids} />}
    </AdminSheet>
  );
}
