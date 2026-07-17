**Track:** scoring · **Phase:** 1.5 · **Wave:** 3 · **Size:** M · **Cut line:** nice-to-have (post-sailaway; time-boxed: land before 20:00 Day 9 / Jul 23)

## Context & scope
Implements `daily-cards-spec.md` § "Scoring and social surfaces" → "The finale—two-beat finish" and § "Farewell view". The cruise ends with two scheduled beats: at **20:00 on Day 9** a last-call Moment posts going-into-the-final-night standings; at **08:00 on Day 10** the standings **freeze**, the farewell Day unlocks, and the farewell view opens with the **podium** — cruise champion, cruise-wide First to BINGO, and the ten daily honors — also posted as a final Moment. `d15-scheduler-unlock` owns firing these two beats on schedule; this ticket owns their CONTENT — the standings/podium copy and computation — and the client-side farewell podium banner + freeze semantics.

## Current state
- `MomentKind` is `'bingo' | 'blackout' | 'first_bingo'` (`src/types.ts:179`) with a fixed per-kind copy table (`MOMENT_COPY`, `src/components/ProofFeed.tsx:20-24`) — no `last_call` or `podium` kind exists, and every existing Moment is per-Player, not a cruise-wide standings summary.
- `EventDoc` (`src/types.ts:24-50`) has no freeze field at all. **This is a gap `d15-schema-contract`'s field inventory does not cover** — its HOT-owner list adds `timezone`/`days[]`/`settings.photoProofSource`/etc. but no `frozenAt`. This ticket adds `EventDoc.frozenAt?: number` (ms epoch) directly to `src/types.ts` + its converter default, since no other Wave-0/1/2 ticket needs it before this one lands.
- There is no farewell view, no podium banner, and no "app pins the farewell Day as default view after the cruise ends" logic anywhere in the client.
- **Being revised (per `d15-schema-contract`)**: `MomentDoc` gains `dayIndex` + new kinds (owned there); this ticket consumes two of those new kinds for the last-call and podium beats — coordinate exact kind names with `d15-schema-contract` (e.g. `last_call`, `podium`).
- **needs-phase-4** (protected path / keep PR small): the scheduled 20:00-D9/08:00-D10 triggers themselves live in `functions/src` and are owned by `d15-scheduler-unlock`; this ticket's functions-side surface is a pure content/computation module those triggers call into (standings summary text, podium payload), kept small and reviewed as a protected-path change.

