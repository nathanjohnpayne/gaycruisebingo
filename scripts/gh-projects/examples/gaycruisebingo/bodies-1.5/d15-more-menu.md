**Track:** more-menu · **Phase:** 1.5 · **Wave:** 1 · **Size:** L · **Cut line:** must-have

## Context & scope

Implements `daily-cards-spec.md` § "More menu (⋯ tab)". `#__NUM_d15-tab-contract__` (Wave 0) revises the bottom bar to Card · Feed · Ranks · More and gives the More tab the player's avatar as its icon — that is a thin mount-point revision only. This ticket is what actually builds the More tab's content: profile, theme (with the new "Auto — match the day" default), a Play section (schedule, suggest a square, how to play, install), a Support section (bug report, 18+ advisory), an admin-only Admin row badged with the pending-approvals count, sign out, and a version footer. Building this menu is also what lets Prompts and Admin leave the tab bar per the same spec section — they become panels reachable from here instead of their own routes.

## Current state

Before `#__NUM_d15-tab-contract__`, `Nav.tsx` renders the top bar with brand + `ProfileEditor` (the avatar itself is the profile-edit trigger) + a raw inlined sign-out SVG button (`src/components/Nav.tsx:24-36`), and mounts `ThemeSwitcher` directly below the top bar (`Nav.tsx:37`); `tabs.ts` lists `card/feed/ranks/prompts/admin` (`src/components/tabs.ts:29-35`); `App.tsx`'s `pages` record maps `prompts` → `<ItemPool/>` and `admin` → `<Admin/>` as their own routed tabs (`src/App.tsx:29-36`). `BugReport.tsx` is a self-contained trigger+sheet mounted fixed-position in `App.tsx` (`App.tsx:47`, bottom-right, opposite the Guidelines control). `ConsentNotice`, `InstallPrompt`, `UpdatePrompt` mount outside the auth tree in `main.tsx` (`main.tsx:70-77`); `AcceptableUse` mounts conditionally in `ThemedApp` for every route except Card (`main.tsx:60`). After `#__NUM_d15-tab-contract__` lands (this ticket's actual starting point): `tabs.ts` exposes `more` in place of `prompts`/`admin`; `Nav.tsx` has dropped the `ProfileEditor` avatar and sign-out button but **still mounts `ThemeSwitcher`** exactly where it does today — that relocation is this ticket's job, not `d15-tab-contract`'s; `App.tsx`'s `pages.more` points at an **interim placeholder** `More.tsx` that `d15-tab-contract` created solely to carry the relocated `ProfileEditor` avatar button and sign-out button (so neither affordance regresses) — this ticket **replaces that placeholder's content wholesale** with the full menu below, rather than creating `More.tsx` from scratch. `ItemPool` and `Admin` are no longer routed tabs as of `d15-tab-contract`; this ticket is what actually imports and mounts them inside `More`.

## Files to create / modify

