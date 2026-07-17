**Track:** backend · **Phase:** 1.5 · **Wave:** 0 · **Size:** L · **Cut line:** must-have

**needs-phase-4** (protected path / keep PR small)

## Context & scope
Add the scheduled `unlockDay` Cloud Function that implements `daily-cards-spec.md` § "Unlock mechanics" (Snapshot at unlock) and § "Security rules and functions (shape only)": one daily 08:00 Europe/Rome run that stamps each unlocking Day's `snapshotItemIds` — every `status: 'active'` item in that Day's Pool at that moment — plus the two-beat finale from § "Scoring and social surfaces": a 20:00 Day 9 last-call Moment and an 08:00 Day 10 freeze + podium Moment. Also adds the admin manual "unlock now" fallback for function lag/failure. This ticket owns the scheduled TRIGGERS and the snapshot/freeze WRITES only; the finale's actual standings/podium content composition is #__NUM_d15-scoring-aggregates__ / #__NUM_d15-finale__, and this ticket's Moments carry only the minimal payload those tickets need to render.

## Current state
- `functions/src/index.ts` — no scheduled function exists today. Every export is either an `onCall` (`submitBugReport`, `:28-31`), an `onObjectFinalized` Storage trigger (`moderateProof`, `:98-100`, env-gated per `visionGate.ts`), or an `onDocumentWritten` Firestore trigger (`notifyProofModeration`/`notifyItemModeration`/`hideProofAtThreshold`/`hideItemAtThreshold`/`backfillHideOnThresholdDecrease`, `:130-215`). `functions/package.json` pins `firebase-functions ^5.1.0`, which exports `onSchedule` from `firebase-functions/v2/scheduler` — no new dependency needed.
- `src/components/PoolRecoveryWatcher.tsx` is the cited "manual admin unlock now" precedent from the spec, but it is a CLIENT component watching for pool recovery, not a backend admin action — it establishes the UI PATTERN (an admin-facing recovery affordance for a server-side condition the client can observe), not a reusable function. The manual "unlock now" here needs its own admin-gated `onCall`, following the `submitBugReport` shape for a callable Function, not `PoolRecoveryWatcher`'s shape.
- **Missing:** any scheduled trigger; any snapshot-stamping logic; any finale-beat logic; any `EventDoc.frozenAt` write path.

