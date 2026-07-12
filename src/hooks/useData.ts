import { useEffect, useState } from 'react';
import { onSnapshot, query, where, type DocumentReference, type Query } from 'firebase/firestore';
import { eventRef, itemsCol, boardRef, playerRef, playersCol, proofsCol, claimsCol, userRef, tallyMarkersCol, momentsCol, doubtsCol } from '../data/paths';
import { isReportHidden, isBanned, isSystemAuthor } from '../data/moderation';
import { sortPlayers } from '../game/logic';
import type { EventDoc, ItemDoc, BoardDoc, PlayerDoc, ProofDoc, ClaimDoc, UserDoc, TallyEntry, MomentDoc, DoubtDoc } from '../types';

// Both subs subscribe with includeMetadataChanges so the cache→server
// transition is always observable: with the ADR 0006 persistent cache, a cold
// or stale IndexedDB can deliver a first snapshot `fromCache` (e.g. an empty
// pool / missing board that the server would contradict), and WITHOUT metadata
// events Firestore never re-notifies when the server confirms byte-identical
// data — `hasServerData` would deadlock. The latch below turns true on the
// first server-backed snapshot and stays true for the life of the key, so
// consumers (Board's thin-pool guard) can tell "the server really says this"
// from "the local cache says this so far". Errors leave it false — failing
// toward the neutral loading state, never toward a false alert.
function useDocSub<T>(ref: DocumentReference<T> | null, key: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasServerData, setHasServerData] = useState(false);
  useEffect(() => {
    // Drop the previous ref's document so stale data from another subscription
    // (e.g. a different signed-in uid) can't render under the new key.
    setData(null);
    setHasServerData(false);
    if (!ref) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = onSnapshot(
      ref,
      { includeMetadataChanges: true },
      (snap) => {
        setData(snap.exists() ? (snap.data() as T) : null);
        setLoading(false);
        if (!snap.metadata.fromCache) setHasServerData(true);
      },
      () => setLoading(false),
    );
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return { data, loading, hasServerData };
}

function useColSub<T>(q: Query<T> | null, key: string) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasServerData, setHasServerData] = useState(false);
  // `fromCache` is the LATEST snapshot's origin (per-snapshot, unlike the
  // `hasServerData` latch): true when the rows came from the persistent IndexedDB
  // cache, false when server-backed. Consumers that must distinguish an in-session
  // server-backed observation from a stale cache replay (e.g. `useMyClaims` seeding
  // the confirm-path freshness witness, #41 / Codex #116 R2 finding 2) read this.
  const [fromCache, setFromCache] = useState(true);
  // `hasPendingWrites` is the LATEST snapshot's OPTIMISTIC-write flag (per-snapshot):
  // true when the snapshot reflects a LOCAL write this client issued that the server
  // has NOT yet acked. It is the OTHER half of the `{ includeMetadataChanges: true }`
  // discipline — `fromCache` is cache-vs-server, `hasPendingWrites` is
  // local-optimistic-vs-server-committed. A snapshot is fully SERVER-COMMITTED only
  // when both are false. The pool-recovery watcher (#70, Codex P2 on PR #124 round 2)
  // needs this: a local optimistic prompt-add arrives with `fromCache === false` AND
  // `hasPendingWrites === true`, so a `fromCache`-only gate would treat that
  // not-yet-committed local echo as a server crossing and fire before the write acks.
  const [hasPendingWrites, setHasPendingWrites] = useState(false);
  useEffect(() => {
    // Drop the previous query's rows when the key changes so stale results can't
    // render against the new subscription.
    setData([]);
    setHasServerData(false);
    setFromCache(true);
    setHasPendingWrites(false);
    if (!q) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = onSnapshot(
      q,
      { includeMetadataChanges: true },
      (snap) => {
        setData(snap.docs.map((d) => d.data() as T));
        setLoading(false);
        setFromCache(snap.metadata.fromCache);
        setHasPendingWrites(snap.metadata.hasPendingWrites);
        if (!snap.metadata.fromCache) setHasServerData(true);
      },
      () => setLoading(false),
    );
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return { data, loading, hasServerData, fromCache, hasPendingWrites };
}

export function useEventDoc(enabled = true) {
  // `enabled` lets a pre-auth caller (main.tsx) skip the subscription: events
  // require sign-in, so subscribing while signed out only yields a
  // permission-denied error. Toggle the key (not just the ref) so the effect
  // re-runs and subscribes once auth arrives — useDocSub is keyed on `key`.
  return useDocSub<EventDoc>(enabled ? eventRef() : null, enabled ? 'event' : 'event:disabled');
}

// The ADR 0004 Phase 0 community auto-hide predicate lives in the Firestore-free,
// React-free ./moderation module (imported above) so the deal path (src/data/api.ts's
// joinAndDeal) can apply the EXACT same "is this community-hidden" test as these
// read hooks without importing React (Codex P2, PR #107 finding 1). Re-exported here
// so the existing importers (Admin.tsx, the hooks suite) keep importing it from
// useData. The predicate treats only a POSITIVE threshold as active (0 / negative /
// NaN / undefined → no filtering) — see ./moderation for the fail-open-unless-positive
// rationale (Codex P2, PR #107 finding 2).
export { isReportHidden };

// The ADR 0004 Phase 0 presentational ban predicate (#108) is also owned by the
// Firestore-free, React-free ./moderation module and re-exported here for the SAME
// reason as isReportHidden — the deal path (src/data/api.ts) applies it without
// importing React, and the console (Admin.tsx) + Leaderboard import it from here.
// `isSystemAuthor` (Codex P1, PR #122) rides along so the console can hide the Ban
// control for a system/sentinel author ('seed') that must never be banned.
export { isBanned, isSystemAuthor };

/**
 * The Event's shared moderation config, read ONCE from `useEventDoc()` so every
 * client computes the SAME presentational hides with no Admin online (ADR 0004
 * Phase 0):
 *
 *  - `threshold` — the community auto-hide `settings.reportHideThreshold` (seeded 4,
 *    `scripts/seed.mjs`), `undefined` while the event doc loads or the setting is
 *    unset so callers treat it as "no filtering" (see `isReportHidden`).
 *  - `bannedUids` — the Admin ban roster (#113 contract, #108 consumer), `[]` while
 *    loading or absent (the `eventConverter` defaults a missing field to `[]`) so
 *    `isBanned` filters nothing until a real roster arrives.
 *
 * Both are reads of SHARED config, not per-client knobs — the hides are bypassable
 * by design (a client can patch its bundle to ignore them); tamper-proof server
 * enforcement is deferred to #43/#44. Combined into one hook so a consumer that
 * needs both opens a SINGLE event-doc subscription rather than two.
 *
 * `enabled` mirrors `useEventDoc`'s gate: an id-scoped consumer (useTally /
 * useDoubts) passes `false` when its own id is null so it opens NO subscription at
 * all — preserving those hooks' "pass null to open no subscription" contract. When
 * disabled the config reads as unset (threshold `undefined`, bannedUids `[]`), which
 * both filters fail open on anyway.
 */
function useEventModeration(enabled = true): { threshold: number | undefined; bannedUids: string[] } {
  const { data: event } = useEventDoc(enabled);
  const threshold = event?.settings?.reportHideThreshold;
  return {
    threshold: typeof threshold === 'number' ? threshold : undefined,
    bannedUids: event?.bannedUids ?? [],
  };
}

export function useItems(enabled = true) {
  // `enabled` lets Board skip this subscription once a Board is frozen (Codex
  // P3 on PR #66): the pool only matters pre-deal, so a Player who already has
  // a Board has no use for a live listener that fans every other Player's
  // prompt add/report out as a full-pool read + rerender. Toggle the key (not
  // just the query) so the effect re-subscribes if `enabled` flips back to
  // true — mirrors useEventDoc's pre-auth gate above.
  const { threshold, bannedUids } = useEventModeration();
  // Scoped `where('status','==','active')` so every matched doc satisfies the item
  // read rule (#43 F4): non-admins may read only active Prompts, so an unconstrained
  // collection listen would now be DENIED — the SAME pattern the proof feed uses
  // (useProofFeed). A single-field equality — no composite index. `useAllItems`
  // (Admin) stays unconstrained and reads all statuses via the isAdmin arm.
  const { data, loading, hasServerData, fromCache, hasPendingWrites } = useColSub<ItemDoc>(
    enabled ? query(itemsCol(), where('status', '==', 'active')) : null,
    enabled ? 'items' : 'items:disabled',
  );
  // Two further presentational hides drop a Prompt from the live pool on top of the
  // now server-authoritative `status` gate (#43): the ADR 0004 community auto-hide
  // once `reportCount` reaches `reportHideThreshold` (the Phase-0 fallback that runs
  // before the Cloud Function catches up), and the Admin ban (#108) — a Prompt
  // authored by a banned uid (`createdBy` on `bannedUids`) is hidden by its OWNER,
  // mirroring `isReportHidden`. `useAllItems` (Admin) applies NEITHER, so an Admin
  // can still reach and restore/unban a threshold-hidden or banned Prompt. The
  // `status === 'active'` re-check is redundant with the query but harmless (guards
  // a stale cache row). Presentational only — the doc is untouched.
  const items = data
    .filter(
      (i) =>
        i.status === 'active' &&
        (i.pool ?? 'main') === 'main' &&
        !isReportHidden(i.reportCount, threshold) &&
        !isBanned(i.createdBy, bannedUids),
    )
    .sort((a, b) => a.createdAt - b.createdAt);
  // `hasServerData` is the LIFETIME latch (has a server snapshot EVER arrived);
  // `fromCache` and `hasPendingWrites` are THIS snapshot's per-snapshot metadata. The
  // pool-recovery watcher (#70) needs the per-snapshot flags, not the latch: once
  // latched, a later cache/local replay would otherwise read as a server-confirmed
  // pool crossing (Codex P2 on PR #124 round 1), so the edge detector gates on
  // `!fromCache && !hasPendingWrites` — fully server-committed, no local optimistic
  // prompt-add echo (Codex P2 round 2). Other `useItems` consumers ignore both.
  return { items, loading, hasServerData, fromCache, hasPendingWrites };
}

export function useBoard(uid: string | undefined) {
  return useDocSub<BoardDoc>(uid ? boardRef(uid) : null, `board:${uid ?? 'none'}`);
}

export function useMyPlayer(uid: string | undefined) {
  return useDocSub<PlayerDoc>(uid ? playerRef(uid) : null, `player:${uid ?? 'none'}`);
}

/**
 * A Prompt's public Tally (ADR 0002): the attributed list of Players who have
 * marked `itemId`, plus the derived `count` for the Square's badge. The count is
 * the marker-subcollection size (the aggregate tally/{itemId} doc is admin/Cloud-
 * Function-maintained in Phase 1, not client-written), and the who-list is sorted
 * by `markedAt` so it reads chronologically — earliest marker first. There is no
 * anonymity: every entry names its Player (ADR 0002). Pass `null`/`undefined` (e.g.
 * the free centre Square, which never tallies) to open no subscription.
 */
export function useTally(itemId: string | null | undefined) {
  const { bannedUids } = useEventModeration(!!itemId);
  const { data, loading, hasServerData } = useColSub<TallyEntry>(
    itemId ? tallyMarkersCol(itemId) : null,
    itemId ? `tally:${itemId}` : 'tally:none',
  );
  // The Admin ban (#108): a banned marker's entry drops from the PUBLIC who-list
  // AND from the derived `count` the Square badge shows — a banned Player's mark is
  // hidden from other Players, mirroring `isReportHidden` elsewhere. Presentational
  // only; the marker doc is untouched, and admin surfaces do not read this hook.
  const markers = [...data]
    .filter((m) => !isBanned(m.uid, bannedUids))
    .sort((a, b) => a.markedAt - b.markedAt);
  return { markers, count: markers.length, loading, hasServerData };
}

/** The signed-in User's global profile (`users/{uid}`) — display name + avatar. */
export function useMyUser(uid: string | undefined) {
  return useDocSub<UserDoc>(uid ? userRef(uid) : null, `user:${uid ?? 'none'}`);
}

export function useLeaderboard() {
  // `hasServerData` is the roster's server-confirmed latch (see useColSub): Board's
  // First-to-BINGO edge only claims the ceremonial Moment against a server-backed
  // roster, since an initial empty `players` from a still-loading (or cache-only)
  // subscription is not proof nobody has bingoed yet (Codex P2, PR #99). The
  // Leaderboard view ignores it and reads only `players`/`loading`.
  //
  // This roster is deliberately RAW — UNfiltered by the Admin ban (#108). It is the
  // SHARED source of BOTH the Leaderboard VIEW and Board's First-to-BINGO
  // determination, and those two need OPPOSITE treatment of a ban: filtering banned
  // players HERE would let a later Player retroactively become "first to BINGO"
  // after the original first Player is banned — rewriting a factual historical event
  // (a ban never changes who was first to BINGO; that already happened). So the ban
  // is a PRESENTATIONAL filter applied by the Leaderboard COMPONENT for display only
  // (src/components/Leaderboard.tsx, via `isBanned`), while this hook stays raw so
  // Board's ceremony reads the true roster. See specs/w2-ban-console.md § Leaderboard.
  const { data, loading, hasServerData } = useColSub<PlayerDoc>(playersCol(), 'players');
  return { players: sortPlayers(data), loading, hasServerData };
}

export function useProofFeed(max = 60) {
  // Two layers hide a Proof from the public Feed. (1) The Admin hard-hide: only
  // 'active' proofs are readable by non-admins (firestore.rules), so a status
  // flip to 'hidden' removes it server-side — the Phase-0 override. (2) The ADR
  // 0004 Phase 0 community auto-hide, added here: a Proof whose `reportCount` has
  // reached the event's `reportHideThreshold` self-hides on EVERY client the
  // moment the counter crosses — a presentational emergency hide that works with
  // no Admin awake and is bypassable by design (tamper-proof server enforcement
  // is #43). The doc is untouched; `useReportedProofs` stays UNfiltered so an
  // Admin can still reach a threshold-hidden Proof to restore or delete it. This
  // one chokepoint also covers the merged Feed's proof side — `useFeed` composes
  // `useProofFeed`, so a Moment (no `reportCount`) is never touched.
  const { threshold, bannedUids } = useEventModeration();
  const { data, loading } = useColSub<ProofDoc>(
    query(proofsCol(), where('status', '==', 'active')),
    'proofs',
  );
  // Plus the Admin ban (#108): a Proof authored by a banned uid drops from the
  // public Feed (and, through `useFeed`, the merged stream) by its OWNER — the same
  // presentational hide `useReportedProofs` (Admin) deliberately does NOT apply.
  const proofs = data
    .filter((p) => !isReportHidden(p.reportCount, threshold) && !isBanned(p.uid, bannedUids))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, max);
  return { proofs, loading };
}

