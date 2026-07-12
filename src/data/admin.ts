import { doc, updateDoc, deleteDoc, runTransaction, arrayUnion, arrayRemove, writeBatch } from 'firebase/firestore';
import { db, EVENT_ID } from '../firebase';
import { completedLines, countMarked, isBlackout } from '../game/logic';
import { isSystemAuthor } from './moderation';
import type { Cell, ClaimMode, ThemeId, ClaimDoc, ItemDoc, DayDef } from '../types';

const evt = () => doc(db, 'events', EVENT_ID);
const item = (id: string) => doc(db, 'events', EVENT_ID, 'items', id);
const proof = (id: string) => doc(db, 'events', EVENT_ID, 'proofs', id);
const claim = (id: string) => doc(db, 'events', EVENT_ID, 'claims', id);
const board = (uid: string) => doc(db, 'events', EVENT_ID, 'boards', uid);
const player = (uid: string) => doc(db, 'events', EVENT_ID, 'players', uid);
// A per-Prompt Tally marker (ADR 0002): the same path setMark/attachProof write.
const marker = (itemId: string, uid: string) =>
  doc(db, 'events', EVENT_ID, 'tally', itemId, 'markers', uid);

export const hideItem = (id: string) => updateDoc(item(id), { status: 'hidden' });
export const restoreItem = (id: string) => updateDoc(item(id), { status: 'active' });
export const deleteItem = (id: string) => deleteDoc(item(id));

// Phase 1.5 approval flow (#210, daily-cards-spec § "Item pools and the approval
// flow"): the Admin Approvals-queue write path. A main-pool submission lands
// `pending` (src/data/api.ts addItem); only an admin's decision here can move it
// out of that state. `approveItem` stamps `approvedBy`/`approvedAt` alongside the
// `active` transition so the item is both playable AND carries who/when approved
// it for audit — matching the ItemDoc contract (#200) this ticket is the first
// consumer of. `rejectItem` moves the row to `rejected` and otherwise LEAVES it in
// place (never deletes): rejected rows are "kept for audit, hidden from all
// non-admins" (daily-cards-spec), so the Admin console remains the only surface
// that can still see WHY a Prompt was turned down. Both writes are unconstrained
// by `firestore.rules` under the `isAdmin(eventId)` arm — no client-side field
// allowlist needed beyond what the rule already checks.
export const approveItem = (id: string, adminUid: string) =>
  updateDoc(item(id), { status: 'active', approvedBy: adminUid, approvedAt: Date.now() });
export const rejectItem = (id: string, adminUid: string) =>
  updateDoc(item(id), { status: 'rejected', approvedBy: adminUid, approvedAt: Date.now() });

// Lets an admin correct a submitter's 🔞 tagging from the Approvals queue BEFORE
// approving it into the live pool — once approved, `dealBoard`'s spicy-ratio
// sampling treats `spicy` as authoritative, so getting it right pre-approve
// matters more than it would post-approve.
export const setItemSpicy = (id: string, spicy: boolean) => updateDoc(item(id), { spicy });

/**
 * Bulk-approve every row in `items` (the Approvals queue's full pending list) in
 * ONE batched write — "Bulk approve works on the full pending list in one action"
 * (#210 AC). A `writeBatch` (not N sequential `updateDoc` calls) so the queue
 * clears atomically from the caller's perspective and the console does not fire
 * an update per row. Each row is stamped with the SAME `approvedAt` instant, on
 * the reasoning that a single bulk click is one approval EVENT even though it
 * touches many rows — mirrors how a single admin action elsewhere (e.g. a batch
 * resolve) reads as one moment in the audit trail, not many micro-timestamps.
 */
export function bulkApproveItems(items: Pick<ItemDoc, 'id'>[], adminUid: string): Promise<void> {
  if (items.length === 0) return Promise.resolve();
  const batch = writeBatch(db);
  const approvedAt = Date.now();
  for (const it of items) {
    batch.update(item(it.id), { status: 'active', approvedBy: adminUid, approvedAt });
  }
  return batch.commit();
}
export const hideProof = (id: string) => updateDoc(proof(id), { status: 'hidden' });
export const restoreProof = (id: string) => updateDoc(proof(id), { status: 'active' });

// Lift the ADR 0004 Phase 0 community auto-hide by resetting reportCount to 0 —
// the explicit admin action the console lacked (Codex P2, PR #107 finding 3).
// Restoring `status` alone reactivates a hard-hidden row but leaves reportCount
// over the threshold, so it stays hidden on every Player's Feed/pool
// (useItems / useProofFeed via isReportHidden); an auto-hidden-but-active row has
// no `status` to restore at all. Clearing the counter is the one write that makes
// community-hidden content reappear in the player surfaces. An admin update is
// rules-unconstrained (firestore.rules `items`/`proofs`: `allow update: if
// isAdmin(eventId) || ...`), so writing reportCount is permitted — pinned by
// tests/rules/w2-admin-console.test.ts. This is the Phase 0 console affordance;
// the server-authoritative hide/lift is #43.
export const clearItemReports = (id: string) => updateDoc(item(id), { reportCount: 0 });
export const clearProofReports = (id: string) => updateDoc(proof(id), { reportCount: 0 });
export const setClaimMode = (mode: ClaimMode) => updateDoc(evt(), { claimMode: mode });
export const setEventTheme = (theme: ThemeId) => updateDoc(evt(), { defaultTheme: theme });

