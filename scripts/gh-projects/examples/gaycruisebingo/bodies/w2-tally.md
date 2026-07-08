**Track:** tally · **Phase:** 0 · **Wave:** 2 · **Size:** L · **ADR(s):** 0001, 0002
**Epic:** #__NUM_epic-social__
**Labels:** agent-action, track:tally, phase-0, wave-2, size:L

## Context & scope
The Tally is the product's core differentiator over the printed card: every Mark — proofed or not — publishes a public, attributed entry to its Prompt's Tally, so a Player can see who else "got" a given Prompt (ADR 0002). This is greenfield; nothing in the scaffold implements it, and it is embarkation-critical. A Square gains a count plus a tap-to-see-who list built from that Prompt's Tally. The Board's layout and progress stay private (ADR 0002), but the fact that you marked a given Prompt is public by design — there is no anonymity (ADR 0001, a single 18+ friend group).

## Current state (scaffold)
- **Exists:** `setMark` writes only the Player's own `boards/{uid}` cells + `players/{uid}` stats, transactionally (`src/data/api.ts:107-139`); it publishes nothing beyond the owner's Board. Converter refs live in `src/data/paths.ts` (all under `events/{EVENT_ID}/`); read hooks in `src/hooks/useData.ts`.
- **Missing:** No Tally at all — no `tally` collection, no `tally/{itemId}` write in `setMark`, no `TallyEntry`/`TallyDoc` type (`src/types.ts` has none), no Tally UI on the Square, no `useTally` hook, and no `tally` rules block (`firestore.rules` has none).
- **Contradicts:** none — the private-only Board write is a gap the ADRs fill, not a divergence.

## Files to create / modify
- `src/data/api.ts` — in `setMark`, add a `tally/{itemId}` marker write (uid + displayName) alongside the existing board/player writes, inside the same transaction.
- `src/data/paths.ts` — add `tallyCol` / `tallyEntryRef` converter refs under `events/{EVENT_ID}/tally`.
- `src/types.ts` — consume `TallyEntry` / `TallyDoc` (owned by #__NUM_w0-type-contract__).
- `src/hooks/useData.ts` — add a `useTally(itemId)` subscription for the count + tap-to-see-who list.
- `src/components/Board.tsx` — surface the Tally count on each marked Square + a tap-to-open who-list.
- `firestore.rules` — the `tally` rules block ships in #__NUM_w0-firestore-rules__; this ticket assumes it.

## Implementation notes
- Model the Tally as a per-Prompt marker list keyed by `itemId` (a `tally/{itemId}` doc/subcollection carrying each marker's uid + displayName + markedAt), so the count and the who-list read from one place; key each entry by the marker's uid so unmarking removes exactly that Player's entry.
- Attribution is mandatory: every entry carries uid + displayName (ADR 0002, no anonymity). Do not gate or hide it behind Claim Mode — a bare honor Mark still publishes to the Tally.
- A Mark toggles both directions: marking adds the Tally entry, unmarking removes it, mirroring `setMark`'s existing cell toggle so the Tally never drifts from the Board.
- The Tally is separate from the Feed: publishing to the Tally is not a Feed post, and a bare Mark still posts nothing to the Feed (ADR 0002).

## Tests to add
- `tests/rules/tally.test.ts` — a signed-in Player may write their own attributed Tally entry; a Mark publishes an entry with uid + displayName (layer: rules-emulator).
- `src/data/api.test.ts` — `setMark` writes a Tally entry on mark and removes it on unmark; the entry carries uid + displayName (layer: unit). (Tally correctness — PRD metric.)
- `src/hooks/useData.test.tsx` — `useTally` returns the count + who-list for a Prompt (layer: RTL-jsdom).

## Acceptance criteria
- **Given** a Player marks a Square **When** the write commits **Then** an attributed entry (uid + displayName) appears in that Prompt's Tally and the Square shows an incremented count (Tally correctness — PRD metric).
- **Given** a Prompt's Tally has entries **When** a Player taps the count **Then** the tap-to-see-who list names every Player who marked it — no anonymity (ADR 0002).
- [ ] Every Mark, proofed or not, publishes to the Tally; a bare Mark still posts nothing to the Feed.
- [ ] Unmarking removes the Player's own Tally entry.
- [ ] The Board's layout/progress stays private; only per-Prompt Tally membership is public.

## Definition of Done
- [ ] Spec `specs/w2-tally.md` created/updated **with a matching test** (checker `scripts/ci/check_spec_test_alignment` matches basename → a test under `tests/**` or `src/**/*.test.*`; design-only specs use frontmatter `tested: false` + `reason:`)
- [ ] `npm run typecheck` · `npm test` · `npm run build` green locally (no `lint` script; app tests are not CI-run — record in the commit `Verified:` trailer)
- [ ] Repo gates pass: `repo_lint` (incl. spec↔test alignment), `md-prose-wrap`, review-policy label gate
- [ ] Conventional commits + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`; PR body `Closes #<this issue>`; authored `nathanjohnpayne`, reviewed under `nathanpayne-{agent}`; driven to merge
- [ ] Board discipline per `docs/agents/ticket-workflow.md` (claim → In progress; PR → In review; merge → Done)

## Dependencies
- Depends on #__NUM_w1-board-mark-win__ — the Tally write extends the Wave-1 mark write set in `setMark`; sequence after it to avoid colliding on `src/data/api.ts`.
- Depends on #__NUM_w0-firestore-rules__ — the `tally` collection rules (self-writable, attributed) ship there.
- Depends on #__NUM_w0-type-contract__ — the `TallyEntry` / `TallyDoc` types are defined there.
- Blocks #__NUM_w2-doubts__
