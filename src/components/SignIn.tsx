import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';

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
