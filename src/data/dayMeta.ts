import { doc, getDocFromCache, setDoc } from 'firebase/firestore';
import { db, EVENT_ID } from '../firebase';
import { markerDisplayName } from './attribution';
import type { MomentActor } from './moments';
import type { DayMetaDoc, MomentDoc } from '../types';

// Per-Day honor + day-scoped blackout writes (daily-cards-spec § "Scoring and
// social surfaces", #212). This module owns the two per-Day social surfaces the
// aggregation ticket writes: (1) the WRITE-ONCE per-Day First to BINGO honor at
// events/{eventId}/days/{dayIndex}/meta/{dayIndex}, and (2) the per-card blackout
// Moment that names the Day it happened on. Both mirror moments.ts's
// offline-queueable, fire-and-forget, create-only-with-cache-precheck pattern —
// the write pends durably in the persistent cache when offline (ADR 0006) and is
// never awaited on the render path, and its once-only guarantee is STRUCTURAL
// (a deterministic doc id + a firestore.rules create-only-no-update gate), not a
// race we hope to win.

// Raw (converter-free) refs for writes, matching api.ts/moments.ts. The day-meta
// doc id IS the dayIndex (a `meta` subcollection holding one document per Day —
// see DayMetaDoc / firestore.rules § days/{dayIndex}/meta), so the payload has no
// id field.
const rawDayMeta = (dayIndex: number) =>
  doc(db, 'events', EVENT_ID, 'days', String(dayIndex), 'meta', String(dayIndex));
const rawMoment = (id: string) => doc(db, 'events', EVENT_ID, 'moments', id);

/**
 * Pin a Day's First to BINGO honor, WRITE-ONCE (daily-cards-spec § "Data model").
 * The honor doc at `days/{dayIndex}/meta/{dayIndex}` is create-only with NO update
 * path in firestore.rules — so the first achieving Player's create wins and every
 * later write (a second Player, or the same Player re-marking) lands on the
 * deny-all update rule and is denied. Each Day's honor is INDEPENDENT of every
 * other Day's: a distinct doc per Day index, so pinning Day 4 never touches Day 2.
 *
 * Fire-and-forget and offline-queueable, mirroring moments.ts: a cache pre-check
 * skips the write when the honor is already claimed locally (so latency
 * compensation can't briefly overwrite it), and on a cache miss the create-only
 * rule is the structural backstop. `at` is the ms-epoch time of the pinned bingo
 * (the Feed/board render reads it); the display name is bounded through the shared
 * `markerDisplayName` helper to the rules' non-empty ≤100-char contract.
 */
export async function pinDayFirstBingo(
  dayIndex: number,
  who: MomentActor,
  at: number = Date.now(),
): Promise<void> {
  const ref = rawDayMeta(dayIndex);
  try {
    const cached = await getDocFromCache(ref);
    if (cached.exists()) {
      console.debug('[dayMeta] first-bingo pin skipped — Day honor already in local cache', {
        dayIndex,
        uid: who.uid,
      });
      return;
    }
  } catch {
    // Not in the local cache — no honor to protect; proceed with the create.
  }
  const payload: DayMetaDoc = {
    firstBingo: { uid: who.uid, displayName: markerDisplayName(who.displayName, undefined), at },
  };
  await setDoc(ref, payload).catch((err: unknown) => {
    // Not the offline case (offline the write PENDS and drains on reconnect, ADR
    // 0006). A rejection is a genuine online failure OR the once-only backstop —
    // a second pin of an already-claimed Day hitting the deny-all update rule.
    // Either way it must not vanish silently; log with context.
    console.error('[dayMeta] first-bingo pin rejected', { dayIndex, uid: who.uid }, err);
  });
}

/**
 * Broadcast the per-card blackout Moment that NAMES the Day it happened on
 * (daily-cards-spec § "Implementation notes": "blacked out Day 4 · 🏛️ Glamiators").
 * A blackout Moment carries the deterministic id `${uid}-blackout` (create-only +
 * immutable per firestore.rules § moments), so it is structurally once per Player;
 * the `dayIndex` on the payload is what lets the Feed read the Day and theme. Same
 * fire-and-forget, cache-pre-checked write as `moments.ts`'s broadcasts.
 */
export function broadcastDayBlackout(who: MomentActor, dayIndex: number): void {
  void writeDayBlackoutOnce(who, dayIndex);
}

async function writeDayBlackoutOnce(who: MomentActor, dayIndex: number): Promise<void> {
  const ref = rawMoment(`${who.uid}-blackout`);
  try {
    const cached = await getDocFromCache(ref);
    if (cached.exists()) {
      console.debug('[dayMeta] blackout broadcast skipped — Moment already in local cache', {
        dayIndex,
        uid: who.uid,
      });
      return;
    }
  } catch {
    // Not in the local cache — no duplicate to protect; proceed with the write.
  }
  const payload: Omit<MomentDoc, 'id'> = {
    kind: 'blackout',
    uid: who.uid,
    displayName: markerDisplayName(who.displayName, undefined),
    photoURL: who.photoURL,
    createdAt: Date.now(),
    dayIndex,
  };
  await setDoc(ref, payload).catch((err: unknown) => {
    console.error('[dayMeta] blackout broadcast rejected', { dayIndex, uid: who.uid }, err);
  });
}
