---
spec_id: reshuffle
status: accepted
---

# Reshuffle a hard Day Card: pristine-only, 3 per cruise, rules-bound counter (`reshuffle`)

Implements [`plans/reshuffle-ticket.md`](../plans/reshuffle-ticket.md) and `plans/daily-cards-spec.md` § "Reshuffle" (#378), against the wireframes' [`#frame-reshuffle`](../plans/daily-cards-wireframes.html) (day-bar chip + confirm sheet) and `#frame-launch-intro` (one-time announcement). Depends on the day-scoped Board path (#204) and per-Day dealing (`d15-dealing`). Guarded by `src/game/reshuffle.test.ts` (the pristine predicate + seed), `src/data/reshuffle.test.ts` (the deal source, exclusion, and batch shape), `src/components/reshuffle-chip.test.tsx` (the chip-visibility matrix), `src/components/reshuffle-sheet.test.tsx` + `src/components/reshuffle-intro.test.tsx` (RTL), `tests/rules/reshuffle.test.ts` (the write gate), and `tests/e2e/reshuffle.spec.ts` (parity screens).

## Glossary

**Reshuffle** — trading a pristine Day Card for a fresh deal; 3 per cruise (CONTEXT.md). *Avoid:* re-deal (that's pool recovery), mulligan.

**Pristine** — a Day Card with zero PLAYER-marked Squares. The free centre is always marked and never counts. A `status: 'pending'` Square (an admin_confirmed-mode Claim awaiting resolution) **is** a Mark for this purpose and makes the card non-pristine, even though `countMarked` discounts it for scoring.

**Allowance** — the cruise-wide budget of 3, held on `PlayerDoc.reshufflesUsed`. Non-refundable and monotonic.

## Contract

**A Reshuffle replaces the Board and increments the counter — and does nothing else.** `reshuffleBoard` (`src/data/api.ts`) writes exactly two docs in one batch: the Day's Board (fresh seed, fresh deal) and `players/{uid}.reshufflesUsed`. There is deliberately NO cascade code: a pristine card has produced no Tally entries, Proofs, Doubts, stats, or Moments to unwind. A Player who wants out of a card they have marked unmarks it through the existing Mark path — which already removes its Tally entries — returning the card to pristine.

**The new card is an ordinary card.** It draws from the SAME frozen `snapshotItemIds` Day Snapshot (never a live `status: 'active'` query), with the same stratification rules as the first deal — `stratify` off for all-tame tutorial pools, the Event's `spicyRatio` on main Days.

**Discarded prompts return to the eligible pool.** The cross-cruise no-repeat exclusion is computed from KEPT cards only: every OTHER Day Card the Player holds is excluded, the discarded one is not.

**The chip renders only when every gate holds** (`src/components/Board.tsx`): card pristine, counter known and under the allowance, Day unlocked, card is the caller's own, and online. It reappears if the Player unmarks everything. It never renders on a locked-Day preview — `DayBar`'s chip prop is optional and `LockedDayPreview` passes none.

**Online-only.** Unlike every other write in `data/api.ts`, `reshuffleBoard` is awaited and never queued: the Board replace and the counter increment must land together (the rules bind them in one batch), so a reshuffle drained hours later against a since-marked card would be denied at drain time and silently lose the Player their card.

**The Board rule binds the pair** (`firestore.rules`): a write that changes an existing Board's `seed` is a Reshuffle, and is permitted only for the owner, only on an unlocked canonical Day, only when the EXISTING Board is pristine, and only when `getAfter(players/{uid}).reshufflesUsed == get(...).reshufflesUsed + 1` and `<= 3`. A seed-preserving write (a Mark, a merge of `cells`) and a create (the first deal) are unaffected.

**The counter is monotonic** (`firestore.rules`): `reshufflesUsed` may only hold or rise by exactly 1, never fall, never exceed 3; a create must start at 0. Admins are bound by this too.

**The launch intro shows exactly once.** `LaunchIntro` self-gates on `gcb.seen.reshuffleIntro` (localStorage), queued behind the coach overlay so the two scrims never stack. Not replayable.

## Decisions

**Why monotonic rather than "deny counter writes outside the pairing"** (the ticket's original wording). That check is not expressible. It would have to live on `players/{uid}`, which is cruise-wide and carries no `dayIndex`, so it cannot know which Day's Board to inspect. The only day-agnostic formulation — unroll all 10 Days, asking whether any Board's seed changed — costs 3 access calls per Day (`exists` + `get` + `getAfter`) against Firestore's ceiling of 20 for a batched write. Measured against the emulator: it short-circuits cheaply on a Day-0 reshuffle and **denies a legitimate Day-5 or Day-9 one**, i.e. it would have passed CI and then silently broken mid-cruise.

Monotonic is equivalent for the property that matters. Every Board reshuffle still requires a paired +1 (Board-side), so the cap of 3 holds exactly; monotonicity closes the only real exploit — resetting the counter to 0 for unlimited reshuffles. Recorded on #378.

**Why `isPristine` is not `countMarked(cells) === 0`.** `countMarked` scores the leaderboard and therefore discounts a `status: 'pending'` Square. Eligibility is a different question: the Player has tapped it, a Claim is queued against it, and trading the card away would strand that Claim. The client predicate must also agree with the rules' `boardPristine()`, which can only see `marked`/`free`, not `status` semantics — a disagreement would render a chip whose write the server denies.

## Residuals (accepted)

**An unpaired counter increment is permitted.** A client can write `reshufflesUsed: n+1` with no Board write. It burns their own allowance and changes no card — self-harm, not an exploit. This is the one deviation from the ticket's literal wording; see Decisions above.

**Boards remain self-writable by design** (ADR 0001). A determined client can already rewrite its own `cells` under the honor system, and a Board write carrying no `seed` key is not classified as a Reshuffle. This gate bounds the FEATURE's counter, keeping the honest path honest; it is not an anti-cheat boundary, and treating it as one would misread ADR 0001.

**A concurrent second reshuffle is denied, not merged.** `reshuffleBoard` writes an explicit counter value read in the same call, so a second tab racing the first fails the rules' `+1` check. Denial is the correct outcome — the alternative is a silent double-spend.

**`gcb.seen.reshuffleIntro` diverges from the repo's `gcb.<feature>.dismissedAt` key convention.** Kept as the ticket specifies so the spec, the test, and the deployed key cannot drift.

## Acceptance criteria

- Given a pristine Day 2 card and `reshufflesUsed = 1`, when I confirm a reshuffle, then I get a new 24-prompt card from the same snapshot, the chip shows ×1, and nothing else changed — Feed, tallies, stats identical (`src/data/reshuffle.test.ts`, `tests/e2e/reshuffle.spec.ts`).
- Given one marked square, then the chip does not render (`src/components/reshuffle-chip.test.tsx`) and a forced write is denied by rules (`tests/rules/reshuffle.test.ts`); after unmarking it, the chip renders again.
- Given `reshufflesUsed = 3`, then the chip never renders and a forced write is denied.
- Given a locked Day, or an offline client, then the chip does not render; a forced write on a locked Day is denied by rules.
- Given a non-owner, then a forced Board write is denied by rules.
- Given a counter write that decrements, jumps by 2, or exceeds 3, then it is denied by rules.
- Given my first app open after deploy, the intro overlay shows exactly once and never again (`src/components/reshuffle-intro.test.tsx`).
- Given I tap "Keep my card", then nothing is written (`src/components/reshuffle-sheet.test.tsx`).
