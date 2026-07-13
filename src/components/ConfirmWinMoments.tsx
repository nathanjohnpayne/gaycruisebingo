import { useCallback, useEffect, useRef } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useBoard, useMyPlayer, useLeaderboard, useMyClaims } from '../hooks/useData';
import { resolveDisplayName } from '../data/api';
import {
  broadcastBingo,
  broadcastBlackout,
  broadcastFirstBingo,
  hasPriorBingoWitness,
  planConfirmBroadcasts,
  getConfirmState,
  type MomentActor,
} from '../data/moments';
import { hasBingo } from '../game/logic';
import type { Cell, PlayerDoc } from '../types';

/** A confirm awaiting its board write: the Claim's cell AND the proof it resolves on. */
interface AwaitingConfirm {
  cellIndex: number;
  // The Claim's proofId. `confirmClaim` (src/data/admin.ts) resolves the board cell
  // by `x.proofId === c.proofId` when the Claim has one, so the confirmed cell carries
  // THIS proofId — the claim-specific match below. `null` = a legacy Claim with no
  // proofId, which resolves by index (the historical fallback).
  proofId: string | null;
}

/**
 * Whether the resolve() board write for a SPECIFIC confirmed Claim has LANDED
 * (Codex #116 R3 finding 3 + R4 finding 2): the cell at `cellIndex` must be MARKED,
 * `status === 'confirmed'`, AND — when the Claim carries a `proofId` — the cell's
 * `proofId` must MATCH it. A weaker `status !== 'pending'` test wrongly treated a
 * not-yet-arrived board (a stale cell with `status: undefined`) as reflected; and an
 * index-only test wrongly treated a DIFFERENT claim's confirm at the same square as
 * this Claim's (a player with two pending submissions for one square — `confirmClaim`
 * resolves by proofId, so an older Claim can confirm without touching the current
 * cell). Matching the proofId adjudicates only the Claim the board cell actually
 * reflects. A legacy Claim (no proofId) falls back to marked+confirmed by index.
 */
function cellReflectsConfirm(cells: Cell[], entry: AwaitingConfirm): boolean {
  const cell = cells.find((x) => x.index === entry.cellIndex);
  if (cell == null || cell.marked !== true || cell.status !== 'confirmed') return false;
  return entry.proofId == null || cell.proofId === entry.proofId;
}

/**
 * The confirm-path Moment emitter (issue #41 — the deferred PR #99 finding 6).
 *
 * In `admin_confirmed` Claim Mode a Mark starts PENDING and is excluded from the
 * win mask (`game/logic`: `marked && status !== 'pending'`), so an `attachProof`
 * in that mode crosses no win transition — Board's action-path broadcast
 * (`broadcastWinVerdict`, PR #104/#110) intentionally emits nothing at attach time
 * (a pending claim can be REJECTED and a Moment is immutable). The win — and its
 * Moment — materialize only when an Admin CONFIRMS the Claim: `resolve()`
 * (src/data/admin.ts) flips the cell `pending → confirmed` and recomputes the
 * winner's stats. But that confirm can land while the winning Player is off the
 * Card route (Board unmounted) or offline, so Board's route-scoped machinery never
 * sees it. Left unaddressed, the leaderboard and stats update while the Feed
 * silently misses the win.
 *
 * This component closes that gap. It is mounted ONCE at the app shell — OUTSIDE the
 * tab Routes — so it runs wherever the Player is. It watches the Player's OWN
 * Claims (`useMyClaims`, a `where('uid','==',uid)`-scoped read the rules permit),
 * notices when one flips to `confirmed`, waits for the confirm's board write to
 * reflect the flip, and emits the SAME Moment(s) the live edge would have —
 * attributed to the WINNER (the claim owner), NEVER the confirming Admin, and
 * written as the winner (`isOwner` create), so it needs no rules change.
 *
 * Four properties, mirroring the #110 live pipeline (Codex #116 review):
 *   1. TRANSITION-GATED (finding 1). `planConfirmBroadcasts` emits only what the
 *      just-confirmed cells CROSSED (measured against the board with those cells
 *      forced back to pending) — a confirm that completes no new line, or one made
 *      while a bingo already stood, emits nothing.
 *   2. DRAIN-UNTIL-EMPTY (finding 2). The witness read is async; a second confirm
 *      arriving while it is in flight is enqueued and the drain re-runs on settle
 *      until the queue is empty, so no confirm is stranded.
 *   3. FRESH-CONFIRM WITNESS (finding 3). A confirm is fresh (emits) only if this
 *      listener observed the Claim PENDING while mounted; a Claim already confirmed
 *      at first sight is baselined as history. This is the key discriminator, not a
 *      first-snapshot latch — so a confirm that becomes visible only on RECONNECT
 *      (the offline-but-open case) still emits, while only a confirm that landed
 *      while the app was FULLY CLOSED is the accepted residual.
 *   4. UID-KEYED PERSISTENCE (finding 4). The working state lives in module scope
 *      keyed by uid (`getConfirmState`, mirroring the #110 pending queue), so an
 *      account switch PARKS held work (including a roster-held first_bingo) and a
 *      switch-back resumes it rather than baselining the now-confirmed Claim away.
 *
 * Exactly-once and no-false-singleton are preserved by COMPOSITION: the writers'
 * deterministic doc ids (`${uid}-bingo` / `${uid}-blackout` / the `first_bingo`
 * singleton) are create-only and immutable, so a live edge that also posts the same
 * win makes this emit a denied/skipped no-op; and the ceremonial First-to-BINGO
 * applies the SAME roster gate the live path does, so a confirm racing another
 * Player's live first-BINGO is suppressed-or-correct — never a false singleton.
 */
