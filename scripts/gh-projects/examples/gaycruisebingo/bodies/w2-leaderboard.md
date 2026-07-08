**Track:** leaderboard · **Phase:** 0 · **Wave:** 2 · **Size:** M · **ADR(s):** 0001
**Epic:** #__NUM_epic-social__
**Labels:** agent-action, track:leaderboard, phase-0, wave-2, size:M

## Context & scope
The Leaderboard is the for-fun ranking of Players — bingos, then squares marked, then earliest first-bingo — with a pinned First to BINGO. It is a social artefact, not a tamper-proof record: stats are client-authoritative and the First to BINGO honour is self-reported (ADR 0001). The ordering logic already exists and matches the PRD tie-break; this ticket verifies that order under test, adds filters, and keeps the pinned First to BINGO. It must not be reframed as an integrity surface — no server-side recompute justified as anti-cheat (ADR 0001).

## Current state (scaffold)
- **Exists:** `Leaderboard.tsx` renders sorted Players with a "1st BINGO" pin (`src/components/Leaderboard.tsx:40`) and a "· BLACKOUT" suffix (`:37`); `useLeaderboard` sorts via `sortPlayers` (`src/hooks/useData.ts:83-86`); `comparePlayers` implements bingos desc → squares desc → earliest `firstBingoAt` (`src/game/logic.ts:106-112`). The composite index (bingoCount DESC, squaresMarked DESC, firstBingoAt ASC) is present (`firestore.indexes.json:4-11`).
- **Missing:** No test asserting the tie-break order (`src/game/logic.test.ts` has 10 `it` blocks, none over `comparePlayers`); no Leaderboard filters; the First to BINGO pin is derived inline in the component (`Leaderboard.tsx:20-23`) rather than surfaced as a first-class pin.
- **Contradicts:** none in this ticket — the client-authoritative read is correct per ADR 0001 (the anti-cheat `recomputeStats` divergence is owned by `recon-recompute-stats`, out of scope here).

## Files to create / modify
- `src/components/Leaderboard.tsx` — add filters (e.g. all / with-BINGO / Blackout); keep the pinned First to BINGO.
- `src/hooks/useData.ts` — extend `useLeaderboard` only if a filter needs a scoped query (the composite index already backs the sort).
- `src/game/logic.ts` — no behaviour change to `comparePlayers`; it is the tie-break under verification.

## Implementation notes
- Keep the ranking client-authoritative (ADR 0001): the Leaderboard reads Player-written stats and ranks them for fun. Do not add a server recompute or present it as tamper-proof.
- The tie-break is bingos → squares → earliest first-bingo (`comparePlayers`, `src/game/logic.ts:106-112`); filters must not change the underlying order, only the visible subset.
- The pinned First to BINGO is the earliest `firstBingoAt` across Players — ceremonial and self-reported (ADR 0001); keep it pinned above/within the ranked list.
- Filters are presentational; the composite index (`firestore.indexes.json`) already supports the canonical sort, so a filter that reuses it needs no new index.

## Tests to add
- `src/game/logic.test.ts` — `comparePlayers` / `sortPlayers` order: bingos desc, then squares desc, then earliest `firstBingoAt`; a null `firstBingoAt` sorts last (layer: unit — leaderboard tie-break order, PRD metric).
- `src/components/Leaderboard.test.tsx` — the "1st BINGO" pin lands on the earliest first-bingo Player; the "· BLACKOUT" suffix shows for a Blackout; filters narrow the visible set without reordering (layer: RTL-jsdom).

## Acceptance criteria
- **Given** Players with equal bingo counts **When** the Leaderboard renders **Then** they order by squares marked, then by earliest first-bingo (leaderboard tie-break order — PRD metric).
- **Given** at least one Player has a first-bingo **When** the Leaderboard renders **Then** the earliest is pinned as First to BINGO.
- [ ] The tie-break order is asserted by a unit test over `comparePlayers`.
- [ ] Filters change only the visible subset, never the order.
- [ ] Stats stay client-authoritative; no anti-cheat recompute is added (ADR 0001).

## Definition of Done
- [ ] Spec `specs/w2-leaderboard.md` created/updated **with a matching test** (checker `scripts/ci/check_spec_test_alignment` matches basename → a test under `tests/**` or `src/**/*.test.*`; design-only specs use frontmatter `tested: false` + `reason:`)
- [ ] `npm run typecheck` · `npm test` · `npm run build` green locally (no `lint` script; app tests are not CI-run — record in the commit `Verified:` trailer)
- [ ] Repo gates pass: `repo_lint` (incl. spec↔test alignment), `md-prose-wrap`, review-policy label gate
- [ ] Conventional commits + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`; PR body `Closes #<this issue>`; authored `nathanjohnpayne`, reviewed under `nathanpayne-{agent}`; driven to merge
- [ ] Board discipline per `docs/agents/ticket-workflow.md` (claim → In progress; PR → In review; merge → Done)

## Dependencies
- Depends on #__NUM_w1-board-mark-win__ — the Leaderboard ranks the Player stats that the mark/BINGO writes produce.
- Blocks #__NUM_w2-share-cards__
- Blocks #__NUM_x-e2e-happy-path__
