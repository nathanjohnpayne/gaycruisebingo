# Ticket: Easy mix—blend tutorial-pool squares into main-day cards (50/50, starting Day 4)

**Track:** dealing · **Phase:** 1.5 · **Size:** M (one PR) · **Labels:** phase-1.5, needs-phase-4 (functions/ scheduler touched) · **Project:** #7

**Recommended agent:** `claude-opus-4-8 @ high` (composition math + the snapshot/deploy race around tomorrow's 08:00 unlock).

**DEADLINE: deployed before Day 4's 08:00 CEST unlock tomorrow (Sat Jul 18).** Cards to date are too hard; starting tomorrow every main-day card mixes in easy on-ship squares.

## User story

> As a player, the cards are a bit hard—I want a fair shot at BINGO without a foursome.

## Context & scope

Main-day cards currently deal all 24 non-free squares from the main pool (10 spicy / 14 tame). Change: a new event setting **`settings.easyMixRatio`** (0–1, **default 0.5**) splits the 24 squares into an **easy half sampled from the embark pool** (the tutorial's on-ship, campy, achievable items) and a **main half** dealt as today. Order of operations: `easyMixRatio` splits 24 → easy/main counts (0.5 → 12/12); the existing `spicyRatio` (~0.4) then applies **within the main half** (12 → ≈5 spicy / 7 tame). Applies to main-pool Days only (Day 4 onward as they unlock); tutorial days unchanged; already-unlocked Days 1–3 completely untouched.

## Decisions (2026-07-17, bake in)

- **Admin-tunable, not hardcoded**: `easyMixRatio` on `EventDoc.settings`, default 0.5, read defensively like `spicyRatio`. One admin control (see Work §4) so difficulty is a dial, not a deploy.
- **Snapshot carries both pools**: a Day's `snapshotItemIds` becomes all active `main` + all active `embark` items at unlock; the deal stratifies by `pool` (then `spicy` within main). One source of truth—reshuffles inherit the mix automatically.
- **Easy-half repeats are fine**: the cross-cruise no-repeat exclusion applies to the MAIN half only. Easy items may repeat from Day 1 or prior days (tallies are per-day, so re-marking "Get your favorite dessert" on Day 4 is legitimate); only same-card duplicates are excluded.
- **Defensive backfill**: if the embark pool can't fill the easy count (hidden items), backfill from tame main—mirrors the existing stratum-dry behavior.
- No pool content changes, no migration, no rules changes. Past days keep their boards, marks, tallies, stats—zero game impact on anything already dealt.

## Deploy race (handle explicitly)

Day 4's snapshot stamps at 08:00. If the scheduler fires on OLD code (deploy missed), the snapshot lacks embark items. Mitigation: add a guarded **re-snapshot** path to the admin manual-unlock fallback—permitted ONLY while zero boards exist for that Day. Ticket checklist: deploy tonight; at 08:00 verify the snapshot contains both pools; if not, re-snapshot before anyone deals.

## Work

1. **Deal** (`src/game/logic.ts` / `src/data/api.ts`): pool-aware stratified composition per the decisions above; deterministic given seed + snapshot (property test).
2. **Scheduler** (`functions/` unlockDay): snapshot = active main + active embark items; idempotent as today; the guarded re-snapshot fallback (zero-boards check).
3. **Types**: `settings.easyMixRatio?: number` (default 0.5 at the call site, like `spicyRatio`).
4. **Admin**: one "Easy mix" row in the Proof & Claims/moderation panel (0% / 25% / 50% stepper or select; live event setting—no deploy to change).
5. **Docs/tests**: `specs/easy-mix.md` + matching tests (alignment CI); CONTEXT.md note on the Day Snapshot definition (now both pools on main days).

## Tests

- Unit: at ratio 0.5 a 24-square deal contains exactly 12 embark-pool + 12 main-pool items (5/7 spicy/tame within main at ratio 0.4); ratio 0 reproduces today's composition byte-for-byte given the same seed; backfill when embark pool is short; no same-card duplicates; main-half no-repeat honored while easy half may repeat across days.
- Functions/emulator: snapshot contains both pools; re-snapshot denied once any board exists for the Day.
- RTL/Playwright: none needed beyond existing—cards render identically; this is composition only.

## Acceptance criteria

- Given Day 4 unlocks with the new code and ratio 0.5, when I deal, my card has 12 easy embark squares + 12 main squares (≈5 spicy), the free center, and normal tally/proof behavior on every square including easy repeats from Day 1.
- Given Days 1–3, nothing changed—boards, marks, tallies, stats identical.
- Given an admin sets easyMixRatio to 0.25 before Day 5's unlock, Day 5 cards deal 6 easy
  + 18 main without a deploy.
- Given a reshuffle on Day 4, the fresh card obeys the same mix.

## Definition of Done

specs/easy-mix.md + tests green (alignment CI); typecheck/build green; PR "Closes #<issue>" through REVIEW_POLICY.md (Phase 4—functions touched); deployed tonight; 08:00 snapshot verified (both pools present) with the fallback exercised if needed; result posted on the issue.
