import { track } from '../analytics';
import { useAuth } from '../auth/AuthContext';
import { useEventDoc, useMyPlayer } from '../hooks/useData';
import { resolveDisplayName } from '../data/api';
import { renderBingoShareCard, shareCardBlob, SHARE_CARD_APP_NAME } from './ShareCard';
import type { Cell } from '../types';

function celebrationCopy(kind: 'bingo' | 'blackout'): string {
  return kind === 'blackout' ? 'BLACKOUT. I win the boat. 🚢' : 'I got BINGO on the high seas 🚢';
}

export default function Celebration({
  kind,
  cells,
  onClose,
}: {
  kind: 'bingo' | 'blackout';
  // The Player's own 25-cell board, exactly as Board.tsx has it at the
  // moment it opens this modal (Codex P2, PR #111 finding 1). Celebration
  // used to open its OWN `useBoard(uid)` listener and read `board?.cells ??
  // []`, which starts unset until that subscription's first snapshot
  // arrives — a fast Share tap could render and share a ZERO-CELL card even
  // though Board already had the real cells (its `!board` early-return
  // guarantees a loaded board before <Celebration> ever renders). Taking
  // the prop instead removes the race structurally: there is no second
  // subscription left to lose it.
  cells: Cell[];
  onClose: () => void;
}) {
  // Display name and Event name still resolve via the same hooks Board.tsx
  // itself already reads from; only the board `cells` moved to a prop above.
  const { user } = useAuth();
  const uid = user?.uid;
  const { data: player } = useMyPlayer(uid);
  const { data: event } = useEventDoc();
  const playerName = resolveDisplayName(player, user?.displayName);
  const eventName = event?.name ?? SHARE_CARD_APP_NAME;

  const share = async () => {
    const text = celebrationCopy(kind);
    const url = window.location.origin;

    // On-device render (ADR 0005): a failure here — unsupported environment,
    // html-to-image throwing, or renderBingoShareCard's own validity gate
    // refusing anything but a real 25-cell board (Codex P2, PR #111 finding
    // 1) — must not block sharing outright; it just means the fallback
    // chain below has no image to work with, and shareCardBlob degrades to
    // the text/URL share leg rather than ever sharing an empty/partial grid.
    let blob: Blob | null = null;
    try {
      blob = await renderBingoShareCard({ kind, playerName, eventName, cells });
    } catch {
      /* fall through with blob: null */
    }

    try {
      await shareCardBlob({
        blob,
        filename: `gay-cruise-bingo-${kind}.png`,
        title: SHARE_CARD_APP_NAME,
        text,
        url,
      });
    } catch {
      // shareCardBlob is designed to never throw, but a share failure must
      // never crash the celebration UI regardless.
    } finally {
      // Fires on every path — image share, cancelled share, every fallback
      // leg, or a render failure — so a cancelled share still counts as a
      // tap (Codex P2, PR #111 finding 3): shareCardBlob's return value is
      // what distinguishes the outcomes, not whether this event fires.
      track('share_click', { surface: 'celebration' });
    }
  };

  return (
    <div className="celebrate" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}>
        <div className="big">{kind === 'blackout' ? 'BLACKOUT' : 'BINGO!'}</div>
        <p className="muted" style={{ letterSpacing: '0.14em', textTransform: 'uppercase' }}>
          You've seen some things.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 14 }}>
          <button className="btn primary" onClick={share}>
            Share
          </button>
          <button className="btn" onClick={onClose}>
            Keep playing
          </button>
        </div>
      </div>
    </div>
  );
}
