---
spec_id: vercel-auth-proxy
status: accepted
---

# Vercel must serve Firebase Auth helpers from its own origin

The production Vercel mirror runs at `gaycruisebingo.vercel.app`. Its `VITE_FIREBASE_AUTH_DOMAIN` must be that same hostname so popup and redirect sign-in state remains first-party in storage-partitioned browsers. Pointing the SDK directly at `gaycruisebingo.firebaseapp.com` avoids the blocked custom domain but makes Firebase's auth iframe cross-origin, which can fail with "Unable to process request due to missing initial state" in Safari and in-app webviews.

`vercel.json` transparently reverse-proxies every request under `/__/auth/*` to the Firebase Hosting helper namespace at `https://gaycruisebingo.firebaseapp.com/__/auth/*`. This must remain a rewrite, not a redirect: the browser-visible origin must stay `gaycruisebingo.vercel.app` throughout the helper flow. The rule covers the handler, iframe, JavaScript helpers, and any future helper path Firebase adds beneath the namespace.

The deployment configuration is completed outside the repository: `gaycruisebingo.vercel.app` must remain in Firebase Authentication's authorized domains, and `https://gaycruisebingo.vercel.app/__/auth/handler` must remain an authorized redirect URI on the Google OAuth web client.

## Regression guard

- **Given** the Vercel deployment configuration **when** its rewrites are inspected **then** `/__/auth/:path*` must map to the equivalent path at `gaycruisebingo.firebaseapp.com`, preserving the same browser-visible Vercel URL. (Test: `src/vercel-auth-proxy.test.ts`.)
- Live verification (manual, post-deploy): the built bundle contains `authDomain: "gaycruisebingo.vercel.app"`; requesting `/__/auth/handler` through the Vercel origin returns Firebase's `fireauth.oauthhelper` page without a redirect; and opening Google sign-in loads the auth iframe from the Vercel origin.
