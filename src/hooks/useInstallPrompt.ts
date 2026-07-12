import { useEffect, useRef, useState } from 'react';
import { track } from '../analytics';

/** Non-standard event (Chromium/Android only) — not in TS's lib.dom.d.ts. */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

/** Already installed, on Chromium (`display-mode` media query) or iOS (`navigator.standalone`). */
export function isStandalone(): boolean {
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  const displayModeStandalone =
    typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches;
  return iosStandalone || displayModeStandalone;
}

/** iOS never fires beforeinstallprompt. Covers iPadOS 13+, which reports as a touch-capable Mac. */
export function isIOS(): boolean {
  const nav = window.navigator;
  return /iphone|ipad|ipod/i.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
}

/**
 * Shared installability state (w1-pwa, #30), extracted out of `InstallPrompt`
 * so More's persistent "Install the app" row (#208, daily-cards-spec §
 * "More menu" § Play) can reflect the SAME installability without duplicating
 * the capture/tracking logic. Each mount point (the `InstallPrompt` banner AND
 * More's row) gets its OWN instance of this hook — `beforeinstallprompt` /
 * `appinstalled` are ordinary `window` events any number of listeners can
 * subscribe to independently, so no shared state/coordination is needed
 * between the two; `install_pwa` still fires exactly once per real install
 * because each instance dedupes against its OWN `trackedInstallRef`, and only
 * whichever instance's button the Player actually taps calls `prompt()`.
 */
export function useInstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [standalone, setStandalone] = useState(isStandalone);
  // Guards `track('install_pwa')` against firing twice for one install: the
  // accept path (in `install()` below) and `appinstalled` both fire for an
  // install driven through THIS instance's button, and only `appinstalled`
  // fires for a browser-UI install or one driven through the OTHER instance.
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
  // Anything worth showing an install affordance for: a captured Chromium
  // prompt, or the iOS manual hint — false once standalone either way.
  const installable = !standalone && (!!deferred || showIOSHint);

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

  return { standalone, deferred, showIOSHint, installable, install };
}