/**
 * The Feed's Moments (ADR 0002): the broadcast BINGO / Blackout / First-to-BINGO
 * beats. Subscribes through the SAME `useColSub` latch pattern as the proof
 * stream (`{ includeMetadataChanges: true }`, `hasServerData` latched on the
 * first server-backed snapshot), newest-first, capped to `max` so the Feed stays
 * light on ship wifi. Moments are public-read; unlike proofs there is no status
 * filter — a Moment has no lifecycle, it just happened.
 */
export function useMoments(max = 60) {
  const { bannedUids } = useEventModeration();
  const { data, loading } = useColSub<MomentDoc>(momentsCol(), 'moments');
  // The Admin ban (#108): a banned Player's broadcast beats drop from the public
  // Feed by their `uid`, mirroring the proof side above so the whole merged Feed
  // (`useFeed`) is consistent. Presentational only; admin surfaces do not read this.
  const moments = data
    .filter(hasCanonicalMomentId)
    .filter((m) => !isBanned(m.uid, bannedUids))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, max);
  return { moments, loading };
}

/**
 * The rules intentionally allow caller-chosen Moment document ids, so the read
 * side enforces the deterministic ids the writer relies on before anything can
 * render in the public Feed.
 */
export function hasCanonicalMomentId(moment: MomentDoc): boolean {
  // Singleton, event-wide beats: one doc per Event, id === kind. `first_bingo`
  // is the Phase 1 cruise honor; `last_call`/`podium` are the Phase 1.5 finale
  // beats the scheduler (#202/#217) posts — without them here the finale
  // Moments would be dropped before ProofFeed ever renders them.
  if (
    moment.kind === 'first_bingo' ||
    moment.kind === 'last_call' ||
    moment.kind === 'podium'
  ) {
    return moment.id === moment.kind;
  }
  if (moment.kind === 'bingo' || moment.kind === 'blackout') {
    return moment.id === `${moment.uid}-${moment.kind}`;
  }
  return false;
}

