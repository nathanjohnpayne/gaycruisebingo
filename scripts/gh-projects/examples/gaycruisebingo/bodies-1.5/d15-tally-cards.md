**Track:** tally · **Phase:** 1.5 · **Wave:** 3 · **Size:** L · **Cut line:** nice-to-have (post-sailaway)

## Context & scope
Implements `daily-cards-spec.md` § "Tally Cards—bare marks reach the Feed". Today a bare Mark (no Proof) broadcasts nothing, so most play is invisible to the Feed — only Proofs and Moments show up. This ticket fixes that with zero player effort: the Feed renders one live Tally Card per `(Prompt, Day)` once anyone marks it, bumping toward the top as new Players get it (debounced), and dropping out when the Tally empties. It is the third stream merged into the Feed alongside Proofs and Moments.

## Current state
- The Tally is per-Prompt only, not per-`(Prompt, Day)`: `setMark` writes an attributed marker doc to `events/{EVENT_ID}/tally/{itemId}/markers/{uid}` (`src/data/api.ts:632-643`), and `useTally(itemId)` (`src/hooks/useData.ts:217-231`) derives `count`/who-list purely from that marker subcollection's size — the parent `tally/{itemId}` doc described by `TallyDoc` (`src/types.ts:156-160`) is never actually written today ("the aggregate parent tally/{itemId} doc is public-read but admin/Cloud-Function-maintained (Phase 1), so in Phase 0 the count is derived from this subcollection's size" — `useData.ts:36-38`). There is no `lastMarkedAt` anywhere and no per-Day scoping of the Tally.
- `useFeed` (`src/hooks/useData.ts:352-356`) merges exactly two streams — `useProofFeed` + `useMoments` — through the pure `mergeFeed` (`:337-343`), sorted newest-first by `createdAt`. There is no third `feedKind` for a Tally Card.
- `ProofFeed.tsx` renders `ProofCard` and `MomentCard` only (`src/components/ProofFeed.tsx:33-110`); there is no `TallyCard` component, no bump-debounce, and no `+Proof`/`🙋 Got it too` affordances.
- **Being revised (per `d15-schema-contract`)**: `TallyDoc`/`TallyEntry` gain `lastMarkedAt` and `dayIndex`, since the same `itemId` can now appear on different Players' Day Cards on different Days (no-repeat exclusion is per-Player, so two Players can each have the same Prompt on different Days) — the Tally must be keyed by `(itemId, dayIndex)`, not `itemId` alone, so "Lost passport" marked on Tuesday's card is a different Tally entry than Thursday's. This ticket wires the day-scoped path (coordinate the exact path shape with `d15-schema-contract`/`d15-dealing`, e.g. nesting markers under a day-scoped tally doc or a composite key) and the write/read paths that consume it.

## Files to create / modify
- `src/data/paths.ts` (modify) — day-scope the tally refs (`tallyMarkersCol(itemId)` → `tallyMarkersCol(itemId, dayIndex)` or equivalent), so a `(Prompt, Day)` pair addresses its own marker subcollection.
- `src/data/api.ts` (modify) — `setMark`'s marker write (`:632-643`) becomes day-scoped and, on mark, also bumps a `lastMarkedAt` timestamp readable by the Feed (either an explicit small write to the parent day-scoped tally doc in the same batch, or a derived `max(marker.markedAt)` read — pick one and document it in Implementation notes).
- `src/hooks/useData.ts` (modify) — `FeedEntry`/`mergeFeed` gain a third `feedKind: 'tallyCard'`; a new `useTallyCards()` (or extension of `useTally`) subscribes to day-scoped Tally docs with `count > 0` across the Event and feeds them into `useFeed`. The merge/sort must apply bump-debounce to ordering (see Implementation notes) while leaving per-card live counts unaffected.
- `src/hooks/useData.test.tsx` / a new `src/hooks/d15-tally-cards.test.ts` — merge-ordering + debounce unit tests over the pure merge function.
- `src/components/ProofFeed.tsx` (modify) — add a `TallyCard` component: first two display names + "+N" copy, avatar stack of 3, day chip, relative bump time, lighter visual weight (one-line, accent left border, no media) than `ProofCard`. Tap opens the existing who-list sheet (the same doorway Doubts already use). Buttons: `＋ Proof` when the viewer has marked that Prompt; `🙋 Got it too` when the Prompt sits unmarked on one of the viewer's UNLOCKED Day Cards.

