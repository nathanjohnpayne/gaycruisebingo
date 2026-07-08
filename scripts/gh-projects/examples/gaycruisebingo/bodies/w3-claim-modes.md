**Track:** claims · **Phase:** 0 · **Wave:** 3 · **Size:** L · **ADR(s):** 0001
**Epic:** #__NUM_epic-social__
**Labels:** agent-action, track:claims, phase-0, wave-3, size:L

## Context & scope
Claim Mode is the Event-wide setting for how much friction a Mark carries — a friction/vibe knob, not a trust level (ADR 0001). Honor (default) marks instantly; Proof-to-mark (`proof_required`) needs a Proof before a Square marks; Admin-confirmed (`admin_confirmed`, renamed from the misleading `verified`) makes the Mark pending and raises a Claim for an Admin to confirm or reject. This ticket wires the three modes end to end on top of the rename from #__NUM_w0-type-contract__. Admin-confirmed is a dispute/ceremony tool, not anti-cheat — do not frame or build it as one (ADR 0001).

## Current state (scaffold)
- **Exists:** The full Admin-confirmed machinery is scaffolded under the old value `verified`: `setMark` sets a cell `pending` when `claimMode === 'verified' && nextMarked` (`src/data/api.ts:118`); `attachProof` creates a `claims` doc + a `pending` proof in that mode (`src/data/proofs.ts:44,91-102`); `ClaimDoc` exists (`src/types.ts:100-110`); `Admin.tsx` renders the pending-Claim confirm/reject UI (`src/components/Admin.tsx:77,80`); `confirmClaim`/`rejectClaim` recompute stats and flip the proof active via `resolve()` (`src/data/admin.ts:22-54,65-86`). `Board.tsx` opens `ProofSheet` for `proof_required`/`verified` (`:75-76`).
- **Missing:** The rename `verified` → `admin_confirmed` is not yet threaded through these call sites; the three modes are not verified end to end; the mode is not clearly presented as friction (the `Board.tsx:80` label still reads "Verified").
- **Contradicts:** `ClaimMode` still carries the literal `'verified'` (`src/types.ts:4`) and the `Cell.status` comment says "used only in 'verified' claim mode" (`src/types.ts:48`) — both renamed by #__NUM_w0-type-contract__; the doc-comment on `attachProof` (an "admin/peer to confirm") frames the mode as trust, which ADR 0001 rejects.

## Files to create / modify
- `src/data/api.ts` — read the renamed `admin_confirmed` value (via the #__NUM_w0-type-contract__ read-migration that still accepts legacy `'verified'`) where `setMark` sets `pending` (`:118`).
- `src/data/proofs.ts` — the same rename at the `pending` / Claim branch (`:44,91-102`); keep the transaction.
- `src/components/Admin.tsx` — the mode segmented control + pending-Claim resolve UI; relabel to Admin-confirmed.
- `src/components/Board.tsx` — the mode label + the `proof_required` / `admin_confirmed` capture branch (`:75-80`); Honor still marks instantly.

## Implementation notes
- Claim Mode is a friction/vibe knob, not a trust level (ADR 0001): the three modes tune how much ceremony a Mark carries, they do not make marks more trustworthy.
- Honor: mark instantly (`Board.tsx` already marks directly in Honor — `:75`). Proof-to-mark: a Proof is required before the Square marks (from #__NUM_w2-proof-capture__). Admin-confirmed: the Mark starts pending and does not count until an Admin resolves its Claim.
- Admin-confirmed is a dispute/ceremony tool, not anti-cheat (ADR 0001): do not describe, label, or justify it as verification or cheat-prevention. The pending Mark is excluded from bingo credit by the existing `markedMask` (`src/game/logic.ts:74-75`), which already ignores `status === 'pending'`.
- Reuse the existing Claim machinery (`claims` collection, `ClaimDoc`, `resolve()` / `confirmClaim` / `rejectClaim`); this ticket threads the rename and verifies the three modes, it does not re-architect Claims.
- Use the read-migration from #__NUM_w0-type-contract__ so an Event doc still carrying `claimMode: 'verified'` reads as Admin-confirmed.

## Tests to add
- `src/data/api.test.ts` — in Admin-confirmed a Mark sets the cell `pending` and does not count toward bingo; in Honor it marks instantly (layer: unit).
- `src/data/proofs.test.ts` — in Admin-confirmed `attachProof` creates a `pending` Claim + a `pending` (admin-only) proof; `confirmClaim` flips the proof active and credits the Square (layer: unit / rules-emulator).
- `src/components/Admin.test.tsx` — the mode control reads/writes Admin-confirmed; a pending Claim confirms and rejects (layer: RTL-jsdom).

## Acceptance criteria
- **Given** the Event is in Honor **When** a Player taps a Square **Then** it marks instantly with no Proof and no Claim.
- **Given** the Event is in Admin-confirmed **When** a Player marks **Then** the Square goes pending, a Claim is raised, and it counts only after an Admin confirms it.
- **Given** an Event doc still stores `claimMode: 'verified'` **When** the app reads it **Then** it behaves as Admin-confirmed (rename read-migration from #__NUM_w0-type-contract__).
- [ ] All three modes work end to end; the UI says Honor / Proof-to-mark / Admin-confirmed, never "Verified".
- [ ] Admin-confirmed is presented as a dispute/ceremony tool, not anti-cheat (ADR 0001).

## Definition of Done
- [ ] Spec `specs/w3-claim-modes.md` created/updated **with a matching test** (checker `scripts/ci/check_spec_test_alignment` matches basename → a test under `tests/**` or `src/**/*.test.*`; design-only specs use frontmatter `tested: false` + `reason:`)
- [ ] `npm run typecheck` · `npm test` · `npm run build` green locally (no `lint` script; app tests are not CI-run — record in the commit `Verified:` trailer)
- [ ] Repo gates pass: `repo_lint` (incl. spec↔test alignment), `md-prose-wrap`, review-policy label gate
- [ ] Conventional commits + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`; PR body `Closes #<this issue>`; authored `nathanjohnpayne`, reviewed under `nathanpayne-{agent}`; driven to merge
- [ ] Board discipline per `docs/agents/ticket-workflow.md` (claim → In progress; PR → In review; merge → Done)

## Dependencies
- Depends on #__NUM_w2-admin-console__ — Admin-confirmed resolves pending Claims through the admin console.
- Depends on #__NUM_w2-proof-capture__ — Proof-to-mark and Admin-confirmed both capture a Proof at mark time.
- Depends on #__NUM_w0-type-contract__ — the `verified` → `admin_confirmed` rename + the legacy read-migration is defined there.
