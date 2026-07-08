**Track:** feed · **Phase:** 0 · **Wave:** 2 · **Size:** L · **ADR(s):** 0002
**Epic:** #__NUM_epic-social__
**Labels:** agent-action, track:feed, phase-0, wave-2, size:L

## Context & scope
The Feed is the live, public stream the group watches together — Proofs plus Moments, newest first — the honor-system source of truth in place of server verification (ADR 0002). Proofs already flow into it; this ticket adds Moments: a Moment broadcasts a big social beat — a BINGO, a Blackout, or the First to BINGO — with no attached evidence (unlike a Proof, which carries media). Moments merge newest-first with Proofs into one Feed. A bare Mark posts nothing to the Feed (ADR 0002) — only Proofs and Moments appear there.

## Current state (scaffold)
- **Exists:** `ProofFeed.tsx` renders the proof stream with report (⚑, `src/components/ProofFeed.tsx:35`), owner-delete (🗑, `:39`), and a "flagged for review" badge (`:47`); `useProofFeed` subscribes to `status == 'active'` proofs, sorts newest-first, slices 60 (`src/hooks/useData.ts:88-97`). BINGO / Blackout are already detected on the edge in `Board.tsx:37-42`; `firstBingoAt` is stamped in `setMark`/`attachProof`.
- **Missing:** No Moment anywhere — no `moments` collection, no `MomentDoc` type (`src/types.ts` has none), no broadcast on BINGO / Blackout / First to BINGO, and no merge of Moments into the Feed. `ProofFeed.tsx` is proof-only; the surface is not yet the combined Feed.
- **Contradicts:** none — additive to the existing proof stream.

## Files to create / modify
- `src/types.ts` — consume `MomentDoc` (owned by #__NUM_w0-type-contract__), with a `kind: 'bingo' | 'blackout' | 'first_bingo'`.
- `src/data/paths.ts` — add a `momentsCol` / `momentRef` converter ref under `events/{EVENT_ID}/moments`.
- `src/data/moments.ts` (new) — broadcast a Moment doc on first BINGO, Blackout, and First to BINGO; carries no media.
- `src/components/Board.tsx` — where BINGO / Blackout first fire (`:37-42`), broadcast the matching Moment (first-BINGO only, not every completed line).
- `src/components/ProofFeed.tsx` — render Moments alongside Proofs; rename the surface to the Feed.
- `src/hooks/useData.ts` — a combined subscription (or a merge of `useProofFeed` + `useMoments`) sorted newest-first.

## Implementation notes
- A Moment carries no attached evidence (ADR 0002 / glossary): it marks that something happened, not what it looked like. Do not attach media or a `proofId` to a Moment.
- A bare Mark posts nothing to the Feed (ADR 0002). Only a Proof or a Moment appears — a plain honor Mark that is neither must not create a Feed entry.
- Broadcast a first-BINGO Moment once per Player (on the transition into having a BINGO, mirroring the `Board.tsx:40-42` edge detection), not on every completed line; Blackout once; First to BINGO once for the Event's earliest first-bingo.
- Merge Moments and Proofs into one newest-first stream; keep the existing `slice(60)` cap so the Feed stays light on ship wifi.
- First to BINGO is ceremonial and self-reported (ADR 0001) — the Moment records the honour, it does not verify it.

## Tests to add
- `tests/rules/moments.test.ts` — a Player may broadcast their own Moment; a Moment has no media/proof binding (layer: rules-emulator).
- `src/data/moments.test.ts` — a first BINGO broadcasts exactly one `bingo` Moment; a Blackout broadcasts one `blackout` Moment (layer: unit).
- `src/components/ProofFeed.test.tsx` — Moments and Proofs render merged newest-first; a bare Mark produces no Feed entry (layer: RTL-jsdom).

## Acceptance criteria
- **Given** a Player scores their first BINGO **When** it commits **Then** a BINGO Moment appears newest-first in the Feed with no attached evidence (ADR 0002).
- **Given** a Player only marks a Square (no Proof) **When** the Feed refreshes **Then** nothing about that Mark appears in the Feed (ADR 0002).
- [ ] Moments broadcast on first BINGO, Blackout, and First to BINGO — each once.
- [ ] Moments and Proofs merge newest-first into one Feed.
- [ ] A Moment never carries media or a `proofId`.

## Definition of Done
- [ ] Spec `specs/w2-feed-moments.md` created/updated **with a matching test** (checker `scripts/ci/check_spec_test_alignment` matches basename → a test under `tests/**` or `src/**/*.test.*`; design-only specs use frontmatter `tested: false` + `reason:`)
- [ ] `npm run typecheck` · `npm test` · `npm run build` green locally (no `lint` script; app tests are not CI-run — record in the commit `Verified:` trailer)
- [ ] Repo gates pass: `repo_lint` (incl. spec↔test alignment), `md-prose-wrap`, review-policy label gate
- [ ] Conventional commits + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`; PR body `Closes #<this issue>`; authored `nathanjohnpayne`, reviewed under `nathanpayne-{agent}`; driven to merge
- [ ] Board discipline per `docs/agents/ticket-workflow.md` (claim → In progress; PR → In review; merge → Done)

## Dependencies
- Depends on #__NUM_w2-proof-capture__ — Moments merge into the same Feed the Proof stream feeds.
- Depends on #__NUM_w1-board-mark-win__ — Moments broadcast off the BINGO / Blackout detection that ticket owns.
