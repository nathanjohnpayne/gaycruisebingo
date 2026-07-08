**Track:** security · **Phase:** hardening · **Wave:** 3 · **Size:** M · **ADR(s):** 0001, 0002, 0004
**Epic:** #__NUM_epic-moderation__
**Labels:** agent-action, track:security, hardening, wave-3, size:M, needs-phase-4

## Context & scope
A hardening pass whose main job is protecting the intentional design from a well-meaning "fix." It verifies `noindex`, adds an acceptable-use / community-guidelines page (18+, how to report), DOCUMENTS in the rules comments that self-writable `boards/{uid}` + `players/{uid}` are intentional (ADR 0001) and that every Mark publishes to a public per-Prompt Tally (ADR 0002), and PROPOSES closing the protected-path gap by adding `firestore.rules` / `storage.rules` / `functions/**` to `.github/review-policy.yml` `external_review_paths`. No public unauthenticated pages (ADR 0005). Storage MIME/size caps already exist (`storage.rules:11-18`) and are not re-litigated here.

## Current state (scaffold)
- **Exists:** `index.html:25` `<meta name="robots" content="noindex" />`. `firestore.rules` self-write `players/{uid}` (`:45-49`) and `boards/{uid}` (`:52-54`) — intentional per ADR 0001 but not commented as such. `.github/review-policy.yml` `external_review_paths` (`:26-31`): `src/auth/**`, `src/payments/**`, `**/*secret*`, `**/*credential*`, `.github/**`. Static OG block in `index.html:15-24`.
- **Missing:** an acceptable-use / community-guidelines page; the self-writable-by-design + Tally-publishes rule comments; the three proposed `external_review_paths` globs (`firestore.rules` / `storage.rules` / `functions/**` are NOT protected paths today).
- **Contradicts:** none — this ticket hardens and documents. It must NOT lock down the self-writable rules; doing so would misread ADR 0001.

## Files to create / modify
- `firestore.rules` — comments only: mark `players/{uid}` + `boards/{uid}` self-write as intentional (ADR 0001) and the per-Prompt Tally write as the public-by-design differentiator (ADR 0002). No behavior change.
- `index.html` — verify `noindex` stays (`:25`); add no public route.
- an acceptable-use / community-guidelines page (new component + route, behind auth) — 18+, community guidelines, how to report a Prompt or Proof.
- `.github/review-policy.yml` — PROPOSE adding `firestore.rules`, `storage.rules`, `functions/**` to `external_review_paths`. Editing this file is itself under `.github/**`, so the PR auto-escalates (`needs-phase-4`).

## Implementation notes
- Do NOT change rule behavior. Self-writable `boards` / `players` are load-bearing honor-system design (ADR 0001); a lock-down "fix" is a misread. The comments exist so a future human or agent reviewer doesn't revert it. Pair with #__NUM_recon-recompute-stats__, which removes the server recompute that implied the rules should be locked.
- Tally comment: every Mark publishes an attributed entry to the Prompt's public Tally (ADR 0002); the Board stays private; a bare Mark posts nothing to the Feed. Document — do not alter — the Tally write rules from #__NUM_w0-firestore-rules__.
- The acceptable-use page must sit BEHIND auth — no public unauthenticated pages (ADR 0005). Link it from the app chrome; cover the 18+ posture and the report path that feeds #__NUM_w2-admin-console__.
- `external_review_paths`: the merge-blocking label is `needs-external-review`, applied automatically at ≥ 300 changed lines or when a diff touches `src/auth/**`, `**/*secret*`, `**/*credential*`, or `.github/**`. Adding the three globs is a policy proposal; keep the PR < 300 lines. `needs-phase-4` here is a planning marker.

## Tests to add
- `tests/rules/self-writable.test.ts` — documentation-guard: self-writable `boards/{uid}` + `players/{uid}` writes are ALLOWED for the owner, and a Mark publishes to the Tally (ADR 0001/0002), so the intent is test-pinned, not just commented (layer: rules-emulator).
- `src/components/AcceptableUse.test.tsx` — the page renders behind auth and is not reachable while signed out (layer: RTL-jsdom).

## Acceptance criteria
- **Given** the deployed app **When** a crawler fetches `/` **Then** `robots: noindex` is served (`index.html:25`) and no public unauthenticated route exists (ADR 0005).
- **Given** a signed-in Player **When** they open the acceptable-use page **Then** they see the 18+ community guidelines and how to report; signed-out access is not possible.
- **Given** a reviewer reading `firestore.rules` **When** they reach `players/{uid}` / `boards/{uid}` **Then** a comment states the self-write is intentional (ADR 0001) and must not be locked down.
- [ ] `firestore.rules` comments added (self-writable-by-design + Tally-publishes); no behavior change.
- [ ] Acceptable-use page behind auth, linked from chrome.
- [ ] `firestore.rules` / `storage.rules` / `functions/**` proposed for `external_review_paths`.
- [ ] `noindex` verified; no public pages added.

## Definition of Done
- [ ] Spec `specs/w3-security-hardening.md` created/updated **with a matching test** (checker `scripts/ci/check_spec_test_alignment` matches basename → a test under `tests/**` or `src/**/*.test.*`; design-only specs use frontmatter `tested: false` + `reason:`)
- [ ] `npm run typecheck` · `npm test` · `npm run build` green locally (no `lint` script; app tests are not CI-run — record in the commit `Verified:` trailer)
- [ ] Repo gates pass: `repo_lint` (incl. spec↔test alignment), `md-prose-wrap`, review-policy label gate
- [ ] Conventional commits + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`; PR body `Closes #<this issue>`; authored `nathanjohnpayne`, reviewed under `nathanpayne-{agent}`; driven to merge
- [ ] Board discipline per `docs/agents/ticket-workflow.md` (claim → In progress; PR → In review; merge → Done)

## Dependencies
- Depends on #__NUM_w0-firestore-rules__ — the reconciled rules whose intent this ticket documents and test-pins.
- Coordinates with #__NUM_recon-recompute-stats__ (removes the recompute that implied stat-locking) and #__NUM_w2-admin-console__ (the report path the guidelines describe).
