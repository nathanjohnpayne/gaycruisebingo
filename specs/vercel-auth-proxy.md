---
spec_id: vercel-auth-proxy
status: accepted
---

# Vercel must serve Firebase Auth helpers from its own origin

The production Vercel mirror runs at `gaycruisebingo.vercel.app`. Its `VITE_FIREBASE_AUTH_DOMAIN` must be that same hostname so popup and redirect sign-in state remains first-party in storage-partitioned browsers. Pointing the SDK directly at `gaycruisebingo.firebaseapp.com` avoids the blocked custom domain but makes Firebase's auth iframe cross-origin, which can fail with "Unable to process request due to missing initial state" in Safari and in-app webviews.

`vercel.json` transparently reverse-proxies every request under `/__/auth/*` to the Firebase Hosting helper namespace at `https://gaycruisebingo.firebaseapp.com/__/auth/*`. This must remain a rewrite, not a redirect: the browser-visible origin must stay `gaycruisebingo.vercel.app` throughout the helper flow. The rule covers the handler, iframe, JavaScript helpers, and any future helper path Firebase adds beneath the namespace.

After the auth proxy, a catch-all rewrite serves `/index.html` for client-side routes such as `/feed` and `/leaderboard`. The auth proxy must remain first so Firebase helper requests are never handled by the SPA fallback.

The deployment configuration is completed outside the repository: `gaycruisebingo.vercel.app` must remain in Firebase Authentication's authorized domains, and `https://gaycruisebingo.vercel.app/__/auth/handler` must remain an authorized redirect URI on the Google OAuth web client.

Mobile browser tabs use `signInWithRedirect` when the configured auth handler is same-origin. In iOS Safari, Firebase's popup can become a separate browser tab; the returning handler can then lose the `oauthHelperState` that the outbound helper stored in that tab's `sessionStorage`, producing "Unable to process request due to missing initial state." A top-level redirect keeps the helper round trip in the app tab, while the same-origin proxy above prevents Safari storage partitioning. Installed PWAs keep popup sign-in because their standalone app window supplies the stable opener/return surface that ordinary and private Safari tabs lack. Desktop browsers and the Auth Emulator also continue to use `signInWithPopup`.

The sign-in operation is single-flight at the Auth provider boundary. Repeated taps or callers while popup/redirect startup is pending receive the existing promise and must not create another Firebase transaction. Redirect completion consumes Firebase's result once, records the successful login, and persists the 18+ acknowledgement that gated the original tap.

## Regression guard

- **Given** the Vercel deployment configuration **when** its rewrites are inspected **then** `/__/auth/:path*` must map to the equivalent path at `gaycruisebingo.firebaseapp.com`, preserving the same browser-visible Vercel URL. (Test: `src/vercel-auth-proxy.test.ts`.)
- **Given** a direct request for a client-side route **when** Vercel evaluates its rewrites **then** the request must fall back to `/index.html` only after the Firebase Auth proxy has had priority. (Test: `src/vercel-auth-proxy.test.ts`.)
- **Given** iOS Safari on a same-origin auth handler **when** the Player signs in **then** exactly one `signInWithRedirect` transaction starts and no popup starts. (Test: `src/auth/AuthContext.test.tsx`, "uses one top-level redirect instead of a popup on iOS Safari".)
- **Given** sign-in is already pending **when** another caller invokes sign-in **then** Firebase is called only once. (Test: `src/auth/AuthContext.test.tsx`, "coalesces repeated sign-in calls into one Firebase auth transaction".)
- **Given** a mobile redirect returns with a Firebase user **when** the app consumes the redirect result **then** it persists the checked 18+ acknowledgement exactly once. (Test: `src/auth/AuthContext.test.tsx`, "persists the checked 18+ acknowledgement after returning from mobile redirect sign-in".)
- Live verification (manual, post-deploy): the built bundle contains `authDomain: "gaycruisebingo.vercel.app"`; requesting `/__/auth/handler` through the Vercel origin returns Firebase's `fireauth.oauthhelper` page without a redirect; and opening Google sign-in loads the auth iframe from the Vercel origin.
