import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useBoard, useMyPlayer, useEventDoc, useItems, useTally } from '../hooks/useData';
import { setMark } from '../data/api';
import { hasBingo, isBlackout, winningCells, countMarked, MIN_POOL } from '../game/logic';
import { track } from '../analytics';
import Celebration from './Celebration';
import ProofSheet from './ProofSheet';
import type { Cell, ClaimMode } from '../types';

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
  // ONE resolution of the caller's public display name, sourced from the saved
  // player row — the denormalized identity the profile editor keeps current
  // (data/profile.ts writes users/{uid} + the player row, #76/#78) — with the
  // live auth value as the pre-load fallback. It feeds BOTH the per-Prompt Tally
  // marker attribution (setMark, below) AND the new-Proof attribution (ProofSheet),
  // so a Mark and a Proof always publish the SAME identity the leaderboard shows —
  // never two divergent name sources (ADR 0002).
  const displayName = player?.displayName ?? user?.displayName ?? 'Anonymous';
  const { data: event } = useEventDoc();
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

  const cells: Cell[] = board?.cells ?? [];

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
    if (black && !wasBlackout.current) {
      setCelebrate('blackout');
      track('blackout');
    } else if (bingo && !wasBingo.current) {
      setCelebrate('bingo');
    }
    wasBingo.current = bingo;
    wasBlackout.current = black;
  }, [cells]);

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
        displayName,
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
