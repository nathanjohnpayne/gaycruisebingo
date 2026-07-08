# Phase 1 — deploy guide

Phase 1 adds the proof system, moderation, and dynamic share images. It needs the **Blaze** plan (Functions, Cloud Run, Vision API, outbound networking). Deploys go through `op-firebase-deploy` (1Password-backed) — see the root `DEPLOYMENT.md`; do not run `firebase login` / `firebase deploy` directly.

Client code is already wired (proof capture, feed, admin console, App Check hook). This guide covers the backend + config.

## 0. Enable Blaze + APIs

- Upgrade the `gaycruisebingo` project to Blaze (set a budget alert first).
- Enable APIs: **Cloud Vision**, **Cloud Functions**, **Cloud Run**, **Cloud Build**, **Artifact Registry**.

## 1. Cloud Functions (moderation, thumbnails, share)

Build the functions package, then deploy through the wrapper:

```bash
cd functions && npm install && npm run build && cd ..
# optional: set the OG renderer URL (from step 3) so /s/** unfurls have images
echo "OG_RENDERER_URL=https://og-renderer-XXXX.run.app" > functions/.env
op-firebase-deploy --only functions
```

Deploys: `moderateProof` (Storage trigger → SafeSearch flag + thumbnail) and `share` (HTTP → crawler OG meta). Player stats are **not** server-recomputed — they stay client-authoritative by design (ADR 0001).

**Moderation note:** SafeSearch is tuned to flag only extreme/violent content, **not** raciness (raciness is expected here). It cannot detect minors — user reporting + the admin console remain the primary control. Flagged proofs appear in **Admin → Flagged**.

## 2. App Check (abuse protection)

1. Google Cloud console → reCAPTCHA Enterprise → create a **Website** key for `gaycruisebingo.com` (+ `localhost` for dev).
2. Firebase console → App Check → register the web app with that site key.
3. Set `VITE_RECAPTCHA_SITE_KEY` in `.env.local`, rebuild, redeploy hosting.
4. In App Check, **enforce** on Cloud Firestore and Cloud Storage once traffic looks healthy.

## 3. Cloud Run OG renderer (Playwright)

```bash
cd cloud-run/og-renderer
gcloud run deploy og-renderer --source . --project gaycruisebingo \
  --region us-central1 --allow-unauthenticated \
  --memory 1Gi --cpu 1 --concurrency 4 --min-instances 0
```

Take the service URL and put it in `functions/.env` as `OG_RENDERER_URL`, then redeploy functions. Share links then look like `https://gaycruisebingo.com/s/?kind=win&name=Nathan&theme=seriously-pink` (Hosting rewrites `/s/**` → the `share` function → OG meta → Cloud Run image).

## 4. Storage & rules

`storage.rules` already restricts proof/avatar uploads by owner, MIME type, and size. Deploy:

```bash
op-firebase-deploy --only storage,firestore:rules,firestore:indexes
```

**Do not lock player-stat writes — they stay client-authoritative by design (ADR 0001).** The honor system makes `players/{uid}` self-writable: each Player owns its own `bingoCount`, `squaresMarked`, `firstBingoAt`, and `blackout`. There is no server-side stat recompute to make those fields authoritative, so there is nothing to "harden" toward — do **not** tighten the `players/{uid}` rule to profile-fields-only / admins-only. Such a lock has nothing backing it and would break the client stat writes in `joinAndDeal` and `setMark` (`src/data/api.ts`) and in `attachProof` (`src/data/proofs.ts`), making joins and marks **fail** with a permission error.

## 5. What each Phase 1 piece gives you

- **Proof capture** (`ProofSheet`) — photo (camera), audio (MediaRecorder), or a text callout; images are downscaled client-side before upload.
- **Proof Feed** — live activity stream; report/delete.
- **Verified mode** — marks go `pending` and create a claim; admins confirm/reject in the console (stats recompute on resolve).
- **Admin console** — claim mode, default theme, pending claims, flagged/reported proofs, prompt moderation.
- **Dynamic OG** — themed retina share images per win/leaderboard.

## Verification status

The **client** (proof UI, feed, admin, App Check hook) builds with the app. The **functions** and **cloud-run** packages are standalone — install and build them in their own folders (`npm install && npm run build`) before first deploy.
