**Track:** launch · **Phase:** hardening · **Wave:** 4 · **Size:** M · **ADR(s):** —
**Epic:** #__NUM_epic-launch__
**Labels:** agent-action, track:launch, hardening, wave-4, size:M

## Context & scope

The pre-embarkation launch gate. Run the app across an iOS/Android device matrix, write a launch runbook, do a one-handed reachability check on the tab navigation, and document the printed 12-card PDF fallback — the PRD's fallback for a TOTAL connectivity failure only, not for every blip (the [ADR 0006](../../../../docs/adr/0006-offline-resilience.md) framing, where ordinary dead zones are covered by the offline-durable Mark queue). Embarkation is July 15, 2026.

## Current state (scaffold)

- **Exists:** the app shell + tab Nav (from `w0-app-shell`), the installable PWA (from `w1-pwa`), and a green e2e (from `x-e2e-happy-path`); `scripts/seed.mjs` sets the Event sail window `2026-07-15..24`.
- **Missing:** no cross-device test matrix, no launch runbook, no one-handed reachability sign-off, no documented printed-card fallback.
- **Contradicts:** none.

## Files to create / modify

- `specs/x-launch-checklist.md` (new) — the launch runbook + device matrix + fallback documentation, with its matching test (or design-only frontmatter, see below).
- a printed-card PDF artifact / doc reference (12 cards) — documented as the total-failure fallback.

## Implementation notes

- Device matrix: at least one recent iOS (Safari PWA) and one Android (Chrome PWA); verify install prompt, offline play, the native share sheet, and safe-area insets.
- One-handed reachability: confirm the tab Nav (Card / Feed / Ranks / Prompts / Admin-if-admin) is thumb-reachable; note the iOS safe-area handling.
- Printed 12-card PDF: document it as the fallback for TOTAL failure only (ADR 0006) — not a substitute for the offline-durable Mark queue that handles ordinary blips.
- Runbook: seed/admin-roster steps, domain cutover, share-the-link flow, and day-of contacts; target embarkation 2026-07-15.

## Tests to add

- `specs/x-launch-checklist.md` is a launch runbook/checklist with no runtime surface — pair it with a lightweight codified check, or mark it design-only via frontmatter `tested: false` + `reason:` (launch runbook), which the spec↔test checker accepts (layer: n/a — manual matrix, recorded in the `Verified:` trailer).

## Acceptance criteria

- **Given** the device matrix **When** the app is run on iOS + Android **Then** install, offline play, and share all work, and the tab Nav is one-handed reachable.
- **Given** a TOTAL connectivity failure **When** wifi is unusable **Then** the printed 12-card PDF is the documented fallback (ADR 0006) — distinct from the offline Mark queue for ordinary blips.
- [ ] iOS + Android matrix run and signed off
- [ ] Launch runbook written (seed/roster, domain, share-link, contacts)
- [ ] One-handed reachability checked on the tab Nav
- [ ] Printed 12-card PDF fallback documented (total-failure only)
- [ ] Ready for embarkation 2026-07-15

## Definition of Done

- [ ] Spec `specs/x-launch-checklist.md` created/updated **with a matching test** (checker `scripts/ci/check_spec_test_alignment` matches basename → a test under `tests/**` or `src/**/*.test.*`; design-only specs use frontmatter `tested: false` + `reason:`)
- [ ] `npm run typecheck` · `npm test` · `npm run build` green locally (no `lint` script; app tests are not CI-run — record in the commit `Verified:` trailer)
- [ ] Repo gates pass: `repo_lint` (incl. spec↔test alignment), `md-prose-wrap`, review-policy label gate
- [ ] Conventional commits + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`; PR body `Closes #<this issue>`; authored `nathanjohnpayne`, reviewed under `nathanpayne-{agent}`; driven to merge
- [ ] Board discipline per `docs/agents/ticket-workflow.md` (claim → In progress; PR → In review; merge → Done)

## Dependencies

- Depends on #__NUM_x-e2e-happy-path__ — the launch gate requires a green end-to-end round first
