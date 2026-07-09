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

// --- The pending-Moment queue (issue #104): a win awaiting its gate ---------
//
// A win Moment broadcasts off the MARK that completed it (setMark's synchronous
// transition verdict, consumed in Board.doMark) — not off snapshot diffing. But
// the broadcast still has GATES: a KNOWN saved identity for all three kinds (never
// stamp a returning Player's stale auth name into an IMMUTABLE Moment), plus a
// SERVER-CONFIRMED roster for the ceremonial First-to-BINGO. When a win crosses
// while a gate is still closed, its broadcast must WAIT for the gate to open.
//
// Round-4 of PR #99 kept that waiting state in a COMPONENT ref in Board.tsx, so a
// Player who left the Card route before the gate opened lost the Moment forever
// (the ref died with the unmount, and the returning board baselined the already
// standing win). This queue lifts that state to MODULE scope — keyed by app+uid,
// the same durability pattern `markChains` uses in api.ts — so it survives Board
// unmounts and route changes: whichever Board mount next sees the gate open drains
// it. The deterministic Moment doc id keeps a held-then-fired broadcast idempotent,
// and the writer's write-once cache pre-check + create-only rule are the structural
// once-only backstop besides. RESIDUAL (documented, accepted): a queued-but-undrained
// broadcast still dies on a full page RELOAD (module state is per-page-load) — but
// the deterministic id + the returning board baselining the standing win mean that
// costs at most one possibly-lost Moment for a win that straddled a reload, never a
// duplicate or a spurious fire. That is the SAME class of loss as the prior
// unmount bug, strictly NARROWER (only a reload, not any route change).
export interface PendingMomentFlags {
  bingo: boolean;
  blackout: boolean;
  firstBingo: boolean;
}
// The STORED entry carries one INTERNAL field beyond the public triple (PR #110
// round 2 finding 3): the action generation at which the ceremonial candidate was
// enqueued. A candidate can be held for a long time (roster gate, unmounts), and
// the drain must fire it only if the uid's generation is UNCHANGED since its
// enqueue (`firstBingoCandidateCurrent`): any interleaved unmark or observed fall
// bumps the generation and thereby kills stale candidates — even ones whose flag
// survived because the bump came from a blackout-only fall or a no-drop unmark.
// `peekPendingMoments` projects the public triple, keeping this internal.
interface StoredPendingFlags extends PendingMomentFlags {
  firstBingoGeneration: number;
}
const pendingMoments = new Map<string, StoredPendingFlags>();

// The per-uid ACTION GENERATION (Codex P1 on PR #110): a monotonically increasing
// token bumped by every unmark and every observed win-fall (`dropPendingWins`).
// Board's ceremonial First-to-BINGO enqueue crosses an async gap (the durable-
// witness cache read), and the pending win can change inside that gap: the player
// unmarks and loses the bingo, the unmark verdict drops the queued flags — and a
// stale continuation that re-enqueued on the uid check alone would let a later
// drain publish the IMMUTABLE event-level singleton for a win that no longer
// stands. The continuation therefore captures the generation BEFORE the await and
// enqueues ONLY if it is unchanged after (round 2 finding 2 corrected the round-1
// dual check: the pending-flag recheck was over-tight — a concurrent drain can
// legitimately FIRE the plain bingo mid-read, and that clear must not forfeit the
// ceremony; whether the win still STANDS is the drain's fire-time revalidation,
// not the continuation's). The token also stamps each ceremonial candidate at
// enqueue (round 2 finding 3 — see `firstBingoCandidateCurrent`). Kept in a
// SEPARATE map from the flags: the flags entry is deleted when empty, and a
// deleted-then-recreated entry must not reset the token to a value a stale
// continuation already captured.
const pendingGenerations = new Map<string, number>();

// Key by app + uid (mirrors `markChains` in api.ts). The moment writers always
// use the module `db` singleton, so the app segment is effectively constant here;
// keying on uid is what actually isolates two identities sharing a browser (a
// held win for one account must never drain under the other), and the app prefix
// keeps the shape identical to the mark-chain key for anyone reading both.
function pendingKey(uid: string): string {
  const appName = (db as unknown as { app?: { name?: string } }).app?.name ?? 'default';
  return `${appName}/${uid}`;
}

function ensurePending(uid: string): StoredPendingFlags {
  const key = pendingKey(uid);
  let flags = pendingMoments.get(key);
  if (!flags) {
    flags = { bingo: false, blackout: false, firstBingo: false, firstBingoGeneration: 0 };
    pendingMoments.set(key, flags);
  }
  return flags;
}

