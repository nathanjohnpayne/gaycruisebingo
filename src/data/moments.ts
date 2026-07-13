import { doc, getDocFromCache, setDoc } from 'firebase/firestore';
import { db, EVENT_ID } from '../firebase';
import { markerDisplayName } from './attribution';
import { hasBingo, isBlackout } from '../game/logic';
import type { Cell, MomentDoc, MomentKind } from '../types';

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
// The STORED entry carries INTERNAL fields beyond the public triple (PR #110
// round 2 finding 3; Codex finding 2 on fix/d15-blackout-day-naming):
//   - `firstBingoGeneration`: the action generation at which the ceremonial
//     candidate was enqueued. A candidate can be held for a long time (roster
//     gate, unmounts), and the drain must fire it only if the uid's generation
//     is UNCHANGED since its enqueue (`firstBingoCandidateCurrent`): an
//     interleaved OBSERVED BINGO FALL bumps the generation and thereby kills
//     stale candidates (round 4 narrowed the bump — a no-drop unmark or a
//     blackout-only fall preserves a valid candidate; every in-app bingo-fall
//     bump also clears the candidate, so the stamp is belt-and-braces against
//     future bump sites rather than a reachable kill today).
//   - `blackoutDayIndexes`: the Day(s) blackout-completing Marks happened on,
//     captured at ENQUEUE time (Codex finding 2): a blackout can sit pending
//     for a while (the identity gate, `drainMoments`'s first check, blocks
//     EVERY kind — not just the ceremonial one), and a Player who switches the
//     VIEWED Day during that window must not have the eventual drain stamp the
//     Moment with whatever Day happens to be on screen when it fires. A SET
//     of Days, not a single first-write-wins stamp (#267): blackout is
//     per-card (daily-cards-spec § "Scoring and social surfaces"), the
//     deterministic id is per-(Player, Day) — `${uid}-blackout-d${dayIndex}`
//     — so a second Day's card blacking out while an earlier Day's Moment is
//     still pending must queue its OWN Day rather than be swallowed.
// `peekPendingMoments` projects the public triple, keeping these internal.
interface StoredPendingFlags extends PendingMomentFlags {
  firstBingoGeneration: number;
  blackoutDayIndexes?: number[];
  // The Day the FIRST queued bingo happened on (#262) — first-write-wins,
  // matching the once-per-Player `${uid}-bingo` id. Payload-naming only,
  // never part of an id.
  bingoDayIndex?: number;
  // The ceremonial candidate's OWN Day (#262; Codex P3 on #286 round 2),
  // stamped at enqueueFirstBingoMoment time. Deliberately SEPARATE from
  // `bingoDayIndex`: the candidate is enqueued AFTER an async witness read,
  // and a snapshot/gate drain can legitimately fire (and clear) the plain
  // bingo — day included — inside that window, so the ceremony must not
  // borrow the bingo's day at drain time.
  firstBingoDayIndex?: number;
}
const pendingMoments = new Map<string, StoredPendingFlags>();

// The per-uid ACTION GENERATION (Codex P1 on PR #110): a monotonically increasing
// token bumped by every OBSERVED BINGO FALL (`dropPendingWins` with fell.bingo —
// round 4 narrowed it from every-unmark: only what changes whether the bingo
// stands may stale the ceremonial machinery).
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
 *
 * `dayIndex` (optional) is the Day the completing Mark happened on — captured
 * HERE, at enqueue time, not re-read from render state at drain time (Codex
 * finding 2 on fix/d15-blackout-day-naming): only stamped on a
 * `blackoutTransition`, accumulating one entry per distinct Day (#267 — a
 * per-card win queues its own Day; see `StoredPendingFlags.blackoutDayIndexes`).
 */
