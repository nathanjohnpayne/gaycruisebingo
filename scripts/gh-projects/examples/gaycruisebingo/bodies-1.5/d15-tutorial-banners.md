**Track:** tutorial-content · **Phase:** 1.5 · **Wave:** 2 · **Size:** M · **Cut line:** must-have

## Context & scope

Implements `daily-cards-spec.md` § "Embark (tutorial) view" and § "Farewell view" (the banners only — the farewell view's podium banner is #__NUM_d15-finale__'s content, this ticket owns only the goodbye banner beneath it), plus the "Warm-up" tag mentioned in both sections and in § "Tutorial days" under Scoring. Adds the dismissible three-beat "How this works" banner on the Welcome Aboard Day, the goodbye banner on the So Long, Farewell Day, and a "Warm-up" tag on both tutorial Days' chip and board header.

## Current state

- No banner or per-Day tag concept exists anywhere in `src/components/Board.tsx` today — the Board renders one undifferentiated grid.
- #__NUM_d15-day-switcher__ lands the Day-scoped board view (the switcher strip, the viewed-Day retint, the locked-preview branch) that this ticket's banners mount inside, above the grid.
- #__NUM_d15-two-themes__ lands the `welcome-aboard` / `so-long-farewell` Themes this ticket's tutorial views retint to.
- #__NUM_d15-tutorial-seed__ seeds `DayDef.tutorial: true` on Days 0 and 9 (the flag this ticket branches on to decide which banner, if any, to render) and the two `freeText` overrides shown on those cards' free space.
- **Being revised here:** the Day-scoped board view (already Day-aware once #__NUM_d15-day-switcher__ lands) gains a conditional banner slot above the grid, gated on `DayDef.tutorial` and which of the two tutorial Days is viewed.

## Files to create / modify

- `src/components/Board.tsx` (modify) — mount the tutorial banner slot above the grid, conditional on the viewed Day's `tutorial` flag; render the "Warm-up" tag on the tutorial Days' board header.
- `src/components/DaySwitcher.tsx` (modify, coordinate with #__NUM_d15-day-switcher__) — render the "Warm-up" tag on the two tutorial Day chips.
- `src/components/TutorialBanner.tsx` (new) — the dismissible embark "How this works" banner and the non-dismissible farewell goodbye banner, as one small component parameterized by which Day is viewed (or two thin components if that reads cleaner — implementer's call, keep it one file).

## Implementation notes

- Embark banner, three beats verbatim from spec § "Embark (tutorial) view":
  1. "Mark what happens. Tap a square when you see it, do it, or survive it."
  2. "Five in a row is BINGO. The center is free. Blackout the card if you're ambitious."
  3. "The feed is the proof. Attach a pic, doubt a friend, watch the Moments roll in."

  Caption under the banner, verbatim: "This one's a warm-up—easy squares, all on the ship. The real chaos starts tomorrow at 8." The banner is dismissible (tap to collapse/hide for the session); it is replayable later from More → How to play (#__NUM_d15-more-menu__'s "how to play" row), so dismissal here does not need to persist beyond the session the way the coach overlay's does.
- Farewell banner, verbatim: "Last one. Mark your goodbyes—then go book next year." This banner is NOT dismissible (it is the ceremonial close of the cruise, not a tutorial to get out of the way) and sits below the podium banner (#__NUM_d15-finale__'s content — do not build the podium here, only the goodbye copy beneath it).
- "Warm-up" tag: tutorial Days show a "Warm-up" tag on the Day chip and the board header **in place of** daily-honor competitiveness — the eight main Days show their First to BINGO honor in that slot (owned by #__NUM_d15-scoring-aggregates__); the two tutorial Days show "Warm-up" there instead. Coordinate the header slot shape with that ticket so the two don't collide on the same DOM position independently.
- This ticket does not change scoring: the embark card still counts toward totals, the farewell card is ceremonial (#__NUM_d15-scoring-aggregates__ owns that behavior) — the "Warm-up" tag is presentation only, framing not mechanics.
- The Welcome Aboard banner "carries the game's narrative"; it is deliberately distinct from and complementary to the first-open coach overlay (#__NUM_d15-coach-overlay__), which only decodes the badge notation (Tally count, 👀 Doubt badge, ＋ add-proof, free space) — do not merge the two or duplicate their copy.

## Tests to add

- `src/components/TutorialBanner.test.tsx` (RTL jsdom) — the embark banner renders all three beats + the warm-up caption on the Welcome Aboard Day, dismisses on tap, and does not render on any non-tutorial Day.
- `src/components/TutorialBanner.test.tsx` (RTL jsdom) — the farewell banner renders the goodbye copy on the So Long, Farewell Day, has no dismiss affordance, and does not render on any non-tutorial Day.
- `src/components/Board.test.tsx` or `DaySwitcher.test.tsx` (RTL jsdom) — the "Warm-up" tag renders on exactly the two tutorial Day chips/headers and never on the eight main Days.

## Acceptance criteria

- **Given** a Player views the Welcome Aboard Day for the first time in a session **When** the card renders **Then** the three-beat banner and warm-up caption show above the grid, and tapping the banner dismisses it for that session.
- **Given** a Player views the So Long, Farewell Day **When** the card renders **Then** the non-dismissible goodbye banner shows beneath wherever the podium banner mounts.
- **Given** either tutorial Day **When** its chip or board header renders **Then** it shows a "Warm-up" tag instead of a daily-honor pin.
- [ ] Embark banner copy matches the spec verbatim (three beats + caption).
- [ ] Farewell banner copy matches the spec verbatim.
- [ ] Neither banner renders on any of the eight main Days.
- [ ] The embark banner is dismissible per session; the farewell banner is not.

## Definition of Done

- Spec file `specs/d15-tutorial-banners.md` created WITH a matching test (spec↔test alignment CI).
- `npm run typecheck` + `npm test` + `npm run build` green; md-prose-wrap clean.
- PR body `Closes #<this issue>`; authored `nathanjohnpayne`, driven through REVIEW_POLICY.md to merge.
- Board discipline per `docs/agents/ticket-workflow.md`.

## Dependencies

Depends on #__NUM_d15-day-switcher__ (the Day-scoped board view this banner mounts inside), #__NUM_d15-two-themes__ (the two tutorial Themes the tutorial views retint to), and #__NUM_d15-tutorial-seed__ (the `DayDef.tutorial` flag and `freeText` values this ticket reads). Blocks #__NUM_d15-coach-overlay__ (the overlay is scoped to complement, not repeat, this banner's copy — it should land after the banner exists to verify no overlap). Relates to #__NUM_d15-finale__ (podium banner mounts above this ticket's farewell goodbye banner) and #__NUM_d15-scoring-aggregates__ (owns the daily-honor slot the "Warm-up" tag replaces on tutorial Days).

## Recommended agent

claude-sonnet-5@medium — small, well-bounded presentational component work with verbatim copy and a single boolean gate (`tutorial`); no protected paths.
