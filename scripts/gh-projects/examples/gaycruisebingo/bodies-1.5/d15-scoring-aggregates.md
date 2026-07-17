**Track:** scoring · **Phase:** 1.5 · **Wave:** 2 · **Size:** L · **Cut line:** must-have

## Context & scope
Implements `daily-cards-spec.md` § "Scoring and social surfaces". Today `PlayerDoc.bingoCount`/`squaresMarked`/`firstBingoAt` are the totals for the Player's ONE Board. With ten Day Cards, those totals must become sums across every Day Card the Player has played, while each Day keeps its own daily honor (per-day First to BINGO) and the cruise-wide First to BINGO honor is anchored to the eight main-game Days only. This ticket owns the aggregation logic and the Leaderboard/day-meta surfaces; the scheduled Function triggers that fire the finale beats belong to `d15-scheduler-unlock`, and the finale's copy/UI belongs to `d15-finale`.

## Current state
- `computeMark` (`src/data/api.ts:370-461`) folds a Mark into a single `player` payload (`squaresMarked`, `bingoCount`, `firstBingoAt`, `blackout`) computed over ONE Board's `cells` — there is no per-Day scoping.
- `comparePlayers`/`sortPlayers` (`src/game/logic.ts:201-218`) rank by `bingoCount` desc → `squaresMarked` desc → earliest `firstBingoAt`, reading those three fields directly off `PlayerDoc`.
- `Leaderboard.tsx` (`src/components/Leaderboard.tsx:82-259`) reads `useLeaderboard()` (raw, unfiltered roster; `src/hooks/useData.ts:238-256`), derives First to BINGO as the earliest `firstBingoAt` across the FULL roster (`Leaderboard.tsx:107-110`), and renders one flat ranked list with a single "1st BINGO" pin — no per-day honors strip.
- **Being revised:** `PlayerDoc` gains `dayStats?: Record<number, { bingoCount, squaresMarked, firstBingoAt }>` (schema owned by `d15-schema-contract`); this ticket makes `computeMark`/`setMark` write into `dayStats[dayIndex]` per Day Card and derives the cruise-wide totals (`bingoCount`/`squaresMarked`/`firstBingoAt` at the `PlayerDoc` root) as sums/earliest over `dayStats`, with the cruise-wide `firstBingoAt` sum EXCLUDING tutorial-day (embark/farewell) entries.
- **FROZEN, unaffected:** the tie-break order itself (`comparePlayers`) — bingos desc, then squares desc, then earliest first-bingo — is unchanged; only what feeds it changes (a sum over Day Cards instead of one Board).
- **needs-phase-4** (protected path / keep PR small): this ticket does NOT add a server-side player-stats recompute — ADR 0001 and `specs/recon-recompute-stats.md` explicitly forbid re-deriving Player stats in a Cloud Function as pseudo-anti-cheat. Any touch to `functions/src/index.ts` here is limited and coordinated with `d15-scheduler-unlock` (which owns the actual scheduled/day-meta writes); flagged needs-phase-4 because it sits adjacent to that protected path.

