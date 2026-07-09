**Track:** proof · **Phase:** 2 (hardening) · **Wave:** 4 · **Size:** M · **ADR(s):** 0004
**Epic:** #__NUM_epic-phase2-hardening__
**Labels:** agent-action, track:proof, phase-2, hardening, wave-4, size:M, needs-phase-4

## Context & scope

Re-enable the Cloud Vision proof scanner that was deliberately **gated off**. `moderateProof` is fully written but its export is currently `undefined` unless `ENABLE_VISION_MODERATION=true` — a human decision (#126, 2026-07-09) deferred Cloud Vision so the #101 email notifiers could deploy on their own. This is the **producer** half of Cloud Vision: flip the gate on, clear the deploy blocker, enable the Cloud Vision API, and verify SafeSearch runs on real Proof uploads — flagging **extreme/illegal content only, never raciness** (the app is intentionally racy) — plus the `sharp` thumbnail. It writes `status:'flagged'` + `visionFlag` onto the Proof doc; **acting** on that flag is the sibling moderation ticket (#__NUM_p2-vision-moderation__). It does not change the honor system ([ADR 0001](../../../../docs/adr/0001-honor-system-trust-model.md)): SafeSearch flags media for human review — it does not authorize or block a Mark.

## Current state (as shipped)

- **Exists (gated off):** `moderateProofHandler` (`functions/src/index.ts:40-72`) — `sharp` 400×400 thumbnail (`:52-53`) + `safeSearchDetection` (`:59`) flagging `violence >= LIKELY` → `'violence'`, or `adult >= VERY_LIKELY && violence >= POSSIBLE` → `'extreme'` (`:61-65`), never raciness; merge-sets `{status:'flagged', visionFlag}` (`:67`). The export is conditional: `export const moderateProof = VISION_ENABLED ? onObjectFinalized(...) : undefined` (`:81`); `VISION_ENABLED = visionModerationEnabled()` (`:28`, from `functions/src/visionGate.ts`, read at BOTH deploy-discovery and runtime). Blaze is live (#__NUM_w4-infra-blaze-budget__, merged) and the `functions/` module already deploys (the #101 notifiers).
- **Deploy blocker (why it is gated):** `moderateProof` is `us-central1` (`setGlobalOptions`, `:14`) but the default Storage bucket is `us-east1`; a `us-central1` function cannot trigger on `us-east1` objects, and Firebase validates **every** export at deploy-plan time, so an unresolved mismatch on this one export blocks the whole `functions/` deploy (`:19-27`, #126). This must be resolved before the flag can go on.
- **Missing:** the Cloud Vision API is not enabled on the project; `ENABLE_VISION_MODERATION` is unset (default off); no proof has been scanned end-to-end.

## Files to create / modify

- `functions/src/index.ts` / deploy config — resolve the region mismatch so `moderateProof` validates (deploy the trigger in the bucket's region, or bind it to a same-region bucket); `moderateProofHandler` logic itself needs no change.
- `functions/.env.<projectId>` — set `ENABLE_VISION_MODERATION=true` (see `functions/.env.example`, `visionGate.ts`).
- GCP / Firebase console — enable the Cloud Vision API; deploy.
- `docs/app/phase-1-deploy.md` + `specs/w4-gate-vision-moderation.md` — record the enable/deploy runbook (these already document the gate).

## Implementation notes

- Keep it extreme/illegal-only (`violence` / `extreme`); never flag `adult`/`racy` alone — the `:61-65` predicate (ADR 0004). SafeSearch cannot detect minors — human reporting stays the primary control (`:34-38`).
- Vision + thumbnail are both best-effort (each try/catch): a Vision or `sharp` failure must never block the upload or the Mark.
- The region fix is the crux — validate the deploy plan (`firebase deploy --only functions --dry-run` or equivalent) before flipping the flag in the deployed env.
- Keep the PR small (needs-phase-4, touches `functions/`); expect external (Phase 4) review.

## Tests to add

- `functions/*` — with the Vision client mocked and `VISION_ENABLED` forced on: a buffer scored `violence >= LIKELY` makes the handler merge-set `status:'flagged'` + `visionFlag:'violence'`; a merely-racy score (`adult VERY_LIKELY`, `violence VERY_UNLIKELY`) sets **nothing**; a `_thumb.jpg` is written (layer: functions). (Complements the existing `tests/functions/w4-gate-vision-moderation.test.ts` gate test.)
- `specs/cloud-vision-proof.md` — the enable/region-fix/deploy runbook spec.

## Acceptance criteria

- **Given** the region mismatch resolved, the Cloud Vision API enabled, and `ENABLE_VISION_MODERATION=true` **When** a Player uploads a Proof photo **Then** a `_thumb.jpg` is generated and SafeSearch runs; extreme/violent content sets `status:'flagged'` + `visionFlag`, and merely-racy content is **not** flagged.
- **Given** Vision or `sharp` throws **When** the handler runs **Then** the failure is swallowed and the Proof + Mark are unaffected (best-effort).
- [ ] Region mismatch resolved so `moderateProof` validates + deploys
- [ ] Cloud Vision API enabled; `ENABLE_VISION_MODERATION=true` in `functions/.env.<projectId>`
- [ ] Verified end-to-end on a real proof upload; extreme/illegal-only preserved (ADR 0004)

## Definition of Done

- [ ] Spec `specs/cloud-vision-proof.md` created/updated **with a matching test** (checker `scripts/ci/check_spec_test_alignment` matches basename → a test under `tests/**` or `src/**/*.test.*`; design-only specs use frontmatter `tested: false` + `reason:`)
- [ ] `npm run typecheck` · `npm test` · `npm run build` green locally (no `lint` script; app tests are not CI-run — record in the commit `Verified:` trailer)
- [ ] Repo gates pass: `repo_lint` (incl. spec↔test alignment), `md-prose-wrap`, review-policy label gate
- [ ] Conventional commits + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`; PR body `Closes #<this issue>`; authored `nathanjohnpayne`, reviewed under `nathanpayne-{agent}`; driven to merge
- [ ] Board discipline per `docs/agents/ticket-workflow.md` (claim → In progress; PR → In review; merge → Done)

## Dependencies

- **Reverses** #126 — which gated Cloud Vision off; this is the re-enablement.
- Depends on #__NUM_w4-infra-blaze-budget__ (merged) — Blaze plan gates Cloud Functions + Cloud Vision.
- Depends on #__NUM_w2-proof-capture__ — Proof capture writes the media `moderateProof` scans.
- Feeds #__NUM_p2-vision-moderation__ — the moderation consumer acts on the `visionFlag` this produces.
