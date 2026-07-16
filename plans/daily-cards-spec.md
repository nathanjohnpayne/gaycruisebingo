# Spec: Daily Cards—one themed board per cruise day

Status: draft for review. No code changes; wireframes in `daily-cards-wireframes.html`.

## Summary

Today the app deals one Board per Player for the whole Event. This feature makes the card daily: each cruise day has a theme, and each day unlocks a fresh themed Board at 8:00 a.m. ship time. Players play through all ten cards over the cruise; locked days are visible (themed chrome, lock icon, blank squares except the free space) to tease what's coming. The two non-party days become tutorial days: **Welcome Aboard** (embark, teaches the game with easy on-ship items) and **So Long, Farewell** (disembark, a reflective goodbye card). New pool submissions now require admin approval before they can appear on a card.

Decisions already made with Nathan: one cruise-long leaderboard plus per-day First to BINGO honors; all eight themed days deal from the shared main pool (theme is visual only); the embark card is live pre-cruise; embark/farewell pools are curated (admin-editable, no player submissions).

## Glossary additions (CONTEXT.md language)

- **Day**: One calendar day of the sailing, owning a date, port, Theme, and unlock state. The Event owns an ordered list of ten Days. *Avoid:* round, stage.
- **Day Card**: A Player's Board for one Day—same 5×5 contract as today, now one per Player per Day. "Board" continues to mean this object; "Day Card" is the player-facing name.
- **Tutorial Day**: The embark and disembark Days. Dealt from their own curated pools, framed as onboarding/farewell rather than competition.
- **Pool**: Which item set a Prompt belongs to—`main`, `embark`, or `farewell`. Only `main` accepts player submissions.
- **Pending**: A submitted Prompt awaiting admin approval. Invisible to players; never dealt.
- **Day Snapshot**: The frozen list of approved Prompts captured at a Day's unlock moment. All of that Day's deals draw from the snapshot, so everyone's card reflects the same pool regardless of when they first open it.
- **Tally Card**: The Feed's live, aggregated entry for one Prompt on one Day—"Nathan Payne, Sterling Tadlock +12 got 'Balcony or porthole photo'"—bumped toward the top as new Players mark it. A rendering of the Tally, not a new record. *Avoid:* wave, streak.

## Itinerary and schedule

Sailing: July 15–24, 2026, Trieste → Barcelona (Virgin Voyages Scarlet Lady). Every port is CEST, so a single event timezone (`Europe/Rome`) covers the whole cruise—no ship-clock drift handling needed.

| Day | Date       | Port                 | Theme                              |
|-----|------------|----------------------|------------------------------------|
| 1   | Wed Jul 15 | 🇮🇹 Trieste          | 🛳️ Welcome Aboard (tutorial)       |
| 2   | Thu Jul 16 | 🇭🇷 Split            | 🏋️ Get Sporty                      |
| 3   | Fri Jul 17 | 🇲🇹 Valletta         | ✈️ Duty Free                       |
| 4   | Sat Jul 18 | 🇮🇹 Palermo          | 🏛️ Glamiators                      |
| 5   | Sun Jul 19 | 🇮🇹 Sorrento         | 🌈 Neon Playground                 |
| 6   | Mon Jul 20 | 🇮🇹 Rome (Civitavecchia) | 🤍 Summer White                |
| 7   | Tue Jul 21 | 🇫🇷 Nice             | 🪖 Dog Tag T-Dance                 |
| 8   | Wed Jul 22 | 🇫🇷 Marseille        | 🪩 Revival: Classic Disco T-Dance  |
| 9   | Thu Jul 23 | 🌊 Sea Day           | 💖 Seriously Pink T-Dance          |
| 10  | Fri Jul 24 | 🇪🇸 Barcelona        | 👋 So Long, Farewell (tutorial)    |

This mapping seeds the event. The schedule stays **admin-editable** in the Admin console anyway (party order can shift onboard, and future cruises need their own mapping); changing a locked-future Day's theme is safe, changing an already-unlocked Day is disallowed.

## Theme reference

