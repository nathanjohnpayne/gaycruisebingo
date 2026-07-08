**Track:** play · **Phase:** 0 · **Wave:** 1 · **Size:** L · **ADR(s):** 0001, 0006
**Epic:** #__NUM_epic-play__
**Labels:** agent-action, track:play, phase-0, wave-1, size:L

## Context & scope

This ticket owns the client-authoritative Mark write path. A Player Marks a Square via `setMark` (transactional; exists); `hasBingo`/`isBlackout` drive the `Celebration` overlay. Per ADR 0001 Marks are client-authoritative and Honor mode Marks instantly; per ADR 0002 a bare Mark posts NOTHING to the Feed; per ADR 0006 Marks queue durably offline. It fixes the false offline comment and adds the offline-survives-reload test. This ticket owns the HOT `src/data/api.ts` `setMark` write path.

## Current state (scaffold)

- **Exists:** `setMark(...)` runs a transaction that recomputes the board `cells` + the Player's stats and writes both (`src/data/api.ts:93-140`; the marked Square's `status` at `:118`); `Board.tsx` calls it, Honor Marks instantly (`:75`), and drives `Celebration` on a new BINGO/Blackout (`:37-42`, `:125`); `Celebration.tsx` renders the overlay (`:25-42`); `hasBingo`/`isBlackout`/`winningCells` are pure + tested (`src/game/logic.ts`, `src/game/logic.test.ts`).
- **Missing:** the ADR-0006 offline-survives-reload test; a Mark write must NOT post to the Feed (correct today — keep it so).
- **Contradicts:** `Board.tsx:65` comment "the live listener reconciles when back online" is FALSE — the write is queued in the durable local cache, not reconciled by a listener. Fix it.

## Files to create / modify

- `src/data/api.ts` — `setMark` write path (`:93-140`), the HOT owner.
- `src/components/Board.tsx` — fix the false offline comment (`:65`); Honor instant-Mark (`:75`).
- `src/components/Celebration.tsx` — BINGO/Blackout overlay (`:25-42`).

## Implementation notes

- Marks are client-authoritative (ADR 0001): `setMark` writes `boards/{uid}` + `players/{uid}` directly; do NOT add server-side stat recompute justified as anti-cheat.
- A BARE Mark posts nothing to the Feed (ADR 0002) — only a Proof or a Moment reaches the Feed; `setMark` must not write a Feed doc.
- Fix `Board.tsx:65`: replace "the live listener reconciles when back online" with the truth — the write is queued in the durable local cache (ADR 0006, #__NUM_w0-offline-persistence__) and syncs on reconnect.
- Honor mode Marks instantly (`Board.tsx:75`); `proof_required`/`admin_confirmed` capture flows are downstream tickets.
- The Tally write is NOT in scope here — #__NUM_w2-tally__ extends this Mark write set (ADR 0002).

## Tests to add

- `tests/offline/mark.test.ts` — Mark offline → reload → still queued → syncs on reconnect (layer: rules-emulator/e2e; ADR 0006 + PRD offline metric).
- `src/data/api.test.ts` — `setMark` toggles a Square and recomputes bingoCount/squaresMarked/firstBingoAt (layer: unit).
- `src/data/api.test.ts` — a bare Mark writes no Feed doc (layer: unit; ADR 0002).

## Acceptance criteria

- **Given** a dealt Board **When** a Player Marks a Square in Honor mode **Then** it Marks instantly and `hasBingo`/`isBlackout` fire the `Celebration` on a new line/blackout.
- **Given** a Player Marks offline **When** they reload **Then** the Mark is still queued and syncs on reconnect (ADR 0006 offline metric).
- **Given** a bare Mark (no Proof) **When** it is written **Then** nothing posts to the Feed (ADR 0002).
- [ ] `Board.tsx:65` false offline comment corrected.
- [ ] No server-side stat recompute justified as anti-cheat (ADR 0001).

## Definition of Done

- [ ] Spec `specs/w1-board-mark-win.md` created/updated **with a matching test** (checker `scripts/ci/check_spec_test_alignment` matches basename → a test under `tests/**` or `src/**/*.test.*`; design-only specs use frontmatter `tested: false` + `reason:`)
- [ ] `npm run typecheck` · `npm test` · `npm run build` green locally (no `lint` script; app tests are not CI-run — record in the commit `Verified:` trailer)
- [ ] Repo gates pass: `repo_lint` (incl. spec↔test alignment), `md-prose-wrap`, review-policy label gate
- [ ] Conventional commits + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`; PR body `Closes #<this issue>`; authored `nathanjohnpayne`, reviewed under `nathanpayne-{agent}`; driven to merge
- [ ] Board discipline per `docs/agents/ticket-workflow.md` (claim → In progress; PR → In review; merge → Done)

## Dependencies

- Depends on #__NUM_w1-board-deal-join__ — Marking needs a dealt Board.
- Depends on #__NUM_w0-offline-persistence__ — the durable offline Mark queue.
- Blocks #__NUM_w2-tally__, #__NUM_w2-proof-capture__, #__NUM_w2-feed-moments__, #__NUM_w2-leaderboard__, #__NUM_w2-share-cards__, #__NUM_x-e2e-happy-path__.
