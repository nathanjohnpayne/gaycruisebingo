---
spec_id: x-multi-event-schema
status: accepted
tested: false
reason: Design-only — documents the already-Event-scoped schema and the deferred multi-Event path; there is no runtime surface and no code change to test.
---

# Multi-event schema readiness (design-only)

The data model is already Event-scoped: everything a Player touches lives under `events/{eventId}/…`, so a second cruise is simply a new Event doc plus a build pointed at it. v1 deliberately ships a SINGLE active Event with NO room-browsing / join-code UI — a PRD non-goal ("Full multi-tenant 'rooms' product", `docs/projects/gaycruisebingo/prds/gaycruisebingo.md:39`) consistent with [ADR 0003](../docs/adr/0003-pool-is-pre-cruise.md) (the pool is a pre-cruise activity "plus latecomers and future Events"; no re-deal or square-swap at launch) and the architecture goal that the app "stay reusable for future cruises without a rewrite" (`docs/architecture/0002-application-architecture.md:13`). This spec records the deferred multi-Event path without building any of it. Every file:line below cites the current tree, not the issue-time snapshot (e.g. the `EVENT_ID` constant the issue placed at `firebase.ts:37` now lives at `src/firebase.ts:48`).

**Decision summary:** a second cruise = create + seed a new Event doc, repoint a build at it via `VITE_EVENT_ID`, done. No rules, index, or Functions changes; no re-deal of existing Boards; no cross-Event browsing; no join codes. The only true single-event hardcode is the build-time `EVENT_ID` constant, and the seam to lift it later is a one-file change.

## What already parameterizes cleanly (evidence)

- **Client data layer — every ref is built under `events/{EVENT_ID}/…`.** The converter-attached read helpers in `src/data/paths.ts:16-46` (`eventRef`, `itemsCol`, `boardRef`, `playersCol`, `playerRef`, `proofsCol`/`proofRef`, `claimsCol`/`claimRef`, `tallyMarkersCol`, `momentsCol`/`momentRef`) and the raw write-path refs in `src/data/admin.ts:6-14`, `src/data/proofs.ts:8-17`, `src/data/profile.ts:8`, `src/data/moments.ts:21`, and `src/data/api.ts:33-36` (plus the in-function refs at `api.ts:352-353` and `api.ts:411`) all interpolate the same `EVENT_ID`. Proof media uploads are Event-scoped too: `src/data/storage.ts:35` writes `proofs/${EVENT_ID}/${uid}/${proofId}.${ext}`. Nothing outside `src/data/` and `src/firebase.ts` constructs an `events/…` path (verified by grep: non-test references to `EVENT_ID` or an `'events'` path segment exist only in `src/firebase.ts`, the seven `src/data/` modules above, and comments/test mocks).
- **Firestore rules are fully `{eventId}`-parameterized.** The whole game surface nests inside `match /events/{eventId}` (`firestore.rules:28`) — `items` (`:42`), `players` (`:68`), `boards` (`:80`), `proofs` (`:85`), `claims` (`:157`), `tally` + `markers` (`:173`, `:184`), `doubts` (`:201`), `moments` (`:225`) — and admin power is per-Event by construction: `isAdmin(eventId)` reads that Event doc's own `admins` array (`firestore.rules:8-11`). Even the proof `storagePath`/`mediaURL` pinning interpolates `eventId` (`firestore.rules:139`, `:144`). N events need zero rules edits.
- **Storage rules mirror it.** `match /proofs/{eventId}/{uid}/{file}` (`storage.rules:29`) with per-Event moderation via `isEventAdmin(eventId)` (`storage.rules:7`, `:36`).
- **Cloud Functions are Event-agnostic.** `moderateProof` derives the Event from the uploaded object's path (`functions/src/index.ts:31-32`, `// proofs/{eventId}/{uid}/{proofId}.jpg`) and writes the flag back to `events/${eventId}/proofs/${proofId}` (`:53`) — it serves any number of Events with zero config. The `share` OG endpoint is query-param driven and touches no Event data.
- **Indexes are declared per collection id, not per Event path.** The single composite index (`players` by `bingoCount`/`squaresMarked`/`firstBingoAt`) uses `"queryScope": "COLLECTION"` (`firestore.indexes.json:4-5`), which applies to every collection named `players` regardless of its parent Event — a new Event inherits it automatically.
- **The seed is already multi-Event.** `scripts/seed.mjs:123` reads `process.env.VITE_EVENT_ID` (defaulting to `med-2026`) and writes `events/${EVENT_ID}` (`:132`) with deterministic prompt ids, so re-running it against a new id creates the next cruise's pool idempotently.
- **The schema anticipates retiring an Event.** `EventDoc.status` is `'active' | 'archived'` (`src/types.ts:28`). Nothing reads the field yet (its only non-test occurrence is the type definition) — that consumer is future work, but no migration is needed to start setting it.
- **Cross-Event surfaces are global by design.** `users/{uid}` profiles (`firestore.rules:14-26`; `UserDoc` in `src/types.ts:77-86`, including the 18+ `attestedAdultAt` self-attestation) and `avatars/` (`storage.rules:23`) are deliberately outside the Event subtree: a Player's identity, avatar, and attestation carry to the next cruise, while their Board/Player rows and stats are per-Event docs that start fresh.

## What hardcodes the single Event (honest inventory)

