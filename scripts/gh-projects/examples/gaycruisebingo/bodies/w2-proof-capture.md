**Track:** proof · **Phase:** 0 · **Wave:** 2 · **Size:** L · **ADR(s):** 0002, 0004
**Epic:** #__NUM_epic-social__
**Labels:** agent-action, track:proof, phase-0, wave-2, size:L

## Context & scope
A Proof is the playful photo, audio clip, or text callout a Player attaches when marking a Square; it posts to the Feed and is flavour, never enforcement (ADR 0002). Most of the pipeline is already scaffolded — this ticket completes and verifies it end to end: a Proof reaches the Feed, Proof-to-mark (`proof_required`) requires a Proof before a Square marks, and the offline path holds (the honor Mark queues, the media attaches on reconnect — ADR 0006). Proof media is the one thing that still needs signal; the Mark itself never blocks on it.

## Current state (scaffold)
- **Exists:** `ProofSheet.tsx` captures photo (`<input capture>`), audio (MediaRecorder, `src/components/ProofSheet.tsx:37-61`), or text; `attachProof` is transactional — uploads media, writes the proof doc, marks the cell, recomputes stats (`src/data/proofs.ts:29-104`); `downscaleImage` (canvas ~1280px, q0.82) and `uploadProofMedia` (`proofs/{EVENT_ID}/{uid}/{proofId}.{jpg|webm}`) exist (`src/data/storage.ts:5-40`); the Feed renders proofs (`src/components/ProofFeed.tsx`).
- **Missing:** End-to-end verification that a completed Proof appears in the Feed; explicit Proof-to-mark gating that a Square cannot mark without a Proof; an offline test that the Mark survives and the media attaches on reconnect. No tests exist for any proof path (the only app test is `src/game/logic.test.ts`).
- **Contradicts:** `ProofSheet.tsx:147,150-154` and `attachProof` branch on the literal `'verified'` value (`proofs.ts:44`); the Admin-confirmed rename is owned by #__NUM_w0-type-contract__ and the mode wiring by #__NUM_w3-claim-modes__ — leave the value read-compatible here.

## Files to create / modify
- `src/components/ProofSheet.tsx` — verify the three capture types submit and close; keep flavour framing (never "required for credit").
- `src/data/proofs.ts` — confirm `attachProof` posts an `active` proof to the Feed in Honor / Proof-to-mark; keep the transaction.
- `src/data/storage.ts` — confirm `uploadProofMedia` path + `downscaleImage`; no re-implementation.
- `src/components/Board.tsx` — in Proof-to-mark, the Square opens `ProofSheet` rather than marking directly (`Board.tsx:75-76`); confirm a cancelled sheet leaves the Square unmarked.

## Implementation notes
- A Proof posts to the Feed (ADR 0002) — this is the one Mark-adjacent act that does; a bare Mark still posts nothing to the Feed.
- Proof-to-mark (`proof_required`) is friction, not trust (ADR 0001): the Proof enriches the Feed, it does not make the Mark more trustworthy. Do not describe it as verification.
- Offline (ADR 0006): the honor Mark queues durably in IndexedDB; the photo/audio upload needs signal, so the media attaches when connectivity returns. Do not block the Mark on the upload.
- Moderation (ADR 0004): a posted Proof is subject to the reactive report → threshold → hide path; a Proof already carries `reportCount` + `status` (`src/types.ts:82-98`).

## Tests to add
- `src/components/ProofSheet.test.tsx` — each capture type (photo / audio / text) produces a valid submit; cancel leaves the Square unmarked (layer: RTL-jsdom).
- `src/data/proofs.test.ts` — `attachProof` writes an `active` (Feed-visible) proof and marks the cell in Honor / Proof-to-mark (layer: unit / rules-emulator).
- `tests/rules/storage.test.ts` — the proof media path + MIME/size caps hold (layer: rules-emulator; coordinated with #__NUM_w0-storage-rules__).

## Acceptance criteria
- **Given** a Player attaches a Proof **When** it commits **Then** the Proof appears newest-first in the Feed with the Player's name and the Prompt text (ADR 0002).
- **Given** the Event is in Proof-to-mark **When** a Player taps an unmarked Square **Then** the Square does not mark until a Proof is attached (friction, not trust — ADR 0001).
- **Given** a Player marks offline **When** the app reloads and reconnects **Then** the Mark survives and the media attaches on reconnect (offline mark survives reload — ADR 0006).
- [ ] Photo, audio, and text Proofs all post to the Feed.
- [ ] A Proof never gates credit — it is flavour, not enforcement.

## Definition of Done
- [ ] Spec `specs/w2-proof-capture.md` created/updated **with a matching test** (checker `scripts/ci/check_spec_test_alignment` matches basename → a test under `tests/**` or `src/**/*.test.*`; design-only specs use frontmatter `tested: false` + `reason:`)
- [ ] `npm run typecheck` · `npm test` · `npm run build` green locally (no `lint` script; app tests are not CI-run — record in the commit `Verified:` trailer)
- [ ] Repo gates pass: `repo_lint` (incl. spec↔test alignment), `md-prose-wrap`, review-policy label gate
- [ ] Conventional commits + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`; PR body `Closes #<this issue>`; authored `nathanjohnpayne`, reviewed under `nathanpayne-{agent}`; driven to merge
- [ ] Board discipline per `docs/agents/ticket-workflow.md` (claim → In progress; PR → In review; merge → Done)

## Dependencies
- Depends on #__NUM_w1-board-mark-win__ — Proof capture attaches to the mark flow that ticket owns.
- Depends on #__NUM_w0-storage-rules__ — the proof media path + MIME/size caps are proven there.
- Blocks #__NUM_w2-doubts__
- Blocks #__NUM_w2-feed-moments__
- Blocks #__NUM_w3-claim-modes__
