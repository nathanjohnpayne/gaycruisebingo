---
spec_id: w1-board-mark-win
status: accepted
---

# w1-board-mark-win — Mark a Square + BINGO/Blackout detection + celebration (offline-durable Marks)

This ticket owns the client-authoritative Mark write path. A Player Marks a Square through `setMark`; `hasBingo`/`isBlackout` drive the `Celebration` overlay on a new line or blackout. The core rework makes the Mark write **offline-queueable**: `setMark` previously ran a `runTransaction`, but Firestore transactions need a server round-trip and **reject while offline**, so a Mark made in a ship-wifi dead zone was dropped instead of queuing durably in the ADR-0006 persistent local cache — and the old `Board.tsx` catch comment ("the live listener reconciles when back online") was therefore false. This ticket rewrites the write to a plain batched write the cache queues, adds the offline-survives-reload proof, and corrects the comment. Per ADR 0001 Marks are client-authoritative and Honor mode Marks instantly; per ADR 0002 a bare Mark posts NOTHING to the Feed.

## The change

- `src/data/api.ts` — `setMark` no longer opens a `runTransaction`. It splits into a pure `computeMark` (the fold of one toggle into the next `cells` + denormalized Player stats: `squaresMarked`, `bingoCount`, `firstBingoAt`, `blackout`) and a `writeBatch` that writes `boards/{uid}` + `players/{uid}` and is **not awaited** (see concurrency note). Before folding, `setMark` reads the Board via `getDocFromCache` — a cache-only read, still no server round trip — and uses it as the base `cells` whenever one is cached, falling back to the caller-supplied `cells` only when nothing is cached yet (see concurrency note for why). An optional `database` param is the test seam for the emulator layer; production callers pass nothing and get the app `db`.
- `src/components/Board.tsx` — the false offline comment at the `doMark` catch is replaced with the truth: an offline Mark does not reject; it queues durably in the persistent cache (ADR 0006, #20) and syncs on reconnect. Honor mode still Marks instantly, and the BINGO/Blackout transition effect still fires `Celebration`.
- `src/components/Celebration.tsx` and `src/game/logic.ts` are unchanged: the overlay already renders both kinds, and `hasBingo`/`isBlackout`/`winningCells`/`completedLines` are already pure and tested — the transition wiring lives in `Board.tsx`'s effect, which is correct.

## Concurrency design decision (offline-queueable write)

The transaction protected a read-modify-write of the Board doc against a concurrent Mark. That transactional protection is dropped deliberately, because it is incompatible with offline queuing — but the caller's render-time `cells` prop turned out **not** to be a safe stand-in for it, and shipping on that prop alone was a real bug caught in verification, not a defensible simplification. The reasoning, corrected:

- A Board is **single-writer by design** — firestore.rules lets only the owner write `boards/{uid}` and `players/{uid}` (ADR 0001, self-writable BY DESIGN). No *other Player* ever races this write.
- That is **not** the same claim as "no race exists." The owner can race **themself**: two Marks fired in quick succession (two fast taps, or two of the owner's own tabs) both fire before the live `onSnapshot` listener has re-rendered the caller with the first Mark's result, because that echo is asynchronous, never synchronous with the write. A first cut of this ticket folded `computeMark` directly over the caller-supplied `cells` prop, reasoning that "the shared persistent multi-tab cache keeps the caller's cells current" — but current *eventually*, not before the very next tap. Two `setMark` calls issued back-to-back off the same stale `cells` prop is a fully reproducible data loss: `computeMark` maps over whatever `cells` it is given and returns a complete replacement array, and `{ merge: true }` on a Firestore **array** field replaces the field wholesale rather than merging element-by-element — so the second write silently erased the first Mark (and recomputed `squaresMarked`/`bingoCount` without it). Confirmed with a unit test driving `computeMark`/`setMark` twice off one stale snapshot, and an emulator test firing two real `setMark` calls back-to-back; both failed against the caller's-`cells`-only version and pass against the fix below.
- The fix has two layers, and both are load-bearing. **Layer 1 — fold onto local truth:** `setMark` folds onto `getDocFromCache(boardRef)` (and, for `firstBingoAt`, `getDocFromCache(playerRef)`) instead of trusting the caller's props. That is a **cache-only read — no server round trip, still fully offline-capable** — and it sees this client's own just-applied mutation (and, via the shared persistent multi-tab cache, another of the owner's tabs' already-synced ones) far sooner than a cross-process `onSnapshot` re-render can. Each read falls back to its caller-supplied param only when nothing is cached yet (the very first local knowledge of the doc — never reachable in production, where `Board.tsx` only renders Marks once a Board has already loaded).
- **Layer 2 — serialize overlapping calls (Codex P1, PR #75):** the cache read alone is necessary but not sufficient, because `Board.toggle` fires `doMark` without awaiting it — two overlapping `setMark` calls could both pass their cache reads before either had issued its batch, folding onto the same cached board and reproducing the clobber one level up. `setMark` therefore chains per board (a module-level promise chain keyed on database + uid): each call's cache read runs only after the previous call has issued its `writeBatch`, whose latency compensation applies to the local cache at issue time. A failed Mark settles its link without poisoning the chain. Proven by an overlap unit test whose fake cache returns the last batch-written board (both unawaited Marks land; the mock fails against an unserialized `setMark`) and an emulator test firing two truly concurrent `setMark` calls offline via `Promise.all` — both Marks and `squaresMarked: 2` reach the server after reconnect.
- Honest residual scope: the chain + cache fold close every same-process race (rapid taps, fire-and-forget overlap, same-process multi-tab). A true simultaneous write from two *separate* tabs/devices, timed within the multi-tab cache's own propagation window, is not fully eliminated — closing that completely would need a transactional (server-round-trip, non-offline-queueable) read, which is exactly the property this rework trades away. Given ADR 0001's non-adversarial, single-Player-usually-single-tab threat model, that residual is accepted rather than hidden behind an overclaim.

`commit()` is intentionally not awaited: offline it resolves only on a server ack that may never come in this tab's lifetime, whereas the write lands in the local cache synchronously (latency compensation) and the listener reflects it at once — so the Mark is instant and the win result returns from the local compute, not the network.

## Claim → test

Every claim maps to an assertion in the named test (no vacuous coverage).

### Unit — `computeMark` (win detection + stats) and `setMark` (write shape)

Runner: `npm test` (Vitest, jsdom). Test: `src/data/w1-board-mark-win.test.ts`.

- Marking a Square sets `marked`/`markedAt`/`status: 'confirmed'` and counts it (`squaresMarked`).
- Completing a line is a BINGO (`bingo === true`, `bingoCount === 1`) and stamps `firstBingoAt` with `now`; a further Mark while the BINGO stands **preserves** the earlier `firstBingoAt`; unmarking away the last BINGO **clears** `firstBingoAt` to `null` and drops `bingoCount` to 0.
- An `admin_confirmed` Mark starts `status: 'pending'` and so does not yet count toward `squaresMarked` or a line (the mask excludes pending).
- Marking the final Square is a Blackout (`blackout === true`).
- `setMark` writes **exactly two** docs in one batch — `boards/{uid}` then `players/{uid}`, both partial `{ merge: true }` — carrying the toggled cell and the recomputed stats. It calls **no `addDoc`** (ADR 0002: a bare Mark posts nothing to the Feed) and **no `runTransaction`** (ADR 0006: offline-queueable), and fires a single fire-and-forget `commit()` while returning the win result synchronously.
- **Concurrency fix:** when `getDocFromCache` resolves a cached Board with a Mark the caller's `cells` prop does not yet know about, `setMark`'s write folds onto the cached state — both Marks survive (`squaresMarked` counts both), not just the caller's own toggle. When nothing is cached (or the cached doc does not exist), it falls back to the caller-supplied `cells` exactly as before.

### Offline — the real setMark path survives a reload before any sync, then syncs, and two rapid Marks don't clobber

Runner: `firebase emulators:exec --only auth,firestore "vitest run --config vitest.offline.config.ts"` (jsdom + `fake-indexeddb` + the SDK's `USE_MOCK_PERSISTENCE` hatch; scoped to `tests/offline/**`). Test: `tests/offline/w1-board-mark-win.test.ts`.

- A Board + Player are dealt online and synced; then, OFFLINE (`disableNetwork`), a Square is Marked through the real `setMark` and lands in the persistent cache as a pending, from-cache write (`metadata.hasPendingWrites === true`, `fromCache === true`) with the Square set.
- The reload happens while STILL OFFLINE: the client is terminated with the write pending, so the Mark exists nowhere but the persisted queue. An independent observer proves via `getDocFromServer` that the server's Board still has the Square **unmarked** — the Mark did not sync.
- A "reloaded" client — SAME app name (Firestore keys its IndexedDB store by app name), SAME uid — recovers the queued Mark and drains it: `waitForPendingWrites` completes, and server-side (`fromCache === false`, no pending writes) the Square is marked AND the denormalized Player stats followed (`squaresMarked === 1`, `bingoCount === 0`), read both by the reloaded client and the independent observer.
- A bare Mark writes nothing to the Feed: the `moments` collection is empty on the observer after the Mark syncs (ADR 0002).
- Fail-loud property (mutation-verified during development, re-verified in review): reverting `setMark` to a `runTransaction` makes this suite fail at the offline Mark — the transaction rejects instead of queuing.
- **Concurrency regression test:** two real `setMark` calls fired back-to-back (offline, no listener wait between them) off the same stale snapshot — index 3 then index 9 — both survive to the server (`cells[3].marked === true`, `cells[9].marked === true`, `squaresMarked === 2`) once reconnected. Mutation-verified: reverting the `getDocFromCache` fold to the caller's-`cells`-only version fails this test (`cells[3].marked` comes back `false` — the second write clobbered the first), confirmed during review and restored.

## Scope and environment (honest bounds)

- No server-side stat recompute (ADR 0001): stats are Player-written; any Phase-1 recompute would be consistency/repair, never anti-cheat. `setMark` writes only the Player's own Board + stats.
- The Tally write is NOT in scope — #31 extends this Mark write set to publish the per-Prompt Tally (ADR 0002). Moments (#34) and Proof/Doubt capture (`proof_required`/`admin_confirmed` flows) are downstream; this ticket keeps Honor Marks instant and leaves proof capture to `ProofSheet`.
- The offline layer's IndexedDB semantics come from `fake-indexeddb` unlocked by the SDK's `USE_MOCK_PERSISTENCE=YES` hatch; the test clients use the DEFAULT single-tab manager (the node build hard-disables multi-tab), while `src/firebase.test.ts` pins the production multi-tab config. Real-browser IndexedDB stays the e2e layer's concern.
- These app + offline tests are not CI-run; they are recorded in the commit `Verified:` trailer.

## Acceptance criteria

- Given a dealt Board, when a Player Marks a Square in Honor mode, then it Marks instantly and `hasBingo`/`isBlackout` fire the `Celebration` on a new line/blackout — `src/data/w1-board-mark-win.test.ts` (compute) + the `Board.tsx` transition effect.
- Given a Player Marks offline, when they reload, then the Mark is still queued and syncs on reconnect (ADR 0006 offline metric) — `tests/offline/w1-board-mark-win.test.ts`.
- Given a bare Mark (no Proof), when it is written, then nothing posts to the Feed (ADR 0002) — `setMark` write-shape (no `addDoc`) + the offline test's empty `moments`.
- `Board.tsx` false offline comment corrected; no server-side stat recompute justified as anti-cheat (ADR 0001).
