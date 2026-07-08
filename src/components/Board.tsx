import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useBoard, useMyPlayer, useEventDoc, useItems, useTally, useLeaderboard } from '../hooks/useData';
import { setMark, resolveDisplayName } from '../data/api';
import { broadcastBingo, broadcastBlackout, broadcastFirstBingo } from '../data/moments';
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
  const wasBingo = useRef(false);
  const wasBlackout = useRef(false);
  const initialized = useRef(false);
  // A Moment edge crossed while its GATE is still closed is HELD here, keyed by
  // kind, and fired by `flushPending` once the gate opens (Codex P2, PR #99). Two
  // gates: identity-known gates ALL three broadcasts — never stamp a returning
  // Player's stale auth/Google name into an IMMUTABLE Moment, the same window in
  // which setMark passes `undefined` (finding 1); a server-confirmed roster
  // additionally gates first_bingo (finding 2). The deterministic Moment doc id
  // keeps a held-then-fired broadcast idempotent. Reset per-uid below (finding 5).
  const pending = useRef<{ bingo: boolean; blackout: boolean; firstBingo: boolean }>({
    bingo: false,
    blackout: false,
    firstBingo: false,
  });

  const cells: Cell[] = board?.cells ?? [];

  // The latest identity + roster + gate signals for Moment broadcasts, stored in a
  // ref so the edge effect and `flushPending` can READ them without DEPENDING on
  // them — the edge effect must fire only on a genuine board transition (`[cells]`),
  // never when the resolved name or the roster merely re-renders. Written every
  // render (store-latest-value ref). photoURL mirrors ProofSheet: a loaded player
  // row's null photo wins over the stale auth photo. The name is the SAME resolved
  // public identity the Tally + Proof carry; moments.ts bounds it to the rules' ≤100
  // contract. `identityKnown`/`rosterConfirmed` travel here too so `flushPending`
  // always reads the CURRENT gate state, never a stale render's closure.
  const feedCtx = useRef<{
    uid: string | undefined;
    displayName: string;
    photoURL: string | null;
    players: PlayerDoc[];
    identityKnown: boolean;
    rosterConfirmed: boolean;
  }>({
    uid: undefined,
    displayName: 'Anonymous',
    photoURL: null,
    players: [],
    identityKnown: false,
    rosterConfirmed: false,
  });
  feedCtx.current = {
    uid,
    displayName,
    photoURL: player ? player.photoURL : (user?.photoURL ?? null),
    players,
    identityKnown,
    rosterConfirmed,
  };

  // Fire any HELD broadcast whose gate is now open, reading the LATEST identity +
  // roster from feedCtx (never a stale closure). All three broadcasts need a KNOWN
  // identity; first_bingo additionally needs a SERVER-CONFIRMED roster and is
  // re-decided against it here. Each fired kind clears its flag so a later flush
  // can't re-fire it (the deterministic doc id is the structural backstop besides).
  // Stable (reads only refs), so the effects below list it without churn.
  const flushPending = useCallback(() => {
    const {
      uid: cUid,
      displayName: cName,
      photoURL: cPhoto,
      players: roster,
      identityKnown: idKnown,
      rosterConfirmed: rosterOk,
    } = feedCtx.current;
    // Identity gate (finding 1): with no KNOWN saved identity, HOLD every broadcast
    // rather than stamp the possibly-stale auth name into an immutable Moment doc.
    if (!cUid || !idKnown) return;
    const actor = { uid: cUid, displayName: cName, photoURL: cPhoto };
    if (pending.current.bingo) {
      broadcastBingo(actor);
      pending.current.bingo = false;
    }
    if (pending.current.blackout) {
      broadcastBlackout(actor);
      pending.current.blackout = false;
    }
    if (pending.current.firstBingo) {
      // Roster gate (finding 2): claim First-to-BINGO only against a SERVER-CONFIRMED
      // roster — an unloaded/cache-only empty roster is not proof nobody has bingoed;
      // hold until it is server-backed rather than guess.
      if (!rosterOk) return;
      // Ceremonial + self-reported (ADR 0001): claim it only when, as far as this
      // client's CONFIRMED known-players view shows, no OTHER Player has bingoed yet.
      // The race (two clients briefly both believing they are first) resolves to one
      // Moment per Event via the singleton doc id.
      const othersBingoed = roster.some((p) => p.uid !== cUid && p.firstBingoAt != null);
      if (!othersBingoed) broadcastFirstBingo(actor);
      pending.current.firstBingo = false;
    }
  }, []);

  // Account switch (finding 5): the edge refs + pending broadcasts are per-uid.
  // When the signed-in uid changes while Board stays mounted, restore the
  // uninitialized baseline BEFORE the cells effect below re-runs, so the new
  // account's first snapshot with a standing bingo re-establishes init (no fire)
  // instead of inheriting the previous account's wasBingo/wasBlackout and firing a
  // spurious edge. Declared before the cells effect so it runs first in any commit
  // where both `uid` and `cells` changed.
  useEffect(() => {
    initialized.current = false;
    wasBingo.current = false;
    wasBlackout.current = false;
    pending.current = { bingo: false, blackout: false, firstBingo: false };
  }, [uid]);

  // When a gate OPENS — identity resolves, or the roster becomes server-confirmed —
  // fire any broadcast held while it was closed (findings 1 + 2).
  useEffect(() => {
    flushPending();
  }, [identityKnown, rosterConfirmed, flushPending]);

  useEffect(() => {
    if (!cells.length) return;
    const bingo = hasBingo(cells);
    const black = isBlackout(cells);
    if (!initialized.current) {
      wasBingo.current = bingo;
      wasBlackout.current = black;
      initialized.current = true;
      return;
    }
    const bingoEdge = bingo && !wasBingo.current;
    const blackoutEdge = black && !wasBlackout.current;
    // Celebration UI (unchanged): a Blackout takes visual priority over a plain
    // BINGO, and only one animation shows at a time. This is LOCAL UI, fired on the
    // edge itself and never held — only the Moment write is gated below.
    if (blackoutEdge) {
      setCelebrate('blackout');
      track('blackout');
    } else if (bingoEdge) {
      setCelebrate('bingo');
    }
    // Enqueue the matching Moment(s) for each crossed edge, then flush (ADR 0002) —
    // fire-and-forget and offline-queueable (src/data/moments.ts). Each fires on its
    // OWN transition, independent of the celebration's visual priority, and once per
    // Player (the deterministic Moment doc id makes the once-only structural: a
    // re-fire on a lose→regain, a reload, or another tab hits the create-only rule —
    // updates are denied — and is rejected). On a real 5×5 board the first-line
    // (BINGO) edge always precedes the full-card (Blackout) edge, so a Blackout never
    // suppresses the earlier first-BINGO broadcast. A bare Mark that completes no line
    // crosses NO edge here, so it broadcasts nothing. A bingo edge enqueues BOTH the
    // per-Player bingo AND the ceremonial first_bingo candidate; flushPending fires
    // each once its gate is open — holding, never dropping, whatever is still gated.
    if (bingoEdge) {
      pending.current.bingo = true;
      pending.current.firstBingo = true;
    }
    if (blackoutEdge) {
      pending.current.blackout = true;
    }
    flushPending();
    wasBingo.current = bingo;
    wasBlackout.current = black;
  }, [cells, flushPending]);

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
    } catch {
      /* Neither an offline Mark nor an online write REJECTION lands here:
         setMark's commit is fire-and-forget. Offline it queues durably in the
         persistent cache (ADR 0006, #20) and syncs on reconnect; an online
         rejection is logged inside setMark and self-corrects when Firestore
         rolls the write back and the live listener re-renders without the Mark.
         This catch only guards a synchronous throw from setMark itself. */
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
