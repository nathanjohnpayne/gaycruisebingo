**Track:** foundation · **Phase:** 0 · **Wave:** 0 · **Size:** M · **ADR(s):** 0001, 0002, 0004
**Epic:** #__NUM_epic-foundation__
**Labels:** agent-action, track:foundation, phase-0, wave-0, size:M, reconciliation

## Context & scope
Own the shared domain type contract in `src/types.ts` so downstream tickets import types instead of colliding on the file. Rename the Claim Mode value `verified` → `admin_confirmed` (ADR 0001 — it is a friction/vibe knob, never a trust level) across the type and every call site, with a read-migration that still accepts a legacy persisted `verified`; drop the dead `EventDoc.settings.blackoutEnabled` (ADR 0004); and add the greenfield social types the Wave-2 tickets consume — `TallyEntry`/`TallyDoc`, `DoubtDoc`, `MomentDoc` (ADR 0002) — plus `UserDoc.attestedAdultAt?`. This is the HOT-file owner of `src/types.ts`.

## Current state (scaffold)
- **Exists:** `ClaimMode = 'honor' | 'proof_required' | 'verified'` (`types.ts:4`); `EventDoc.settings = { reportHideThreshold: number; blackoutEnabled: boolean }` (`:25` threshold, `:26` dead `blackoutEnabled`); `Cell.status?: 'confirmed'|'pending'` with comment "used only in 'verified' claim mode" (`:48`); `UserDoc` = displayName/handle?/photoURL/customPhoto?/createdAt (`70-76`) with NO attestation field. Call sites reading `'verified'`: `Board.tsx`, `ProofSheet.tsx`, `Admin.tsx`, `data/api.ts`, `data/proofs.ts`, `data/admin.ts`, `game/logic.test.ts`.
- **Missing:** `TallyEntry`/`TallyDoc`, `DoubtDoc`, `MomentDoc`; `UserDoc.attestedAdultAt?`; the legacy-`verified` read-migration.
- **Contradicts:** `'verified'` misnames a friction/vibe knob as a trust level (ADR 0001); `blackoutEnabled` is dead config (ADR 0004).

## Files to create / modify
- `src/types.ts` — rename `verified`→`admin_confirmed` in `ClaimMode` (`:4`); drop `blackoutEnabled` (`:26`); add `TallyEntry`/`TallyDoc`, `DoubtDoc`, `MomentDoc`; add `UserDoc.attestedAdultAt?`; fix the `Cell.status` comment (`:48`, drop "verified").
- `src/components/Board.tsx`, `src/components/ProofSheet.tsx`, `src/components/Admin.tsx` — update `'verified'` call sites to `admin_confirmed`.
- `src/data/api.ts`, `src/data/proofs.ts`, `src/data/admin.ts` — update `'verified'` call sites.
- `src/game/logic.test.ts` — update the fixture/assertions referencing `'verified'`.
- a read-migration helper — coerce a persisted legacy `'verified'` to `admin_confirmed` on read; writes always emit `admin_confirmed`.

## Implementation notes
- ADR 0001: the rename is the canonical fix. Keep the "friction/vibe knob, NOT a trust level" framing in the type doc-comment and avoid the word "verified" in comments (glossary Avoid term).
- The read-migration must still ACCEPT a legacy `'verified'` (seeded Events / in-flight docs) and resolve it to `admin_confirmed`; never hard-break existing data.
- ADR 0004: remove `blackoutEnabled` (types only). Keep `reportHideThreshold` (load-bearing). `scripts/seed.mjs` still seeds `blackoutEnabled` — that is `w1-event-seed`, out of scope here.
- ADR 0002 new types feed the Wave-2 greenfield tickets: `TallyEntry` (uid + displayName + markedAt) and `TallyDoc` (attributed per-Prompt marker list + count) for the Tally; `DoubtDoc` for Doubts; `MomentDoc` for Moments (BINGO / Blackout / First to BINGO; no attached evidence).
- `UserDoc.attestedAdultAt?` (timestamp) is consumed by `w1-adult-attestation`.
- HOT-file owner: downstream tickets import these types rather than editing `src/types.ts`.

## Tests to add
- `src/**/*.test.*` — the read-migration reads a legacy `'verified'` value as `admin_confirmed` (layer: unit).
- `npm run typecheck` — all renamed call sites compile and no source references `blackoutEnabled` (layer: unit/typecheck).

## Acceptance criteria
- **Given** a persisted Event with `claimMode: 'verified'` **When** it is read through the migration **Then** it resolves to `admin_confirmed` and no write re-introduces `'verified'`.
- **Given** `blackoutEnabled` removed from the type **When** `npm run typecheck` runs **Then** no TypeScript source references it (`seed.mjs` excluded — handled by `w1-event-seed`).
- **Given** `TallyDoc`/`DoubtDoc`/`MomentDoc`/`attestedAdultAt` exist **When** Wave-2 tickets import them **Then** no further edits to `src/types.ts` are needed.
- [ ] `verified` renamed to `admin_confirmed` in the type + all 7 call sites.
- [ ] Legacy-`verified` read-migration added and tested.
- [ ] `blackoutEnabled` removed from `EventDoc.settings`.
- [ ] `TallyEntry`/`TallyDoc`, `DoubtDoc`, `MomentDoc`, `UserDoc.attestedAdultAt?` added; `Cell.status` comment fixed.

## Definition of Done
- [ ] Spec `specs/w0-type-contract.md` created/updated **with a matching test** (checker `scripts/ci/check_spec_test_alignment` matches basename → a test under `tests/**` or `src/**/*.test.*`; design-only specs use frontmatter `tested: false` + `reason:`)
- [ ] `npm run typecheck` · `npm test` · `npm run build` green locally (no `lint` script; app tests are not CI-run — record in the commit `Verified:` trailer)
- [ ] Repo gates pass: `repo_lint` (incl. spec↔test alignment), `md-prose-wrap`, review-policy label gate
- [ ] Conventional commits + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`; PR body `Closes #<this issue>`; authored `nathanjohnpayne`, reviewed under `nathanpayne-{agent}`; driven to merge
- [ ] Board discipline per `docs/agents/ticket-workflow.md` (claim → In progress; PR → In review; merge → Done)

## Dependencies
- Depends on: none.
- Blocks #__NUM_w1-adult-attestation__ — provides `UserDoc.attestedAdultAt?`.
- Blocks #__NUM_w1-event-seed__ — the `blackoutEnabled`/`claimMode` reconciliation follows the type change.
- Blocks #__NUM_w1-board-deal-join__ — shares the reconciled Board / Claim Mode types.
- Blocks #__NUM_w2-tally__ — provides `TallyEntry`/`TallyDoc`.
- Blocks #__NUM_w3-claim-modes__ — provides the renamed `admin_confirmed` Claim Mode.
