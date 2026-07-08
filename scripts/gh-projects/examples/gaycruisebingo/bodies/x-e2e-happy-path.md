**Track:** launch · **Phase:** hardening · **Wave:** 3 · **Size:** M · **ADR(s):** 0006
**Epic:** #__NUM_epic-launch__
**Labels:** agent-action, track:launch, hardening, wave-3, size:M

## Context & scope

Prove the PRD's headline metric — a full round is playable end-to-end with zero coordination beyond a shared link — with a Playwright e2e test against the Firebase emulator. The test drives a single Player through join → Mark → BINGO → Leaderboard, and adds the [ADR 0006](../../../../docs/adr/0006-offline-resilience.md) assertion that an offline Mark survives a reload (queued durably in IndexedDB, syncs on reconnect). It runs on the Playwright + emulator harness stood up by `w0-test-harness`.

## Current state (scaffold)

- **Exists:** pure game logic and tie-break (`src/game/logic.ts` `comparePlayers`, `106-112`) tested by `src/game/logic.test.ts`; the Playwright harness (`playwright.config.ts`, `test:e2e`, `emulators` block) is delivered by `w0-test-harness`.
- **Missing:** no e2e test today; `package.json` has no `@playwright/test` / e2e script until `w0-test-harness` lands; no emulator-driven full-round test; no offline-mark-survives-reload assertion.
- **Contradicts:** `Board.tsx:65` carries a false offline comment ("the live listener reconciles when back online"); the real offline-durable behavior comes from `w0-offline-persistence` + `w1-board-mark-win`, and this e2e asserts it holds across a reload.

## Files to create / modify

- `tests/e2e/*.spec.ts` (new) — the join → Mark → BINGO → Leaderboard happy path plus offline-mark-survives-reload, against the emulator.
- `playwright.config.ts` — consume/extend the config from `w0-test-harness` (do not fork it).
- `specs/x-e2e-happy-path.md` (new) — spec with the matching e2e test.

## Implementation notes

- Run against the Firebase emulator (Firestore / Auth / Storage), not prod; seed a dense pool (≥ 24 active Prompts) so `dealBoard` does not throw (the ADR-0004 pool < 24 guard, `logic.ts:48-50`).
- Drive a real join-and-deal, tap enough Squares to complete a line (the centre Free Space counts), assert the BINGO celebration, then assert the Player appears on the Leaderboard in the correct tie-break order (bingos → squares → earliest first-bingo).
- Offline assertion (ADR 0006): go offline, Mark a Square, reload the page, assert the Mark is still present (queued in IndexedDB), then reconnect and assert it syncs.
- Zero-coordination check: the entire flow uses only the shared Event link — no Admin action is required to play.

## Tests to add

- `tests/e2e/happy-path.spec.ts` — join → Mark → BINGO → Leaderboard completes with only a shared link (layer: e2e)
- `tests/e2e/happy-path.spec.ts` — a Mark made offline survives a reload and syncs on reconnect (layer: e2e)

## Acceptance criteria

- **Given** a seeded Event (dense pool) and a shared link **When** a Player joins, Marks a winning line, and opens the Leaderboard **Then** BINGO fires and the Player ranks by the correct tie-break — with no coordination beyond the link (PRD metric).
- **Given** a Player offline **When** they Mark a Square and reload **Then** the Mark persists and later syncs on reconnect (ADR 0006; the PRD "offline mark survives reload" metric).
- [ ] Playwright e2e runs green against the emulator
- [ ] Full round join → Mark → BINGO → Leaderboard covered
- [ ] Offline-mark-survives-reload asserted
- [ ] Zero-coordination (shared-link-only) path verified

## Definition of Done

- [ ] Spec `specs/x-e2e-happy-path.md` created/updated **with a matching test** (checker `scripts/ci/check_spec_test_alignment` matches basename → a test under `tests/**` or `src/**/*.test.*`; design-only specs use frontmatter `tested: false` + `reason:`)
- [ ] `npm run typecheck` · `npm test` · `npm run build` green locally (no `lint` script; app tests are not CI-run — record in the commit `Verified:` trailer)
- [ ] Repo gates pass: `repo_lint` (incl. spec↔test alignment), `md-prose-wrap`, review-policy label gate
- [ ] Conventional commits + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`; PR body `Closes #<this issue>`; authored `nathanjohnpayne`, reviewed under `nathanpayne-{agent}`; driven to merge
- [ ] Board discipline per `docs/agents/ticket-workflow.md` (claim → In progress; PR → In review; merge → Done)

## Dependencies

- Depends on #__NUM_w1-board-mark-win__ — the Mark + BINGO/Blackout + offline-durable behavior under test
- Depends on #__NUM_w2-leaderboard__ — the Leaderboard the flow lands on
- Depends on #__NUM_w0-test-harness__ — the Playwright + emulator harness this test runs on
- Blocks #__NUM_x-launch-checklist__ — the launch checklist gates on a green e2e
