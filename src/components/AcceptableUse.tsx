import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext';

/** Elements the Tab-trap below will cycle between while the dialog is open. */
const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

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
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLDivElement | null>(null);
  const close = () => setOpen(false);

  // Modal focus management (keyboard/screen-reader users): move focus into the
  // dialog on open, trap Tab/Shift+Tab within it while open, close on Escape,
  // and restore focus to the trigger on close (any of the three paths below).
  // Without this, the background stays fully tabbable behind the
  // visually-covering backdrop.
  useEffect(() => {
    if (!open) return;
    titleRef.current?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (e.key !== 'Tab') return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      // The title also holds focus (tabIndex=-1, the initial landing spot) but
      // is deliberately excluded from FOCUSABLE_SELECTOR — treat it as
      // preceding `first` so Shift+Tab from it still wraps to the end.
      if (e.shiftKey && (document.activeElement === first || document.activeElement === titleRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      triggerRef.current?.focus();
    };
  }, [open]);

  // ADR 0005: no public unauthenticated surface — nothing renders signed out.
  if (!user) return null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="btn guidelines-trigger"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        18+ · Guidelines
      </button>

      {open && (
        <div className="sheet-backdrop" onClick={close}>
          <div
            ref={dialogRef}
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Community guidelines"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sheet-title" ref={titleRef} tabIndex={-1}>
              Community guidelines
            </div>

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
              Proof in the Feed to flag it for an Admin&rsquo;s review — reporting doesn&rsquo;t hide
              anything automatically, but Admins can hide or remove anything reported or otherwise out
              of line.
            </p>

            <div className="sheet-actions">
              <button className="btn primary" onClick={close}>
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
