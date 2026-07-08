**Track:** infra · **Phase:** 1 · **Wave:** 4 · **Size:** S · **ADR(s):** —
**Epic:** #__NUM_epic-backend__
**Labels:** agent-action, track:infra, phase-1, wave-4, size:S, needs-phase-4, decision-needed

## Context & scope

Phase 1 features (Cloud Functions + Cloud Vision) require the Firebase Blaze (pay-as-you-go) plan. Before enabling any Phase 1 feature, upgrade the project to Blaze and set a budget alert so a runaway cost (e.g. Vision calls) is caught early — the PRD's cost mitigation. Pure infra — no app-code or ADR surface. This gates the Phase-1 functions work.

## Current state (scaffold)

- **Exists:** Phase 0 runs entirely on Spark; `functions/` (`moderateProof` etc.) and the `@google-cloud/vision` dependency are present in the tree but cannot run until Blaze; `.firebaserc` default project `gaycruisebingo`.
- **Missing:** the project is not on Blaze; no budget alert configured.
- **Contradicts:** none.

## Files to create / modify

- GCP billing / Firebase console — upgrade to Blaze; attach a billing account; create a budget + alert threshold.
- (no repo files change)

## Implementation notes

- Do this BEFORE enabling Phase 1 features (PRD mitigation) — Blaze gates Functions + Cloud Vision.
- Set the budget alert at the same time as the upgrade, not after, so the first Vision invocation is already under a cap/alert.
- Cloud Vision extreme-only usage keeps volume low, but budget alerting is the safety net for surprises.
- Keep the change minimal (needs-phase-4, infra); expect external review.
- **decision-needed:** the budget threshold ($) is an open operational decision — tracked in #__NUM_x-decisions-needed__.

## Tests to add

- Infra/provisioning — no app test layer. `specs/w4-infra-blaze-budget.md` is a runbook carrying frontmatter `tested: false` + `reason:` (infra) per the spec↔test checker (layer: n/a).
- Verify the project shows Blaze and a budget alert exists; record in the commit `Verified:` trailer (layer: n/a — manual verification).

## Acceptance criteria

- **Given** the project on Blaze with a budget alert **When** Phase 1 Functions/Vision run **Then** costs accrue under an alerting cap and Functions can deploy.
- **Given** the budget threshold is crossed **When** spend accrues **Then** the alert fires (PRD cost mitigation).
- [ ] Project upgraded to Blaze (billing account attached)
- [ ] Budget alert configured before any Phase 1 feature is enabled
- [ ] Budget threshold decision resolved via #__NUM_x-decisions-needed__

## Definition of Done

- [ ] Spec `specs/w4-infra-blaze-budget.md` created/updated **with a matching test** (checker `scripts/ci/check_spec_test_alignment` matches basename → a test under `tests/**` or `src/**/*.test.*`; design-only specs use frontmatter `tested: false` + `reason:`)
- [ ] `npm run typecheck` · `npm test` · `npm run build` green locally (no `lint` script; app tests are not CI-run — record in the commit `Verified:` trailer)
- [ ] Repo gates pass: `repo_lint` (incl. spec↔test alignment), `md-prose-wrap`, review-policy label gate
- [ ] Conventional commits + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`; PR body `Closes #<this issue>`; authored `nathanjohnpayne`, reviewed under `nathanpayne-{agent}`; driven to merge
- [ ] Board discipline per `docs/agents/ticket-workflow.md` (claim → In progress; PR → In review; merge → Done)

## Dependencies

- Depends on #__NUM_x-decisions-needed__ — Blaze budget-threshold ($) decision
- Blocks #__NUM_w4-phase1-functions__ — Blaze gates Functions + Cloud Vision
