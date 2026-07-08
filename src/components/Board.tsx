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
  const { data: player } = useMyPlayer(uid);
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
        currentFirstBingoAt: player?.firstBingoAt ?? null,
      });
      track('mark_square', { mode: claimMode, marked: nextMarked });
      if (nextMarked && res.bingo) track('bingo');
    } catch {
      /* offline — the live listener reconciles when back online */
    }
  };

  const toggle = (c: Cell) => {
    if (c.free) return;
    if (c.marked) {
      doMark(c, false); // unmark is always instant
      return;
    }
    if (claimMode === 'honor') doMark(c, true);
    else setProofTarget(c); // proof_required / verified capture proof first
  };

  const modeLabel =
    claimMode === 'honor' ? 'Honor system' : claimMode === 'proof_required' ? 'Proof required' : 'Verified';

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
