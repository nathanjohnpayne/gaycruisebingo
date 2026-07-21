import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { LifeBuoy } from 'lucide-react';
import { pullProgress, PTR_THRESHOLD_PX, PTR_SLOP_PX } from '../game/motion';

/**
 * Pull-to-refresh (specs/pull-to-refresh.md): the PWA-native refresh gesture,
 * mounted once at the app shell so every tab has it. This app is fully
 * realtime — every surface is a live listener — so the gesture's job is the
 * installed-app one: a clean reload that reconnects listeners wedged by ship
 * WiFi and picks up a freshly deployed version (the same thing the update
 * toast's Reload does, without waiting for the toast).
 *
 * Gesture discipline (the part that keeps it from hijacking the app):
 *  - arms ONLY when the page is scrolled to the very top at touchstart;
 *  - a direction gate (PTR_SLOP_PX dead zone, then downward-dominant) hands
 *    horizontal swipes to the Day/theme carousels and upward swipes to
 *    normal scrolling untouched;
 *  - never arms from inside an overlay (`.sheet-backdrop`, `.celebrate`,
 *    `.bug-report-pick`) — sheets own their own scroll;
 *  - `touchmove` is registered non-passive and calls preventDefault ONLY
 *    once the pull has engaged, so ordinary scrolling never loses its
 *    passive fast path.
 *
 * The indicator is a theme-tokened life ring that follows the finger with
 * resistance (`pullProgress`, game/motion.ts), rotating with progress like a
 * dial being wound; past the threshold it pops (`--ease-pop`) and on release
 * it spins while the reload lands. Under prefers-reduced-motion the kill
 * switch (index.css) collapses the pop/spin; the ring still tracks the
 * finger (an inline transform, not an animation) so the gesture stays fully
 * functional. `onRefresh` is injectable for tests; the default is a real
 * `window.location.reload()`.
 */
export default function PullToRefresh({ onRefresh }: { onRefresh?: () => void }) {
  const [pull, setPull] = useState(0);
  const [phase, setPhase] = useState<'idle' | 'pulling' | 'refreshing'>('idle');
  // Gesture state lives in refs: touch handlers are registered once and must
  // read the CURRENT gesture without re-subscribing per render.
  const start = useRef<{ x: number; y: number } | null>(null);
  const engaged = useRef(false);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(() => {
    const atTop = () => window.scrollY <= 0;

    const onTouchStart = (e: TouchEvent) => {
      if (phaseRef.current === 'refreshing') return;
      if (e.touches.length !== 1 || !atTop()) return;
      const target = e.target as Element | null;
      // Overlays own their gestures — a pull inside a sheet must never
      // reload the app out from under it.
      if (target?.closest?.('.sheet-backdrop, .celebrate, .bug-report-pick')) return;
      start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      engaged.current = false;
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
        // someone scrolling or swiping a carousel — disarm for this touch.
        if (Math.abs(dx) < PTR_SLOP_PX && Math.abs(dy) < PTR_SLOP_PX) return;
        if (dy <= PTR_SLOP_PX || Math.abs(dx) >= dy || !atTop()) {
          start.current = null;
          return;
        }
        engaged.current = true;
        setPhase('pulling');
      }
      // Engaged: the pull owns this touch — stop the page from scrolling
      // (and Chrome's native glow/refresh) underneath the drag.
      e.preventDefault();
      setPull(pullProgress(dy));
    };

    const onTouchEnd = () => {
      const wasEngaged = engaged.current;
      start.current = null;
      engaged.current = false;
      if (!wasEngaged || phaseRef.current === 'refreshing') return;
      setPull((finalPull) => {
        if (finalPull >= PTR_THRESHOLD_PX) {
          setPhase('refreshing');
          // Hold at the threshold while the ring spins; give the spin two
          // beats to be SEEN before the reload tears the page down.
          window.setTimeout(() => (onRefresh ?? (() => window.location.reload()))(), 450);
          return PTR_THRESHOLD_PX;
        }
        setPhase('idle');
        return 0;
      });
    };

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    // Non-passive on purpose: preventDefault above is what suppresses native
    // scroll/overscroll while a pull is engaged.
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    window.addEventListener('touchcancel', onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
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
