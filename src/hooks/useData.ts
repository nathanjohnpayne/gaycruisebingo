import { useEffect, useState } from 'react';
import { onSnapshot, query, where, type DocumentReference, type Query } from 'firebase/firestore';
import { eventRef, itemsCol, boardRef, playerRef, playersCol, proofsCol, claimsCol, userRef, tallyMarkersCol, momentsCol } from '../data/paths';
import { sortPlayers } from '../game/logic';
import type { EventDoc, ItemDoc, BoardDoc, PlayerDoc, ProofDoc, ClaimDoc, UserDoc, TallyEntry, MomentDoc } from '../types';

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

export function useItems(enabled = true) {
  // `enabled` lets Board skip this subscription once a Board is frozen (Codex
  // P3 on PR #66): the pool only matters pre-deal, so a Player who already has
  // a Board has no use for a live listener that fans every other Player's
  // prompt add/report out as a full-pool read + rerender. Toggle the key (not
  // just the query) so the effect re-subscribes if `enabled` flips back to
  // true — mirrors useEventDoc's pre-auth gate above.
  const { data, loading, hasServerData } = useColSub<ItemDoc>(
    enabled ? itemsCol() : null,
    enabled ? 'items' : 'items:disabled',
  );
  const items = data
    .filter((i) => i.status === 'active')
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
  // Only 'active' proofs are readable by non-admins (see firestore.rules);
  // hidden/flagged proofs stay admin-only rather than being filtered client-side.
  const { data, loading } = useColSub<ProofDoc>(
    query(proofsCol(), where('status', '==', 'active')),
    'proofs',
  );
  const proofs = data.sort((a, b) => b.createdAt - a.createdAt).slice(0, max);
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
  const moments = data.sort((a, b) => b.createdAt - a.createdAt).slice(0, max);
  return { moments, loading };
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

/** Admin views: everything, including hidden/reported. */
export function useAllItems() {
  const { data, loading } = useColSub<ItemDoc>(itemsCol(), 'items-admin');
  return { items: data.sort((a, b) => b.reportCount - a.reportCount), loading };
}

export function useReportedProofs() {
  const { data, loading } = useColSub<ProofDoc>(proofsCol(), 'proofs-admin');
  const flagged = data
    .filter((p) => p.reportCount > 0 || p.status === 'flagged')
    .sort((a, b) => b.reportCount - a.reportCount);
  return { flagged, loading };
}