## Files to create / modify
- `functions/src/unlockDay.ts` (new) — pure, DI'd core logic (which Days are due to unlock/snapshot/finale-beat given `now` + the Event's `days[]`; idempotency check against already-stamped `snapshotItemIds`) so it is unit-testable without a Functions runtime, mirroring `autohide.ts`'s split between decision logic and the thin trigger seam in `index.ts`.
- `functions/src/index.ts` (modify) — wire `onSchedule({ schedule: '0 8 * * *', timeZone: 'Europe/Rome' }, ...)` calling into `unlockDay.ts`'s snapshot logic for the Day(s) whose `unlockAt` has just passed; a second scheduled run (or a single daily run that also checks the Day-9-20:00 / Day-10-08:00 finale boundaries — implementer's call, document the choice) for the finale beats; a new admin-gated `onCall` for the manual "unlock now" fallback, following the `submitBugReport` pattern (own runtime service account not required — this one touches Firestore, so the default Functions identity is fine, unlike the sandboxed bug-report intake).
- `tests/functions/d15-scheduler-unlock.test.ts` (new) — the functions-layer assertions (harness precedent: `tests/functions/` suite structure, `functions/src/autohide.ts`'s DI style).

## Implementation notes
- **Snapshot at unlock**, verbatim: "a scheduled Cloud Function (one daily run at 08:00 Europe/Rome, tolerant of retries/idempotent) writes `snapshotItemIds` for the unlocking Day: all `status: 'active'` items in that Day's pool at that moment." Idempotent means: if a Day already carries `snapshotItemIds`, a re-run (retry, or a second invocation on the same day) is a no-op for that Day — never re-stamp or overwrite an existing snapshot.
- **Client fallback**, per spec: "if the client's clock says a Day is unlocked but the snapshot isn't stamped yet (function lag), the client waits and shows the locked state with a 'waking up' message rather than dealing from an unfrozen pool." That client behavior is #__NUM_d15-dealing__'s job; this ticket only has to make the snapshot arrive reliably and be safely re-runnable.
- **Manual "unlock now" fallback**: admin-only `onCall`, precedent "admin-triggered recovery in PoolRecoveryWatcher" (the UI pattern, not the code) — it forces the same idempotent snapshot logic for a specific Day on demand, so it can never diverge from the scheduled path's semantics.
- **Embark Day exception**: the embark Day's `unlockAt` is Event-open time, not 08:00 on its date (per spec § "Unlock mechanics") — the daily scheduled run should snapshot it the same way as any other Day whose `unlockAt` has passed; no special-cased trigger is needed, only that `DayDef.unlockAt` for the embark Day is set correctly by #__NUM_d15-tutorial-seed__.
- **Farewell unlock** (resolved 2026-07-11): standard 08:00 rule, no Day-9-evening special case — only the FINALE beats (last-call Moment, freeze) are pinned to specific clock times independent of any Day's `unlockAt`.
- **The finale — two-beat finish** (resolved 2026-07-11), verbatim: "at 20:00 on Day 9 the scheduler posts a last-call Moment with going-into-the-final-night standings... At 08:00 on Day 10 the standings freeze (event `frozenAt`), the farewell Day unlocks, and the farewell view opens with the podium." This ticket sets `EventDoc.frozenAt` and posts the two Moments (`kind: 'last_call'` and `kind: 'podium'`, from #__NUM_d15-schema-contract__'s `MomentKind` addition); the standings/podium CONTENT (who's leading, the honors strip) is computed by #__NUM_d15-scoring-aggregates__ / #__NUM_d15-finale__ and this ticket's trigger calls into that computation rather than re-deriving it.
- Best-effort/idempotent wrapping follows the `autohide.ts`/`notify.ts` precedent — a moderation-adjacent write failing must never crash the whole scheduled run; log and continue to the next Day.

## Tests to add
- `tests/functions/d15-scheduler-unlock.test.ts` — a Day whose `unlockAt` has passed and carries no `snapshotItemIds` gets stamped with exactly the `status: 'active'` items in its Pool at call time (layer: functions).
- `tests/functions/d15-scheduler-unlock.test.ts` — running the snapshot logic TWICE against the same already-stamped Day is a no-op (idempotency; layer: functions).
- `tests/functions/d15-scheduler-unlock.test.ts` — a Day whose `unlockAt` is still in the future is left untouched (layer: functions).
- `tests/functions/d15-scheduler-unlock.test.ts` — the Day-9-20:00 boundary posts exactly one `last_call` Moment and does not touch `frozenAt`; the Day-10-08:00 boundary sets `frozenAt` and posts exactly one `podium` Moment (layer: functions).
- `tests/functions/d15-scheduler-unlock.test.ts` — the manual "unlock now" `onCall` produces the identical snapshot result as the scheduled path for the same Day, and is denied for a non-admin caller (layer: functions).

## Acceptance criteria
- **Given** a Day whose `unlockAt` has just passed **When** the scheduled function runs **Then** `snapshotItemIds` is stamped with that moment's active Pool items, and a retry of the same run does not re-stamp it.
- **Given** function lag past a Day's `unlockAt` **When** an admin triggers "unlock now" for that Day **Then** the same idempotent snapshot logic runs on demand.
- **Given** 20:00 on Day 9 **When** the scheduler runs **Then** exactly one `last_call` Moment posts and `frozenAt` is untouched; **given** 08:00 on Day 10, **then** `frozenAt` is set and exactly one `podium` Moment posts.
- [ ] `unlockDay` scheduled trigger wired and idempotent.
- [ ] Manual "unlock now" admin `onCall` added.
- [ ] Finale two-beat triggers wired (20:00 Day 9 / 08:00 Day 10).
- [ ] PR kept under 300 lines.

## Definition of Done
- [ ] Spec `specs/d15-scheduler-unlock.md` created **with a matching test** (checker `scripts/ci/check_spec_test_alignment` matches basename → a test under `tests/**` or `src/**/*.test.*`; design-only specs use frontmatter `tested: false` + `reason:`)
- [ ] `npm run typecheck` · `npm test` · `npm run build` green; `md-prose-wrap` clean
- [ ] PR body `Closes #<this issue>`; authored `nathanjohnpayne`, driven through `REVIEW_POLICY.md` to merge (needs-phase-4: expect external review, not just under-threshold self-approval)
- [ ] Board discipline per `docs/agents/ticket-workflow.md` (claim → In progress; PR → In review; merge → Done)

## Dependencies
- Depends on #__NUM_d15-schema-contract__ — writes `DayDef.snapshotItemIds`, `EventDoc.frozenAt`, and the `last_call`/`podium` `MomentKind`s it defines.
- Blocks #__NUM_d15-dealing__ — dealing waits on a stamped snapshot before dealing a Day Card.
- Blocks #__NUM_d15-scoring-aggregates__ — the finale beats this ticket triggers call into that ticket's standings computation.
- Blocks #__NUM_d15-finale__ — the finale content ticket assumes these triggers already exist.

## Recommended agent
claude-opus-4-8@high — protected-path scheduled/backend logic with idempotency and finale-timing correctness at stake; needs careful review.
