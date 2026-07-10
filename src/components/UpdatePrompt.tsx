import { useEffect } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

/** How often a long-lived tab asks the browser to re-check `/sw.js` for a new
 *  deploy (`registration.update()`). 60s matches the poll cadence Nathan's other
 *  apps use for their version checks; `sw.js` is served `Cache-Control: no-cache`
 *  (firebase.json), so each check sees a new deploy immediately. */
const UPDATE_CHECK_INTERVAL_MS = 60_000;

/** Toggled on <body> while the banner is on screen — index.css keys extra `.app`
 *  bottom clearance off it, same mechanism as InstallPrompt's
 *  `install-prompt-visible` (see specs/w1-pwa.md). */
const VISIBLE_CLASS = 'update-prompt-visible';

/**
 * Update-reload banner (specs/app-update-reload-prompt.md, #178): with
 * `registerType: 'prompt'` (vite.config.ts) the new service worker installs and
 * waits instead of activating under the running page; `useRegisterSW` flips
 * `needRefresh` when that happens, and this banner offers Reload
 * (`updateServiceWorker(true)` — activate the waiting worker, then reload onto
 * the new build) or Not now (session-only dismiss; the waiting worker still
 * activates on the next full app launch, so nobody stays stale forever).
 * `onRegisteredSW` arms a periodic `registration.update()` check so a tab left
 * open for days — the norm at sea — discovers a new deploy without navigating.
 * Mounted at `main.tsx` alongside `ConsentNotice`/`InstallPrompt` (stable,
 * outside the auth-gated tree — see #17) so the prompt reaches players on every
 * screen, including signed-out SignIn.
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

  useEffect(() => {
    document.body.classList.toggle(VISIBLE_CLASS, needRefresh);
    return () => {
      document.body.classList.remove(VISIBLE_CLASS);
    };
  }, [needRefresh]);

  if (!needRefresh) return null;

  return (
    <div className="update-prompt" role="status">
      <p>A new version of Gay Cruise Bingo is ready.</p>
      <button className="btn primary" onClick={() => void updateServiceWorker(true)}>
        Reload
      </button>
      <button className="btn" onClick={() => setNeedRefresh(false)}>
        Not now
      </button>
    </div>
  );
}
