---
spec_id: w1-board-mark-win
status: accepted
---

# w1-board-mark-win — Mark a Square + BINGO/Blackout detection + celebration (offline-durable Marks)

This ticket owns the client-authoritative Mark write path. A Player Marks a Square through `setMark`; `hasBingo`/`isBlackout` drive the `Celebration` overlay on a new line or blackout. The core rework makes the Mark write **offline-queueable**: `setMark` previously ran a `runTransaction`, but Firestore transactions need a server round-trip and **reject while offline**, so a Mark made in a ship-wifi dead zone was dropped instead of queuing durably in the ADR-0006 persistent local cache — and the old `Board.tsx` catch comment ("the live listener reconciles when back online") was therefore false. This ticket rewrites the write to a plain batched write the cache queues, adds the offline-survives-reload proof, and corrects the comment. Per ADR 0001 Marks are client-authoritative and Honor mode Marks instantly; per ADR 0002 a bare Mark posts NOTHING to the Feed.

## The change

- `src/data/api.ts` — `setMark` no longer opens a `runTransaction`. It splits into a pure `computeMark` (the fold of one toggle into the next `cells` + denormalized Player stats: `squaresMarked`, `bingoCount`, `firstBingoAt`, `blackout`) and a `writeBatch` that writes `boards/{uid}` + `players/{uid}` and is **not awaited** (see concurrency note). An optional `database` param is the test seam for the emulator layer; production callers pass nothing and get the app `db`.
- `src/components/Board.tsx` — the false offline comment at the `doMark` catch is replaced with the truth: an offline Mark does not reject; it queues durably in the persistent cache (ADR 0006, #20) and syncs on reconnect. Honor mode still Marks instantly, and the BINGO/Blackout transition effect still fires `Celebration`.
- `src/components/Celebration.tsx` and `src/game/logic.ts` are unchanged: the overlay already renders both kinds, and `hasBingo`/`isBlackout`/`winningCells`/`completedLines` are already pure and tested — the transition wiring lives in `Board.tsx`'s effect, which is correct.

## Concurrency design decision (offline-queueable write)

The transaction protected a read-modify-write of the Board doc against a concurrent Mark from another tab/device. That protection is dropped deliberately, because it is incompatible with offline queuing and unnecessary here:

- A Board is **single-writer by design** — firestore.rules lets only the owner write `boards/{uid}` and `players/{uid}` (ADR 0001, self-writable BY DESIGN). There is no other writer to race with.
- The live `onSnapshot` listener keeps the caller's `cells` current across the Player's own tabs via the **shared persistent cache** (multi-tab manager), so the local snapshot `computeMark` folds over is already up to date before the write.
- The write is therefore **last-write-wins on the owner's own Board**, computed from the local snapshot — no server read, so nothing forces a round-trip. `firstBingoAt` is preserved/cleared from the caller's live `currentFirstBingoAt` (the `useMyPlayer` value) instead of a transactional read of the Player row.

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

### Offline — the real setMark path survives a reload before any sync, then syncs

Runner: `firebase emulators:exec --only auth,firestore "vitest run --config vitest.offline.config.ts"` (jsdom + `fake-indexeddb` + the SDK's `USE_MOCK_PERSISTENCE` hatch; scoped to `tests/offline/**`). Test: `tests/offline/w1-board-mark-win.test.ts`.

- A Board + Player are dealt online and synced; then, OFFLINE (`disableNetwork`), a Square is Marked through the real `setMark` and lands in the persistent cache as a pending, from-cache write (`metadata.hasPendingWrites === true`, `fromCache === true`) with the Square set.
- The reload happens while STILL OFFLINE: the client is terminated with the write pending, so the Mark exists nowhere but the persisted queue. An independent observer proves via `getDocFromServer` that the server's Board still has the Square **unmarked** — the Mark did not sync.
- A "reloaded" client — SAME app name (Firestore keys its IndexedDB store by app name), SAME uid — recovers the queued Mark and drains it: `waitForPendingWrites` completes, and server-side (`fromCache === false`, no pending writes) the Square is marked AND the denormalized Player stats followed (`squaresMarked === 1`, `bingoCount === 0`), read both by the reloaded client and the independent observer.
- A bare Mark writes nothing to the Feed: the `moments` collection is empty on the observer after the Mark syncs (ADR 0002).
- Fail-loud property (mutation-verified during development): reverting `setMark` to a `runTransaction` makes this suite fail at the offline Mark — the transaction rejects instead of queuing.

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
