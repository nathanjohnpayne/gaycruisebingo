import { useEffect, useState } from 'react';
import { onSnapshot, query, where, type DocumentReference, type Query } from 'firebase/firestore';
import { eventRef, itemsCol, boardRef, playerRef, playersCol, proofsCol, claimsCol } from '../data/paths';
import { sortPlayers } from '../game/logic';
import type { EventDoc, ItemDoc, BoardDoc, PlayerDoc, ProofDoc, ClaimDoc } from '../types';

function useDocSub<T>(ref: DocumentReference<T> | null, key: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    // Drop the previous ref's document so stale data from another subscription
    // (e.g. a different signed-in uid) can't render under the new key.
    setData(null);
    if (!ref) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        setData(snap.exists() ? (snap.data() as T) : null);
        setLoading(false);
      },
      () => setLoading(false),
    );
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return { data, loading };
}

function useColSub<T>(q: Query<T> | null, key: string) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    // Drop the previous query's rows when the key changes so stale results can't
    // render against the new subscription.
    setData([]);
    if (!q) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = onSnapshot(
      q,
      (snap) => {
        setData(snap.docs.map((d) => d.data() as T));
        setLoading(false);
      },
      () => setLoading(false),
    );
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return { data, loading };
}

export function useEventDoc(enabled = true) {
  // `enabled` lets a pre-auth caller (main.tsx) skip the subscription: events
  // require sign-in, so subscribing while signed out only yields a
  // permission-denied error. Toggle the key (not just the ref) so the effect
  // re-runs and subscribes once auth arrives — useDocSub is keyed on `key`.
  return useDocSub<EventDoc>(enabled ? eventRef() : null, enabled ? 'event' : 'event:disabled');
}

export function useItems() {
  const { data, loading } = useColSub<ItemDoc>(itemsCol(), 'items');
  const items = data
    .filter((i) => i.status === 'active')
    .sort((a, b) => a.createdAt - b.createdAt);
  return { items, loading };
}

export function useBoard(uid: string | undefined) {
  return useDocSub<BoardDoc>(uid ? boardRef(uid) : null, `board:${uid ?? 'none'}`);
}

export function useMyPlayer(uid: string | undefined) {
  return useDocSub<PlayerDoc>(uid ? playerRef(uid) : null, `player:${uid ?? 'none'}`);
}

export function useLeaderboard() {
  const { data, loading } = useColSub<PlayerDoc>(playersCol(), 'players');
  return { players: sortPlayers(data), loading };
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
