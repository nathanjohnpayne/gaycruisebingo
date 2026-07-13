import { doc, getDocFromCache, setDoc } from 'firebase/firestore';
import { db, EVENT_ID } from '../firebase';
import { markerDisplayName } from './attribution';
import type { MomentActor } from './moments';
import type { DayMetaDoc } from '../types';

// Per-Day honor write (daily-cards-spec § "Scoring and social surfaces", #212).
// This module owns the WRITE-ONCE per-Day First to BINGO honor at
// events/{eventId}/days/{dayIndex}/meta/{dayIndex}. It mirrors moments.ts's
// offline-queueable, fire-and-forget, create-only-with-cache-precheck pattern —
// the write pends durably in the persistent cache when offline (ADR 0006) and is
// never awaited on the render path, and its once-only guarantee is STRUCTURAL
// (a deterministic doc id + a firestore.rules create-only-no-update gate), not a
// race we hope to win.
//
// The OTHER per-Day social surface the aggregation ticket names — the per-card
// blackout Moment that names its Day — lives in `moments.ts`'s `broadcastBlackout`
// (an optional `dayIndex` param), not here: Board/ConfirmWinMoments already call
// `broadcastBlackout` for every blackout, so extending that single writer was the
// lower-risk path versus introducing a second, easy-to-miss blackout writer for
// callers to choose between (fix/d15-blackout-day-naming).

// Raw (converter-free) ref for writes, matching api.ts/moments.ts. The day-meta
// doc id IS the dayIndex (a `meta` subcollection holding one document per Day —
// see DayMetaDoc / firestore.rules § days/{dayIndex}/meta), so the payload has no
// id field.
const rawDayMeta = (dayIndex: number) =>
  doc(db, 'events', EVENT_ID, 'days', String(dayIndex), 'meta', String(dayIndex));

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

// --- Held honor pins (#264/#280) -------------------------------------------------
//
// A bingo landing while the winner's saved identity is still resolving cannot
// pin (a permanent public honor must never stamp 'Anonymous'), so the pin is
// HELD and released the moment that account's identity resolves. MODULE state
// — not a component ref — for the same reason the pending-Moment queue is
// (specs/w2-feed-moments.md, issue #104): the hold must survive Board
// unmounts and route changes. Keyed to the acted account; in-memory only (a
// reload loses it — the honors strip's derived fallback covers the residual).

interface HeldHonorPin {
  uid: string;
  dayIndex: number;
  at: number;
}

let heldHonorPins: HeldHonorPin[] = [];

export function enqueueHeldHonorPin(uid: string, dayIndex: number, at: number): void {
  heldHonorPins.push({ uid, dayIndex, at });
}

/** Drain and return the given account's holds (other accounts' stay queued). */
export function takeHeldHonorPins(uid: string): HeldHonorPin[] {
  const mine = heldHonorPins.filter((h) => h.uid === uid);
  heldHonorPins = heldHonorPins.filter((h) => h.uid !== uid);
  return mine;
}

/** Test-only. */
export function __resetHeldHonorPinsForTests(): void {
  heldHonorPins = [];
}
