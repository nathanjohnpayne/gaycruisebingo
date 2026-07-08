---
spec_id: w2-feed-moments
status: accepted
---

# w2-feed-moments — Feed = Proofs + Moments (first BINGO / Blackout / First to BINGO; bare Marks post nothing)

The Feed is the live, public stream the group watches together (ADR 0002) — the honor-system source of truth in place of server verification. Proofs already flow into it (`specs/w2-proof-capture.md`); this ticket adds Moments and merges the two into one newest-first stream. A **Moment** broadcasts a big social beat — a BINGO, a Blackout, or the First to BINGO — and, unlike a Proof, carries **no attached evidence**: it marks *that* something happened, not what it looked like. A **bare Mark posts nothing to the Feed** (ADR 0002): only a Proof or a Moment appears there; a plain honor Mark self-publishes to its per-Prompt Tally (`specs/w2-tally.md`) and nowhere on the Feed.

This ticket landed after #16/#18, so two contracts already ship and are **read, not modified** here: the `MomentDoc` type (`src/types.ts` — `kind: 'bingo' | 'blackout' | 'first_bingo'`, plus `uid`, `displayName`, `photoURL`, `createdAt`; no media, no `proofId`) and the `events/{eventId}/moments/{momentId}` rules block (`firestore.rules`). The design lives strictly inside both.

## Data model (merged-main type + rules, #16/#18)

A Moment is a top-level doc under the Event: `events/{EVENT_ID}/moments/{momentId}`. The shape is exactly `MomentDoc` minus its `id` (the `id` is the doc id, surfaced on read by `momentConverter`). The rules block allows:

- **create** if `isOwner(request.resource.data.uid)` (a forged uid is denied — you can only broadcast your own beat), the `kind` is one of the three `MomentKind`s, `displayName` is a non-empty ≤100-char string, and `createdAt` is a number.
- **read** if signed in (public — the Feed everyone watches; no anonymity, ADR 0002).
- **update** only if `isAdmin(eventId)` (a Moment is immutable except admin moderation).
- **delete** if `isAdmin(eventId)` or the owner.

Two facts about that block are **load-bearing to this design and pinned honestly** (they are not changed):

1. **The doc id is caller-chosen** — no rule constrains `momentId`. Combined with **update being admin-only**, a deterministic id makes once-only *structural*: a second write to an already-written id is a doc-exists `update`, which a non-admin cannot do, so it is denied. This is the strongest dedup the rules allow, and it is what the writer relies on.
2. **The create rule has no `hasOnly()`/`keys()` constraint**, so it does **not** reject a Moment that carries extra `mediaURL`/`proofId` fields. The ADR 0002 "a Moment carries no evidence" guarantee is therefore a **writer + type** contract — `src/data/moments.ts` writes exactly the `MomentDoc` fields, and `MomentDoc` has no media/`proofId` field — **not** a rules-layer one. The rules test pins the actual (permissive) rule behaviour so no one mistakes the rule for enforcing it.

## The change

