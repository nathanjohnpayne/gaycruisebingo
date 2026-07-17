# Ticket: Schedule correction—unified day themes + two-event Tonight lines (metadata-only, zero game impact)

**Track:** schema / day-ui · **Phase:** 1.5 · **Size:** M (one PR + one owner-run migration) · **Labels:** phase-1.5 · **Project:** #7

**Recommended agent:** `claude-opus-4-8 @ high` (the migration touches live prod data mid-cruise; the code itself is modest).

**URGENT: the app is showing the wrong schedule RIGHT NOW.** Today (Fri Jul 17) is Day 3—a **Sea Day with Neon Pink Playground**—but the seeded event says Valletta/Duty Free. Day 4 unlocks at 08:00 tomorrow (Sat Jul 18) and must deal under the corrected metadata. Land the code and run the migration today.

**Mockups (read first): plans/daily-cards-wireframes.html**—the Day-by-day gallery (every day now carries a "Tonight:" line—two parties on Days 2–4, show/concert + party elsewhere), the locked-day preview frame (Day 4 · Sporty Splash with the Tonight tease), and the Admin Schedule frame ("2 parties" pills). Canonical mapping table: plans/daily-cards-spec.md § Itinerary (corrected 2026-07-17); palettes in § Theme reference.

## Context & scope

The published schedule differs from what we seeded: some days have TWO parties under one **unified day theme**, ports moved (Sea Day is Day 3, Valletta Day 4, Palermo Day 5, **Naples** Day 6, Rome Day 7, **Villefranche** Day 8, Marseille Day 9), and five unified themes are new (Uniforms Without Borders, Neon Pink Playground, Sporty Splash, Under the Stars, Atlantis Classics). Model: the Day keeps ONE ThemeId (chrome, palette, chips, honors emoji); a new `tonight: string[]` on `DayDef` carries EXACTLY TWO signature events per day (parties when the day has them, else the night's headline show/concert + party—sourced from the VB26 vacation guide's Entertainment Preview; Day 10's line is editorial since no disembark-day events are published), rendered as a "Tonight:" line in the day bar and the locked-day tease. Full ten-row mapping: spec § Itinerary.

## HARD CONSTRAINT—update the cards without affecting the game

This change is **display metadata only**. The migration and code may write/read: `days[i].theme`, `days[i].port` / `portEmoji`, `days[i].tonight` (new), plus ThemeMeta/CSS. It must NOT touch: boards, cells, marks, tallies, proofs, doubts, moments, dayStats, cruise totals, snapshots (`snapshotItemIds`), pools, `unlockAt`, dates, or day indexes. Dates already align 1:1 with the seeded days, so this is pure relabeling—already-dealt Day 1–3 cards keep their exact prompts and marks and simply re-render under corrected chrome (theme is cosmetic by design; this is the property that makes the correction safe).

## Work

1. **Types/render**: `DayDef.tonight: string[]` (two entries, every day); "Tonight:" line in the day bar (and locked-day tease)—match the wireframe styling; day chips/honors emoji already derive from the theme, so they correct themselves.
2. **Themes**: five new ThemeIds + `themes.css` token blocks (copy the palettes from the spec § Theme reference verbatim; the w1-themes/a11y contrast suites pick them up automatically—adjust a token only if a suite fails, staying in-family) + `ThemeMeta` entries with the descriptions from the spec (all real guide copy now). The five superseded ThemeIds remain (switcher, saved preferences, `neon-playground` default).
3. **Seed**: update the canonical schedule in the seed so future events start correct.
4. **Migration (owner-run, Admin SDK, `scripts/migrate-schedule-2026-07-17.mts`)**: because Days 1–3 are unlocked, the admin Schedule editor correctly refuses to edit them—so this lands via a one-time script using the service account (bypasses rules; no rules change). Requirements: `--dry-run` default that prints a full before/after diff of ONLY the fields above; idempotent; refuses to run if any forbidden field would change; writes the whole corrected days[] in one update.
5. **Admin editor**: render a "2 parties" pill on multi-party days (see the Admin frame); the tonight line itself is editable text per day.

## Tests

- Unit: the corrected mapping table (day → theme/port/tonight) asserted against the seed; migration module's diff function flags forbidden-field changes.
- RTL: "Tonight:" line renders on EVERY day card with exactly two entries; locked preview shows the tease.
- Contrast suites: green for the five new themes (automatic).
- Post-migration verification (manual, scripted output): export one player's Day 2 board + two tally counts before and after—byte-identical; Day 3 card shows Sea Day/Neon Pink Playground; Day 4 locked preview shows Sporty Splash + its Tonight line; Day 5 shows AirOtic + Under the Stars.

## Acceptance criteria

- Given the live event after migration, Days 1–10 display the corrected ports, unified themes, and two-event Tonight lines per the spec table, and every board, mark, tally, proof, and stat is unchanged (verified by the before/after export).
- Given Day 4's 08:00 unlock tomorrow, the snapshot/deal runs exactly as it would have—the correction changed no dealing inputs.
- Given a player whose saved theme is a superseded ThemeId (e.g. `get-sporty`), their choice still works; Auto—match the day resolves to the new unified ThemeIds.

## Definition of Done

specs/schedule-correction.md + matching tests (alignment CI); typecheck/build green; PR "Closes #<issue>" through REVIEW_POLICY.md; migration dry-run output reviewed, then executed against prod by the owner identity; live verification screenshots on the issue; done before Day 4's 08:00 CEST unlock.