/**
 * One Feed entry — a Proof or a Moment — tagged so the renderer (ProofFeed) can
 * branch, with `createdAt` hoisted so the merge sorts one flat stream. A Proof
 * keeps its report/delete affordances; a Moment renders as a celebratory line
 * with no media (ADR 0002).
 */
export type FeedEntry =
  | { feedKind: 'proof'; createdAt: number; proof: ProofDoc }
  | { feedKind: 'moment'; createdAt: number; moment: MomentDoc };

/**
 * Merge Proofs and Moments into ONE newest-first stream (ADR 0002), capped to
 * `max` — the honest Feed. Pure (no Firestore, no clock) so the interleave/cap is
 * unit-testable and shared as the single source of Feed order. Each input is
 * already its kind's newest-`max`, so the merged newest-`max` is exact. A bare
 * Mark writes neither a Proof nor a Moment, so it contributes nothing here.
 */
export function mergeFeed(proofs: ProofDoc[], moments: MomentDoc[], max = 60): FeedEntry[] {
  const entries: FeedEntry[] = [
    ...proofs.map((proof) => ({ feedKind: 'proof' as const, createdAt: proof.createdAt, proof })),
    ...moments.map((moment) => ({ feedKind: 'moment' as const, createdAt: moment.createdAt, moment })),
  ];
  return entries.sort((a, b) => b.createdAt - a.createdAt).slice(0, max);
}

