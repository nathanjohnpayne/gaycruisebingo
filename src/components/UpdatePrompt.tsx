import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useClaimSheetOpen, useToastSlot } from '../hooks/useToastStack';
import { buildBelowFloor, fetchBuildFloor } from '../buildFloor';

/** How often a long-lived tab asks the browser to re-check `/sw.js` for a new
 *  deploy (`registration.update()`). 60s matches the poll cadence Nathan's other
 *  apps use for their version checks; `sw.js` is served `Cache-Control: no-cache`
 *  (firebase.json), so each check sees a new deploy immediately. */
const UPDATE_CHECK_INTERVAL_MS = 60_000;

/** How often a long-lived tab re-reads `/build-floor.json` (#342) so a floor
 *  bumped after mount still reaches already-open cruise tabs. */
export const FLOOR_RECHECK_INTERVAL_MS = 10 * 60_000;

/** Toggled on <body> while the banner is on screen — index.css keys extra `.app`
 *  bottom clearance off it, same mechanism as InstallPrompt's
 *  `install-prompt-visible` (see specs/w1-pwa.md). */
const VISIBLE_CLASS = 'update-prompt-visible';
/** Toast-stack id (#219, "urgent" priority) — see useToastStack.ts. */
const TOAST_ID = 'update';

/**
 * Update-reload banner (specs/app-update-reload-prompt.md, #178): with
 * `registerType: 'prompt'` (vite.config.ts) the new service worker installs and
 * waits instead of activating under the running page; `useRegisterSW` flips
 * `needRefresh` when that happens, and this banner offers Reload
 * (`updateServiceWorker(true)`) or Not now (session-only dismiss). Mounted at
 * `main.tsx` alongside `ConsentNotice`/`InstallPrompt` (#17).
 *
 * #219 (specs/d15-pwa-toasts.md): also checks `useClaimSheetOpen()` (reported
 * by Board.tsx via `setClaimSheetOpen`) so a proof capture in progress is
 * never interrupted by a reload offer; `needRefresh` itself is untouched, so
 * closing the sheet shows the banner immediately. Final visibility is then
 * arbitrated by `useToastSlot` alongside the install nudge ("urgent" always
 * outranks its "invitational" rating).
 */
export default function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      setInterval(() => {
        // Offline (common mid-cruise) — skip the round trip; the next tick retries.
        if (navigator.onLine === false) return;
        registration.update().catch(() => {
          /* transient network failure — the next tick retries */
        });
      }, UPDATE_CHECK_INTERVAL_MS);
    },
  });
  const claimSheetOpen = useClaimSheetOpen();

  // Remote force-reload floor (#342): when the RUNNING build is older than the
  // served public/build-floor.json, skip the offer and activate+reload as soon
  // as a newer SW is waiting. Gated on a waiting SW actually existing — so a
  // misconfigured floor (newer than every build) can never reload-loop a
  // current client: its update check finds no new SW, nothing fires. Floor
  // fetch failures resolve null → `buildBelowFloor` is false → normal prompt.
  const [floorStale, setFloorStale] = useState(false);
  // Holds the banner until the FIRST floor read settles (Codex P2 on #342): a
  // stale client that showed the dismissible banner while /build-floor.json was
  // still in flight could be "Not now"-ed before the force decision arrived.
  // Bounded by fetchBuildFloor's own timeout, and a failed read still settles
  // (null floor), so the offer is delayed by at most a few seconds.
  const [floorChecked, setFloorChecked] = useState(false);
  // Latches "a newer SW is waiting": vite-pwa's "Not now" clears `needRefresh`,
  // but the waiting worker stays installed — the force must still fire when a
  // floor bump arrives later (Codex P2 on #342), so it keys off this latch,
  // never the dismissible state.
  const sawWaitingSW = useRef(false);
  if (needRefresh) sawWaitingSW.current = true;
  useEffect(() => {
    let cancelled = false;
    const check = () => {
      void fetchBuildFloor().then((floor) => {
        if (cancelled) return;
        setFloorChecked(true);
        if (buildBelowFloor(__BUILD_STAMP__, floor)) setFloorStale(true);
      });
    };
    check();
    // Re-read on a slow cadence (Codex P2 on #342): a cruise tab left open for
    // days must still observe a floor bumped AFTER it mounted. Ten minutes is
    // responsive enough for an emergency lever and negligible traffic (a tiny
    // static file, no-store).
    const timer = setInterval(check, FLOOR_RECHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (floorStale && sawWaitingSW.current) void updateServiceWorker(true);
    // `needRefresh` is a dep so a waiting SW that appears AFTER the floor was
    // already known stale still triggers the force on its flip to true.
  }, [floorStale, needRefresh, updateServiceWorker]);

  const wantsToShow = needRefresh && !claimSheetOpen && !floorStale && floorChecked;
  const { visible, stackIndex, visibleCount } = useToastSlot(TOAST_ID, 'urgent', wantsToShow);

  useEffect(() => {
    document.body.classList.toggle(VISIBLE_CLASS, visible);
    return () => {
      document.body.classList.remove(VISIBLE_CLASS);
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      className="update-prompt"
      role="status"
      style={{ '--toast-index': stackIndex, '--toast-count': visibleCount } as CSSProperties}
    >
      {/* The wireframes' toast lead-in (#308) — emoji, per the spec's
          iconography rule ("toast lead-ins stay emoji"). */}
      <span className="toast-icon" aria-hidden="true">
        🚢
      </span>
      {/* Wrapped so the shared row-flex toast shell stacks the two lines
          vertically instead of splitting them into columns (Codex P2 on
          #281) — same body-wrapper pattern as the install toast. */}
      <div className="install-prompt-body">
        <p className="toast-title">A fresh build just docked</p>
        <p>Your marks are safe&mdash;reload takes two seconds</p>
      </div>
      <button className="btn primary" onClick={() => void updateServiceWorker(true)}>
        Reload
      </button>
      <button className="btn" onClick={() => setNeedRefresh(false)}>
        Not now
      </button>
    </div>
  );
}
