import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useBoard, useMyPlayer, useEventDoc, useItems } from '../hooks/useData';
import { setMark } from '../data/api';
import { hasBingo, isBlackout, winningCells, countMarked, MIN_POOL } from '../game/logic';
import { track } from '../analytics';
import Celebration from './Celebration';
import ProofSheet from './ProofSheet';
import type { Cell, ClaimMode } from '../types';

export default function Board() {
  const { user, dealError, dealing, retryDeal } = useAuth();
  const uid = user?.uid;
  const { data: board, loading: boardLoading } = useBoard(uid);
  const { data: player } = useMyPlayer(uid);
  const { data: event } = useEventDoc();
  // Codex P3 (PR #66): the pool only matters before a Board is dealt, so once
  // a Board exists this Player has no use for a live listener on every other
  // Player's prompt add/report. Gate the subscription to the no-board state.
  const { items, loading: poolLoading } = useItems(!board);
  const claimMode: ClaimMode = event?.claimMode ?? 'honor';

  const [celebrate, setCelebrate] = useState<null | 'bingo' | 'blackout'>(null);
  const [proofTarget, setProofTarget] = useState<Cell | null>(null);
  const wasBingo = useRef(false);
  const wasBlackout = useRef(false);
  const initialized = useRef(false);
  const retryFiredRef = useRef(false);

  const cells: Cell[] = board?.cells ?? [];
  const activePool = items.filter((i) => !i.isFreeSpace);

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

  // Codex P2 (PR #66): joinAndDeal throws once on a thin pool and nothing
  // previously re-attempted the deal after Prompts got added — the Player was
  // stuck until a reload or account switch. Once the active non-free pool
  // crosses back over MIN_POOL while a deal error is up and no deal is
  // already in flight, fire AuthContext's retryDeal(). Edge-triggered on the
  // pool crossing the threshold (the ref resets below it) so a healthy pool
  // re-firing this effect on every later snapshot retries once per recovery,
  // not once per snapshot.
  useEffect(() => {
    if (activePool.length < MIN_POOL) {
      retryFiredRef.current = false;
      return;
    }
    if (!board && dealError && !dealing && !retryFiredRef.current) {
      retryFiredRef.current = true;
      retryDeal();
    }
  }, [board, dealError, dealing, activePool.length, retryDeal]);

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
    // dealt board is mid-fetch when the pool has since gone thin.
    if (!boardLoading && !poolLoading && activePool.length < MIN_POOL) {
      return (
        <div className="center muted" role="alert">
          <p>Not enough prompts to deal a full card yet.</p>
          <p>
            A card needs {MIN_POOL} prompts; the pool has {activePool.length}. Add prompts from the
            Prompts tab and your card deals automatically.
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
