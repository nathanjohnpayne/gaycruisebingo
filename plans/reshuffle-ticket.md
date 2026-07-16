# Ticket: Reshuffle a hard Day Card (3 per cruise, pristine cards only) + launch-day intro overlay

**Track:** dealing / day-ui · **Phase:** 1.5 · **Size:** M (one PR) · **Labels:** phase-1.5, needs-phase-4 (firestore.rules) · **Project:** #7

**Recommended agent:** `claude-opus-4-8 @ high` (the rules predicate and counter binding are the risk; the UI is small).

**Mockups (read first):** [plans/daily-cards-wireframes.html#frame-reshuffle](daily-cards-wireframes.html#frame-reshuffle) (day-bar shuffle chip + confirm sheet) and [plans/daily-cards-wireframes.html#frame-launch-intro](daily-cards-wireframes.html#frame-launch-intro) (one-time launch announcement). Open the file in a browser; frames carry their annotations.

## User story

> As a player, if I get a really hard bingo card, I want to be able to get a new one.

## Context & scope

A player may **reshuffle a Day Card**—a fresh deal from that Day's snapshot with a new seed—under two constraints that keep this trivially simple: the card must be **pristine** (zero player-marked squares; the free center doesn't count), and the allowance is **3 for the whole cruise**. Because a pristine card has produced nothing, there is **no cascade**: no tallies to decrement, no proofs to pull from the Feed, no doubts to dissolve, no stats to adjust, no Moments at risk. The transaction is: replace the board doc, increment the player's cruise-wide counter. A confirm dialog still gates it (the counter is a scarce, non-refundable resource). Plus a **one-time launch-day intro overlay** announcing the feature.

## Decisions (made 2026-07-14, bake in—do not re-litigate)

- **Pristine cards only.** Reshuffle is available only while the Day Card has zero player-marked squares. The moment a square is marked, the card is locked in and the chip disappears. Escape hatch, by design: a player who unmarks everything (the existing, tested unmark path—which already removes tally entries) returns the card to pristine and may then reshuffle; the "cascade" is thus performed by the player, visibly, through existing mechanics. Do not build any new removal code.
- **3 per cruise**, not per day. With no marks at stake a reshuffle costs nothing, so scarcity must live in the allowance; a cruise-wide budget makes it strategic instead of three free re-rolls every morning. Counter on `PlayerDoc.reshufflesUsed`.
- Discarded prompts return to the eligible pool; the cross-cruise no-repeat exclusion is computed from kept cards only.
- **Online-only** (board replace + counter increment must land together; don't queue it offline—disable the chip with a "connect to reshuffle" hint).
- Works on any unlocked Day including tutorials; never on locked previews.

## Current state

Dealing lives in `src/game/logic.ts` + `src/data/api.ts` (deal-from-snapshot, no-repeat); the coach-overlay pattern (How to play → badge legend) is the precedent for the intro pop-up; `BoardDoc` has no reshuffle concept; `PlayerDoc` has no counter.

## Design (match the mockups)

- **Control:** a `shuffle` (Lucide) chip in the day bar with the remaining cruise-wide count ("×3"). Rendered only when ALL hold: card pristine, counter < 3, Day unlocked, online.
- **Confirm sheet:** title "Reshuffle this card?"; sub "A fresh 24 squares for Day N—same day, new luck."; warn box "This can't be undone. You'll never see this card again—and reshuffles don't come back."; counter line "2 of 3 cruise reshuffles left · available only before you've marked a square"; buttons **Keep my card** (primary) / **Reshuffle it** (danger styling, shuffle icon).
- **Transaction:** replace the Day's board doc (fresh seed, standard stratified deal from the same snapshot) + increment `PlayerDoc.reshufflesUsed`. Nothing else.
- **Rules (`firestore.rules`, needs-phase-4):** board overwrite permitted only for the owner, only while the Day is unlocked, only when the existing board has **zero player-marked cells**, and only when the player doc's counter goes exactly +1 in the same batch with a resulting value ≤ 3. Deny counter writes outside this pairing.
- **Intro overlay:** one-time pop-up on first app open once deployed (localStorage key `gcb.seen.reshuffleIntro`), coach-overlay pattern, three beats per the mockup: trade a dud before you start marking; three for the whole cruise, they don't come back; once you mark, the card's yours. Dismiss CTA: "Nice—let's play." Not replayable.
- **Analytics:** `reshuffle_card` (`dayIndex`, `reshufflesUsed`) via the dual-dispatch `track()`.

## Files to create/modify

`src/types.ts` (PlayerDoc.reshufflesUsed) · `src/data/api.ts` (reshuffleBoard) · `src/components/Board.tsx` (chip + gate logic) · new `src/components/ReshuffleSheet.tsx` + `src/components/LaunchIntro.tsx` (or fold into the existing overlay component) · `firestore.rules` · `src/analytics.ts` · `specs/reshuffle.md` (+ matching tests, alignment CI) · CONTEXT.md glossary ("**Reshuffle**: trading a pristine Day Card for a fresh deal; 3 per cruise. *Avoid:* re-deal (that's pool recovery), mulligan.").

## Tests

- Rules emulator: reshuffle with any marked cell denied; 4th reshuffle denied (counter binding: value must be old+1, ≤ 3, in the same batch as the board write); non-owner denied; locked-Day denied; counter write without a board write denied.
- Unit: new deal draws from the same Day snapshot with standard stratification; discarded prompts remain eligible; second seeded player untouched.
- RTL: chip visibility matrix (marked / counter 0 / locked day / offline); confirm sheet copy incl. remaining count; cancel changes nothing; unmark-everything restores the chip.
- Playwright: parity/screenshot frames (chip on pristine card; chip absent after one mark; confirm sheet; intro overlay on first open, absent on second).

## Acceptance criteria

- Given a pristine Day 2 card and `reshufflesUsed = 1`, when I confirm a reshuffle, then I get a new 24-prompt card from the same snapshot, the chip shows ×1, and nothing else in the game changed (Feed, tallies, stats identical).
- Given one marked square, then the chip does not render and a forced write is denied by rules; after unmarking it, the chip renders again.
- Given `reshufflesUsed = 3`, then the chip never renders and a forced write is denied.
- Given my first app open after deploy, the intro overlay shows exactly once.
- Cancel ("Keep my card") changes nothing.

## Definition of Done

specs/reshuffle.md + matching tests green (alignment CI); typecheck/build/md-prose-wrap green; PR references this ticket + "Closes #<issue>"; driven through REVIEW_POLICY.md (Phase 4—rules touched) to merge; deployed and verified live before Day 2's 08:00 unlock if possible—this is the launch-day feature.
