**Track:** moderation · **Phase:** 0 · **Wave:** 2 · **Size:** L · **ADR(s):** 0004
**Epic:** #__NUM_epic-moderation__
**Labels:** agent-action, track:moderation, phase-0, wave-2, size:L

## Context & scope
The Admin console already moderates Prompts, Proofs, and Claims, but the reactive auto-hide that ADR 0004 defines is typed-but-dead. This ticket makes `reportHideThreshold` load-bearing: the read hooks filter any Prompt or Proof whose `reportCount ≥ event.settings.reportHideThreshold`, so content self-hides on every client the moment the counter crosses the threshold. It also surfaces the report queue and adds an Admin ban. Per ADR 0004 the Phase 0 hide is client-side / presentational — a community emergency-hide that works with no Admin awake — and is bypassable by design, NOT tamper-proof removal (that is Phase 1, #__NUM_w4-phase1-functions__). It supersedes the scaffold's read-path, which only ever filtered on `status=='active'`.

## Current state (scaffold)
- **Exists:** `Admin.tsx` hides/restores/deletes Prompts (`components/Admin.tsx:135-145`) and Proofs (`:104-115`), resolves pending Claims (`:77-82`), and shows the `visionFlag` pill (`Admin.tsx:98`) beside the `reportCount ⚑` pill (`:97`). Hooks exist: `useReportedProofs` (`hooks/useData.ts:111-117`), `useAllItems` (`:106-109`), `usePendingClaims` (`:99-103`), `useProofFeed` (`:88-97`), `useItems` (`:67-73`). `EventDoc.settings.reportHideThreshold` is typed (`types.ts:25`); `ProofDoc.reportCount` (`types.ts:95`) and `ItemDoc.reportCount` (`types.ts:37`) exist. `data/admin.ts` has hide/restore/delete + `setClaimMode`/`setEventTheme` + `confirmClaim`/`rejectClaim`.
- **Missing:** the presentational threshold filter — no hook applies `reportCount ≥ reportHideThreshold`; `useProofFeed` even documents the gap ("hidden/flagged proofs stay admin-only rather than being filtered client-side", `hooks/useData.ts:89-90`) yet never filters on the counter. No Admin ban.
- **Contradicts:** none — the `status=='active'` query is the Admin hard-hide path; this ticket adds the community threshold hide beside it, exactly the ADR 0004 Phase 0 model.

## Files to create / modify
- `src/hooks/useData.ts` — apply `reportCount ≥ event.settings.reportHideThreshold` in `useProofFeed` and `useItems`; keep `useAllItems` / `useReportedProofs` UNfiltered so Admins still see and can restore threshold-hidden content.
- `src/components/Admin.tsx` — surface the report queue (`useReportedProofs`) prominently; add the ban control.
- `src/data/admin.ts` — add a `banUser` write; clients filter a banned User's Prompts/Proofs the same presentational way.

## Implementation notes
- Read the threshold from `useEventDoc()` (seeded value is 4, `scripts/seed.mjs`). The hide is presentational: the doc is untouched, every client computes the same hide, and it works with no Admin online (ADR 0004 Phase 0).
- Keep the Admin hard-hide (`status:'hidden'` via `hideItem`/`hideProof`) and restore as the Phase-0 override; Admin views must NOT apply the threshold filter, or an Admin could never reach threshold-hidden content to restore it.
- Bypassable by design: a client can patch its own bundle to ignore the filter — acceptable. Tamper-proof server hide (flip `status` at threshold) is #__NUM_w4-phase1-functions__. Do NOT try to make Phase 0 tamper-proof.
- Reports are not de-duplicated (one User can report repeatedly) — acceptable under the honor-system posture (ADR 0001); any hardening is a Phase 1 concern. `reportItem`/`reportProof` stay increment-only, enforced by the rules from #__NUM_w0-firestore-rules__.
- Keep the ban write inside the rules landed by #__NUM_w0-firestore-rules__; coordinate any new ban type with the type-contract owner rather than editing `src/types.ts` here.

## Tests to add
- `src/hooks/useData.test.tsx` — a Proof with `reportCount ≥ threshold` is absent from `useProofFeed`; below threshold it renders (layer: RTL-jsdom).
- `src/hooks/useData.test.tsx` — `useAllItems` / `useReportedProofs` still include threshold-hidden content (layer: RTL-jsdom).
- `tests/rules/reports.test.ts` — a non-admin report only increments `reportCount`; an Admin ban write is allowed, a non-admin ban write denied (layer: rules-emulator).
- `src/components/Admin.test.tsx` — the report queue lists a reported Proof and the ban control invokes the `data/admin.ts` write (layer: RTL-jsdom).

## Acceptance criteria
- **Given** a Proof whose `reportCount` reaches `event.settings.reportHideThreshold` **When** any Player opens the Feed **Then** it is hidden on every client with no Admin action (ADR 0004 Phase 0 presentational hide).
- **Given** that same threshold-hidden Proof **When** an Admin opens the console **Then** it still appears in the report queue and can be restored or deleted.
- [ ] `useProofFeed` and `useItems` exclude content at/over `reportHideThreshold`; `useAllItems` / `useReportedProofs` do not.
- [ ] Report queue surfaced in `Admin.tsx` via `useReportedProofs`.
- [ ] Admin ban control writes via `data/admin.ts`; a banned User's content is filtered client-side.
- [ ] Phase 0 hide documented as bypassable-by-design; server enforcement deferred to #__NUM_w4-phase1-functions__.

## Definition of Done
- [ ] Spec `specs/w2-admin-console.md` created/updated **with a matching test** (checker `scripts/ci/check_spec_test_alignment` matches basename → a test under `tests/**` or `src/**/*.test.*`; design-only specs use frontmatter `tested: false` + `reason:`)
- [ ] `npm run typecheck` · `npm test` · `npm run build` green locally (no `lint` script; app tests are not CI-run — record in the commit `Verified:` trailer)
- [ ] Repo gates pass: `repo_lint` (incl. spec↔test alignment), `md-prose-wrap`, review-policy label gate
- [ ] Conventional commits + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`; PR body `Closes #<this issue>`; authored `nathanjohnpayne`, reviewed under `nathanpayne-{agent}`; driven to merge
- [ ] Board discipline per `docs/agents/ticket-workflow.md` (claim → In progress; PR → In review; merge → Done)

## Dependencies
- Depends on #__NUM_w1-prompt-pool__ — the Prompt add/report surface whose reports feed the threshold hide.
- Depends on #__NUM_w2-proof-capture__ — the Proof capture + report path the queue and auto-hide moderate.
- Depends on #__NUM_w0-firestore-rules__ — the rules baseline (report-only increments, ban write) this console relies on.
- Blocks #__NUM_w3-claim-modes__ — the Claim confirm/reject UI extends this console.
- Blocks #__NUM_w4-phase1-functions__ — the Phase 1 server-authoritative hide makes this ticket's presentational threshold hide authoritative.
