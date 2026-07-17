**Track:** tutorial-content · **Phase:** 1.5 · **Wave:** 3 · **Size:** M · **Cut line:** nice-to-have (post-sailaway)

## Context & scope

Implements `daily-cards-spec.md` § "First-open coach overlay". A once-per-event scrim over the Player's first dealt card that decodes the Board's badge notation — the Tally count, the 👀 Doubt badge, the ＋ add-proof affordance, and the free space — so a first-time Player isn't left guessing what the small icons on a marked Square mean. Deliberately narrower than the Welcome Aboard banner (#__NUM_d15-tutorial-banners__), which carries the game's narrative; this overlay only decodes notation, and the two must not repeat each other's copy.

## Current state

- No overlay/coach-mark concept exists in the app today. `src/components/Board.tsx` renders `TallyBadge` and `DoubtBadge` (`:38-111`) directly on marked Squares with no first-time explainer.
- The existing per-device localStorage persistence pattern this ticket follows: `ThemeContext.tsx` persists an explicit Theme pick under the key `gcb.theme` (`src/theme/ThemeContext.tsx:13`); `InstallPrompt.tsx` persists a permanent dismissal under `gcb.install.dismissedAt` (`src/components/InstallPrompt.tsx:4,93`). This ticket's dismissal key follows that same `gcb.*` convention, scoped per-Event (see Implementation notes) since a Player may play more than one cruise's Event over time.
- #__NUM_d15-day-switcher__ lands the Day-scoped board view (viewed-Day state, the switcher, the locked-preview branch) this overlay mounts over. #__NUM_d15-more-menu__ lands the More menu's "How to play" row, the replay entry point this ticket wires into.
- **Being revised here:** the Card tab gains a one-time scrim mount, gated on a per-Event localStorage flag, layered over whichever Board the Player's first dealt card turns out to be (naturally the embark card for a Day-one joiner; a mid-cruise joiner sees it over whatever they open first).

## Files to create / modify

- `src/components/CoachOverlay.tsx` (new) — the scrim component: legend rows for Tally count / 👀 Doubt badge / ＋ add-proof / free space, and the "Got it—deal me in." CTA.
- `src/components/Board.tsx` (modify) — mount `CoachOverlay` once per Event, over the first dealt card the Player sees; dismiss on CTA tap.
- `src/components/More.tsx` (modify, coordinate with #__NUM_d15-more-menu__) — the "How to play" row's replay affordance re-opens `CoachOverlay` on demand, bypassing the per-Event dismissal check.

## Implementation notes

- Legend content, per spec: the Tally count (tap to see who), the 👀 Doubt badge (a Proof clears it, never unmarks — restate the "never a gate" invariant in the copy), the ＋ add-proof affordance, and the free space. CTA: **"Got it—deal me in."**
- Dismissal is stored **per-event** (localStorage, keyed like the theme choice — i.e. a `gcb.coachOverlay.<eventId>.dismissedAt`-shaped key, not a single global flag, so a Player joining a future cruise's Event sees the overlay again even though they dismissed a prior Event's).
- Replayable from More → How to play (#__NUM_d15-more-menu__): the replay path must NOT read or write the per-Event dismissal flag on open (replaying doesn't count as "already seen it" bookkeeping), but a manual replay dismissal should still be allowed to update the stored timestamp if that's the simplest single dismiss handler — either is acceptable as long as the once-per-event auto-show behavior itself is unaffected by replays.
- The overlay renders over "the Player's first dealt card" — naturally the embark card for a Day-one joiner (Day 0 unlocks at event-open, so it's usually the first thing dealt), but a mid-cruise joiner may see it over whatever main-day card they open first. Do not hardcode "always the embark card"; gate on "first Board this Player has ever seen render with cells," not on `DayDef.tutorial`.
- Complements, never repeats, the Welcome Aboard banner (#__NUM_d15-tutorial-banners__): that banner explains the game's rules and framing (mark, BINGO, the feed is the proof); this overlay explains only the notation on a marked Square. If both would show on the same first-open (embark Day for a Day-one joiner), they must be visually distinguishable and non-overlapping — verify against that ticket's banner once both exist.

## Tests to add

- `src/components/CoachOverlay.test.tsx` (RTL jsdom) — renders the four legend rows (Tally / Doubt badge / add-proof / free space) and the CTA; tapping the CTA dismisses the overlay and writes the per-Event localStorage key.
- `src/components/CoachOverlay.test.tsx` (RTL jsdom, once-per-event test) — a second mount with the same Event's dismissal key already set does not render the overlay; a mount under a DIFFERENT Event id (dismissal key absent for that id) does render it, even though a prior Event's key is set.
- `src/components/More.test.tsx` (RTL jsdom, coordinate with #__NUM_d15-more-menu__) — the "How to play" row reopens the overlay regardless of the stored per-Event dismissal state.

## Acceptance criteria

- **Given** a Player's first dealt card for an Event renders **When** the Card tab mounts **Then** the coach overlay scrims it with the four-row legend and the CTA.
- **Given** the Player taps "Got it—deal me in." **When** the overlay dismisses **Then** it never auto-shows again for that Event (persisted via localStorage), but does not affect a different Event's dismissal state.
- **Given** a Player opens More → How to play **When** they tap it **Then** the overlay replays regardless of prior dismissal.
- [ ] Overlay shows at most once per Event automatically.
- [ ] Overlay copy names only the badge legend, not the game's rules (no duplication with the Welcome Aboard banner).
- [ ] Replay from More → How to play works after dismissal.

## Definition of Done

- Spec file `specs/d15-coach-overlay.md` created WITH a matching test (spec↔test alignment CI).
- `npm run typecheck` + `npm test` + `npm run build` green; md-prose-wrap clean.
- PR body `Closes #<this issue>`; authored `nathanjohnpayne`, driven through REVIEW_POLICY.md to merge.
- Board discipline per `docs/agents/ticket-workflow.md`.

## Dependencies

Depends on #__NUM_d15-day-switcher__ (the Day-scoped board view this overlay mounts over) and #__NUM_d15-more-menu__ (the "How to play" replay entry point). Relates to #__NUM_d15-tutorial-banners__ (complementary, non-overlapping copy — verify once both exist).

## Recommended agent

claude-sonnet-5@high — small surface area but the once-per-event dismissal semantics and the "first dealt card, not necessarily the embark card" gating need careful state-management judgment to avoid a stale or over-eager scrim.
