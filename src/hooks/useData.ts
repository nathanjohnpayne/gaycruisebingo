import { useEffect, useState } from 'react';
import { onSnapshot, query, where, type DocumentReference, type Query } from 'firebase/firestore';
import { eventRef, itemsCol, boardRef, playerRef, playersCol, proofsCol, claimsCol, userRef, tallyMarkersCol, momentsCol, doubtsCol } from '../data/paths';
import { isReportHidden } from '../data/moderation';
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
  useEffect(() => {
    // Drop the previous query's rows when the key changes so stale results can't
    // render against the new subscription.
    setData([]);
    setHasServerData(false);
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
        if (!snap.metadata.fromCache) setHasServerData(true);
      },
      () => setLoading(false),
    );
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return { data, loading, hasServerData };
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

/**
 * The Event's community auto-hide threshold (`settings.reportHideThreshold`,
 * seeded 4 — `scripts/seed.mjs`), read from `useEventDoc()` so EVERY client
 * computes the SAME presentational hide with no Admin online (ADR 0004 Phase 0).
 * Returns `undefined` while the event doc is loading or when the setting is unset
 * so callers treat it as "no filtering" (see `isReportHidden`). This is a read of
 * shared config, not a per-client knob — the hide is bypassable by design (a
 * client can patch its bundle to ignore it); tamper-proof server enforcement that
 * flips `status` at the threshold is deferred to #43.
 */
function useReportHideThreshold(): number | undefined {
  const { data: event } = useEventDoc();
  const threshold = event?.settings?.reportHideThreshold;
  return typeof threshold === 'number' ? threshold : undefined;
}

export function useItems(enabled = true) {
  // `enabled` lets Board skip this subscription once a Board is frozen (Codex
  // P3 on PR #66): the pool only matters pre-deal, so a Player who already has
  // a Board has no use for a live listener that fans every other Player's
  // prompt add/report out as a full-pool read + rerender. Toggle the key (not
  // just the query) so the effect re-subscribes if `enabled` flips back to
  // true — mirrors useEventDoc's pre-auth gate above.
  const threshold = useReportHideThreshold();
  const { data, loading, hasServerData } = useColSub<ItemDoc>(
    enabled ? itemsCol() : null,
    enabled ? 'items' : 'items:disabled',
  );
  // Two hides drop a Prompt from the live pool: the Admin hard-hide (`status`
  // flipped off 'active', the Phase-0 override) and the ADR 0004 Phase 0
  // community auto-hide once `reportCount` reaches `reportHideThreshold`.
  // `useAllItems` (Admin) applies NEITHER, so an Admin can still reach and
  // restore threshold-hidden Prompts. Presentational only — the doc is untouched.
  const items = data
    .filter((i) => i.status === 'active' && !isReportHidden(i.reportCount, threshold))
    .sort((a, b) => a.createdAt - b.createdAt);
  return { items, loading, hasServerData };
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
  const { data, loading, hasServerData } = useColSub<TallyEntry>(
    itemId ? tallyMarkersCol(itemId) : null,
    itemId ? `tally:${itemId}` : 'tally:none',
  );
  const markers = [...data].sort((a, b) => a.markedAt - b.markedAt);
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
  const threshold = useReportHideThreshold();
  const { data, loading } = useColSub<ProofDoc>(
    query(proofsCol(), where('status', '==', 'active')),
    'proofs',
  );
  const proofs = data
    .filter((p) => !isReportHidden(p.reportCount, threshold))
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
  const { data, loading } = useColSub<MomentDoc>(momentsCol(), 'moments');
  const moments = data
    .filter(hasCanonicalMomentId)
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
  if (moment.kind === 'first_bingo') return moment.id === 'first_bingo';
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
 */
export function useDoubts(itemId: string | null | undefined) {
  const { data, loading, hasServerData } = useColSub<DoubtDoc>(
    itemId ? query(doubtsCol(), where('itemId', '==', itemId)) : null,
    itemId ? `doubts:${itemId}` : 'doubts:none',
  );
  const doubts = [...data].sort((a, b) => a.createdAt - b.createdAt);
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
  const threshold = useReportHideThreshold();
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
  const threshold = useReportHideThreshold();
  const { data, loading, hasServerData } = useColSub<ProofDoc>(
    itemText
      ? query(proofsCol(), where('itemText', '==', itemText), where('status', '==', 'active'))
      : null,
    itemText ? `proofs:item:${itemText}` : 'proofs:item:none',
  );
  const proofs = data.filter((p) => !isReportHidden(p.reportCount, threshold));
  return { proofs, loading, hasServerData };
}
