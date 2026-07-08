**Track:** foundation · **Phase:** 0 · **Wave:** 1 · **Size:** S · **ADR(s):** 0003, 0004
**Epic:** #__NUM_epic-identity__
**Labels:** agent-action, track:foundation, phase-0, wave-1, size:S, reconciliation, decision-needed

## Context & scope

The seed script predates the ADRs and seeds a dead config flag. This reconciliation aligns `scripts/seed.mjs` with the accepted design: drop `blackoutEnabled` from the seeded `settings` (dead config per ADR 0004), align the `claimMode` comment to the `admin_confirmed` name (ADR 0001 rename), confirm the load-bearing `reportHideThreshold` (currently 4, ADR 0004), and document the `ADMIN_UID` roster flow (2–4 Admins including Nathan's seed uid). It is blocked on the Admin-roster decision (#__NUM_x-decisions-needed__).

## Current state (scaffold)

- **Exists:** `scripts/seed.mjs` creates `events/med-2026` with `claimMode: 'honor'` and the comment `// 'honor' | 'proof_required' | 'verified'` (`:69`), `admins: ADMIN_UID ? [ADMIN_UID] : []` (`:70`), and `settings: { reportHideThreshold: 4, blackoutEnabled: true }` (`:71`); it seeds 32 Prompts (`:26-59`, `:79-96`) and documents the `ADMIN_UID` one-time setup in the header (`:1-10`).
- **Missing:** removal of `blackoutEnabled`; the comment still names the pre-rename `verified` value; documentation of the multi-Admin roster.
- **Contradicts:** `blackoutEnabled: true` (`:71`) is dead config (ADR 0004 removes it); the `'verified'` comment (`:69`) predates the ADR-0001 rename to `admin_confirmed`.

## Files to create / modify

- `scripts/seed.mjs` — drop `blackoutEnabled` (`:71`), update the `claimMode` comment (`:69`), keep `reportHideThreshold: 4`, document the `ADMIN_UID` roster (`:70`, header `:1-10`).

## Implementation notes

- Drop `blackoutEnabled` entirely (ADR 0004: it is REMOVED as dead config); the matching type-side removal is #__NUM_w0-type-contract__ — this ticket owns only the seed.
- The seeded `claimMode` value stays `'honor'` (the default); only the trailing comment updates to `'honor' | 'proof_required' | 'admin_confirmed'` (ADR 0001 rename).
- Keep `reportHideThreshold: 4` — it is load-bearing (ADR 0004); confirm the value via #__NUM_x-decisions-needed__.
- Document the `ADMIN_UID` roster flow (2–4 Admins incl. Nathan's seed uid) in the header comment (`:1-10`); the roster values themselves are the blocked decision. Admin is the only privileged role (glossary) — the roster seeds `events/{id}.admins`.
- The seed establishes the dense pre-cruise Prompt pool (ADR 0003): the 32 seeded Prompts (`:26-59`, `:79-96`) give `dealBoard` its ≥ 24 sample before sail; keep the seeded set dense (~30–50) so a late joiner can still be dealt a Board.

## Tests to add

- `specs/w1-event-seed.md` is design-only (frontmatter `tested: false` + `reason:` "run-once Admin seed script; no runtime app surface to unit-test") per the spec↔test checker — OR, if the seeded `settings` is factored into an importable constant, `scripts/seed.test.mjs` asserts it omits `blackoutEnabled` and keeps `reportHideThreshold` (layer: unit).

## Acceptance criteria

- **Given** the seed runs **When** `events/{id}` is written **Then** `settings` contains `reportHideThreshold` and NO `blackoutEnabled`.
- **Given** the Admin-roster decision is resolved (#__NUM_x-decisions-needed__) **When** the seed runs with `ADMIN_UID`(s) **Then** 2–4 Admins (incl. Nathan's seed uid) are written to `events/{id}.admins`.
- [ ] `blackoutEnabled` removed from `seed.mjs:71`.
- [ ] The `claimMode` comment reads `admin_confirmed`, not `verified` (`:69`).
- [ ] `reportHideThreshold: 4` retained (pending #__NUM_x-decisions-needed__).
- [ ] The `ADMIN_UID` roster flow is documented in the script header.

## Definition of Done

- [ ] Spec `specs/w1-event-seed.md` created/updated **with a matching test** (checker `scripts/ci/check_spec_test_alignment` matches basename → a test under `tests/**` or `src/**/*.test.*`; design-only specs use frontmatter `tested: false` + `reason:`)
- [ ] `npm run typecheck` · `npm test` · `npm run build` green locally (no `lint` script; app tests are not CI-run — record in the commit `Verified:` trailer)
- [ ] Repo gates pass: `repo_lint` (incl. spec↔test alignment), `md-prose-wrap`, review-policy label gate
- [ ] Conventional commits + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`; PR body `Closes #<this issue>`; authored `nathanjohnpayne`, reviewed under `nathanpayne-{agent}`; driven to merge
- [ ] Board discipline per `docs/agents/ticket-workflow.md` (claim → In progress; PR → In review; merge → Done)

## Dependencies

- Depends on #__NUM_w0-type-contract__ — the type-side removal of `blackoutEnabled` and the `admin_confirmed` rename.
- Blocked on #__NUM_x-decisions-needed__ — the Admin roster (2–4 uids incl. Nathan's seed uid) and the `reportHideThreshold` confirmation (soft; this ticket blocks nothing hard).