/**
 * Enqueue the per-Player win Moment(s) a mark just COMPLETED — driven by
 * `setMark`'s transition verdict (Board.doMark), never by a snapshot diff. Only a
 * rising edge enqueues; a no-op call (neither transition) leaves the queue
 * untouched so it never resurrects a drained-or-absent flag.
 */
export function enqueueWinMoments(params: {
  uid: string;
  bingoTransition: boolean;
  blackoutTransition: boolean;
}): void {
  const { uid, bingoTransition, blackoutTransition } = params;
  if (!bingoTransition && !blackoutTransition) return;
  const flags = ensurePending(uid);
  if (bingoTransition) flags.bingo = true;
  if (blackoutTransition) flags.blackout = true;
}

/**
 * Enqueue the ceremonial First-to-BINGO candidate for a just-completed bingo. Kept
 * separate from `enqueueWinMoments` because the caller gates it on the durable
 * prior-win witness first (`hasPriorBingoWitness`, PR #99 round 2 finding D): a
 * regained line whose owner already has a `${uid}-bingo` Moment must not re-claim
 * the event singleton. The roster gate (no OTHER Player has an earlier bingo) is
 * applied at DRAIN time, where the confirmed roster lives. The candidate is
 * STAMPED with the current action generation (PR #110 round 2 finding 3): the
 * drain fires it only while that stamp is current (`firstBingoCandidateCurrent`).
 */
export function enqueueFirstBingoMoment(uid: string): void {
  const flags = ensurePending(uid);
  flags.firstBingo = true;
  flags.firstBingoGeneration = pendingActionGeneration(uid);
}

/**
 * The pending flags for `uid` (a stable empty triple when nothing is queued),
 * PROJECTED to the public triple — the internal candidate-generation stamp stays
 * internal. The drainer reads this, applies the identity/roster gates plus the
 * fire-time revalidation, broadcasts, then clears each fired kind via
 * `clearPendingMoment`.
 */
export function peekPendingMoments(uid: string): PendingMomentFlags {
  const flags = pendingMoments.get(pendingKey(uid));
  return flags
    ? { bingo: flags.bingo, blackout: flags.blackout, firstBingo: flags.firstBingo }
    : { bingo: false, blackout: false, firstBingo: false };
}

/**
 * True when a ceremonial candidate is queued AND was enqueued at the CURRENT
 * action generation — no unmark or observed fall has interleaved since (PR #110
 * round 2 finding 3). A stale candidate (generation moved) must be KILLED by the
 * drain, never fired: the win context it was enqueued for no longer describes the
 * board. The complementary protection for falls this tab NEVER observed (no bump)
 * is the drain-time witness re-check in Board's drain — see specs/w2-feed-moments.md
 * § PR #110 hardening.
 */
export function firstBingoCandidateCurrent(uid: string): boolean {
  const flags = pendingMoments.get(pendingKey(uid));
  if (!flags?.firstBingo) return false;
  return flags.firstBingoGeneration === pendingActionGeneration(uid);
}

/**
 * The current action generation for `uid` (see `pendingGenerations` above).
 * Board's doMark captures this immediately before the async durable-witness read
 * and re-reads it in the continuation: a mismatch means an unmark or an observed
 * win-fall interleaved, so the ceremonial enqueue is refused (Codex P1, PR #110).
 */
export function pendingActionGeneration(uid: string): number {
  return pendingGenerations.get(pendingKey(uid)) ?? 0;
}

/**
 * Record that a win FELL (or that an unmark action happened at all): clears the
 * corresponding still-held flags — a bingo fall also drops the ceremonial
 * candidate, which cannot outlive the win it accompanies — and ALWAYS bumps the
 * action generation, invalidating any in-flight witness continuation (Codex P1,
 * PR #110). Two callers, both observers of reality: Board.doMark's unmark path
 * (the local verdict shows the win no longer stands) and Board's cells effect on
 * a PASSIVE falling-edge snapshot (bingo/blackout true→false in listener data —
 * a cross-tab unmark or a rules rollback that produces no local verdict; Codex
 * P2, PR #110 finding 3). Distinct from `clearPendingMoment` (a drain FIRE-clear,
 * or a decided-and-lost ceremony), which does NOT bump: a fire means the win
 * stood and was published, not that the action window changed.
 */