## Files to create / modify
- `src/types.ts` (modify) — add `EventDoc.frozenAt?: number`; consume the new `MomentKind` values for last-call and podium from `d15-schema-contract`.
- `src/data/converters.ts` (modify) — default a missing `frozenAt` to `undefined`/unset on legacy event docs.
- `functions/src/finaleContent.ts` (new, needs-phase-4) — pure functions that `d15-scheduler-unlock`'s 20:00-D9 and 08:00-D10 triggers call: (1) last-call standings copy ("Jess leads by 2 bingos—standings freeze at 8 a.m."); (2) the podium payload — cruise champion, cruise-wide First to BINGO (Days 2–9 only, per `d15-scoring-aggregates`), and the ten daily honors, read from the already-aggregated `PlayerDoc`/day-meta data.
- `tests/functions/d15-finale.test.ts` (new) — unit tests over the pure content functions above.
- `src/components/FarewellPodium.tsx` (new) — the farewell view's podium banner (cruise champion + cruise-wide First to BINGO + ten daily honors), rendered above the goodbye banner (`d15-tutorial-banners` owns the goodbye banner copy/mount; this ticket owns the podium banner itself and their stacking order).
- `src/components/Board.tsx` or the day-view container (modify) — after `frozenAt` is set, freeze the displayed standings (client-side semantics: stop treating post-freeze marks on the farewell card as standings-moving, per `d15-scoring-aggregates`'s farewell-is-ceremonial rule) and pin the farewell Day as the default view once the cruise has ended.

## Implementation notes
- **Two-beat finish, decided 2026-07-11**: 20:00 Day 9 → last-call Moment with going-into-the-final-night standings, stoking the last night rather than ending it (something admins can read aloud at the final show). 08:00 Day 10 → standings freeze (`frozenAt` set), farewell Day unlocks, farewell view opens with the podium, also posted as a final Moment.
- **Scheduler fires the beats; this ticket owns the content.** Do not duplicate `d15-scheduler-unlock`'s trigger wiring — this ticket's functions-side surface is content computation the scheduler's triggers call into.
- **Podium contents**: cruise champion (top of the aggregated Leaderboard, per `d15-scoring-aggregates`), cruise-wide First to BINGO (Days 2–9 only — never an embark/farewell entry, same exclusion as the Leaderboard), and the ten daily honors (each Day's per-day First to BINGO from its `meta.firstBingo`).
- **Farewell is ceremonial**: the farewell Day Card unlocks at the freeze, so its marks never move the standings (owned semantics from `d15-scoring-aggregates`) — the podium/standings shown are computed as of `frozenAt`, not live.
- **Default view after the cruise ends**: the app pins the farewell Day, podium included, as the default view once the cruise is over — this is a client-side view-selection rule, not a data change.
- Copy tone matches the spec's example verbatim in spirit: playful, specific, names a leader and a margin where possible; degrade gracefully to a generic line when standings are a tie or empty (e.g. zero Players marked anything).

## Tests to add
- `tests/functions/d15-finale.test.ts` (layer: functions, `vitest.functions.config.ts`) — the last-call standings copy names the correct leader and margin from a fixture `PlayerDoc` set; the podium payload correctly excludes an embark/farewell-only first-bingo from the cruise-wide honor (mirrors `d15-scoring-aggregates`'s tutorial-exclusion test) and includes all ten daily honors when present.
- `src/components/FarewellPodium.test.tsx` (new, RTL-jsdom) — renders champion, cruise-wide First to BINGO, and ten daily-honor rows from a fixture payload; renders above the goodbye banner mount point.
- `src/data/d15-finale.test.ts` (new, unit) — the default-view pin only activates once `frozenAt` is set and the farewell Day is unlocked, never before.
- `tests/rules/d15-finale.test.ts` (new, rules-emulator) — `EventDoc.frozenAt` is admin/Function-writable only, never client-writable directly by a Player.

## Acceptance criteria
- **Given** it is 20:00 on Day 9 **When** the scheduled trigger fires **Then** a last-call Moment posts naming the current leader and their margin.
- **Given** it is 08:00 on Day 10 **When** the scheduled trigger fires **Then** `EventDoc.frozenAt` is set, the farewell Day unlocks, and a podium Moment posts with the champion, cruise-wide First to BINGO, and ten daily honors.
- **Given** the cruise has ended (`frozenAt` set) **When** a Player opens the app **Then** the farewell Day, podium included, is the default view.
- [ ] The podium's cruise-wide First to BINGO never credits an embark- or farewell-only mark.
- [ ] Standings shown on the farewell view are frozen as of `frozenAt`, never live.
- [ ] `frozenAt` is not client-writable by a Player.

## Definition of Done
- Spec file under `specs/d15-finale.md` WITH a matching test (spec↔test alignment CI).
- `npm run typecheck` + `npm test` + `npm run build` green; md-prose-wrap clean.
- PR body `Closes #<this issue>`; authored `nathanjohnpayne`, driven through REVIEW_POLICY.md to merge.
- Board discipline per `docs/agents/ticket-workflow.md`.

## Dependencies
Depends on #__NUM_d15-scoring-aggregates__, #__NUM_d15-scheduler-unlock__.

## Recommended agent
claude-opus-4-8 @ high — time-boxed, correctness-critical finale content (cruise-wide exclusions, freeze semantics) touching the protected functions path (needs-phase-4); a wrong podium is the most visible possible bug in this whole feature.