/**
 * The combined Feed (ADR 0002): Proofs + Moments merged newest-first, capped.
 * Composes `useProofFeed` + `useMoments` (each with its own latched subscription)
 * and folds them through `mergeFeed`; it does not open a subscription of its own.
 * `loading` stays true until BOTH streams have delivered a first snapshot so the
 * empty state never flashes before one half arrives.
 */
export function useFeed(max = 60) {
  const { proofs, loading: proofsLoading } = useProofFeed(max);
  const { moments, loading: momentsLoading } = useMoments(max);
  return { entries: mergeFeed(proofs, moments, max), loading: proofsLoading || momentsLoading };
}

export function usePendingClaims() {
  const { data, loading } = useColSub<ClaimDoc>(claimsCol(), 'claims');
  const claims = data.filter((c) => c.status === 'pending').sort((a, b) => a.createdAt - b.createdAt);
  return { claims, loading };
}

/**
 * The Admin Approvals queue (#210, daily-cards-spec § "Item pools and the
 * approval flow"): every main-pool Prompt awaiting an admin decision, oldest
 * first (so the longest-waiting submission floats to the top — mirrors
 * `usePendingClaims`'s shape, per the ticket's implementation note). Scoped
 * `where('status','==','pending')` so every matched doc satisfies the ADMIN arm
 * of the items read rule with a single-field equality — no composite index. This
 * is its own subscription (not a client-side filter over `useAllItems`) so the
 * Approvals tab does not re-filter the WHOLE items collection (every status,
 * every pool) on every render just to find the handful of pending rows.
 */
