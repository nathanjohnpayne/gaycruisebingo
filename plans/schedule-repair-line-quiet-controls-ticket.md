# Schedule: quiet the repair line's controls

**Track:** admin/UI · **Phase:** 0 · **Size:** XS · **Epic:** Daily Cards (admin console)
**Depends on:** `plans/schedule-recovery-strip-ticket.md` (the repair line itself — in flight; land this after it merges, on its merged class/markup structure).
**Refs:** `specs/admin-console-ia.md` § Schedule. Presentation-only — no callable, gating, or message-content change; ideally CSS-only.
**Target mockup:** `plans/daily-cards-wireframes.html` § `#frame-admin-schedule` — the two drawn states: pending (Valletta: anomaly + compact quiet button) and resolved (Palermo: "Missed the 8:00 unlock" with "Unlocked." as plain text where the button was).

## Problem

The repair line landed with its controls inheriting the app's primary button treatment: an all-caps, glowing, oversized pill (`RE-SNAPSHOT`, `UNLOCK NOW`), with the result ("Unlocked.") rendered as a second pill beside it. That gives a once-a-cruise admin repair the visual weight of a hero CTA — it dominates the row it's meant to sit quietly inside, and two pills side by side read as two competing actions. The line's *words* are the interface; the button is a small affordance at the end of it.

## Design (matches the mockup's two drawn states)

- **Button, quiet variant:** compact — roughly the repair line's own text size — sentence case ("Re-snapshot", "Unlock now"), hairline border (`var(--border)`), transparent background, no glow/box-shadow, no uppercase transform. Trailing position in the line, unchanged.
- **Result as text, not a pill:** the result/denial message ("Unlocked.", "Re-snapshotted with both pools.", "Denied — cards already dealt.") renders as plain inline text in the line — near-ink color, no border, no background — replacing (or following) the button. Long messages wrap; they never truncate or pill-ify.
- **Busy state** ("Unlocking…", "Re-snapshotting…") stays on the button label as today, in the quiet style.
- Anomaly text, icon, placement, sticky-mount behavior, and all message strings are unchanged from the in-flight ticket.

## Files to modify

- `src/index.css` — add the quiet variant scoped to the repair line's container (whatever class the in-flight PR landed; its accessible handle is the `role="group"` / `aria-label="Day N repair"` element). Override the global button styling inside it: font-size ≈ line text, `text-transform: none`, `border: 1px solid var(--border)`, `background: none`, `box-shadow: none`, reduced padding. Style the result message as plain text (no border/background). Do not touch the global `.btn`.
- `src/components/admin/SchedulePanel.tsx` — only if the result currently renders with a pill class: swap it to a plain text element. No logic changes.
- `specs/admin-console-ia.md` § Schedule — one line noting the repair-line controls use the quiet variant (sentence case, hairline, no glow) with the result as plain text; matching test per spec↔test alignment.
- `tests/e2e/d15-mockup-parity.spec.ts` (+ `-snapshots/`) — refresh the schedule frame's baseline if it is in the parity walk.

## Tests

- Accessible names unchanged and sentence case in the DOM: `Re-snapshot`, `Unlock now` (uppercase must not be baked into the markup; if the current build renders literal all-caps text, fix the label, not just the CSS).
- Result message still renders within the row after a click (existing assertions keep passing); it is not wrapped in the pill class.
- No new behavior: eligibility, callables, and message strings byte-identical.

## Acceptance criteria

- **Given** an eligible Day, **then** its repair-line button renders compact, sentence case, hairline-bordered, with no glow — visually subordinate to the theme dropdown above it.
- **Given** a completed action, **then** the result reads as plain text in the line (no pill), and long denials wrap without truncation.
- **Given** the built Schedule, **then** it matches both drawn states in `plans/daily-cards-wireframes.html` § `#frame-admin-schedule`.
- No behavioral change.

## Definition of Done

- Spec line + matching test (spec↔test alignment); `npm run typecheck` · `npm test` · `npm run build` green; parity baseline refreshed if walked.
- Repo gates pass (`repo_lint`, `md-prose-wrap`, review-policy label gate); conventional commits + `Closes #`; authored `nathanjohnpayne`, reviewed under `nathanpayne-{agent}`; board discipline per `docs/agents/ticket-workflow.md`.

## Decisions (surface, do not silently override)

- [ ] **Result emphasis.** Mockup shows the result at near-ink (slightly brighter than the dim anomaly text). Confirm, or prefer `var(--accent)` for success only.
- [ ] **Button vs. text-link.** The quiet variant keeps a hairline-bordered button (clearer tap target on a phone). A borderless text-link is even quieter but weakens the affordance — flag if preferred.
