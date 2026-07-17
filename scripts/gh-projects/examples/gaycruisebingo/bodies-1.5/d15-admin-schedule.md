**Track:** moderation · **Phase:** 1.5 · **Wave:** 3 · **Size:** M · **Cut line:** nice-to-have (post-sailaway)

## Context & scope

Implements `daily-cards-spec.md` § "Admin console" (the Schedule editor) and the admin-editability promise in § "Itinerary and schedule" ("the schedule stays admin-editable in the Admin console anyway"). The ten-Day mapping (`EventDoc.days[]`) is seeded once by `d15-tutorial-seed`, but party order can shift onboard and a future cruise needs its own mapping — this ticket gives admins a rows-per-Day editor for date, port, and theme, with the one write-time rule the spec asks for: a Day's theme is editable while it is still locked-future, and locked once that Day has unlocked.

## Current state

`EventDoc.days: DayDef[]` (`{ index, date, port, portEmoji, theme, pool, tutorial, unlockAt, freeText?, snapshotItemIds? }`) is added in `d15-schema-contract` and seeded by `d15-tutorial-seed`; nothing in `src/components/Admin.tsx` reads or writes it today. `Admin.tsx` has a "Default theme" section (`:313-326`) that writes the event-wide `defaultTheme` via `setEventTheme` (`src/data/admin.ts:37`) — a single global theme picker, not a per-Day schedule; this ticket does not remove or change that section, it adds a new, separate Schedule tab alongside the Approvals tab `d15-approvals` lands. No existing UI reads or writes `EventDoc.days[]` at all; this ticket is the first.

## Files to create / modify

- `src/components/Admin.tsx` (modify) — a new Schedule tab (alongside the Approvals tab from `d15-approvals`): ten rows, one per Day, each showing date + port (read-only display) and a theme `<select>`; the dropdown is disabled for a Day that is in the past or already unlocked (`unlockAt <= now`), enabled for any Day still in the future.
- `src/data/admin.ts` (modify) — add a `setDayTheme(dayIndex, theme)` write against `EventDoc.days[dayIndex].theme` (a targeted array-element update, not a whole-doc rewrite of `days`).
- `firestore.rules` (modify, HOT — coordinate with the `d15-firestore-rules` owner) — enforce the same lock server-side: an admin write to `events/{eventId}` that changes `days[i].theme` for a Day whose `unlockAt` has already passed is denied; changing a future Day's theme, or any other field, stays allowed.

## Implementation notes

The dropdown lock is a UI convenience only if unenforced server-side — this ticket pairs the client lock with a matching rules check so the guarantee ("changing an already-unlocked Day is disallowed") actually holds, not just a client courtesy. Changing a locked-**future** Day's theme is explicitly SAFE per the spec — the lock is one-directional (past/unlocked → frozen), not "the whole schedule is read-only after seed." Date and port are shown for context but are not required to be editable by this ticket — scope the write surface to `theme` only; do not build a full row-add/remove editor (`days[]` length is fixed at seed). **needs-phase-4** (protected path / keep PR small) — this ticket edits `firestore.rules`; keep the PR narrowly scoped to the Day-theme lock and coordinate with whoever last touched the rules file to avoid a stale-diff clash.

## Tests to add

- `src/components/Admin.test.tsx` (extend) — the Schedule tab renders ten rows; a future Day's theme dropdown is enabled and writes on change; a past/unlocked Day's dropdown is disabled (layer: RTL-jsdom).
- `tests/rules/d15-admin-schedule.test.ts` — an admin CAN change `days[i].theme` for a Day with a future `unlockAt`; an admin CANNOT change `days[i].theme` for a Day whose `unlockAt` has passed; a non-admin can never write `days[]` at all (layer: rules-emulator, time-gated against a fixed `request.time`).

## Acceptance criteria

- **Given** a Day whose `unlockAt` is in the future **When** an admin picks a different theme from its row's dropdown **Then** the write commits and the Day's `theme` updates.
- **Given** a Day whose `unlockAt` has passed **When** an admin views its row **Then** the theme dropdown is disabled, and a direct rules-bypassing write attempt is denied server-side too.
- **Given** the Schedule tab **When** it loads **Then** it shows exactly the ten seeded Days in order.
- [ ] The theme lock holds both client-side (disabled control) and server-side (rules).
- [ ] Editing a locked-future Day's theme never touches any other `EventDoc.days[]` entry or event field.

## Definition of Done

- Spec `specs/d15-admin-schedule.md` created with a matching test (spec↔test alignment CI).
- `npm run typecheck` + `npm test` + `npm run build` green; md-prose-wrap clean.
- PR body `Closes #<this issue>`; authored `nathanjohnpayne`, driven through REVIEW_POLICY.md to merge.
- Board discipline per `docs/agents/ticket-workflow.md`.

## Dependencies

- Depends on #__NUM_d15-schema-contract__ — the `EventDoc.days: DayDef[]` shape this ticket edits.
- Depends on #__NUM_d15-firestore-rules__ — the rules baseline this ticket's Day-theme lock extends.

## Recommended agent

claude-sonnet-5 @ high — small, well-scoped UI plus a single targeted rules addition, but the rules edit needs the same careful "resulting state, not diff" reasoning the existing `events/{eventId}` rule already uses.