export function dropPendingWins(uid: string, fell: { bingo?: boolean; blackout?: boolean }): void {
  const key = pendingKey(uid);
  pendingGenerations.set(key, (pendingGenerations.get(key) ?? 0) + 1);
  const flags = pendingMoments.get(key);
  if (!flags) return;
  if (fell.bingo) {
    flags.bingo = false;
    flags.firstBingo = false;
  }
  if (fell.blackout) flags.blackout = false;
  if (!flags.bingo && !flags.blackout && !flags.firstBingo) pendingMoments.delete(key);
}

/**
 * Clear one DRAINED kind so a later drain cannot re-fire it: the drain either
 * published the Moment (the win stood at fire time) or decided-and-lost the
 * ceremony against a confirmed roster. Not for falls — a win that no longer
 * stands is dropped via `dropPendingWins`, which also bumps the action
 * generation. The map entry is deleted once empty to keep it from growing per uid.
 */
export function clearPendingMoment(uid: string, kind: keyof PendingMomentFlags): void {
  const key = pendingKey(uid);
  const flags = pendingMoments.get(key);
  if (!flags) return;
  flags[kind] = false;
  if (!flags.bingo && !flags.blackout && !flags.firstBingo) pendingMoments.delete(key);
}

/**
 * Drop the ENTIRE pending queue and its action generations. Exported for test
 * isolation only: both maps are module state that (by design) persist across
 * component unmounts, so a suite that exercises the hold→drain path must reset
 * them between cases. Not used by app code. (A continuation captured before a
 * reset sees generation 0 again, but its flag recheck fails against the cleared
 * flags — the dual check covers the wraparound.)
 */
export function resetPendingMoments(): void {
  pendingMoments.clear();
  pendingGenerations.clear();
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
 * or across a reload); the write-once cache pre-check (`writeMomentOnce`, round 3
 * finding C) skips a duplicate whose Moment is already in the local cache before
 * it can optimistically overwrite it; the create-only id is the structural
 * backstop for whatever remains (fresh devices, multiple tabs, the
 * First-to-BINGO race).
 *
 * The payload is EXACTLY `Omit<MomentDoc, 'id'>` (the id is the doc id): no media
 * and no `proofId` ever reach a Moment. `displayName` is bounded through the
 * shared `markerDisplayName` helper to the rules' non-empty ≤100-char contract so
 * a broadcast can never be rejected for a malformed name (the auth-fallback name
 * `resolveDisplayName` yields is not itself length-capped).
 */
function broadcast(id: string, kind: MomentKind, who: MomentActor): void {
  void writeMomentOnce(id, kind, who);
}

/**
 * The write-once step behind every broadcast (round 3 finding C, PR #99). The
 * create-only rules DENY a duplicate deterministic-id write server-side — but
 * Firestore applies latency compensation FIRST: the duplicate setDoc briefly
 * overwrites the LOCAL cache copy, and its refreshed `createdAt` pins the old
 * Moment to the top of the Feed until the server's denial rolls it back —
 * indefinitely while offline, where no denial ever arrives. So, extending the
 * round-2 witness pattern to ALL broadcasts: check the local cache for the
 * deterministic id first, and if the Moment already exists there, SKIP the write
 * entirely. That is the designed once-only path doing its job, not an error —
 * logged at debug level (the rules-denial path below keeps its error log). On a
 * cache miss (fresh device / cold cache) the write proceeds: a duplicate from a
 * cold cache still resolves server-side via the create-only rule, and the
 * visible-flash window only exists when the doc IS cached — exactly the case
 * this pre-check catches.
 */
async function writeMomentOnce(id: string, kind: MomentKind, who: MomentActor): Promise<void> {
  const ref = rawMoment(id);
  try {
    const cached = await getDocFromCache(ref);
    if (cached.exists()) {
      console.debug('[moments] broadcast skipped — Moment already in local cache', {
        id,
        kind,
        uid: who.uid,
      });
      return;
    }
  } catch {
    // Not in the local cache — no duplicate to protect; proceed with the write.
  }
  const payload: Omit<MomentDoc, 'id'> = {
    kind,
    uid: who.uid,
    displayName: markerDisplayName(who.displayName, undefined),
    photoURL: who.photoURL,
    createdAt: Date.now(),
  };
  await setDoc(ref, payload).catch((err: unknown) => {
    // Not the offline case: offline the write PENDS in the persistent cache and
    // drains on reconnect (ADR 0006). A rejection is either a genuine online
    // failure (permission/auth) OR the once-only backstop for a COLD-cache
    // duplicate — a re-broadcast of an already-claimed deterministic id hitting
    // the deny-all `update` rule. Either way it must not vanish silently; log
    // with context.
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