export function usePendingItems() {
  const { data, loading } = useColSub<ItemDoc>(
    query(itemsCol(), where('status', '==', 'pending')),
    'items-pending',
  );
  const items = [...data].sort((a, b) => a.createdAt - b.createdAt);
  return { items, loading };
}

/**
 * The signed-in Player's OWN pending main-pool Prompts (#210): "a submitter's own
 * pending items should still render in their list, visibly marked pending, not
 * silently vanish after Add." `useItems` only reads `status == 'active'`, so a
 * fresh `pending` submission would otherwise disappear from ItemPool the instant
 * it is added. Scoped `where('createdBy','==',uid)` + `where('status','==',
 * 'pending')` — BOTH equality clauses (mirrors `useMyProofs`'s same two-equality
 * shape), so this rides the existing single-field indexes and needs NO composite
 * index, and every matched doc satisfies the read rule's submitter carve-out
 * (`status == 'pending' && createdBy == request.auth.uid`) without touching the
 * ADMIN arm. Pass `null`/`undefined` (signed-out) to open no subscription.
 */
export function useMyPendingItems(uid: string | null | undefined) {
  const { data, loading } = useColSub<ItemDoc>(
    uid ? query(itemsCol(), where('createdBy', '==', uid), where('status', '==', 'pending')) : null,
    uid ? `items-pending-mine:${uid}` : 'items-pending-mine:none',
  );
  const items = [...data].sort((a, b) => a.createdAt - b.createdAt);
  return { items, loading };
}

