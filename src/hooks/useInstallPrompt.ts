import { useCallback, useSyncExternalStore } from 'react';
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

interface InstallState {
  deferred: BeforeInstallPromptEvent | null;
  standalone: boolean;
}

/**
 * Module-level singleton store (w1-pwa, #30; shared across mount points,
 * #208/Codex P2 on #232) backing `useInstallPrompt`. `beforeinstallprompt` is
 * a one-shot browser event — whichever `window` listener is registered FIRST
 * captures it, so two independent per-hook-instance listeners (the original
 * design) meant a mount point that wasn't on screen yet when the event fired
 * (e.g. More's row, reached via a route the Player wasn't on) never saw it.
 * A single shared store, subscribed to via `useSyncExternalStore`, ensures
 * every mount point observes the SAME captured prompt and the SAME
 * `trackedInstall` dedupe guard, so `install_pwa` still fires exactly once
 * per real install regardless of which mount point's button (if any) was
 * tapped, or how many mount points are on screen at once.
 */
let state: InstallState = { deferred: null, standalone: false };
let trackedInstall = false;
let listenersAttached = false;
const subscribers = new Set<() => void>();

function setState(patch: Partial<InstallState>): void {
  state = { ...state, ...patch };
  for (const notify of subscribers) notify();
}

function attachListenersOnce(): void {
  if (listenersAttached) return;
  listenersAttached = true;
  state = { ...state, standalone: isStandalone() };
  if (state.standalone) return; // already installed — nothing to capture or offer
  const onBeforeInstallPrompt = (e: Event) => {
    e.preventDefault(); // suppress the browser's own mini-infobar; we render our own affordance
    setState({ deferred: e as BeforeInstallPromptEvent });
  };
  const onAppInstalled = () => {
    if (!trackedInstall) {
      trackedInstall = true;
      track('install_pwa');
    }
    setState({ standalone: true, deferred: null });
  };
  window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
  window.addEventListener('appinstalled', onAppInstalled);
}

function subscribe(onStoreChange: () => void): () => void {
  attachListenersOnce();
  subscribers.add(onStoreChange);
  return () => subscribers.delete(onStoreChange);
}

function getSnapshot(): InstallState {
  return state;
}

/** Test-only: resets the module singleton between tests (jsdom never reruns
 *  module-init between `it`s in the same file, unlike the old per-instance
 *  `useState`/`useRef`, so tests must reset this explicitly). Not exported
 *  from the app's own code paths — only test files import it. */
export function __resetInstallPromptStateForTests(): void {
  state = { deferred: null, standalone: false };
  trackedInstall = false;
  listenersAttached = false;
  subscribers.clear();
}

/**
 * Shared installability state (w1-pwa, #30), extracted out of `InstallPrompt`
 * so More's persistent "Install the app" row (#208, daily-cards-spec §
 * "More menu" § Play) can reflect the SAME installability without duplicating
 * the capture/tracking logic. Every mount point (the `InstallPrompt` banner
 * AND More's row) reads from and dispatches into ONE shared store (see the
 * module doc above), so a `beforeinstallprompt` captured while the Player is
 * on any route still surfaces on every mount point, and `install_pwa` fires
 * exactly once per real install no matter which button (if any) was tapped.
 */
export function useInstallPrompt() {
  const { deferred, standalone } = useSyncExternalStore(subscribe, getSnapshot);

  const showIOSHint = !deferred && isIOS();
  // Anything worth showing an install affordance for: a captured Chromium
  // prompt, or the iOS manual hint — false once standalone either way.
  const installable = !standalone && (!!deferred || showIOSHint);

  const install = useCallback(async () => {
    const current = state.deferred;
    if (!current) return;
    try {
      await current.prompt();
      const choice = await current.userChoice;
      if (choice.outcome === 'accepted' && !trackedInstall) {
        trackedInstall = true;
        track('install_pwa');
      }
    } catch {
      /* prompt() can reject if the browser revoked eligibility mid-flow — no-op */
    } finally {
      setState({ deferred: null });
    }
  }, []);

  return { standalone, deferred, showIOSHint, installable, install };
}
