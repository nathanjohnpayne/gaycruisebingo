**Track:** themes · **Phase:** 1.5 · **Wave:** 1 · **Size:** M · **Cut line:** must-have

## Context & scope

Implements `daily-cards-spec.md` § "Theme reference" and its "Proposed palettes for the two new themes" — the two tutorial-Day Themes (`welcome-aboard` for the embark Day, `so-long-farewell` for the disembark Day) plus the new `description` field on `ThemeMeta` for all ten parties, not just the two new ones. The `description` is player-facing dress-code copy shown on the locked-Day preview (#__NUM_d15-day-switcher__) and available to the theme switcher for richness.

## Current state

- `src/theme/themes.ts` exports `THEMES: ThemeMeta[]`, eight entries (`neon-playground` first/default), each `{ id, label, emoji }` (`:10-19`); `ThemeMeta` has no `description` field (`:3-7`).
- `src/theme/themes.css` defines eight `[data-theme='<id>']` blocks, each setting the same eleven custom properties (`--bg`, `--panel`, `--ink`, `--dim`, `--primary`, `--secondary`, `--accent`, `--cell`, `--border`, `--shadow`, `--on-gradient`).
- `ThemeId` (`src/types.ts:14-22`) lists the existing eight ids only; `welcome-aboard` and `so-long-farewell` are added by #__NUM_d15-schema-contract__ (this ticket depends on that type addition landing first, or lands the `ThemeId` union entries itself if sequenced ahead — coordinate via the schema ticket, do not duplicate the union).
- `src/theme/w1-themes.test.tsx` and `src/theme/a11y-badge-contrast.test.tsx` both iterate `THEMES` from `themes.ts` and parse `[data-theme]` blocks straight out of `themes.css` at test time (`w1-themes.test.tsx:7,25-26`; `a11y-badge-contrast.test.tsx:5,28-29`) — neither test hand-lists ThemeIds, so both suites automatically pick up any new `THEMES` entry with a matching CSS block and hold it to the same 4.5:1 WCAG AA floor the existing eight clear.

## Files to create / modify

- `src/theme/themes.css` (modify) — append the two new `[data-theme]` token blocks, using the spec's proposed palettes verbatim (see Implementation notes), plus a `description`-bearing comment matching the file's existing per-theme comment style if a fix is needed for contrast.
- `src/theme/themes.ts` (modify) — add `description: string` to the `ThemeMeta` interface; add `description` to all eight existing `THEMES` entries (verbatim from the spec's Theme reference table); append the two new entries (`welcome-aboard`, `so-long-farewell`) with their `label`, `emoji`, and `description`.

## Implementation notes

- Palettes, verbatim from spec § "Proposed palettes for the two new themes":

  ```css
  [data-theme='welcome-aboard'] {
    /* nautical: deep-sea navy, ocean cyan, brass */
    --bg: #051019; --panel: #0a1a28; --ink: #eaf6ff; --dim: #9fbcd0;
    --primary: #33c6ff; --secondary: #ffbe5c; --accent: #ffd23f;
    --cell: #0a1a28; --border: rgba(51,198,255,.35); --shadow: rgba(51,198,255,.4);
    --on-gradient: #000;
  }
  [data-theme='so-long-farewell'] {
    /* dusk sailaway: deep plum, sunset coral, peach */
    --bg: #140b12; --panel: #1e1019; --ink: #fff0ea; --dim: #d0a8ab;
    --primary: #ff8b6a; --secondary: #feb47b; --accent: #ffd23f;
    --cell: #1e1019; --border: rgba(255,139,106,.35); --shadow: rgba(255,139,106,.4);
    --on-gradient: #000;
  }
  ```

- These are "subject only to the contrast suites" per the spec's Resolved decisions — if either fails a 4.5:1 pair in `w1-themes.test.tsx` or `a11y-badge-contrast.test.tsx`, deepen/adjust within the same navy/cyan/brass or plum/coral/peach family rather than picking an unrelated palette, mirroring how `summer-white`'s `--primary`/`--secondary` were deepened for the same reason (`themes.css:84-92`).
- `description` copy, verbatim from spec § "Theme reference" (player-facing, dress-code-forward):
  - `get-sporty`: "Locker-room fantasy, varsity realness, cheer-captain glam—sporty looks that leave very little to the imagination."
  - `duty-free`: "No borders, no limits, no VAT. National colors, flags, or whatever you find in Duty Free."
  - `glamiators`: "Roman toga-chic meets runway excess. Ancient fantasy, body armor, and spectator/judge looks welcome."
  - `neon-playground`: "Fast, flashy, bright, and silly. Neon, sparkles, and lights for a laser-lit night in the Red Room."
  - `summer-white`: "Atlantis's pinnacle party. Dress up or down in white for a sexy, creative, irreverent night under the stars."
  - `dog-tag`: "The longest-running signature party, inspired by men in small uniforms. Souvenir dog tags provided."
  - `revival-disco`: "A '70s disco afternoon—artificial fabrics, facial hair, oversized shoes, obnoxious accessories."
  - `seriously-pink`: "A hot afternoon of pink silliness, Barbie energy, and frivolous dolled-up fun."
  - `welcome-aboard` *(new)*: "You made it. Learn the game, find the soft-serve, wave goodbye to land."
  - `so-long-farewell` *(new)*: "Last one. Mark your goodbyes—then go book next year."
- Theme names are confirmed (spec Resolved decisions #3): Welcome Aboard / So Long, Farewell — do not rename.
- `THEMES` order: keep `neon-playground` first/default (unchanged existing invariant); append the two new entries at the end so no existing index shifts.
- Themes remain purely cosmetic — no gameplay branches on `ThemeId` in this ticket.

## Tests to add

- No new test *files* are required beyond confirming auto-pickup: `w1-themes.test.tsx` and `a11y-badge-contrast.test.tsx` both derive their ThemeId list from `THEMES`, so adding the two entries + two CSS blocks is sufficient for both suites to cover them at the existing 4.5:1 floor — run both and fix any failing pair per the Implementation notes above.
- `src/theme/themes.test.ts` (or extend the existing suite) — every `THEMES` entry has a non-empty `description` (layer: unit) — the description-presence assertion this ticket adds.

## Acceptance criteria

- **Given** the `welcome-aboard` and `so-long-farewell` `[data-theme]` blocks **When** `w1-themes.test.tsx` runs **Then** both clear the same WCAG AA 4.5:1 pairs the existing eight Themes clear, with no suite changes needed beyond the new blocks.
- **Given** the `.tally-badge` / `.doubt-badge` overlays **When** `a11y-badge-contrast.test.tsx` runs against the two new Themes **Then** both clear 4.5:1.
- **Given** any `THEMES` entry **When** its `description` is read **Then** it is non-empty and matches the spec's Theme reference table verbatim.
- [ ] `ThemeMeta.description` exists and is populated for all ten Themes.
- [ ] `themes.css` new tokens pass the 4.5:1 contrast suites with zero suite edits.
- [ ] Theme names remain exactly "Welcome Aboard" / "So Long, Farewell".

## Definition of Done

- Spec file `specs/d15-two-themes.md` created WITH a matching test (spec↔test alignment CI).
- `npm run typecheck` + `npm test` + `npm run build` green; md-prose-wrap clean.
- PR body `Closes #<this issue>`; authored `nathanjohnpayne`, driven through REVIEW_POLICY.md to merge.
- Board discipline per `docs/agents/ticket-workflow.md`.

## Dependencies

Depends on #__NUM_d15-schema-contract__ (the `welcome-aboard` / `so-long-farewell` `ThemeId` union entries). Blocks #__NUM_d15-day-switcher__ (locked-Day preview reads `ThemeMeta.description`) and #__NUM_d15-tutorial-banners__ (embark/farewell views retint via these two Themes).

## Recommended agent

claude-sonnet-5@medium — mechanical, well-scoped data/CSS addition following an existing eight-theme pattern; the only judgment call is contrast tuning if the proposed palettes don't clear 4.5:1 as-is.
