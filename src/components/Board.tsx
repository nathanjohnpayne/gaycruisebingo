import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useBoard, useMyPlayer, useEventDoc, useItems, useTally, useLeaderboard } from '../hooks/useData';
import { setMark, resolveDisplayName } from '../data/api';
import {
  broadcastBingo,
  broadcastBlackout,
  broadcastFirstBingo,
  hasPriorBingoWitness,
  enqueueWinMoments,
  enqueueFirstBingoMoment,
  peekPendingMoments,
  clearPendingMoment,
  dropPendingWins,
  pendingActionGeneration,
} from '../data/moments';
import { hasBingo, isBlackout, winningCells, countMarked, MIN_POOL } from '../game/logic';
import { track } from '../analytics';
import Celebration from './Celebration';
import ProofSheet from './ProofSheet';
import type { Cell, ClaimMode, PlayerDoc } from '../types';

/**
 * The per-Prompt Tally count badge on a marked Square (ADR 0002). Subscribes to
 * the Prompt's marker subcollection and shows how many Players have marked it;
 * tapping opens the who-list. Rendered only on marked, non-free Squares, so a
 * freshly dealt card (only the free centre "on") surfaces no badge at all.
 */
function TallyBadge({ itemId, onOpen }: { itemId: string; onOpen: () => void }) {
  const { count } = useTally(itemId);
  if (count <= 0) return null;
  return (
    <button
      className="tally-badge"
      title="See who marked this"
      aria-label={`${count} marked — see who`}
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
    >
      {count}
    </button>
  );
}

/**
 * The tap-to-see-who list for a Prompt's Tally (ADR 0002): names EVERY Player who
 * marked the Prompt — no anonymity — chronologically. Reuses the proof-capture
 * sheet chrome. Markers carry no photo (the marker doc is just uid + displayName +
 * markedAt), so the avatar is the name's initial.
 */
