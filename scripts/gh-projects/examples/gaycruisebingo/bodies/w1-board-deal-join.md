**Track:** play · **Phase:** 0 · **Wave:** 1 · **Size:** L · **ADR(s):** 0003
**Epic:** #__NUM_epic-play__
**Labels:** agent-action, track:play, phase-0, wave-1, size:L

## Context & scope

This ticket renders the Board and wires deal/freeze-at-join. Per ADR 0003 a Board freezes at join from the active non-free Prompt pool, with the Free Space centre "Complain about Circuit Music"; there is NO re-deal or Square-swap at launch. The `dealBoard` guard when the active pool `< 24` (ADR 0004) is surfaced to the Player rather than swallowed. The Board is private and dealt once (24 sampled Prompts + Free Space).

## Current state (scaffold)

- **Exists:** `joinAndDeal(u)` freezes the Board at join — early-returns if a Board already exists (`src/data/api.ts:60-61`), reads the active non-free pool (`:63-67`), and batch-writes the Board + Player docs (`:73-89`); `dealBoard(pool, FREE_TEXT, seed)` is deterministic per-uid (`api.ts:69-70`); `Board.tsx` renders the Board's 25 Squares (`src/components/Board.tsx:93-121`); `FREE_TEXT = 'Complain about Circuit Music'` (`src/data/seed.ts`).
- **Missing:** user-facing surfacing of the `dealBoard(pool < 24)` guard; a confirmation that no re-deal/swap affordance exists.
- **Contradicts:** none — the scaffold already matches ADR 0003 (freeze-at-join, no re-deal).

## Files to create / modify

- `src/components/Board.tsx` — Board/Square render (`:93-121`); surface the deal guard.
- `src/data/api.ts` — `joinAndDeal` freeze-at-join (`:59-90`), semantics unchanged.
- `src/game/logic.ts` — `dealBoard` guard (`:48-50`), unchanged.

## Implementation notes

- Freeze-at-join is already correct (`api.ts:60-61` early-returns when a Board exists) — do NOT add re-deal or Square-swap (ADR 0003).
- The Free Space centre is the always-marked "Complain about Circuit Music" (`seed.ts` `FREE_TEXT`); the centre counts toward lines.
- Surface the `dealBoard` `< 24` throw (`game/logic.ts:48-50`) to the Player (ADR 0004 guard); coordinate the sign-in-time surfacing with #__NUM_w1-auth-google__.
- Keep the mid-cruise pool dense so a late joiner still samples 24 Prompts (ADR 0003; pool health is #__NUM_w1-prompt-pool__).

## Tests to add

- `src/components/Board.test.tsx` — renders 25 Squares with the Free Space centre marked (layer: RTL-jsdom).
- `src/components/Board.test.tsx` — no re-deal / Square-swap control is present (layer: RTL-jsdom).
- (the `dealBoard(< 24)` throw unit test is owned by #__NUM_w0-test-harness__.)

## Acceptance criteria

- **Given** an active pool ≥ 24 **When** a User joins **Then** a frozen 5×5 Board is dealt once (24 Prompts + Free Space) and re-joining does not re-deal.
- **Given** the active pool < 24 **When** a User joins **Then** the `dealBoard` guard surfaces to the Player (ADR 0004), not a blank Board.
- [ ] The Free Space centre reads "Complain about Circuit Music" and is always marked.
- [ ] No re-deal / Square-swap affordance exists (ADR 0003).

## Definition of Done

- [ ] Spec `specs/w1-board-deal-join.md` created/updated **with a matching test** (checker `scripts/ci/check_spec_test_alignment` matches basename → a test under `tests/**` or `src/**/*.test.*`; design-only specs use frontmatter `tested: false` + `reason:`)
- [ ] `npm run typecheck` · `npm test` · `npm run build` green locally (no `lint` script; app tests are not CI-run — record in the commit `Verified:` trailer)
- [ ] Repo gates pass: `repo_lint` (incl. spec↔test alignment), `md-prose-wrap`, review-policy label gate
- [ ] Conventional commits + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`; PR body `Closes #<this issue>`; authored `nathanjohnpayne`, reviewed under `nathanpayne-{agent}`; driven to merge
- [ ] Board discipline per `docs/agents/ticket-workflow.md` (claim → In progress; PR → In review; merge → Done)

## Dependencies

- Depends on #__NUM_w0-app-shell__ — the Card tab mount point.
- Depends on #__NUM_w0-type-contract__ — the `BoardDoc`/`Cell` types.
- Depends on #__NUM_w0-firestore-rules__ — the `boards/{uid}` self-write rule.
- Blocks #__NUM_w1-board-mark-win__ — Marking needs a dealt Board.