- `src/data/moments.ts` (new) — three broadcast functions, `broadcastBingo` / `broadcastBlackout` / `broadcastFirstBingo`, each writing one `MomentDoc` row via a raw (converter-free) ref in the mark path's offline-queueable, fire-and-forget style (`void setDoc(...).catch(console.error)`, mirroring `setMark`): the write pends durably in the persistent cache when offline (ADR 0006) and never blocks the celebration UI, and an online rejection is logged (never silently swallowed). The payload is `Omit<MomentDoc, 'id'>` — no media, no `proofId`, ever. `displayName` is bounded through the shared `markerDisplayName` helper (imported from `src/data/attribution.ts`, unchanged) to the rules' non-empty ≤100 contract, so a broadcast can never be rejected for a malformed name.
- `src/data/converters.ts` — a `momentConverter` mirroring `proofConverter`/`claimConverter` (pins `id` to `snap.id`). Genuinely required so `paths.ts` can attach a converter to its refs, exactly as the tally/proofs helpers do.
- `src/data/paths.ts` — `momentsCol()` / `momentRef(id)` converter-attached refs under `events/{EVENT_ID}/moments`, mirroring `proofsCol`/`proofRef`.
- `src/hooks/useData.ts` — `useMoments()` subscribes to the moments collection through the SAME `useColSub` latch pattern the proof stream uses (`{ includeMetadataChanges: true }`, `hasServerData` latched on the first server-backed snapshot), newest-first, capped. `mergeFeed(proofs, moments, max)` is a pure function that folds both into one newest-first stream capped at `max`. `useFeed()` composes `useProofFeed` + `useMoments` through `mergeFeed`; `loading` stays true until both halves have delivered so the empty state never flashes. `useTally`/`useLeaderboard`/`useProofFeed` are untouched beyond being composed.
- `src/components/ProofFeed.tsx` — now renders the merged Feed from `useFeed()`. A Proof renders exactly as before (report ⚑, owner-delete 🗑, flagged badge, media by type, scheme-guarded via `safeMediaUrl`). A Moment renders distinctly: a celebratory per-kind line with an icon, **no media and no report/delete** (there is no evidence to dispute). The empty copy now reflects the whole Feed.
- `src/components/Board.tsx` — broadcasts at the EXISTING BINGO/Blackout edge detection (the `wasBingo`/`wasBlackout` refs + celebrate `useEffect`), leaving `setMark`, `identityKnown`, and the #87 Tally UI untouched. It also subscribes to the roster via `useLeaderboard()` — the SAME data the Leaderboard's First-to-BINGO pin reads. The identity + roster are stored in a latest-value ref so the edge effect keeps its `[cells]` deps and fires only on a genuine board transition, never when the resolved name or roster merely re-renders.
- `src/index.css` — a `.moment` card style (festive tint, distinct from `.proof`; the First-to-BINGO card gets the Leaderboard pin's glow).

## Once-only semantics (deterministic ids + the create/update split)

The design picks the **strongest dedup the rules allow** and layers it under the Board edge refs:

- **First BINGO — once per Player.** Broadcast on the TRANSITION into having a bingo (`bingo && !wasBingo.current`), never on every completed line or every render. Doc id `${uid}-bingo`. A re-fire (a lose→regain in one session, a reload with a bingo already standing, or a second tab) either never crosses the edge (the refs) or, if it does, hits the admin-only `update` rule on the existing id and is denied.
- **Blackout — once per Player.** Broadcast on `black && !wasBlackout.current`. Doc id `${uid}-blackout`. On a real 5×5 board the first-line (BINGO) edge always precedes the full-card (Blackout) edge across renders, so a Blackout never suppresses the earlier first-BINGO broadcast.
- **First to BINGO — once per Event, ceremonial and self-reported (ADR 0001).** Doc id is the Event-**singleton** `first_bingo` (it can never collide with a per-Player id: those use a hyphen before the kind and a uid prefix). Board derives it client-side from the known-players roster: it claims First to BINGO only when, as far as this client's view shows, **no other Player has a `firstBingoAt` yet**. The singleton id makes it structurally once-per-Event: the first create wins; a later create becomes an `update` and is denied.

**The race, documented honestly.** First to BINGO is a ceremony, not a verified fact (ADR 0001). Under an offline/latency race two Players may each briefly believe they are first — each optimistically shows their own local `first_bingo` Moment from the persistent cache — but exactly one create reaches the server (whichever syncs first), the other is rolled back to the winner, and both clients converge. At friend-group scale this is acceptable; the Feed's `first_bingo` reflects who broadcast first, which under a bad offline race can differ from the Leaderboard pin's earliest-`firstBingoAt`. The honour is recorded, never adjudicated.

## Claim → test

Basename-aligned to this spec (the checker matches `specs/w2-feed-moments.md` → a `w2-feed-moments.test.*` under `tests/**` or `src/**`); every claim maps to a real assertion.

### Rules — a Player broadcasts their OWN Moment; forgery denied; immutable except admin; extra fields not rejected

Runner: `npm run test:rules` (Firestore emulator). Test: `tests/rules/w2-feed-moments.test.ts`.

- A signed-in Player may create their own Moment (each of the three kinds) at a caller-chosen id; a forged uid (another Player's beat) is denied.
- The shape contract: an invalid `kind`, an empty `displayName`, an over-100-char `displayName`, and a non-numeric `createdAt` are each denied; exactly-100 is allowed.
- The once-only backstop: a second write to an already-written deterministic id is a doc-exists `update` and is denied for a non-admin, while an admin may update (moderate). This is what makes the deterministic id structurally once-only.
- **Honesty pin:** a create carrying extra `mediaURL`/`proofId` fields is **accepted** — the rules do not reject it; the no-evidence guarantee is a writer/type contract (see the unit test), not a rules-layer one.
- Moment reads are public; an owner may delete their own Moment and an admin may delete any; a non-admin peer may not.

### Unit — the broadcast writer + the Feed merge

Runner: `npm test` (Vitest, jsdom). Test: `src/data/w2-feed-moments.test.ts`.

- `broadcastBingo` writes exactly ONE Moment at `${uid}-bingo` with `kind: 'bingo'` and EXACTLY the `MomentDoc` fields — no `mediaURL`, `storagePath`, or `proofId` (ADR 0002).
- `broadcastBlackout` writes one at `${uid}-blackout` (`kind: 'blackout'`); `broadcastFirstBingo` writes one at the Event-singleton `first_bingo` (`kind: 'first_bingo'`).
- The attributed name is bounded to the rules' ≤100 cap.
- Each broadcast is a single offline-queueable `setDoc` — never `addDoc`, never `runTransaction`.
- `mergeFeed` interleaves Proofs + Moments strictly newest-first, keeps the `slice` cap, and returns an empty stream for `([], [])` — a bare Mark (neither a Proof nor a Moment) contributes nothing.

### Component — Board broadcasts on the edge; the merged Feed renders

Runner: `npm test` (Vitest, jsdom). Test: `src/components/w2-feed-moments.test.tsx`.

- Board broadcasts a first BINGO Moment exactly once on the TRANSITION into having a bingo — not on initialisation (a returning Player whose bingo already stood must not re-announce it) and not on a further Mark while the bingo still stands (the edge, not every render).
- A bare Mark that completes no line crosses no edge and broadcasts nothing.
- Board claims First to BINGO only when the roster shows no other Player has bingoed yet; when another Player already has a `firstBingoAt`, the Player's own first BINGO still posts but the ceremonial First-to-BINGO does not.
- A Blackout broadcasts one blackout Moment on the full-card edge without re-announcing the BINGO.
- ProofFeed renders Moments and Proofs merged newest-first (fed an already-merged list; the sort itself is `mergeFeed`'s unit test), each distinctly; a Moment carries no media and no report/delete affordances, a Proof keeps them; an empty Feed shows the empty state.

### Test-mock updates required by the surface change (stated honestly)

Changing ProofFeed to consume `useFeed` and Board to read the roster + broadcast forces three existing suites' mocks to move with the code (no assertion weakened):

- `src/components/w2-tally.test.tsx` — its `useData` mock gains `useLeaderboard` (Board now reads it). The suite's single non-winning tap crosses no bingo edge, so an empty roster suffices.
- `src/components/w2-proof-capture-feed.test.tsx` — ProofFeed now opens two subscriptions (proofs + moments) via `useFeed`; the `onSnapshot` stub routes each by target and delivers an empty moments snapshot alongside the proofs one, and the empty-state copy assertion tracks the new Feed wording. The proof-only assertions are unchanged.
- `src/components/sec-xss-proofsheet.test.tsx` — its `useData` mock exposes `useFeed` (returning the proofs wrapped as Feed entries) instead of `useProofFeed`; the media-sink assertions are unchanged.

The offline suite (`tests/offline/w2-tally.test.ts`) already asserts a bare Mark leaves `moments` empty; it drives `setMark` directly (untouched here), so it continues to hold.

## Acceptance criteria

- Given a Player scores their first BINGO, when it commits, then a BINGO Moment appears newest-first in the Feed with no attached evidence — `src/components/w2-feed-moments.test.tsx` (Board edge broadcast) + `src/data/w2-feed-moments.test.ts` (one write, no media) + `tests/rules/w2-feed-moments.test.ts` (own-create allowed).
- Given a Player only marks a Square (no Proof), when the Feed refreshes, then nothing about that Mark appears in the Feed — `src/components/w2-feed-moments.test.tsx` (bare Mark: no broadcast + empty Feed) + `src/data/w2-feed-moments.test.ts` (`mergeFeed([], []) === []`) + the offline suite's moments-empty assertion.
- Moments broadcast on first BINGO, Blackout, and First to BINGO — each once — `src/data/w2-feed-moments.test.ts` (deterministic/singleton ids + one write each) + `tests/rules/w2-feed-moments.test.ts` (the caller-chosen id + admin-only update backstop) + `src/components/w2-feed-moments.test.tsx` (edge-once, not every render; First-to-BINGO derivation).
- Moments and Proofs merge newest-first into one Feed — `src/data/w2-feed-moments.test.ts` (`mergeFeed` order + cap) + `src/components/w2-feed-moments.test.tsx` (ProofFeed renders both in order, each distinctly).
- A Moment never carries media or a `proofId` — `src/data/w2-feed-moments.test.ts` (payload is exactly the `MomentDoc` fields) + the `MomentDoc` type (no such field) + `tests/rules/w2-feed-moments.test.ts` (pins that the rules do NOT enforce this — the writer/type does).
