**Track:** foundation · **Phase:** 0 · **Wave:** 0 · **Size:** M · **ADR(s):** —
**Epic:** #__NUM_epic-foundation__
**Labels:** agent-action, track:foundation, phase-0, wave-0, size:M

## Context & scope
Formalize `App.tsx`'s routes and convert `Nav.tsx` from a top brand bar into a bottom tab-bar (Card / Feed / Ranks / Prompts / Admin-if-admin) as STABLE mount points, so every Wave-1+ feature ticket fills its own tab without editing `App.tsx` or `Nav.tsx`. Bottom placement serves the PRD phone-native goal (one-handed reachability) and must be iOS safe-area aware. This is the HOT-file owner of `App.tsx` + `Nav.tsx`; freezing the route paths and tab set here is what keeps the parallel Wave-1 tickets from colliding.

## Current state (scaffold)
- **Exists:** `App.tsx` routes `/`→Board, `/feed`→ProofFeed, `/leaderboard`→Leaderboard, `/items`→ItemPool, `/admin`→Admin, `*`→`/`; `Nav.tsx` renders brand + tabs (Card/Feed/Ranks/Prompts/Admin-if-admin) as a TOP bar; `index.css` (~500 lines); `viewport-fit=cover` already in `index.html`.
- **Missing:** bottom tab-bar layout, `env(safe-area-inset-*)` insets, one-handed reachability treatment, a documented stable-mount-point contract.
- **Contradicts:** none — no ADR constrains nav placement; this is a UX/architecture formalization.

## Files to create / modify
- `src/App.tsx` — formalize the route table as stable mount points (Card/Feed/Ranks/Prompts/Admin-if-admin); keep the `*`→`/` fallback.
- `src/components/Nav.tsx` — convert the top brand bar into a bottom tab-bar; show the Admin tab only when the Player is an Admin.
- `src/index.css` — bottom tab-bar layout + `env(safe-area-inset-bottom)` padding + one-handed reachability.

## Implementation notes
- The point is STABLE mount points: `w1-board-deal-join` fills the Card tab, `w1-prompt-pool` fills Prompts, and `w1-themes` / `w1-pwa` / `w2-ga4-events` hang off the shell — all WITHOUT touching `App.tsx`/`Nav.tsx`. Keep the paths + tab set frozen.
- The Admin tab is gated on the signed-in Player being an Admin of the Event (the only privileged role).
- iOS safe area: `viewport-fit=cover` is already present; add `padding-bottom: env(safe-area-inset-bottom)` so the tab-bar clears the home indicator.
- Do NOT change the `joinAndDeal` error-swallowing at `App.tsx:21` — surfacing those errors is `w1-auth-google`'s scope. This ticket only formalizes routes + nav chrome.
- HOT-file owner of `App.tsx` + `Nav.tsx`.

## Tests to add
- `src/**/*.test.*` — Nav renders the five tabs; the Admin tab is hidden for a non-Admin Player and shown for an Admin (layer: RTL-jsdom).
- `src/**/*.test.*` — each route path mounts its expected component and an unknown path redirects to `/` (layer: RTL-jsdom).

## Acceptance criteria
- **Given** a signed-in non-Admin Player **When** the shell renders **Then** the bottom tab-bar shows Card/Feed/Ranks/Prompts and hides Admin.
- **Given** an Admin **When** the shell renders **Then** the Admin tab appears.
- **Given** `viewport-fit=cover` on a notched iOS device **When** the shell renders **Then** the tab-bar sits above the home indicator via `env(safe-area-inset-bottom)` (PRD one-handed / phone-native).
- [ ] `Nav.tsx` is a bottom tab-bar with Card/Feed/Ranks/Prompts/Admin-if-admin.
- [ ] Route table frozen as stable mount points; `*`→`/` fallback kept.
- [ ] iOS safe-area insets applied; one-handed reachable.
- [ ] `App.tsx:21` error-swallowing left untouched (owned by `w1-auth-google`).

## Definition of Done
- [ ] Spec `specs/w0-app-shell.md` created/updated **with a matching test** (checker `scripts/ci/check_spec_test_alignment` matches basename → a test under `tests/**` or `src/**/*.test.*`; design-only specs use frontmatter `tested: false` + `reason:`)
- [ ] `npm run typecheck` · `npm test` · `npm run build` green locally (no `lint` script; app tests are not CI-run — record in the commit `Verified:` trailer)
- [ ] Repo gates pass: `repo_lint` (incl. spec↔test alignment), `md-prose-wrap`, review-policy label gate
- [ ] Conventional commits + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`; PR body `Closes #<this issue>`; authored `nathanjohnpayne`, reviewed under `nathanpayne-{agent}`; driven to merge
- [ ] Board discipline per `docs/agents/ticket-workflow.md` (claim → In progress; PR → In review; merge → Done)

## Dependencies
- Depends on: none.
- Blocks #__NUM_w1-auth-google__, #__NUM_w1-board-deal-join__ — feature tabs mount on the frozen shell.
- Blocks #__NUM_w1-prompt-pool__, #__NUM_w1-themes__, #__NUM_w1-pwa__ — same.
- Blocks #__NUM_w2-ga4-events__ — analytics hooks hang off the shell.
