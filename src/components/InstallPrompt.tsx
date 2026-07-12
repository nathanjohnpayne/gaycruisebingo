import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { useInstallPrompt } from '../hooks/useInstallPrompt';
import { useHasMarkedSquare, useToastSlot } from '../hooks/useToastStack';

const DISMISS_KEY = 'gcb.install.dismissedAt';
/** Toggled on <body> while the banner (either variant) is on screen — index.css
 *  keys extra `.app` bottom clearance off it, see specs/w1-pwa.md. */
const VISIBLE_CLASS = 'install-prompt-visible';
/** Toast-stack id (#219, "invitational" priority) — see useToastStack.ts. */
const TOAST_ID = 'install';

function isDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) !== null;
  } catch {
    return false; // storage unavailable (private mode, etc.) — show the banner
  }
}

/**
 * Install-prompt toast (w1-pwa, #30; restyled + retimed by #219): captures
 * `beforeinstallprompt` and offers an in-app Install button (Chromium/Android),
 * or a manual "Add to Home Screen" hint on iOS. Fires `install_pwa` once
 * `userChoice` resolves `accepted`, or once `appinstalled` fires without this
 * button. Capture/tracking lives in `useInstallPrompt` (#208, frozen by #219).
 * Mounted at `main.tsx` alongside `ConsentNotice` (#17).
 *
 * #219 (specs/d15-pwa-toasts.md): the nudge no longer appears on app-load —
 * `useHasMarkedSquare()` gates it, flipping once the Player marks a first
 * Square. Final visibility is then arbitrated by `useToastSlot` alongside the
 * update banner ("urgent" outranks this toast's "invitational" rating).
 */
export default function InstallPrompt() {
  const { standalone, deferred, showIOSHint, install } = useInstallPrompt();
  const [dismissed, setDismissed] = useState(isDismissed);
  const hasMarkedSquare = useHasMarkedSquare();

  const wantsToShow = !standalone && !dismissed && hasMarkedSquare && (!!deferred || showIOSHint);
  const { visible, stackIndex } = useToastSlot(TOAST_ID, 'invitational', wantsToShow);

  useEffect(() => {
    document.body.classList.toggle(VISIBLE_CLASS, visible);
    return () => {
      document.body.classList.remove(VISIBLE_CLASS);
    };
  }, [visible]);

  if (!visible) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* ignore storage errors — still hides for this session */
    }
    setDismissed(true);
  };

  return (
    <div className="install-prompt" role="note" style={{ '--toast-index': stackIndex } as CSSProperties}>
      {deferred ? (
        <>
          <p>Full screen, works offline at sea.</p>
          <button className="btn primary" onClick={install}>
            Install
          </button>
          <button className="btn" onClick={dismiss}>
            Not now
          </button>
        </>
      ) : (
        <>
          <p>Add to Home Screen: tap Share, then &ldquo;Add to Home Screen,&rdquo; for one-tap access.</p>
          <button className="btn" onClick={dismiss}>
            Got it
          </button>
        </>
      )}
    </div>
  );
}
