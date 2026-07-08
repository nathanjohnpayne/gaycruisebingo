import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useItems } from '../hooks/useData';
import { MIN_POOL } from '../game/logic';

export default function SignIn() {
  const { signIn } = useAuth();
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setBusy(true);
    try {
      await signIn();
    } catch {
      setBusy(false);
    }
  };

  return (
    <div className="signin">
      <h1>GAY CRUISE BINGO</h1>
      <p className="muted">
        Trieste → Barcelona · July 2026. Sign in, get your card, mark it if you see it.
      </p>
      <label className="ack">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
        <span>
          I'm 18 or older and I know exactly what I'm getting into. Keep it legal, no minors, and
          don't post people who didn't consent.
        </span>
      </label>
      <button className="btn primary block" disabled={!ack || busy} onClick={go}>
        {busy ? 'Signing in…' : 'Continue with Google'}
      </button>
      <p className="muted" style={{ fontSize: 11 }}>
        Lost signal at sea? The printed cards and PDF still work.
      </p>
    </div>
  );
}

// Retry surface shown when a signed-in Player's Board couldn't be dealt (see
// App.tsx / AuthContext): a Player-worded reason plus a Retry that re-invokes
// `joinAndDeal` in place, instead of dropping the Player onto a blank Board.
export function DealError({
  message,
  onRetry,
  retrying,
}: {
  message: string;
  onRetry: () => void;
  retrying: boolean;
}) {
  // Pool-recovery auto-retry (Codex P2, PR #66 round 2). While a deal error is
  // up, App renders THIS panel instead of Board, so a watcher inside Board is
  // never mounted in the state it must observe — after a failed thin-pool
  // join, nothing would re-attempt the deal when Prompts get added. The
  // watcher therefore lives here, on the surface that IS mounted for exactly
  // the lifetime of the error: subscribe to the pool, and once the active
  // non-free pool crosses MIN_POOL with no retry in flight, re-invoke the deal
  // (App wires `onRetry` to AuthContext's retryDeal). Edge-triggered: the ref
  // resets while the pool is below the floor and latches once fired, so a
  // recovery retries once (not once per snapshot) and a failed auto-retry
  // doesn't loop — the manual Retry button stays as the fallback.
  const { items } = useItems();
  const activePool = items.filter((i) => !i.isFreeSpace).length;
  const retryFiredRef = useRef(false);
  useEffect(() => {
    if (activePool < MIN_POOL) {
      retryFiredRef.current = false;
      return;
    }
    if (!retrying && !retryFiredRef.current) {
      retryFiredRef.current = true;
      onRetry();
    }
  }, [activePool, retrying, onRetry]);

  return (
    <div className="signin" role="alert">
      <h1>GAY CRUISE BINGO</h1>
      <p className="muted">{message}</p>
      <button className="btn primary block" disabled={retrying} onClick={onRetry}>
        {retrying ? 'Dealing…' : 'Retry'}
      </button>
      <p className="muted" style={{ fontSize: 11 }}>
        Lost signal at sea? The printed cards and PDF still work.
      </p>
    </div>
  );
}
