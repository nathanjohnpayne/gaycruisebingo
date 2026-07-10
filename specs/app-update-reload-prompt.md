---
spec_id: app-update-reload-prompt
status: accepted
---

# Update-reload prompt: tell players a new deploy is ready and let them reload onto it (`src/components/UpdatePrompt.tsx`)

Before this ticket (#178), `vite-plugin-pwa` ran with `registerType: 'autoUpdate'`: a new deploy's service worker activated silently under the running page, so a tab or installed PWA left open — the norm on a cruise, where a session lasts days — kept executing the old bundle indefinitely, never told that fixes or features had shipped, and could hit failed dynamic imports once its old hashed chunks left the precache. This ticket switches to `registerType: 'prompt'` (`vite.config.ts`): the new service worker installs and **waits**, and a new `UpdatePrompt` component surfaces that state as a themed bottom banner offering **Reload** (activate the waiting worker, reload onto the new build) or **Not now** (session-only dismiss — the waiting worker still activates on the next full app launch, so nobody stays stale forever). This is the same player-facing feature Nathan's other apps (friendsandfamily-billing's `UpdateToast`, overridebroadway's `UpdateChecker`) implement by polling a version file; here it rides the service-worker update lifecycle the app already ships, with a periodic `registration.update()` check standing in for the poll. Exercised by `src/components/app-update-reload-prompt.test.tsx` (RTL-jsdom).

## `needRefresh` drives the banner; Reload activates the waiting worker; Not now dismisses for the session

`useRegisterSW` (`virtual:pwa-register/react`) exposes `needRefresh`, which flips true when a new service worker has installed and is waiting.

- **Given** no update is pending **when** `UpdatePrompt` mounts **then** it renders nothing. (Test: "renders nothing (and never sets the body class) while no update is pending".)
- **Given** a new version is waiting (`needRefresh` true) **when** the banner shows **then** it announces the update ("A new version of Gay Cruise Bingo is ready.") and tapping **Reload** calls `updateServiceWorker(true)` — the plugin's activate-then-reload path (it messages the waiting worker to `skipWaiting` and reloads once it takes control). (Test: "shows the banner when a new version is waiting, and Reload activates it with a page reload".)
- **Given** the banner is up **when** the player taps **Not now** **then** the banner hides for the session and the waiting worker is left untouched — it activates on the next full app launch, so a dismissal only defers, never strands. (Test: ""Not now" dismisses the banner for the session without touching the waiting worker".)

## A long-lived tab discovers new deploys: periodic `registration.update()`, offline-tolerant

The browser only re-checks `sw.js` on its own schedule (navigations, and at most daily); a tab that stays open at sea would otherwise not learn about a deploy for a very long time. `onRegisteredSW` arms a 60-second `setInterval` calling `registration.update()` — the cadence the other apps' version polls use. `firebase.json` already serves `/sw.js` with `Cache-Control: no-cache` (see `specs/w4-hosting-index-shell-cache.md`), so each check observes a new deploy immediately.

- **Given** the service worker registered **when** the interval elapses **then** `registration.update()` is called once per tick. (Test: "arms a periodic registration.update() check so a long-lived tab discovers a new deploy".)
- **Given** the device is offline (`navigator.onLine === false`, common mid-cruise) **when** a tick fires **then** the check is skipped — no wasted round trip; the next tick retries. (Test: "skips the update check while offline (navigator.onLine === false)".)
- **Given** a check fails transiently (rejected `update()`) **when** the rejection lands **then** it is swallowed — no unhandled rejection; the next tick retries. (Test: "tolerates a registration.update() rejection (transient network failure) without unhandled errors".)
- **Given** an environment with no usable registration (no SW support) **when** `onRegisteredSW` fires with `undefined` **then** no interval is armed. (Test: "does nothing when registration is unavailable (no SW support)".)

The interval is deliberately not torn down: `UpdatePrompt` mounts once at `main.tsx` and lives for the page's lifetime, matching `useRegisterSW`'s own register-once model. On the transition deploy itself, pages still running the previous `autoUpdate`-built client have no prompt listener; they pick up the new worker on their next full app launch as before — one release where open tabs aren't prompted, self-resolving.

## Theming, placement, and coexistence with the other bottom bars

The banner must look native to the app in whichever theme the player selected. `.update-prompt` (`src/index.css`) shares the `.install-prompt` bottom-banner shell via comma-joined selectors — same theme tokens (`--bg` panel wash, `--border` top rule, `--dim` copy, `.btn primary`'s `--primary` fill), same `env(safe-area-inset-bottom)` clearance, same `body:has(.tabs)` rule stacking it above the signed-in tab bar — so reskinning via `[data-theme]` covers it with zero per-theme work, and the CSS-only claims are verified by code review for the same jsdom-has-no-layout-engine reason as `specs/w1-pwa.md`. In the rare case both banners are up at once, the pending update takes precedence: `body.update-prompt-visible .install-prompt { display: none; }` fully suppresses the install banner — out of the tab order and accessibility tree, not merely painted over, so keyboard/screen-reader users never land on invisible Install controls (Codex P2, round 2 on #179) — rather than stacking a third fixed bar. A reload re-fires `beforeinstallprompt`, so the install offer isn't lost.

Registration side effect worth naming: importing `virtual:pwa-register/react` flips `vite-plugin-pwa`'s `injectRegister: 'auto'` to app-owned registration — the build stops emitting/injecting `registerSW.js`, and `useRegisterSW` performs the `/sw.js` registration itself when `UpdatePrompt` mounts. `specs/w1-pwa.md` § SW registration and the hosting-cache test (`src/data/w4-bug-report-client.test.ts`, now asserting `sw.js` stays `no-cache`) were updated accordingly, and `firebase.json` dropped the obsolete `registerSW.js` glob entry.

`UpdatePrompt` mounts at `src/main.tsx` alongside `ConsentNotice` / `InstallPrompt` (the stable, non-frozen mount point outside the auth-gated tree, #17), so a deploy can prompt a reload on every screen including signed-out SignIn. Like `InstallPrompt`, it toggles an `update-prompt-visible` class on `<body>` while the banner is up; `body.update-prompt-visible` joins every `body.install-prompt-visible` clearance rule in `src/index.css` — `.app`'s ~64px of extra bottom padding, and the `bottom: calc(140px + env(safe-area-inset-bottom))` lift for the fixed `.bug-report-trigger` / `.guidelines-trigger` controls, which would otherwise sit under the banner at their usual 76px mark (Codex P2 on #179; the ~64px estimate and its caveats are documented in `specs/w1-pwa.md`).

- **Given** the banner is showing **when** it appears/dismisses/unmounts **then** `update-prompt-visible` is added to and removed from `<body>` in lockstep. (Test: "toggles update-prompt-visible on <body> while the banner is up, and clears it on dismiss".)
