import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useBoard, useMyPlayer, useEventDoc } from '../hooks/useData';
import { setMark } from '../data/api';
import { hasBingo, isBlackout, winningCells, countMarked } from '../game/logic';
import { track } from '../analytics';
import Celebration from './Celebration';
import ProofSheet from './ProofSheet';
import type { Cell, ClaimMode } from '../types';

export default function Board() {
  const { user } = useAuth();
  const uid = user?.uid;
  const { data: board } = useBoard(uid);
  const { data: player, loading: playerLoading } = useMyPlayer(uid);
  const { data: event } = useEventDoc();
  const claimMode: ClaimMode = event?.claimMode ?? 'honor';

  const [celebrate, setCelebrate] = useState<null | 'bingo' | 'blackout'>(null);
  const [proofTarget, setProofTarget] = useState<Cell | null>(null);
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
  if (!board) return <div className="center muted">Dealing your card…</div>;

  const wins = winningCells(cells);

  const doMark = async (c: Cell, nextMarked: boolean) => {
    try {
      const res = await setMark({
        uid,
        cells,
        index: c.index,
        nextMarked,
        claimMode,
        // While the player row is still loading its first snapshot, pass
        // `undefined` (UNKNOWN) rather than a `null` that reads as a real "no
        // first bingo yet": on a cache miss that null would let setMark restamp
        // firstBingoAt with now and clobber the earlier server value (Codex P2,
        // PR #75). Once loaded, a genuine null is passed through.
        currentFirstBingoAt: playerLoading ? undefined : (player?.firstBingoAt ?? null),
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
            {c.free ? 'FREE' : c.text}
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
          displayName={user.displayName ?? 'Anonymous'}
          photoURL={user.photoURL ?? null}
          cells={cells}
          cell={proofTarget}
          claimMode={claimMode}
          currentFirstBingoAt={player?.firstBingoAt ?? null}
          onClose={() => setProofTarget(null)}
        />
      )}
    </>
  );
}
