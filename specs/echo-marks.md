---
spec_id: echo-marks
status: accepted
---

# Echo Marks: a confirmed Mark carries to every card that has the same Prompt (`echo-marks`)

Implements [`plans/echo-marks-ticket.md`](../plans/echo-marks-ticket.md) (#446) under ADR 0001 (client-authoritative marks — entirely client-side, no server function) and ADR 0006 (offline-queueable batches). Guarded by `src/game/echo-marks.test.ts` (the pure derivation + folds), `src/data/echo-marks.test.ts` (the three propagation write paths + the no-repeats regression), `tests/rules/echo-marks.test.ts` (the multi-board batch gate, per-board `markSeed`, and the pristine echo exemption), and `tests/offline/echo-marks.test.ts` (batch durability across reload).

## Glossary

**Echo Mark** — a Square auto-marked (`Cell.echo: true`) because the same Player's Mark on the same Prompt reached **confirmed** on another of their Day Cards (CONTEXT.md). *Avoid:* carry-over, sync mark.

**Achieved set** — every `itemId` with a confirmed (non-pending) Mark on any of the Player's own Day Boards, derived client-side from their own `days/{d}/boards/{uid}` docs (`achievedItemIds`, `src/game/logic.ts`). No new collection.

## Contract

**Only confirmed Marks echo, and echoed cells are born confirmed.** A `pending` (admin_confirmed-mode) Mark echoes nothing at mark time; the echo fires when the Claim is confirmed (`confirmClaim`, `src/data/admin.ts`, inside the same resolve transaction). An echoed cell arrives `status: 'confirmed'` — the underlying achievement was already confirmed once, so it raises no second Claim.

**Three propagation moments cover all cases with no migration** (`applyEchoes` is pure and idempotent, so every moment can run against every board):

1. **Mark-time** (`runSetMark`, `src/data/api.ts`): a Mark that lands confirmed reads the Player's sibling Day Boards from the persistent cache (offline-safe; serialized with every other Mark by the per-player `markChains` chain) and echoes the marked Prompt onto each unmarked carrier — in the SAME offline-queueable `writeBatch` as the Mark itself.
2. **Deal-time** (`dealDayCard` and the post-Reshuffle re-deal in `reshuffleBoard`): the deal derives the achieved set from the same sibling reads the no-repeat exclusion already makes and pre-marks any dealt Prompt already achieved — the new card arrives already echoing. In daily mode `joinAndDeal` deals no boards, so the ticket's "deal-time" seam lives entirely in these two paths.
3. **Open-time reconcile** (`reconcileEchoes`, called by `Board` once per board identity per session): reconciles the opened board against the achieved set and writes any missing echoes — the lazy backfill that self-heals pre-feature boards without a migration script and mops up any echo write dropped offline. A pass with any REJECTED sibling cache read reports `complete: false` — the achieved set may be missing a source Mark this device never cached — and Board drops its once-per-board guard so a later open retries with more of the cache populated; only a complete pass settles the guard.

**One aggregated player write.** Each echoed board's stat bucket (`bingoCount`, `squaresMarked`, blackout) folds through `foldEchoStats` (`src/game/logic.ts`) into a single `{ merge: true }` `players/{uid}` write per batch/transaction: per-Day buckets for every touched Day, root `bingoCount`/`squaresMarked` re-summed over the merged view (ceremonial Days excluded, as ever), root `blackout` true when any board touched by the write completes, and root `firstBingoAt` re-derived with the tutorial exclusion — OMITTED exactly when the acted-day fold omitted it (the #75 unknown-state preserve), so an echo can never clobber a server stamp the base fold deliberately left alone. Post-freeze, echoed cells still land but ONLY buckets record, ceremonial Days only, on every path — deal and reshuffle included: even a farewell card that arrives echo-marked writes `dayStats[d]` alone, never root fields (root blackout included), so the frozen standings cannot move.

**Every echoed board write carries THAT board's own `markSeed`.** The stale-write rules gate (`seededMarkWriteOk`, firestore.rules) is per-board; reusing the source board's seed would be rejected. The day-board write gate needed no extension for multi-board batches: each board's rule evaluation reads the one shared Event doc (cached across the batch), `isReshuffleWrite()` is false (echo writes never touch `seed`), and every echoed board exists only on an unlocked Day — pinned by `tests/rules/echo-marks.test.ts`.

**Echo-caused wins go through the existing pending-Moment queue, never straight to the Feed.** Each propagation path enqueues its rising edges via `enqueueWinMoments` keyed to the echoed board's OWN `dayIndex`; the queue's per-day witness (`drainMoments`, Board) posts a queued win only when that Day's board renders standing under the identity/roster gates. Nothing broadcasts directly from any echo path.

**An echo bingo pins its Day's write-once honor.** The stats fold stamps `dayStats[d].firstBingoAt`, so the create-once `meta/{d}` pin must go to the same win — otherwise a later manual winner captures the permanent Day honor from the real first. `confirmClaim` includes the pin in its transaction. Mark-time and reconcile wait for their board batch's server acknowledgement before calling `pinDayFirstBingo`, so a stale-seed rejection cannot leave a permanent honor for a rolled-back Echo. Deal and reshuffle pin after their transactions resolve. Every path is identity-gated (never 'Anonymous'; the honors strip's roster-derived fallback covers a skipped pin) and narrowed post-freeze like the stats. The event-level ceremonial First-to-BINGO candidate is deliberately NOT minted from echo paths (see Residuals).

**Aggregated `blackout` is a latch on echo paths.** Echo writes only ADD Marks, so `foldEchoStats` preserves a prior root `blackout` standing on an untouched board (`priorBlackout`); the paths that can legitimately remove a blackout (unmark, reject) run the base fold alone. The reshuffle re-derive drops the latch when the DISCARDED card itself stood blackout — trading away the only blackout must clear the flag (an echo-only blackout card reshuffled while a second board also stands blackout drops it until that board's next fold; accepted, vanishingly rare).

**Reshuffle pristine-ness.** Only artifact-free confirmed Echoes are pristine: the card produced nothing of its own (no Tally entry, no Claim, no Proof), so `isPristine` (client) and `boardPristine()`/`cellUnmarked()` (firestore.rules) exempt only `echo == true` cells without a Proof or pending Claim. Attaching a Proof clears `echo` as a second writer-side guard. This is why `Cell.echo` is PERSISTED, not inferred. `computeMark` strips `echo` from any manually toggled Square, so a real Mark can never ride under the exemption. After a Reshuffle, the replacement card re-echoes from the transaction's own peer reads, and — because the discarded card may have carried echo stats — the Day's bucket is re-derived from the replacement's cells in the same transaction, so a traded-away echo bingo never survives as a phantom stat. A no-echo reshuffle keeps the exact two-write shape of today.

**No unmark cascades, in either direction.** Unmarking the source Mark leaves its echoes standing; unmarking an Echo records `echoOptOut: true` on that card, re-folds only that board's stats, and prevents later reconciliation from restoring the unwanted Echo. A manual re-mark clears the opt-out. No cascade deletes.

**Tally: one marker slot per (Prompt, Player) — adapted from the ticket.** The marker doc id IS the marker's uid (`tally/{itemId}/markers/{uid}`, rules-enforced by `isOwner(markerUid)`), so the ticket's per-`(itemId, dayIndex)` echo marker is not expressible without a schema/rules change this feature deliberately avoids. The invariant-preserving adaptation: the confirmed source Mark owns the marker (echo paths neither create nor move it — the achievement that seeded every echo already wrote it), and an unmark now deletes the marker ONLY when no other cached board of the Player's still holds the Prompt confirmed — so the mark⇒tally invariant (a standing confirmed Mark implies the Player's marker exists) and the Doubt gate's `exists()` target survive both directions. Claim rejection reads confirmed siblings inside its transaction before deleting the same marker. The closing half: when a Reshuffle trades away a discarded Echo that was the Prompt's LAST carrier (its source was unmarked while it stood, which is what kept the marker alive), the transaction deletes that marker too — no Player stays in a Prompt's public Tally with no standing Mark anywhere. The healing half is deliberately provenance-gated: an unmark with an incomplete sibling-cache view records a session-local repair candidate, and only that candidate plus a cached marker tombstone lets open-time reconciliation restore a standing confirmed cell's marker. An arbitrary tombstone, including an admin moderation deletion, is never recreated.

## Decisions (ticket defaults, as implemented)

- **Name:** "Echo Mark" (glossary in CONTEXT.md).
- **Echo indicator UI:** yes, minimal — a subtle ⟲ glyph top-left plus a slightly dimmed ✓ on echoed Squares; it shifts below a live Doubt badge, CSS-only (`.cell.echo`, src/index.css).
- **Echoes skip admin re-confirmation** in admin_confirmed mode: yes — born `confirmed`, no second Claim.
- **Tally for echoes:** yes in the adapted single-slot form above (the ticket's literal per-day marker contradicts the deployed marker schema; see Residuals).
- **Unmark independence:** no cascades either direction.

## Residuals (accepted)

**Per-day Tally Cards list a repeated Prompt's marker under one Day only.** With one marker slot per (Prompt, Player), a Player who holds the same Prompt on several cards appears in that Prompt's Tally Card for the Day their confirmed source Mark stamped — not on every echoed Day. Pre-existing behavior for manual cross-day repeats (easy-mix embark items repeat by design); echoes make it more common but no worse. A true per-(Prompt, Day) marker needs a marker-id schema + rules + Doubt-gate change — out of scope here by the ticket's own "no new collections" bound.

**Admin-confirmed echo wins on sibling boards post no Feed Moment.** `confirmClaim` runs on the ADMIN's device and a Moment must be written by its winner (`isOwner` create rule). The claim's own board still gets its Moments through `ConfirmWinMoments` on the winner's device; an echo-completed line on a *sibling* board updates stats and cells but its Moment is dropped — the conservative direction (a ceremony can be lost, never wrongly posted), matching the queue's existing fail-safe posture.

**Proofed Marks (`attachProof`) echo lazily.** The proof path writes the board itself and is untouched (ticket scope); its confirmed Mark enters the achieved set, so siblings pick the echo up at their next open (reconcile) or deal — not instantly.

**A forged `echo: true` on a hand-built write is self-harm only.** It could launder that client's own pristine gate; ADR 0001's no-motivated-cheater posture and the reshuffle spec's Residuals already accept this class.

**Mark-time echo sees only CACHED siblings.** A sibling board never loaded on this device isn't echoed at mark time; the open-time reconcile heals it on that board's next open. Offline this is exactly the durable-batch behavior the ticket asks for.

**Cross-DEVICE concurrent Marks can clobber each other's boards (the same class as today's offline-queueable Marks, widened across boards).** A Board write is a full-`cells`-array replacement folded from this device's cache; the `markChains` serialization and the shared multi-tab cache close the same-device races, but two DEVICES marking concurrently have always been able to clobber the same board (an offline queue draining a stale array over a newer Mark — the accepted cost of ADR 0006's durable-batch design, cf. the reshuffle spec's stale-Mark residual). Echo widens the surface: a mark on Day A can now write a stale Day-B array (its echo pass) over Day B's concurrent manual Mark from the other device. Same trust model (ADR 0001 — one friend group, realistically one device in hand), and partially self-healing: a lost ECHO re-echoes at the next open's reconcile; a lost manual Mark is re-markable like any cross-device clobber today. A concurrency-safe per-cell merge needs a board schema change (cells as a map, or per-cell docs) — deliberately out of this feature's bounds.

## Acceptance criteria

- Given Prompt P confirmed on any of my cards, every other card of mine carrying P shows it marked with `echo: true` — immediately (mark-time), on arrival (deal-time/reshuffle), or on open (reconcile) (`src/data/echo-marks.test.ts`).
- Given echoes complete new lines, `bingoCount`/`squaresMarked`/`blackout`/`firstBingoAt` update in ONE aggregated player write, and the wins enter the pending-Moment queue under their own Day — never the Feed directly (`src/game/echo-marks.test.ts`, `src/data/echo-marks.test.ts`).
- Given admin_confirmed mode, nothing echoes while the Claim is pending; the confirm echoes in its own transaction with echoed cells born confirmed (`src/data/echo-marks.test.ts`).
- Given a Reshuffle, prior echoes never cost pristine-ness (client predicate and rules gate agree) and the fresh card re-echoes with its bucket re-derived (`tests/rules/echo-marks.test.ts`, `src/data/echo-marks.test.ts`).
- Given an echoed board write, it carries that board's own `markSeed`; a stale or borrowed seed is rejected by rules (`tests/rules/echo-marks.test.ts`).
- Given a Player with no repeated Prompts across boards, every write path is byte-identical to today (`src/data/echo-marks.test.ts`).
- Given a Mark made offline, its echoes and stat deltas ride the same durable batch and sync on reconnect (`tests/offline/echo-marks.test.ts`).