/**
 * The signed-in Player's OWN Claims (#41). Scoped `where('uid','==',uid)` so every
 * matched doc satisfies the claims read rule (`isOwner(resource.data.uid)`) — a
 * Player is NOT an admin, so an unconstrained collection read would be denied.
 * `ConfirmWinMoments` consumes this to notice when one of the Player's pending
 * Marks is confirmed by an Admin, so it can emit the win's Moment wherever the
 * Player is (the confirm-path edge Board's route-scoped detection misses). The
 * `hasServerData` latch gates the baseline: the first server-backed snapshot's
 * already-confirmed Claims are history, not fresh confirms to announce.
 */
export function useMyClaims(uid: string | undefined) {
  const { data, loading, hasServerData, fromCache } = useColSub<ClaimDoc>(
    uid ? query(claimsCol(), where('uid', '==', uid)) : null,
    `my-claims:${uid ?? 'none'}`,
  );
  // `fromCache` lets `ConfirmWinMoments` seed its freshness witness ONLY from a
  // server-backed pending observation (Codex #116 R2 finding 2): a cache-only
  // pending snapshot on a fresh reload must not make a confirm that landed while
  // the app was closed look like an in-session pending→confirmed flip.
  return { claims: data, loading, hasServerData, fromCache };
}

/**
 * The count for the More menu's Admin row badge (#208, daily-cards-spec §
 * "More menu" § Admin): Prompts awaiting approval (`ItemDoc.status ===
 * 'pending'`, the #200 schema / #210 write-path approval flow). Deliberately
 * its OWN small subscription rather than reusing `useAllItems` — an admin-
 * only read (`firestore.rules`: "Pending/rejected items readable only by
 * admins + submitter") that More mounts unconditionally alongside the rest of
 * the menu, so it must stay cheap and must never open for a non-admin. Pass
 * `enabled=false` (a non-admin viewer) to open NO subscription — mirrors
 * `useItems`'s `enabled` gate. 0/hidden until #210 starts writing pending
 * items is expected, not broken (the field itself shipped with #200, before
 * anything writes it).
 */
export function usePendingItemCount(enabled = true) {
  const { data, loading } = useColSub<ItemDoc>(
    enabled ? query(itemsCol(), where('status', '==', 'pending')) : null,
    enabled ? 'items-pending' : 'items-pending:disabled',
  );
  return { count: data.length, loading };
}

/**
 * Admin views: everything, including hidden/reported. Deliberately applies
 * NEITHER hide — not the `status` hard-hide, not the ADR 0004 Phase 0 threshold
 * auto-hide — so an Admin can reach content the community auto-hide has removed
 * from every Player's pool and restore or delete it. Sorted most-reported-first
 * so the moderation-priority Prompts float to the top. If this view ALSO applied
 * the threshold filter, a threshold-hidden Prompt would vanish from the console
 * too and no Admin could ever act on it — the exact failure ADR 0004 warns of.
 */
export function useAllItems() {
  const { data, loading } = useColSub<ItemDoc>(itemsCol(), 'items-admin');
  return { items: data.sort((a, b) => b.reportCount - a.reportCount), loading };
}

