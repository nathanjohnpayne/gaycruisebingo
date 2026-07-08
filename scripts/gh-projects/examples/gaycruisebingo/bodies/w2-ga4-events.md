**Track:** analytics · **Phase:** 0 · **Wave:** 2 · **Size:** M · **ADR(s):** —
**Epic:** #__NUM_epic-moderation__
**Labels:** agent-action, track:analytics, phase-0, wave-2, size:M

## Context & scope
`analytics.ts` exposes a single `track(name, params?)` GA4 `logEvent` wrapper that never throws (`analytics.ts:5-11`), and 10 of the PRD's 12 events already fire at their call sites. This ticket wires the two missing events — `demand_proof` (raised on a Doubt) and `install_pwa` — verifies all 12 in GA4 DebugView, and adds a lightweight consent notice for the 18+ audience. This ticket OWNS the analytics event catalog: the hot `src/analytics.ts` surface and the set of `track()` call sites. Other tickets add their event through this one to avoid colliding on the catalog. No ADR governs analytics directly.

## Current state (scaffold)
- **Exists:** `analytics.ts:5` `track()` (GA4 `logEvent`, guarded; `firebase.ts` lazily inits `analytics` via `isSupported()`). 10 events fire today: `login` (`auth/AuthContext.tsx:41`), `join_event` (`App.tsx:20`), `add_item` (`ItemPool.tsx:16`), `report_item` (`ItemPool.tsx:59`, `ProofFeed.tsx:35`), `mark_square` (`Board.tsx:62`), `attach_proof` (`ProofSheet.tsx:86`), `bingo` (`Board.tsx:63`), `blackout` (`Board.tsx:39`), `theme_change` (`ThemeSwitcher.tsx:18`), `share_click` (`Celebration.tsx:22`).
- **Missing:** `demand_proof` (the Doubt event) and `install_pwa`; a consent notice; a DebugView pass over the full set.
- **Contradicts:** none.

## Files to create / modify
- `src/analytics.ts` — stays the single `track()` entry; add a short catalog comment enumerating the 12 events as the source of truth.
- `src/components/ConsentNotice.tsx` (new) — a lightweight 18+ analytics consent notice, mounted at a stable point from #__NUM_w0-app-shell__.
- the `demand_proof` call site lands in the Doubt flow (owned by #__NUM_w2-doubts__); the `install_pwa` call site lands in the install-prompt flow (owned by #__NUM_w1-pwa__) — both call this ticket's `track()`.

## Implementation notes
- The 12 PRD events: `login`, `join_event`, `add_item`, `report_item`, `mark_square`, `attach_proof`, `demand_proof`, `bingo`, `blackout`, `theme_change`, `share_click`, `install_pwa`. Wire the two missing ones through the existing `track()`; do NOT add a second analytics path.
- `demand_proof`: fired when a Player raises a Doubt ("pics or it didn't happen"). The domain concept is a Doubt; the event name stays `demand_proof` to match the PRD catalog. Sequence with #__NUM_w2-doubts__ so the call site exists.
- `install_pwa`: fired when the PWA install prompt is accepted. Sequence with #__NUM_w1-pwa__.
- Verify all 12 distinct event names arriving in GA4 DebugView; record the check in the commit `Verified:` trailer (app analytics is not CI-run).
- Consent notice: lightweight, aimed at the 18+ audience; no full consent-management platform. Copy/region is an open decision tracked in #__NUM_x-decisions-needed__.
- `track()` already swallows errors and no-ops when `analytics` is unsupported — preserve that.

## Tests to add
- `src/analytics.test.ts` — `track('demand_proof', …)` and `track('install_pwa')` call `logEvent` with the right name; `track()` never throws when `analytics` is null (layer: unit).
- `src/components/ConsentNotice.test.tsx` — the notice renders, dismisses, and the dismissal persists (layer: RTL-jsdom).

## Acceptance criteria
- **Given** the app with GA4 DebugView open **When** a Player signs in, joins, adds a Prompt, marks, doubts, proofs, gets BINGO/Blackout, switches Theme, shares, and installs the PWA **Then** all 12 catalogued events arrive (ties to the PRD share goal: `share_click` supports ≥ 25 share events).
- [ ] `demand_proof` + `install_pwa` fire through `track()` (10 → 12).
- [ ] All 12 verified in DebugView; recorded in the `Verified:` trailer.
- [ ] A lightweight 18+ consent notice is present and dismissible.
- [ ] No second analytics code path introduced.

## Definition of Done
- [ ] Spec `specs/w2-ga4-events.md` created/updated **with a matching test** (checker `scripts/ci/check_spec_test_alignment` matches basename → a test under `tests/**` or `src/**/*.test.*`; design-only specs use frontmatter `tested: false` + `reason:`)
- [ ] `npm run typecheck` · `npm test` · `npm run build` green locally (no `lint` script; app tests are not CI-run — record in the commit `Verified:` trailer)
- [ ] Repo gates pass: `repo_lint` (incl. spec↔test alignment), `md-prose-wrap`, review-policy label gate
- [ ] Conventional commits + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`; PR body `Closes #<this issue>`; authored `nathanjohnpayne`, reviewed under `nathanpayne-{agent}`; driven to merge
- [ ] Board discipline per `docs/agents/ticket-workflow.md` (claim → In progress; PR → In review; merge → Done)

## Dependencies
- Depends on #__NUM_w0-app-shell__ — stable mount points to host the consent notice and the install-prompt surface.
- Coordinates with #__NUM_w2-doubts__ (the `demand_proof` call site) and #__NUM_w1-pwa__ (the `install_pwa` call site); consent copy/region is an open decision in #__NUM_x-decisions-needed__.
