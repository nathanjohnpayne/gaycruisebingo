**Track:** backend · **Phase:** 1 · **Wave:** 4 · **Size:** M · **ADR(s):** 0004
**Epic:** #__NUM_epic-backend__
**Labels:** agent-action, track:backend, phase-1, wave-4, size:M, needs-phase-4, decision-needed

## Context & scope

App Check adds abuse/bot protection for Firestore + Storage in Phase 1 — defense-in-depth alongside the reactive moderation of [ADR 0004](../../../../docs/adr/0004-reactive-moderation.md), never a posting gate. The client is already wired: `firebase.ts` initializes App Check with a `ReCaptchaEnterpriseProvider`, gated on `VITE_RECAPTCHA_SITE_KEY`, and is a no-op without the key. This ticket provisions the reCAPTCHA Enterprise key in GCP, sets the env for the deployed build, and enables enforcement for Firestore + Storage — no client code change. It does not alter the honor system ([ADR 0001](../../../../docs/adr/0001-honor-system-trust-model.md)): App Check attests the calling app, it does not authorize a Player's Mark.

## Current state (scaffold)

- **Exists:** `firebase.ts:24-34` — `initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(import.meta.env.VITE_RECAPTCHA_SITE_KEY), isTokenAutoRefreshEnabled: true })`, wrapped so it is a no-op unless the key is set (`:25` guard, `:31-33` try/catch for dev).
- **Missing:** no reCAPTCHA Enterprise site key provisioned; `VITE_RECAPTCHA_SITE_KEY` unset; App Check enforcement not enabled on Firestore/Storage in the Firebase console.
- **Contradicts:** none — the scaffold is intentionally inert until the key exists.

## Files to create / modify

- `src/firebase.ts` — already wired (`24-34`); verify only, no code change expected.
- env / build config — set `VITE_RECAPTCHA_SITE_KEY` for the deployed build.
- Firebase console / GCP — provision the reCAPTCHA Enterprise key; enable App Check enforcement for Firestore + Storage.

## Implementation notes

- App Check is abuse protection, not authorization — it does not change the honor-system rules (self-writable `boards`/`players` stay intentional, ADR 0001) and is not a posting gate (ADR 0004).
- Roll out in monitoring/unenforced mode first, then flip to enforce once real traffic shows healthy attestation, to avoid locking out legitimate Players.
- Requires GCP project access; coordinate with the domain + Blaze infra tickets in this epic.
- Keep the PR small (needs-phase-4, touches Firebase init/config); expect external review.
- **decision-needed:** the reCAPTCHA Enterprise key + enforcement timing are open operational decisions — tracked in #__NUM_x-decisions-needed__.

## Tests to add

- No new runtime surface — the client init pre-exists at `firebase.ts:24-34`, so `specs/w4-app-check.md` is a provisioning/runbook spec carrying frontmatter `tested: false` + `reason:` (infra provisioning) per the spec↔test checker (layer: n/a — console + build smoke, recorded in the `Verified:` trailer).
- Smoke: a build with `VITE_RECAPTCHA_SITE_KEY` set initializes App Check without error and legitimate Firestore/Storage reads+writes still succeed under enforcement (layer: n/a — manual verification).

## Acceptance criteria

- **Given** a deployed build with `VITE_RECAPTCHA_SITE_KEY` set **When** a Player loads the app **Then** App Check initializes with the reCAPTCHA Enterprise provider and legitimate Firestore/Storage reads+writes succeed under enforcement.
- **Given** enforcement enabled **When** an unattested/abusive client calls Firestore or Storage **Then** the call is rejected by App Check (abuse protection, not a change to honor-system authorization).
- [ ] reCAPTCHA Enterprise key provisioned in GCP; `VITE_RECAPTCHA_SITE_KEY` set for the deployed build
- [ ] App Check enforcement enabled for Firestore + Storage (after an unenforced monitoring window)
- [ ] No client code change beyond verifying the existing `firebase.ts` wiring
- [ ] Key + enforcement-timing decision resolved via #__NUM_x-decisions-needed__

## Definition of Done

- [ ] Spec `specs/w4-app-check.md` created/updated **with a matching test** (checker `scripts/ci/check_spec_test_alignment` matches basename → a test under `tests/**` or `src/**/*.test.*`; design-only specs use frontmatter `tested: false` + `reason:`)
- [ ] `npm run typecheck` · `npm test` · `npm run build` green locally (no `lint` script; app tests are not CI-run — record in the commit `Verified:` trailer)
- [ ] Repo gates pass: `repo_lint` (incl. spec↔test alignment), `md-prose-wrap`, review-policy label gate
- [ ] Conventional commits + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`; PR body `Closes #<this issue>`; authored `nathanjohnpayne`, reviewed under `nathanpayne-{agent}`; driven to merge
- [ ] Board discipline per `docs/agents/ticket-workflow.md` (claim → In progress; PR → In review; merge → Done)

## Dependencies

- Depends on #__NUM_w1-auth-google__ — App Check pairs with the Google-auth'd client session
- Depends on #__NUM_x-decisions-needed__ — reCAPTCHA Enterprise key + enforcement-timing decision
