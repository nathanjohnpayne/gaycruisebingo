**Track:** security · **Phase:** 0 · **Wave:** 0 · **Size:** S · **ADR(s):** — · **Model:** Fable 5
**Epic:** #12
**Labels:** agent-action, track:security, phase-0, wave-0, size:S, needs-phase-4

## Context & scope
CodeQL flags a **high** `js/clear-text-logging` (alert #2) in the Event/pool seed script: it logs a value read from `process.env` (`ADMIN_UID`) in clear text. Real risk is low — a Google account uid is an identifier, not a credential — but resolve the alert cleanly so the default branch is green. A one-line redaction.

## Current state (scaffold)
- **Exists:** `scripts/seed.mjs` ends with `console.log(ADMIN_UID ? 'Admin: ${ADMIN_UID}' : 'No ADMIN_UID set …')`, echoing the raw uid. CodeQL cites ~`seed.mjs:160`, **but the file is ~100 lines** — the scanned line number is stale; the real site is that final `console.log`.
- **Missing:** redaction of the env-derived value in the log.
- **Contradicts:** clear-text logging of environment-sourced data (CodeQL high).

## Files to create / modify
- `scripts/seed.mjs` — the final `console.log` that prints `ADMIN_UID`.

## Implementation notes
- Redact: log a non-sensitive form — e.g. `Admin: set` / `Admin: none — set ADMIN_UID and re-run` — instead of the raw uid. Keep the "did/didn't set an admin" signal without printing the value.
- Alternatively, if you judge it a false positive (uid is not a secret), dismiss the alert in the CodeQL UI with a rationale — but the one-line redaction is simpler and removes any doubt.
- **Coordinate with #22 (`w1-event-seed`)**, which also reconciles `scripts/seed.mjs` (drops `blackoutEnabled`, aligns the `claimMode` comment). Whoever lands second rebases — trivial. Do not duplicate #22's changes here; scope this PR to the log line only.

## Tests to add
- `scripts/seed.mjs` is a one-off ops/admin script with no runtime unit surface, so the spec is design/ops-only: `specs/sec-clear-text-logging-seed.md` uses frontmatter `tested: false` + a `reason:` (ops script; behavior verified by re-running the seed + CodeQL). If you extract a tiny redaction helper, add a colocated unit test for it instead.

## Acceptance criteria
- **Given** the seed script runs (`ADMIN_UID=… node scripts/seed.mjs`) **When** it finishes **Then** it does not print the raw `ADMIN_UID`.
- [ ] CodeQL `js/clear-text-logging` alert #2 is closed on a re-scan.
- [ ] The seed still reports whether an Admin was set (redacted).

## Definition of Done
- [ ] Spec `specs/sec-clear-text-logging-seed.md` created (`tested: false` + `reason:` — ops script) so `scripts/ci/check_spec_test_alignment` passes.
- [ ] `npm run typecheck` · `npm run build` green (no app test surface); recorded in the `Verified:` trailer.
- [ ] Re-run CodeQL and confirm alert #2 is resolved.
- [ ] `needs-phase-4`: keep the PR small; expect external review (security-sensitive).
- [ ] Conventional commits + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`; PR `Closes #<this issue>`; authored `nathanjohnpayne`, reviewed under `nathanpayne-{agent}`; driven to merge.
- [ ] Board discipline per `docs/agents/ticket-workflow.md`.

## Dependencies
- Relates to #22 — both edit `scripts/seed.mjs`; coordinate / rebase (trivial).

## Model
**Fable 5** — a one-line redaction with no data-flow reasoning; the true-vs-false-positive call is light (a uid is not a credential).
