**Track:** foundation · **Phase:** 1.5 · **Wave:** 0 · **Size:** M · **Cut line:** must-have

## Context & scope
Revise the frozen bottom-tab-bar contract in `src/components/tabs.ts` from Card · Feed · Ranks · Prompts · Admin to Card · Feed · Ranks · More, implementing `daily-cards-spec.md` § "More menu (⋯ tab)" (the mount-point move only — the menu's actual contents are #__NUM_d15-more-menu__) and § "Header" (the top bar's simplification). `tabs.ts` is the FROZEN mount-point contract; this ticket is its deliberate, one-time revision point for Phase 1.5, same as the file's own header comment describes for Wave-1+ tickets normally NOT touching it. HOT owner: `src/components/tabs.ts`, `src/components/Nav.tsx`, `src/App.tsx`. Keep this a THIN mount-point revision — do not build out the More menu's content here; that is #__NUM_d15-more-menu__'s job, which depends on this ticket for the mount point to exist.

## Current state
- `src/components/tabs.ts` — `TabId = 'card' | 'feed' | 'ranks' | 'prompts' | 'admin'` (`:15`); `TABS` (`:29-35`) has five entries including `prompts` (`/items`) and `admin` (`/admin`, `adminOnly: true`); `visibleTabs(isAdmin)` (`:41-43`) filters `admin` out for non-admins.
- `src/components/Nav.tsx` — renders a top `.nav` bar with brand text, `<ProfileEditor />` (the avatar-as-edit-affordance, `:28`), and an inlined sign-out icon button (`:29-35`); then a persistent `<ThemeSwitcher />` bar (`:37`); then `<TabBar isAdmin={isAdmin} />` (`:38`).
- `src/components/TabBar.tsx` — pure/presentational, takes `isAdmin: boolean` as its only prop specifically so it renders without Firebase-backed hooks (its own doc comment); maps `visibleTabs(isAdmin)` to `NavLink`s rendering `tab.label` as plain text — no icon rendering of any kind today.
- `src/App.tsx` — `pages: Record<TabId, ReactElement>` (`:34-44`) maps `card`→`Board`/`DealError`, `feed`→`ProofFeed`, `ranks`→`Leaderboard`, `prompts`→`ItemPool`, `admin`→`Admin`; `Routes` (`:51-55`) renders one `Route` per `TABS` entry plus a catch-all to `FALLBACK_PATH`.
- **Being revised:** `TabId`/`TABS` drop `prompts`/`admin` as top-level tabs and add `more`; `Nav.tsx` loses the avatar and sign-out button (they relocate into the new More tab's content); `App.tsx`'s `pages` map drops `prompts`/`admin` as ROUTED pages — `ItemPool` and `Admin` become components mounted inside More rather than routed pages (per spec: "Prompts and Admin leave it and mount inside More").
- **Explicitly NOT touched here** (left exactly as today, to keep this ticket thin): the persistent `<ThemeSwitcher />` bar in `Nav.tsx` stays mounted where it is — the spec's "Theme relocates to More" is #__NUM_d15-more-menu__'s change, not this ticket's; the live "today's port/theme" text in the new two-line header is placeholder-only here (no `EventDoc.days[]` data wiring) — #__NUM_d15-day-switcher__ (which depends on this ticket AND #__NUM_d15-schema-contract__) fills it with real data, which is why this ticket has no dependency on the schema ticket.

## Files to create / modify
- `src/components/tabs.ts` (modify, HOT owner, frozen contract — this is its deliberate revision point) — `TabId` → `'card' | 'feed' | 'ranks' | 'more'`; `TABS` → four entries (Card `/`, Feed `/feed`, Ranks `/leaderboard`, More `/more`); drop `adminOnly`/`prompts`/`admin` — admin visibility inside More is #__NUM_d15-more-menu__'s concern (an in-menu badge/row, not a tab-level gate).
- `src/components/Nav.tsx` (modify) — remove the `<ProfileEditor />` avatar button and the sign-out button from the top `.nav` bar; add a two-stacked-line header slot next to the brand (placeholder content only — see Implementation notes) for "today's port/theme"; leave `<ThemeSwitcher />` and `<TabBar>` mounts otherwise unchanged.
- `src/components/TabBar.tsx` (modify) — accept an optional `morePhotoURL: string | null` prop (keeping the component's Firebase-free, presentational contract — `Nav.tsx` supplies the value from its own `useAuth()`); render the More tab's `NavLink` content as an avatar image (reusing the `Avatar` component's rendering approach) when `morePhotoURL` is set, falling back to an ellipsis glyph when signed out — per spec: "More tab icon = player avatar (ellipsis fallback signed-out)."
- `src/components/More.tsx` (new, interim placeholder — #__NUM_d15-more-menu__ replaces this file's content wholesale) — a minimal page rendering exactly what `Nav.tsx` used to: the `<ProfileEditor />` avatar button and the sign-out button, so neither affordance regresses while the full menu is still Wave 1.
- `src/App.tsx` (modify) — `pages: Record<TabId, ReactElement>` → `card`/`feed`/`ranks`/`more` only (`more` → the new `More.tsx`); `ItemPool`/`Admin` imports and their `Route`s are removed from the TABS-driven route table (they become components other tickets mount directly, not routed pages).

## Implementation notes
- **Thin mount-point revision** (spec, verbatim): "Keep it a thin mount-point revision; the More menu contents are d15-more-menu." Every row inside More (profile card, Theme, Text size, Play/Support sections, Admin link, sign out, version footer) is out of scope here — this ticket's `More.tsx` is deliberately minimal and gets fully replaced by #__NUM_d15-more-menu__.
- **Header simplification** (spec § "Header"): "The top bar simplifies to exactly this — the avatar... and the sign-out button relocate to the More menu, so the brand and the day's identity own the header." This ticket removes the avatar/sign-out from `Nav.tsx` and reserves the two-line header slot; it does NOT wire live port/theme text (that needs `EventDoc.days[]`, which this ticket does not depend on) — render a static placeholder (or omit the second line entirely) and let #__NUM_d15-day-switcher__ fill it in.
- **More tab icon = player avatar, ellipsis fallback signed-out** (spec § "Iconography," clarified): "the More tab's move from ⋯ to the avatar is deliberate... `ellipsis` is its signed-out fallback, not its default." `TabBar.tsx` stays presentational/testable without Firebase hooks — it receives the resolved photo URL as a prop rather than calling `useAuth()` itself, same pattern the file's existing `isAdmin` prop already establishes.
- **ThemeSwitcher stays mounted in `Nav.tsx` for this ticket** — its relocation into More (with the new "Auto — match the day" default) is #__NUM_d15-more-menu__'s change; do not move or remove it here, to keep this ticket's diff to the tab set and the top identity bar only.
- **Prompts and Admin leave the bar and mount inside More** (spec, verbatim). This ticket only removes them as ROUTED, tab-driven pages; it does not delete `ItemPool.tsx`/`Admin.tsx` or change their internals — #__NUM_d15-more-menu__ imports and mounts them directly inside `More.tsx`.

## Tests to add
- `src/components/d15-tab-contract.test.tsx` (new, RTL/jsdom) — `TABS` has exactly 4 entries with ids `['card','feed','ranks','more']` in that order (frozen-contract regression test, same spirit as the file's own "do not reorder" comment).
- `src/components/d15-tab-contract.test.tsx` — `TabBar` renders the More tab's `NavLink` as an avatar `<img>` when `morePhotoURL` is set, and as a fallback glyph when it is `null` (layer: RTL jsdom).
- `src/App.test.*` (extend existing app-shell test, if present, else new) — `pages` map has no `prompts`/`admin` keys and `Routes` renders no `/items`/`/admin` route (layer: RTL jsdom).

## Acceptance criteria
- **Given** the bottom tab bar **When** it renders **Then** it shows exactly Card, Feed, Ranks, More — no Prompts or Admin tab.
- **Given** a signed-in Player with a photo **When** the More tab renders **Then** its icon is that Player's avatar image; **given** a signed-out state, **then** it falls back to an ellipsis.
- **Given** the top `.nav` bar **When** it renders **Then** it shows only the brand + the two-line header slot — no avatar button, no sign-out button.
- [ ] `TabId`/`TABS` revised to `card`/`feed`/`ranks`/`more`.
- [ ] `Nav.tsx` strips avatar + sign-out; `More.tsx` (interim) carries them instead.
- [ ] `TabBar.tsx` renders the avatar-or-ellipsis More icon via a prop, staying Firebase-hook-free.
- [ ] `App.tsx`'s routed pages match the new `TabId` set exactly.

## Definition of Done
- [ ] Spec `specs/d15-tab-contract.md` created **with a matching test** (checker `scripts/ci/check_spec_test_alignment` matches basename → a test under `tests/**` or `src/**/*.test.*`; design-only specs use frontmatter `tested: false` + `reason:`)
- [ ] `npm run typecheck` · `npm test` · `npm run build` green; `md-prose-wrap` clean
- [ ] PR body `Closes #<this issue>`; authored `nathanjohnpayne`, driven through `REVIEW_POLICY.md` to merge
- [ ] Board discipline per `docs/agents/ticket-workflow.md` (claim → In progress; PR → In review; merge → Done)

## Dependencies
- Depends on: none.
- Blocks #__NUM_d15-day-switcher__ — fills the header's placeholder port/theme slot with live Day data.
- Blocks #__NUM_d15-more-menu__ — builds out the full menu inside the `More.tsx` mount point this ticket creates.
- Blocks #__NUM_d15-coach-overlay__, #__NUM_d15-pwa-toasts__, #__NUM_d15-icons-lucide__ — all assume the Card/Feed/Ranks/More tab set exists.

## Recommended agent
claude-opus-4-8@high — a HOT-file frozen-contract revision touched by nearly every later Wave-1+ ticket; get the mount points right once.
