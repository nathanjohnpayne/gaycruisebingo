# 8 Atlantis Themes: switcher + persistence + WCAG contrast (w1-themes)

Feature: eight cosmetic party-inspired Themes a Player can switch between, applied instantly to the whole app via a `[data-theme]` attribute on `<html>`, with the explicit pick persisted locally and Neon Playground as the default. Themes are a look, never a mechanic — switching never alters play. The Theme names and emoji are the entire homage to Atlantis Events; no marks, branding, or affiliation appear anywhere.

## Contract

- `src/theme/themes.ts` exports `THEMES: ThemeMeta[]`, one entry per `ThemeId` (`src/types.ts`), in a fixed order with `neon-playground` first. Each entry is `{ id, label, emoji }` — no Atlantis trademark or affiliation text in any `label`.
- `src/theme/themes.css` defines one `[data-theme='<id>']` block per `ThemeId`, each setting eleven custom properties (`--bg`, `--panel`, `--ink`, `--dim`, `--primary`, `--secondary`, `--accent`, `--cell`, `--border`, `--shadow`, `--on-gradient`) that `src/index.css` reads for the audited foreground/background pairs the WCAG AA contrast contract below covers, so every Theme reskins those surfaces. This contract does not claim `src/index.css` reads theme tokens exclusively or that no component hardcodes a color: `.proofbtn`'s `#fff` badge fill over a fixed photo-scrim is a deliberate, documented exemption (theme-independent by design, not a theme-token surface). `.cell.marked` (plus its `::after` checkmark and its border), `.celebrate .big`, and `.signin h1` used to fill text/border with a hardcoded `#fff` regardless of the active Theme — a real, pre-existing defect that predated this ticket (`index.css` was unchanged by this PR; issue #29 didn't list `index.css` as a file to modify). That follow-up (issue #72) is now fixed: see `specs/theme-on-color-contrast.md`.
- `src/theme/ThemeContext.tsx` (`ThemeProvider`/`useTheme`) owns the active Theme: it applies the id to `document.documentElement.dataset.theme` synchronously on every change (`< 5s` PRD switch-latency metric), defaults to `neon-playground` absent any signal, and persists only an explicit `setTheme` call to `localStorage['gcb.theme']`. The async event/player default that arrives later from Firestore is adopted only when the user has not made an explicit pick — it must never overwrite a saved choice.
- `src/components/ThemeSwitcher.tsx` renders one chip per `THEMES` entry and calls `setTheme` on tap, which drives `ThemeContext`'s `localStorage['gcb.theme']` persistence and DOM application (above). For a signed-in Player it additionally calls `savePlayerTheme` (`src/data/api.ts`) directly, a second and independent persistence path the switcher owns itself: it writes the pick to that Player's Firestore row so the choice follows them across devices. `src/main.tsx`'s `ThemedApp` reads that saved value back out as `player?.theme`, the first candidate in the `defaultTheme` it passes to `ThemeProvider` (`player?.theme ?? event?.defaultTheme ?? 'neon-playground'`) — the same async event/player default `ThemeContext` (above) adopts only when the user has no local pick.

## WCAG AA contrast contract

Every `[data-theme]` block meets WCAG 2.1 AA across the foreground/background token pairs `src/index.css` assigns as literal `color` values (the flat custom-property value, not whatever else may be layered underneath at paint time — see `specs/theme-on-color-contrast.md` for the composited-surface checks). Every one of `--ink`/`--dim`/`--accent` is used as a real text fill somewhere in `src/index.css` — not only as a border or glow — so every pair meets the 4.5:1 normal-text minimum (1.4.3 Contrast (Minimum)); a looser 3:1 non-text/UI-component floor (1.4.11) does not apply to any of them because none is text-free:

- `--ink`/`--dim` against the surfaces they render on: `--ink` on `--bg`, `--panel`, `--cell`; `--dim` on `--bg`, `--panel`.
- `--primary` on `--panel` (`.row .rank`, leaderboard rank numbers).
- `--accent` on `--cell` (`.cell.free` text) and on `--panel` (`.badge`).

Border- and glow-only call sites that reuse these same custom-property values (`.btn.primary` / `.chip.active` / `.seg-btn.on` borders, `.btn` border, `.cell.free` / `.row.leader` borders) are covered for free since they share the checked fg/bg pair — no separate weaker check is needed.

**Retired: "gradient-tinted backdrops are not checked."** This contract used to check `--primary`/`--secondary` against the flat `--bg` token only and explicitly did not check the real composited backdrop `body`'s two radial-gradient tints produce behind `.brand b` / `.bingo-head span` (the B-I-N-G-O header) / `.count b` — a documented bound, since those three used `--primary`/`--secondary` as literal text fills directly on that tinted surface. Issue #72 (`specs/theme-on-color-contrast.md`) retired this bound: all three now fill with `--ink` instead (decoupled from the tint they used to sit on and self-referentially fail against), checked against the composited backdrop at its actual maximum tint strength in every Theme. `--primary`/`--secondary` are no longer used as literal text fills directly on `--bg` anywhere in `src/index.css`, so those pairs are dropped from the table above; `--primary` still backs `.row .rank`'s text on `--panel` (unaffected by the tint, kept above) and various border/box-shadow-only call sites at their own looser floor.

## Acceptance criteria

- **Given** any of the 8 Themes, **when** it is applied, **then** every pair above meets the WCAG AA 4.5:1 threshold.
- **Given** a Player picks a Theme, **when** they reload, **then** the pick persists (`localStorage['gcb.theme']`) and is not overridden by the event/player default.
- **Given** a Player switches Themes, **when** they tap a chip, **then** `document.documentElement.dataset.theme` reflects the new Theme well under the 5s PRD budget.
- **Given** no saved pick and no resolved event/player default yet, **when** the app first mounts, **then** Neon Playground (`neon-playground`) is the active Theme.
- **Given** any Theme's metadata, **when** its label is read, **then** it names no Atlantis mark, trademark, or affiliation.

## Test coverage

`src/theme/w1-themes.test.tsx` (Vitest, jsdom project):

- Parses `themes.css` at test time (no hand-transcribed color table) and asserts every `ThemeId` has a `[data-theme]` block, then computes the WCAG relative-luminance contrast ratio for each pair above per Theme. The luminance/contrast math and the `themes.css` parser live in `src/theme/contrast.ts` (extracted by issue #72) and are shared with `src/theme/theme-on-color-contrast.test.tsx` below.
- Exercises `ThemeProvider`/`useTheme` through a minimal probe component: an explicit pick persists to `gcb.theme` and applies to `<html data-theme>` within the 5s budget; the initial default is never auto-saved; an async-arriving `defaultTheme` prop change (simulating the Firestore event/player default resolving after mount) is adopted when no pick was saved, and is ignored once a pick exists.
- Asserts `THEMES[0].id === 'neon-playground'` and that no `label` matches an Atlantis mark or a trademark glyph.

`src/theme/theme-on-color-contrast.test.tsx` covers the composited-surface checks this contract's "Retired" note above references (`--on-gradient` vs both `.cell.marked` gradient endpoints, `--ink` vs the composited `body`/`.celebrate`/`.share-card` backdrops, the no-hardcoded-`#fff` source pin) — see `specs/theme-on-color-contrast.md`.
