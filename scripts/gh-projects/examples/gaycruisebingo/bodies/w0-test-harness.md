**Track:** foundation · **Phase:** 0 · **Wave:** 0 · **Size:** L · **ADR(s):** 0001, 0002
**Epic:** #__NUM_epic-foundation__
**Labels:** agent-action, track:foundation, phase-0, wave-0, size:L

## Context & scope
Stand up the four test layers the Definition of Done assumes but the scaffold lacks: Vitest in a jsdom project with `@testing-library/react` for component tests, `@firebase/rules-unit-testing` against the Firestore/Storage emulators, Playwright for e2e, and an app CI workflow that runs them. This is the harness ALL other test layers build on, so it lands first in Wave 0. It exists specifically to let `w0-firestore-rules` ASSERT the honor-system invariants — self-writable `boards`/`players` are ALLOWED (ADR 0001) and every Mark publishes to the public Tally (ADR 0002) — against a real emulator rather than mocks.

## Current state (scaffold)
- **Exists:** Vitest inline config `environment:'node'` in `vite.config.ts`; `package.json` scripts `dev/build/preview/typecheck/test (vitest run)/test:watch/deploy`; the only app test `src/game/logic.test.ts` (32-item fixture, 10 `it` blocks).
- **Missing:** jsdom + `@testing-library/*`, `@firebase/rules-unit-testing`, `@playwright/test`, `jsdom` (all ABSENT from `package.json`); an `emulators` block in `firebase.json`; `emulator`/`test:rules`/`test:e2e` scripts; `playwright.config.ts`; any app CI workflow; the `dealBoard(<24)` throw test.
- **Contradicts:** none — the harness is additive; the ADR reconciliations it enables land in the dependent tickets.

## Files to create / modify
- `vite.config.ts` — switch the Vitest project from `environment:'node'` to jsdom so RTL can mount components (keep the pure `src/game/logic.test.ts` green).
- `package.json` — add devDeps `@testing-library/react` (+ jest-dom/user-event), `jsdom`, `@firebase/rules-unit-testing`, `@playwright/test`; add `emulator`, `test:rules`, `test:e2e` scripts.
- `firebase.json` — add an `emulators` block (firestore, storage, auth) so `test:rules` can boot them.
- `playwright.config.ts` (new) — Playwright runner config for `test:e2e`.
- `.github/workflows/app-ci.yml` (new) — CI job running `typecheck` + `test` + `build` + rules tests (none exists today).
- `tests/rules/*.test.ts` (new) — emulator harness wiring; the substantive assertions land in `w0-firestore-rules` / `w0-storage-rules`.
- `src/game/logic.test.ts` — add the missing `dealBoard(<24)` throw test.

## Implementation notes
- Vitest: a jsdom project is enough for RTL; `src/game/logic.test.ts` is env-agnostic and must keep passing.
- `test:rules` should boot the emulators (e.g. `firebase emulators:exec`) then run the rules Vitest project; the `emulators` block pins the ports.
- The new `dealBoard(<24)` test covers the ADR-0004 guard at `src/game/logic.ts:48-50` (throws when the active pool < 24 Prompts).
- Adding `.github/workflows/app-ci.yml` touches `.github/**`, which auto-applies `needs-external-review` regardless of size — expect external review even though app tests remain local agent gates (recorded in the commit `Verified:` trailer).
- Playwright here is a smoke runner only; the full join → mark → BINGO → leaderboard round is `x-e2e-happy-path`.

## Tests to add
- `src/game/logic.test.ts` — `dealBoard` throws when the active pool has < 24 Prompts (layer: unit).
- `tests/rules/*.test.ts` — emulator boots and a signed-in `RulesTestContext` can be constructed (layer: rules-emulator).
- an RTL smoke test — a trivial component mounts under jsdom (layer: RTL-jsdom).
- a Playwright smoke test — `test:e2e` launches the runner (layer: e2e).

## Acceptance criteria
- **Given** the jsdom Vitest project **When** `npm test` runs **Then** RTL mounts a component and `src/game/logic.test.ts` passes including the new `dealBoard(<24)` throw.
- **Given** the `emulators` block + `test:rules` **When** `npm run test:rules` runs **Then** the Firestore/Storage emulators boot and a rules test executes against them.
- **Given** `.github/workflows/app-ci.yml` **When** a PR opens **Then** CI runs `typecheck` + `test` + `build` + rules tests.
- [ ] Vitest runs under jsdom with RTL available; unit tests still green.
- [ ] `@firebase/rules-unit-testing` + `emulators` block + `test:rules` wired.
- [ ] `@playwright/test` + `playwright.config.ts` + `test:e2e` wired (smoke).
- [ ] `app-ci.yml` runs typecheck/test/build/rules on PRs.
- [ ] `dealBoard(<24)` throw test added.

## Definition of Done
- [ ] Spec `specs/w0-test-harness.md` created/updated **with a matching test** (checker `scripts/ci/check_spec_test_alignment` matches basename → a test under `tests/**` or `src/**/*.test.*`; design-only specs use frontmatter `tested: false` + `reason:`)
- [ ] `npm run typecheck` · `npm test` · `npm run build` green locally (no `lint` script; app tests are not CI-run — record in the commit `Verified:` trailer)
- [ ] Repo gates pass: `repo_lint` (incl. spec↔test alignment), `md-prose-wrap`, review-policy label gate
- [ ] Conventional commits + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`; PR body `Closes #<this issue>`; authored `nathanjohnpayne`, reviewed under `nathanpayne-{agent}`; driven to merge
- [ ] Board discipline per `docs/agents/ticket-workflow.md` (claim → In progress; PR → In review; merge → Done)

## Dependencies
- Depends on: none.
- Blocks #__NUM_w0-firestore-rules__ — provides the emulator rules-test harness.
- Blocks #__NUM_w0-storage-rules__ — same harness for Storage rules.
- Blocks #__NUM_w0-offline-persistence__ — provides the integration-test layer.
- Blocks #__NUM_x-e2e-happy-path__ — provides Playwright + `test:e2e`.
