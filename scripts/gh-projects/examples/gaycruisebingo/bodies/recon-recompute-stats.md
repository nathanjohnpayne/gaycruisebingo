**Track:** reconciliation · **Phase:** 0 · **Wave:** 2 · **Size:** S · **ADR(s):** 0001
**Epic:** #__NUM_epic-moderation__
**Labels:** agent-action, track:reconciliation, phase-0, wave-2, size:S, reconciliation, needs-phase-4

## Context & scope
This is a NET-REMOVAL ticket. ADR 0001 (honor system) makes Marks client-authoritative and self-writable `players/{uid}` intentional. The scaffolded `recomputeStats` Function (`functions/src/index.ts:68`) is framed as authoritative / anti-cheat, but it reads the SAME Player-written Board and rewrites the SAME stats — so it cannot make Marks trustworthy; it only re-derives what the client already wrote. This ticket REMOVES it as anti-cheat. If kept at all, it must be relabelled explicitly as consistency / repair only — never integrity / anti-cheat. It also fixes the `docs/app/phase-1-deploy.md` guidance that advises locking player-stat writes to admins-only, which contradicts ADR 0001. Players stay self-writable. `needs-phase-4` because it touches `functions/`.

## Current state (scaffold)
- **Exists (to remove / relabel):** `recomputeStats` (`functions/src/index.ts:68`, `onDocumentWritten('events/{eventId}/boards/{uid}')` → recomputes `bingoCount` / `squaresMarked` / `blackout` / `firstBingoAt` from the Board's marked Squares and writes the Player doc). Its doc-comment (`:62-66`) frames it as "Authoritative, server-side stat recomputation … you can lock player-stat writes to admins-only."
- **Exists (to fix):** `docs/app/phase-1-deploy.md:53-65` — an "Optional hardening" block telling the operator to tighten the `players/{uid}` rule to profile-fields-only so stat writes become server-owned; and the "authoritative player stats" wording at `:23`.
- **Missing:** n/a — this is a removal + doc fix.
- **Contradicts:** `recomputeStats`-as-anti-cheat and the stat-locking guidance both CONTRADICT ADR 0001; ADR 0001 supersedes them.

## Files to create / modify
- `functions/src/index.ts` — remove the `recomputeStats` export (`:62-85`) and its now-orphaned imports (`onDocumentWritten` at `:3`; `completedLines` / `countMarked` / `isBlackout` / `type Cell` at `:10`) so the functions build stays green; keep `moderateProof`. (The `share` removal is owned by #__NUM_recon-share-og__.)
- `docs/app/phase-1-deploy.md` — delete the "Optional hardening" stat-locking block (`:53-65`), correct the "authoritative player stats" wording (`:23`), and state that Players are self-writable by design (ADR 0001) with stats staying client-authoritative.

## Implementation notes
- The core argument (ADR 0001): `recomputeStats` reads the Player-written `boards/{uid}` and writes `players/{uid}` — same data in, same data out. It re-derives client-authored Marks; it does NOT validate individual Mark transitions (its own comment admits full anti-cheat "would also validate individual mark transitions; out of scope"). So it adds no integrity, and keeping it as anti-cheat is a category error. Remove it.
- If a repair job is genuinely wanted later, it must be labelled consistency / repair ONLY (idempotent re-derivation to fix a corrupted stat), never integrity / anti-cheat, and must NOT motivate locking `players/{uid}` writes.
- Fix the docs so no one applies the stat-lock: `players/{uid}` stays self-writable (ADR 0001). The `phase-1-deploy.md` block itself warns the lock breaks `joinAndDeal` / `setMark` / `attachProof` — delete the block rather than removing the client writes.
- Do NOT re-add server recompute as anti-cheat in Phase 1: #__NUM_w4-phase1-functions__ keeps Vision extreme-only + the server hide, but not stat recompute. Pair with the rule-comment documentation in #__NUM_w3-security-hardening__.
- `needs-phase-4`: `functions/` is not a protected path today, but keep the PR small (< 300 lines) and expect external review.

## Tests to add
- `tests/reconciliation/recon-recompute-stats.test.ts` — asserts `functions/src/index.ts` exports no `recomputeStats` and `docs/app/phase-1-deploy.md` no longer contains the stat-locking `players/{uid}` hardening block (layer: unit).
- Note: the guard that `players/{uid}` self-write stays ALLOWED lives with the rules tests in #__NUM_w0-firestore-rules__ / #__NUM_w3-security-hardening__ — reference it rather than duplicating.

## Acceptance criteria
- **Given** ADR 0001 (client-authoritative Marks, self-writable Players) **When** this lands **Then** `recomputeStats`-as-anti-cheat is gone and `players/{uid}` remains self-writable.
- **Given** a future operator reading `phase-1-deploy.md` **When** they reach deploy hardening **Then** there is NO guidance to lock player-stat writes to admins-only.
- [ ] `recomputeStats` removed from `functions/src/index.ts` (+ orphaned imports); the functions build is green.
- [ ] `phase-1-deploy.md:53-65` stat-locking block removed; the "authoritative stats" wording corrected.
- [ ] Players stay self-writable (no rule lock-down introduced).
- [ ] If any repair job is retained, it is labelled consistency / repair only — never anti-cheat.

## Definition of Done
- [ ] Spec `specs/recon-recompute-stats.md` created/updated **with a matching test** (checker `scripts/ci/check_spec_test_alignment` matches basename → a test under `tests/**` or `src/**/*.test.*`; design-only specs use frontmatter `tested: false` + `reason:`)
- [ ] `npm run typecheck` · `npm test` · `npm run build` green locally (no `lint` script; app tests are not CI-run — record in the commit `Verified:` trailer)
- [ ] Repo gates pass: `repo_lint` (incl. spec↔test alignment), `md-prose-wrap`, review-policy label gate
- [ ] Conventional commits + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`; PR body `Closes #<this issue>`; authored `nathanjohnpayne`, reviewed under `nathanpayne-{agent}`; driven to merge
- [ ] Board discipline per `docs/agents/ticket-workflow.md` (claim → In progress; PR → In review; merge → Done)

## Dependencies
- None — this net-removal has no upstream blocker and no downstream blocker.
- Coordinates with #__NUM_w3-security-hardening__ (documents the self-writable-by-design rules) and #__NUM_w4-phase1-functions__ (must not re-add recompute-as-anti-cheat); the keep-vs-remove decision is tracked in #__NUM_x-decisions-needed__.
