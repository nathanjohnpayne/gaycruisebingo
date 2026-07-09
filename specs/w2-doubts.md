---
spec_id: w2-doubts
status: accepted
---

# w2-doubts — Doubts (ask-for-proof): count on Square + Tally, satisfied by a Proof

A Doubt is one Player publicly asking another to back up a specific marked Prompt — "pics or it didn't happen". It is how the honor-system "the group is the verification" principle (ADR 0001) is applied in-app: SOCIAL PRESSURE, NEVER A GATE. A Doubt never blocks, unmarks, or discounts the Mark, never adds a Claim-like pending state, and never touches the Leaderboard — it only turns up the social heat. The open-Doubt count surfaces in two places — on the marked Square and on that Prompt's Tally entry (ADR 0002) — and attaching a Proof SATISFIES the Doubt, cooling the count from open to answered without ever gating play.

## Data model (merged-main, #16/#18 — consumed, not authored)

`DoubtDoc` already ships in `src/types.ts` (from #16) and the `doubts` rules block already ships in `firestore.rules` (from #18); per the staleness rule this ticket CONSUMES both and edits neither. A Doubt lives in a flat per-event collection `events/{EVENT_ID}/doubts/{doubtId}`, doc id auto-generated (the converter pins `id` on read). `DoubtDoc` is `{ id, itemId, cellIndex, fromUid, fromDisplayName, targetUid, targetDisplayName, createdAt, satisfiedAt?, satisfiedProofId? }`.

The rules block:

- **create** — `signedIn()` AND `fromUid == request.auth.uid` (raised BY the caller; a forged `fromUid` is denied) AND `targetUid is string` AND `targetUid != request.auth.uid` (ON someone else; no self-doubt) AND `itemId is string` AND `cellIndex is number` AND `createdAt is number`. There is no `hasOnly()`/`keys()` constraint, so the attributed display names ride along unrejected.
- **read** — public (`signedIn()`): the group sees the social heat, no anonymity (ADR 0002).
- **update** — an admin, or the doubted Player (`isOwner(resource.data.targetUid)`), changing ONLY `satisfiedAt`/`satisfiedProofId` (`affectedKeys().hasOnly([...])`) — a social "answered" resolution, never a content rewrite.
- **delete** — an admin, or the doubter (`isOwner(resource.data.fromUid)`) retracting.

The `demand_proof` GA4/PostHog event is ALSO already in the catalog (`src/analytics.ts`, added by #38); this ticket only fires it at the one raise call site, so `src/analytics.ts` is likewise consumed unchanged.

## The change

- `src/data/doubts.ts` (new) — `raiseDoubt({ fromUid, fromDisplayName?, targetUid, targetDisplayName?, itemId, cellIndex })` self-publishes a Doubt at `doubts/{autoId}` in the rules-block shape. Attribution reuses the SHARED saved-player helper `markerDisplayName` (`src/data/attribution.ts` — the SAME the Tally marker + Moment use, not forked), bounding both names to the rules' non-empty ≤100 contract. The write is a plain **offline-queueable, fire-and-forget `setDoc`** — NOT a `runTransaction` (which needs a server round-trip and rejects offline) — mirroring the mark path's style (`setMark` in `api.ts`, `broadcast` in `moments.ts`): the promise is not awaited so raising never blocks the UI, an offline write pends durably in the persistent cache and drains on reconnect (ADR 0006), and an ONLINE rejection is logged (never silently swallowed) but never surfaced as a retry — a Doubt is low-stakes social pressure. A self-doubt (`fromUid === targetUid`) is a no-op — no write, no analytics — matching the rules' `targetUid != auth.uid`. Fires `track('demand_proof', { itemId })` at that single raise. The module also exports the PURE satisfied-by-Proof derivation (below).
- `src/data/paths.ts` + `src/data/converters.ts` — a converter-attached `doubtsCol()`/`doubtRef(id)` for reads, mirroring the proofs/moments helpers; the converter pins `id` to the doc id.
- `src/hooks/useData.ts` — `useDoubts(itemId)` subscribes to `doubts` filtered to the one Prompt (`where('itemId', '==', itemId)`) through the SAME `useColSub` latch pattern the Tally + Feed use (`{ includeMetadataChanges: true }`, `hasServerData` latched on the first server-backed snapshot), returning the raw Doubts sorted by `createdAt`. Appended as a self-contained block at the end of the hooks (#37 owns the file's structure this wave).
- `src/components/Board.tsx` — a `DoubtBadge` on each marked, non-free Square (top-LEFT, clear of the ✓, proof ＋, and Tally count) showing the count of open Doubts AGAINST THAT SQUARE'S OWN MARKER — not the Prompt at large — and titled "pics or it didn't happen"; it renders only when a Doubt against its own marker is open and opens the who-list sheet. Scoped deliberately: the shared item pool means another Player commonly holds the same Prompt (ADR 0002), so an un-doubted Player must never see a badge on their own Square over a Doubt aimed at someone else. The `TallySheet` gains a Prompt-wide open count in its header (every marker listed below is visible by name, so an aggregate here is a heat summary, not a mis-aimed accusation) and, per OTHER Player's marker row, a "pics or it didn't happen" affordance that raises a Doubt against their Mark — the doubter's own row offers none (no self-doubt), and a Doubt this Player already raised disables the button (no duplicate stacking). A row whose Doubt is answered renders a DISTINCT satisfied state; an open one a distinct doubted state. The Feed's active Proofs are subscribed ONCE in Board (`useProofFeed`) and threaded down so satisfaction derives without a proof listener per cell. None of this touches the Moments edge machinery, the `setMark` call shape, or `identityKnown`.
- `src/index.css` — the `.doubt-badge` (top-left, a warm social-heat tone distinct from the neutral Tally count), `.doubt-summary`, `.doubt-btn`, and the distinct `.doubt-open`/`.doubt-satisfied` row states.

## Satisfied-by-Proof — PURE DERIVATION, never a stored gate (ADR 0001)

A Doubt is SATISFIED when the doubted Player attaches a Proof for the same Prompt at or after the Doubt was raised. This is DERIVED from the Proofs the Feed already subscribes to — **no write is added to `attachProof`, and the Doubt docs are never mutated on satisfaction** (`satisfiedAt`/`satisfiedProofId` stay absent; they are reserved for a future stored-resolution path, unused here). Deriving rather than gating is the whole point: an open Doubt applies social heat, an answered one cools it, and NEITHER ever blocks, unmarks, or discounts the Mark.

**The join key is (target Player, Prompt), matched by `itemText` — not `cellIndex`.** This is a forced, honest consequence of the merged-main data model, not a shortcut:

- A `ProofDoc` is keyed by `(uid, cellIndex, itemText)` and carries NO `itemId`, so a Doubt cannot join a Proof on `itemId` directly.
- A Player's Board is PRIVATE (`firestore.rules`: `boards/{uid}` is owner/admin-only), and a Tally marker is `{ uid, displayName, markedAt }` with no `cellIndex`. So when a Doubt is raised from another Player's Tally entry, the doubter genuinely CANNOT know the target's own board `cellIndex` — a cross-board `cellIndex` match is impossible, and a pure `cellIndex`-based derivation is therefore genuinely unavailable (which is why `attachProof` is left untouched: the escape hatch's precondition — "derivation impossible" — is met only for the `cellIndex` route, and the `itemText` route below keeps the derivation pure regardless).
- The Doubt's stored `cellIndex` is the doubter's OWN board index for the Prompt (the Square they raised from) — kept for context and the rules' `cellIndex is number` shape check, never used to match the target's Proof.
- The Prompt is matched by `itemText` (the Square/Tally always has the Prompt's text on hand). `itemText` is stable because items are immutable once created (only `reportCount` changes, per the items rules), so a Proof's snapshot of the text still equals the live Prompt text.

`isDoubtSatisfied(doubt, itemText, proofs)` is `proofs.some(p => p.uid === doubt.targetUid && p.itemText === itemText && p.createdAt >= doubt.createdAt)` — "at or after", so a Proof answering a Doubt (always created after it) satisfies, while a Proof that predated the Doubt does not (the Doubt asks for FRESH pics). `openDoubts` is a generic unanswered-subset filter — it does not itself decide "open count for whom"; the CALLER's input scopes it. The Square badge pre-filters to Doubts targeting the Square's own marker before calling it (so another marker's open Doubt on the same shared-pool Prompt never bleeds onto an un-doubted Player's own Square), while the Tally-sheet header passes the full per-Prompt set for a Prompt-wide summary — both then read `.length`. `doubtStatusFor(uid, …)` collapses a Player's Doubts to `none`/`open`/`satisfied`, with `open` winning any mix.

**Accepted residuals** (all harmless for a social count that never gates play, ADR 0001): two DISTINCT Prompts sharing identical text on one Player's Board would alias under `itemText` (vanishingly rare); and satisfaction reads the Feed's Proofs, which are capped at the newest 60 — a target's much-older Proof could fall outside the window and leave a Doubt reading open. Neither ever blocks, unmarks, or discounts a Mark.

## Constraints (encoded here)

- **Never a gate (ADR 0001).** Raising or leaving a Doubt unsatisfied does not prevent, revoke, or discount the Mark, and adds no pending state. The rules-isolation test pins that a doubter can mutate NEITHER the target's private Board NOR their self-writable player row — a Doubt structurally cannot touch the Mark or its stats — and the Board wiring never routes a Doubt through `setMark`/`toggle`.
- **Never touches the Leaderboard.** A Doubt writes only the `doubts` collection; it changes no `players/{uid}` stat, so `sortPlayers`/`useLeaderboard` never see it.
- **Offline-queueable, fire-and-forget** (ADR 0006): a plain `setDoc`, not a transaction — a Doubt raised in a ship-wifi dead zone queues durably and drains on reconnect, exactly like a bare Mark.
- **Two surfaces, deliberately different scope** (ADR 0002): the Square badge reads `openDoubts(...).length` over Doubts pre-filtered to its own marker (`targetUid`), never another marker's; the Tally-sheet header reads the same derivation over the FULL per-Prompt set as a heat summary. A shared item pool means both scopes are reachable in normal play (multiple Players commonly hold the same Prompt), so this split is load-bearing, not cosmetic.
- **Glossary copy only:** the UI says "Doubt" / "pics or it didn't happen" — never callout, demand, or challenge.

## Claim → test

Every claim maps to a real assertion across the three layers; tests drive the real component/functions with only the SDK/data boundaries mocked (no vacuous mock of the thing under test).

### Rules — raise-on-another allowed, forgery/self-doubt denied, isolation from Board/player

Runner: `npm run test:rules` (Firestore emulator). Test: `tests/rules/w2-doubts.test.ts`.

- A signed-in Player may create a Doubt against ANOTHER Player's marked Prompt (`{ fromUid == self, targetUid != self, itemId, cellIndex, createdAt }`).
- A forged `fromUid` (raising as someone else) and a self-doubt (`targetUid == self`) are each denied.
- The shape is enforced: a non-string `itemId`/`targetUid`, and a non-numeric `cellIndex`/`createdAt`, are each denied; a well-formed Doubt succeeds.
- **Isolation:** raising a Doubt lands in the `doubts` collection, but the same doubter can write NEITHER the target's `boards/{uid}` NOR their `players/{uid}` — so a Doubt can never block, unmark, or discount the Mark (ADR 0001).
- Reads are public; the doubted Player (or an admin) may mark it satisfied via `satisfiedAt`/`satisfiedProofId` ONLY (a non-target cannot, and even the target cannot change other content); the doubter (or an admin) may delete, the target may not.

### Unit — `raiseDoubt` write shape + `demand_proof`; satisfied derivation truth table

Runner: `npm test` (Vitest, jsdom). Test: `src/data/w2-doubts.test.ts`.

- `raiseDoubt` writes ONE `setDoc` at `doubts/{autoId}` carrying `{ itemId, cellIndex, fromUid, fromDisplayName, targetUid, targetDisplayName, createdAt }` — no `id`, no `satisfied*` — and fires `demand_proof` with `{ itemId }` at that single raise; it is not a transaction and not a Feed post.
- Attribution uses the shared saved-player helper: an absent name falls back to `'Anonymous'`, an over-long name is bounded to 100 chars.
- A self-doubt is a no-op: no write, no analytics.
- `isDoubtSatisfied` is true ONLY for the doubted Player's Proof for the same Prompt at or after the Doubt; a Proof before the Doubt, by another Player, or for another Prompt does not answer it. `openDoubts` keeps only the unanswered Doubts; `doubtStatusFor` is `none`/`open`/`satisfied` per Player, `open` winning any mix.

### Component — count on the Square, raise from another's Tally entry, distinct satisfied state

Runner: `npm test` (Vitest, jsdom). Test: `src/components/w2-doubts.test.tsx`.

- The open-Doubt count renders on a marked, non-free Square (the DoubtBadge) ONLY for Doubts against that Square's own marker, and disappears once every Doubt against them for the Prompt is answered by a Proof (derived live) — a Doubt against a DIFFERENT Player who also marked the same Prompt must not render a badge on this Player's own Square.
- Opening the Tally sheet, a Doubt is raised from ANOTHER Player's entry — `raiseDoubt` is called with `{ fromUid, fromDisplayName, targetUid, targetDisplayName, itemId, cellIndex }` — while the doubter's OWN row offers no affordance (no self-doubt).
- An answered Doubt renders a DISTINCT satisfied state from an open one, and the header summary counts every open Doubt on the Prompt.
