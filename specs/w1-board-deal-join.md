# Board render + deal/freeze-at-join (w1-board-deal-join)

Feature: a Player's Board is dealt once, at join, from the active non-free Prompt pool and then frozen — 24 sampled Prompts plus the always-marked "Complain about Circuit Music" Free Space centre, rendered as a 5×5 card. There is NO re-deal and NO Square-swap (ADR 0003). When the active pool is too thin to fill a card (< 24 Prompts, ADR 0004) the deal guard is surfaced to the Player instead of a blank, forever-spinning card.

## Contract

- `src/game/logic.ts` — `dealBoard(pool, freeText, seed)` deals a frozen 5×5 Board deterministically from `seed`: 24 Prompts sampled from `pool` plus the free centre at index `CENTER` (12), which is `free: true` and `marked: true`. It throws when `pool.length < MIN_POOL` (24) rather than persisting a card with blank cells. `MIN_POOL` is the single source of truth for the 24-Prompt floor, shared by the deal and the Board render.
- `src/data/api.ts` — `joinAndDeal(u)` freezes the Board at join: it early-returns when a Board already exists for the uid (re-joining never re-deals), otherwise reads the active, non-free Prompt pool (`items` where `status == 'active'` and `!isFreeSpace`), deals via `dealBoard` seeded per-uid (`seedFromUid`), and batch-writes the `boards/{uid}` doc plus the Player row. The `dealBoard` throw propagates (it is not caught here), so a thin pool never persists a broken Board.
- `src/components/Board.tsx` — renders the dealt Board's 25 Squares under the fixed `B I N G O` header: each cell shows its `text` verbatim (for the free centre, that is the seeded `FREE_TEXT`, "Complain about Circuit Music" — never the literal string "FREE") and reflects `marked` / `pending` / winning state. There is no re-deal, shuffle, or Square-swap control anywhere on the card. Before a Board exists, the component surfaces the ADR 0004 guard: once the active non-free pool has loaded and is `< MIN_POOL`, it shows the "not enough prompts" message (`role="alert"`) rather than the neutral "Dealing your card…" state, so a thin pool is never rendered as a blank card. While there is no Board yet, Board also subscribes to `useItems` to watch the pool for two purposes: sizing the ADR 0004 guard above, and auto-retrying a failed deal — once the active non-free pool crosses back over `MIN_POOL` while `AuthContext`'s `dealError` is set and no deal is already in flight, Board calls `retryDeal()` once per recovery (not once per snapshot), so a Player who adds enough Prompts doesn't have to notice and press Retry themselves. Once a Board exists, `useItems` is disabled (no live pool listener) — the pool is irrelevant to a Player whose card is already frozen.

## Acceptance criteria

- Given an active pool of ≥ 24 Prompts, when a User joins, then a frozen 5×5 Board is dealt once (24 Prompts + Free Space) and re-joining does not re-deal or swap any Square.
- Given an active pool of < 24 Prompts, when a User joins, then `dealBoard`/`joinAndDeal` throw rather than persisting a blank Board, and the Board render surfaces the guard to the Player (ADR 0004) instead of a blank card.
- The Free Space centre reads "Complain about Circuit Music" (the seeded `FREE_TEXT`), is always marked, and counts toward completed lines.
- No re-deal / Square-swap affordance exists on the Board (ADR 0003).
- Given a deal error is up (a thin pool at join) and no Board yet, when the active non-free pool crosses back over `MIN_POOL`, then Board calls `retryDeal()` exactly once for that recovery — not once per subsequent pool snapshot, and not while a deal is already in flight or a Board already exists.
- Given a Player already has a Board, the pool subscription (`useItems`) is disabled — no live listener stays open on prompts that can no longer affect an already-frozen card.

## Test coverage

`src/components/w1-board-deal-join.test.tsx` (Vitest, RTL-jsdom + firestore-mocked unit):

- Board render — a real `dealBoard` result (from the seed pool) rendered through `Board`: exactly 25 Squares, one Free Space at the centre marked and reading the seeded `FREE_TEXT` ("Complain about Circuit Music", never the literal string "FREE"), and no re-deal / shuffle / swap / "new card" control present.
- Board deal guard — with no Board yet and the active non-free pool `< MIN_POOL`, `Board` shows the guard alert; with the pool `≥ MIN_POOL` (or still loading) it shows the neutral "Dealing…" state, proving the guard fires only on a genuinely thin pool, not on an in-flight deal.
- Board auto-retry after pool recovery — with no Board, a deal error up, and no deal in flight, `retryDeal` fires exactly once when the pool crosses `MIN_POOL`, and not again on later snapshots at/above the floor; it does not fire while a deal is in flight, while there is no deal error, or once a Board exists.
- Board pool-listener gate — `useItems` is called with `enabled: true` while there is no Board, and `enabled: false` once a Board exists.
- `joinAndDeal` freeze-at-join — with an existing Board doc it early-returns without reading the pool or writing (no re-deal); with no Board and a healthy pool it deals once and batch-writes a 25-cell Board whose centre is the marked `FREE_TEXT` ("Complain about Circuit Music"), excluding the Free Space item from the sampled Prompts.
- `joinAndDeal` guard propagation — with no Board and a pool of `< MIN_POOL` active Prompts, the deal throws and no Board doc is committed (the api-layer half of the "not a blank Board" criterion).

`src/hooks/useData.test.ts` (Vitest, firestore-mocked unit) — proves the `useItems` `enabled` gate against the real hook: subscribes (one `onSnapshot` call) by default and when re-enabled, opens zero `onSnapshot` calls while disabled.

The pure `dealBoard` contract — deterministic sampling, 24 unique Prompts + null centre, and the `< 24` throw — is unit-tested in `src/game/logic.test.ts` (owned by the test-harness ticket) and not duplicated here.

The Player-facing sign-in-time surfacing of a failed deal (the initial `DealError` retry surface, distinct from this Board-side empty-state) is wired in the auth/App join effect and owned by the auth ticket. This spec owns the Board-side render guard that keeps a thin pool from showing as a blank card, and the pool-recovery auto-retry that re-invokes `AuthContext`'s `retryDeal()` once the Player has added enough Prompts.