## Files to create / modify
- `src/data/api.ts` (modify) — `computeMark`/`setMark`: fold a Mark into `player.dayStats[dayIndex]` (per-Day bingoCount/squaresMarked/firstBingoAt), then derive the cruise-wide root fields as an aggregate over all of `dayStats`.
- `src/game/logic.ts` (modify) — add pure aggregation helpers: sum `dayStats` into cruise-wide totals; compute cruise-wide First to BINGO restricted to Days 2–9 (excludes the tutorial Days' `dayStats` entries from that ONE derivation, while their squares/bingos still count toward the summed totals).
- `src/game/logic.test.ts` (modify) — aggregate-sum tests; tutorial-exclusion test for cruise-wide First to BINGO; tiebreak test over aggregated totals.
- `src/components/Leaderboard.tsx` (modify) — rank by the aggregated cruise-wide totals; add a per-day honors strip (each Day's pinned First to BINGO) alongside the existing single ranked list and "1st BINGO" pin (now cruise-wide-restricted).
- `src/data/dayMeta.ts` (new) — write-once per-day `firstBingo` (`events/{eventId}/days/{dayIndex}/meta.firstBingo = { uid, displayName, at }`) and post the per-card blackout Moment naming the Day, mirroring the existing Moment-broadcast pattern (`src/data/moments.ts`, not shown here but referenced by `d15-schema-contract`/`d15-scheduler-unlock`).
- `functions/src/index.ts` (touch, needs-phase-4) — coordinate only; no player-stats recompute trigger.

## Implementation notes
- **Cruise-wide totals**: `PlayerDoc.bingoCount`/`squaresMarked` are sums across ALL Day Cards, including the embark (tutorial) card — the embark card is live pre-cruise and its marks are real pre-freeze play, just easy by design.
- **Cruise-wide First to BINGO excludes tutorial days**: anchored to main-game Days 2–9 only (resolved decision, spec § "Resolved decisions" #2). Rationale: the embark card is trivially easy and live before anyone boards, so it would otherwise decide the headline honor before the cruise starts. Tutorial Days still get their own per-day honors on the day-meta doc and honors strip.
- **Farewell is ceremonial**: the farewell Day Card unlocks at the freeze (`frozenAt`, set by `d15-scheduler-unlock`/`d15-finale`), so its marks never move the standings — its `dayStats` entry, if any, must not feed the cruise-wide aggregate once frozen.
- **Per-day First to BINGO**: each Day pins its own earliest first-bingo on that Day's `meta.firstBingo`, write-once (mirrors the existing cruise-wide first-bingo Moment pattern), shown on that Day's board view and as an honors strip on the Leaderboard.
- **Per-card blackout**: a per-card blackout posts a Moment naming the Day (e.g. "blacked out Day 4 · 🏛️ Glamiators"), distinct from the cruise-wide blackout kind already in `MomentKind`.
- **Tiebreak unchanged**: bingos desc → squares desc → earliest first-bingo, now computed over the aggregated totals — do not alter `comparePlayers`'s ordering rules, only its inputs.
- Keep ranking client-authoritative (ADR 0001): no server recompute, no anti-cheat framing.

## Tests to add
- `src/game/logic.test.ts` — a Player's `dayStats` across 3 Days sums correctly into cruise-wide `bingoCount`/`squaresMarked` (layer: unit); the cruise-wide First to BINGO derivation ignores an embark-day (index 0) or farewell-day (index 9) `firstBingoAt` even when it is numerically earliest, but a Day-2–9 entry wins normally (layer: unit — tutorial-exclusion, PRD-adjacent). Tiebreak order (bingos → squares → earliest first-bingo) still holds over the aggregated totals (layer: unit — tiebreak).
- `src/data/d15-scoring-aggregates.test.ts` (new, unit) — `computeMark` writes into `player.dayStats[dayIndex]` for the Day being marked and leaves other Days' entries untouched; the derived root totals reflect the sum after the write.
- `src/components/Leaderboard.test.tsx` (extend or new) — the honors strip renders each Day's pinned first-bingo Player; the cruise-wide "1st BINGO" pin never lands on an embark/farewell-only first-bingo (layer: RTL-jsdom).
- `tests/functions/d15-scoring-aggregates.test.ts` (new, layer: functions, `vitest.functions.config.ts`) — day-meta `firstBingo` write-once guard: a second write attempt after the first does not overwrite the stamped honor (whatever mechanism lands here per the needs-phase-4 coordination above).

## Acceptance criteria
- **Given** a Player has marks on 3 different Day Cards **When** the Leaderboard renders **Then** their bingo/square totals are the sum across all 3 Day Cards (aggregate-sum test).
- **Given** the embark Day Card's first bingo lands before any main-game Day's first bingo **When** cruise-wide First to BINGO is computed **Then** the embark bingo is excluded and a Days-2–9 bingo wins the cruise-wide honor instead (tutorial-exclusion test).
- **Given** a Day Card reaches blackout **When** the mark that completes it commits **Then** a Moment naming that Day posts to the Feed.
- [ ] `PlayerDoc` root totals are always a sum over `dayStats`, never a single Board's count.
- [ ] Each Day's `meta.firstBingo` is write-once and independent of every other Day's.
- [ ] The Leaderboard's cruise-wide tiebreak order is unchanged (bingos → squares → earliest first-bingo).
- [ ] No player-stats recompute Cloud Function is added (ADR 0001).

## Definition of Done
- Spec file under `specs/d15-scoring-aggregates.md` WITH a matching test (spec↔test alignment CI).
- `npm run typecheck` + `npm test` + `npm run build` green; md-prose-wrap clean.
- PR body `Closes #<this issue>`; authored `nathanjohnpayne`, driven through REVIEW_POLICY.md to merge.
- Board discipline per `docs/agents/ticket-workflow.md`.

## Dependencies
Depends on #__NUM_d15-schema-contract__, #__NUM_d15-scheduler-unlock__, #__NUM_d15-dealing__.
Blocks #__NUM_d15-finale__, #__NUM_d15-proof-chips-ranks__.

## Recommended agent
claude-opus-4-8 @ high — aggregation logic + the tutorial-exclusion edge case are correctness-critical and sit next to the protected functions path (needs-phase-4); wants careful reasoning, not a quick pass.
