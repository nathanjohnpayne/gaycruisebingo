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
 *    touchstart and that touch's END (Codex P2 on #432): a permanent
 *    `{ passive: false }` window listener would force every scroll's
 *    touchmove through the main thread for the app's whole life. A DISARM
 *    does not drop it (#451) — see detachMove below. While attached it
 *    preventDefaults only once the pull has engaged;
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
  // The live pull distance, mirrored from state (Codex P2 on #432 round 2):
  // finishTouch decides the threshold from THIS, never from inside a setPull
  // functional updater — updaters must stay pure (StrictMode replays them),
  // and a timer scheduled inside one could fire a refresh per replay.
  const pullRef = useRef(0);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  // The refresh callback, read through a ref (CodeRabbit on #452). The listener
  // effect below must NEVER re-run on a prop identity change: its cleanup calls
  // detachMove, so a parent rerendering with a fresh inline `onRefresh`
  // mid-gesture would tear the non-passive touchmove listener down exactly the
  // way the direction gate used to (#451) — the failure this whole PR exists to
  // remove. Reading through a ref makes the effect depend on nothing, so its
  // lifetime is the component's, not the callback's. App.tsx passes no prop
  // today, so this closes a hole rather than fixing a live bug, but "the
  // listener is never removed mid-gesture" should be structural rather than a
  // property of the current call site.
  //
  // Synced in a COMMIT-phase effect, not during render (CodeRabbit round 2 on
  // #452). `phaseRef` above mirrors this component's own state, which a
  // replayed render recomputes identically; `onRefresh` is a PARENT prop, and
  // under concurrent rendering a render that is interrupted or abandoned can
  // carry props that never commit. Writing the ref during render could
  // therefore leave a released gesture calling a callback the parent never
  // actually shipped. The gesture only ever reads it from a touch handler's
  // timer, long after commit, so an effect is early enough.
  const onRefreshRef = useRef(onRefresh);
  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    const atTop = () => window.scrollY <= 0;
    let moveAttached = false;

    // Dropped at the END of the armed touch, never mid-gesture (#451). On
    // WebKit the set of non-passive touch listeners defines the page's
    // non-fast-scrollable region, so attaching one on touchstart and removing
    // it again a few frames later — which is what disarming at the direction
    // gate did — mutates the scrolling tree while that scroll is still in
    // flight, and leaves viewport-anchored (`position: fixed`) layers stale:
    // the bottom tab bar froze partway up the page in the iOS home-screen PWA
    // (the same class of failure as #422's backdrop-filter promotion). A
    // disarm now only clears `start.current`, which makes onTouchMove a no-op
    // for the rest of the touch; the listener itself lives exactly as long as
    // the touch that armed it. That still satisfies the Codex P2 that motivated
    // this teardown — the concern was a PERMANENT window listener taxing every
    // scroll for the app's whole life, not one that outlives a direction gate
    // by the remainder of a single gesture.
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
        // someone scrolling or swiping a carousel — disarm, which makes every
        // remaining touchmove in this gesture an early return. The listener
        // stays attached until the touch ends (#451): tearing it down here
        // re-computed the scrolling tree mid-scroll and stranded the fixed tab
        // bar. Nothing is preventDefaulted after a disarm, so the scroll runs.
        if (Math.abs(dx) < PTR_SLOP_PX && Math.abs(dy) < PTR_SLOP_PX) return;
        if (dy <= PTR_SLOP_PX || Math.abs(dx) >= dy || !atTop()) {
          start.current = null;
          return;
        }
        engaged.current = true;
        setPhase('pulling');
      }
      // Engaged: the pull owns this touch — stop the page from scrolling
      // (and the browser's native pull gesture) underneath the drag.
      e.preventDefault();
      const p = pullProgress(dy);
      pullRef.current = p;
      setPull(p);
    };

    // Reset the GESTURE without touching the listener. Split out of
    // finishTouch (#452 self-review): the multi-touch abort below fires while
    // the first finger is still down, so detaching there would be exactly the
    // mid-gesture scrolling-tree mutation this component now avoids — the same
    // hole as the old direction-gate teardown, reached by a different path.
    // The listener's teardown boundary is the touch ENDING, and only that.
    // `commit` distinguishes a real RELEASE (may refresh) from a CANCELLATION
    // (never refreshes).
    const resetGesture = (commit: boolean) => {
      const wasEngaged = engaged.current;
      start.current = null;
      engaged.current = false;
      if (!wasEngaged || phaseRef.current === 'refreshing') return;
      // The threshold decision reads pullRef, and the timer is scheduled
      // HERE in the event handler — never inside a state updater (round 2:
      // updaters must be pure; a replay would double-schedule the reload).
      if (commit && pullRef.current >= PTR_THRESHOLD_PX) {
        pullRef.current = PTR_THRESHOLD_PX;
        setPhase('refreshing');
        setPull(PTR_THRESHOLD_PX);
        // Hold at the threshold while the ring spins; give the spin two
        // beats to be SEEN before the reload tears the page down.
        window.setTimeout(() => (onRefreshRef.current ?? (() => void refreshApp()))(), 450);
        return;
      }
      // Below threshold, or the system stole the touch (browser chrome,
      // notification shade, an alert): snap back, write nothing.
      pullRef.current = 0;
      setPhase('idle');
      setPull(0);
    };

    // The teardown boundary is the LAST finger leaving, not the first
    // `touchend` (Codex P2 on #452). After a multi-touch abort the second
    // finger can lift while the ORIGINAL armed finger is still down and still
    // scrolling; detaching on that touchend would remove the listener
    // mid-gesture — the same scrolling-tree mutation, one level deeper than the
    // abort fix. `TouchEvent.touches` on a touchend lists the fingers that
    // REMAIN, so zero is the honest "this gesture is over" signal. If a
    // terminal event is ever dropped the listener simply waits for the next
    // one (or unmount); `onTouchStart`'s `moveAttached` guard means a fresh arm
    // reuses it rather than stacking a second.
    const finishTouch = (commit: boolean, remainingTouches: number) => {
      resetGesture(commit);
      if (remainingTouches === 0) detachMove();
    };

    const onTouchStart = (e: TouchEvent) => {
      if (phaseRef.current === 'refreshing') return;
      if (e.touches.length !== 1) {
        // A second finger joining an armed pull CANCELS it (Codex P2 on
        // #432 round 2): multi-touch is pinch/zoom territory, and without
        // the abort, lifting EITHER finger later would emit a touchend that
        // committed the still-armed pull while the other finger is down.
        // `resetGesture`, not `finishTouch` — the first finger is still down,
        // so the listener must survive to its own touchend (#452).
        if (start.current) resetGesture(false);
        return;
      }
      if (!atTop()) return;
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

    const onTouchEnd = (e: TouchEvent) => finishTouch(true, e.touches.length);
    const onTouchCancel = (e: TouchEvent) => finishTouch(false, e.touches.length);

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    window.addEventListener('touchcancel', onTouchCancel, { passive: true });
    return () => {
      detachMove();
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchCancel);
    };
    // Deliberately empty: the effect owns window listeners whose teardown is
    // the bug (see onRefreshRef above). Everything it reads that can change —
    // phase, pull distance, the refresh callback — it reads through a ref.
  }, []);

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
