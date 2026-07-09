**Track:** launch · **Phase:** 2 (hardening) · **Wave:** 4 · **Size:** M · **ADR(s):** 0001, 0003
**Epic:** #__NUM_epic-phase2-hardening__
**Labels:** agent-action, track:launch, phase-2, hardening, wave-4, size:M, needs-phase-4

## Context & scope

Deliver the PRD's **"remember the winners"** goal end state: *"a durable Leaderboard and a 'first to BINGO' hall of fame persist for the sailing and **archive afterward**."* After the cruise (embark July 15, disembark July 24, 2026), freeze the Event to a read-only archived state and preserve a permanent record of the final Leaderboard and the First-to-BINGO hall of fame. The data model is already event-scoped (`events/{eventId}`, [ADR 0003](../../../../docs/adr/0003-pool-is-pre-cruise.md)), so archiving is a per-Event state transition, not a migration. Honor-system-consistent ([ADR 0001](../../../../docs/adr/0001-honor-system-trust-model.md)): it snapshots the client-authoritative final standings — it does not recompute or "verify" them.

## Current state (scaffold)

- **Exists:** event-scoped schema (`events/{eventId}/…`); `EventDoc.status` is already typed `'active' | 'archived'` (`src/types.ts:28`) but nothing ever sets `'archived'` or reacts to it; client-side Leaderboard sort with a First-to-BINGO pin (`components/Leaderboard.tsx`, `comparePlayers` / `sortPlayers`); First-to-BINGO Moment in the Feed (#__NUM_w2-feed-moments__).
- **Missing:** no admin action flips an Event to `archived`; `firestore.rules` does not deny gameplay writes on an archived Event; no frozen snapshot of the final standings and no archived read-only view.
- **Contradicts:** none — `status:'archived'` is a typed-but-dead state today.

## Files to create / modify

- `src/types.ts` — add `EventDoc.archivedAt?` (and an optional frozen final-standings snapshot); `status:'archived'` already exists (`:28`).
- `firestore.rules` — when an Event is `archived`, deny further Marks/Proofs/Doubts/Prompt writes (read-only); admin-only archive toggle.
- `components/Leaderboard.tsx` (+ a small archive surface) — render the final standings + First-to-BINGO hall of fame from the frozen snapshot when the Event is archived.
- `data/admin.ts` / an admin action (or `scripts/seed.mjs`) — the archive/freeze operation.

## Implementation notes

- Archiving freezes an Event; a future cruise is a **new** Event doc (ADR 0003, `x-multi-event-schema` #__NUM_x-multi-event-schema__) — never reset or reuse the archived Event.
- Snapshot the final Leaderboard + First-to-BINGO so the record survives even if per-player stats are later touched (honor-system: snapshot, don't recompute — ADR 0001).
- Keep the archived view shareable via the existing on-device Share Cards (#__NUM_w2-share-cards__) — no public crawler pages (ADR 0005).
- Admin-only toggle; a Player never archives the Event.

## Tests to add

- `tests/rules/*.test.ts` — writes to an archived Event's Marks/Proofs are denied; reads still allowed; only an admin can flip `status:'archived'` (layer: rules-emulator).
- component — an archived Event renders the frozen final standings + hall of fame read-only (layer: RTL-jsdom).

## Acceptance criteria

- **Given** an admin archives the Event after the sailing **When** any Player tries to Mark/Proof **Then** the write is denied and the app shows the read-only final standings + First-to-BINGO hall of fame.
- **Given** an archived Event **When** it is opened later **Then** the final Leaderboard + hall of fame persist unchanged.
- [ ] Event has an archived/read-only state with `archivedAt`; admin-only toggle
- [ ] Rules deny gameplay writes on an archived Event
- [ ] Final Leaderboard + First-to-BINGO snapshot persists and renders read-only
- [ ] A future cruise is a new Event, not a reset (ADR 0003)

## Definition of Done

- [ ] Spec `specs/post-sailing-archive.md` created/updated **with a matching test** (checker `scripts/ci/check_spec_test_alignment` matches basename → a test under `tests/**` or `src/**/*.test.*`; design-only specs use frontmatter `tested: false` + `reason:`)
- [ ] `npm run typecheck` · `npm test` · `npm run build` green locally (no `lint` script; app tests are not CI-run — record in the commit `Verified:` trailer)
- [ ] Repo gates pass: `repo_lint` (incl. spec↔test alignment), `md-prose-wrap`, review-policy label gate
- [ ] Conventional commits + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`; PR body `Closes #<this issue>`; authored `nathanjohnpayne`, reviewed under `nathanpayne-{agent}`; driven to merge
- [ ] Board discipline per `docs/agents/ticket-workflow.md` (claim → In progress; PR → In review; merge → Done)

## Dependencies

- Depends on #__NUM_w2-leaderboard__ — the Leaderboard whose final standings are archived.
- Depends on #__NUM_w2-feed-moments__ — the First-to-BINGO Moment feeding the hall of fame.
- Related to #__NUM_x-multi-event-schema__ — multi-event schema readiness (a new cruise = a new Event).
