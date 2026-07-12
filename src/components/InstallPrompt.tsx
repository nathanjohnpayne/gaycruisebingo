import { useEffect, useState } from 'react';
import { useInstallPrompt } from '../hooks/useInstallPrompt';

const DISMISS_KEY = 'gcb.install.dismissedAt';
/** Toggled on <body> while the banner (either variant) is on screen — index.css
 *  keys extra `.app` bottom clearance off it, see specs/w1-pwa.md. */
const VISIBLE_CLASS = 'install-prompt-visible';

function isDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) !== null;
  } catch {
    return false; // storage unavailable (private mode, etc.) — show the banner
  }
}

/**
 * Install-prompt banner (w1-pwa, #30): captures `beforeinstallprompt` and offers an
 * in-app Install button (Chromium/Android), or a manual "Add to Home Screen" hint on
 * iOS. Fires `install_pwa` (analytics.ts, #38) once `userChoice` resolves `accepted`,
 * or once `appinstalled` fires for an install that never went through this button
 * (e.g. the browser's own address-bar/app-menu install UI). The capture/tracking
 * logic itself lives in `useInstallPrompt` (#208), shared with More's persistent
 * "Install the app" row. Mounted at `main.tsx` alongside `ConsentNotice` (#17).
 * Toggles `VISIBLE_CLASS` on `<body>` while the banner (either variant) is on
 * screen, so `index.css` can reserve extra `.app` bottom clearance only while
 * it's actually up.
 */
export default function InstallPrompt() {
  const { standalone, deferred, showIOSHint, install } = useInstallPrompt();
  const [dismissed, setDismissed] = useState(isDismissed);

  const visible = !standalone && !dismissed && (!!deferred || showIOSHint);

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
    <div className="install-prompt" role="note">
      {deferred ? (
        <>
          <p>Install Gay Cruise Bingo for one-tap, full-screen access at sea.</p>
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
