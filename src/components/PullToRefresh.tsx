import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { LifeBuoy } from 'lucide-react';
import { pullProgress, PTR_THRESHOLD_PX, PTR_SLOP_PX } from '../game/motion';

/**
 * The gesture's actual refresh (Codex P2 on #432): a bare
 * `window.location.reload()` under `registerType: 'prompt'` reloads back
 * into the OLD precached build when a fresh deploy's service worker sits
 * WAITING — the exact opposite of what a refresh gesture promises. So when
 * a waiting worker exists, tell it to skip waiting (the generateSW bundle
 * ships workbox's SKIP_WAITING message handler — the same activation
 * `updateServiceWorker(true)` performs for the update toast) and reload on
 * `controllerchange`, with a bounded fallback so a worker that never
 * activates can't strand the gesture mid-spin. No waiting worker (or no SW
 * at all — dev, unsupported) is a plain reload. `reload` is injectable for
 * tests; jsdom's `location.reload` is not stubbable.
 */
export async function refreshApp(reload: () => void = () => window.location.reload()): Promise<void> {
  try {
    const sw = navigator.serviceWorker;
    const waiting = (await sw?.getRegistration())?.waiting;
    if (sw && waiting) {
      let fired = false;
      const go = () => {
        if (!fired) {
          fired = true;
          reload();
        }
      };
      sw.addEventListener('controllerchange', go, { once: true });
      waiting.postMessage({ type: 'SKIP_WAITING' });
      window.setTimeout(go, 1500);
      return;
    }
  } catch {
    /* service worker unavailable or the registration read failed — the
       plain reload below is still the right refresh */
  }
  reload();
}

/**
 * Pull-to-refresh (specs/pull-to-refresh.md): the PWA-native refresh gesture,
 * mounted once at the app shell so every tab has it. This app is fully
 * realtime — every surface is a live listener — so the gesture's job is the
 * installed-app one: a clean reload that reconnects listeners wedged by ship
 * WiFi and picks up a freshly deployed version (activating a WAITING service
 * worker first — see refreshApp above).
 *
 * Gesture discipline (the part that keeps it from hijacking the app):
 *  - arms ONLY when the page is scrolled to the very top at touchstart;
 *  - a direction gate (PTR_SLOP_PX dead zone, then downward-dominant) hands
 *    horizontal swipes to the Day/theme carousels and upward swipes to
 *    normal scrolling untouched;
 *  - never arms from inside an overlay (`.sheet-backdrop`, `.celebrate`,
 *    `.bug-report-pick`) — sheets own their own scroll;
 *  - the non-passive `touchmove` listener exists ONLY between an arming
 *    touchstart and that touch's end/cancel/disarm (Codex P2 on #432): a
 *    permanent `{ passive: false }` window listener would force every
 *    scroll's touchmove through the main thread for the app's whole life.
 *    While attached it preventDefaults only once the pull has engaged;
 *  - `touchcancel` ABORTS — snap back, never refresh (Codex P2 on #432):
 *    the system stealing the touch is not a release, however far the pull
 *    had traveled.
 *
 * The indicator is a theme-tokened life ring that follows the finger with
 * resistance (`pullProgress`, game/motion.ts), rotating with progress like a
 * dial being wound; past the threshold it pops (`--ease-pop`) and on release
 * it spins while the reload lands. Under prefers-reduced-motion the kill
 * switch (index.css) collapses the pop/spin; the ring still tracks the
 * finger (an inline transform, not an animation) so the gesture stays fully
 * functional. `onRefresh` is injectable for tests; the default activates a
 * waiting SW then reloads.
 */
