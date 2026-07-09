**Track:** moderation · **Phase:** 2 (hardening) · **Wave:** 4 · **Size:** M · **ADR(s):** 0004
**Epic:** #__NUM_epic-phase2-hardening__
**Labels:** agent-action, track:moderation, phase-2, hardening, wave-4, size:M, needs-phase-4

## Context & scope

The **consumer** half of Cloud Vision: auto-hide extreme/illegal content the proof scanner (#__NUM_p2-vision-proof__) flags. The server-authoritative auto-hide already shipped (#__NUM_w4-phase1-functions__ / PR #127, `functions/src/autohide.ts`) — but it is **report-count-driven and deliberately leaves Vision-`flagged` docs alone** ("active-only" invariant: it never downgrades the stronger `flagged` state to a plain `hidden`, so an admin Restore can't re-expose a still-`visionFlag`ged proof). So today an extreme/illegal Vision flag surfaces to admins but **nothing auto-hides it**. This ticket adds the Vision-flag → hide path and the moderation-queue treatment, completing reactive moderation's automated leg per [ADR 0004](../../../../docs/adr/0004-reactive-moderation.md) — automated flagging for illegal/extreme content only, never a posting gate or pre-moderation review queue (PRD Non-Goals). Not authorization: hiding content never touches Marks or stats ([ADR 0001](../../../../docs/adr/0001-honor-system-trust-model.md)).

## Current state (as shipped)

- **Exists:** report-count auto-hide `functions/src/autohide.ts` (#__NUM_w4-phase1-functions__/#127) — flips `status:'hidden'` when `reportCount` crosses `settings.reportHideThreshold`, transactional re-read guard, **explicitly skips non-`active` docs** (so `flagged`/`pending` are preserved). `moderateProof` sets `status:'flagged'` + `visionFlag` (`functions/src/index.ts:67`, gated — #__NUM_p2-vision-proof__). Admin console renders a `visionFlag` pill (`components/Admin.tsx:111`); the report/moderation queue already includes `status==='flagged'` items (`hooks/useData.ts`); a "flagged for review" badge shows in the Feed (`components/ProofFeed.tsx`); `notifyProofModeration` emails admins on the transition (#101).
- **Missing:** no path promotes an extreme/illegal `visionFlag` to `status:'hidden'` — the shipped auto-hide intentionally won't, and there is no Vision-specific hide. The queue does not distinguish a Vision flag as auto-hide-worthy vs. a report-count case.
- **Contradicts:** none — this composes with `autohide.ts`, it does not modify its report-count invariants.

## Files to create / modify

- `functions/src/autohide.ts` (or a sibling module) — a Vision-flag-driven hide that flips an extreme/illegal `flagged` proof to `hidden`, **without** breaking the report-count path's active-only invariant (decide the policy: auto-hide extreme/illegal immediately, vs. hold `flagged` for an admin and only prioritize it).
- `firestore.rules` — keep `status` server-set (already established by #__NUM_w4-phase1-functions__/#127); no client self-hide.
- `components/Admin.tsx` + `hooks/useData.ts` — mark Vision-flagged items in the queue with the flag reason + a restore, distinct from report-count hides.

## Implementation notes

- Extreme/illegal-only — never auto-hide for raciness (ADR 0004); the trigger is the producer's `violence`/`extreme` flag, not `adult`/`racy`.
- Respect `autohide.ts`'s invariants: don't let the two paths fight (a Vision hide must not be undone by, or collide with, the report-count path; preserve admin Restore).
- Auto-hide is reactive automation, not pre-moderation: it hides *after* upload, never gates posting (PRD Non-Goal).
- Requires the producer (#__NUM_p2-vision-proof__) live to be verifiable end-to-end.
- Keep the PR small (needs-phase-4, touches `functions/` + `firestore.rules`); expect external review.

## Tests to add

- `functions/*` — a proof with an extreme/illegal `visionFlag` is flipped to `status:'hidden'`; a non-flagged / merely-racy proof is untouched; the report-count auto-hide's active-only behavior is unchanged (layer: functions).
- `tests/rules/*.test.ts` — a non-admin client still cannot self-set `status:'hidden'` (layer: rules-emulator).
- component — the moderation queue distinguishes a Vision-flagged item with reason + restore (layer: RTL-jsdom).

## Acceptance criteria

- **Given** `moderateProof` set an extreme/illegal `visionFlag` **When** the Vision-hide path runs **Then** the proof `status` flips to `'hidden'` server-side and the admin console shows it flagged with reason + restore.
- **Given** a merely-racy proof **When** scanned **Then** it is **not** auto-hidden (ADR 0004).
- **Given** the existing report-count auto-hide **When** this ships **Then** its active-only invariant and admin Restore still hold.
- [ ] Extreme/illegal Vision flag → server-authoritative `status:'hidden'`
- [ ] Composes with `autohide.ts` without regressing its report-count path
- [ ] Console surfaces the Vision flag + reason + restore; raciness never auto-hidden

## Definition of Done

- [ ] Spec `specs/cloud-vision-moderation.md` created/updated **with a matching test** (checker `scripts/ci/check_spec_test_alignment` matches basename → a test under `tests/**` or `src/**/*.test.*`; design-only specs use frontmatter `tested: false` + `reason:`)
- [ ] `npm run typecheck` · `npm test` · `npm run build` green locally (no `lint` script; app tests are not CI-run — record in the commit `Verified:` trailer)
- [ ] Repo gates pass: `repo_lint` (incl. spec↔test alignment), `md-prose-wrap`, review-policy label gate
- [ ] Conventional commits + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`; PR body `Closes #<this issue>`; authored `nathanjohnpayne`, reviewed under `nathanpayne-{agent}`; driven to merge
- [ ] Board discipline per `docs/agents/ticket-workflow.md` (claim → In progress; PR → In review; merge → Done)

## Dependencies

- Depends on #__NUM_p2-vision-proof__ — consumes the `visionFlag` the proof scanner produces.
- Builds on #__NUM_w4-phase1-functions__ (merged, `autohide.ts`) — shares the server-authoritative `status:'hidden'` surface; must not regress its report-count path.
- Depends on #__NUM_w2-admin-console__ — extends the Admin & moderation console.