function TallySheet({
  itemId,
  itemText,
  onClose,
}: {
  itemId: string;
  itemText: string;
  onClose: () => void;
}) {
  const { markers, loading } = useTally(itemId);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-title">Who marked “{itemText}”</div>
        {loading && markers.length === 0 ? (
          <p className="muted tally-empty">Loading…</p>
        ) : markers.length === 0 ? (
          <p className="muted tally-empty">No one has marked this yet.</p>
        ) : (
          <div className="list">
            {markers.map((m) => (
              <div className="row" key={m.uid}>
                <div className="avatar">{(m.displayName.trim()[0] ?? '?').toUpperCase()}</div>
                <div className="grow">
                  <div className="name">{m.displayName}</div>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="sheet-actions">
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The caller's first-bingo state for a Mark is KNOWN only when the player row
 * genuinely resolved. While the subscription is still loading, OR when a
 * cache-only snapshot settled as "absent" without server confirmation (an
 * offline reload can cache the board but not the player row, and Firestore
 * reports an uncached doc as non-existent), the prior value is UNKNOWN —
 * `undefined` — so setMark omits the preserve-vs-stamp write instead of
 * treating a phantom `null` as a real "no first bingo yet" and re-stamping
 * over the server's earlier value (Codex P2, PR #75 rounds 2 + 4). A CACHED
 * row is real knowledge either way; a loaded `null` is a known none.
 * Exported for the unit test in `src/data/w1-board-mark-win.test.ts`.
 */
export function knownFirstBingoAt(
  player: { firstBingoAt?: number | null } | null,
  loading: boolean,
  serverConfirmed: boolean,
): number | null | undefined {
  if (loading || (player === null && !serverConfirmed)) return undefined;
  return player?.firstBingoAt ?? null;
}

export default function Board() {
  const { user } = useAuth();
  const uid = user?.uid;
  const { data: board, loading: boardLoading, hasServerData: boardConfirmed } = useBoard(uid);
  const { data: player, loading: playerLoading, hasServerData: playerConfirmed } = useMyPlayer(uid);
  // ONE resolution of the caller's public display name, fed to BOTH the per-Prompt
  // Tally marker (setMark, below) AND the new-Proof attribution (ProofSheet), so a
  // Mark and a Proof always publish the SAME identity the leaderboard shows — never
  // two divergent name sources (ADR 0002). It runs the saved player-row identity —
  // the denormalized name the profile editor keeps current (data/profile.ts writes
  // users/{uid} + the player row, #76/#78) — through `resolveDisplayName`, the same
  // validated resolver joinAndDeal uses (trim, ≤100-char cap, else the live auth value).
  const displayName = resolveDisplayName(player, user?.displayName);
  // ...but that saved identity is KNOWN only under the same tri-state as
  // knownFirstBingoAt above: while the subscription is still loading, or when a
  // cache-only snapshot settled "absent" without server confirmation, the row is
  // UNKNOWN — and `displayName` above has silently fallen back to the AUTH name.
  // Stamping that onto a Tally marker would publish a returning Player's stale
  // Google name over their customized one for any Mark tapped in the loading
  // window (Codex P2, PR #87). So doMark passes `displayName` only when the row
  // is known, and `undefined` otherwise — markerDisplayName then falls back to
  // the CACHED player row (the saved name), then 'Anonymous', deliberately never
  // the possibly-stale auth value. A loaded-null row IS known (a real "no saved
  // row"), so the auth fallback is then legitimate. ProofSheet keeps the resolved
  // string either way: its sheet only opens after a render with the row loaded in
  // practice, and #78 pins auth as its explicit pre-load fallback.
  const identityKnown = !playerLoading && (player !== null || playerConfirmed);
  const { data: event } = useEventDoc();
  // The known-players roster — the SAME data the Leaderboard's First-to-BINGO pin
  // reads (useLeaderboard) — used to derive whether THIS Player is first to BINGO
  // when broadcasting the ceremonial Moment (ADR 0001). Read into a ref below so
  // the edge effect stays keyed on `[cells]`. `rosterConfirmed` is the roster's
  // server-confirmed latch (useColSub's `hasServerData`): an initial EMPTY `players`
  // from a still-loading (or cache-only) subscription is NOT proof nobody has
  // bingoed, so the First-to-BINGO claim is HELD until the roster is server-backed
  // (Codex P2, PR #99 finding 2) rather than guessed from an unloaded roster.
  const { players, hasServerData: rosterConfirmed } = useLeaderboard();
  // Codex P3 (PR #66): the pool only matters before a Board is dealt, so once
  // a Board exists this Player has no use for a live listener on every other
  // Player's prompt add/report. Gate the subscription to the no-board state.
  const { items, loading: poolLoading, hasServerData: poolConfirmed } = useItems(!board);
  const claimMode: ClaimMode = event?.claimMode ?? 'honor';

  const [celebrate, setCelebrate] = useState<null | 'bingo' | 'blackout'>(null);
  const [proofTarget, setProofTarget] = useState<Cell | null>(null);
  const [tallyTarget, setTallyTarget] = useState<Cell | null>(null);
  // Edge refs for the COSMETIC Celebration UI only (issue #104). The public Moment
  // broadcast moved OFF this snapshot-diffing machinery and ONTO the action path —
  // doMark reads `setMark`'s synchronous win-transition verdict and enqueues into a
  // MODULE-scope pending queue that survives Board unmounts (src/data/moments.ts) —
  // so these refs no longer drive any Feed write. They serve one purpose now: fire
  // the local celebrate animation on the transition into a bingo/blackout, without
  // re-celebrating a win that ALREADY stood on first paint (a returning Player).
  // `initialized` holds that "baseline the first snapshot, detect edges after" rule;
  // the account-switch reset below re-establishes it per uid.
  const wasBingo = useRef(false);
  const wasBlackout = useRef(false);
  const initialized = useRef(false);

  // Account switch: the celebration edge state is per-uid, and the reset must run
  // BEFORE any effect of the uid-switch render — an effect-based reset raced the
  // still-stale subscription rows (useBoard/useMyPlayer return the PREVIOUS uid's
  // data for the render(s) before their keyed effects clear it), which could seed
  // the new account's celebration baseline from the OLD board. React's
  // adjust-during-render pattern: on a uid mismatch, restore the uninitialized
  // baseline synchronously (idempotent per uid, StrictMode-safe), and the
  // attribution gate below keeps the stale board out of this same render's effect.
  // The pending Moment queue needs NO reset here — it is module state keyed BY uid
  // (src/data/moments.ts), so a held win for the previous account can never drain
  // under the new one.
  const edgeStateUid = useRef(uid);
  if (edgeStateUid.current !== uid) {
    edgeStateUid.current = uid;
    initialized.current = false;
    wasBingo.current = false;
    wasBlackout.current = false;
  }

  const cells: Cell[] = board?.cells ?? [];
  // Attribution gate (round 2 finding B): board data is usable for edge state only
  // when the doc actually belongs to the CURRENT uid. During an account switch the
  // subscription still returns the previous uid's board for a render, and the
  // render-time reset above cannot stop this render's cells effect from seeding it
  // — this gate does. BoardDoc carries its owner's uid, so the check is direct.
  const cellsAttributable = board != null && board.uid === uid;

  // The latest identity + roster + gate signals + CURRENT attributable cells for
  // Moment broadcasts, stored in a ref so `drainMoments` (a stable callback)
  // always reads the CURRENT actor, gate state, and board, never a stale render's
  // closure. Written every render. photoURL mirrors ProofSheet: a loaded player
  // row's null photo wins over the stale auth photo. The name is the SAME resolved
  // public identity the Tally + Proof carry; moments.ts bounds it to the rules'
  // ≤100 contract. `cells` (attribution-gated: another uid's board contributes
  // NOTHING) is back here for the drain's FIRE-TIME REVALIDATION (Codex P2, PR
  // #110 finding 3, restoring the PR #99 round-3 invariant on the queue path): a
  // held win can fall without any local unmark verdict — another tab unmarks, a
  // rules rollback lands as a passive snapshot — so a drain must never publish
  // without re-checking the win against the board as it stands at fire time.
  const feedCtx = useRef<{
    uid: string | undefined;
    displayName: string;
    photoURL: string | null;
    players: PlayerDoc[];
    identityKnown: boolean;
    rosterConfirmed: boolean;
    cells: Cell[];
  }>({
    uid: undefined,
    displayName: 'Anonymous',
    photoURL: null,
    players: [],
    identityKnown: false,
    rosterConfirmed: false,
    cells: [],
  });
  feedCtx.current = {
    uid,
    displayName,
    photoURL: player ? player.photoURL : (user?.photoURL ?? null),
    players,
    identityKnown,
    rosterConfirmed,
    cells: cellsAttributable ? cells : [],
  };

  // Drain the module-scope pending queue (src/data/moments.ts): fire every held
  // Moment whose gate is now open, reading the LATEST actor + gates from feedCtx
  // (never a stale closure). Called after a mark enqueues (doMark, below) and
  // whenever a gate OPENS (identity resolves / the roster becomes server-confirmed).
  // Two gates:
  //   • Identity (all three, PR #99 finding 1): HOLD until a KNOWN saved identity,
  //     so a returning Player's stale auth/Google name is never stamped into an
  //     IMMUTABLE Moment (the same window setMark passes `undefined`). Because the
  //     queue is MODULE state, a held win survives a Board unmount / route change
  //     and drains on the next mount — the issue #104 fix. (Only a full page reload
  //     can still drop it; documented residual.)
  //   • Roster (first_bingo only, PR #99 finding 2): claim the ceremonial event
  //     singleton only against a SERVER-CONFIRMED roster showing no OTHER Player
  //     with an earlier bingo; while unconfirmed the candidate stays HELD (not
  //     cleared). The per-Player bingo/blackout do NOT wait on the roster.
  // FIRE-TIME REVALIDATION (Codex P2, PR #110 finding 3 — the PR #99 round-3
  // invariant, restored on the queue path): a held win can fall with NO local
  // unmark verdict — another tab unmarks it, or a rules rollback lands as a
  // passive snapshot — so the drain must never publish without re-checking the
  // win against the freshest board it has. `cellsOverride` lets the completing
  // action pass its own folded `res.cells` (doMark) — the authoritative
  // post-action state, since the render-current snapshot has usually not echoed
  // yet at that point; gate-open and snapshot drains use the render-current
  // attributable cells instead. hasBingo/isBlackout are recomputed, and a
  // NON-EMPTY attributable board is required before ANY publish: isBlackout([])
  // is vacuously TRUE ([].every(Boolean)), so the empty-board guard (PR #99
  // round 3 finding B) is load-bearing again on this path.
  //
  // On revalidation FAILURE the drain HOLDS (it does not clear): a drop here
  // would race the latency-compensation echo — a gate can open in the window
  // between the mark and its snapshot, when the rendered cells are still
  // pre-action — and re-lose held wins, the exact #104 bug class. The CLEARS for
  // fallen wins belong to the observers of the fall: doMark's unmark verdict and
  // the cells effect's passive falling edge (both via dropPendingWins, which also
  // bumps the action generation). A flag whose fall this tab never observes can
  // therefore idle un-fireable (revalidation keeps blocking it) until reload —
  // safe: nothing publishes for it.
  const drainMoments = useCallback((cellsOverride?: Cell[]) => {
    const {
      uid: cUid,
      displayName: cName,
      photoURL: cPhoto,
      players: roster,
      identityKnown: idKnown,
      rosterConfirmed: rosterOk,
      cells: cellsRendered,
    } = feedCtx.current;
    if (!cUid || !idKnown) return; // identity gate: hold every kind
    const pending = peekPendingMoments(cUid);
    if (!pending.bingo && !pending.blackout && !pending.firstBingo) return;
    const cellsNow = cellsOverride ?? cellsRendered;
    if (cellsNow.length === 0) return; // no attributable board → hold; never adjudicate vacuously
    const bingoNow = hasBingo(cellsNow);
    const blackoutNow = isBlackout(cellsNow);
    const actor = { uid: cUid, displayName: cName, photoURL: cPhoto };
    if (pending.bingo && bingoNow) {
      broadcastBingo(actor);
      clearPendingMoment(cUid, 'bingo');
    }
    if (pending.blackout && blackoutNow) {
      broadcastBlackout(actor);
      clearPendingMoment(cUid, 'blackout');
    }
    if (pending.firstBingo && bingoNow && rosterOk) {
      // Ceremonial + self-reported (ADR 0001): claim First-to-BINGO only when, as
      // far as this client's CONFIRMED known-players view shows, no OTHER Player
      // has bingoed yet — and only while the underlying bingo still STANDS. The
      // race (two clients briefly both believing they are first) resolves to one
      // Moment per Event via the singleton doc id. Decided-and-lost is a CLEAR
      // (not a fall): the ceremony was adjudicated, not invalidated.
      const othersBingoed = roster.some((p) => p.uid !== cUid && p.firstBingoAt != null);
      if (!othersBingoed) broadcastFirstBingo(actor);
      clearPendingMoment(cUid, 'firstBingo');
    }
  }, []);

  // When a gate OPENS — identity resolves, or the roster becomes server-confirmed —
  // drain any Moment held while it was closed (PR #99 findings 1 + 2). The queue
  // itself holds the state across unmounts; this effect just re-attempts the drain.
  useEffect(() => {
    drainMoments();
  }, [identityKnown, rosterConfirmed, drainMoments]);

  // Snapshot effect: the cosmetic Celebration edges (no public writes), PLUS two
  // queue-maintenance duties the PASSIVE stream owns (Codex P2, PR #110 finding 3):
  //   1. Falling-edge clears — a listener snapshot showing a previously-standing
  //      win now GONE (bingo/blackout true→false) means the win fell without any
  //      local unmark verdict (another tab unmarked it, or a rules rollback rolled
  //      the optimistic mark back). The corresponding queued flag is dropped via
  //      dropPendingWins (which also bumps the action generation), so the queue
  //      tracks reality even when no local action observes the fall.
  //   2. Drain attempts — a queued win whose gate is already open still needs a
  //      board to revalidate against; the snapshot that delivers it (a fresh
  //      mount's first board, the latency-compensation echo) triggers the drain.
  useEffect(() => {
    // Attribution gate (round 2 finding B): during an account switch this effect
    // can run one render with the PREVIOUS uid's board still in the subscription;
    // ignore a board that is not the current account's so it neither seeds the
    // celebration baseline, drops/drains queue flags, nor animates.
    if (!cellsAttributable || !cells.length) return;
    const bingo = hasBingo(cells);
    const black = isBlackout(cells);
    // Passive falling edges (duty 1) — compared against the PREVIOUS snapshot's
    // state before the refs re-seed below. On a mount's first snapshot the refs
    // are false, so nothing can spuriously read as a fall.
    if (uid) {
      if (wasBingo.current && !bingo) dropPendingWins(uid, { bingo: true });
      if (wasBlackout.current && !black) dropPendingWins(uid, { blackout: true });
    }
    // Baseline vs detection (round 2 finding C, kept for the animation): under the
    // ADR 0006 persistent cache the first snapshot(s) can be cache-only, and a
    // stale cache lacking a bingo the server already has would make the server
    // confirmation read as a live transition — animating a celebration for a win
    // that already stood. So while the board is NOT server-confirmed every snapshot
    // re-seeds wasBingo/wasBlackout without animating (initialized stays false); the
    // first server-confirmed snapshot is baseline too; edge DETECTION runs after it.
    // This is now purely cosmetic (no writes), so the round-3/round-4 local-action
    // machinery the offline MOMENT once needed is gone: a win completed while the
    // board is still cache-only animates when the board confirms — a small cosmetic
    // delay the durable Moment (action path, fires at mark time) does not share.
    if (!boardConfirmed || !initialized.current) {
      wasBingo.current = bingo;
      wasBlackout.current = black;
      initialized.current = boardConfirmed;
      drainMoments(); // duty 2: even a baseline snapshot delivers a board to revalidate against
      return;
    }
    const bingoEdge = bingo && !wasBingo.current;
    const blackoutEdge = black && !wasBlackout.current;
    // A Blackout takes visual priority over a plain BINGO; only one animation shows.
    if (blackoutEdge) {
      setCelebrate('blackout');
      track('blackout');
    } else if (bingoEdge) {
      setCelebrate('bingo');
    }
    wasBingo.current = bingo;
    wasBlackout.current = black;
    drainMoments(); // duty 2
  }, [cells, cellsAttributable, boardConfirmed, uid, drainMoments]);

  if (!uid) return null;
  if (!board) {
    // A Board is dealt once at join from the active, non-free Prompt pool
    // (ADR 0003). dealBoard needs >= MIN_POOL prompts (ADR 0004); with fewer the
    // deal throws and no Board is ever written, so a bare `!board` check would
    // spin on "Dealing…" forever. Detect the thin pool here and surface the
    // guard to the Player rather than the blank card AC forbids. While either
    // subscription is still loading we can't tell a thin pool from an unfetched
    // board or a deal in flight, so keep the neutral state until both resolve —
    // this also avoids flashing the guard at a returning Player whose already
    // dealt board is mid-fetch when the pool has since gone thin. `loading`
    // alone is not enough under the ADR 0006 persistent cache (Codex P2, PR #66
    // round 4): a cold/stale IndexedDB can resolve both listeners FROM CACHE
    // with board=null and items=[], which would flash "0 prompts" at a Player
    // whose server state is a healthy pool or an existing Board — so the alert
    // additionally requires both subscriptions' hasServerData latch (a
    // server-confirmed snapshot has arrived). Cache-only data keeps the neutral
    // state below. (The pool-recovery auto-retry is deliberately deferred to
    // #70 — recovery is manual (the DealError panel's Retry). This empty state
    // only explains the shortage; it must not promise automatic dealing.)
    const activePool = items.filter((i) => !i.isFreeSpace);
    if (
      !boardLoading &&
      !poolLoading &&
      boardConfirmed &&
      poolConfirmed &&
      activePool.length < MIN_POOL
    ) {
      return (
        <div className="center muted" role="alert">
          <p>Not enough prompts to deal a full card yet.</p>
          <p>
            A card needs {MIN_POOL} prompts; the pool has {activePool.length}. Add prompts from the
            Prompts tab, then retry dealing from the Card tab.
          </p>
        </div>
      );
    }
    return <div className="center muted">Dealing your card…</div>;
  }

  const wins = winningCells(cells);

  const doMark = async (c: Cell, nextMarked: boolean) => {
    // Attribution guard (Codex P2, PR #110 finding 2 — the SAME cellsAttributable
    // derivation the Celebration baseline uses): during an account switch the
    // subscription can still expose the PREVIOUS uid's board for a render, and a
    // tap landing in that render would fold the previous account's cells into the
    // current uid's board write AND feed its verdict into an immutable Moment
    // broadcast attributed to the current uid. Bail entirely — no setMark, no
    // enqueue; the next attributable render accepts taps normally.
    if (!cellsAttributable) return;
    try {
      const res = await setMark({
        uid,
        cells,
        index: c.index,
        nextMarked,
        claimMode,
        currentFirstBingoAt: knownFirstBingoAt(player, playerLoading, playerConfirmed),
        displayName: identityKnown ? displayName : undefined,
      });
      track('mark_square', { mode: claimMode, marked: nextMarked });
      if (nextMarked && res.bingo) track('bingo');
      // Feed Moment broadcast on the ACTION path (issue #104): the win is tied to
      // the mark that COMPLETED it — setMark's synchronous transition verdict —
      // not to a snapshot diff that dies on unmount. Enqueue into the module-scope
      // pending queue and drain; whatever gate is still closed stays queued (it
      // survives an unmount / route change) and drains on the next gate-open
      // (identity resolves / roster confirms). This covers the OFFLINE win for
      // free: setMark computes the transition from the local cache and its Moment
      // `setDoc` pends durably (ADR 0006), so no local-action-vs-hydration
      // disambiguation is needed anymore.
      if (nextMarked) {
        enqueueWinMoments({
          uid,
          bingoTransition: res.bingoTransition,
          blackoutTransition: res.blackoutTransition,
        });
        // The ceremonial First-to-BINGO candidate is gated by the durable prior-win
        // witness FIRST (round 2 finding D): a regained line whose owner already has
        // a `${uid}-bingo` Moment in the local cache must NOT re-claim the event
        // singleton. A cache miss (fresh device) resolves false, so the drain's
        // roster gate is the fallback (the narrowed residual the spec documents).
        //
        // The read is ASYNC, and the pending win can change inside that gap (Codex
        // P1, PR #110): the player can unmark and LOSE the bingo while the witness
        // read is in flight — the unmark verdict drops the queued flags — and a
        // continuation that re-enqueued on the uid check alone would let a later
        // drain publish the IMMUTABLE event singleton for a win that no longer
        // stands. So the continuation is triple-gated: the uid is still the acting
        // account (the queue is uid-keyed), the per-uid ACTION GENERATION captured
        // before the await is unchanged (every unmark and observed fall bumps it —
        // the token catches interleaved actions), AND the pending bingo flag still
        // stands (the flag recheck catches clears the token cannot see). Fail-
        // closed residual: a concurrent gate-open drain that FIRES the plain bingo
        // while the read is in flight clears the flag without bumping, so the
        // recheck forfeits the ceremonial candidate for that action — the bingo
        // itself published, and nothing false ever posts.
        if (res.bingoTransition) {
          const generation = pendingActionGeneration(uid);
          const witnessed = await hasPriorBingoWitness(uid);
          if (
            !witnessed &&
            feedCtx.current.uid === uid &&
            pendingActionGeneration(uid) === generation &&
            peekPendingMoments(uid).bingo
          ) {
            enqueueFirstBingoMoment(uid);
          }
        }
      } else {
        // Action-driven falling edge (issue #104, hardened by PR #110 finding 1):
        // an unmark whose verdict shows a win no longer stands DROPS its
        // still-held broadcast — a win completed-then-unmarked BEFORE its gate
        // opens never posts (a bingo fall also drops the ceremonial candidate) —
        // and EVERY unmark bumps the action generation so an in-flight witness
        // continuation from an earlier mark is invalidated. An already-drained
        // flag is a harmless no-op (the Moment is immutable + once-only besides).
        dropPendingWins(uid, { bingo: !res.bingo, blackout: !res.blackout });
      }
      // Drain with the action's own folded cells: the authoritative post-action
      // board (the render-current snapshot has usually not echoed yet), so the
      // fire-time revalidation sees the state this verdict came from. Skipped if
      // the account switched while the awaits were in flight — the queue keeps
      // the flags for this uid until its own next drain.
      if (feedCtx.current.uid === uid) drainMoments(res.cells);
    } catch {
      /* Neither an offline Mark nor an online write REJECTION lands here:
         setMark's commit is fire-and-forget. Offline it queues durably in the
         persistent cache (ADR 0006, #20) and syncs on reconnect; an online
         rejection is logged inside setMark and self-corrects when Firestore
         rolls the write back and the live listener re-renders without the Mark.
         This catch only guards a synchronous throw from setMark itself — no
         write happened and no Moment was enqueued, so there is nothing to
         broadcast or undo. */
    }
  };

  const toggle = (c: Cell) => {
    if (c.free) return;
    if (c.marked) {
      doMark(c, false); // unmark is always instant
      return;
    }
    if (claimMode === 'honor') doMark(c, true);
    else setProofTarget(c); // proof_required / admin_confirmed capture proof first
  };

  const modeLabel =
    claimMode === 'honor'
      ? 'Honor system'
      : claimMode === 'proof_required'
        ? 'Proof required'
        : 'Admin-confirmed';

  return (
    <>
      <div className="card-meta">
        <span>{event?.name ?? 'This cruise'}</span>
        <span>{modeLabel}</span>
      </div>
      <div className="bingo-head">
        {['B', 'I', 'N', 'G', 'O'].map((l) => (
          <span key={l}>{l}</span>
        ))}
      </div>
      <div className="grid">
        {cells.map((c) => (
          <div
            key={c.index}
            className={
              'cell' +
              (c.free ? ' free' : '') +
              (c.marked ? ' marked' : '') +
              (c.status === 'pending' ? ' pending' : '') +
              (wins.has(c.index) ? ' win' : '')
            }
            onClick={() => toggle(c)}
          >
            {c.text}
            {c.marked && !c.free && (
              <button
                className="proofbtn"
                title="Add proof"
                onClick={(e) => {
                  e.stopPropagation();
                  setProofTarget(c);
                }}
              >
                ＋
              </button>
            )}
            {c.marked && !c.free && c.itemId && (
              <TallyBadge itemId={c.itemId} onOpen={() => setTallyTarget(c)} />
            )}
          </div>
        ))}
      </div>
      <div className="count">
        Marked <b>{countMarked(cells)}</b> · Bingos <b>{player?.bingoCount ?? 0}</b>
      </div>
      {celebrate && <Celebration kind={celebrate} onClose={() => setCelebrate(null)} />}
      {proofTarget && user && (
        <ProofSheet
          uid={uid}
          // Attribute new proofs to the denormalized player identity, which the
          // profile editor keeps current (data/profile.ts writes users/{uid} +
          // the player row, #76). Sourcing straight from the Firebase Auth user
          // would stamp the stale Google name onto proofs a renamed player
          // creates. displayName reuses the single `displayName` resolved above,
          // so a Proof and its Tally marker always carry the SAME name — one
          // source, never two. photoURL keys on whether `player` is loaded rather
          // than `??`-chaining: PlayerDoc.photoURL is nullable, and a loaded row
          // with a null photo means "no avatar" — that null must win over the
          // stale auth photo, not be masked by it.
          displayName={displayName}
          photoURL={player ? player.photoURL : (user.photoURL ?? null)}
          cells={cells}
          cell={proofTarget}
          claimMode={claimMode}
          currentFirstBingoAt={player?.firstBingoAt ?? null}
          onClose={() => setProofTarget(null)}
        />
      )}
      {tallyTarget && tallyTarget.itemId && (
        <TallySheet
          itemId={tallyTarget.itemId}
          itemText={tallyTarget.text}
          onClose={() => setTallyTarget(null)}
        />
      )}
    </>
  );
}