export function enqueueWinMoments(params: {
  uid: string;
  bingoTransition: boolean;
  blackoutTransition: boolean;
  dayIndex?: number;
}): void {
  const { uid, bingoTransition, blackoutTransition, dayIndex } = params;
  if (!bingoTransition && !blackoutTransition) return;
  const flags = ensurePending(uid);
  if (bingoTransition) {
    flags.bingo = true;
    if (flags.bingoDayIndex === undefined) flags.bingoDayIndex = dayIndex;
  }
  if (blackoutTransition) {
    flags.blackout = true;
    if (dayIndex !== undefined) {
      flags.blackoutDayIndexes ??= [];
      if (!flags.blackoutDayIndexes.includes(dayIndex)) flags.blackoutDayIndexes.push(dayIndex);
    }
  }
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
export function enqueueFirstBingoMoment(uid: string, dayIndex?: number): void {
  const flags = ensurePending(uid);
  flags.firstBingo = true;
  flags.firstBingoGeneration = pendingActionGeneration(uid);
  // The candidate's own Day (#262; Codex P3 on #286 round 2) — a re-enqueue is
  // a NEW candidate (new generation), so it overwrites rather than first-wins.
  flags.firstBingoDayIndex = dayIndex;
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
 * The Day(s) still-pending blackouts were ENQUEUED on (Codex finding 2 on
 * fix/d15-blackout-day-naming; per-card set per #267) — empty when nothing is
 * queued or the enqueue carried no Day (a legacy, non-daily caller). The drain
 * reads this instead of whatever Day happens to be VIEWED at fire time: a
 * blackout can sit pending behind the identity gate for a while, and the
 * Player may have switched Days in that window.
 */
export function pendingBlackoutDayIndexes(uid: string): number[] {
  return [...(pendingMoments.get(pendingKey(uid))?.blackoutDayIndexes ?? [])];
}

/** The Day the still-pending (first) bingo was ENQUEUED on (#262) —
 *  `undefined` when nothing is queued or the enqueue carried no Day. */
export function pendingBingoDayIndex(uid: string): number | undefined {
  return pendingMoments.get(pendingKey(uid))?.bingoDayIndex;
}

/** The still-pending ceremonial candidate's OWN Day (#262; Codex P3 on #286
 *  round 2) — `undefined` when no candidate is queued or it carried no Day. */
export function pendingFirstBingoDayIndex(uid: string): number | undefined {
  return pendingMoments.get(pendingKey(uid))?.firstBingoDayIndex;
}

/**
 * Remove ONE drained Day from the pending blackout queue (#267; Codex P2 on
 * #275): the drain adjudicates per-Day — only the Day whose own board is the
 * rendered, blacked-out one may fire — so a fired Day leaves the queue while
 * sibling queued Days stay pending. The `blackout` flag clears only when the
 * queue empties (the flag means "something is still owed").
 */
export function removePendingBlackoutDay(uid: string, dayIndex: number): void {
  const key = pendingKey(uid);
  const flags = pendingMoments.get(key);
  if (!flags?.blackoutDayIndexes) return;
  flags.blackoutDayIndexes = flags.blackoutDayIndexes.filter((d) => d !== dayIndex);
  if (flags.blackoutDayIndexes.length === 0) {
    flags.blackoutDayIndexes = undefined;
    flags.blackout = false;
    if (!flags.bingo && !flags.firstBingo) pendingMoments.delete(key);
  }
}

/**
 * True when a ceremonial candidate is queued AND was enqueued at the CURRENT
 * action generation — no OBSERVED BINGO FALL has interleaved since (PR #110
 * round 2 finding 3; round 4 narrowed the bump to actual bingo falls). A stale candidate (generation moved) must be KILLED by the
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
 * and re-reads it in the continuation: a mismatch means the BINGO the action
 * described has since been OBSERVED TO FALL (an unmark verdict or a passive
 * falling edge — PR #110 round 4 narrowed the bump to actual bingo falls), so
 * the ceremonial enqueue is refused (Codex P1, PR #110).
 */
export function pendingActionGeneration(uid: string): number {
  return pendingGenerations.get(pendingKey(uid)) ?? 0;
}

/**
 * Record what an unmark verdict or a passive falling-edge snapshot showed FELL:
 * clears the corresponding still-held flags — a bingo fall also drops the
 * ceremonial candidate, which cannot outlive the win it accompanies — and bumps
 * the action generation ON AN ACTUAL BINGO FALL ONLY (Codex P2, PR #110 round 4).
 * The generation's sole consumers are the CEREMONIAL machinery — the birth-time
 * witness continuation and the candidate stamp — so only an event that changes
 * whether the bingo stands may stale them: a non-falling unmark (another line
 * still standing) cannot un-witness anything, and bumping on it suppressed a
 * legitimate First-to-BINGO whose witness read was still in flight (the round-4
 * finding). A blackout-only fall does not bump either — bumping there would
 * reintroduce the same bug shape (an unrelated blackout fall staling a valid
 * bingo ceremony); no consumer reads the generation for blackout. Two callers,
 * both observers of reality: Board.doMark's unmark path (the local verdict) and
 * Board's cells effect on a PASSIVE falling-edge snapshot (bingo/blackout
 * true→false in listener data — a cross-tab unmark or a rules rollback that
 * produces no local verdict; PR #110 finding 3). Distinct from
 * `clearPendingMoment` (a drain FIRE-clear, or a decided-and-lost ceremony),
 * which never bumps: a fire means the win stood and was published.
 */
export function dropPendingWins(
  uid: string,
  // `blackoutDayIndex` (#267, Codex P2 on #275 round 2): a blackout fall is
  // witnessed by ONE board — the fallen one — so a day-scoped caller drops just
  // that Day from the queue, leaving sibling Days' still-valid pending
  // blackouts intact. A legacy (day-less) fall keeps the full clear.
  fell: { bingo?: boolean; blackout?: boolean; blackoutDayIndex?: number },
): void {
  const key = pendingKey(uid);
  if (fell.bingo) {
    pendingGenerations.set(key, (pendingGenerations.get(key) ?? 0) + 1);
  }
  const flags = pendingMoments.get(key);
  if (!flags) return;
  if (fell.bingo) {
    flags.bingo = false;
    flags.firstBingo = false;
    flags.bingoDayIndex = undefined; // the fallen bingo's Day no longer applies
    flags.firstBingoDayIndex = undefined;
  }
  if (fell.blackout) {
    const days = flags.blackoutDayIndexes;
    if (fell.blackoutDayIndex !== undefined && days && days.length > 0) {
      // Day-scoped fall: only the witnessed board's Day drops; the flag stays
      // owed while sibling Days remain queued.
      flags.blackoutDayIndexes = days.filter((d) => d !== fell.blackoutDayIndex);
      if (flags.blackoutDayIndexes.length === 0) {
        flags.blackoutDayIndexes = undefined;
        flags.blackout = false;
      }
    } else {
      flags.blackout = false;
      flags.blackoutDayIndexes = undefined; // the fallen blackout's Day no longer applies
    }
  }
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
  if (kind === 'blackout') flags.blackoutDayIndexes = undefined; // fired — nothing left to protect
  // Each kind clears ITS OWN Day (#286 round 2, Codex P3): the ceremonial
  // candidate carries `firstBingoDayIndex` stamped at ITS enqueue, so the plain
  // bingo's fire-clear can never strip the ceremony's Day chip — including the
  // async-witness window where the candidate is enqueued only after the plain
  // bingo already fired and deleted the entry.
  if (kind === 'bingo') flags.bingoDayIndex = undefined;
  if (kind === 'firstBingo') flags.firstBingoDayIndex = undefined;
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
 * `resolveDisplayName` yields is not itself length-capped). `dayIndex` is
 * optional and, when supplied, is stamped onto the payload — the per-card
 * Blackout is the one caller that passes it today (daily-cards-spec § "Scoring
 * and social surfaces": "a per-card blackout posts a Moment naming the day",
 * e.g. "blacked out Day 4 · Glamiators"), so the Feed can render the Day chip.
 */
function broadcast(id: string, kind: MomentKind, who: MomentActor, dayIndex?: number): void {
  void writeMomentOnce(id, kind, who, dayIndex);
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
 * this pre-check catches. `dayIndex` (optional) is threaded straight through to
 * the payload builder, which omits the field entirely rather than writing an
 * explicit `undefined` — Firestore's `setDoc` rejects that outright.
 */
async function writeMomentOnce(
  id: string,
  kind: MomentKind,
  who: MomentActor,
  dayIndex?: number,
): Promise<void> {
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
    // Included only when the caller supplied one — never an explicit `undefined`
    // (Firestore's setDoc rejects that field value outright).
    ...(dayIndex !== undefined ? { dayIndex } : {}),
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
export async function hasPriorBingoWitness(
  uid: string,
  // Day-aware exclusion (Codex P1 on #288): the `${uid}-bingo` doc is
  // once-per-Player and a TUTORIAL Day's bingo writes it too — but the
  // cruise-wide First to BINGO is anchored to MAIN-GAME Days only (spec §
  // "Scoring and social surfaces"), so a warm-up win must not read as a
  // "prior win" that permanently disqualifies the player's first REAL bingo
  // from the ceremony. A witness whose payload Day is in `excludeDayIndexes`
  // resolves false. A day-LESS witness on a daily Event (pre-#286 data) stays
  // a witness — conservative: the roster gate (already main-game-aware via
  // the tutorial-excluded firstBingoAt fold) remains the fallback.
  opts?: { excludeDayIndexes?: ReadonlySet<number> },
): Promise<boolean> {
  try {
    const snap = await getDocFromCache(rawMoment(`${uid}-bingo`));
    if (!snap.exists()) return false;
    if (opts?.excludeDayIndexes) {
      const witnessedDay = (snap.data() as { dayIndex?: number } | undefined)?.dayIndex;
      if (typeof witnessedDay === 'number' && opts.excludeDayIndexes.has(witnessedDay)) {
        return false; // a tutorial-Day win is not a prior MAIN-GAME win
      }
    }
    return true;
  } catch {
    return false; // not in the local cache — no witness on this device
  }
}

/**
 * A Player's first BINGO (once per Player, ADR 0002). Broadcast on the transition
 * INTO having a bingo (Board's `wasBingo` edge), never on every completed line.
 */
export function broadcastBingo(who: MomentActor, dayIndex?: number): void {
  // The id stays once-per-Player (`${uid}-bingo`); `dayIndex` (#262) rides the
  // PAYLOAD only, naming the Day the first bingo happened on for the Feed's
  // day chip — captured at ENQUEUE time like the blackout Day.
  broadcast(`${who.uid}-bingo`, 'bingo', who, dayIndex);
}

/**
 * A Player's Blackout — PER CARD (#267, daily-cards-spec § "Scoring and
 * social surfaces": "Blackout remains per-card; a per-card blackout posts a
 * Moment naming the day"). `dayIndex` NAMES the Day the blackout happened on
 * ("blacked out Day 4 · Glamiators") AND scopes the deterministic dedup id to
 * that Day (`${uid}-blackout-d${dayIndex}`): re-marking the SAME card can
 * never double-post, while a second Day's blackout posts its own Moment — the
 * pre-#267 `${uid}-blackout` id was once-per-Player, so only the first card's
 * blackout ever reached the Feed. A legacy single-Board caller omits
 * `dayIndex` and keeps the legacy once-per-Player id (a legacy Event has one
 * card the whole Event, so per-Player IS per-card there). Board's live-mark
 * path captures the Day at ENQUEUE time via `enqueueWinMoments` and threads
 * it through `pendingBlackoutDayIndexes` to the drain — NOT re-derived from
 * whatever Day happens to be on screen when a held blackout finally fires
 * (Codex finding 2, fix/d15-blackout-day-naming).
 */
export function broadcastBlackout(who: MomentActor, dayIndex?: number): void {
  if (dayIndex === undefined) {
    broadcast(`${who.uid}-blackout`, 'blackout', who);
    return;
  }
  // Legacy same-day dedupe (Codex P2 on #275 round 2): a card that already
  // posted under the pre-#267 day-less id (a day-stamped payload at
  // `${uid}-blackout`, the #250-era shape) must not post a SECOND, day-stamped
  // Moment for the SAME card. Same cache-only posture as writeMomentOnce: the
  // check protects the visible-flash window (the doc IS cached on the device
  // that posted it); a cold cache proceeds and the residual duplicate is a
  // distinct id the create rule cannot dedup across — accepted, matching the
  // existing broadcast dedup model.
  void (async () => {
    try {
      const legacy = await getDocFromCache(rawMoment(`${who.uid}-blackout`));
      if (legacy.exists() && (legacy.data() as { dayIndex?: number }).dayIndex === dayIndex) {
        console.debug('[moments] per-card blackout skipped — legacy day-less Moment already covers this Day', {
          uid: who.uid,
          dayIndex,
        });
        return;
      }
    } catch {
      // No legacy Moment in the local cache — nothing to dedupe against.
    }
    await writeMomentOnce(`${who.uid}-blackout-d${dayIndex}`, 'blackout', who, dayIndex);
  })();
}

/**
 * The Event's First to BINGO (once per Event). Ceremonial and self-reported (ADR
 * 0001): Board only calls this when, as far as the caller's known-players view
 * shows, no other Player has bingoed yet. The event-singleton id (above) makes it
 * structurally once-per-Event even under the honest race.
 */
export function broadcastFirstBingo(who: MomentActor, dayIndex?: number): void {
  // Payload-only `dayIndex` (#262), same as broadcastBingo — the singleton id
  // is untouched.
  broadcast(FIRST_BINGO_MOMENT_ID, 'first_bingo', who, dayIndex);
}

/**
 * The broadcast decision for a CONFIRM-PATH win (issue #41, the deferred #99
 * finding 6). In `admin_confirmed` mode a Mark starts pending and only becomes a
 * win when an Admin resolves the Claim — and that confirm can land while the
 * winning Player is off the Card route (Board unmounted) or offline, so Board's
 * live edge detection never fires. `ConfirmWinMoments` (an always-mounted,
 * route-independent listener) watches the Player's OWN confirmed Claims and, when
 * the confirm's board write reflects a standing win, emits the SAME Moment the
 * live edge would have — attributed to the WINNER (the claim owner), never the
 * confirming Admin. This pure function is that emit decision, factored out so the
 * invariant is directly unit-testable.
 *
 * TRANSITION-GATED, exactly like the live mark path (Codex #116 finding 1): the
 * live path broadcasts off a mark's `bingoTransition` / `blackoutTransition`
 * (no-win → win), NOT off `hasBingo` on the current board. The confirm path must
 * match, or a player who ALREADY holds a standing BINGO and has a DIFFERENT pending
 * Claim confirmed (one that completes no NEW line) would wrongly re-post a BINGO.
 * So we recompute the win against the board with the JUST-CONFIRMED cells forced
 * back to their pre-confirm PENDING state (`confirmedIndexes`) and emit only what
 * CROSSES the threshold: no bingo before → bingo after (same for blackout). A
 * confirmed square that completes no line emits nothing.
 *
 * The rest MIRRORS Board's drain fire-time gates so both paths agree:
 *   - a board must actually stand (`cells.length > 0`): `isBlackout([])` is
 *     vacuously true, so an empty/non-attributable board emits nothing (the same
 *     round-3-finding-B length gate Board applies);
 *   - `firstBingo` is the ceremonial event singleton — raised only on a bingo
 *     TRANSITION, claimed ONLY against a SERVER-CONFIRMED roster showing no OTHER
 *     Player already has a `firstBingoAt` (PR #99 finding 2), and SUPPRESSED when
 *     the durable prior-win witness exists (`hasPriorBingoWitness`, finding D) so a
 *     regained line never re-mints it;
 *   - while the roster is unconfirmed a crossed first-win is HELD, not guessed
 *     (`firstBingoHeld`): the caller keeps the candidate and re-decides once the
 *     roster confirms, exactly as Board holds the candidate.
 *
 * Exactly-once across the two emit paths is STRUCTURAL, not timing: the writers'
 * deterministic doc ids (`${uid}-bingo` / `${uid}-blackout` / the `first_bingo`
 * singleton) are create-only and a Moment is fully immutable, so if the live edge
 * already posted a win this confirm-path emit is a denied/skipped no-op — never a
 * duplicate, and NEVER a false singleton (the roster gate is the same on both
 * paths). This preserves #110's suppressed-or-correct guarantee.
 */
export interface ConfirmBroadcastPlan {
  bingo: boolean;
  blackout: boolean;
  firstBingo: boolean;
  // The ceremonial first-win CROSSED but the roster is not yet server-confirmed:
  // HOLD (do not fire, do not drop) and re-decide when the roster confirms.
  firstBingoHeld: boolean;
}

export function planConfirmBroadcasts(params: {
  cells: Cell[];
  // The cell indices whose pending→confirmed flip this emit adjudicates. The win
  // is measured as the CROSSING these flips caused: the "before" board treats them
  // as still pending, the "after" board is `cells` as it stands now.
  confirmedIndexes: number[];
  uid: string;
  roster: { uid: string; firstBingoAt: number | null }[];
  rosterConfirmed: boolean;
  hasPriorBingo: boolean;
}): ConfirmBroadcastPlan {
  const { cells, confirmedIndexes, uid, roster, rosterConfirmed, hasPriorBingo } = params;
  const none = { bingo: false, blackout: false, firstBingo: false, firstBingoHeld: false };
  if (cells.length === 0 || confirmedIndexes.length === 0) return none;

  // "before" = the just-confirmed cells forced back to pending (their pre-confirm
  // state: still `marked`, but excluded from the win mask). The transition is the
  // difference THIS confirm made — never a win that already stood.
  const flipped = new Set(confirmedIndexes);
  const before = cells.map((c) => (flipped.has(c.index) ? { ...c, status: 'pending' as const } : c));
  const bingoTransition = !hasBingo(before) && hasBingo(cells);
  const blackoutTransition = !isBlackout(before) && isBlackout(cells);

  // The ceremonial First-to-BINGO is a candidate only when this confirm CROSSED
  // into a bingo the Player has no durable prior-win witness for. Then the roster
  // decides: unconfirmed → HELD; confirmed → claim iff no other Player bingoed first.
  const firstCandidate = bingoTransition && !hasPriorBingo;
  const othersBingoed = roster.some((p) => p.uid !== uid && p.firstBingoAt != null);
  const firstBingo = firstCandidate && rosterConfirmed && !othersBingoed;
  const firstBingoHeld = firstCandidate && !rosterConfirmed;

  return { bingo: bingoTransition, blackout: blackoutTransition, firstBingo, firstBingoHeld };
}

// --- Confirm-path listener state (issue #41), uid-keyed like the pending queue --
//
// The `ConfirmWinMoments` listener holds per-Player working state: which Claims it
// has observed PENDING (the fresh-confirm witness — a confirm counts as fresh only
// if this listener saw the Claim pending while mounted, so a Claim already
// confirmed at first sight is baselined as history), which confirmed Claims it has
// already enqueued, the confirms whose board flip has not yet landed, and a
// first_bingo candidate parked at the roster gate. Codex #116 finding 4: this state
// is lifted to MODULE scope keyed by uid (mirroring the pending-Moment queue above)
// so an ACCOUNT SWITCH parks the work instead of discarding it — switching back
// resumes a held win (including a roster-held first_bingo) for the original uid
// rather than baselining the now-confirmed Claim away. Same reload residual as the
// pending queue: module state is per-page-load.
export interface ConfirmListenerState {
  // Claim ids this listener has observed in the PENDING state — the witness that a
  // later `confirmed` is a fresh transition, not history (Codex #116 finding 3).
  seenPending: Set<string>;
  // Confirmed Claim ids already enqueued for emit, so a repeat snapshot never
  // re-enqueues one.
  handled: Set<string>;
  // Enqueued confirms whose board flip has not yet been adjudicated: claimId → the
  // Claim's cellIndex + proofId + its Day (#274 — a daily Claim adjudicates
  // against ITS day-scoped board; `null` = a legacy single-board Claim). The
  // proofId makes board reflection claim-SPECIFIC (Codex #116 R4 finding 2):
  // `confirmClaim` resolves the cell by proofId, so a DIFFERENT claim's
  // confirm at the same index must not count as this one's.
  awaiting: Map<
    string,
    { cellIndex: number; proofId: string | null; dayIndex: number | null; createdAt: number }
  >;
  // A first_bingo candidate parked at the roster gate, with its winner actor
  // captured; its prior-win eligibility was fixed at detection (never re-read).
  // `heldCeremonyDay` (#274) is the Day the held win stood on — the fall-clear
  // re-check reads THAT board, and the eventual publish names it.
  heldCeremony: MomentActor | null;
  heldCeremonyDay?: number | null;
  // A witness read is in flight — serializes the async decision and drives the
  // drain-until-empty loop (Codex #116 finding 2).
  inFlight: boolean;
}

const confirmStates = new Map<string, ConfirmListenerState>();

/** The per-uid confirm-listener state (created empty on first access), keyed the
 *  SAME way as the pending-Moment queue so the two never cross identities. */
export function getConfirmState(uid: string): ConfirmListenerState {
  const key = pendingKey(uid);
  let state = confirmStates.get(key);
  if (!state) {
    state = { seenPending: new Set(), handled: new Set(), awaiting: new Map(), heldCeremony: null, inFlight: false };
    confirmStates.set(key, state);
  }
  return state;
}

/** Drop all confirm-listener state. Exported for test isolation only (module state
 *  persists across unmounts by design); not used by app code. */
export function resetConfirmStates(): void {
  confirmStates.clear();
}
