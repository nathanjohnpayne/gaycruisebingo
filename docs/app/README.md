# Gay Cruise Bingo — app guide (Phase 0)

> App-specific guide. Repo-wide conventions live in the root `README.md`, `AGENTS.md`, and `DEPLOYMENT.md`. Deploy auth follows this account's 1Password-backed model (`.ai_context.md` § Deploy Tooling) — there are **no committed service-account keys**, and deploys go through `op-firebase-deploy`, never `firebase login` / `firebase deploy` directly.

Live, multiplayer bingo PWA. React (Vite) + TypeScript + Firebase. Ships the pre-cruise MVP from the PRD: Google sign-in, a randomized card from a community-editable prompt pool, honor-system marking, BINGO/blackout detection, a leaderboard, all eight party themes, PWA install, GA4, and a static share image. The printed PDFs are the offline fallback.

Phase 1 (proof system, dynamic Playwright OG images, moderation console, App Check) can land as live updates during the sailing without reworking this — see [`phase-1-deploy.md`](phase-1-deploy.md).

## Stack

- **Vite + React 18 + TypeScript** (strict).
- **Firebase**: Auth (Google), Firestore (data), Storage (avatars/proofs), Analytics (GA4), Hosting.
- **vite-plugin-pwa** for installability.
- Phase 0 is **Cloud Functions-free** — each player writes their own stats and the leaderboard is a client-side sort. Phase 1 moves stats server-side.

## 1. Configure Firebase (console, one-time)

1. **Add a Web App**: Project settings > General > Your apps > Web. Copy the config values.
2. **Enable Google sign-in**: Authentication > Sign-in method > Google > Enable.
3. **Firestore** is already provisioned (`us-west1`, Native mode). **Storage**: Storage > Get started if not yet enabled.
4. **(Blaze)** Upgrade to the Blaze plan only when you add Phase 1 (Functions/Cloud Run/Vision). Phase 0 runs on Spark.
5. **Authorized domains**: Authentication > Settings > Authorized domains — add `gaycruisebingo.com` and your Firebase Hosting domains.

## 2. Local env

```bash
cp .env.example .env.local
# fill VITE_FIREBASE_* from the web app config, and VITE_FIREBASE_MEASUREMENT_ID from GA4
```

## 3. Install & run

```bash
npm install
npm run dev        # local dev at http://localhost:5173
npm test           # game-logic unit tests
npm run typecheck  # tsc --noEmit
```

## 4. Seed the event + prompts

`scripts/seed.mjs` uses the Firebase Admin SDK (bypasses security rules). This account's org **blocks service-account key creation**, so seed with Application Default Credentials instead of a downloaded `serviceAccountKey.json`:

```bash
npm i -D firebase-admin
gcloud auth application-default login          # ADC — no key file on disk
ADMIN_UID=<your-google-uid> GOOGLE_CLOUD_PROJECT=gaycruisebingo node scripts/seed.mjs
```

This creates `events/med-2026` (claim mode, default theme, your admin uid) and the 32 starter prompts. The free center ("Complain about Circuit Music") is synthetic and not stored as an item. See the header of `scripts/seed.mjs` for details.

## 5. Deploy

Deploys use `op-firebase-deploy` (1Password-backed, keyless impersonation) — see the root `DEPLOYMENT.md`.

```bash
# rules + indexes + storage
op-firebase-deploy --only firestore:rules,firestore:indexes,storage

# app (vite build + hosting)
npm run deploy:hosting    # = vite build + op-firebase-deploy --only hosting
```

## 6. Custom domain (→ Firebase Hosting)

1. Firebase Hosting > Add custom domain > `gaycruisebingo.com`.
2. At your DNS provider add the **TXT** verification record Firebase gives you.
3. Add the **A records** to the Firebase IPs; **remove** any conflicting A/AAAA/CNAME.
4. If your DNS is proxied (e.g. Cloudflare orange-cloud), set these records to **DNS-only / unproxied** so Firebase can issue the SSL cert.
5. Wait for SSL (usually minutes, up to ~24h). Do this step early.

## 7. Configuration knobs

- **Claim mode** (`events/med-2026.claimMode`): `honor` (default) · `proof_required` · `verified`. The card UI adapts; `verified` marks are `pending` until confirmed (confirmation UI is Phase 1).
- **Default theme** (`defaultTheme`): any of the 8 theme ids in `src/theme/themes.ts`.
- **Admins** (`admins: string[]`): uids that can edit the event and moderate.
- **Event id**: `VITE_EVENT_ID` (defaults to `med-2026`). The schema is event-scoped, so future cruises are new event docs.

## Project structure

```
src/
  types.ts               # shared domain types (the one contract)
  firebase.ts            # SDK init (reads VITE_* env)
  analytics.ts           # GA4 track() helper
  game/logic.ts          # pure rules: deal, bingo/blackout, leaderboard sort
  game/logic.test.ts     # vitest unit tests
  data/{converters,paths,api,seed}.ts
  auth/AuthContext.tsx   # Google auth
  theme/{ThemeContext.tsx,themes.ts,themes.css}
  hooks/useData.ts       # real-time Firestore hooks
  components/            # SignIn, Nav, Board, Leaderboard, ItemPool, ThemeSwitcher, Celebration, Avatar, Admin, Proof*
firestore.rules · storage.rules · firestore.indexes.json
functions/               # Phase 1 Cloud Functions (Vision, thumbnails, stats, share)
cloud-run/og-renderer/   # Phase 1 Playwright OG image service
scripts/seed.mjs
```

## Trust & safety (Phase 0 baseline)

Public app with user-generated content, so even under minimal gating: a one-time 18+ acknowledgment on sign-in, a `report` action on prompts, admin hide/delete via rules, `noindex`, and Storage rules that cap type/size. Phase 1 adds Cloud Vision flagging (for illegal/extreme content, not raciness), App Check, and an admin console. Set a Firebase **budget alert** before enabling Blaze features.

## Known Phase 0 simplifications

- Stats are client-written (honor-system game). Trivially spoofable; that's fine for the vibe and moves server-side in Phase 1.
- Boards are frozen at deal time; prompts added later feed *future* deals only.
- OG image is static; per-share dynamic images are Phase 1.

## Phase 1 (scaffolded — see [`phase-1-deploy.md`](phase-1-deploy.md))

Phase 1 is scaffolded in this same repo and wired into the client: proof system (`ProofSheet` + live Proof Feed), admin console (`/admin`), verified mode, `functions/` (Vision moderation, thumbnails, authoritative stats, crawler `share` page), `cloud-run/og-renderer/` (Playwright OG images), and an App Check hook in `src/firebase.ts`. Backend deploy steps are in [`phase-1-deploy.md`](phase-1-deploy.md).

## Verified

`npm run typecheck` clean · `npm test` 10/10 passing · `npm run build` produces a PWA-enabled `dist/`. (Built against firebase 10.14.1, Vite 5, React 18, TypeScript 5.6.)