export default function ConfirmWinMoments() {
  const { user } = useAuth();
  const uid = user?.uid;
  const { data: board } = useBoard(uid);
  const { data: player, loading: playerLoading, hasServerData: playerConfirmed } = useMyPlayer(uid);
  const { players, hasServerData: rosterConfirmed } = useLeaderboard();
  const { claims, fromCache: claimsFromCache } = useMyClaims(uid);

  const displayName = resolveDisplayName(player, user?.displayName);
  // The SAME identity tri-state Board uses (knownFirstBingoAt / doMark): HOLD every
  // broadcast until the saved row is known, so a returning Player's stale auth name
  // is never stamped into an immutable Moment.
  const identityKnown = !playerLoading && (player !== null || playerConfirmed);

  // Latest actor + gates + attributable board, in a ref so the stable callbacks and
  // the async witness continuation always read CURRENT state, never a stale closure.
  const ctx = useRef<{
    uid: string | undefined;
    displayName: string;
    photoURL: string | null;
    players: PlayerDoc[];
    rosterConfirmed: boolean;
    identityKnown: boolean;
    cells: Cell[];
    boardOwned: boolean;
  }>({
    uid: undefined,
    displayName: 'Anonymous',
    photoURL: null,
    players: [],
    rosterConfirmed: false,
    identityKnown: false,
    cells: [],
    boardOwned: false,
  });
  ctx.current = {
    uid,
    displayName,
    photoURL: player ? player.photoURL : (user?.photoURL ?? null),
    players,
    rosterConfirmed,
    identityKnown,
    cells: board?.cells ?? [],
    boardOwned: board != null && board.uid === uid,
  };

  // Self-reference so the async settle continuation can loop the drain until the
  // queue is empty (finding 2) without capturing a stale callback.
  const drainRef = useRef<() => void>(() => {});

  // Emit for any awaiting confirm whose board flip has landed. Reads the prior-win
  // witness ONCE (birth-time, before the plain bingo posts), plans the TRANSITION
  // the confirmed cells crossed, broadcasts, and parks a still-unconfirmed ceremony.
  const drain = useCallback(() => {
    const c = ctx.current;
    if (!c.uid || !c.identityKnown || !c.boardOwned || c.cells.length === 0) return;
    const st = getConfirmState(c.uid);
    if (st.inFlight || st.awaiting.size === 0) return;
    // A confirm is "reflected" only once the resolve() board write has LANDED for its
    // OWN cell — marked + status 'confirmed' + matching proofId (cellReflectsConfirm,
    // Codex #116 R3 finding 3 + R4 finding 2). Only spend a witness read if at least
    // one awaiting confirm is reflected.
    if (![...st.awaiting.values()].some((e) => cellReflectsConfirm(c.cells, e))) return;
    const actedUid = c.uid;
    st.inFlight = true;
    void hasPriorBingoWitness(actedUid)
      .then((witnessed) => {
        const st2 = getConfirmState(actedUid);
        st2.inFlight = false;
        const cc = ctx.current;
        // Account switched away mid-read (finding 4): leave the awaiting entries in
        // the uid-keyed state so a switch-BACK resumes them; never emit with the
        // wrong actor or against another account's board.
        if (cc.uid === actedUid && cc.boardOwned && cc.cells.length > 0) {
          // Recompute reflected from the CURRENT post-await state, NOT a pre-await
          // snapshot (Codex #116 R4 finding 1): a sibling confirm that landed while the
          // witness read was in flight is now in `st2.awaiting` and its cell is on
          // `cc.cells`, so it must be adjudicated in THIS pass rather than masking (or
          // being masked by) the earlier one. All currently-reflected confirms are
          // adjudicated as ONE batch — `confirmedIndexes` holds every reflected cell,
          // so `planConfirmBroadcasts` measures the transition this batch CROSSED with
          // each sibling forced back to pending, and no confirm reads another as an
          // already-standing win. Concurrent multi-confirm is then deterministic: the
          // batch emits exactly the kinds it crossed, once each (deterministic-id
          // dedup besides), and the winner-attributed Moment is never lost or doubled.
          const nowReflected = [...st2.awaiting.entries()].filter(([, e]) =>
            cellReflectsConfirm(cc.cells, e),
          );
          if (nowReflected.length > 0) {
            const actor: MomentActor = { uid: actedUid, displayName: cc.displayName, photoURL: cc.photoURL };
            const plan = planConfirmBroadcasts({
              cells: cc.cells,
              confirmedIndexes: nowReflected.map(([, e]) => e.cellIndex),
              uid: actedUid,
              roster: cc.players,
              rosterConfirmed: cc.rosterConfirmed,
              hasPriorBingo: witnessed,
            });
            if (plan.bingo) broadcastBingo(actor);
            // No dayIndex here (Codex finding 3, fix/d15-blackout-day-naming):
            // `board` above is `useBoard(uid)`, the LEGACY single-Board hook —
            // `dealDayCard` never writes that path in daily-cards mode (api.ts),
            // so `boardOwned` (and therefore this whole drain) can only be true
            // on a legacy, non-daily Event, where a blackout Moment stays
            // day-less (mirrors Board.tsx's live-mark path, Codex finding 1).
            // The confirmed Claim DOES carry its own `dayIndex` in daily-cards
            // mode, but this component has no day-scoped board/claim wiring to
            // safely attribute a batch confirm's blackout to ONE Claim's Day —
            // making the confirm path daily-aware is a separate, out-of-scope
            // ticket (this component's `admin_confirmed`-mode Moments are
            // already inert for daily Events today via the `boardOwned` gate).
            if (plan.blackout) broadcastBlackout(actor);
            if (plan.firstBingo) broadcastFirstBingo(actor);
            else if (plan.firstBingoHeld) st2.heldCeremony = actor;
            nowReflected.forEach(([id]) => st2.awaiting.delete(id));
          }
          // Drain-until-empty: any confirm still awaiting (its board write not yet
          // landed) is retried on the next board snapshot; re-run in case one became
          // reflected during this synchronous emit.
          drainRef.current();
        }
      })
      .catch(() => {
        getConfirmState(actedUid).inFlight = false;
      });
  }, []);
  drainRef.current = drain;

  // Resolve — or FALL-CLEAR — a first-BINGO candidate parked at the roster gate.
  // Runs on every board update while holding (never re-reads the witness — eligibility
  // was fixed at detection).
  //
  // FALL-CLEARING (Codex #116 R2 finding 1): the held candidate is identified with the
  // ORIGINAL win; if that win no longer STANDS on an attributable board, VOID it —
  // REGARDLESS of roster/identity state. Without this, a slow-roster window let a
  // player lose the held bingo then complete a DIFFERENT line before the roster
  // confirmed, and the publish-time `hasBingo` check would then fire the STALE held
  // singleton against the REGAINED board. Because the board effect runs on every
  // snapshot, the unmark that drops the bingo produces a no-bingo snapshot that clears
  // the candidate here BEFORE any regain — mirroring the #110 round-4 fall clearing
  // (drop the candidate on an observed bingo fall). A later regained line is a NEW win,
  // adjudicated by its own confirm transition, never this candidate.
  const resolveHeldCeremony = useCallback(() => {
    const c = ctx.current;
    if (!c.uid) return;
    const st = getConfirmState(c.uid);
    const actor = st.heldCeremony;
    if (!actor || actor.uid !== c.uid) return;
    // A missing / non-attributable board is NOT an observed fall — hold.
    if (!c.boardOwned || c.cells.length === 0) return;
    // Attributable board with no standing bingo → the held win fell: drop it, even
    // while the roster is still unconfirmed.
    if (!hasBingo(c.cells)) {
      st.heldCeremony = null;
      return;
    }
    // The win still stands — publish only once the identity + roster gates open.
    if (!c.identityKnown || !c.rosterConfirmed) return; // still held
    const othersBingoed = c.players.some((p) => p.uid !== c.uid && p.firstBingoAt != null);
    if (!othersBingoed) broadcastFirstBingo(actor);
    st.heldCeremony = null;
  }, []);

  // Detect fresh confirms. A Claim seen PENDING is remembered; a Claim seen
  // CONFIRMED is a fresh emit only if it was previously seen pending — so a Claim
  // already confirmed at first sight (history / the fully-closed residual) is
  // baselined, while a pending→confirmed flip observed while mounted (INCLUDING one
  // that becomes visible only on reconnect) emits (round-1 finding 3).
  //
  // SERVER-BACKED WITNESS ONLY (Codex #116 R2 finding 2): the pending observation
  // that seeds the freshness witness must come from a SERVER-backed snapshot, never a
  // cache-only one. On a fresh reload the persistent IndexedDB cache replays the
  // last-known rows; a Claim that was pending at close and confirmed WHILE CLOSED
  // could otherwise be recorded pending from that cache snapshot, making the
  // subsequent server `confirmed` look like an in-session flip and posting a NEW
  // Moment (with `Date.now()`) that pins an OLD admin confirmation to the Feed top.
  // Gating the seed on `!claimsFromCache` keeps the fully-closed confirm baselined
  // (the accepted residual) while the offline-BUT-OPEN case still fires — that case
  // observed the Claim pending from a server snapshot IN-SESSION before going offline,
  // so it seeds normally and its reconnect `confirmed` is a genuine fresh transition.
  useEffect(() => {
    if (!uid) return;
    const st = getConfirmState(uid);
    let added = false;
    for (const c of claims) {
      // Cross-account guard (Codex #116 R3 finding 1): on an account switch, useColSub
      // clears the previous query's rows only in an effect, so this component can
      // render once — or a queued stale listener callback can fire — with the PREVIOUS
      // account's Claims under the NEW uid. Ignore any Claim not owned by the current
      // uid at the point of use, so a prior account's Claim can neither seed this
      // account's witness nor adjudicate against its board (belt-and-braces beyond the
      // effect-time clear, the same synchronous attribution guard #110/#106 use).
      if (c.uid !== uid) continue;
      if (c.status === 'pending') {
        if (!claimsFromCache) st.seenPending.add(c.id);
      } else if (c.status === 'confirmed' && st.seenPending.has(c.id) && !st.handled.has(c.id)) {
        st.handled.add(c.id);
        // Carry the proofId so reflection is claim-SPECIFIC (R4 finding 2): a
        // different claim's confirm at the same square must not count as this one's.
        st.awaiting.set(c.id, { cellIndex: c.cellIndex, proofId: c.proofId ?? null });
        added = true;
      }
    }
    if (added) drain();
  }, [claims, claimsFromCache, uid, drain]);

  // Re-attempt on a board snapshot (the confirm's board write can lag its claim) or
  // when a gate opens (identity resolves / the roster becomes server-confirmed).
  useEffect(() => {
    drain();
    resolveHeldCeremony();
  }, [board, identityKnown, rosterConfirmed, drain, resolveHeldCeremony]);

  return null;
}
