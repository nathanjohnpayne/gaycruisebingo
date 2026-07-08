**Track:** schema · **Phase:** hardening · **Wave:** 4 · **Size:** S · **ADR(s):** 0003
**Epic:** #__NUM_epic-launch__
**Labels:** agent-action, track:schema, hardening, wave-4, size:S

## Context & scope

DESIGN-ONLY (no code). Document that the data model is already Event-scoped — everything lives under `events/{eventId}/…` — so a second cruise is simply a new Event doc, and that v1 deliberately ships a SINGLE active Event with NO room-browsing / join-code UI (a PRD non-goal; [ADR 0003](../../../../docs/adr/0003-pool-is-pre-cruise.md)). This records the deferred multi-Event path without building it. There is no runtime surface.

## Current state (scaffold)

- **Exists:** the whole data layer is Event-scoped — `src/data/paths.ts` converter refs (eventRef, itemsCol, boardRef, playersCol, proofsCol, claimsCol, …) all resolve under `events/{EVENT_ID}/`; `firebase.ts:37` `EVENT_ID = VITE_EVENT_ID || 'med-2026'`; `scripts/seed.mjs` creates `events/med-2026`; `firestore.indexes.json` is Event-scoped.
- **Missing:** nothing to build — there is intentionally NO room-browsing / join-code / Event-picker UI (PRD non-goal).
- **Contradicts:** none — a single active Event is the intended v1 shape (ADR 0003).

## Files to create / modify

- `specs/x-multi-event-schema.md` (new) — design-only spec with frontmatter `tested: false` + `reason:` (design-only; no runtime surface); documents Event-scoping, "second cruise = new Event doc," and the no-multi-tenant-rooms non-goal.

## Implementation notes

- Point at the existing Event-scoped paths as proof the schema already supports many Events (`paths.ts` refs under `events/{EVENT_ID}/`; `EVENT_ID` selected at build time via `VITE_EVENT_ID`, `firebase.ts:37`).
- State plainly: a second cruise = create a new Event doc + point a build at it; NO re-deal, NO cross-Event browsing, NO join codes (ADR 0003 single active Event; PRD non-goal "no multi-tenant rooms").
- No code changes — this ticket only writes the design spec.

## Tests to add

- None — design-only. The spec carries frontmatter `tested: false` + `reason:` (design-only, no runtime surface), which the spec↔test checker (`scripts/ci/check_spec_test_alignment`) accepts without a matching test (layer: n/a).

## Acceptance criteria

- **Given** the design spec **When** a reader asks "how do we run a second cruise?" **Then** the answer is documented: a new Event doc under `events/{eventId}`, a build pointed at it, no new UI (ADR 0003).
- **Given** v1 **When** it ships **Then** there is a single active Event and NO room-browsing / join-code UI (PRD non-goal).
- [ ] Spec documents Event-scoping (`events/{eventId}`) with `paths.ts` evidence
- [ ] "Second cruise = new Event doc" recorded; no re-deal / cross-Event browsing
- [ ] Single-active-Event, no-rooms non-goal stated (ADR 0003)
- [ ] Spec is design-only: frontmatter `tested: false` + `reason:`

## Definition of Done

- [ ] Spec `specs/x-multi-event-schema.md` created as **design-only** — frontmatter `tested: false` + `reason:` (no runtime surface); the spec↔test checker (`scripts/ci/check_spec_test_alignment`) accepts it with **no matching test** (design-only exemption; no test required for this ticket)
- [ ] `npm run typecheck` · `npm test` · `npm run build` green locally (trivially green — no code change; no `lint` script; app tests are not CI-run — record in the commit `Verified:` trailer)
- [ ] Repo gates pass: `repo_lint` (incl. spec↔test alignment, satisfied by the design-only frontmatter), `md-prose-wrap`, review-policy label gate
- [ ] Conventional commits + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`; PR body `Closes #<this issue>`; authored `nathanjohnpayne`, reviewed under `nathanpayne-{agent}`; driven to merge
- [ ] Board discipline per `docs/agents/ticket-workflow.md` (claim → In progress; PR → In review; merge → Done)

## Dependencies

- None — design-only, unblocked.
