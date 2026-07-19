---
spec_id: feed-hearts
status: accepted
---

# Feed hearts: Instagram-style likes on Proofs and Moments (`feed-hearts`)

A Player hearts posts in the Feed—many posts, each post only once—with a Lucide heart that pops like Instagram's and a count that ticks as it moves. Guarded by `src/components/feed-hearts.test.tsx` (derivation, HeartButton contract, CSS pins) and `tests/rules/feed-hearts.test.ts` (the write gate).

## Glossary

**Heart** — one Player's like on a Feed post. A reaction, never evidence and never score: hearts touch no stats, no leaderboard, no win logic (ADR 0001 untouched). *Avoid:* like (the UI verb is heart), favorite, reaction (reserved—a future multi-emoji system would be a different thing).

**Post** — a Proof or a Moment card in the Feed. Tally Cards are derived aggregates keyed by (Prompt, Day), not documents, and take no hearts.

## Data model

One flat collection, `events/{eventId}/hearts/{heartId}`, mirroring doubts/moments. `HeartDoc` (src/types.ts): `uid`, `targetKind` (`'proof' | 'moment'`), `targetId`, `createdAt`—exactly these four fields; no display name is denormalized (nothing to misattribute, so the write needs no identityKnown gate).

**The doc id IS the once-only guarantee.** `heartId = ${uid}_${targetKind}_${targetId}` (`heartDocId`, src/data/hearts.ts)—the Doubt slot's shape. The rules bind the id to the payload (no squatting another Player's slot), and a duplicate create lands on the doc-exists update path, which does not exist: a Heart has **no update rule at all**. Toggle = create to heart, owner-delete to unheart; re-heart is a fresh create at the same slot. Counts cannot inflate and cross-client races collapse onto one slot.

Create additionally requires: own `uid`, `keys().hasOnly` the four contract fields, a known `targetKind`, the hearted post EXISTING as its declared kind (no phantom targets; create-only—a post deleted later strands its hearts as dead docs no card ever asks about), and `createdAt` in the shared +60s/−24h clock window. Read is signed-in public. Admin delete is the moderation lever.

## Reads and derivation

ONE flat subscription (`useAllHearts`, src/hooks/useData.ts) feeds the whole Feed, mirroring `useAllDoubts`; per-card state is the pure `heartState(hearts, kind, id, viewerUid, bannedUids)` → `{ count, hearted }`. Ban semantics: a banned Player's hearts vanish from everyone else's counts, but their OWN heart stays visible to themselves—the own-content exception, load-bearing here because a banned viewer whose button read unhearted would retap into the doc-exists denial forever.

Writes are fire-and-forget (`toggleHeart`): the latency-compensated echo flips the UI instantly, offline both legs queue durably (ADR 0006), and an online rejection logs and self-corrects when the listener rolls the optimistic doc back. Analytics (`heart_post`, params `targetKind`/`on`) fires only once the write persists—the `demand_proof` posture.

## UI and motion

`HeartButton` (src/components/ProofFeed.tsx) renders on every Proof and Moment card: an outline Lucide heart (30px control, 44px overlay tap target) that fills with the Theme's `--primary` when hearted, count beside it (hidden at zero), `aria-pressed` carrying state and the count labeled once ("N hearts"), never per-digit.

Motion (index.css § "feed hearts", inside the motion-polish vocabulary and covered by its universal reduced-motion kill switch):

- **`heart-pop`**—the like burst: the icon squeezes then slams back with `--ease-pop`, Instagram's bounce. Armed on the TAP (not the echoed doc, so a slow write still pops instantly), released on its own `animationend` by name. Like-only: unhearting is a quiet correction, the same asymmetry as unmarking a Square.
- **`heart-ring`**—a theme-colored ring flashing outward from the button, riding the same `.heart-burst` state.
- **`heart-tick`**—the count slides up on every change. The number span is keyed by value, so ANY movement remounts it and replays the tick: the viewer's own tap and other Players' hearts arriving on the live stream both animate.

## Deliberate non-features

No heart notification, no who-hearted list (the count is ambient warmth, not a roster—unlike a Tally, whose who-list is the point), no hearts on Tally Cards, no server-side counter (counts are client-derived from the live collection, ADR 0001), and no exactly-once analytics (offline drains count late or not at all—accurate-but-delayed beats inflated).

## Test coverage

`src/components/feed-hearts.test.tsx`: `heartDocId` binding, `heartState` counting/keying/ban semantics with the own-content exception, HeartButton's pressed/label/burst/quiet-unheart/keyed-count contract, and the CSS pins (keyframes exist, token-only fill, defined ahead of the kill switch). `tests/rules/feed-hearts.test.ts`: the full write gate against the emulator—bound slot, forged uid, phantom/wrong-kind targets, unknown kind, extra fields, clock window, once-only via doc-exists, no update path, owner/admin delete, re-heart, public read.