// The Admin "Proof & Claims" panel (#222): four single-field `settings.*`
// writes mirroring setClaimMode/setEventTheme. Each is a DOT-PATH `updateDoc`
// (`{ 'settings.photoProofSource': source }`), so it merges into the existing
// `settings` map and never clobbers a sibling key or any other event field —
// firestore.rules only requires the RESULTING `settings.reportHideThreshold`
// to stay a number, which a partial dot-path update preserves. `visionGate`
// is presentational-only for now: `functions/src/visionGate.ts` still gates
// `moderateProof` on its own deploy-time env flag, not this field.
export const setPhotoProofSource = (source: 'camera_or_library' | 'camera_only'): Promise<void> =>
  updateDoc(evt(), { 'settings.photoProofSource': source });
export const setStripPhotoExif = (on: boolean): Promise<void> =>
  updateDoc(evt(), { 'settings.stripPhotoExif': on });
export const setVisionGate = (on: boolean): Promise<void> =>
  updateDoc(evt(), { 'settings.visionGate': on });
export const setReportHideThreshold = (n: number): Promise<void> =>
  updateDoc(evt(), { 'settings.reportHideThreshold': n });

// The Admin Schedule editor (#221, daily-cards-spec § "Admin console" / §
// "Itinerary and schedule"): "changing a locked-future Day's theme is safe,
// changing an already-unlocked Day is disallowed." `days` is a Firestore ARRAY
// field, and the SDK cannot address one element by dot-path (`days.0.theme`
// would target a map key, not an array index) — so this is a targeted
// array-ELEMENT update expressed as a whole-ARRAY write: it reads the caller's
// already-subscribed `days` (the Admin console already holds it via
// `useEventDoc`), replaces only the one entry at `dayIndex` with its `theme`
// changed, and writes back `{ days }` alone. Every other event field
// (claimMode, defaultTheme, admins, settings, bannedUids) and every other
// Day's entry are untouched by this write — it never rewrites the whole
// EventDoc. The write-time lock itself lives in firestore.rules
// (`daysThemeLockOk`), which denies the write outright when the targeted
// Day's `unlockAt` has already passed; this function does not duplicate that
// check client-side (the UI's disabled dropdown is the courtesy, the rule is
// the guarantee) — it trusts the caller to have already excluded
// past/unlocked Days from the set of dayIndex values it invokes with.
// Re-read the freshest `days` INSIDE a transaction before writing the whole
// array back (Codex P2): the caller hands its already-subscribed snapshot, but a
// wholesale array write from a stale snapshot would clobber any concurrent change
// to a DIFFERENT Day that landed after that snapshot — another admin's theme edit
// on another row, or a future scheduler stamp (`snapshotItemIds`, #202) on an
// unlocked Day (which `dealDayCard` needs to leave the `waking` state). Merging
// the single `theme` swap onto the CURRENT array, not the caller's copy, keeps
// this edit surgical under concurrency. The `days` param is retained as the
// fallback when the doc is somehow missing.
export const setDayTheme = (days: DayDef[], dayIndex: number, theme: ThemeId): Promise<void> =>
  runTransaction(db, async (tx) => {
    const snap = await tx.get(evt());
    const current =
      (snap.exists() ? (snap.data().days as DayDef[] | undefined) : undefined) ?? days;
    tx.update(evt(), {
      days: current.map((d) => (d.index === dayIndex ? { ...d, theme } : d)),
    });
  });

// The Admin ban (#108): add/remove a uid on the event doc's `bannedUids` roster —
// the ADR 0004 Phase 0 presentational, event-scoped hide/mute the #113 rules + type
// contract landed (EventDoc.bannedUids, the isAdmin-gated event-doc write path). A
// ban is a moderation/dispute tool, NOT anti-cheat (ADR 0001) and NOT hard access
// revocation (server-authoritative enforcement is #43/#44); the client consumers
// (isBanned filters in the read hooks + the deal path) hide a banned uid's content
// from every PUBLIC/player surface.
//
// arrayUnion/arrayRemove are DELIBERATE (not a whole-doc { bannedUids } write): a
// partial update touches ONLY the roster, so a ban never clobbers other event
// config (claimMode, defaultTheme, settings, admins). firestore.rules validates the
// RESULTING field state (a list, size <= 1000, disjoint from admins), so the
// partial-update shape is accepted — pinned by tests/rules/w2-banned-uids.test.ts.
// This writes ONLY events/{EVENT_ID}, never owner-only users/{uid}. EVENT_ID scopes
// the single-event app exactly like setClaimMode/setEventTheme above.
//
// SENTINEL GUARD (Codex P1, PR #122): banUser REFUSES to add a system/sentinel
// author (isSystemAuthor — today just 'seed', the createdBy on every seeded default
// Prompt). Banning 'seed' would hide the ENTIRE default pool from useItems AND the
// deal path at once — a single mis-click could leave new Players with an empty
// board. The guard is the write-side backstop to the UI's hidden-control, so even a
// programmatic/leaked call can never poison the pool: it no-ops (resolves) rather
// than throwing so any awaiting caller stays happy. unbanUser is DELIBERATELY NOT
// gated — it removes ANY uid including a sentinel, so an admin who banned 'seed' on
// a pre-fix build (or by any other means) can always recover the pool.
export const banUser = (uid: string): Promise<void> =>
  isSystemAuthor(uid) ? Promise.resolve() : updateDoc(evt(), { bannedUids: arrayUnion(uid) });
