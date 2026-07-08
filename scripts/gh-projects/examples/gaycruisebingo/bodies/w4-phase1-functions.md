**Track:** backend · **Phase:** 1 · **Wave:** 4 · **Size:** L · **ADR(s):** 0004
**Epic:** #__NUM_epic-backend__
**Labels:** agent-action, track:backend, phase-1, wave-4, size:L, needs-phase-4

## Context & scope

Phase 1 makes reactive moderation server-authoritative per [ADR 0004](../../../../docs/adr/0004-reactive-moderation.md). The existing `moderateProof` Function (sharp thumbnail + Cloud Vision safeSearch, flagging extreme/illegal content only — never raciness) already satisfies ADR-0004 Phase 1, so it is kept as-is. This ticket ADDS the server-authoritative hide: a Function that flips a Proof or Prompt (the `items` collection) to `status: 'hidden'` when its `reportCount` reaches the Event's `reportHideThreshold`, promoting the Phase-0 client-side presentational hide (from `w2-admin-console`) to an authoritative removal — plus the Phase-1 `firestore.rules` update making `status` server-set. Requires the Blaze plan. The honor system stays intact: `recomputeStats` is NOT re-added or repurposed as anti-cheat ([ADR 0001](../../../../docs/adr/0001-honor-system-trust-model.md)).

## Current state (scaffold)

- **Exists:** `moderateProof` (`functions/src/index.ts:28-59`) — onObjectFinalized; sharp thumbnail (`:40-41`) + Cloud Vision safeSearch flagging only `violence >= LIKELY` → `'violence'` (`:49`) or `adult >= VERY_LIKELY && violence >= POSSIBLE` → `'extreme'` (`:51`), NOT raciness; sets `status: 'flagged'` (`:55`). `firestore.rules` items report-only-increment update (`:25-41`) and proofs block (`:57-125`).
- **Missing:** no server-authoritative threshold hide — nothing flips `status: 'hidden'` at `reportCount ≥ reportHideThreshold`; in Phase 0 the hide is client-side/presentational only. `firestore.rules` does not yet make `status` server-set.
- **Contradicts:** `recomputeStats` (`functions/src/index.ts:68`) is doc-commented as authoritative/anti-cheat, which CONTRADICTS ADR 0001; do not extend or rely on it here (its removal is owned by `recon-recompute-stats`).

## Files to create / modify

- `functions/src/index.ts` — add the threshold-hide Function (onDocumentWritten over `items` + `proofs`) that flips `status: 'hidden'` when `reportCount ≥ event.settings.reportHideThreshold`; keep `moderateProof` unchanged.
- `firestore.rules` — Phase-1 update making `status` server-set (non-admin clients may no longer self-set `'hidden'`/`'active'`); keep report-only increments; keep self-writable `boards/{uid}` + `players/{uid}` (ADR 0001).

## Implementation notes

- Read `reportHideThreshold` from the Event `settings` doc; do not hardcode it (it is load-bearing per ADR 0004).
- Keep Cloud Vision extreme/illegal-only (`violence` / `extreme`); never flag raciness — the app is intentionally racy (ADR 0004).
- Do NOT re-add or repurpose `recomputeStats` as anti-cheat — self-writable Player stats are intentional (ADR 0001).
- Requires the Blaze plan (Functions + Cloud Vision), provisioned by #__NUM_w4-infra-blaze-budget__.
- Keep the PR < 300 lines (needs-phase-4, touches `functions/`); expect external review.

## Tests to add

- `tests/rules/*.test.ts` — a non-admin client can no longer set `status: 'hidden'`/`'active'` directly; a report still increments only (layer: rules-emulator)
- `functions/*` — `reportCount` crossing `reportHideThreshold` flips a Proof/Prompt `status` to `'hidden'`; below threshold leaves it untouched (layer: functions)

## Acceptance criteria

- **Given** a Proof or Prompt whose `reportCount` reaches the Event's `reportHideThreshold` **When** the Function runs **Then** its `status` flips to `'hidden'` server-side and the client hide becomes authoritative (ADR 0004 Phase 1).
- **Given** a proof image upload **When** `moderateProof` runs **Then** extreme/violent content is flagged (`status: 'flagged'`, `visionFlag` set) and merely racy content is NOT flagged (ADR 0004).
- [ ] `moderateProof` kept unchanged (thumbnail + Vision extreme-only)
- [ ] New Function flips `status` at `reportCount ≥ reportHideThreshold`, threshold read from Event `settings`
- [ ] `firestore.rules` makes `status` server-set; self-writable boards/players preserved (ADR 0001)
- [ ] `recomputeStats` NOT re-added / relied on as anti-cheat
- [ ] PR < 300 lines; Blaze enabled first

## Definition of Done

- [ ] Spec `specs/w4-phase1-functions.md` created/updated **with a matching test** (checker `scripts/ci/check_spec_test_alignment` matches basename → a test under `tests/**` or `src/**/*.test.*`; design-only specs use frontmatter `tested: false` + `reason:`)
- [ ] `npm run typecheck` · `npm test` · `npm run build` green locally (no `lint` script; app tests are not CI-run — record in the commit `Verified:` trailer)
- [ ] Repo gates pass: `repo_lint` (incl. spec↔test alignment), `md-prose-wrap`, review-policy label gate
- [ ] Conventional commits + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`; PR body `Closes #<this issue>`; authored `nathanjohnpayne`, reviewed under `nathanpayne-{agent}`; driven to merge
- [ ] Board discipline per `docs/agents/ticket-workflow.md` (claim → In progress; PR → In review; merge → Done)

## Dependencies

- Depends on #__NUM_w2-admin-console__ — the Phase-1 hide promotes the Phase-0 presentational client auto-hide to server-authoritative
- Depends on #__NUM_w0-firestore-rules__ — builds on the reconciled rules baseline (self-writable-by-design, report-only increments)
- Depends on #__NUM_w4-infra-blaze-budget__ — Blaze plan gates Functions + Cloud Vision
