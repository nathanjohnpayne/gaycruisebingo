**Track:** icons · **Phase:** 1.5 · **Wave:** 3 · **Size:** M · **Cut line:** nice-to-have (post-sailaway)

## Context & scope

Implements `daily-cards-spec.md` § "Iconography — Lucide": the rule is Lucide for chrome and controls, emoji for camp. Adopts `lucide-react` for navigation, buttons, and system affordances across the tab bar, the More menu, the Claim sheet, and board/feed chrome, while theme emojis, party names, Moments, toast lead-ins, and Feed source badges stay emoji.

## Current state

The app has no icon library today: `TabBar.tsx` renders plain text labels only (`src/components/TabBar.tsx:16-18`, `{tab.label}`, no icon). `Nav.tsx`'s sign-out button is a hand-inlined raw `<svg>` with a Lucide-shaped `log-out` glyph (`Nav.tsx:30-34`) — the one place in the app that already approximates Lucide, by hand, without the package. `BugReport.tsx` similarly hand-inlines a bug-shaped `<svg>` (`BugReport.tsx:10-16`), and `AcceptableUse.tsx` hand-inlines a decorative guidelines glyph (`AcceptableUse.tsx:73-78`). No `lucide-react` dependency exists in `package.json`. Theme emoji (`ThemeMeta.emoji`, `src/theme/themes.ts`) and the Feed's per-kind Moment emoji (`MOMENT_COPY`, `src/components/ProofFeed.tsx:20-24`) are unaffected by this ticket — they are already emoji and stay that way.

## Files to create / modify

- `package.json` (modify) — add `lucide-react` dependency.
- `src/components/TabBar.tsx` (modify) — tab bar icons: Card `grid-3x3`, Feed `radio`, Ranks `trophy`, More = the player's avatar (already wired by `#__NUM_d15-tab-contract__`; this ticket's only touch here is the other three tabs' Lucide icons and the signed-out `ellipsis` fallback if not already in place).
- `src/components/More.tsx` (modify) — row icons: theme `palette`, text size `a-large-small`, schedule `calendar-days`, suggest `lightbulb`, how to play `graduation-cap`, install `download`, bug `bug`, 18+ `shield-alert`, admin `wrench`, sign out `log-out`, row chevrons `chevron-right`.
- claim sheet component (modify — wherever the proof-type segmented control and dismiss live) — segments `camera` / `mic` / `pen-line`, Take photo `camera`, Library `images`, dismiss `x`.
- `src/components/Board.tsx` / day-switcher chrome (modify) — locked day `lock`, audio playback `play`.
- `src/components/Nav.tsx` (modify) — replace the hand-inlined sign-out `<svg>` (`:30-34`) with `lucide-react`'s `LogOut`, formalizing the existing habit per spec.
- `src/components/BugReport.tsx` (modify) — replace the hand-inlined bug `<svg>` (`:10-16`) with `lucide-react`'s `Bug`.

## Implementation notes

- The rule, verbatim: **Lucide for chrome and controls, emoji for camp.** Navigation, buttons, and system affordances use Lucide; theme emoji, party names, Moments, toast lead-ins, and Feed source badges stay emoji — that is the app's personality, and `ThemeMeta.emoji` already owns it. Do not touch `themes.ts`, `ProofFeed.tsx`'s `MOMENT_COPY`, or any Feed source badge (🖼️/📷/🎙️/✍️) in this ticket.
- `Nav.tsx`'s sign-out button already hand-inlines the `log-out` glyph — this formalizes an existing habit into the real package rather than introducing a new visual language.
- The More tab's move from `⋯` to the player's avatar is deliberate (per spec: identity stays glanceable after the top bar hands profile to the menu); `ellipsis` is its signed-out fallback, not its default — that wiring belongs to `#__NUM_d15-tab-contract__` / `#__NUM_d15-more-menu__`, this ticket only supplies the `ellipsis` icon itself if it is not already in place.
- Device/browser-chrome icons (`signal`, `battery-full`, `chevron-left`/`chevron-right`, `share`, `copy`) are wireframes-only per spec — they do not correspond to real app UI and are out of scope here.
- Doubts stay the count badge; `eye` is available as an optional glyph per spec but is not required.
- New dependency: `lucide-react`. Keep icon usage tree-shakeable (import each icon by name, not the whole library).

## Tests to add

- `src/components/TabBar.test.tsx` (extend, RTL-jsdom) — Card/Feed/Ranks render their Lucide icon (assert by `data-lucide`/`aria-hidden` svg presence or a test id), not emoji or plain text.
- `src/components/More.test.tsx` (extend) — each row's icon matches the spec's mapping table.
- a grep-based lint/test (optional, e.g. in an existing repo-hygiene test) asserting no new hand-inlined `<svg>` duplicates a `lucide-react` icon this ticket introduces.

## Acceptance criteria

- **Given** the tab bar **When** it renders **Then** Card/Feed/Ranks show `grid-3x3`/`radio`/`trophy` and More shows the player's avatar (or `ellipsis` when signed out).
- **Given** the More menu **When** it renders **Then** every row's icon matches the spec's mapping table.
- **Given** the claim sheet **When** it renders **Then** its segments and Take-photo/Library/dismiss controls use the specified Lucide icons.
- **Given** a Theme, Moment, toast, or Feed source badge **When** it renders **Then** it is still emoji, unchanged by this ticket.
- [ ] `lucide-react` added as a dependency.
- [ ] Tab bar, More menu, claim sheet, and board/feed chrome icons match the spec table.
- [ ] `Nav.tsx` sign-out and `BugReport.tsx` bug icon migrated off hand-inlined SVG.
- [ ] No emoji surface (theme, Moment, toast lead-in, Feed source badge) was converted to Lucide.

## Definition of Done

- Spec file under `specs/d15-icons-lucide.md` (or a sensible feature name) WITH a matching test (spec↔test alignment CI).
- `npm run typecheck` + `npm test` + `npm run build` green; md-prose-wrap clean.
- PR body `Closes #<this issue>`; authored `nathanjohnpayne`, driven through REVIEW_POLICY.md to merge.
- Board discipline per `docs/agents/ticket-workflow.md`.

## Dependencies

Depends on #__NUM_d15-tab-contract__, #__NUM_d15-more-menu__, #__NUM_d15-day-switcher__ — this ticket re-skins chrome those tickets already built; it cannot start until the tab bar, More menu, and day switcher exist to receive icons.

## Recommended agent

claude-sonnet-5 @ medium — a mechanical but wide-surface pass (many small files, one new dependency); low design risk since the mapping table is fully specified, but touches enough files to need a careful sweep for stragglers.
