---
spec_id: d15-scheduler-unlock
status: accepted
---

# Phase 1.5 daily scheduler: `unlockDay` snapshot + finale beats + manual unlock (#202)

Implements `plans/daily-cards-spec.md` § "Unlock mechanics" (Snapshot at unlock), § "Security rules and functions (shape only)", and the finale from § "Scoring and social surfaces". This ticket owns the scheduled TRIGGERS and the snapshot / freeze WRITES only — the standings and podium CONTENT are #212 / #217, and the Moments this posts carry only the minimal payload those tickets render. It depends on #200 (`DayDef.snapshotItemIds`, `EventDoc.frozenAt`, the `last_call` / `podium` `MomentKind`s) and unblocks #204 (dealing waits on a stamped snapshot), #212, and #217.

The decision logic and every idempotent write live in `functions/src/unlockDay.ts` as pure, dependency-injected functions, mirroring `functions/src/autohide.ts`'s split between decision logic and the thin `functions/src/index.ts` trigger seam. The module imports no `firebase-admin` / `firebase-functions`; the admin-SDK Firestore surface is passed in, so the whole flow is unit-testable without a Functions runtime and no live backend is touched under test.

## What it does

- **Snapshot at unlock.** For every Day whose `unlockAt` has passed and which carries no `snapshotItemIds` yet, stamp the Day with the ids of every `status: 'active'` item in that Day's pool at that moment. This is how items approved mid-cruise "get in": they enter every not-yet-unlocked Day, never an already-dealt one. The embark Day needs no special case — its `unlockAt` is Event-open time (set by #207), so the daily run snapshots it the same way as any other passed Day.
- **Idempotency.** `snapshotItemIds == null` (absent) is the only unstamped state; an empty array `[]` is a valid stamp (a pool with no active items) and is never re-stamped or overwritten. The item query runs before a transaction that re-confirms the Day is still due and still unstamped before writing, so a retry or a second same-day run is a no-op (the `autohide.ts` read-then-transactional-write pattern).
- **Manual "unlock now" fallback.** `manualUnlockNow` forces the SAME idempotent snapshot for one Day on demand, covering function lag or failure. It is admin-gated — the caller's uid must be on the event's `admins` roster (the `firestore.rules` `isAdmin` rule) — and calls the identical `stampDaySnapshot` the scheduled path uses, so the two can never diverge. A non-admin caller trips `UnlockPermissionError`, mapped at the trigger seam to a `permission-denied` HttpsError.
- **The finale two-beat finish.** At 20:00 on Day 9 the scheduler posts exactly one `last_call` Moment (`frozenAt` untouched). At 08:00 on Day 10 — the farewell Day's `unlockAt` — it sets `EventDoc.frozenAt` and posts exactly one `podium` Moment. `finaleTimes` derives the boundaries from the Day schedule: the freeze/podium anchor to the farewell Day's own `unlockAt`, and the last-call to Day 9's 08:00 `unlockAt` + 12h = 20:00 (a same-day forward offset, so no midnight/DST cross). Exactly-once is enforced by the `frozenAt` transactional flip (only the winning run posts the podium) and by an existing-`last_call`-Moment dedupe.

## Design choices (the issue leaves these to the implementer)

- **Two daily runs, not one.** `functions/src/index.ts` exports two `onSchedule` triggers in Europe/Rome that call the same idempotent core (`runScheduledUnlock`) for every active event: the `0 8 * * *` run owns the Day snapshots and the Day-10 08:00 freeze + podium; the `0 20 * * *` run catches the Day-9 20:00 last-call. Because every beat is self-guarded, a run on any other day, or a retry, posts nothing.
- **Default Functions identity.** Unlike the sandboxed bug-report intake, the manual `onCall` and the scheduled runs use the default Functions service account — they only touch Firestore, which that identity can write.
- **DST caveat.** The 12h last-call lead assumes the sailing window does not cross a Europe/Rome DST switch (true for this event); under standard time the 20:00 cron lands inside `[lastCallAt, farewellUnlockAt)`.

## Acceptance criteria

- **Given** a Day whose `unlockAt` has just passed and which carries no `snapshotItemIds`, **when** the scheduled function runs, **then** the Day is stamped with exactly that moment's `status: 'active'` items in its pool (legacy no-`pool` items counting as `main`), and a retry of the same run does not re-stamp it.
- **Given** function lag past a Day's `unlockAt`, **when** an admin triggers "unlock now" for that Day, **then** the same idempotent snapshot logic runs and produces the identical result the scheduled path would; a non-admin caller is denied.
- **Given** a Day whose `unlockAt` is still in the future, **when** the scheduled function runs, **then** that Day is left untouched.
- **Given** 20:00 on Day 9, **when** the scheduler runs, **then** exactly one `last_call` Moment posts and `frozenAt` is untouched; **given** 08:00 on Day 10, **then** `frozenAt` is set and exactly one `podium` Moment posts.

## Test coverage

`tests/functions/d15-scheduler-unlock.test.ts` (Vitest, `npm run test:functions`, node env — every Firestore seam is an in-memory fake, no live runtime): the due-and-unstamped gate and its idempotency, the active-items-in-pool filter with the legacy-`main` default, `stampDaySnapshot` stamping / not-due / idempotent-retry, the `finaleTimes` / `finaleActions` boundaries, the last-call and freeze+podium beats through `runScheduledUnlock`, and `manualUnlockNow`'s scheduled-parity and non-admin denial.
