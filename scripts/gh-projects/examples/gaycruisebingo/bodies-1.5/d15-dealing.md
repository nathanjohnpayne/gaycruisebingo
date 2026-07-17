**Track:** dealing · **Phase:** 1.5 · **Wave:** 1 · **Size:** L · **Cut line:** must-have

## Context & scope
Implements `daily-cards-spec.md` § "Unlock mechanics" and § "Data model" (`BoardDoc` per Day). Today the app deals exactly one Board per Player for the whole Event, once, at join. This ticket makes dealing per-Day: each of the ten Days gets its own Day Card, dealt lazily the first time a Player opens a Day at or after its `unlockAt`, drawn only from that Day's frozen Day Snapshot — never a live query against the pool. A Player's deal excludes Prompts already on their earlier Day Cards until the 80-item main pool is exhausted (~3⅓ days), then the exclusion resets. This is the piece of the redesign the whole daily-card model hangs on; every other Wave-1/2 ticket assumes a per-Day Board exists.

## Current state
- `joinAndDeal` (`src/data/api.ts:256-362`) deals a single Board for the Event: it reads the live `items` collection filtered to `status: 'active'` (`:271`, `:319-331`), applies the community-hide/ban/spicy-ratio filters, then calls `dealBoard(pool, FREE_TEXT, seed, spicyRatio)` (`src/game/logic.ts:105-152`) once and writes `events/{eventId}/boards/{uid}` + `events/{eventId}/players/{uid}` in one batch. There is no per-day anything: no Day concept, no snapshot, no repeat-exclusion.
- `dealBoard` stratifies 24 picks by `spicyRatio` (default 0.4) from whatever pool it's handed (`src/game/logic.ts:84-152`); it has no notion of "already dealt to this Player" and no unstratified/all-tame mode.
- `useBoard(uid)` (`src/hooks/useData.ts:200-202`) subscribes to the single `boards/{uid}` doc via `boardRef(uid)` (`src/data/paths.ts:20-21`), which points at `events/{EVENT_ID}/boards/{uid}` — the pre-1.5 path.
- **FROZEN, unaffected:** `computeMark`/`setMark` (`api.ts:370-669`) — the Mark toggle, Tally write, and win-detection fold are per-Board logic that doesn't care how the Board was dealt; this ticket only changes what gets dealt, when, and from where.
- **Being revised:** the deal write path (`joinAndDeal` → a per-Day deal), the Board path (`boards/{uid}` → `days/{dayIndex}/boards/{uid}`, per `d15-schema-contract`), and `dealBoard`'s pool-sourcing contract (live query → snapshot + exclusion set).

## Files to create / modify
- `src/data/api.ts` (modify) — replace/extend `joinAndDeal`'s single all-Event deal with a per-Day deal function (e.g. `dealDayCard(u, dayIndex)`) that reads the Day's `snapshotItemIds` (never a live `status: 'active'` query) and the Player's dealt-itemId history across earlier Days, then writes `days/{dayIndex}/boards/{uid}` + merges `players/{uid}.dayStats[dayIndex]`. Sequence this AFTER `d15-schema-contract` (types) and `d15-firestore-rules` (write-gating) land, since it is the write path both protect.
- `src/game/logic.ts` (modify) — extend `dealBoard` (or add a sibling) to accept an `excludeIds: Set<string>` (or equivalent) for no-repeat sampling, and an unstratified/all-tame mode for tutorial pools (embark/farewell are seeded all-tame, so stratification is a no-op there, but the call site must not force a spicy ratio against an all-tame pool).
- `src/game/logic.test.ts` (modify) — extend with no-repeat distribution tests.
- `src/hooks/useData.ts` (modify) — `useBoard` becomes Day-scoped (`useBoard(uid, dayIndex)` or similar) against the new path; add a hook (or extend an existing one) for the viewed Day's unlock/snapshot state so the client can distinguish "locked", "unlocked, snapshot pending", and "unlocked, snapshot ready".
- `src/data/paths.ts` (modify) — `boardRef`/add a Day-scoped board ref under `events/{EVENT_ID}/days/{dayIndex}/boards/{uid}`.

