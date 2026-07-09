import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';

// One 18+ acknowledgement, two entry points (#23):
//   • signed OUT → the sign-in gate App renders on `!user`: the checkbox gates
//     Google sign-in, which PERSISTS the attestation after the popup
//     (AuthContext.signIn → attest).
//   • signed IN but un-attested → the re-prompt gate AuthProvider renders when a
//     SETTLED profile lacks `attestedAdultAt`: the checkbox records the persisted
//     self-attestation before the Board.
// Either way the checkbox now drives a PERSISTED write, not just ephemeral local
// state — an honor-system self-statement, never identity verification (ADR 0001).
export default function SignIn() {
  const { user, signIn, attest } = useAuth();
  const reprompt = user != null;
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setBusy(true);
    try {
      if (reprompt) await attest();
      else await signIn();
    } catch {
      setBusy(false);
    }
  };

  return (
    <div className="signin">
      <h1>GAY CRUISE BINGO</h1>
      <p className="muted">
        {reprompt
          ? 'One quick thing before you get your card: confirm you’re 18 or older.'
          : 'Trieste → Barcelona · July 2026. Sign in, get your card, mark it if you see it.'}
      </p>
      <label className="ack">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
        <span>
          I'm 18 or older and I know exactly what I'm getting into. Keep it legal, no minors, and
          don't post people who didn't consent.
        </span>
      </label>
      <button className="btn primary block" disabled={!ack || busy} onClick={go}>
        {busy
          ? reprompt
            ? 'Saving…'
            : 'Signing in…'
          : reprompt
            ? 'Enter the event'
            : 'Continue with Google'}
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
  // Recovery is deliberately MANUAL: the Retry button re-invokes the deal, and
  // the /items Prompts tab stays reachable (the shell keeps rendering) so a
  // Player or Admin can add Prompts, then come back and retry. An automatic
  // pool-recovery watcher was prototyped here during review and removed by
  // human decision (PR #66 tiebreak): three review rounds showed it needs a
  // deliberate design (misfires on non-pool deal failures because the pool
  // subscription starts empty; unmounts when the Player navigates to /items —
  // the exact recovery path; wants a context-level home). Tracked as a
  // follow-up rather than accreted onto this ticket.
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