/**
 * The Proof moderation queue: every Proof needing admin attention, most-reported-
 * first. Queue membership is reported (`reportCount > 0`) OR `flagged` OR
 * hard-hidden (`status === 'hidden'`) — hidden content belongs in the queue
 * regardless of its count. The hidden arm is load-bearing (Codex P2, PR #107
 * round 2): unlike Prompts, whose `useAllItems` lists EVERY Prompt, there is no
 * all-proofs admin list, so this queue is the ONLY admin surface for Proofs.
 * Without it, an admin who Clear-reports a doubly-hidden Proof (status 'hidden'
 * AND over the threshold) BEFORE restoring drops its reportCount to 0 and the
 * still-hidden Proof would vanish from the console with no UI path to restore or
 * delete it — the clear-then-restore ordering must never orphan anything.
 * Like `useAllItems` it is UNfiltered by the ADR 0004 Phase 0 threshold — a Proof
 * whose `reportCount` has crossed `reportHideThreshold` (and so self-hid on every
 * Player's Feed via `useProofFeed`) still surfaces here so an Admin can reach it
 * (any count at/over a POSITIVE threshold is > 0, so the reported arm is a strict
 * superset of the auto-hidden set). The subscription is the one broad admin read
 * of the whole collection (no `where()`), so the OR is a pure client-side filter —
 * no second listener, no composite index.
 */
export function useReportedProofs() {
  const { data, loading } = useColSub<ProofDoc>(proofsCol(), 'proofs-admin');
  const flagged = data
    .filter((p) => p.reportCount > 0 || p.status === 'flagged' || p.status === 'hidden')
    .sort((a, b) => b.reportCount - a.reportCount);
  return { flagged, loading };
}

/**
 * A Prompt's Doubts (ADR 0001): every "pics or it didn't happen" raised against
 * `itemId`, newest-last (sorted by `createdAt` so the who-list reads
 * chronologically, like `useTally`). Subscribes through the SAME `useColSub`
 * latch pattern as the Tally + Feed (`{ includeMetadataChanges: true }`, the
 * `hasServerData` latch on the first server-backed snapshot), filtered to the one
 * Prompt so the Square badge + Tally sheet read only what they render. Pass
 * `null`/`undefined` (e.g. the free centre Square, which never tallies or doubts)
 * to open no subscription. Whether a given Doubt is OPEN vs SATISFIED is a PURE
 * derivation over the Feed's Proofs (`openDoubts`/`doubtStatusFor` in
 * src/data/doubts.ts) — this hook only streams the raw Doubts; it never gates,
 * blocks, or mutates a Mark (a Doubt is social pressure, never a gate).
 *
 * `viewerUid` is the signed-in Player whose board this read serves (Board passes it
 * for both the per-Square DoubtBadge and the TallySheet). It makes the target-side
 * ban filter VIEWER-AWARE (see below).
 */
export function useDoubts(itemId: string | null | undefined, viewerUid?: string | null) {
  const { bannedUids } = useEventModeration(!!itemId);
  const { data, loading, hasServerData } = useColSub<DoubtDoc>(
    itemId ? query(doubtsCol(), where('itemId', '==', itemId)) : null,
    itemId ? `doubts:${itemId}` : 'doubts:none',
  );
  // The Admin ban (#108), with the own-content exception mirroring `useMyProofs`
  // (Codex P2, PR #122 round 2): a ban hides content from OTHERS, not from oneself.
  //  - `fromUid` banned → ALWAYS hidden (a banned accuser's Doubts vanish for
  //    everyone, themselves included — the accusation is content aimed at others).
  //  - `targetUid` banned → hidden EXCEPT when the target IS the current viewer.
  //    From another Player's board the banned target's presence stays hidden (their
  //    Mark is already gone from `useTally`, so a Doubt about it would dangle), but
  //    a banned Player viewing their OWN board must still SEE and be able to answer
  //    a Doubt raised against them — otherwise the ban would silence accusations
  //    against them in their own UI, which the own-content exception forbids.
  // Presentational only; admin surfaces do not read this hook.
  const doubts = [...data]
    .filter((d) => {
      if (isBanned(d.fromUid, bannedUids)) return false;
      if (isBanned(d.targetUid, bannedUids) && d.targetUid !== viewerUid) return false;
      return true;
    })
    .sort((a, b) => a.createdAt - b.createdAt);
  return { doubts, count: doubts.length, loading, hasServerData };
}

