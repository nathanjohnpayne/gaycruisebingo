import { track } from '../analytics';
import { useAuth } from '../auth/AuthContext';
import { useBoard, useEventDoc, useMyPlayer } from '../hooks/useData';
import { resolveDisplayName } from '../data/api';
import { renderBingoShareCard, shareCardBlob, SHARE_CARD_APP_NAME } from './ShareCard';

function celebrationCopy(kind: 'bingo' | 'blackout'): string {
  return kind === 'blackout' ? 'BLACKOUT. I win the boat. 🚢' : 'I got BINGO on the high seas 🚢';
}

export default function Celebration({
  kind,
  onClose,
}: {
  kind: 'bingo' | 'blackout';
  onClose: () => void;
}) {
  // Board.tsx renders <Celebration kind onClose /> with no other props (it's
  // off-limits this ticket), so the card's own content — the Player's board,
  // display name, and Event name — is resolved here via the same hooks Board
  // itself already reads from.
  const { user } = useAuth();
  const uid = user?.uid;
  const { data: board } = useBoard(uid);
  const { data: player } = useMyPlayer(uid);
  const { data: event } = useEventDoc();
  const playerName = resolveDisplayName(player, user?.displayName);
  const eventName = event?.name ?? SHARE_CARD_APP_NAME;

  const share = async () => {
    const text = celebrationCopy(kind);
    const url = window.location.origin;

    // On-device render (ADR 0005): a failure here (unsupported environment,
    // html-to-image throwing, etc.) must not block sharing outright — it just
    // means the fallback chain below has no image to work with.
    let blob: Blob | null = null;
    try {
      blob = await renderBingoShareCard({ kind, playerName, eventName, cells: board?.cells ?? [] });
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
