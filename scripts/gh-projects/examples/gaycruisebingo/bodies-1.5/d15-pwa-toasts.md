**Track:** pwa · **Phase:** 1.5 · **Wave:** 3 · **Size:** M · **Cut line:** nice-to-have (post-sailaway)

## Context & scope

Implements `daily-cards-spec.md` § "Install nudge and update banner": presentation and timing changes only, over the existing `InstallPrompt` (w1-pwa, #30) and `UpdatePrompt` (#178) mechanics, which are kept as-is. Covers the install nudge's restyle to a quiet toast, its trigger moving from app-load to after the Player's first Mark, new copy for both banners, the update banner deferring while a claim sheet is open, and a stacking rule when both toasts want to show at once.

## Current state

`InstallPrompt.tsx` renders unconditionally on mount (gated only by `isStandalone`/`isDismissed`, `src/components/InstallPrompt.tsx:48-89`) with copy "Install Gay Cruise Bingo for one-tap, full-screen access at sea." (`:120`) and toggles `install-prompt-visible` on `<body>` while up (`:82-87`). `UpdatePrompt.tsx` shows "A new version of Gay Cruise Bingo is ready." (`:57`) whenever `needRefresh` flips, with no awareness of whether a claim sheet is open, and toggles `update-prompt-visible` on `<body>` independently (`:46-51`). Both mount as siblings at the top of `main.tsx` (`main.tsx:70-77`), each managing its own visibility with no coordination between them — if both want to show, both render, uncoordinated. Neither component knows about Marks, claim-sheet state, or each other.

## Files to create / modify

- `src/components/InstallPrompt.tsx` (modify) — trigger moves from mount/app-load to after the Player's first Mark; new copy; restyle to the quiet-toast treatment.
- `src/components/UpdatePrompt.tsx` (modify) — new copy; defer rendering while a claim sheet is open.
- `src/index.css` (modify) — toast-stacking layout: both anchor above the tab bar, reserve bottom clearance via the existing body-class mechanism, never jump the board.
- a small shared toast-priority coordinator (new, e.g. `src/hooks/useToastStack.ts`) — enforces "urgent (update) outranks invitational (install), max two visible."
- `src/components/Board.tsx` or wherever the claim sheet's open state lives (modify) — expose that state (or an event) so `UpdatePrompt` can defer.
- `src/analytics.ts` (modify only if the first-Mark trigger needs a new hook point; otherwise reuse the existing `mark_square` track call as the trigger signal).

## Implementation notes

- Both components' underlying mechanics are UNCHANGED and FROZEN by this ticket: `beforeinstallprompt` capture, `appinstalled`, the iOS Share hint, `install_pwa` tracking (`InstallPrompt.tsx`); `registerType: 'prompt'`, `updateServiceWorker(true)`, the 60s `registration.update()` poll, offline-tick skip (`UpdatePrompt.tsx`). Only presentation and timing change.
- Install nudge: restyle to a quiet toast above the tab bar. Trigger moves from app-load to **after the Player's first Mark** — someone who just marked a Square has decided the app is worth keeping. Copy: "Full screen, works offline at sea." ✕ dismisses forever (`gcb.install.dismissedAt`, unchanged key); the affordance persists in More → Install the app (`#__NUM_d15-more-menu__`'s row), which is what lets this toast afford to be shy.
- Update banner: copy becomes "A fresh build just docked—your marks are safe" (the word "reload" reads as data loss to players; this reassures). The banner defers while a claim sheet is open so it never interrupts a proof mid-capture — check the open claim-sheet state before rendering, not just `needRefresh`.
- Toast stacking: both toasts anchor above the tab bar and reserve `.app` bottom clearance via the existing body-class mechanism (`install-prompt-visible`, `update-prompt-visible`) so the board never jumps. When both want to show: newest on top, urgent (update) outranks invitational (install), never more than two visible — a third-comer (there are only two toast sources today, but design for the rule, not the current count) waits for a slot.
- Platform split for the install path is unchanged: Android/Chromium gets the captured one-tap `beforeinstallprompt`; iOS Safari (no such event) gets the Share → Add to Home Screen walkthrough.

## Tests to add

- `src/components/InstallPrompt.test.tsx` (extend, RTL-jsdom) — the toast does not appear on mount; it appears after a `mark_square`-equivalent signal fires; dismiss still writes `gcb.install.dismissedAt` and hides it forever.
- `src/components/UpdatePrompt.test.tsx` (extend, RTL-jsdom) — `needRefresh=true` while a claim sheet is open renders nothing; it renders once the sheet closes.
- a toast-stacking test — both toasts pending renders update on top, install below, and never more than two at once.

## Acceptance criteria

- **Given** a Player who has not yet marked a Square **When** the app loads **Then** no install toast appears.
- **Given** a Player marks their first Square **When** the app is install-eligible **Then** the install toast appears with the new copy.
- **Given** a claim sheet is open **When** a new build is available **Then** the update banner waits until the sheet closes.
- **Given** both toasts are eligible to show **When** they would coincide **Then** the update banner ranks above the install toast and at most two toasts are visible.
- [ ] Install nudge trigger moved to after first Mark.
- [ ] Both banners' copy updated per spec.
- [ ] Update banner defers while a claim sheet is open.
- [ ] Stacking rule enforced (urgent over invitational, max two visible).

## Definition of Done

- Spec file under `specs/d15-pwa-toasts.md` (or a sensible feature name) WITH a matching test (spec↔test alignment CI).
- `npm run typecheck` + `npm test` + `npm run build` green; md-prose-wrap clean.
- PR body `Closes #<this issue>`; authored `nathanjohnpayne`, driven through REVIEW_POLICY.md to merge.
- Board discipline per `docs/agents/ticket-workflow.md`.

## Dependencies

Depends on #__NUM_d15-tab-contract__ (the tab bar these toasts anchor above), #__NUM_d15-more-menu__ (the persistent Install-the-app row the toast's dismiss defers to).

## Recommended agent

claude-sonnet-5 @ medium — presentation/timing-only changes over two already-working, well-tested components; the main risk is coordinating two independent visibility toggles without touching their frozen install/update mechanics.
