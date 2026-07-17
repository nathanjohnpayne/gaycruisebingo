**Track:** day-ui · **Phase:** 1.5 · **Wave:** 1 · **Size:** L · **Cut line:** must-have

## Context & scope

Implements `daily-cards-spec.md` § "Day switcher", § "Locked Day preview", and the "per-day free space" half of § "Free space per day" (the tutorial free-text values themselves are seeded by #__NUM_d15-tutorial-seed__). Today the app deals one Board for the whole Event and Board.tsx renders it directly; this ticket turns the Card tab into a per-Day view — a horizontally scrolling strip of ten Day chips above the grid, a viewed-Day retint of the board chrome, and a themed-but-blank locked-Day preview for any Day not yet unlocked.

## Current state

- `src/components/Board.tsx` renders exactly one Board via `useBoard(uid)` (`:325`) with no notion of a Day; `cells` come straight off that single `BoardDoc`.
- `data-theme` is currently set once, app-wide, by `ThemeContext` from the Player's own Theme choice — there is no per-view retint.
- The Free Space center is a single hardcoded string (`FREE_TEXT`, `src/data/seed.ts:3`) baked into every deal via `dealBoard(pool, freeText, seed, spicyRatio)` (`src/game/logic.ts:105`, `src/data/api.ts:341`); there is no per-Day override.
- **FROZEN, do not touch:** `src/components/tabs.ts` mount-point table and `Nav.tsx`'s header revision (both owned by #__NUM_d15-tab-contract__, which lands the two-line "today's port/theme" header this ticket's chip strip mounts under).
- **Being revised here:** `Board.tsx` gains a "viewed Day" concept (defaults to today's Day) that the new switcher drives; the Card tab becomes Day-scoped rendering, not single-Board rendering.

## Files to create / modify

- `src/components/DaySwitcher.tsx` (new) — the ten-chip horizontal strip: weekday + port emoji + theme emoji per chip, states past (✓) / today (filled, default-selected) / locked future (🔒).
- `src/components/Board.tsx` (modify) — mounts `DaySwitcher`; holds the viewed-Day index as local state; sets `data-theme` on the board's own container to the viewed Day's Theme (app-wide `data-theme` from the Player's Theme choice is untouched — board chrome only follows the viewed Day, per spec); renders the locked-Day preview branch instead of a live grid when the viewed Day's `unlockAt` is in the future.
- `src/data/converters.ts` / `src/hooks/useData.ts` (read-only use, no schema changes) — read `EventDoc.days[]` (from #__NUM_d15-schema-contract__) to build chip data and to resolve the locked/unlocked state per Day.

## Implementation notes

- Chip states per spec § "Day switcher": past = ✓ tappable, today = filled + default-selected, locked future = 🔒 tappable → locked preview; taps on a locked chip open the preview, they never deal.
- Selecting a chip "swaps the board area and retints the whole view to that Day's theme (the existing `data-theme` mechanism; the user's own theme choice still governs the rest of the app outside the board view — board chrome follows the viewed Day)" — implement the retint scoped to the board container, not `document.documentElement`.
- Locked-Day preview (verbatim from spec § "Locked Day preview"): full themed chrome for that Day (name, port, palette) over a 5×5 grid of blank squares; only the free space is populated; a centered lock badge reading "Unlocks 8:00 a.m. · Wed Jul 22" (no countdown timer — the date is enough); the Theme's `description` renders under the day name as the dress-code tease; tapping squares does nothing; caption "24 fresh squares land at 8. Come back after coffee."
- The header keeps showing **today's** port/Theme regardless of the viewed Day (spec § "Header") — that behavior belongs to #__NUM_d15-tab-contract__'s Nav.tsx revision; this ticket must not duplicate or fight it.
- This ticket owns the switcher/retint/locked-preview UI only. The lazy per-Day deal-on-open write path and day-scoped Board subscription plumbing are #__NUM_d15-dealing__'s scope (same Wave, no ordering dependency between the two — both build on the schema ticket's `days/{dayIndex}/boards/{uid}` path and `DayDef` shape); coordinate the Board-subscription shape rather than duplicating it.
- No re-deal or Square-swap affordance on any Day (existing ADR 0003 invariant, unchanged and still binding here).

## Tests to add

- `src/components/DaySwitcher.test.tsx` (RTL jsdom) — renders ten chips in Day order; past/today/locked states render the correct glyph; tapping a locked chip opens the preview and issues no write.
- `src/components/Board.test.tsx` (RTL jsdom) — selecting a Day chip sets `data-theme` on the board container to that Day's Theme, not on `<html>`; the app-level Theme (from `ThemeContext`) is unchanged by the selection.
- `src/components/Board.test.tsx` (RTL jsdom) — a locked Day renders a blank 5×5 grid with only the free space populated, the Theme description, and the "Unlocks 8:00 a.m. · <date>" badge; a tap on a blank Square is a no-op (no `setMark` call).

## Acceptance criteria

- **Given** the ten Days from `EventDoc.days[]` **When** the Card tab mounts **Then** the switcher renders ten chips in order with the correct past/today/locked state per chip.
- **Given** a Player taps a past or today chip **When** the board area updates **Then** the board container's `data-theme` becomes that Day's Theme and the grid renders that Day's dealt Board.
- **Given** a Player taps a locked chip **When** the preview renders **Then** the grid shows only the free space populated, the Theme's dress-code description, and the unlock-time lock badge, and no Square tap does anything.
- [ ] Switching Days never changes the Player's own app-wide Theme choice (`gcb.theme`).
- [ ] Locked-Day squares are inert — no `setMark`, no proof sheet, no doubt/tally badges.
- [ ] The header keeps showing today's port/Theme independent of the viewed Day.

## Definition of Done

- Spec file `specs/d15-day-switcher.md` created WITH a matching test (spec↔test alignment CI).
- `npm run typecheck` + `npm test` + `npm run build` green; md-prose-wrap clean.
- PR body `Closes #<this issue>`; authored `nathanjohnpayne`, driven through REVIEW_POLICY.md to merge.
- Board discipline per `docs/agents/ticket-workflow.md`.

## Dependencies

Depends on #__NUM_d15-schema-contract__ (the `DayDef`/`EventDoc.days[]` shape and the `ThemeMeta.description` field this ticket reads). Depends on #__NUM_d15-tab-contract__ (the two-line header this strip mounts under, and the Card tab's mount point). Blocks #__NUM_d15-tutorial-banners__ (the embark/farewell banners mount inside this Day-scoped board view). Blocks #__NUM_d15-coach-overlay__ (the overlay scrims the Player's first dealt card, rendered here).

## Recommended agent

claude-sonnet-5@high — UI-heavy component work with real state-management surface area (viewed-Day selection, scoped retint, locked-vs-live branching) but no protected rules/functions path.
