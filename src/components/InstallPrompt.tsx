import { useEffect, useRef, useState } from 'react';
import { track } from '../analytics';

const DISMISS_KEY = 'gcb.install.dismissedAt';
/** Toggled on <body> while the banner (either variant) is on screen — index.css
 *  keys extra `.app` bottom clearance off it, see specs/w1-pwa.md. */
const VISIBLE_CLASS = 'install-prompt-visible';

/** Non-standard event (Chromium/Android only) — not in TS's lib.dom.d.ts. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

function isDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) !== null;
  } catch {
    return false; // storage unavailable (private mode, etc.) — show the banner
  }
}

/** Already installed, on Chromium (`display-mode` media query) or iOS (`navigator.standalone`). */
function isStandalone(): boolean {
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  const displayModeStandalone =
    typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches;
  return iosStandalone || displayModeStandalone;
}

/** iOS never fires beforeinstallprompt. Covers iPadOS 13+, which reports as a touch-capable Mac. */
function isIOS(): boolean {
  const nav = window.navigator;
  return /iphone|ipad|ipod/i.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
}

/**
 * Install-prompt banner (w1-pwa, #30): captures `beforeinstallprompt` and offers an
 * in-app Install button (Chromium/Android), or a manual "Add to Home Screen" hint on
 * iOS. Fires `install_pwa` (analytics.ts, #38) once `userChoice` resolves `accepted`,
 * or once `appinstalled` fires for an install that never went through this button
 * (e.g. the browser's own address-bar/app-menu install UI) — a ref-backed guard keeps
 * the two paths from double-counting the same install. Mounted at `main.tsx` alongside
 * `ConsentNotice` (#17). Toggles `VISIBLE_CLASS` on `<body>` while the banner (either
 * variant) is on screen, so `index.css` can reserve extra `.app` bottom clearance only
 * while it's actually up.
 */
export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [standalone, setStandalone] = useState(isStandalone);
  const [dismissed, setDismissed] = useState(isDismissed);
  // Guards `track('install_pwa')` against firing twice for one install: the
  // banner-accept path (in `install()` below) and `appinstalled` both fire for a
  // banner-driven install, and only `appinstalled` fires for a browser-UI install.
  const trackedInstallRef = useRef(false);

  useEffect(() => {
    if (standalone) return; // already installed — nothing to capture or offer
    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault(); // suppress the browser's own mini-infobar; we render our own affordance
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onAppInstalled = () => {
      if (!trackedInstallRef.current) {
        trackedInstallRef.current = true;
        track('install_pwa');
      }
      setStandalone(true);
      setDeferred(null);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, [standalone]);

  const showIOSHint = !deferred && isIOS();
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

  const install = async () => {
    if (!deferred) return;
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === 'accepted' && !trackedInstallRef.current) {
        trackedInstallRef.current = true;
        track('install_pwa');
      }
    } catch {
      /* prompt() can reject if the browser revoked eligibility mid-flow — no-op */
    } finally {
      setDeferred(null);
    }
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
