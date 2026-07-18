# Ticket: Admin console redesign—hub-and-detail IA, sticky dismissal, Easy mix slider

**Track:** day-ui / admin · **Phase:** 1.5 · **Size:** L (one PR; UI-only) · **Labels:** phase-1.5 · **Project:** #7

**Recommended agent:** `claude-sonnet-5 @ high` (large but mechanical component split; no data-layer changes). `claude-opus-4-8 @ medium` if you want extra care on the nav/routing.

**Mockups (read first): plans/daily-cards-wireframes.html**— [#frame-admin-hub](daily-cards-wireframes.html#frame-admin-hub) (the hub), [#frame-admin-queue](daily-cards-wireframes.html#frame-admin-queue) (merged review inbox), [#frame-admin-settings](daily-cards-wireframes.html#frame-admin-settings) (all dials + the Easy mix slider), [#frame-admin-schedule](daily-cards-wireframes.html#frame-admin-schedule) (days with their actions attached). Frames carry their annotations.

## Problem

`Admin.tsx` (~1,100 lines, one component) has grown into three tabs where the Moderation tab alone stacks six unrelated sections (report queue, banned players, Proof & Claims, default theme, pending claims, the full prompt-pool manager + curated add). The sheet is taller than a phone viewport and the only dismissal is a CLOSE button at the very bottom— disjointed, hard to navigate, hard to leave.

## Design (match the mockups)

**IA—hub and detail.** `/more/admin` renders a compact hub of five section cards with live badges; each opens a detail surface. Mapping from the built sections:

| Built today (tab · section) | New home |
|---|---|
| Moderation · Report queue | **Review queue** (merged inbox) |
| Approvals tab | **Review queue** |
| Moderation · Pending claims | **Review queue** (renders only in admin-confirmed mode) |
| Moderation · Proof & Claims (claim mode, photo source, EXIF, AI screen, auto-hide) | **Game settings** |
| Moderation · Easy mix (0/25/50 step buttons) | **Game settings**—as a slider (below) |
| Moderation · Default theme | **Game settings** › Appearance |
| Schedule tab (rows, tonight editor, Unlock now, Re-snapshot) | **Schedule**—unchanged content; the Unlock-now/Re-snapshot controls anchor to their day's row |
| Moderation · Prompts (+ curated add form) | **Prompt pool** |
| Moderation · Banned players | **Players** |

**Navigation & dismissal contract (every admin surface).** Sticky header, always visible: `‹ Admin` back on the left (details only), section title, **Done** on the right—Done closes the entire admin from any depth. Backdrop tap and swipe-down also dismiss. Content scrolls under the header (`position: sticky`, safe-area padded). Routes are real (`/more/admin/queue|settings|schedule|pool|players`) so the browser/PWA back button walks detail → hub → More. Hub badges: Review queue shows reports + approvals + claims total; Prompt pool shows pending count.

**Easy mix slider.** Replaces the shipped 0/25/50 step buttons: range 0–100% with detents at 0/25/50/75/100, value bubble translating ratio to squares ("50% · 12 of 24 squares"), sublabel "Applies from the next 8:00 unlock · reshuffles inherit it." Commits `settings.easyMixRatio` on release (optimistic, like the other settings writes); keyboard/ a11y per native `<input type=range>` semantics (step 5, aria-valuetext with the squares phrasing).

## Constraints

- **UI-only.** No data-layer, rules, functions, or settings-shape changes—every write path stays exactly as built. This is a re-housing, not a rebuild.
- Split `Admin.tsx` into per-section components (AdminHub, ReviewQueue, GameSettings, SchedulePanel, PromptPool, PlayersPanel) + one AdminSheet chrome component owning the sticky header/dismissal contract. Keep the existing hooks/subscriptions; the merged Review queue may reuse the three existing subscriptions as-is.
- The schedule-correction and easy-mix tickets may land around the same time—coordinate on Admin.tsx (this ticket should land LAST or rebase over them; their admin touchpoints are small).

## Tests

- RTL: hub renders five cards with correct badge math; card → detail → back → hub; Done from a detail closes admin entirely; sticky header present on every surface; Review queue shows claims section only in admin-confirmed mode; slider commits on release with the correct ratio and renders the squares bubble; Escape/backdrop dismisses.
- Playwright: hub + settings + queue screenshots at 393×852 (parity suite); a taller-than-viewport detail still shows Done without scrolling.
- No new rules/functions tests (nothing server-side changes).

## Acceptance criteria

- Given any admin surface on a phone-height viewport, Done is visible without scrolling and closes admin in one tap; backdrop and swipe-down do the same.
- Given the review inbox has 2 reports + 3 approvals + 2 claims, the hub badge reads 7 and the detail shows the three groups oldest-first with working actions.
- Given the slider set to 25% and released, `settings.easyMixRatio` is 0.25 and the bubble read "25% · 6 of 24 squares" while dragging.
- Given browser back from /more/admin/settings, I land on the hub, not the Card tab.
- Every control that exists in the built Admin today exists in exactly one new home (the mapping table above—nothing dropped, nothing duplicated).

## Definition of Done

specs/admin-console-ia.md + matching tests (alignment CI); typecheck/build/md-prose-wrap green; PR "Closes #<issue>" through REVIEW_POLICY.md; deployed; a phone-viewport walkthrough (hub → each detail → Done) screenshot set posted on the issue.
