**Track:** scoring · **Phase:** 1.5 · **Wave:** 3 · **Size:** S · **Cut line:** nice-to-have (post-sailaway)

## Context & scope

Implements `daily-cards-spec.md` § "Asking for proof — Doubts", the optional enhancement noted there: each Leaderboard row carries that Player's latest-proof media chips (📷 🎙️ ✍️ 🖼️), tap-through to the proof in the Feed. Purely additive and presentational — it never changes what the ranking measures.

## Current state

`Leaderboard.tsx` renders one row per Player with rank, avatar, name, and a stats line (`src/components/Leaderboard.tsx:226-241`); it carries no per-Player proof/media information today. `ProofDoc` (`src/types.ts:110-129`) has a `type: 'photo' | 'audio' | 'text'` field but no `source` field yet — `source?: 'camera' | 'library'` and the 🖼️ badge are added by `#__NUM_d15-schema-contract__` / stamped by `#__NUM_d15-claim-sheet-photo__`. `src/hooks/useData.ts` has `useMyProofs(uid)` (`:492`, a single Player's own proofs) and `useProofsForItemText(itemText)` (`:524`, all proofs for one Prompt), but nothing that resolves "this Player's single most recent Proof across every Prompt and Day" — that read does not exist yet and this ticket adds it.

## Files to create / modify

- `src/hooks/useData.ts` (modify) — a new read, e.g. `useLatestProofByUid()`, returning a `Record<uid, ProofDoc>` of each Player's most recent Proof (by `createdAt`), sourced from the existing Proofs collection query pattern.
- `src/components/Leaderboard.tsx` (modify) — render each row's latest-proof media chip(s) (📷 🎙️ ✍️, plus 🖼️ when `source === 'library'`) next to or under the stats line; tapping navigates to that proof in the Feed.
- `src/components/ProofFeed.tsx` (modify only if the Feed needs a scroll-to/deep-link target for a specific `proof.id`; otherwise navigate to `/feed` and rely on existing ordering).

## Implementation notes

- Chip set: 📷 photo, 🎙️ audio, ✍️ text, plus 🖼️ layered on for a library-sourced photo (per `#__NUM_d15-claim-sheet-photo__`'s badge). These stay emoji per `#__NUM_d15-icons-lucide__`'s rule (Feed source badges are explicitly emoji, never Lucide).
- One Player, one chip set: only the single latest Proof per Player renders, not a history — "latest-proof media chips," singular event, per spec.
- Never changes ranking: this is presentational only, applied after `sortPlayers` has already ordered the roster, mirroring how the existing ban filter and First-to-BINGO pin are applied post-sort in `Leaderboard.tsx` (see the file's own comments on `matchesFilter` and `firstBingoUid`) — do not fold proof recency into any sort/filter logic.
- Tap-through target is the Feed (`/feed`), consistent with the glossary's Feed-is-the-social-source-of-truth framing; a banned Player's row is already hidden from the Leaderboard (`isBanned` filter), so no chip renders for them regardless of proof history.

## Tests to add

- `src/hooks/useData.test.ts` (or a colocated test) — `useLatestProofByUid` returns exactly the most recent Proof per uid when a Player has multiple Proofs across different Days.
- `src/components/Leaderboard.test.tsx` (RTL-jsdom) — a row with a library-sourced photo Proof shows both 📷 and 🖼️; a row with no Proof shows no chip; tapping a chip navigates toward the Feed.

## Acceptance criteria

- **Given** a Player with a library-photo Proof **When** the Leaderboard renders **Then** their row shows 📷🖼️ chips.
- **Given** a Player with no Proof **When** the Leaderboard renders **Then** their row shows no chip and the row layout is unaffected.
- **Given** a Player taps a chip **When** the tap resolves **Then** the app navigates toward that Proof in the Feed.
- **Given** any chip state **When** the Leaderboard is filtered or sorted **Then** rank order is unchanged — chips never influence ranking.
- [ ] `useLatestProofByUid` (or equivalent) added.
- [ ] Leaderboard rows render the correct chip set per Player.
- [ ] Tap-through to the Feed works.
- [ ] Ranking/sort order is provably unaffected by chip presence.

## Definition of Done

- Spec file under `specs/d15-proof-chips-ranks.md` (or a sensible feature name) WITH a matching test (spec↔test alignment CI).
- `npm run typecheck` + `npm test` + `npm run build` green; md-prose-wrap clean.
- PR body `Closes #<this issue>`; authored `nathanjohnpayne`, driven through REVIEW_POLICY.md to merge.
- Board discipline per `docs/agents/ticket-workflow.md`.

## Dependencies

Depends on #__NUM_d15-scoring-aggregates__ (the cruise-wide Leaderboard this decorates), #__NUM_d15-claim-sheet-photo__ (the `source`/🖼️ badge this chip set surfaces).

## Recommended agent

claude-sonnet-5 @ medium — small, additive, presentation-only ticket with one new read; low risk since it is explicitly barred from touching ranking logic.