export const unbanUser = (uid: string) => updateDoc(evt(), { bannedUids: arrayRemove(uid) });

/** Recompute a player's stats after an admin resolves one of their claims. */
async function resolve(
  c: ClaimDoc,
  transform: (cells: Cell[]) => Cell[],
  adminUid: string,
  status: 'confirmed' | 'rejected',
): Promise<void> {
  await runTransaction(db, async (tx) => {
    // Read board + player inside the txn so a concurrent mark/proof from the same
    // player isn't clobbered by a stale snapshot (mirrors setMark/attachProof).
    const bSnap = await tx.get(board(c.uid));
    if (!bSnap.exists()) return;
    const pSnap = await tx.get(player(c.uid));
    const cells = (bSnap.data().cells as Cell[]) ?? [];
    const next = transform(cells);
    const bingoCount = completedLines(next).length;
    const squares = countMarked(next);
    const blackout = isBlackout(next);
    const existingFirst = pSnap.exists() ? ((pSnap.data().firstBingoAt as number | null) ?? null) : null;
    // Clear the first-bingo stamp when the resolved board has no bingo (rejecting
    // a claim can remove the last line); keep the earliest stamp otherwise.
    const firstBingoAt = bingoCount > 0 ? (existingFirst ?? Date.now()) : null;

    tx.set(board(c.uid), { cells: next }, { merge: true });
    tx.set(player(c.uid), { squaresMarked: squares, bingoCount, blackout, firstBingoAt }, { merge: true });
    // Tally symmetry (ADR 0002): wherever a write flips a cell marked→unmarked it
    // must delete that cell's per-Prompt Tally marker, and wherever it flips
    // →marked it must ensure the marker (setMark and attachProof do). Rejecting a
    // claim unmarks the claim's cell via the transform above, so diff old→new and
    // delete the marker for exactly the cells that lost their mark — the SAME
    // conditionality as the flip itself; without this, a rejected admin_confirmed
    // claim would reverse the board + stats but leave the player in the Prompt's
    // public count/who-list (Codex P2, PR #87). The transform is a positional map,
    // so old/new align by index; the free centre (null itemId) never has a marker;
    // confirming never unmarks, so this is a no-op for confirmClaim. tx.delete is
    // a write, so the reads-before-writes transaction contract holds unchanged.
    next.forEach((after, i) => {
      const before = cells[i];
      if (before.marked && !after.marked && before.itemId) {
        tx.delete(marker(before.itemId, c.uid));
      }
    });
    tx.set(claim(c.id), { status, resolvedBy: adminUid }, { merge: true });
    // Confirming an admin-confirmed claim publishes its proof, which was created 'pending'
    // (admin-only readable) so it stayed hidden from the public feed until now. A
    // rejected proof is left 'pending' (still admin-only) rather than exposed.
    if (status === 'confirmed' && c.proofId) {
      tx.set(proof(c.proofId), { status: 'active' }, { merge: true });
    }
  });
}

/**
 * The board cell a claim resolves. Match on the claim's own proofId when it has
 * one, so resolving one of several pending claims for the same square acts on
 * that claim's proof — not whichever proof currently sits at the index (which may
 * be a newer submission). Fall back to cellIndex for legacy claims with no proofId.
 */
const isClaimCell = (x: Cell, c: ClaimDoc): boolean =>
  c.proofId != null ? x.proofId === c.proofId : x.index === c.cellIndex;

export function confirmClaim(c: ClaimDoc, adminUid: string): Promise<void> {
  return resolve(
    c,
    (cells) => cells.map((x) => (isClaimCell(x, c) ? { ...x, status: 'confirmed' as const } : x)),
    adminUid,
    'confirmed',
  );
}

export function rejectClaim(c: ClaimDoc, adminUid: string): Promise<void> {
  return resolve(
    c,
    (cells) =>
      cells.map((x) =>
        isClaimCell(x, c)
          ? { ...x, marked: false, status: 'confirmed' as const, proofId: null, markedAt: null }
          : x,
      ),
    adminUid,
    'rejected',
  );
}
