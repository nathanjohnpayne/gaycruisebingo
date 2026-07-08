---
spec_id: w2-tally
status: accepted
---

# w2-tally — Per-Prompt Tally: every Mark publishes an attributed public record + tap-to-see-who

The Tally is the product's core differentiator over the printed card (ADR 0002, embarkation-critical): a Board's layout and progress stay private, but the *fact* that a Player marked a given Prompt is public. Every Mark — proofed or not — self-publishes an ATTRIBUTED entry to that Prompt's Tally, and the Square gains a count plus a tap-to-see-who list built from it. There is no anonymity (ADR 0001, a single 18+ friend group). This ticket extends the Wave-1 Mark write path (`setMark`) to publish the Tally in the SAME offline-queueable batch, adds the read hook, and surfaces the count + who-list on the Board.

## Data model (merged-main rules, #18)

The Tally is a subcollection, not a field on the Board: `events/{EVENT_ID}/tally/{itemId}/markers/{markerUid}`, where the marker doc id IS the marker's uid. `firestore.rules` keys the self-write on `isOwner(markerUid) && request.resource.data.uid == request.auth.uid`, so a Player can add/remove ONLY their own entry and a forged attribution is denied — the attribution is forgery-deniable by design. The marker shape is `{ uid, displayName, markedAt }` with a non-empty `displayName` within a 100-char cap. Reads are public (`signedIn()`).

The aggregate parent `tally/{itemId}` doc (`{ itemId, count, markers }`) is public-read but NOT client-writable (`allow write: if isAdmin(eventId)`); it is admin/Cloud-Function-maintained in Phase 1. So in Phase 0 the Square's badge count is DERIVED from the marker subcollection's size, never read from a client-forged aggregate.

## The change

- `src/data/api.ts` — `setMark`'s existing `writeBatch` (board `cells` + player stats) also writes/deletes the Tally marker at `tally/{itemId}/markers/{uid}`. Marking adds `{ uid, displayName, markedAt }`; unmarking deletes exactly that Player's entry, mirroring the cell toggle so the Tally never drifts from the Board. The write rides INSIDE the existing per-board serialization chain and the SINGLE batch (never a second unserialized path, never a `runTransaction` — the whole Mark path is offline-queueable, ADR 0006). The Tally lives in its own subcollection, never in the `cells` array a bare Mark rewrites. The free centre Square (no `itemId`) never tallies. `resolveDisplayName` is extracted from `joinAndDeal` so the join-side denormalization and the marker attribution resolve the public name the SAME validated way (saved `users/{uid}` name within the 100-char cap, else the auth value); `markerDisplayName` bounds the final name to the rules' non-empty ≤100 contract so a marker write can never poison the atomic batch.
- `src/data/paths.ts` + `src/data/converters.ts` — a converter-attached `tallyMarkersCol(itemId)` for reads; the converter pins `uid` to the doc id (the forgery-deniable attribution).
- `src/hooks/useData.ts` — `useTally(itemId)` subscribes to the marker subcollection and returns the derived `count` plus the who-list sorted by `markedAt`.
- `src/components/Board.tsx` — a count badge on each marked, non-free Square; tapping it opens a who-list sheet naming every Player who marked the Prompt. The Player's attributed name is resolved once from the saved `users/{uid}` profile + auth via `resolveDisplayName` and passed to `setMark`.

## Constraints inherited from PR #75 (encoded here)

- The marker write is part of the SAME `writeBatch` as board + player and rides the SAME per-board serialization chain — no second write path, no transaction (offline-queueable). Verified by the write-shape unit test and the offline durability layer.
- Tally state is its OWN subcollection; a bare Mark's full-`cells` merge never touches it, so the cross-writer `cells` clobber documented in `specs/w1-board-mark-win.md` cannot drop a marker.
- Attribution reuses `joinAndDeal`'s validated `resolveDisplayName`; the marker always carries a rules-valid non-empty ≤100 `displayName`.

## Claim → test

Every claim maps to an assertion in a `w2-tally.test.*` file (basename-aligned; no vacuous coverage).

### Rules — a Player self-publishes their OWN attributed marker; forgery denied; reads public

Runner: `npm run test:rules` (Firestore emulator). Test: `tests/rules/w2-tally.test.ts`.

- A signed-in Player may create their own attributed marker at `tally/{itemId}/markers/{uid}` (`{ uid, displayName, markedAt }`); unmarking deletes it.
- A write to ANOTHER Player's marker slot, or a forged `uid` in one's own slot, is denied.
- An empty `displayName`, an over-100-char `displayName`, and a non-numeric `markedAt` are each denied (the rules' shape contract).
- Marker reads are public (no anonymity, ADR 0002); the aggregate `tally/{itemId}` doc is admin-writable only, never client-forged.

### Unit — `setMark` publishes/removes the marker with attribution, in the one batch

Runner: `npm test` (Vitest, jsdom). Test: `src/data/w2-tally.test.ts`.

- Marking a non-free Square adds a marker write at `tally/{itemId}/markers/{uid}` carrying `{ uid, displayName, markedAt }` in the SAME batch as the board + player writes; unmarking issues a `batch.delete` at that exact path instead.
- The marker attribution prefers the caller-supplied `displayName` (Board resolves it from `users/{uid}` + auth), falls back to the cached player row's denormalized name, then `'Anonymous'`, and is bounded to ≤100 chars — so the write always satisfies the marker rule.
- The free centre Square (no `itemId`) never writes a marker.
- No `runTransaction` and no `addDoc` (ADR 0006 offline-queueable; ADR 0002 a bare Mark posts nothing to the Feed).

### RTL — `useTally` returns the count + who-list for a Prompt

Runner: `npm test` (Vitest, jsdom). Test: `src/hooks/w2-tally.test.tsx`.

- `useTally(itemId)` subscribes to the Prompt's marker subcollection and returns `count` = the number of markers and a who-list of every marker, sorted by `markedAt` (chronological).
- A `null`/`undefined` `itemId` (e.g. the free centre) opens no subscription and returns an empty Tally.

## Acceptance criteria

- Given a Player marks a Square, when the write commits, then an attributed entry (`uid` + `displayName`) appears in that Prompt's Tally and the Square shows an incremented count — `src/data/w2-tally.test.ts` (marker write) + `src/hooks/w2-tally.test.tsx` (count) + `tests/rules/w2-tally.test.ts` (rules-allowed shape).
- Given a Prompt's Tally has entries, when a Player taps the count, then the who-list names every Player who marked it — no anonymity (ADR 0002) — `src/hooks/w2-tally.test.tsx` (who-list) + the `Board.tsx` `TallySheet`.
- Every Mark, proofed or not, publishes to the Tally; a bare Mark still posts nothing to the Feed — `src/data/w2-tally.test.ts` (no `addDoc`).
- Unmarking removes the Player's own Tally entry — `src/data/w2-tally.test.ts` (unmark `batch.delete`) + `tests/rules/w2-tally.test.ts` (own-delete allowed).
- The Board's layout/progress stays private; only per-Prompt Tally membership is public — the Tally is its own subcollection with public marker reads, while `boards/{uid}` stays owner-only (`firestore.rules`).
