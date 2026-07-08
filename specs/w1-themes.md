# 8 Atlantis Themes: switcher + persistence + WCAG contrast (w1-themes)

Feature: eight cosmetic party-inspired Themes a Player can switch between, applied instantly to the whole app via a `[data-theme]` attribute on `<html>`, with the explicit pick persisted locally and Neon Playground as the default. Themes are a look, never a mechanic — switching never alters play. The Theme names and emoji are the entire homage to Atlantis Events; no marks, branding, or affiliation appear anywhere.

## Contract

- `src/theme/themes.ts` exports `THEMES: ThemeMeta[]`, one entry per `ThemeId` (`src/types.ts`), in a fixed order with `neon-playground` first. Each entry is `{ id, label, emoji }` — no Atlantis trademark or affiliation text in any `label`.
- `src/theme/themes.css` defines one `[data-theme='<id>']` block per `ThemeId`, each setting the same ten custom properties (`--bg`, `--panel`, `--ink`, `--dim`, `--primary`, `--secondary`, `--accent`, `--cell`, `--border`, `--shadow`) that the rest of the app's CSS (`src/index.css`) reads exclusively — no component hardcodes a color, so every Theme reskins the full UI.
- `src/theme/ThemeContext.tsx` (`ThemeProvider`/`useTheme`) owns the active Theme: it applies the id to `document.documentElement.dataset.theme` synchronously on every change (`< 5s` PRD switch-latency metric), defaults to `neon-playground` absent any signal, and persists only an explicit `setTheme` call to `localStorage['gcb.theme']`. The async event/player default that arrives later from Firestore is adopted only when the user has not made an explicit pick — it must never overwrite a saved choice.
- `src/components/ThemeSwitcher.tsx` renders one chip per `THEMES` entry and calls `setTheme` on tap; persistence and DOM application both flow through `ThemeContext`, so the switcher itself carries no persistence logic of its own.

## WCAG AA contrast contract

Every `[data-theme]` block meets WCAG 2.1 AA across the foreground/background pairs actually rendered by `src/index.css`. Every one of `--ink`/`--dim`/`--primary`/`--secondary`/`--accent` is used as a real text fill somewhere in `src/index.css` — not only as a border or glow — so every pair meets the 4.5:1 normal-text minimum (1.4.3 Contrast (Minimum)); a looser 3:1 non-text/UI-component floor (1.4.11) does not apply to any of them because none is text-free:

- `--ink`/`--dim` against the surfaces they render on: `--ink` on `--bg`, `--panel`, `--cell`; `--dim` on `--bg`, `--panel`.
- `--primary` on `--bg` (`.brand b`; `.bingo-head span`, the B-I-N-G-O header) and on `--panel` (`.row .rank`, leaderboard rank numbers).
- `--secondary` on `--bg` (`.count b`).
- `--accent` on `--cell` (`.cell.free` text) and on `--panel` (`.badge`).

Border- and glow-only call sites that reuse these same custom-property values (`.btn.primary` / `.chip.active` / `.seg-btn.on` borders, `.btn` border, `.cell.free` / `.row.leader` borders) are covered for free since they share the checked fg/bg pair — no separate weaker check is needed.

## Acceptance criteria

- **Given** any of the 8 Themes, **when** it is applied, **then** every pair above meets the WCAG AA 4.5:1 threshold.
- **Given** a Player picks a Theme, **when** they reload, **then** the pick persists (`localStorage['gcb.theme']`) and is not overridden by the event/player default.
- **Given** a Player switches Themes, **when** they tap a chip, **then** `document.documentElement.dataset.theme` reflects the new Theme well under the 5s PRD budget.
- **Given** no saved pick and no resolved event/player default yet, **when** the app first mounts, **then** Neon Playground (`neon-playground`) is the active Theme.
- **Given** any Theme's metadata, **when** its label is read, **then** it names no Atlantis mark, trademark, or affiliation.

## Test coverage

`src/theme/w1-themes.test.tsx` (Vitest, jsdom project):

- Parses `themes.css` at test time (no hand-transcribed color table) and asserts every `ThemeId` has a `[data-theme]` block, then computes the WCAG relative-luminance contrast ratio for each pair above per Theme.
- Exercises `ThemeProvider`/`useTheme` through a minimal probe component: an explicit pick persists to `gcb.theme` and applies to `<html data-theme>` within the 5s budget; the initial default is never auto-saved; an async-arriving `defaultTheme` prop change (simulating the Firestore event/player default resolving after mount) is adopted when no pick was saved, and is ignored once a pick exists.
- Asserts `THEMES[0].id === 'neon-playground'` and that no `label` matches an Atlantis mark or a trademark glyph.