export default function PullToRefresh({ onRefresh }: { onRefresh?: () => void }) {
  const [pull, setPull] = useState(0);
  const [phase, setPhase] = useState<'idle' | 'pulling' | 'refreshing'>('idle');
  // Gesture state lives in refs: touch handlers are registered once per
  // mount and must read the CURRENT gesture without re-subscribing.
  const start = useRef<{ x: number; y: number } | null>(null);
  const engaged = useRef(false);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(() => {
    const atTop = () => window.scrollY <= 0;
    let moveAttached = false;

    const detachMove = () => {
      if (moveAttached) {
        window.removeEventListener('touchmove', onTouchMove);
        moveAttached = false;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      const s = start.current;
      if (!s || phaseRef.current === 'refreshing') return;
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      if (!engaged.current) {
        // Direction gate: wait out the slop, then commit only to a
        // downward-dominant drag that STARTED at the top. Anything else is
        // someone scrolling or swiping a carousel — disarm AND drop the
        // non-passive listener immediately so the rest of their gesture
        // scrolls on the fast path.
        if (Math.abs(dx) < PTR_SLOP_PX && Math.abs(dy) < PTR_SLOP_PX) return;
        if (dy <= PTR_SLOP_PX || Math.abs(dx) >= dy || !atTop()) {
          start.current = null;
          detachMove();
          return;
        }
        engaged.current = true;
        setPhase('pulling');
      }
      // Engaged: the pull owns this touch — stop the page from scrolling
      // (and the browser's native pull gesture) underneath the drag.
      e.preventDefault();
      setPull(pullProgress(dy));
    };

    // Shared teardown for both release paths. `commit` distinguishes a real
    // RELEASE (may refresh) from a CANCELLATION (never refreshes).
    const finishTouch = (commit: boolean) => {
      const wasEngaged = engaged.current;
      start.current = null;
      engaged.current = false;
      detachMove();
      if (!wasEngaged || phaseRef.current === 'refreshing') return;
      if (!commit) {
        // The system stole the touch (browser chrome, notification shade,
        // an alert): abort — snap back, write nothing, reload nothing.
        setPhase('idle');
        setPull(0);
        return;
      }
      setPull((finalPull) => {
        if (finalPull >= PTR_THRESHOLD_PX) {
          setPhase('refreshing');
          // Hold at the threshold while the ring spins; give the spin two
          // beats to be SEEN before the reload tears the page down.
          window.setTimeout(() => (onRefresh ?? (() => void refreshApp()))(), 450);
          return PTR_THRESHOLD_PX;
        }
        setPhase('idle');
        return 0;
      });
    };

    const onTouchStart = (e: TouchEvent) => {
      if (phaseRef.current === 'refreshing') return;
      if (e.touches.length !== 1 || !atTop()) return;
      const target = e.target as Element | null;
      // Overlays own their gestures — a pull inside a sheet must never
      // reload the app out from under it.
      if (target?.closest?.('.sheet-backdrop, .celebrate, .bug-report-pick')) return;
      start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      engaged.current = false;
      if (!moveAttached) {
        // Non-passive on purpose, and scoped to THIS armed touch only: the
        // preventDefault in onTouchMove is what suppresses native
        // scroll/overscroll while a pull is engaged.
        window.addEventListener('touchmove', onTouchMove, { passive: false });
        moveAttached = true;
      }
    };

    const onTouchEnd = () => finishTouch(true);
    const onTouchCancel = () => finishTouch(false);

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    window.addEventListener('touchcancel', onTouchCancel, { passive: true });
    return () => {
      detachMove();
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchCancel);
    };
  }, [onRefresh]);

  const progress = Math.min(1, pull / PTR_THRESHOLD_PX);
  const cls =
    'ptr' +
    (phase === 'pulling' ? ' ptr-pulling' : '') +
    (phase === 'refreshing' ? ' ptr-refreshing' : '') +
    (phase === 'pulling' && pull >= PTR_THRESHOLD_PX ? ' ptr-ready' : '');
  return (
    <div
      className={cls}
      style={{ '--ptr-pull': `${pull}px`, '--ptr-progress': progress } as CSSProperties}
    >
      <div className="ptr-ring" aria-hidden="true">
        <LifeBuoy className="ptr-icon" />
      </div>
      <span className="visually-hidden" role="status">
        {phase === 'refreshing' ? 'Refreshing' : ''}
      </span>
    </div>
  );
}
