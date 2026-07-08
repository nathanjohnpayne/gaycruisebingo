**Track:** prompts · **Phase:** 0 · **Wave:** 1 · **Size:** M · **ADR(s):** 0003, 0004
**Epic:** #__NUM_epic-play__
**Labels:** agent-action, track:prompts, phase-0, wave-1, size:M

## Context & scope

The Prompt pool is the community-editable set of things-that-might-happen. Per ADR 0003 adding a Prompt is a pre-cruise activity — Boards freeze at join, so mid-cruise adds are mostly inert (they land in the pool for future Boards, not your frozen one). This ticket strengthens the pre-sail framing, adds a client-side rate-limit on add/report, and keeps the pool dense (~30–50). Metric: add-a-Prompt < 5 s.

## Current state (scaffold)

- **Exists:** `ItemPool.tsx` adds a Prompt (`addItem`, `src/components/ItemPool.tsx:12-21`, button `:36`) and reports one (`reportItem`, `:57-59`); the future-cards note "New prompts join the pool for future cards. {items.length} in play." (`:40-42`); `addItem` caps text to 80 chars (`src/data/api.ts:143-154`); `reportItem` increments the counter (`:157-159`).
- **Missing:** stronger pre-sail framing; a client rate-limit on add/report.
- **Contradicts:** none — the future-cards note already gestures at ADR 0003; it just needs strengthening.

## Files to create / modify

- `src/components/ItemPool.tsx` — strengthen the pre-sail copy (`:40-42`); add the rate-limit UX.
- `src/data/api.ts` — `addItem`/`reportItem` (`:143-159`); add a client rate-limit guard.

## Implementation notes

- Message add-a-Prompt as pre-sail (ADR 0003): "get your prompts in before we sail", making clear that mid-cruise adds join the pool for future Boards, not the Player's frozen Board.
- Add a client-side rate-limit on add/report to keep the pool healthy; Phase 0 limits are presentational/client-side — server-authoritative limits are Phase 1.
- Keep the pool dense (~30–50 Prompts, ADR 0003) so `dealBoard` always has ≥ 24 to sample (the guard is #__NUM_w1-board-deal-join__).
- A Prompt is a thing-that-might-happen in the community pool (glossary) — the report increments only (`api.ts:158`); the threshold-based hide is #__NUM_w2-admin-console__.

## Tests to add

- `src/components/ItemPool.test.tsx` — adding a Prompt calls `addItem` and clears the input (layer: RTL-jsdom).
- `src/components/ItemPool.test.tsx` — the client rate-limit throttles a rapid second add/report (layer: RTL-jsdom).

## Acceptance criteria

- **Given** the pre-sail window **When** a Player adds a Prompt **Then** it persists to the pool in < 5 s and the pre-sail framing is shown (PRD metric).
- **Given** a Player adds/reports rapidly **When** they exceed the client rate-limit **Then** further add/report is throttled.
- [ ] Pre-sail framing strengthened (ADR 0003).
- [ ] Pool stays dense (~30–50).
- [ ] add-a-Prompt < 5 s (PRD metric).

## Definition of Done

- [ ] Spec `specs/w1-prompt-pool.md` created/updated **with a matching test** (checker `scripts/ci/check_spec_test_alignment` matches basename → a test under `tests/**` or `src/**/*.test.*`; design-only specs use frontmatter `tested: false` + `reason:`)
- [ ] `npm run typecheck` · `npm test` · `npm run build` green locally (no `lint` script; app tests are not CI-run — record in the commit `Verified:` trailer)
- [ ] Repo gates pass: `repo_lint` (incl. spec↔test alignment), `md-prose-wrap`, review-policy label gate
- [ ] Conventional commits + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`; PR body `Closes #<this issue>`; authored `nathanjohnpayne`, reviewed under `nathanpayne-{agent}`; driven to merge
- [ ] Board discipline per `docs/agents/ticket-workflow.md` (claim → In progress; PR → In review; merge → Done)

## Dependencies

- Depends on #__NUM_w0-app-shell__ — the Prompts tab mount point.
- Depends on #__NUM_w0-firestore-rules__ — the `items` create-if-valid + report-only-increment rules.
- Blocks #__NUM_w2-admin-console__ — auto-hide/report-queue builds on the pool + report counter.
