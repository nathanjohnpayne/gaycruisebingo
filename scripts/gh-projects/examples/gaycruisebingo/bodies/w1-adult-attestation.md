**Track:** identity · **Phase:** 0 · **Wave:** 1 · **Size:** M · **ADR(s):** 0001
**Epic:** #__NUM_epic-identity__
**Labels:** agent-action, track:identity, phase-0, wave-1, size:M, needs-phase-4

## Context & scope

The 18+ attestation is currently a local-only checkbox that is never persisted, so it doesn't survive a reload and can't gate re-entry. This ticket replaces the ephemeral `ack` with a persisted `users/{uid}.attestedAdultAt` timestamp (type from #__NUM_w0-type-contract__), gates first Event entry on it, and re-prompts any User whose profile lacks it (PRD resolved decision + risk mitigation). Per ADR 0001 this is an honor-system self-attestation, not verification — we record the User's own statement, we never check IDs.

## Current state (scaffold)

- **Exists:** `SignIn.tsx` renders the 18+ acknowledgement as local component state `ack` (`src/components/SignIn.tsx:6`, `:24-30`), which gates only the sign-in button (`:31`) and is NEVER written to Firestore; `ensureUserProfile` seeds the User doc on first sign-in (`src/data/api.ts:45-56`).
- **Missing:** a persisted `UserDoc.attestedAdultAt` field (`src/types.ts:70-76` has no attestation field); a gate that re-prompts when it is absent; a rules allowance for the self-write.
- **Contradicts:** none — this fills the persistence gap; the User-level self-write is intentional (ADR 0001).

## Files to create / modify

- `src/components/SignIn.tsx` — bind the attestation to a persisted write instead of the ephemeral `ack` (`:6`).
- `src/auth/AuthContext.tsx` — on sign-in, check `attestedAdultAt`; re-prompt when absent.
- `src/data/api.ts` — write the `attestedAdultAt` timestamp to `users/{uid}` (extends `ensureUserProfile`, `:45-56`).
- `firestore.rules` — allow the owner to self-write `attestedAdultAt` (coordinate with #__NUM_w0-firestore-rules__).

## Implementation notes

- The field is `attestedAdultAt` (ms-epoch), added to `UserDoc` by #__NUM_w0-type-contract__ — do not re-declare the type here.
- Self-write is allowed by design (ADR 0001): `users/{uid}` is owner-writable (`firestore.rules:14-17`); this stores the User's own attestation, it is not identity verification.
- Gate first Event entry: a User without `attestedAdultAt` is re-prompted before reaching the Board.
- needs-phase-4: touches the `src/auth/**` protected path; keep the PR < 300 lines and expect external review.

## Tests to add

- `src/data/api.test.ts` — attesting on sign-in writes `users/{uid}.attestedAdultAt` (layer: unit).
- `tests/rules/firestore.test.ts` — the owner may set `attestedAdultAt`; a non-owner may not (layer: rules-emulator).
- `src/components/SignIn.test.tsx` — a User lacking `attestedAdultAt` is re-prompted (layer: RTL-jsdom).

## Acceptance criteria

- **Given** a first-time User **When** they attest 18+ and sign in **Then** `users/{uid}.attestedAdultAt` is persisted and survives a reload.
- **Given** a User whose profile has no `attestedAdultAt` **When** they return **Then** they are re-prompted before entering the Event.
- [ ] The ephemeral `ack` checkbox (`SignIn.tsx:6`) no longer gates entry on its own.
- [ ] Attestation is a User-level self-write (ADR 0001), not a verification check.
- [ ] PR kept < 300 lines (needs-phase-4).

## Definition of Done

- [ ] Spec `specs/w1-adult-attestation.md` created/updated **with a matching test** (checker `scripts/ci/check_spec_test_alignment` matches basename → a test under `tests/**` or `src/**/*.test.*`; design-only specs use frontmatter `tested: false` + `reason:`)
- [ ] `npm run typecheck` · `npm test` · `npm run build` green locally (no `lint` script; app tests are not CI-run — record in the commit `Verified:` trailer)
- [ ] Repo gates pass: `repo_lint` (incl. spec↔test alignment), `md-prose-wrap`, review-policy label gate
- [ ] Conventional commits + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`; PR body `Closes #<this issue>`; authored `nathanjohnpayne`, reviewed under `nathanpayne-{agent}`; driven to merge
- [ ] Board discipline per `docs/agents/ticket-workflow.md` (claim → In progress; PR → In review; merge → Done)

## Dependencies

- Depends on #__NUM_w1-auth-google__ — the attestation hooks the sign-in flow.
- Depends on #__NUM_w0-type-contract__ — provides `UserDoc.attestedAdultAt`.
- Depends on #__NUM_w0-firestore-rules__ — the attestation self-write rule + emulator test.
