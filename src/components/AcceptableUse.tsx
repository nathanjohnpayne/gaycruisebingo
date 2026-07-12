import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext';

/** Elements the Tab-trap below will cycle between while the dialog is open. */
const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Acceptable Use / Community Guidelines — the 18+ posture, community
 * expectations, and how to report a Prompt or Proof, shown in an in-app modal.
 * Behind auth BY DESIGN (ADR 0005 — no public unauthenticated pages): it
 * self-gates on the signed-in User and renders NOTHING signed out, and is not
 * added to the frozen tab route table.
 *
 * `variant`: `'floating'` (default) is the original fixed bottom-left chip
 * (w3-security-hardening.md) — kept intact for that spec's own coverage.
 * `'row'` is a plain full-width menu row with the same trigger+sheet, used
 * ONLY by `More.tsx` (#208, daily-cards-spec § "More menu" § Support): the
 * live app mounts `variant="row"` exclusively now (from More, itself
 * reachable on every signed-in route as a frozen tab), so only one
 * Guidelines affordance is ever on screen at a time.
 */
export default function AcceptableUse({ variant = 'floating' }: { variant?: 'floating' | 'row' }) {
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
        className={variant === 'row' ? 'more-row' : 'btn guidelines-trigger'}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        {/* `.guidelines-icon` (not `.guidelines-trigger svg`) so sizing/fill survive
            `variant="row"`, where the button drops the `guidelines-trigger` class
            for `more-row` — see index.css § acceptable-use trigger. */}
        <svg className="guidelines-icon" viewBox="0 0 328.863 328.863" aria-hidden="true" focusable="false">
          <path d="M104.032 220.434V131.15H83.392v-22.88h49.121v112.164h-28.481z" />
          <path d="M239.552 137.23c0 9.76-5.28 18.4-14.08 23.201 12.319 5.119 20 15.84 20 28.32 0 20.16-17.921 32.961-45.921 32.961-28.001 0-45.921-12.641-45.921-32.48 0-12.801 8.32-23.682 21.28-28.801-9.44-5.281-15.52-14.24-15.52-24 0-17.922 15.681-29.281 40.001-29.281 24.64 0 40.161 11.68 40.161 30.08zm-59.042 49.122c0 9.441 6.721 14.721 19.041 14.721s19.2-5.119 19.2-14.721c0-9.279-6.88-14.561-19.2-14.561s-19.041 5.281-19.041 14.561zm2.881-47.522c0 8.002 5.76 12.48 16.16 12.48s16.16-4.479 16.16-12.48c0-8.318-5.76-12.959-16.16-12.959s-16.16 4.641-16.16 12.959z" />
          <path d="M292.864 120.932c4.735 13.975 7.137 28.592 7.137 43.5 0 74.752-60.816 135.568-135.569 135.568S28.862 239.184 28.862 164.432c0-74.754 60.816-135.568 135.569-135.568 14.91 0 29.527 2.4 43.5 7.137V5.832C193.817 1.963 179.24 0 164.432 0 73.765 0 .001 73.764.001 164.432s73.764 164.432 164.431 164.432 164.43-73.764 164.43-164.432c0-14.807-1.962-29.385-5.831-43.5h-30.167z" />
          <path d="M284.659 44.111V12.582h-22.672v31.529h-31.34v22.67h31.34v31.528h22.672V66.781h31.527v-22.67h-31.527z" />
        </svg>
        <span>Guidelines</span>
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
              you are 18 or over. It stays behind sign-in—there are no public pages.
            </p>
            <p className="muted">Keep it fun and keep it kind:</p>
            <ul>
              <li>Mark honestly—the Feed is the group&rsquo;s shared memory, not a leaderboard to game.</li>
              <li>Proofs and callouts are playful. No harassment, no outing anyone, nothing non-consensual.</li>
              <li>No illegal content and nothing you would not want the whole boat to see.</li>
            </ul>
            <p>
              <b>How to report a Prompt or Proof:</b> tap <b>Report</b> on any Prompt in the pool or any
              Proof in the Feed to flag it for an Admin&rsquo;s review—reporting doesn&rsquo;t hide
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
