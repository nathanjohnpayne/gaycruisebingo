**Track:** security · **Phase:** 1.5 · **Wave:** 0 · **Size:** L · **Cut line:** must-have

**needs-phase-4** (protected path / keep PR small)

## Context & scope
Reconcile `firestore.rules` to the day-scoped Board model in `daily-cards-spec.md` § "Security rules and functions (shape only)": Boards move under `days/{dayIndex}`, gated on that Day's `unlockAt`; Pending/Rejected Prompts stay invisible outside the Admin queue and their own submitter; and the per-day `firstBingo` honor is write-once. HOT owner of `firestore.rules`. This ticket is rules-only — the client write paths that produce these payloads (dealing, approvals, day meta) are separate Wave-1/2 tickets; this ticket only has to prove the rule shape with emulator tests, using hand-built payloads.

## Current state
- `firestore.rules` — `boards/{uid}` (`:140-142`) is a flat, self-writable-by-design collection (ADR 0001) with no unlock gate and no day scoping: `allow read, write: if isOwner(uid) || isAdmin(eventId);`. `items/{itemId}` (`:81-118`) reads gate on `status == 'active'` only for non-admins (`:91`) — there is no `pending`/`rejected` status and no submitter-visibility carve-out. There is no `days/{dayIndex}` collection and no day-meta doc at all.
- **FROZEN, kept as-is:** the `proofs`/`claims`/`tally`/`doubts`/`moments` rule blocks (`:144-377`) — Phase 1.5 only threads an optional `dayIndex` through payloads the write-side already validates elsewhere; no rule shape changes there. The self-writable-by-design posture on `players`/`boards` (ADR 0001) stays exactly as intentional as it is today — a reviewer "locking it down" has misread the design, same as `w0-firestore-rules`.
- **Being revised:** `boards/{uid}` moves to `days/{dayIndex}/boards/{uid}` with an unlock-time gate; `items/{itemId}` reads gain a `pending`/`rejected` carve-out; a new `days/{dayIndex}/meta` doc gains a write-once `firstBingo` rule.

## Files to create / modify
- `firestore.rules` (modify, HOT owner) — move the `boards` match block under `days/{dayIndex}`; add the unlock-time write gate; extend the `items` read/update rules for `pending`/`rejected`; add a `days/{dayIndex}/meta` match block.
- `tests/rules/d15-firestore-rules.test.ts` (new) — the emulator assertions (harness precedent: `tests/rules/firestore-harness.test.ts`, `tests/rules/w0-firestore-rules.test.ts`).

## Implementation notes
- **Board write gate**, verbatim per spec: "write allowed only when `request.time >= day.unlockAt` and the board doc doesn't exist (deal) or is the owner's (marks)." Read `day.unlockAt` via `get(/databases/$(database)/documents/events/$(eventId)).data.days[dayIndex].unlockAt` — `days` is an array field on the Event doc (#__NUM_d15-schema-contract__'s `DayDef[]`), not a subcollection, so the lookup indexes into that array by the path's `{dayIndex}`.
- Keep the owner-or-admin read/write posture (ADR 0001) — this ticket adds a TIME gate on top of it, it does not remove the self-write.
- **Pending/rejected items readable only by admins + submitter**: extend the `items` read rule so a non-admin sees `status == 'active'` OR (`status == 'pending' || status == 'rejected'`) AND `resource.data.createdBy == request.auth.uid` — "invisible everywhere except the Admin queue and (as 'pending review') to their submitter," per spec § "Item pools and the approval flow." A `rejected` item is admin-only even to its own submitter — it is "kept for audit, hidden from all non-admins," per spec, which includes the original submitter once rejected.
- **Day meta `firstBingo` write-once**: mirror the `moments/{momentId}` immutability pattern (`:334-377`) — `create` allowed once (no prior doc), no `update` path at all, so a second write to the same day-meta doc is denied for everyone including admins, exactly like the Moment doc's deny-all update. Written "via the same client path that posts first-bingo Moments today," per spec.
- `firestore.rules` is not a protected path in `.github/review-policy.yml` today, so `needs-phase-4` here is the planning marker — keep the PR under 300 lines and expect external review.

## Tests to add
- `tests/rules/d15-firestore-rules.test.ts` — a Board create/mark write BEFORE that Day's `unlockAt` DENIED; at/after `unlockAt` with no existing doc (deal) ALLOWED; at/after `unlockAt` on the owner's existing doc (a Mark) ALLOWED; a non-owner's write DENIED regardless of unlock state (layer: rules-emulator; time-gated).
- `tests/rules/d15-firestore-rules.test.ts` — a `pending` item read by an admin ALLOWED, by its own submitter ALLOWED, by any other non-admin DENIED; a `rejected` item read by an admin ALLOWED, by its own (former) submitter DENIED, by any other non-admin DENIED (layer: rules-emulator).
- `tests/rules/d15-firestore-rules.test.ts` — the first `firstBingo` write to a day-meta doc ALLOWED; a second write to the SAME day-meta doc (by owner or by admin) DENIED (layer: rules-emulator).
- `tests/rules/d15-firestore-rules.test.ts` — existing self-writable-by-design assertions (owner board/player write ALLOWED, cross-uid DENIED) still pass under the new day-scoped path, so the ADR-0001 posture is provably unchanged (layer: rules-emulator).

## Acceptance criteria
- **Given** a Day with `unlockAt` in the future **When** any Player attempts a Board write under that day's path **Then** it is DENIED (rules test).
- **Given** a Day with `unlockAt` in the past and no existing Board doc for a Player **When** that Player writes one **Then** it is ALLOWED as a deal; a second Player's write to the FIRST Player's doc is DENIED.
- **Given** a `pending` item **When** anyone other than an admin or its own submitter reads it **Then** it is DENIED.
- **Given** a day-meta doc that already carries `firstBingo` **When** any client (including an admin) writes to it again **Then** it is DENIED.
- [ ] `boards` moved under `days/{dayIndex}` with the unlock-time gate.
- [ ] `items` pending/rejected visibility carve-out added.
- [ ] `days/{dayIndex}/meta.firstBingo` write-once rule added.
- [ ] PR kept under 300 lines.

## Definition of Done
- [ ] Spec `specs/d15-firestore-rules.md` created **with a matching test** (checker `scripts/ci/check_spec_test_alignment` matches basename → a test under `tests/**` or `src/**/*.test.*`; design-only specs use frontmatter `tested: false` + `reason:`)
- [ ] `npm run typecheck` · `npm test` · `npm run build` green; `md-prose-wrap` clean
- [ ] PR body `Closes #<this issue>`; authored `nathanjohnpayne`, driven through `REVIEW_POLICY.md` to merge (needs-phase-4: expect external review, not just under-threshold self-approval)
- [ ] Board discipline per `docs/agents/ticket-workflow.md` (claim → In progress; PR → In review; merge → Done)

## Dependencies
- Depends on #__NUM_d15-schema-contract__ — rules read the `DayDef[]`/`ItemDoc.pool`/`status` shape it defines.
- Blocks #__NUM_d15-dealing__ — dealing writes day-scoped Board docs against this rule.
- Blocks #__NUM_d15-approvals__ — the approval queue relies on the pending/rejected visibility carve-out.
- Blocks #__NUM_d15-admin-schedule__ — schedule edits touch the same `days[]` array this ticket's rules read.

## Recommended agent
claude-opus-4-8@high — protected-path rules change with time-gated logic; needs the emulator proof and a careful reviewer.
