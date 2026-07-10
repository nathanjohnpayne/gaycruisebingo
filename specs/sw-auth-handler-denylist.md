---
spec_id: sw-auth-handler-denylist
status: accepted
---

# Service worker must never intercept Firebase's reserved `/__/*` namespace (`vite.config.ts` workbox `navigateFallbackDenylist`)

Google sign-in was broken for any signed-out visitor whose page was service-worker-controlled (#182): `signInWithPopup` (`src/auth/AuthContext.tsx`) opens a popup at `https://gaycruisebingo.com/__/auth/handler?...` — Firebase Hosting's reserved OAuth helper — and that popup is a same-origin navigation, so Workbox's `navigateFallback: 'index.html'` route intercepted it and served the precached SPA shell instead of the handler. The popup rendered the app's own SignIn screen, the OAuth dance never started, and sign-in silently dead-ended. Reproduced against production in a fresh service-worker-controlled profile; `curl` of the same URL (no service worker) returned the real `fireauth.oauthhelper` page, proving the hosting/proxy posture was fine and the interception was purely client-side.

The fix is the canonical Firebase-on-Workbox exclusion: `navigateFallbackDenylist: [/^\/__\//]` in the `VitePWA` `workbox` block (`vite.config.ts`), which keeps the navigation-fallback route from ever matching Firebase's reserved `/__/*` paths (`/__/auth/handler`, `/__/auth/iframe`, …). Everything else about the fallback (offline shell for real app routes) is unchanged.

## Regression guard

- **Given** the Vite PWA configuration **when** the workbox block declares a `navigateFallback` **then** it must also declare a `navigateFallbackDenylist` containing the `/^\/__\//` pattern, so a future config edit cannot silently reintroduce the interception. (Test: `src/sw-auth-handler-denylist.test.ts` — reads `vite.config.ts` the same way `src/data/w4-bug-report-client.test.ts` reads `firebase.json`, because the generated `sw.js` only exists post-build and jsdom cannot execute a service worker.)
- Build-output verification (manual, per fix PR): the built `dist/sw.js` carries the denylist regex on its `NavigationRoute` — checked by grepping the emitted worker after `npm run build`.
- Live verification (manual, post-deploy): with the service worker active, the sign-in popup at `/__/auth/handler` renders Google's account chooser, not the SPA.

## Rollout note

The fix only takes effect once deployed and each installed service worker updates (next `registration.update()` — at most 60s in an open tab via `UpdatePrompt`'s periodic check, `specs/app-update-reload-prompt.md`, or the next full app launch). Until a stale worker updates, sign-in in that profile remains broken; no data migration or cache purge is needed beyond the normal worker swap.