/**
 * The signed-in viewer's OWN active Proofs (Codex P2 finding 4, #106). This is the
 * ONLY set a viewer-scoped `DoubtBadge` needs: a Doubt AGAINST THE VIEWER is
 * answered exactly when the viewer has a Proof for the doubted Prompt (by itemText)
 * at or after it, so the badge only ever consults the viewer's own Proofs. A
 * `where('uid','==',uid)` + `where('status','==','active')` query — BOTH equality
 * clauses, so it rides the existing single-field indexes and needs NO composite
 * index (firestore.indexes.json is untouched). The `status == 'active'` clause is
 * also required for the read to be ALLOWED (the proofs read rule gates non-admins
 * to active proofs, so an unfiltered own-proofs query would be rejected). Replaces
 * the Board-wide `useProofFeed` the badge used to consume — a Card mount no longer
 * opens an all-Players proof stream. Pass `null`/`undefined` (signed-out) to open
 * no subscription.
 *
 * Applies the SAME ADR 0004 community auto-hide as `useProofFeed` (`isReportHidden`
 * against `useReportHideThreshold` — Codex P2, PR #106 round 4): a Proof the group
 * can no longer see in the public Feed must not satisfy a Doubt either, or the
 * badge would clear ("answered") on evidence nobody can inspect — if the group
 * cannot see the proof, it cannot answer the accusation. Fail-open like #107: a
 * missing/non-positive threshold filters nothing.
 */
export function useMyProofs(uid: string | null | undefined) {
  // Threshold only, no ban filter (#108): this is the VIEWER'S OWN content shown in
  // the viewer's OWN Doubt-badge derivation, and a ban is PRESENTATIONAL — it hides
  // a Player's content from OTHERS, not from themselves. So a banned viewer's own
  // Proofs still answer Doubts against them in their own UI; the ban takes effect on
  // the PUBLIC-facing reads (useProofFeed / useProofsForItemText) where OTHERS see
  // this content. See specs/w2-ban-console.md § Filtered surfaces.
  const { threshold } = useEventModeration();
  const { data, loading, hasServerData } = useColSub<ProofDoc>(
    uid ? query(proofsCol(), where('uid', '==', uid), where('status', '==', 'active')) : null,
    uid ? `proofs:mine:${uid}` : 'proofs:mine:none',
  );
  const proofs = data.filter((p) => !isReportHidden(p.reportCount, threshold));
  return { proofs, loading, hasServerData };
}

/**
 * The active Proofs for ONE Prompt (Codex P2 finding 4, #106), for the Tally
 * sheet's per-marker Doubt status. Joined by `itemText` — the SAME (uid, itemText)
 * key the Doubt derivation uses, because a ProofDoc carries no itemId (see
 * specs/w2-doubts.md) — via a `where('itemText','==',itemText)` +
 * `where('status','==','active')` query, BOTH equality, so NO composite index is
 * required. Mounted only WHILE the sheet is open (the sheet renders this hook), so
 * no proof listener exists per-cell or Board-wide. Pass `null`/`undefined` to open
 * no subscription.
 *
 * Applies the SAME ADR 0004 community auto-hide as `useProofFeed` (`isReportHidden`
 * against `useReportHideThreshold` — Codex P2, PR #106 round 4): the sheet must not
 * render "Proof shown ✓" for a Proof the public Feed has community-hidden — if the
 * group cannot see the proof, it cannot answer the accusation. Fail-open like
 * #107: a missing/non-positive threshold filters nothing.
 */
export function useProofsForItemText(itemText: string | null | undefined) {
  const { threshold, bannedUids } = useEventModeration();
  const { data, loading, hasServerData } = useColSub<ProofDoc>(
    itemText
      ? query(proofsCol(), where('itemText', '==', itemText), where('status', '==', 'active'))
      : null,
    itemText ? `proofs:item:${itemText}` : 'proofs:item:none',
  );
  // This is a PUBLIC-facing read — the Tally sheet renders it for EVERY viewer to
  // show which markers have shown a Proof — so unlike `useMyProofs` it DOES apply
  // the Admin ban (#108): a banned Player's Proof must not render "Proof shown ✓" in
  // another Player's Tally sheet. Filtered by the Proof's owner `uid`, composed with
  // the community auto-hide.
  const proofs = data.filter(
    (p) => !isReportHidden(p.reportCount, threshold) && !isBanned(p.uid, bannedUids),
  );
  return { proofs, loading, hasServerData };
}
