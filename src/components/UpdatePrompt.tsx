import { useEffect } from 'react';
import type { CSSProperties } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useClaimSheetOpen, useToastSlot } from '../hooks/useToastStack';

/** How often a long-lived tab asks the browser to re-check `/sw.js` for a new
 *  deploy (`registration.update()`). 60s matches the poll cadence Nathan's other
 *  apps use for their version checks; `sw.js` is served `Cache-Control: no-cache`
 *  (firebase.json), so each check sees a new deploy immediately. */
const UPDATE_CHECK_INTERVAL_MS = 60_000;

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

  const wantsToShow = needRefresh && !claimSheetOpen;
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
      <p>A fresh build just docked&mdash;your marks are safe.</p>
      <button className="btn primary" onClick={() => void updateServiceWorker(true)}>
        Reload
      </button>
      <button className="btn" onClick={() => setNeedRefresh(false)}>
        Not now
      </button>
    </div>
  );
}
