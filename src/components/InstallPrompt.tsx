import { useEffect, useState } from 'react';
import { track } from '../analytics';

const DISMISS_KEY = 'gcb.install.dismissedAt';

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
 * iOS. Fires `install_pwa` (analytics.ts, #38) only once `userChoice` resolves
 * `accepted`. Mounted at `main.tsx` alongside `ConsentNotice` (#17).
 */
export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [standalone, setStandalone] = useState(isStandalone);
  const [dismissed, setDismissed] = useState(isDismissed);

  useEffect(() => {
    if (standalone) return; // already installed — nothing to capture or offer
    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault(); // suppress the browser's own mini-infobar; we render our own affordance
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onAppInstalled = () => {
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

  if (standalone || dismissed) return null;

  const showIOSHint = !deferred && isIOS();
  if (!deferred && !showIOSHint) return null;

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
      if (choice.outcome === 'accepted') track('install_pwa');
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
