**Track:** security · **Phase:** 0 · **Wave:** 0 · **Size:** S · **ADR(s):** 0002 · **Model:** Opus 4.8
**Epic:** #12
**Labels:** agent-action, track:security, phase-0, wave-0, size:S, needs-phase-4

## Context & scope
CodeQL flags a **high** DOM-XSS (`js/xss-through-dom`, alert #1) in the Proof sheet: "DOM text is reinterpreted as HTML without escaping meta-characters." A public, `noindex`, 18+ app must not ship a DOM-XSS in user-generated Proof content — a Proof is public in the Feed (ADR 0002), so an unescaped value would execute for every viewer, not just its author. Fix the tainted flow correctly without breaking Proof capture.

## Current state (scaffold)
- **Exists:** `src/components/ProofSheet.tsx` captures a Proof as photo (object URL), audio (MediaRecorder), or a **text** callout (user-typed). CodeQL points at ~`ProofSheet.tsx:112`, **but the scanned line numbers are stale** (the seed alert is flagged at L160 in a ~100-line file), so the cited line is from an older revision.
- **Missing:** any escaping / sink hardening on the user-controlled Proof value where it reaches the DOM.
- **Contradicts:** ships a high-severity XSS on a public surface.

## Files to create / modify
- `src/components/ProofSheet.tsx` — the flagged component.
- `src/components/ProofFeed.tsx` — if the same Proof text/URL is rendered here too, harden both sinks.

## Implementation notes
- **Do not just patch the cited line.** Re-derive the real flow on current code (re-run CodeQL locally, or trace it): find where user input (the text callout, or a URL) reaches an HTML sink (`dangerouslySetInnerHTML`, `innerHTML`, a URL attribute, `document.write`, etc.).
- Fix at the sink: prefer React's default text interpolation (JSX auto-escapes) or `textContent`; if `dangerouslySetInnerHTML` is in play, remove it or run the value through a sanitizer; for URLs, validate the scheme and block `javascript:`.
- Decide true-vs-false-positive. If it is genuinely unreachable, dismiss the alert in the CodeQL UI **with a written rationale** instead of a code change — but a sink fix is preferred when in doubt.
- Keep photo/audio/text Proof capture working.

## Tests to add
- `src/components/ProofSheet.test.tsx` — a Proof **text** callout containing HTML/script meta-characters (`<img src=x onerror=alert(1)>`) renders as inert text; no HTML is injected (layer: RTL-jsdom).
- unit test on any escaping / URL-scheme-validation helper you extract (layer: unit).

## Acceptance criteria
- **Given** a Proof text callout of `<img src=x onerror=alert(1)>` **When** it renders in the sheet and Feed **Then** it appears as literal text and no script executes.
- [ ] CodeQL `js/xss-through-dom` alert #1 is closed on a re-scan (a green build alone does not prove the sink is gone).
- [ ] Photo / audio / text Proof capture still works end-to-end.

## Definition of Done
- [ ] Spec `specs/sec-xss-proofsheet.md` created **with a matching test** (`src/components/ProofSheet.test.tsx`).
- [ ] `npm run typecheck` · `npm test` · `npm run build` green locally (recorded in the `Verified:` trailer).
- [ ] Re-run CodeQL (push + let the scan run, or `codeql` locally) and confirm alert #1 is resolved.
- [ ] `needs-phase-4`: keep the PR small; expect external review (security-sensitive).
- [ ] Conventional commits + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`; PR `Closes #<this issue>`; authored `nathanjohnpayne`, reviewed under `nathanpayne-{agent}`; driven to merge.
- [ ] Board discipline per `docs/agents/ticket-workflow.md`.

## Dependencies
- Blocks #32 — `w2-proof-capture` builds on the sanitized `ProofSheet`.

## Model
**Opus 4.8** — the fix needs data-flow reasoning (locate the real sink on a revision whose line numbers have drifted, judge true-vs-false-positive) and high-stakes correctness; a wrong XSS "fix" leaves the hole open.
