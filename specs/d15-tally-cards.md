# Tally Cards in the Feed (d15-tally-cards)

Feature: bare Marks reach the Feed. Today a Mark with no Proof broadcasts nothing, so most play is invisible — only Proofs and Moments appear. This adds a third merged stream: the Feed renders one live **Tally Card** per `(Prompt, Day)` once anyone marks it, bumps it toward the top (debounced) as new Players get it, updates its count live, and drops it when the Tally empties. Implements `plans/daily-cards-spec.md` § "Tally Cards—bare marks reach the Feed".

## Contract

- `src/game/logic.ts` — `nextDisplayBumpTime(prevDisplayed, latestMarkedAt, windowMs = BUMP_DEBOUNCE_MS)`: the PURE, clock-free Feed-position sort key. A Tally Card's position moves to the top at most once per `BUMP_DEBOUNCE_MS` (10 minutes); its displayed COUNT updates live regardless. Monotonic non-decreasing — a card never slides down on a fresh Mark. No prior bump ⇒ adopt the Mark time; a Mark within the window ⇒ hold; a Mark at/after the window ⇒ bump.
- `src/hooks/useData.ts`:
  - `FeedEntry` gains a third variant `{ feedKind: 'tallyCard'; createdAt; card }`; `mergeFeed(proofs, moments, tallyCards = [], max = 60)` interleaves all three newest-first, sorting a Tally Card by its DEBOUNCED `displayBump` (not raw `lastMarkedAt`) and excluding any zero-count card.
  - `deriveTallyCards(rows, prevDisplayed = {}, windowMs)` — PURE: folds a flat marker list into one `TallyCard` per `(itemId, dayIndex)` (count = live marker set, `lastMarkedAt` = max marker time, `displayBump` from the carried-forward map). Only markers carrying BOTH `dayIndex` and `itemText` form a card; empty groups produce none. Returns the cards plus the next displayed-bump map.
  - `useTallyCards()` — a `collectionGroup(db, 'markers')` subscription over every Tally marker in the Event, guarded to the Tally's `markers` and ban-filtered (mirrors `useTally`), folded through `deriveTallyCards` with a ref-held bump map. `useFeed` composes it as the third stream.
- `src/data/api.ts` — `setMark` gains an optional `dayIndex`; on mark it stamps `dayIndex` and the Prompt `itemText` as ADDITIVE fields on the same per-Prompt marker (`tally/{itemId}/markers/{uid}`). `src/components/Board.tsx` passes the viewed Day.
- `src/components/ProofFeed.tsx` — a `TallyCard` component (first two names + "+N", avatar stack of three, day chip, relative bump time; one line, accent left border, no media — lighter than a `ProofCard`; tap opens the who-list sheet), and `tallyCardAction(itemId, marked, dealtUnmarked)`: `＋ Proof` when the viewer has marked the Prompt, `🙋 Got it too` when it's unmarked on the viewer's own dealt card, else informational.

## Resolved decisions (defaults chosen here)

- **Day-scope by marker FIELD, not a forked path.** The issue floated a day-scoped tally doc or a composite key. Instead the marker stays at the unchanged per-Prompt path `tally/{itemId}/markers/{uid}` and carries `dayIndex` as a field; the Feed groups by `(itemId, dayIndex)`. Rationale: no-repeat exclusion is per-Player, so one Player never marks the same Prompt on two Days — no self-overwrite in the shared `markers/{uid}` slot — while two Players marking it on different Days still split into two cards by their stamped `dayIndex`. This avoids forking the Square-badge (`useTally`) and Doubt `exists()` read paths for no functional gain. The one required rules change is read-only and query-shape-specific: the Feed's `collectionGroup('markers')` subscription needs a signed-in `{path=**}/markers/{markerUid}` read rule because Firestore collection-group queries do not match the nested `events/{eventId}/tally/{itemId}/markers/{uid}` rule; writes stay guarded by the original path rule.
- **`lastMarkedAt` is DERIVED, not written.** The parent `tally/{itemId}` doc is admin-only-write, so a client Mark cannot stamp it. The Feed derives the re-sort time as `max(marker.markedAt)` over the group — the same "count is the marker set" model the Square badge already uses. No admin-maintained aggregate doc.

## Acceptance criteria

- Two Players marking the same Prompt on the same Day within 10 minutes: the card's count reflects both, but its Feed position bumps only once (debounce).
- The last Player to mark a Prompt unmarks it and nobody else has it: the Tally Card for that `(Prompt, Day)` disappears.
- The same Prompt on two different Players' cards on two different Days: two independent Tally Cards, each with its own day chip.
- `＋ Proof` and `🙋 Got it too` render per the viewer's own marked/dealt state, never a generic affordance.
- The merged Feed keeps the `slice(60)` cap and newest-first ordering across all three `feedKind`s; Proofs and Moments render unchanged.

## Test coverage

- `src/game/d15-tally-cards.test.ts` — `nextDisplayBumpTime`: first-appearance adopt, within-window hold (debounce), at/after-window bump, monotonicity, custom window.
- `src/hooks/d15-tally-cards.test.ts` — `deriveTallyCards` grouping, two-Days-two-cards, drop-empty, legacy-marker skip, live-count-with-held-bump debounce; `mergeFeed` 3-way newest-first ordering, zero-count exclusion, backward-compat.
- `src/components/ProofFeed.test.tsx` — `TallyCard` renders "first two + N", Prompt text, and day chip, opens the who-list on tap; `tallyCardAction` gates `＋ Proof` / `🙋 Got it too` / informational per viewer state.
- `tests/rules/d15-tally-cards.test.ts` — the day-scoped (additive-field) marker is still self-writable, attributed, publicly readable, and forged-attribution/shape denials still hold, plus the Feed's collection-group marker query is allowed for signed-in Players, denied when signed out, and grants no writes.

## Out of scope (follow-up)

The per-viewer button GATE (`tallyCardAction`) and its handlers are implemented and unit-tested on the `TallyCard` component (fed `marked` / `dealtUnmarked` sets from `boardItemSets`), but the LIVE `ProofFeed` renders the informational card (`action={null}`) for now: wiring the viewer's own Board into the Feed tab, and routing the `＋ Proof` / `🙋 Got it too` clicks to the Board's proof-add / claim sheet, is a cross-tab navigation follow-up. The who-list sheet reuse and the multi-day Board union for the gate widen naturally once day-scoped Boards (`events/{eventId}/days/{dayIndex}/boards/{uid}`) are fully wired.
