import { deleteDoc, setDoc } from 'firebase/firestore';
import { heartRef } from './paths';
import { track } from '../analytics';
import { isBanned } from './moderation';
import type { HeartDoc, HeartTargetKind } from '../types';

/**
 * Hearts (specs/feed-hearts.md): one Player's like on a Feed post — a Proof or
 * a Moment. The write model is the Doubt slot's, minus the accusation: ONE
 * deterministic doc per (Player, post), created to heart and deleted to
 * unheart, never updated. Firestore's rules re-check everything this module
 * encodes (own uid, bound id, real target), so the client can stay simple:
 * fire-and-forget writes whose latency-compensated echo flips the UI
 * instantly, with an online rejection rolled back by the listener.
 */

/** The deterministic Heart slot id — `_` joins, same as the Doubt slot: it
 * appears in no Firebase-minted uid and the id is constructed, never parsed. */
export function heartDocId(uid: string, targetKind: HeartTargetKind, targetId: string): string {
  return `${uid}_${targetKind}_${targetId}`;
}

/**
 * Toggle the caller's Heart on a post. `hearted` is the CURRENT state as the
 * viewer's stream shows it: false → create the slot, true → delete it.
 * Fire-and-forget like setMark: offline both legs queue durably in the
 * persistent cache (ADR 0006) and the local echo renders immediately; an
 * online rejection (e.g. a cold-cache cross-tab duplicate landing on the
 * doc-exists update rule) logs and self-corrects when the listener rolls the
 * optimistic doc back. The analytics event fires only once the write
 * PERSISTS (the doubts posture — accurate-but-delayed beats inflated).
 */
export function toggleHeart(params: {
  uid: string;
  targetKind: HeartTargetKind;
  targetId: string;
  hearted: boolean;
}): Promise<void> {
  const { uid, targetKind, targetId, hearted } = params;
  const ref = heartRef(heartDocId(uid, targetKind, targetId));
  if (hearted) {
    return deleteDoc(ref).then(
      () => track('heart_post', { targetKind, on: false }),
      (err: unknown) => {
        console.warn('[hearts] unheart rejected; the listener will re-sync', err);
      },
    );
  }
  const payload: Omit<HeartDoc, 'id'> = {
    uid,
    targetKind,
    targetId,
    createdAt: Date.now(),
  };
  return setDoc(ref, payload).then(
    () => track('heart_post', { targetKind, on: true }),
    (err: unknown) => {
      console.warn('[hearts] heart rejected; the listener will re-sync', err);
    },
  );
}

/** A post's heart state as ONE derivation (pure — unit-tested directly):
 * the visible count and whether the viewer is among the hearts. Ban semantics
 * mirror useAllDoubts' fromUid arm with the own-content exception: a banned
 * Player's hearts vanish from everyone else's counts, but their OWN heart
 * stays visible to themselves — otherwise their button would read unhearted
 * while the slot doc still exists, and the retap would land on the doc-exists
 * update rule forever. */
export function heartState(
  hearts: readonly Pick<HeartDoc, 'uid' | 'targetKind' | 'targetId'>[],
  targetKind: HeartTargetKind,
  targetId: string,
  viewerUid: string | undefined,
  bannedUids: readonly string[] = [],
): { count: number; hearted: boolean } {
  let count = 0;
  let hearted = false;
  for (const h of hearts) {
    if (h.targetKind !== targetKind || h.targetId !== targetId) continue;
    if (isBanned(h.uid, bannedUids) && h.uid !== viewerUid) continue;
    count += 1;
    if (viewerUid != null && h.uid === viewerUid) hearted = true;
  }
  return { count, hearted };
}
