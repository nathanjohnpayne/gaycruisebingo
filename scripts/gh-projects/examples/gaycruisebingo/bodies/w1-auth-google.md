**Track:** identity · **Phase:** 0 · **Wave:** 1 · **Size:** M · **ADR(s):** 0001
**Epic:** #__NUM_epic-identity__
**Labels:** agent-action, track:identity, phase-0, wave-1, size:M, needs-phase-4

## Context & scope

Google sign-in is the only login (PRD non-goal: no non-Google login). `AuthContext` already drives the Google popup and fires `track('login')`; this ticket hardens the flow by SURFACING the `joinAndDeal` errors that `App.tsx:21` currently swallows — most importantly the ADR-0003/0004 `dealBoard(pool < 24)` guard — as a retry/toast, so a Player who can't be dealt a Board sees why instead of a blank screen. Per ADR 0001 the deal is client-driven honor-system work, so a swallowed failure is invisible today.

## Current state (scaffold)

- **Exists:** `signIn` Google popup + `track('login', { method: 'google' })` (`src/auth/AuthContext.tsx:39-42`); `ensureUserProfile` wrapped in try/catch (`:29-33`); `App.tsx` runs `joinAndDeal` on sign-in and swallows failures with `.catch(() => {})` (`src/App.tsx:19-21`); the Continue-with-Google button (`src/components/SignIn.tsx:31-33`).
- **Missing:** any user-visible surfacing of a `joinAndDeal`/`dealBoard` failure; a retry affordance/toast.
- **Contradicts:** none — the silent `.catch` at `App.tsx:21` is a gap, not an ADR divergence.

## Files to create / modify

- `src/App.tsx` — replace the silent `.catch(() => {})` (`:21`) with an error state handed to a retry/toast surface.
- `src/auth/AuthContext.tsx` — propagate/expose the deal error; keep `track('login')` (`:41`).
- `src/components/SignIn.tsx` — render the retry/toast affordance.

## Implementation notes

- The `dealBoard(pool, freeText, seed)` guard throws when the active non-free pool `< 24` (`src/game/logic.ts:48-50`) — that is the ADR-0004 "guard the deal when the active pool < 24" case and the main error to surface, worded for a Player.
- Do NOT change the honor-system write model (ADR 0001): sign-in stays client-driven; this is purely error surfacing, not a server gate.
- Google remains the only provider (PRD non-goal) — do not add other login methods.
- needs-phase-4: `src/auth/**` is an auto-escalated protected path in `.github/review-policy.yml`; keep the PR < 300 lines and expect external review.

## Tests to add

- `src/App.test.tsx` — a failing `joinAndDeal` renders a retry/toast, not a blank Board (layer: RTL-jsdom).
- `src/components/SignIn.test.tsx` — the retry affordance re-invokes the deal (layer: RTL-jsdom).

## Acceptance criteria

- **Given** the active Prompt pool has < 24 non-free Prompts **When** a User signs in and `joinAndDeal` throws **Then** the Player sees a retry/toast explaining the deal failed (not a blank Board).
- **Given** sign-in succeeds **When** the User is authenticated **Then** `track('login')` has fired and the Player is dealt a Board.
- [ ] `App.tsx:21` no longer swallows deal errors silently.
- [ ] Retry re-invokes `joinAndDeal` without a full reload.
- [ ] Google is the only login method offered.
- [ ] PR kept < 300 lines (needs-phase-4).

## Definition of Done

- [ ] Spec `specs/w1-auth-google.md` created/updated **with a matching test** (checker `scripts/ci/check_spec_test_alignment` matches basename → a test under `tests/**` or `src/**/*.test.*`; design-only specs use frontmatter `tested: false` + `reason:`)
- [ ] `npm run typecheck` · `npm test` · `npm run build` green locally (no `lint` script; app tests are not CI-run — record in the commit `Verified:` trailer)
- [ ] Repo gates pass: `repo_lint` (incl. spec↔test alignment), `md-prose-wrap`, review-policy label gate
- [ ] Conventional commits + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`; PR body `Closes #<this issue>`; authored `nathanjohnpayne`, reviewed under `nathanpayne-{agent}`; driven to merge
- [ ] Board discipline per `docs/agents/ticket-workflow.md` (claim → In progress; PR → In review; merge → Done)

## Dependencies

- Depends on #__NUM_w0-app-shell__ — stable route/mount points to render the retry surface.
- Blocks #__NUM_w1-adult-attestation__ — the attestation gate builds on the sign-in flow.
- Blocks #__NUM_w1-profile-avatar__ — the profile surface needs an authenticated User.
- Blocks #__NUM_w4-app-check__ — App Check enforcement builds on the auth path.
