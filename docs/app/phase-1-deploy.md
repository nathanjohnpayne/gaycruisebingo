# Phase 1 — deploy guide

Phase 1 adds the proof system and moderation. It needs the **Blaze** plan (Functions, Cloud Run, Vision API, outbound networking). Deploys go through `op-firebase-deploy` (1Password-backed) — see the root `DEPLOYMENT.md`; do not run `firebase login` / `firebase deploy` directly.

Client code is already wired (proof capture, feed, admin console, App Check hook). This guide covers the backend + config.

## 0. Enable Blaze + APIs

- Upgrade the `gaycruisebingo` project to Blaze (set a budget alert first).
- Enable APIs: **Cloud Vision**, **Cloud Functions**, **Cloud Run**, **Cloud Build**, **Artifact Registry**.

## 1. Cloud Functions (moderation, thumbnails, notifications)

Build the functions package, then deploy through the wrapper:

```bash
cd functions && npm install && npm run build && cd ..
op-firebase-deploy --only functions
```

Deploys three exports: `moderateProof` (Storage trigger → SafeSearch flag + thumbnail), and the two moderation-notification triggers `notifyProofModeration` and `notifyItemModeration` (`onDocumentWritten` on `events/{eventId}/proofs/{proofId}` and `.../items/{itemId}` → email the Event admins when a Proof/Prompt transitions into `flagged`/`hidden`; #101). Player stats are **not** server-recomputed — they stay client-authoritative by design (ADR 0001).

**The two notifier functions need the `RESEND_API_KEY` secret set BEFORE (or they will deploy but fail to send).** See § 1a below for the one-time secret + the `EMAIL_FROM` / `ADMIN_NOTIFY_EMAIL` / `APP_BASE_URL` params; after setting the secret, (re)deploy the bound functions so the binding takes effect (`op-firebase-deploy --only functions`).

**If a previously deployed project still carries `recomputeStats` and/or `share`:** this deploy is what deletes them — Firebase discovers exports removed from the source and prompts to confirm deleting each live function. Two exports have been removed since the scaffold: `recomputeStats` (#40, ADR 0001 — self-writable player stats need no server recompute) and `share` (#39, ADR 0005 — the crawler OG page is replaced by on-device Share Cards). A project deployed before either removal will prompt to delete whichever it still carries. The wrapper always runs `firebase deploy --non-interactive`, which stalls on that prompt, so the one-time cleanup deploy must pass the force flag through: `op-firebase-deploy --only functions --force` (extra args pass straight through to `firebase deploy`). Both deletions are expected and required; do not recreate the function in either case. Deleting `share` from Functions does **not** remove the separate Cloud Run OG renderer — that retirement is step 3 below.

**Moderation note:** SafeSearch is tuned to flag only extreme/violent content, **not** raciness (raciness is expected here). It cannot detect minors — user reporting + the admin console remain the primary control. Flagged proofs appear in **Admin → Flagged**.

### 1a. Email notifications (Resend) — one-time secret + params (#101)

The two notifier functions send transactional email via [Resend](https://resend.com). The API key is a **Google Secret Manager secret**, not a plain env var — set it once (value from the 1Password item **"Resend API Key (gaycruisebingo)"**):

```bash
firebase functions:secrets:set RESEND_API_KEY
# …or pipe from 1Password (confirm the field name when you fetch it):
op read "op://Private/<ITEM-UDID>/<field>" | firebase functions:secrets:set RESEND_API_KEY --data-file -
```

Binding the secret to the functions grants the runtime service account `secretmanager.secretAccessor`; `op-firebase-setup` already grants `roles/secretmanager.viewer` (see `DEPLOYMENT.md`). **After setting the secret, (re)deploy `--only functions`** so the two bound triggers pick it up, then send a live smoke-test to confirm delivery.

The rest of the email config is **non-secret** `firebase-functions/params` (safe defaults baked in; override only if needed). These load from the **Functions source directory**, not the repo-root `.env`: `firebase.json` sets `functions.source: "functions"`, so Functions v2 reads `functions/.env` (all environments) or `functions/.env.<projectId>` (here `functions/.env.gaycruisebingo`). Setting them in the repo-root `.env` has **no effect** on the deployed functions. A committed template lives at `functions/.env.example`:

- `EMAIL_FROM` — default `Gay Cruise Bingo <gaycruisebingo@nathanpayne.com>`. Sends from the **already-verified `nathanpayne.com`** Resend domain (free-plan single-domain limit — **no new DNS**). This is independent of the `gaycruisebingo.com` Hosting domain.
- `ADMIN_NOTIFY_EMAIL` — optional comma-separated shared-inbox override; empty ⇒ notify the Event `admins` roster (resolved to verified Google emails) only.
- `APP_BASE_URL` — default `https://gaycruisebingo.com`; base for the Admin-console deep link in the email body.

## 2. App Check (abuse protection)

1. Google Cloud console → reCAPTCHA Enterprise → create a **Website** key for `gaycruisebingo.com` (+ `localhost` for dev).
2. Firebase console → App Check → register the web app with that site key.
3. Set `VITE_RECAPTCHA_SITE_KEY` in `.env.local`, rebuild, redeploy hosting.
4. In App Check, **enforce** on Cloud Firestore and Cloud Storage once traffic looks healthy.

## 3. Retire the old Cloud Run OG renderer (one-time, only if you deployed it before)

The server-side OG renderer was removed (ADR 0005, #39): its source (`cloud-run/og-renderer/`) and the `share` Function that pointed at it are gone from this repo, and Share Cards are now generated on-device. But the renderer was deployed **separately** — a container on Cloud Run via `gcloud run deploy`, **outside** Firebase Hosting/Functions — so deleting the source and running the Firebase deploys above does **not** remove the live service. If you ran the old Phase 1 instructions, the container stays publicly reachable and billable until you delete it explicitly:

```bash
# Service name/region the removed cloud-run/og-renderer/README.md deployed with.
gcloud run services delete og-renderer --region us-central1 --project gaycruisebingo
```

If you deployed it under a different name or region, list your services first and delete the right one:

```bash
gcloud run services list --project gaycruisebingo
gcloud run services delete <service-name> --region <region> --project gaycruisebingo
```

This is a one-time retirement step for anyone who previously stood the renderer up; on a project that never deployed it there is nothing to delete.

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

Share Cards (BINGO + Leaderboard) are generated on-device and are not part of this backend — see ADR 0005.

## Verification status

The **client** (proof UI, feed, admin, App Check hook) builds with the app. The **functions** package is standalone — install and build it in its own folder (`npm install && npm run build`) before first deploy.