- **`src/firebase.ts:48` — the one real hardcode, and the intended one.** `export const EVENT_ID = import.meta.env.VITE_EVENT_ID || 'med-2026';` is a module-scope constant baked at build time (`import.meta.env` is compile-time; `src/vite-env.d.ts:12` declares the env var). Every Event path in the app derives from this single symbol via the seven `src/data/` importers (`paths.ts:2`, `api.ts:18`, `proofs.ts:2`, `moments.ts:2`, `profile.ts:2`, `admin.ts:2`, `storage.ts:2`). One deployed bundle therefore serves exactly one Event.
- **Subscription keys assume the Event can never change mid-session.** The `useData` hooks key their snapshot subscriptions on Event-less strings — `'event'` (`src/hooks/useData.ts:82`), `'items'` (`:94`), `` `board:${uid}` `` (`:103`), `` `player:${uid}` `` (`:107`), `` `tally:${itemId}` `` (`:122`), `'players'` (`:139`). Correct today (the id is a compile-time constant), but any future in-session Event switch would have to fold the Event id into every key or stale subscriptions would keep rendering the old cruise.
- **Telemetry has no per-Event dimension.** Neither `src/analytics.ts` nor `src/posthog.ts` references `EVENT_ID`, so two cruises' analytics would be separable only by time window. Acceptable for sequential Events; add an event-id property/super-property if cruises ever overlap.
- **Sailing-specific branding is baked outside the schema.** `index.html:13` ("Trieste to Barcelona, July 2026") and the absolute OG url/image (`index.html:20-21`), the share Function's OG description "Trieste to Barcelona." (`functions/src/index.ts:92`) and absolute `og-default.png` fallback (`:86`), and the PWA manifest name (`vite.config.ts:13-14`). These are deployment/branding concerns, not data-model blockers — and the schema already carries the per-Event equivalents (`EventDoc.name`/`sailStart`/`sailEnd`, `src/types.ts:25-27`) — but a second sailing on the same domain should sweep this copy when it repoints the build.
- **No cross-Event queries exist, by design.** There are no `collectionGroup()` queries anywhere in `src/` or `functions/src/` (verified by grep), so nothing today reads across Events — which is exactly what keeps the rules and indexes this simple.

## Rules / indexes / hosting implications of running N Events

- **Rules: no changes.** Every clause is `{eventId}`-scoped with a per-Event admin roster, so Events are isolated tenants already. `isAdmin()` costs one `get()` of the Event doc per evaluation regardless of how many Events exist.
- **Indexes: no changes for per-Event queries** (COLLECTION scope follows the collection id, above). A future cross-Event feature (e.g. an all-cruises leaderboard) would need a `COLLECTION_GROUP` index plus a collection-group read rule — a new feature decision, explicitly out of scope here.
- **Hosting: one bundle = one Event.** `firebase.json` serves a single `dist` with an SPA rewrite, and the Event id is baked at build. Sequential cruises (the intended shape) just repoint the same site: set `VITE_EVENT_ID`, build, deploy. Truly concurrent Events would need either one hosting site/target per Event (per-site build env) or the startup-time resolution seam below.
- **Firestore: Events coexist in one project.** A finished cruise's subtree stays where it is (flip `status: 'archived'` once something consumes it); nothing about starting Event N+1 touches Event N's data.

## How to run a second cruise (the runbook)

**Given** a reader asks "how do we run a second cruise?" **when** they read this spec **then** the answer is: create the new Event doc and point a build at it — no new UI (ADR 0003).

1. Seed the next Event: `VITE_EVENT_ID=<new-id> ADMIN_UID=<uid,uid> node scripts/seed.mjs` — creates `events/<new-id>` with its admin roster and prompt pool (`scripts/seed.mjs:123`, `:132`).
2. Repoint the build: set `VITE_EVENT_ID=<new-id>` in the build environment and `npm run deploy`.
3. Optionally flip the previous Event to `status: 'archived'` (`src/types.ts:28`) — supported by the schema today, enforced by nothing yet.

Rules, indexes, and Functions ship untouched. Players keep their global identity (`users/{uid}`, avatar, 18+ attestation) and join the new Event, which deals a FRESH Board under `events/<new-id>/boards/{uid}`. There is NO re-deal or square-swap of an existing Board (ADR 0003), NO cross-Event browsing, and NO join codes.

## Recommended migration seam (deferred)

- **Now (v1):** nothing. **Given** v1 **when** it ships **then** there is a single active Event and no room-browsing / join-code UI (PRD non-goal; ADR 0003).
- **Second cruise (sequential):** the runbook above — zero code changes.
- **If concurrent Events ever matter:** the seam is `src/firebase.ts:48` alone. Resolve the id once at startup — e.g. from the URL (subdomain or an `/e/<eventId>` path prefix), falling back to `VITE_EVENT_ID` — keeping `EVENT_ID` a startup-resolved constant. Because every consumer is a lazy helper function that reads the exported symbol per call, and the test suites already substitute it wholesale (`vi.mock('../firebase', …, EVENT_ID: 'test-event')` — e.g. `src/data/w2-tally.test.ts:32`, `src/components/w1-prompt-pool.test.tsx:31`), this is a one-file change with no signature churn in the seven importing modules.
- **Explicitly NOT the seam:** in-session Event switching, a room browser, or join codes. That is the PRD non-goal, and it is also the only variant with real engineering cost — Event-keyed subscription keys throughout `src/hooks/useData.ts`, an Event picker surface, and per-Event routing. If it is ever wanted, it is a product decision first, not a refactor.
