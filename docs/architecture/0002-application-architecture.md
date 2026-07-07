# 0002: Application Architecture

## Status

Accepted — the initial architecture for the Gay Cruise Bingo web application. Living document; supersede with a new ADR for any material change (framework, backend model, or data-ownership shift). The canonical product intent lives in the PRD (`nathanjohnpayne/docs` → `projects/gaycruisebingo/prds/gaycruisebingo.md`); this record captures the technical decision.

## Date

2026-07-07

## Context

Gay Cruise Bingo is a phone-first, install-to-home-screen web app that makes a printed party bingo card into a live multiplayer game for a specific cruise (Trieste → Barcelona, July 15–24, 2026). The dominant constraint is time: the first usable build had to exist by embarkation, roughly a week out, so the architecture optimizes for the least infrastructure to babysit before a hard date while leaving room to grow. Secondary constraints: it must feel native on both iOS and Android, it hosts user-generated media (photos, audio, named callouts) on a public domain with adult content, and it should stay reusable for future cruises without a rewrite.

## Decision

Build a React single-page application with Vite, TypeScript end-to-end, served from Firebase Hosting, backed by Firebase Auth (Google), Cloud Firestore, Cloud Storage, and GA4. TypeScript is used across the whole stack so one shared set of document types (`Event`, `Item`, `Board`, `Player`, `Proof`, `Claim`) describes Firestore documents, the functions that write them, and the React components that read them — the highest-leverage guardrail against a schemaless database.

The system is delivered in two phases with a deliberate data-ownership split.

Phase 0 (the pre-cruise MVP) is Cloud Functions-free: each player writes their own board and their own denormalized stats, and the leaderboard is a client-side sort over the players collection. This is trivially spoofable, which is acceptable for an honor-system party game and removes an entire backend from the launch critical path. It deploys as static hosting plus Firestore/Storage rules, and runs on the Spark plan.

Phase 1 (shipped as live updates during and after the sailing) adds a `functions/` package and a Cloud Run service, and requires the Blaze plan. Cloud Functions provide image moderation (Cloud Vision SafeSearch, tuned to flag only extreme/illegal content — never raciness, which is expected here), `sharp` thumbnails, authoritative server-side stat recomputation on board writes, and a crawler-facing `share` page. A Cloud Run container runs Playwright/Chromium to render retina (2400×1260) Open Graph images; it is kept off the request path and its output is cached at the CDN. App Check (reCAPTCHA Enterprise) protects Storage, Firestore, and callable endpoints.

Marking supports three event-level claim modes so integrity is a configuration choice rather than a code change: `honor` (tap to mark; proof optional), `proof_required` (a proof attachment is required to mark), and `verified` (a mark goes `pending` and creates a claim that an admin confirms before it counts).

The Firestore model is event-scoped so additional cruises are new documents under `events/`, not a schema change:

```
users/{uid}                      # global profile (cross-event)
events/{eventId}                 # name, sailDates, claimMode, defaultTheme, admins[], settings
events/{eventId}/items/{itemId}  # community-editable prompt pool
events/{eventId}/players/{uid}   # membership + denormalized stats (leaderboard source)
events/{eventId}/boards/{uid}    # a player's frozen 5x5 cells (owner-private)
events/{eventId}/proofs/{id}     # Phase 1: photo/audio/text proof, reportable
events/{eventId}/claims/{id}     # Phase 1: pending claims for 'verified' mode
```

Boards freeze at deal time (24 sampled prompts + a synthetic free center), so prompts added later feed future deals only and existing games stay meaningful. Security rules keep a player's board owner-private, allow any signed-in user to add prompts (with size/rate limits) and to report content, and restrict moderation actions to admins listed on the event document. Storage rules constrain proof/avatar uploads by owner, MIME type, and size.

The domain (`gaycruisebingo.com`, registered at Cloudflare) points at Firebase Hosting via A records set to Firebase's IPs with Cloudflare left in DNS-only (unproxied) mode so Firebase can provision and renew the SSL certificate.

## Consequences

Positive: the launch surface is tiny (static SPA + rules), so there is no backend to operate before the deadline; the phased split lets the richer Phase 1 features land without reworking Phase 0; the event-scoped schema makes a second cruise cheap; and TypeScript end-to-end turns schema drift into compile errors during live-ops edits.

Negative / accepted trade-offs: Phase 0 stats are client-trusted and therefore spoofable — mitigated in Phase 1 by `recomputeStats`, after which player-stat writes can be locked to admins in rules; SPA link unfurling requires the crawler-facing `share` rewrite because crawlers do not run JavaScript; and Playwright OG rendering is heavy, which is why it lives on Cloud Run with CDN caching rather than in a function on the request path.

Follow-ups: once `recomputeStats` is deployed, tighten the `players` rule to make stats server-owned; wire the `.mergepath-project-docs.yml` PRD mirror so the canonical PRD materializes under `docs/projects/gaycruisebingo/prds/`; and write the implementation spec at `specs/gaycruisebingo.md`.