The existing `ThemeMeta` (id, label, emoji—the theme-switcher button's data) is reused for day chips and board chrome, extended with a `description` field: the party's dress-code blurb, shown on the locked-day preview (the tease is the dress code, not just the name) and available to the theme switcher for richness.

| ThemeId | Party | Description (player-facing) |
|---|---|---|
| `get-sporty` | 🏋️ Get Sporty | Locker-room fantasy, varsity realness, cheer-captain glam—sporty looks that leave very little to the imagination. |
| `duty-free` | ✈️ Duty Free | No borders, no limits, no VAT. National colors, flags, or whatever you find in Duty Free. |
| `glamiators` | 🏛️ Glamiators | Roman toga-chic meets runway excess. Ancient fantasy, body armor, and spectator/judge looks welcome. |
| `neon-playground` | 🌈 Neon Playground | Fast, flashy, bright, and silly. Neon, sparkles, and lights for a laser-lit night in the Red Room. |
| `summer-white` | 🤍 Summer White | Atlantis's pinnacle party. Dress up or down in white for a sexy, creative, irreverent night under the stars. |
| `dog-tag` | 🪖 Dog Tag T-Dance | The longest-running signature party, inspired by men in small uniforms. Souvenir dog tags provided. |
| `revival-disco` | 🪩 Revival: Classic Disco | A '70s disco afternoon—artificial fabrics, facial hair, oversized shoes, obnoxious accessories. |
| `seriously-pink` | 💖 Seriously Pink T-Dance | A hot afternoon of pink silliness, Barbie energy, and frivolous dolled-up fun. |
| `welcome-aboard` *(new)* | 🛳️ Welcome Aboard | You made it. Learn the game, find the soft-serve, wave goodbye to land. |
| `so-long-farewell` *(new)* | 👋 So Long, Farewell | Last one. Mark your goodbyes—then go book next year. |

### Proposed palettes for the two new themes

Same token contract as `themes.css` (every new ThemeId is automatically pulled into the `w1-themes` and badge-contrast suites, so these must clear the 4.5:1 floors the existing eight do):

```css
[data-theme='welcome-aboard'] {
  /* nautical: deep-sea navy, ocean cyan, brass */
  --bg: #051019; --panel: #0a1a28; --ink: #eaf6ff; --dim: #9fbcd0;
  --primary: #33c6ff; --secondary: #ffbe5c; --accent: #ffd23f;
  --cell: #0a1a28; --border: rgba(51,198,255,.35); --shadow: rgba(51,198,255,.4);
  --on-gradient: #000;
}
[data-theme='so-long-farewell'] {
  /* dusk sailaway: deep plum, sunset coral, peach */
  --bg: #140b12; --panel: #1e1019; --ink: #fff0ea; --dim: #d0a8ab;
  --primary: #ff8b6a; --secondary: #feb47b; --accent: #ffd23f;
  --cell: #1e1019; --border: rgba(255,139,106,.35); --shadow: rgba(255,139,106,.4);
  --on-gradient: #000;
}
```

## Data model

```ts
// EventDoc additions
interface EventDoc {
  // ...existing fields...
  timezone: string; // 'Europe/Rome'
  days: DayDef[];   // ordered, length 10
}

interface DayDef {
  index: number;        // 0..9
  date: string;         // ISO date, e.g. '2026-07-16'
  port: string;         // 'Split'
  portEmoji: string;    // '🇭🇷'
  theme: ThemeId;       // drives card + chrome styling
  pool: 'main' | 'embark' | 'farewell';
  tutorial: boolean;    // true for days 1 and 10
  unlockAt: number;     // ms epoch—08:00 event-tz on `date`; embark day = event open
  freeText?: string;    // per-day free-space override (see below)
  snapshotItemIds?: string[]; // Day Snapshot, stamped at unlockAt by the scheduler
}

// ThemeId additions
type ThemeId = /* existing 8 */ | 'welcome-aboard' | 'so-long-farewell';

// EventDoc.settings additions (Proof & Claims admin panel)
// settings: {
//   ...existing reportHideThreshold, spicyRatio...
//   photoProofSource?: 'camera_or_library' | 'camera_only'; // default camera_or_library (#190)
//   stripPhotoExif?: boolean; // default true—geotags never leave the phone
//   visionGate?: boolean;     // default true—existing moderation function, now toggleable
// }

// ProofDoc addition
// source?: 'camera' | 'library'; // stamps the 🖼️ Feed badge on library picks

// ItemDoc changes
interface ItemDoc {
  // ...existing fields...
  pool: 'main' | 'embark' | 'farewell'; // absent on legacy docs → 'main' via converter
  status: 'active' | 'hidden' | 'pending' | 'rejected'; // new: pending, rejected
  approvedBy?: string; // uid of approving admin
  approvedAt?: number;
}

// BoardDoc changes—one per Player per Day
// Path: events/{eventId}/days/{dayIndex}/boards/{uid}
// (today: events/{eventId}/boards/{uid})
interface BoardDoc {
  uid: string;
  dayIndex: number;   // new
  seed: number;
  createdAt: number;
  cells: Cell[];      // unchanged, length 25
}

// PlayerDoc—stats become aggregates across all Day Cards
interface PlayerDoc {
  // ...existing fields (bingoCount, squaresMarked, firstBingoAt = cruise-wide totals)...
  dayStats?: Record<number, { bingoCount: number; squaresMarked: number; firstBingoAt: number | null }>;
}

// Per-day honor, pinned on that day's view + honors strip
// events/{eventId}/days/{dayIndex}/meta: { firstBingo: { uid, displayName, at } }
```

Tallies, Doubts, Proofs, and Moments gain a `dayIndex` field so the feed can say "BINGO—Day 4 · Glamiators" and Tally counts stay per-day (marking "Lost passport" on Tuesday's card is a different tally entry than Thursday's).

## Unlock mechanics

- **Rule**: a Day unlocks at 08:00 event-timezone on its date. One exception only: the embark Day is unlocked from the moment the Event opens (pre-cruise tutorial). The farewell Day follows the standard 08:00 rule on disembark morning (decided 2026-07-11—one rule, no special case).
- **Snapshot at unlock**: a scheduled Cloud Function (one daily run at 08:00 Europe/Rome, tolerant of retries/idempotent) writes `snapshotItemIds` for the unlocking Day: all `status: 'active'` items in that Day's pool at that moment. This is how items approved mid-cruise "get in"—they enter every not-yet-unlocked Day, never an already-dealt one.
- **Lazy dealing**: a Player's Day Card is dealt on first open at/after `unlockAt`, from the snapshot, using the existing `dealBoard` stratification (10 spicy / 14 tame for main days; tutorial pools are all tame so they deal unstratified). No per-player fan-out at 8:00; the function only stamps the snapshot.
- **Client fallback**: if the client's clock says a Day is unlocked but the snapshot isn't stamped yet (function lag), the client waits and shows the locked state with a "waking up" message rather than dealing from an unfrozen pool. Deals never bypass the snapshot.
- **No repeats across the cruise**: each Player's deal excludes prompts already on their earlier Day Cards until the pool is exhausted (80 main items ÷ 24/day ≈ 3⅓ days), then the exclusion resets. Spicy/tame stratification still applies within what remains; if a stratum runs dry the deal backfills from the other, same as today's defensive behavior.
- **Joining mid-cruise**: every Day with `unlockAt <= now` is open; the Player can deal and play all of them immediately. Locked future Days behave the same for everyone.
- **Past Days stay open**: cards remain markable for the whole cruise once unlocked. No end-of-day locking.

### Reshuffle (added 2026-07-14; simplified same day)

A player may reshuffle a Day Card—a fresh deal from the same Day snapshot—under two constraints that eliminate all cascade complexity: the card must be **pristine** (zero player-marked squares; the free center doesn't count) and the allowance is **3 for the whole cruise** (`PlayerDoc.reshufflesUsed`, increment bound in rules to the board write, ≤ 3). A pristine card has produced nothing, so nothing is retracted anywhere—no tally, Feed, doubt, stat, or Moment surgery. Marking a square locks the card in; a player who unmarks everything returns it to pristine and may reshuffle, performing the "cascade" themselves through the existing unmark path, in the open. Confirm sheet gates the spend (the counter never refunds); online-only; discarded prompts return to the eligible pool. A one-time launch-day intro overlay announces the feature. Full ticket: `plans/reshuffle-ticket.md`; mockups: wireframes `#frame-reshuffle` and `#frame-launch-intro`.

## Free space per day

The center square keeps "Complain about circuit music" on the eight party Days. Tutorial overrides via `freeText`:

- Welcome Aboard: **"You made it aboard"**
- So Long, Farewell: **"We had the best damn time"**

## Item pools and the approval flow

- The three pools live in the same `items` collection, separated by the `pool` field. Main-pool submissions continue through the existing ItemPool UI but now write `status: 'pending'`.
- **Pending items**: invisible everywhere except the Admin queue and (as "pending review") to their submitter. Never dealt, never in tallies.
- **Admin queue** (new Admin console tab): list of pending items with submitter attribution, spicy toggle, approve / reject actions. Approve → `active` (+ `approvedBy/At`); reject → `rejected` (kept for audit, hidden from all non-admins). Bulk approve for taste.
- **Grandfathering**: every existing `active` item stays `active`. The approval gate applies only to submissions after this ships.
- **Curated pools**: embark and farewell items are seeded from the lists below with `pool` set accordingly. Admins can add/edit/hide them through the Admin console; the player submission form only ever writes to `main`.

## Scoring and social surfaces

- **Leaderboard**: one cruise-long ranking, summing bingos and squares across all Day Cards; tiebreak by earliest first bingo, as today.
- **Daily honors**: each Day pins its own First to BINGO (stored on the day meta doc, shown on that Day's board view and as an honors strip on the Leaderboard).
- **Cruise-wide First to BINGO**: anchored to main-game Days only (2–9); decided 2026-07-11. Rationale: the embark card is live pre-cruise and trivially easy by design, so it would otherwise decide the headline honor before anyone boards. The tutorial Days still get their own daily honors.
- **Tutorial days**: the embark card counts toward squares-marked and bingo totals (pre-freeze real play, just easy); the farewell card is **ceremonial**—it unlocks at the freeze, so its marks never move the standings. Blackout remains per-card; a per-card blackout posts a Moment naming the day.
- **The finale—two-beat finish (decided 2026-07-11)**: at **20:00 on Day 9** the scheduler posts a **last-call Moment** with going-into-the-final-night standings ("Jess leads by 2 bingos—standings freeze at 8 a.m."), stoking the last night rather than ending it and giving admins something to read aloud at the final show. At **08:00 on Day 10** the standings **freeze** (event `frozenAt`), the farewell Day unlocks, and the farewell view opens with the **podium**—cruise champion, cruise-wide First to BINGO, and the ten daily honors—also posted as a final Moment.
- **Moments/Feed**: moment cards and proofs display the day chip ("Day 3 · 🏛️ Glamiators") so the feed reads as a cruise diary.

## UI

Wireframes for every state below are in `daily-cards-wireframes.html`.

### Header

Two stacked lines next to the "Gay Cruise Bingo" title, always showing **today's** port and theme (not the viewed Day's—the header is a "where are we" instrument; the board chrome communicates the viewed Day):

```
┌──────────────────────────────────────────┐
│  GAY CRUISE BINGO        🇭🇷 Split        │
│                          🏋️ Get Sporty   │
└──────────────────────────────────────────┘
```

Pre-cruise the lines read "Sails Jul 15" / "🛳️ Welcome Aboard". Post-cruise: "Barcelona" / "👋 Until next year".

The top bar simplifies to exactly this—the avatar (today's profile-edit affordance) and the sign-out button relocate to the More menu, so the brand and the day's identity own the header. Identity stays glanceable because the More tab wears the player's avatar as its icon.

### Day switcher

A horizontally scrolling strip of ten day chips under the header, replacing nothing (Board tab keeps its position). Each chip: weekday + port emoji + theme emoji. States: past (✓, tappable), today (filled, default-selected), locked future (🔒, tappable → locked preview). Selecting a chip swaps the board area and retints the whole view to that Day's theme (the existing `data-theme` mechanism; the user's own theme choice still governs the rest of the app outside the board view—board chrome follows the viewed Day).

### Square tap—the Claim sheet

The existing #181 flow is kept intact: tapping an unmarked Square opens the Proof sheet on every claim, 🎖️ Cross My Heart is the one-tap honor path (disabled but visible in stricter modes), and ＋ on an already-marked Square opens the same sheet without the pledge row. Redesign additions:

- **Photo body per issue #190**: two affordances replace the single `capture="environment"` input—**📷 Take photo** (keeps `capture`, so live camera stays one tap) and **🖼️ Library** (`accept="image/*"` with no `capture`, the ProfileEditor pattern). On the integrity question the issue raises, the decided posture (2026-07-11) is transparency over restriction, consistent with ADR 0001 (proof is flavor, never enforcement): allow library in every claim mode, stamp the proof's `source`, and badge library picks 🖼️ on the Feed. Events that want live-only ceremony flip the new admin setting below rather than tying the rule to claim mode.
- **Social heat line** under the title—"🔥 Marked by 4 others so far"—reusing the Prompt's Tally count. Costs nothing (the Tally doc is already subscribed) and makes the sheet a nudge, not a chore.
- **Day context**: the sheet and the resulting Feed proof carry `dayIndex`, so proofs read "Day 2 · Get Sporty" in the Feed.

### Asking for proof—Doubts (existing flow, surfaced in the wireframes)

No mechanics change. The entry point is the Tally: tap a marked square's count to open the who-list sheet; every other player's row carries the "pics or it didn't happen" affordance, which raises a Doubt against their mark of that prompt (deterministic one-slot-per-pair id, so no same-person pile-ons). The doubted player's square grows the 👀 badge; attaching a proof satisfies the doubt and flips their who-list row to ✓ Answered with the proof thumbnail inline. Doubts never block, unmark, or touch the leaderboard. Feed proof cards show doubt-clearing credit ("👀 cleared 2 doubts") plus the live/library source badge and the day chip. Optional enhancement, cheap and shown in the Ranks wireframe: each leaderboard row carries that player's latest-proof media chips (📷 🎙 ✍️ 🖼️), tap-through to the proof in the Feed—gives the ranking a pulse without changing what it measures.

### Tally Cards—bare marks reach the Feed

Today a Mark with no Proof broadcasts nothing, so most play is invisible to the Feed. A Tally Card fixes that with zero player effort: the Feed renders one live card per (Prompt, Day) once anyone marks it, and re-sorts it toward the top as new Players get it.

- **Data**: no new record. `TallyDoc` gains `lastMarkedAt` (and the `dayIndex` it was already gaining); the Feed becomes a merged stream of Proofs, Moments, and Tally Cards ordered by their activity time. The card's names/count/avatars are the live tally—unmarking updates it, and a tally that empties drops out.
- **Copy**: first two display names + "+N" ("Nathan Payne, Sterling Tadlock +12 got 'Balcony or porthole photo'"), avatar stack of the first three, day chip, relative bump time.
- **Bump debounce**: a card moves to the top at most once per ~10 minutes—the count updates live regardless—so a hot square during a party hour can't churn the stream and bury photo proofs. Visual weight is deliberately lighter than a proof card (one-line, accent left border, no media).
- **Tap** opens the who-list sheet—the same single doorway to seeing who, and to Doubts.
- **Button**: ＋ Proof when the viewer has marked that Prompt (jumps into the proof-add sheet); **🙋 Got it too** when the Prompt sits unmarked on one of the viewer's unlocked Day Cards (opens the claim sheet for it—claiming straight from the Feed is the point). Boards are per-player samples, so the button renders only when the Prompt is actually on one of your cards; otherwise the card is informational.

### First-open coach overlay

Once per event, over the Player's first dealt card (naturally the embark card for day-one joiners; a mid-cruise joiner sees it on whatever they open first): a scrim with a badge legend—the Tally count (tap to see who), the 👀 Doubt badge (proof clears it, never unmarks), the ＋ add-proof affordance, and the free space. CTA: "Got it—deal me in." Dismissal is stored per-event (localStorage, keyed like the theme choice); replayable from More → How to play. The Welcome Aboard banner carries the game's narrative; this overlay only decodes the notation—they complement rather than repeat.

### Locked Day preview

Full themed chrome for that Day (name, port, palette) over a 5×5 grid of blank squares; only the free space is populated. A centered lock badge with "Unlocks 8:00 a.m. · Wed Jul 22". No countdown timer needed—the date is enough. The theme's dress-code description renders under the day name, so the locked view doubles as the party tease ("Dog Tag T-Dance—men in small uniforms; souvenir dog tags provided"). Tapping squares does nothing; a caption sells it: "24 fresh squares land at 8. Come back after coffee."

### Embark (tutorial) view

The Welcome Aboard card plus a dismissible "How this works" banner above the grid, three beats:

1. **Mark what happens.** Tap a square when you see it, do it, or survive it.
2. **Five in a row is BINGO.** The center is free. Blackout the card if you're ambitious.
3. **The feed is the proof.** Attach a pic, doubt a friend, watch the Moments roll in.

Caption under the banner: "This one's a warm-up—easy squares, all on the ship. The real chaos starts tomorrow at 8." Tutorial days show a "Warm-up" tag on the day chip and board header in place of daily-honor competitiveness.

### Farewell view

So Long, Farewell card, opening with the **podium banner**—cruise champion, cruise-wide First to BINGO, daily-honors strip—above the goodbye banner: "Last one. Mark your goodbyes—then go book next year." Standings are frozen by then, so the card is pure ceremony. After the cruise ends the app pins this Day, podium included, as the default view.

### More menu (⋯ tab)

The bottom bar becomes **Card · Feed · Ranks · More**; Prompts and Admin leave it and mount inside More. (`tabs.ts` is the frozen mount-point contract—this spec is its deliberate revision point.) The More tab's icon is the player's avatar. Menu order, top to bottom:

1. **Profile card**—avatar, name, @handle; tap opens the existing ProfileEditor sheet. Replaces the top-bar avatar.
2. **Theme**—the ThemeSwitcher relocates here, gaining a new default: **Auto—match the day** (board chrome already follows the viewed Day; this makes the whole app follow today), with the existing manual pick as the override. Persistence semantics unchanged (explicit pick saved; auto never auto-saved).
3. **Text size**—Small / Medium / Large segmented control, persisted per device like the theme choice (`gcb.textSize`). Scales the square's base type (S ≈90%, M 100%, L ≈115%) and body text, but the cell's auto-fit guard always has the last word: a long prompt steps its font down until it fits inside its square (the same measure-and-shrink approach as the print card's `fitText`), so Large is a ceiling, never an overflow. Badges, chips, and chrome don't scale.
4. **Play**: Cruise schedule (a read-only view of the ten Days—ports, parties, unlock times), Suggest a square (ItemPool, with "goes to admin review" caption), How to play (replays the Welcome Aboard walkthrough banner), Install the app (the existing PWA InstallPrompt, shown only when installable).
5. **Support**: Report a bug (existing BugReport flow), 18+ advisory & acceptable use (the ConsentNotice/AcceptableUse content plus the player's attestation date).
6. **Admin** (admins only): one row into the Admin console, badged with the pending-approvals count.
7. **Sign out**—last, visually quiet (dashed/dim). Rare actions don't need permanent chrome.
8. Version footer: build, sailing, dates.

### Install nudge and update banner

Both components exist (`InstallPrompt`, w1-pwa #30; `UpdatePrompt`, #178) and their mechanics are kept; this feature only adjusts presentation and timing.

- **Install nudge**: restyled as a quiet toast above the tab bar, and its trigger moves from app-load to **after the player's first Mark**—someone who just marked a square has decided the app is worth keeping, so the nudge lands as a favor instead of a gate. Copy leads with the cruise-specific benefit: "Full screen, works offline at sea." ✕ dismisses forever (existing `gcb.install.dismissedAt`); the affordance persists in More → Install the app, which is what lets the nudge afford to be shy. Platform split unchanged: Android/Chromium gets the captured one-tap `beforeinstallprompt`; iOS Safari (no such event) gets a Share → Add to Home Screen walkthrough.
- **Update banner**: `UpdatePrompt` behavior unchanged (prompt-type service worker, Reload activates the waiting worker, Not now is session-only, 60-second polling keeps long-lived sea-day tabs current, offline ticks skip). Two refinements: copy ("A fresh build just docked—your marks are safe") because "reload" makes people fear losing state, and the banner defers while a claim sheet is open so it never interrupts a proof mid-capture.
- **Toast stacking**: both toasts anchor above the tab bar and reserve bottom clearance via the existing body-class mechanism, so the board never jumps. Stack rule when they coincide: newest on top, urgent (update) outranks invitational (install), never more than two visible—a third-comer waits for a slot.

Wireframe baseline: iPhone 15 Pro—393×852 pt CSS canvas (19.5:9), Safari. Installed frames render standalone; only the install-nudge frame shows Safari chrome, since that's the one moment players are in the browser.

### Iconography—Lucide

The rule: **Lucide for chrome and controls, emoji for camp.** Navigation, buttons, and system affordances use Lucide (via `lucide-react`); theme emojis, party names, Moments, toast lead-ins, and Feed source badges stay emoji—that's the app's personality, and `ThemeMeta.emoji` already owns it. `Nav.tsx`'s sign-out button is already the Lucide `log-out` glyph hand-inlined, so this formalizes an existing habit.

The mapping (these names are the `data-lucide` attributes in the wireframes):

| Surface | Icon |
|---|---|
| Tab bar | Card `grid-3x3` · Feed `radio` · Ranks `trophy` · More = player avatar, fallback `ellipsis` when signed out |
| More menu | theme `palette` · text size `a-large-small` · schedule `calendar-days` · suggest `lightbulb` · how to play `graduation-cap` · install `download` · bug `bug` · 18+ `shield-alert` · admin `wrench` · sign out `log-out` · row chevrons `chevron-right` |
| Claim sheet | segments `camera` / `mic` / `pen-line` · Take photo `camera` · Library `images` · dismiss `x` |
| Board & feed | locked day `lock` · audio play `play` · doubts stay the count badge (with `eye` available if a glyph is wanted) |
| Device/browser chrome (wireframes only) | `signal` `battery-full` `chevron-left` `chevron-right` `share` `copy` |

To answer the drift: the More tab's move from ⋯ to the avatar is deliberate (identity stays glanceable after the top bar hands profile to the menu); `ellipsis` is its signed-out fallback, not its default.

### Admin console

New "Approvals" tab: pending queue (described above) plus a Schedule editor—the ten Days as rows with date, port, and a theme dropdown (locked for past/unlocked Days).

New "Proof & Claims" panel, surfacing knobs that mostly already exist in the backend without UI:

- **Claim mode** (existing event setting): Honor / Proof-to-mark / Admin-confirmed segmented control, captioned "a friction knob, not a trust level" per ADR 0001.
- **Photo proof source** (#190, new): *Camera or library* (recommended default; library picks badged 🖼️ on the Feed) or *Camera only* (today's behavior, for live-proof ceremony).
- **Strip location data** (new, default on): client-side canvas re-encode on upload so EXIF/GPS never leaves the phone. Worth having regardless of #190—library photos are far more likely to carry geotags than live captures.
- **AI image screen** (existing `visionGate` function, now toggleable): flagged proofs hide pending review.
- **Auto-hide after reports** (existing `reportHideThreshold`, now editable): stepper.
- **Pending claims** (existing, admin-confirmed mode): link row with count badge.

## Tutorial item lists

### Welcome Aboard (embark pool, 28)

Get your favorite dessert · Find your muster station · Get lost finding your cabin · Ride an elevator the wrong way · Locate the late-night pizza · First soft-serve of the cruise · Toast at the sailaway party · Wave goodbye to land · Hear the ship's horn · Meet someone from another country · Learn a crew member's name · Befriend a bartender · Compliment a stranger's outfit · Ask "where are you from?" three times · Exchange Instagrams with a new friend · Spot matching Speedos · Unpack a truly unhinged outfit · Plan tomorrow's party look · Test the bed (nap counts) · Stateroom mirror selfie · Balcony or porthole photo · Order a frozen drink with zero shame · Sunscreen a stranger's back (or volunteer yours) · Scope out the gym you'll never use · Find the theater · Locate the Dick Deck (reconnaissance only) · Sign up for something you'll never attend · Overhear someone already complaining

### So Long, Farewell (farewell pool, 28)

One last sunrise or sunset photo · Say goodbye to your cruise boyfriend · Exchange numbers with your new best friend · Promise to visit someone in their city · Say "see you next year"—and mean it · Book next year's cruise (or swear you will) · Final soft-serve · Thank your cabin steward by name · Thank the bartender who carried you · One last lap around the ship · Last dance to one more song · Group photo with your chosen family · Cry (or valiantly almost cry) · Find glitter somewhere impossible · Suitcase no longer closes · Wear your softest airport look · Breakfast in sunglasses, one last time · Swap favorite memories of the week · "I'm never drinking again" (sincere) · Post the photo dump · Screenshot the group chat's new name · Set a reunion date · Give away your leftover sunscreen · Realize you never used the gym · Hum the song of the week · Take home a (legal) souvenir · Five-star shoutout for your favorite crew member · Stand at the back of the ship and feel things

## Security rules and functions (shape only)

- `firestore.rules`: boards move under `days/{dayIndex}`; write allowed only when `request.time >= day.unlockAt` and the board doc doesn't exist (deal) or is the owner's (marks). Pending/rejected items readable only by admins + submitter. Day meta (`firstBingo`) written via the same client path that posts first-bingo Moments today, guarded to once.
- Scheduled function `unlockDay`: 08:00 Europe/Rome daily during the sailing window; stamps `snapshotItemIds` and `unlockAt` reconciliation. Idempotent; a manual admin "unlock now" button covers function failure (there's precedent for admin-triggered recovery in PoolRecoveryWatcher). The finale rides the same scheduler: a 20:00 run on Day 9 posts the last-call standings Moment; the Day 10 08:00 run sets `frozenAt` and posts the podium Moment.

## Migration

Pre-cruise ship: archive existing test boards (or map the current board to nothing—players re-deal per day). No live-cruise migration needed if this deploys before July 15. Existing items get `pool: 'main'` via converter default; no data backfill required.

## Reusability—adding a future cruise

Nothing sailing-specific lives in code paths; a new cruise is a new `EventDoc`:

1. Create the event with its own `timezone` and `days[]` (any length—the model doesn't assume 10 days or that tutorials sit at the ends, only that each Day names a date, port, ThemeId, and pool).
2. Seed the main pool (or carry forward a curated export of last cruise's best player additions—worth a follow-up admin tool).
3. Copy or edit the embark/farewell curated pools; the tutorial framing travels with `pool` + `tutorial`, not with hard-coded content.
4. If the season introduces new party themes, that is the one content-code touchpoint: add a token block to `themes.css` and a `ThemeMeta` entry (the contrast test suites pick new themes up automatically). The schedule only references ThemeIds, so existing themes are reusable across cruises for free.
5. Multi-day timezone itineraries (a future Caribbean sailing that changes clocks) are handled by an optional per-Day `unlockAt` override—the field already stores an absolute timestamp, so per-day adjustment needs no model change.

## Resolved decisions (Nathan, 2026-07-11)

1. **Farewell unlock**: 08:00 on Day 10—the standard rule, no Day 9 evening special case.
2. **Cruise-wide First to BINGO excludes tutorial days**: confirmed; tutorial Days keep their per-day honors.
3. **Theme names**: Welcome Aboard / So Long, Farewell—confirmed.
4. **Palettes**: as proposed (nautical navy/cyan/brass; dusk plum/coral/peach), subject only to the contrast suites.
5. **Photo source (#190)**: default `camera_or_library` with the 🖼️ Feed badge; `camera_only` remains an event-level admin override.
6. **Winners announcement**: the two-beat finish—last-call standings Moment at 20:00 Day 9; standings freeze + podium at the 08:00 Day 10 farewell unlock; the farewell card is ceremonial (embark still counts toward totals).

## Out of scope

Theme-flavored main-day items (shared pool decided); push notifications at unlock (worth a follow-up—"Day 4 just dropped"); any change to Claim Modes, Doubts, or Proof mechanics beyond the added `dayIndex`.
