import { doc, getDocFromCache, setDoc } from 'firebase/firestore';
import { db, EVENT_ID } from '../firebase';
import { markerDisplayName } from './attribution';
import type { MomentDoc, MomentKind } from '../types';

// Moments (ADR 0002): a broadcast of a big social beat — a BINGO, a Blackout, or
// the First to BINGO — posted to the Feed for everyone. Unlike a Proof, a Moment
// carries NO attached evidence: it marks *that* something happened, not what it
// looked like, so its payload is EXACTLY the MomentDoc contract — no media, no
// `mediaURL`/`storagePath`, no `proofId`. A bare Mark broadcasts nothing here
// (ADR 0002): only these three edges do. Writes mirror the mark path's
// offline-queueable, fire-and-forget style (setMark in src/data/api.ts): a
// `setDoc` pends durably in the persistent cache when offline (ADR 0006) and the
// promise is intentionally not awaited — `void … .catch(console.error)` so a
// broadcast never blocks the celebration UI, and an ONLINE rejection is logged
// (never silently swallowed) rather than surfaced as a retry.

// Raw (converter-free) moment ref for writes, matching api.ts's rawPlayer/rawBoard
// and proofs.ts's rawProof — the read side attaches `momentConverter` via
// `momentsCol`/`momentRef` (src/data/paths.ts).
const rawMoment = (id: string) => doc(db, 'events', EVENT_ID, 'moments', id);

/**
 * The event-singleton doc id for the ceremonial "First to BINGO" Moment. Because
 * the moments rules block does NOT constrain `momentId` (see firestore.rules
 * § moments), the doc id is CALLER-CHOSEN — the strongest dedup the rules allow.
 * A fixed per-event id makes "First to BINGO" structurally ONCE per Event: the
 * first writer's create wins, and any later writer hits the doc-exists `update`
 * rule, which is DENIED for everyone — a Moment is fully immutable (see
 * firestore.rules § moments, PR #99 finding 4) — so their write is denied and
 * swallowed (see `broadcast`). This is the honest, ceremonial, self-reported honour (ADR 0001):
 * under an offline/latency race two Players may each briefly believe they are
 * first and each optimistically show their own local Moment, but exactly one
 * create reaches the server and both clients converge on it. The value cannot
 * collide with a per-Player id (`${uid}-bingo` / `${uid}-blackout` use a hyphen
 * before the kind; this uses an underscore and no uid prefix).
 */
export const FIRST_BINGO_MOMENT_ID = 'first_bingo';

/**
 * The identity a Moment is attributed to — the SAME resolved public identity a
 * Mark's Tally marker and a Proof carry (ADR 0002), so the Feed, the leaderboard,
 * and the Tally never diverge. Board resolves it once via `resolveDisplayName`
 * (the saved player-row name, else auth, else 'Anonymous').
 */
export interface MomentActor {
  uid: string;
  displayName: string;
  photoURL: string | null;
}

/**
 * Write one Moment, fire-and-forget and offline-queueable (ADR 0002 + ADR 0006).
 *
 * `id` is deterministic so the dedup is STRUCTURAL, not a race we hope to win:
 * the moments rules block allows `create` (own-uid, valid kind/displayName/
 * createdAt) but DENIES `update` entirely (a Moment is immutable; moderation is
 * delete-only, with a status field deferred to #37/#41), so re-broadcasting an
 * already written id lands on the `update` rule and is denied — for admins exactly
 * like everyone else, so a second first-BINGO for the same Player, or a duplicate
 * First-to-BINGO, can never post. The Board edge
 * refs (`wasBingo`/`wasBlackout`) are the first line (no re-fire within a session
 * or across a reload); this create-only id is the structural backstop for reloads,
 * multiple tabs, and the First-to-BINGO race.
 *
 * The payload is EXACTLY `Omit<MomentDoc, 'id'>` (the id is the doc id): no media
 * and no `proofId` ever reach a Moment. `displayName` is bounded through the
 * shared `markerDisplayName` helper to the rules' non-empty ≤100-char contract so
 * a broadcast can never be rejected for a malformed name (the auth-fallback name
 * `resolveDisplayName` yields is not itself length-capped).
 */
function broadcast(id: string, kind: MomentKind, who: MomentActor): void {
  const payload: Omit<MomentDoc, 'id'> = {
    kind,
    uid: who.uid,
    displayName: markerDisplayName(who.displayName, undefined),
    photoURL: who.photoURL,
    createdAt: Date.now(),
  };
  void setDoc(rawMoment(id), payload).catch((err: unknown) => {
    // Not the offline case: offline the write PENDS in the persistent cache and
    // drains on reconnect (ADR 0006). A rejection is either a genuine online
    // failure (permission/auth) OR the expected once-only backstop — a
    // re-broadcast of an already-claimed deterministic id hitting the deny-all
    // `update` rule. Either way it must not vanish silently; log with context.
    console.error('[moments] broadcast rejected', { id, kind, uid: who.uid }, err);
  });
}

/**
 * Whether THIS device holds a durable witness that `uid` already won a BINGO in
 * this Event: the player's own immutable `${uid}-bingo` Moment doc, read from the
 * LOCAL persistent cache (ADR 0006). `firstBingoAt` on the player row is BY DESIGN
 * volatile (computeMark clears it when the last line falls), and the schema
 * deliberately has no durable first-win field — but the Moment collection is its
 * own memory: the bingo Moment is create-only and immutable, so its presence
 * proves a prior win even after the line was unmarked. Board consults this before
 * queueing a ceremonial First-to-BINGO candidate on a bingo edge (Codex P2, PR #99
 * round 2 finding D): a regained line must not mint the event singleton.
 *
 * Cache-only ON PURPOSE: `getDocFromCache` never touches the network, so the check
 * is instant and offline-safe, and a same-session broadcast is visible immediately
 * via latency compensation. It resolves `false` on a cache miss (fresh device /
 * cold cache — getDocFromCache rejects when the doc is not cached) and NEVER
 * rejects; the caller then falls back to the roster check, an accepted narrowed
 * residual documented in specs/w2-feed-moments.md.
 */
export async function hasPriorBingoWitness(uid: string): Promise<boolean> {
  try {
    const snap = await getDocFromCache(rawMoment(`${uid}-bingo`));
    return snap.exists();
  } catch {
    return false; // not in the local cache — no witness on this device
  }
}

/**
 * A Player's first BINGO (once per Player, ADR 0002). Broadcast on the transition
 * INTO having a bingo (Board's `wasBingo` edge), never on every completed line.
 */
export function broadcastBingo(who: MomentActor): void {
  broadcast(`${who.uid}-bingo`, 'bingo', who);
}

/** A Player's Blackout — the whole card (once per Player). */
export function broadcastBlackout(who: MomentActor): void {
  broadcast(`${who.uid}-blackout`, 'blackout', who);
}

/**
 * The Event's First to BINGO (once per Event). Ceremonial and self-reported (ADR
 * 0001): Board only calls this when, as far as the caller's known-players view
 * shows, no other Player has bingoed yet. The event-singleton id (above) makes it
 * structurally once-per-Event even under the honest race.
 */
export function broadcastFirstBingo(who: MomentActor): void {
  broadcast(FIRST_BINGO_MOMENT_ID, 'first_bingo', who);
}
