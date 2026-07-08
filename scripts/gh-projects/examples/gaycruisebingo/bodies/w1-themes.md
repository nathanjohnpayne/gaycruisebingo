**Track:** themes · **Phase:** 0 · **Wave:** 1 · **Size:** M · **ADR(s):** —
**Epic:** #__NUM_epic-play__
**Labels:** agent-action, track:themes, phase-0, wave-1, size:M

## Context & scope

The 8 Atlantis Themes (Neon Playground default) are cosmetic looks a User can switch. The switcher, CSS, and persistence already exist; this ticket verifies WCAG AA contrast across all 8, confirms switch < 5 s (PRD metric), and confirms persistence plus the Event/Player default. No ADR governs Themes directly; the binding constraint is the PRD non-goal — no Atlantis marks / affiliation.

## Current state (scaffold)

- **Exists:** `THEMES` lists the 8 Atlantis parties, Neon Playground first/default (`src/theme/themes.ts:10-19`); `themes.css` has the 8 `[data-theme]` blocks of CSS custom props; `ThemeContext` persists explicit picks to localStorage `gcb.theme` (`src/theme/ThemeContext.tsx:13`, `:72-81`) and adopts the Event/Player default only when the User has not chosen (`:67-70`); `ThemeSwitcher.tsx` renders the chips and calls `setTheme` + `track('theme_change')` + `savePlayerTheme` (`src/components/ThemeSwitcher.tsx:16-19`).
- **Missing:** a verified WCAG AA contrast pass across all 8 Themes; an explicit switch-latency check.
- **Contradicts:** none.

## Files to create / modify

- `src/theme/themes.css` — contrast fixes if any Theme fails WCAG AA.
- `src/theme/themes.ts` — Theme metadata (`:10-19`), only if a token changes.
- `src/components/ThemeSwitcher.tsx` — the switcher (`:7-27`); verify < 5 s.

## Implementation notes

- Themes are cosmetic (glossary): Neon Playground is the default (`themes.ts:11`); switching must not alter play.
- Verify WCAG AA contrast for text and controls in each of the 8 `[data-theme]` blocks (`themes.css`).
- Persistence is already correct: only explicit picks persist (`ThemeContext.tsx:55-60`, `:74`); the async Event/Player default must not stomp a User's pick (`:67-70`) — keep that invariant.
- PRD non-goal: no Atlantis marks / branding / affiliation — the Theme names and emoji are the extent of the homage.

## Tests to add

- `src/theme/themes.test.ts` — every `ThemeId` has a `[data-theme]` block and passes an AA contrast assertion (layer: unit).
- `src/theme/ThemeContext.test.tsx` — an explicit pick persists to `gcb.theme`; the default does not auto-save (layer: RTL-jsdom).

## Acceptance criteria

- **Given** any of the 8 Themes **When** it is applied **Then** text and controls meet WCAG AA contrast.
- **Given** a Player picks a Theme **When** they reload **Then** the pick persists (localStorage `gcb.theme`) and is not overridden by the event default.
- **Given** a Player switches Themes **When** they tap a chip **Then** the change applies in < 5 s (PRD metric).
- [ ] All 8 Atlantis Themes pass AA contrast.
- [ ] Neon Playground remains the default.
- [ ] No Atlantis marks / affiliation (PRD non-goal).

## Definition of Done

- [ ] Spec `specs/w1-themes.md` created/updated **with a matching test** (checker `scripts/ci/check_spec_test_alignment` matches basename → a test under `tests/**` or `src/**/*.test.*`; design-only specs use frontmatter `tested: false` + `reason:`)
- [ ] `npm run typecheck` · `npm test` · `npm run build` green locally (no `lint` script; app tests are not CI-run — record in the commit `Verified:` trailer)
- [ ] Repo gates pass: `repo_lint` (incl. spec↔test alignment), `md-prose-wrap`, review-policy label gate
- [ ] Conventional commits + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`; PR body `Closes #<this issue>`; authored `nathanjohnpayne`, reviewed under `nathanpayne-{agent}`; driven to merge
- [ ] Board discipline per `docs/agents/ticket-workflow.md` (claim → In progress; PR → In review; merge → Done)

## Dependencies

- Depends on #__NUM_w0-app-shell__ — the shell hosts the Theme switcher and the `data-theme` root.
