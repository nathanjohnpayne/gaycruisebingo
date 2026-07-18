import { useEffect, useRef, type ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';

/** Elements the Tab-trap below will cycle between while the sheet is open —
 *  mirrors More.tsx's `FOCUSABLE_SELECTOR` (the same dialog conventions). */
const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** A downward pointer drag on the header longer than this dismisses the sheet. */
const SWIPE_DISMISS_PX = 80;

/**
 * The admin console's shared sheet chrome (specs/admin-console-ia.md § "Navigation
 * & dismissal contract"): every admin surface — hub and details — renders inside
 * this one component, which owns the STICKY header (`‹ Admin` back on details,
 * section title, Done on the right) and the full dismissal contract. Done closes
 * the entire admin from any depth; backdrop tap, Escape, and a swipe-down on the
 * header do the same. Content scrolls UNDER the header (`position: sticky` inside
 * the sheet's own scrollport), so Done is visible without scrolling on any
 * viewport height.
 *
 * Dialog semantics follow the app's `MorePanel`/who-list conventions: focus moves
 * to the title on open (and on each section change — the title is the new
 * surface's name), Tab/Shift+Tab are trapped inside the sheet, and focus is
 * restored to the opener on unmount (the who-list refinement).
 */
export default function AdminSheet({
  title,
  onBack,
  onDone,
  children,
}: {
  title: string;
  /** Present on detail surfaces only — renders the `‹ Admin` back affordance. */
  onBack?: () => void;
  /** Done: closes the entire admin console, from any depth. */
  onDone: () => void;
  children: ReactNode;
}) {
  const titleRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const dragStartY = useRef<number | null>(null);

  // Focus restore is strictly mount/unmount — a section change inside the admin
  // must NOT fire it (the cleanup below would yank focus back out to the More row
  // mid-navigation if this shared the per-title effect).
  useEffect(() => {
    previouslyFocused.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => previouslyFocused.current?.focus();
  }, []);

  // The title is each surface's landing spot: focus it on open AND on every
  // hub ↔ detail transition so AT users hear where they arrived.
  useEffect(() => {
    titleRef.current?.focus();
  }, [title]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onDone();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      // The title also holds focus (tabIndex=-1, the landing spot) but is
      // deliberately excluded from FOCUSABLE_SELECTOR — treat it as preceding
      // `first` so Shift+Tab from it still wraps to the end.
      if (e.shiftKey && (document.activeElement === first || document.activeElement === titleRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onDone]);

  return (
    <div className="sheet-backdrop" onClick={onDone}>
      <div
        ref={dialogRef}
        className="sheet more-panel admin-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="admin-sheet-head"
          // Swipe-down dismissal lives on the header (the grab area) so it never
          // fights the content's own scroll; `touch-action: none` in its CSS is
          // what lets a vertical drag reach these handlers on touch devices.
          onPointerDown={(e) => {
            // Never start a drag from the header's buttons: pointer CAPTURE
            // retargets the subsequent click to the header, silently eating
            // Done/back taps (caught by the e2e suite — the Done click landed
            // on the header and never fired the button).
            if ((e.target as HTMLElement).closest('button')) return;
            dragStartY.current = e.clientY;
            // Keep receiving the pointer even when the finger leaves the header.
            (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
          }}
          onPointerUp={(e) => {
            const start = dragStartY.current;
            dragStartY.current = null;
            if (start != null && e.clientY - start > SWIPE_DISMISS_PX) onDone();
          }}
          onPointerCancel={() => {
            dragStartY.current = null;
          }}
        >
          {onBack ? (
            <button type="button" className="admin-sheet-back" onClick={onBack}>
              <ChevronLeft aria-hidden="true" /> Admin
            </button>
          ) : (
            <span className="admin-sheet-spacer" aria-hidden="true" />
          )}
          <div className="sheet-title admin-sheet-title" ref={titleRef} tabIndex={-1}>
            {title}
          </div>
          <button type="button" className="btn admin-sheet-done" onClick={onDone}>
            Done
          </button>
        </div>
        <div className="admin-sheet-body">{children}</div>
      </div>
    </div>
  );
}