## Implementation notes
- **Snapshot-gated deal, never live**: a Player's Day Card is dealt on first open at/after `unlockAt`, from the Day's `snapshotItemIds` — the frozen list `d15-scheduler-unlock` stamps at 08:00 Europe/Rome. The client must NEVER deal from a live `status: 'active'` query for a Day; that is precisely what lets mid-cruise approvals "get in" for not-yet-unlocked Days without disturbing an already-dealt one.
- **Client fallback**: if the client's clock says a Day is unlocked but `snapshotItemIds` isn't stamped yet (function lag), the client waits and shows the locked state with a "waking up" message — it does not deal from an unfrozen pool.
- **No repeats across the cruise**: each Player's deal excludes Prompts already on their earlier Day Cards until the pool is exhausted (80 main items ÷ 24/day ≈ 3⅓ days), then the exclusion resets. Spicy/tame stratification still applies within what remains; if a stratum runs dry the deal backfills from the other, same as today's defensive behavior (`stratifiedPicks`, `src/game/logic.ts:84-102`).
- **Stratification by pool**: 10 spicy / 14 tame for main days; tutorial pools (embark/farewell) are seeded all-tame, so their deal is effectively unstratified — do not apply a spicy target against an all-tame snapshot.
- **Lazy dealing, no fan-out**: the scheduler only stamps the snapshot at 08:00; there is no per-player fan-out at unlock. Dealing happens client-side, per Player, on first open.
- **Joining mid-cruise**: every Day with `unlockAt <= now` is open — a Player can deal and play all of them immediately, subject to the same snapshot-gate and no-repeat rules as everyone else.
- **Past Days stay open**: once dealt, a Day Card is markable for the rest of the cruise. No end-of-day locking.

## Tests to add
- `src/game/logic.test.ts` — extend `describe('dealBoard', …)`: given an `excludeIds` set, the deal draws no id already in the set; when the excludable pool would fall under `MIN_POOL` after exclusion, the exclusion resets (pool-exhaustion reset behavior); an all-tame tutorial pool deals 24 unstratified without a spicy-ratio starvation error.
- `src/data/d15-dealing.test.ts` (new, unit) — a Day Card is dealt only when `snapshotItemIds` is present on the Day; a Day with `unlockAt` in the past but no snapshot yet does not deal (the "waking up" case); a second deal attempt for an already-dealt Day is a no-op (mirrors `joinAndDeal`'s existing-board early return).
- `tests/rules/d15-dealing.test.ts` (new, rules-emulator, layer: Firestore rules) — a Day Card write (create) is rejected when `request.time < day.unlockAt`; accepted at/after unlock when the board doc is absent. (Full rules surface is `d15-firestore-rules`; this suite exercises the dealing path specifically.)

## Acceptance criteria
- **Given** a Day with `unlockAt` in the future **When** a Player opens it **Then** no Board is dealt and the locked-preview state renders (rules test + hook test).
- **Given** a Day whose `unlockAt` has passed but `snapshotItemIds` is not yet stamped **When** a Player opens it **Then** the client shows the "waking up" wait state and does not deal from a live query.
- **Given** a Player's earlier Day Cards already used 20 of the 24 main-pool Prompts still available **When** their next Day Card is dealt **Then** none of those 20 Prompts repeat, until the pool is exhausted and the exclusion resets (distribution test).
- [ ] Tutorial Day (embark/farewell) deals succeed from an all-tame pool with no stratification starvation.
- [ ] A Day Card write path never reads the live `items` collection for its pool — only `snapshotItemIds`.
- [ ] Re-opening an already-dealt Day Card is a no-op (no re-deal).

## Definition of Done
- Spec file under `specs/d15-dealing.md` WITH a matching test (spec↔test alignment CI).
- `npm run typecheck` + `npm test` + `npm run build` green; md-prose-wrap clean.
- PR body `Closes #<this issue>`; authored `nathanjohnpayne`, driven through REVIEW_POLICY.md to merge.
- Board discipline per `docs/agents/ticket-workflow.md`.

## Dependencies
Depends on #__NUM_d15-schema-contract__, #__NUM_d15-firestore-rules__, #__NUM_d15-scheduler-unlock__.
Blocks #__NUM_d15-day-switcher__, #__NUM_d15-scoring-aggregates__, #__NUM_d15-tally-cards__.

## Recommended agent
claude-opus-4-8 @ high — correctness-critical sampling/exclusion logic touching the deal write path other Wave-1/2 tickets depend on; needs careful reasoning about the snapshot-gate and no-repeat reset boundary.
