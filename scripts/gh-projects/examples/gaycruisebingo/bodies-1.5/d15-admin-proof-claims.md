**Track:** moderation · **Phase:** 1.5 · **Wave:** 3 · **Size:** M · **Cut line:** nice-to-have (post-sailaway)

## Context & scope

Implements `daily-cards-spec.md` § "Admin console" (the new "Proof & Claims" panel). Several of the knobs this panel surfaces already exist in the backend with no UI at all — `reportHideThreshold`, `visionGate` — while `photoProofSource` and `stripPhotoExif` are new settings `d15-claim-sheet-photo` makes load-bearing. This ticket is pure admin-surface work: one panel, six rows, no new backend behavior of its own.

## Current state

`src/components/Admin.tsx` already has a "Claim mode" section (`:298-311`) — a segmented Honor/Proof-req./Admin-confirmed control wired to `setClaimMode` (`src/data/admin.ts:36`) — and a "Pending claims" section (`:328-347`) listing `usePendingClaims()` with Confirm/Reject. Both stay as-is; this ticket relabels/recaptions the Claim-mode control ("a friction knob, not a trust level" per ADR 0001) and folds it, alongside a link row summarizing the Pending-claims count, into the new panel rather than rebuilding either. `EventDoc.settings.reportHideThreshold` is typed and load-bearing (`isReportHidden`, `src/hooks/useData.ts`) but has NO admin control anywhere — an admin can only see the current auto-hidden rows in the report queue, never edit the threshold itself. `functions/src/visionGate.ts` (`visionModerationEnabled`) gates the `moderateProof` Cloud Function's deploy via an operator `.env` flag today — it is not an `EventDoc.settings` field and has no runtime UI toggle; `d15-schema-contract` adds `EventDoc.settings.visionGate` (default true) as the UI-facing toggle this ticket surfaces. Confirm with the schema-contract ticket whether the deployed function itself reads this new field or whether it stays deploy-time-only for Phase 1.5 — if the function does not yet consult it, caption this toggle as presentational-only for now, the same posture the Phase-0 report-hide threshold started from. `EventDoc.settings.photoProofSource` and `stripPhotoExif` (from `d15-schema-contract`, made load-bearing by `d15-claim-sheet-photo`) have no admin UI yet — this ticket is their first UI. No stepper/toggle pattern exists yet for `reportHideThreshold` in `Admin.tsx` — the existing report-queue UI only reads it, via `useEventDoc()` (`Admin.tsx:201`).

## Files to create / modify

- `src/components/Admin.tsx` (modify) — a new "Proof & Claims" panel with six rows: Claim mode (segmented, relabeled/captioned), Photo proof source (Camera or library / Camera only), Strip location data (toggle, default on), AI image screen (visionGate toggle), Auto-hide after reports (reportHideThreshold stepper), Pending claims (link/count row into the existing Pending-claims section).
- `src/data/admin.ts` (modify) — add `setPhotoProofSource`, `setStripPhotoExif`, `setVisionGate`, `setReportHideThreshold` — small, single-field `EventDoc.settings.*` writes mirroring `setClaimMode`/`setEventTheme`'s shape.

## Implementation notes

Claim mode caption: "a friction knob, not a trust level" (verbatim per ADR 0001) — do not reintroduce "verified"/trust language anywhere in this panel's copy. Photo proof source defaults to `camera_or_library` (the #190-resolved posture `d15-claim-sheet-photo` implements); `camera_only` is the explicit "today's behavior, for live-proof ceremony" override, captioned as such. Strip location data defaults on; caption it as worth having regardless of the photo-source choice, since library photos are far more likely to carry geotags than live captures. AI image screen toggles the EXISTING `visionGate` Cloud Function behavior — see the Current-state caveat above about whether the function is field-driven yet, and resolve that before writing this row's caption, since a toggle that does not yet change function behavior needs to say so. Auto-hide after reports is a stepper over the existing `reportHideThreshold` number — no new hide mechanism, just the missing edit affordance for a value that was previously seed-only. Pending claims is a link/count row into the section that already exists (`Admin.tsx:328-347`) — do not duplicate its list here, just surface the count and a jump-to affordance. This ticket adds NO new backend behavior — every knob it exposes already exists (or is added by its dependencies); scope creep into changing what any of these settings DO, rather than exposing them, is out of scope.

## Tests to add

- `src/components/Admin.test.tsx` (extend) — the Proof & Claims panel renders all six rows; each control reads the current `EventDoc.settings`/`claimMode` value and writes on change via the corresponding `data/admin.ts` function; the Pending-claims row's count matches `usePendingClaims()` (layer: RTL-jsdom).

## Acceptance criteria

- **Given** the Proof & Claims panel **When** it loads **Then** it shows the current Claim mode, Photo proof source, Strip-location-data state, AI-image-screen state, report-hide threshold, and pending-claims count.
- **Given** an admin changes Photo proof source to Camera only **When** the write commits **Then** `EventDoc.settings.photoProofSource` is `'camera_only'` and the Claim sheet's Library affordance disappears for every Player (per `d15-claim-sheet-photo`).
- **Given** an admin steps the Auto-hide-after-reports value **When** the write commits **Then** `EventDoc.settings.reportHideThreshold` updates and the report queue's "auto-hidden" pills reflect the new threshold on next render.
- [ ] All six rows are present and each is independently writable.
- [ ] No row's caption claims trust/verification language for Claim mode.

## Definition of Done

- Spec `specs/d15-admin-proof-claims.md` created with a matching test (spec↔test alignment CI).
- `npm run typecheck` + `npm test` + `npm run build` green; md-prose-wrap clean.
- PR body `Closes #<this issue>`; authored `nathanjohnpayne`, driven through REVIEW_POLICY.md to merge.
- Board discipline per `docs/agents/ticket-workflow.md`.

## Dependencies

- Depends on #__NUM_d15-schema-contract__ — the `EventDoc.settings.photoProofSource`/`stripPhotoExif`/`visionGate` fields this panel edits.
- Depends on #__NUM_d15-claim-sheet-photo__ — the `photoProofSource`/`stripPhotoExif` settings this panel exposes are the ones that ticket makes load-bearing.

## Recommended agent

claude-sonnet-5 @ high — pure admin-surface work over already-existing backend knobs; the only real subtlety is getting the visionGate caption right depending on whether the function is field-driven yet.