## Implementation notes
- **No new record, per spec**: `TallyDoc` gains `lastMarkedAt` (+ the `dayIndex` it was already gaining from `d15-schema-contract`); the Feed becomes a merged stream of Proofs, Moments, and Tally Cards ordered by their activity time. The card's names/count/avatars are the LIVE tally — unmarking updates it, and a Tally that empties drops out of the Feed entirely (do not render a zero-count card).
- **Copy**: first two display names + "+N" (e.g. "Nathan Payne, Sterling Tadlock +12 got 'Balcony or porthole photo'"), avatar stack of the first three markers, day chip ("Day 2 · Get Sporty"), relative bump time.
- **Bump debounce ~10 minutes**: a card's POSITION in the Feed moves to the top at most once per ~10 minutes; its displayed COUNT updates live regardless of the debounce. This means the merge/sort key for a Tally Card is a debounced "display bump time", not the raw `lastMarkedAt` — implement this as a pure, unit-testable function (e.g. `nextDisplayBumpTime(prevDisplayed, latestMarkedAt, now)` in `src/game/logic.ts` or a sibling module) so a hot square during a party hour can't churn the stream and bury photo proofs.
- **Lighter visual weight**: one-line, accent left border, no media — deliberately less prominent than a `ProofCard`.
- **Buttons are per-viewer and per-card**: `＋ Proof` renders only when the viewer has marked the Prompt (jumps into the existing proof-add sheet). `🙋 Got it too` renders only when the Prompt is unmarked on one of the viewer's own UNLOCKED Day Cards — Boards are per-Player samples, so the button must check the viewer's actual dealt cards, not just "is this Prompt in the pool"; otherwise the card is purely informational (no button).
- **Tap → who-list**: the same single doorway to seeing who marked, and to raising a Doubt — reuse the existing Tally-sheet flow (`useTally`/`useDoubts`), now day-scoped.
- Keep this additive: Proofs and Moments keep their existing rendering and affordances untouched; only the merge gains a third stream.

## Tests to add
- `src/game/logic.test.ts` (or a new `src/game/d15-tally-cards.test.ts`) — `nextDisplayBumpTime`: a second mark within 10 minutes of the last displayed bump does NOT move the card (debounce); a mark 10+ minutes after the last displayed bump DOES move it; the live count is independent of the debounce (layer: unit — merge-ordering + debounce, PRD-adjacent).
- `src/hooks/d15-tally-cards.test.ts` (new, unit) — `mergeFeed`'s 3-way merge orders Proofs/Moments/Tally Cards by their (possibly debounced) activity time; a Tally Card whose count drops to 0 is excluded from the merged stream.
- `src/components/ProofFeed.test.tsx` (extend or new RTL-jsdom) — `TallyCard` renders the "first two + N" copy, day chip, and avatar stack; `＋ Proof` shows only for a viewer who has marked the Prompt; `🙋 Got it too` shows only when the Prompt is unmarked on one of the viewer's unlocked Day Cards and is absent otherwise.
- `tests/rules/d15-tally-cards.test.ts` (new, rules-emulator) — the day-scoped tally marker write/read rules mirror the existing per-Prompt tally rules (self-writable, attributed, publicly readable).

## Acceptance criteria
- **Given** two Players mark the same Prompt on the same Day within 10 minutes of each other **When** the Feed renders **Then** the Tally Card's count reflects both markers but its Feed position only bumped once (debounce test).
- **Given** the last Player to mark a Prompt unmarks it and no one else has it marked **When** the Feed refreshes **Then** the Tally Card for that `(Prompt, Day)` disappears.
- **Given** the same Prompt appears on two different Players' cards on two different Days **When** each is marked **Then** they produce two independent Tally Cards, each with its own day chip.
- [ ] `＋ Proof` and `🙋 Got it too` render per the viewer's own marked/dealt state, never a generic affordance.
- [ ] The merged Feed still respects the existing `slice(60)` cap and newest-first ordering semantics across all three `feedKind`s.

## Definition of Done
- Spec file under `specs/d15-tally-cards.md` WITH a matching test (spec↔test alignment CI).
- `npm run typecheck` + `npm test` + `npm run build` green; md-prose-wrap clean.
- PR body `Closes #<this issue>`; authored `nathanjohnpayne`, driven through REVIEW_POLICY.md to merge.
- Board discipline per `docs/agents/ticket-workflow.md`.

## Dependencies
Depends on #__NUM_d15-schema-contract__, #__NUM_d15-dealing__, #__NUM_d15-day-switcher__.

## Recommended agent
claude-opus-4-8 @ high — the day-scoped tally re-keying plus the debounce merge-ordering logic are correctness-critical and easy to get subtly wrong (stale bump times, phantom empty cards); wants careful unit-test-first reasoning.