- `src/components/More.tsx` (modify — replaces `d15-tab-contract`'s interim placeholder wholesale) — the full More tab content: renders the ordered menu below, hosting `ItemPool` and `Admin` as sub-panels (sheet or nested view) instead of top-level routes.
- `src/components/Nav.tsx` (modify) — remove the `ThemeSwitcher` mount (`Nav.tsx:37`); this is the one piece of Nav's Phase 1.5 simplification `d15-tab-contract` deliberately left for this ticket.
- `src/components/ThemeSwitcher.tsx` (modify) — add the "Auto — match the day" option; relocate its mount from `Nav.tsx` into `More.tsx`.
- `src/theme/ThemeContext.tsx` (modify) — persistence semantics for the new auto mode: never auto-saved; an explicit pick still saves and still overrides auto, unchanged from today.
- `src/components/ProfileEditor.tsx` (modify only if the trigger markup needs adapting from `d15-tab-contract`'s interim avatar-button rendering to a full "Profile card" row inside a menu list; the sheet itself is unchanged).
- `src/components/BugReport.tsx`, `src/components/AcceptableUse.tsx` (modify trigger markup only, to read as menu rows instead of fixed-position/standalone buttons; sheet content unchanged).
- `src/components/Admin.tsx` (modify) — expose a pending-item count for the badge.
- `src/hooks/useData.ts` (modify) — a small read (e.g. `usePendingItemCount`) over `ItemDoc.status === 'pending'` for the Admin row's badge.

## Implementation notes

- Menu order, top to bottom, per spec:
  1. **Profile card** — avatar, name, @handle; tap opens `ProfileEditor`'s existing sheet. Replaces the top-bar avatar.
  2. **Theme** — `ThemeSwitcher` relocates here, gaining a new default: **"Auto — match the day"** (board chrome already follows the viewed Day; this makes the whole app follow *today's* Day), with the existing manual pick as the override. Persistence semantics unchanged: explicit picks save, auto never auto-saves.
  3. **Play** — Cruise schedule (new: a read-only list of the ten Days — port, party, unlock time; no editing here, editing is `#__NUM_d15-admin-schedule__`), Suggest a square (mounts `ItemPool` as-is; the "goes to admin review" caption change lands with `#__NUM_d15-approvals__`, not here), How to play (ships now as a static rendering of the spec's three "How this works" beats; the actual first-open-overlay replay wiring is `#__NUM_d15-coach-overlay__`, which depends on this ticket), Install the app (a persistent row reflecting installability — hidden once standalone, otherwise the existing install/iOS-hint copy; `#__NUM_d15-pwa-toasts__` refines this into the full post-dismiss affordance).
  4. **Support** — Report a bug (mounts `BugReport`'s existing trigger+sheet), 18+ advisory & acceptable use (mounts `AcceptableUse`'s existing trigger+sheet).
  5. **Admin** (admins only) — reuse the `isAdmin` check `Nav.tsx` computes today (`event?.admins?.includes(user.uid)`); one row into the Admin console, badged with the pending-approvals count. The count is 0/hidden until `#__NUM_d15-approvals__` starts writing `status:'pending'` items — that is expected, not broken, since the `ItemDoc.status` field itself ships with `#__NUM_d15-schema-contract__` in Wave 0, before this ticket starts.
  6. **Sign out** — last, visually quiet (dashed/dim styling); reuses `signOutUser()` from `useAuth()`.
  7. Version footer: build, sailing, dates — presentational only.
- Text size is its own ticket, `#__NUM_d15-text-size__` — do not add a text-size row here; leave room in the Theme/Play section for it to land.
- `Nav.tsx`'s removal of the avatar/sign-out mounts already happened in `#__NUM_d15-tab-contract__`; this ticket's only remaining `Nav.tsx` touch is dropping the `ThemeSwitcher` mount once it has a new home in `More.tsx` — do not re-touch anything else in `Nav.tsx`.

## Tests to add

- `src/components/More.test.tsx` (RTL-jsdom) — every menu row renders in spec order; the Admin row is absent for a non-admin Player and present (with a count badge) for an admin.
- `src/theme/ThemeContext.test.tsx` (extend) — selecting "Auto — match the day" does not write `localStorage['gcb.theme']`; an explicit pick still does and overrides auto.
- `src/theme/w1-themes.test.tsx` (extend, auto-pickup pattern) — the auto option renders alongside every `THEMES` entry without breaking the fixed-order contract.

## Acceptance criteria

- **Given** a signed-in Player **When** they open More **Then** they see Profile, Theme, Play (schedule / suggest / how-to-play / install), Support (bug / 18+), Sign out, and a version footer, in that order.
- **Given** a non-admin Player **When** they open More **Then** no Admin row renders.
- **Given** an admin with 3 pending items **When** they open More **Then** the Admin row shows a "3" badge.
- **Given** a Player picks "Auto — match the day" **When** they reload **Then** no explicit theme is persisted and the app theme follows today's Day.
- [ ] `More.tsx` renders the full menu in spec order.
- [ ] Theme row's Auto default is wired and never auto-saved.
- [ ] Admin row is admin-gated and badge-counted.
- [ ] `ItemPool`, `Admin`, `BugReport`, `AcceptableUse`, `ProfileEditor` are all reachable from More.

## Definition of Done

- Spec file under `specs/d15-more-menu.md` (or a sensible feature name) WITH a matching test (spec↔test alignment CI).
- `npm run typecheck` + `npm test` + `npm run build` green; md-prose-wrap clean.
- PR body `Closes #<this issue>`; authored `nathanjohnpayne`, driven through REVIEW_POLICY.md to merge.
- Board discipline per `docs/agents/ticket-workflow.md`.

## Dependencies

Depends on #__NUM_d15-tab-contract__ — More needs the revised tab bar and mount point before it has anywhere to live.
Blocks #__NUM_d15-coach-overlay__ (How-to-play replay hook), #__NUM_d15-text-size__ (its row lands in this menu), #__NUM_d15-pwa-toasts__ (Install row refinement).

## Recommended agent

claude-sonnet-5 @ high — a UI-heavy Wave-1 ticket that relocates several existing components' mount points; needs care not to regress `ProfileEditor`/`BugReport`/`AcceptableUse`'s existing focus-trap and a11y behavior while moving their triggers into a menu list.
