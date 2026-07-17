**Track:** more-menu · **Phase:** 1.5 · **Wave:** 3 · **Size:** M · **Cut line:** nice-to-have (post-sailaway)

## Context & scope

Implements `daily-cards-spec.md` § More menu, item 3 "Text size": a Small / Medium / Large segmented control in the More menu, persisted per device (`gcb.textSize`), that scales the Square's base type and body text — but the cell's auto-fit guard always has the last word, so Large is a ceiling, never an overflow.

## Current state

No text-size control exists today, and no per-cell auto-fit guard exists either. `.cell` (`src/index.css:194-213`) sets `font-size: clamp(8px, 2.3vw, 12px)` — a pure CSS viewport clamp, not a measure-and-shrink mechanism, and it is the only sizing rule a Square's prompt text obeys today (`overflow: hidden` on `:212` silently clips instead of shrinking). There is no `fitText`-style utility anywhere in `src/` — the spec's "same measure-and-shrink approach as the print card's `fitText`" describes a technique to introduce, not one to reuse; a search of `src/components/*` and `src/` for `fitText`/`measureText`/canvas text-fitting turned up nothing. This ticket therefore both adds the S/M/L control AND builds the fit guard, since no prior art exists to lean on.

## Files to create / modify

- More menu row (inside `#__NUM_d15-more-menu__`'s `src/components/More.tsx`) — the Small / Medium / Large segmented control.
- `src/hooks/useTextSize.ts` (new) — reads/writes `localStorage['gcb.textSize']`, same persistence pattern as `ThemeContext`'s `gcb.theme`.
- `src/index.css` (modify) — `data-text-size` scale variables for the square base type (S ≈ 90%, M 100%, L ≈ 115%) and body text; badges, chips, and chrome do not scale.
- `src/components/Board.tsx` (modify) — apply the fit guard per Square: measure the rendered prompt text against its cell and step the font size down until it fits, capped by (never exceeding) the user's chosen S/M/L base.
- a small `fitText`-style utility (new, e.g. `src/game/fitText.ts`) — the measure-and-shrink primitive Board.tsx calls per Square.

## Implementation notes

- Three sizes only: S ≈ 90%, M = 100% (today's baseline), L ≈ 115%, applied to the Square's base type and body text (spec verbatim).
- The auto-fit guard always wins: a long prompt at Large steps its font down until it fits inside its Square, the same measure-and-shrink idea as a print card's `fitText` would use — Large is a ceiling on the starting size, never a guarantee of that size.
- Badges, chips, and chrome (Tally count, 👀 Doubt badge, lock badge, day chips) do not scale with this control — only the Square's prompt text and general body copy.
- Persist per device, not per Player account — same mechanism as the theme pick (`gcb.theme`), not a Firestore write.
- This ticket's row lives inside `#__NUM_d15-more-menu__`'s `More.tsx`; do not add a second, competing settings surface.

## Tests to add

- `src/game/fitText.test.ts` (unit) — given an oversized string and a fixed cell box, the guard returns a font size that fits; given a short string, it returns the base size unshrunk.
- `src/hooks/useTextSize.test.ts` (unit/RTL) — a pick persists to `localStorage['gcb.textSize']` and survives a remount.
- `src/components/Board.test.tsx` (extend, RTL-jsdom) — Large + a maximally long seeded prompt never visually overflows its cell (assert computed/measured font size is below the Large base for that prompt).

## Acceptance criteria

- **Given** a Player picks Large **When** a very long prompt lands on their card **Then** that Square's text shrinks below the Large base rather than overflowing or clipping.
- **Given** a Player picks a size **When** they reload **Then** the choice persists via `gcb.textSize` on that device.
- **Given** any text size **When** badges/chips/chrome render **Then** their size is unaffected.
- [ ] S/M/L control added to the More menu.
- [ ] Fit guard implemented and always wins over the chosen base size.
- [ ] `gcb.textSize` persists per device.
- [ ] Badges/chips/chrome do not scale.

## Definition of Done

- Spec file under `specs/d15-text-size.md` (or a sensible feature name) WITH a matching test (spec↔test alignment CI).
- `npm run typecheck` + `npm test` + `npm run build` green; md-prose-wrap clean.
- PR body `Closes #<this issue>`; authored `nathanjohnpayne`, driven through REVIEW_POLICY.md to merge.
- Board discipline per `docs/agents/ticket-workflow.md`.

## Dependencies

Depends on #__NUM_d15-more-menu__ — the segmented control needs a menu row to live in.

## Recommended agent

claude-sonnet-5 @ high — the fit-guard measure-and-shrink logic has no existing pattern in this codebase to copy, so it needs careful from-scratch design and a real test against long seeded prompts, not just plumbing a new setting through.
