**Track:** security · **Phase:** 0 · **Wave:** 0 · **Size:** S · **ADR(s):** 0002 · **Model:** Opus 4.8
**Epic:** #12
**Labels:** agent-action, track:security, phase-0, wave-0, size:S, needs-phase-4

## Context & scope
CodeQL flags a **second high** DOM-XSS (`js/xss-through-dom`, alert #3, opened 2026-07-08) in `src/components/ProofSheet.tsx` at L119: "DOM text is reinterpreted as HTML without escaping meta-characters" (CWE-79 / CWE-116). This is a **distinct sink** from #85's media-`src` URL issue — this one is a text→HTML reinterpretation. Same public, `noindex`, 18+ surface; a Proof is public in the Feed (ADR 0002), so the value executes for every viewer. Fix the L119 sink without breaking Proof capture.

## Current state (scaffold)
- **Exists:** `src/components/ProofSheet.tsx` reinterprets user-controlled DOM text as HTML around L119 (line numbers drift between scans — re-derive on current code).
- **#89 has merged** (it fixed #85's media-`src` sink) and did **not** resolve alert #3 — confirmed a separate, still-open sink. `ProofSheet.tsx` is no longer locked by an open PR, so this is safe to pick up.
- **Contradicts:** ships a second high XSS on a public surface.

## Files to create / modify
- `src/components/ProofSheet.tsx` — the L119 text→HTML sink.
- `src/components/ProofFeed.tsx` — if the same Proof value renders there too.

## Implementation notes
- Overlap with #89 already checked: #89 merged and alert #3 is **still open**, so a fix is genuinely needed (not a duplicate). Branch off current `main`.
- Locate the real sink at/near L119 (likely `innerHTML` / `dangerouslySetInnerHTML` on a user-controlled Proof value). Fix at the sink: React text interpolation / `textContent`, or sanitize.
- Re-derive against the **current merged** `ProofSheet.tsx` (it was completed in PR #80 / #32 and further changed by #89).

## Tests to add
- `src/components/ProofSheet.test.tsx` — a Proof value containing HTML/script meta-characters routed through the L119 sink renders as inert text; no HTML injected (layer: RTL-jsdom). Extend the file added by #85 rather than duplicating it.

## Acceptance criteria
- **Given** a Proof value of `<img src=x onerror=alert(1)>` reaching the L119 sink **When** it renders **Then** it appears as literal text and no script executes.
- [ ] CodeQL `js/xss-through-dom` **alert #3** is closed on a re-scan.
- [ ] Photo / audio / text Proof capture still works.

## Definition of Done
- [ ] Spec `specs/sec-xss-proofsheet-2.md` created **with a matching test** — OR, if closed as fixed-by-#89, dismiss the alert with a written rationale (no spec/test needed).
- [ ] `npm run typecheck` · `npm test` · `npm run build` green locally (recorded in the `Verified:` trailer).
- [ ] Re-run CodeQL and confirm alert #3 is resolved.
- [ ] `needs-phase-4`: keep the PR small; expect external review (security-sensitive).
- [ ] Conventional commits + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`; PR `Closes #<this issue>`; authored `nathanjohnpayne`, reviewed under `nathanpayne-{agent}`; driven to merge.
- [ ] Board discipline per `docs/agents/ticket-workflow.md`.

## Dependencies
- #85 / PR #89 have merged (dependency cleared); this is Ready. Re-derive the sink on the current merged `ProofSheet.tsx`.

## Model
**Opus 4.8** — data-flow reasoning to locate the real sink at a drifting line number, judge overlap with the in-review #89, and get a security fix right the first time.
