import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';

/**
 * Acceptable Use / Community Guidelines — the 18+ posture, community
 * expectations, and how to report a Prompt or Proof, shown in an in-app modal.
 * Behind auth BY DESIGN (ADR 0005 — no public unauthenticated pages): it
 * self-gates on the signed-in User and renders NOTHING signed out, and is
 * mounted from the app chrome in `main.tsx`, not the frozen tab route table.
 */
export default function AcceptableUse() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  // ADR 0005: no public unauthenticated surface — nothing renders signed out.
  if (!user) return null;

  return (
    <>
      <button
        type="button"
        className="btn"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        style={{
          position: 'fixed',
          right: 12,
          bottom: 'calc(64px + env(safe-area-inset-bottom))',
          zIndex: 30,
          fontSize: 12,
          padding: '6px 10px',
          opacity: 0.85,
        }}
      >
        18+ · Guidelines
      </button>

      {open && (
        <div className="sheet-backdrop" onClick={() => setOpen(false)}>
          <div
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Community guidelines"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sheet-title">Community guidelines</div>

            <p>
              <b>This is an 18+ space</b> for one sailing&rsquo;s friend group. By playing you confirm
              you are 18 or over. It stays behind sign-in — there are no public pages.
            </p>
            <p className="muted">Keep it fun and keep it kind:</p>
            <ul>
              <li>Mark honestly — the Feed is the group&rsquo;s shared memory, not a leaderboard to game.</li>
              <li>Proofs and callouts are playful. No harassment, no outing anyone, nothing non-consensual.</li>
              <li>No illegal content and nothing you would not want the whole boat to see.</li>
            </ul>
            <p>
              <b>How to report a Prompt or Proof:</b> tap <b>Report</b> on any Prompt in the pool or any
              Proof in the Feed to flag it. Enough reports hide it pending an Admin&rsquo;s review, and
              Admins can remove anything outright.
            </p>

            <div className="sheet-actions">
              <button className="btn primary" onClick={() => setOpen(false)}>
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
