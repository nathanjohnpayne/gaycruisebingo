**Track:** doubts · **Phase:** 0 · **Wave:** 2 · **Size:** M · **ADR(s):** 0001, 0002
**Epic:** #__NUM_epic-social__
**Labels:** agent-action, track:doubts, phase-0, wave-2, size:M

## Context & scope
A Doubt is one Player publicly asking another to back up a specific marked Prompt — "pics or it didn't happen." It is how the group applies the honor-system "the group is the verification" principle in-app (ADR 0001): social pressure, never a gate. This is greenfield. The Doubt count shows on the marked Square and on that Prompt's Tally entry; attaching a Proof satisfies the Doubt. A Doubt never blocks a Mark, never unmarks a Square, and never touches the Leaderboard — it only turns up the social heat.

## Current state (scaffold)
- **Exists:** The Tally (from #__NUM_w2-tally__) carries the attributed per-Prompt marks a Doubt targets; the Square renders in `src/components/Board.tsx`; Proof capture (from #__NUM_w2-proof-capture__) is the satisfying action; `track()` fires GA4 events (`src/analytics.ts:5-11`).
- **Missing:** No Doubt anywhere — no `doubts` collection, no `DoubtDoc` type (`src/types.ts` has none), no create/subscribe data layer, no Doubt count on the Square or the Tally entry, and no `demand_proof` GA4 event (present events top out at `share_click`; `demand_proof` + `install_pwa` are the two missing vs the PRD's 12).
- **Contradicts:** none — greenfield addition.

## Files to create / modify
- `src/types.ts` — consume `DoubtDoc` (owned by #__NUM_w0-type-contract__).
- `src/data/paths.ts` — add a `doubtsCol` / `doubtRef` converter ref under `events/{EVENT_ID}/doubts`.
- `src/data/doubts.ts` (new) — `raiseDoubt({ fromUid, targetUid, itemId, cellIndex })`; a Doubt is satisfied when a Proof is attached to the marked Square.
- `src/hooks/useData.ts` — a `useDoubts(itemId)` subscription for the per-Prompt Doubt count.
- `src/components/Board.tsx` — a "pics or it didn't happen" affordance on a marked Square + the Doubt count.
- `src/analytics.ts` — call sites fire the new `demand_proof` GA4 event when a Doubt is raised.
- `firestore.rules` — the `doubts` rules block ships in #__NUM_w0-firestore-rules__; this ticket assumes it.

## Implementation notes
- A Doubt is social pressure, never a gate (ADR 0001): raising or leaving a Doubt unsatisfied must not prevent, revoke, or discount the Mark. Do not add any Claim-like pending state.
- The Doubt count surfaces in two places: on the marked Square and on the Prompt's Tally entry (ADR 0002) — both read the same per-Prompt Doubt total.
- Attaching a Proof (from #__NUM_w2-proof-capture__) to the doubted Square satisfies its Doubts; model "satisfied" so the count can reflect open vs answered without ever blocking play.
- Fire `demand_proof` via `track()` (`src/analytics.ts`) when a Doubt is raised — this closes one of the two GA4 events missing against the PRD's 12-event set.
- Keep glossary language in the UI: this is a Doubt, not a callout, demand, or challenge.

## Tests to add
- `tests/rules/doubts.test.ts` — a signed-in Player may raise a Doubt against another Player's marked Prompt; a Doubt write never mutates the target's `boards/{uid}` or `players/{uid}` (layer: rules-emulator).
- `src/data/doubts.test.ts` — `raiseDoubt` writes a Doubt and fires `demand_proof`; attaching a Proof marks the Doubt satisfied (layer: unit).
- `src/components/Board.test.tsx` — the Doubt count renders on the marked Square (layer: RTL-jsdom).

## Acceptance criteria
- **Given** a Player marked a Prompt **When** another Player doubts it **Then** the Doubt count increments on that Square and on the Prompt's Tally entry, and a `demand_proof` event fires.
- **Given** an open Doubt **When** the marker attaches a Proof **Then** the Doubt is satisfied and the Mark is unchanged (social pressure, never a gate — ADR 0001).
- [ ] A Doubt never blocks, unmarks, or discounts a Mark, and never touches the Leaderboard.
- [ ] The `demand_proof` GA4 event fires on raise.
- [ ] UI copy uses "Doubt" / "pics or it didn't happen", not callout / demand / challenge.

## Definition of Done
- [ ] Spec `specs/w2-doubts.md` created/updated **with a matching test** (checker `scripts/ci/check_spec_test_alignment` matches basename → a test under `tests/**` or `src/**/*.test.*`; design-only specs use frontmatter `tested: false` + `reason:`)
- [ ] `npm run typecheck` · `npm test` · `npm run build` green locally (no `lint` script; app tests are not CI-run — record in the commit `Verified:` trailer)
- [ ] Repo gates pass: `repo_lint` (incl. spec↔test alignment), `md-prose-wrap`, review-policy label gate
- [ ] Conventional commits + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`; PR body `Closes #<this issue>`; authored `nathanjohnpayne`, reviewed under `nathanpayne-{agent}`; driven to merge
- [ ] Board discipline per `docs/agents/ticket-workflow.md` (claim → In progress; PR → In review; merge → Done)

## Dependencies
- Depends on #__NUM_w2-tally__ — the Doubt count shows on the Tally entry and targets the attributed per-Prompt Mark.
- Depends on #__NUM_w2-proof-capture__ — attaching a Proof is the action that satisfies a Doubt.
