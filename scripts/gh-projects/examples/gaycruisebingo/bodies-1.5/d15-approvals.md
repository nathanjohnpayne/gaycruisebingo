**Track:** moderation · **Phase:** 1.5 · **Wave:** 2 · **Size:** L · **Cut line:** must-have

## Context & scope

Implements `daily-cards-spec.md` § "Item pools and the approval flow". Today any signed-in Player's submitted Prompt goes straight to `status: 'active'` and is immediately dealable. This ticket adds an approval gate on the `main` pool: a submission now lands `pending` — invisible everywhere except the Admin queue and (as "pending review") its own submitter — and only an admin's approve/reject decision makes it `active` (or `rejected`, kept for audit). It also gives the Admin console an Approvals tab and relies on the Day Snapshot mechanism (owned elsewhere) to pick approved items up on every not-yet-unlocked Day.

## Current state

`src/components/ItemPool.tsx` `add()` (`:43-65`) calls `addItem(user.uid, text, spicy)` (`src/data/api.ts:740-752`), which writes `status: 'active', reportCount: 0` directly — no pending state exists today. The pre-sail framing caption (`PRESAIL_NOTE`, `ItemPool.tsx:13-14`) explains freeze-on-deal, not approval — it needs a companion "goes to admin review" caption, not a replacement. `firestore.rules`'s `items/{itemId}` `create` rule requires `status == 'active'` on create today; this ticket's dependency `d15-firestore-rules` is the one that relaxes this to also allow `status == 'pending'` and adds the `pending`/`rejected` read-visibility rule — this ticket does not itself edit `firestore.rules`. `src/components/Admin.tsx` has a "Prompts" section (`:349-381`) listing every item via `useAllItems` (`:192`) with Hide/Restore/Delete — no pending queue, no approve/reject, no spicy toggle, no bulk approve. The existing report queue (`:246-270`) is a separate, already-shipped moderation surface (reports, not approvals) that this ticket does not change. `src/types.ts` `ItemDoc.status` is `'active' | 'hidden'` today; `d15-schema-contract` (dependency) extends it to include `'pending' | 'rejected'` and adds `pool`, `approvedBy`, `approvedAt` — this ticket is the first consumer, not the field owner. `src/data/admin.ts` has `hideItem`/`restoreItem`/`deleteItem`/`clearItemReports` but no approve/reject/bulk-approve write. Grandfathering: every existing `active` item must stay `active` — the approval gate applies only to submissions made after this ships; no migration or backfill is needed since the field is additive.

## Files to create / modify

- `src/components/ItemPool.tsx` (modify) — main-pool submissions now go through `status: 'pending'`; add a "goes to admin review" caption near `PRESAIL_NOTE`; a submitter's own pending items should still render in their list, visibly marked pending, not silently vanish after Add.
- `src/components/Admin.tsx` (modify) — new "Approvals" tab: pending-items list with submitter attribution, a spicy toggle per row, Approve (→ `active` + `approvedBy`/`approvedAt`) and Reject (→ `rejected`, kept for audit, hidden from all non-admins) actions, and a bulk-approve control.
- `src/data/api.ts` (modify) — `addItem` writes `status: 'pending'` (and `pool: 'main'`, from `d15-schema-contract`'s field) instead of `'active'`.
- `src/data/admin.ts` (modify) — add `approveItem(id, adminUid)` and `rejectItem(id, adminUid)` (stamping `approvedBy`/`approvedAt` or `status: 'rejected'`), plus a bulk-approve helper.
- `src/hooks/useData.ts` (modify) — add a hook for the Admin pending queue (`usePendingItems`, mirroring `usePendingClaims`'s shape) so Approvals reads from its own subscription rather than filtering `useAllItems` client-side on every render.

## Implementation notes

Pending items are invisible everywhere except the Admin queue and (as "pending review") to their own submitter — never dealt, never in Tallies, never in the live pool other Players see (`useItems`). Reject keeps the item doc (`status: 'rejected'`) for audit rather than deleting it; a rejected item stays hidden from all non-admins, the same visibility posture as pending. Grandfathering: every item that is already `active` when this ships stays `active` — the gate only applies going forward, to new submissions; do not write a migration. Approved items enter every not-yet-unlocked Day's Day Snapshot — never an already-dealt Day — because the snapshot the `d15-scheduler-unlock` function stamps at each Day's `unlockAt` is drawn from whatever is `status: 'active'` in that Day's pool AT that moment; this ticket does not touch the scheduler, it only needs to land an item as `active` in time for that read. **needs-phase-4** (protected path / keep PR small) — this ticket, together with its `d15-firestore-rules` dependency, touches the write/read visibility contract for `items/{itemId}`; keep the PR tightly scoped to the approval flow. Curated pools (`embark`/`farewell`) are NOT in scope here — those are seeded and admin-edited directly (see `d15-tutorial-seed`); the approval gate applies only to the `main` pool's player-submission path.

## Tests to add

- `src/components/ItemPool.test.tsx` — a submission writes `status: 'pending'`; the "goes to admin review" caption renders; a submitter's own pending item is visible to them (layer: RTL-jsdom).
- `src/components/Admin.test.tsx` — the Approvals tab lists pending items with submitter attribution; Approve writes `active` + `approvedBy`/`approvedAt`; Reject writes `rejected`; bulk-approve approves every listed row (layer: RTL-jsdom).
- `tests/rules/d15-approvals.test.ts` — a non-admin cannot read another Player's `pending`/`rejected` item; the submitter CAN read their own pending item; only an admin can transition `pending → active`/`rejected` (layer: rules-emulator).
- `src/data/api.test.ts` — `addItem` writes `status: 'pending'` (layer: unit).

## Acceptance criteria

- **Given** a signed-in Player submits a Prompt to the main pool **When** the write commits **Then** the item is `status: 'pending'` and absent from `useItems` (the live player-facing pool) and from every deal.
- **Given** a pending item **When** the submitter views the pool **Then** it renders labeled "pending review"; **when** any other non-admin Player views the pool **Then** it is entirely absent.
- **Given** an admin approves a pending item **When** the write commits **Then** it becomes `active` with `approvedBy`/`approvedAt` stamped and is eligible for the next not-yet-unlocked Day's snapshot.
- **Given** an admin rejects a pending item **Then** it becomes `rejected`, stays out of every player-facing surface, and remains visible to admins for audit.
- [ ] An item that was already `active` before this ships stays `active` with no admin action required.
- [ ] Only the `main` pool gates on approval; `embark`/`farewell` curated pools are unaffected.
- [ ] Bulk approve works on the full pending list in one action.

## Definition of Done

- Spec `specs/d15-approvals.md` created with a matching test (spec↔test alignment CI).
- `npm run typecheck` + `npm test` + `npm run build` green; md-prose-wrap clean.
- PR body `Closes #<this issue>`; authored `nathanjohnpayne`, driven through REVIEW_POLICY.md to merge.
- Board discipline per `docs/agents/ticket-workflow.md`.

## Dependencies

- Depends on #__NUM_d15-schema-contract__ — the `ItemDoc.pool`/`status: 'pending'|'rejected'`/`approvedBy`/`approvedAt` fields this ticket is the first consumer of.
- Depends on #__NUM_d15-firestore-rules__ — the rules baseline (pending/rejected read-visibility, the relaxed create-status check) this flow relies on.

## Recommended agent

claude-sonnet-5 @ high — a contained UI + write-path feature on top of an already-landed schema and rules baseline; no new architectural surface, but touches a rules-adjacent path so needs-phase-4 discipline applies.
