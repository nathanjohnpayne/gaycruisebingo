import { useEffect, useRef } from 'react';
import { track } from '../analytics';
import { useEventDoc } from '../hooks/useData';
import { renderBingoShareCard, shareCardBlob, SHARE_CARD_APP_NAME } from './ShareCard';
import type { Cell } from '../types';

function celebrationCopy(kind: 'bingo' | 'blackout'): string {
  return kind === 'blackout' ? 'BLACKOUT. I win the boat. 🚢' : 'I got BINGO on the high seas 🚢';
}

export default function Celebration({
  kind,
  cells,
  playerName,
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
  // The Player's RESOLVED public display name — Board.tsx's own
  // `resolveDisplayName(player, user?.displayName)` output, passed down only
  // when its identity tri-state says the saved row is KNOWN (`identityKnown`),
  // and `null` otherwise (Codex P2, PR #111 round 2 finding 1 — the identity
  // twin of the cells race above). Celebration used to run its own
  // `useMyPlayer(uid)` listener + resolveDisplayName, which starts `data:
  // null` on mount, so an immediate Share tap resolved the STALE auth
  // (Google) name for a returning Player with a saved custom name — exactly
  // the window in which Board's doMark deliberately withholds the name from
  // Tally markers. `null` here means "not yet known": the Share affordance
  // is disabled below (mirroring how the Moment broadcasts HOLD until the
  // identity gate opens) rather than ever stamping the auth fallback onto a
  // card. In practice the gate is belt-and-braces: identityKnown is true in
  // every online flow long before a win can be marked (the player-row
  // subscription resolves at app start); the reachable-null window is an
  // offline reload whose persistent cache holds the board but not the
  // player row (see Board.tsx's knownFirstBingoAt comment). The card
  // renders no avatar (BingoShareCardData has no photo field), so only the
  // name is threaded.
  playerName: string | null;
  onClose: () => void;
}) {
  // Event name still resolves via the same hook Board.tsx itself reads: it
  // is not identity (no per-user staleness to leak) and has a benign
  // app-name fallback, pinned by the "falls back to the app name" test.
  const { data: event } = useEventDoc();
  const eventName = event?.name ?? SHARE_CARD_APP_NAME;

  // EAGER pre-render (Codex P2, PR #111 round 2 finding 2): rasterization
  // starts at MOUNT — the card's data is fixed by then — not at tap time. A
  // tap-time `await renderBingoShareCard(...)` could outlive the browser's
  // transient user-activation window on a slow device, making the later
  // `navigator.share` reject NotAllowedError (which the cancellation
  // classifier treats as terminal): the tap would do NOTHING — no sheet, no
  // fallback. With the render pre-started, the tap awaits a
  // usually-already-settled promise and `navigator.share` runs within the
  // activation window. The effect re-keys on the card's inputs, so a
  // late-arriving Event name re-renders the card once rather than baking
  // the stale fallback in. The `.catch(() => null)` lives INSIDE the cached
  // promise: a render failure (unsupported environment, html-to-image
  // throwing, or the 25-cell validity gate refusing a malformed board)
  // resolves to null — never an unhandled rejection when the Player closes
  // without ever tapping Share — and shareCardBlob then degrades to the
  // text/URL leg rather than ever sharing an empty/partial grid.
  const cardBlob = useRef<Promise<Blob | null> | null>(null);
  useEffect(() => {
    if (playerName == null) {
      // Identity not yet known (round 2 finding 1): nothing to pre-render —
      // the Share affordance is disabled until Board resolves the saved name.
      cardBlob.current = null;
      return;
    }
    cardBlob.current = renderBingoShareCard({ kind, playerName, eventName, cells }).catch(
      () => null,
    );
  }, [kind, playerName, eventName, cells]);

  const share = async () => {
    if (playerName == null) return; // the disabled button is the real gate; belt-and-braces
    const text = celebrationCopy(kind);
    const url = window.location.origin;

    // Usually the mount-time pre-render, already settled. The lazy fallback
    // only covers a tap that somehow precedes the effect (not reachable
    // through the DOM — effects flush before the browser can deliver a
    // click — but cheap to keep correct).
    const blob = await (cardBlob.current ??
      renderBingoShareCard({ kind, playerName, eventName, cells }).catch(() => null));

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
          <button className="btn primary" onClick={share} disabled={playerName == null}>
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
