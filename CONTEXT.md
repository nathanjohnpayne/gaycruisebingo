# Gay Cruise Bingo — Domain Context

A phone-first, live, social bingo game for one cruise at a time. The card's prompts are things that might happen on the sailing; play is shared, and the "truth" of the game is the live feed the group watches together — not server-side verification.

## Language

### Event & pool

**Event**: One cruise/sailing. The top-level scope that owns everything else — prompts, boards, players, and feed. Many can exist, but only one is active at a time. _Avoid_: Room, game, tenant

**Prompt**: A single thing-that-might-happen that can land on a card (e.g. "Loses passport"). The community-editable pool is seeded from the 33 printed items. _Avoid_: Item, tile, square

**Theme**: One of the eight Atlantis party looks the whole app reskins into (Neon Playground is the default). Cosmetic only.

### Days & pools

**Day**: One calendar day of the sailing, owning a date, port, Theme, and unlock state. The Event owns an ordered list of ten Days. _Avoid_: Round, stage

**Day Card**: A Player's Board for one Day — same 5×5 contract as today, now one per Player per Day. "Board" continues to mean this object; "Day Card" is the player-facing name.

**Tutorial Day**: The embark and disembark Days. Dealt from their own curated pools, framed as onboarding/farewell rather than competition.

**Pool**: Which item set a Prompt belongs to — `main`, `embark`, or `farewell`. Only `main` accepts player submissions.

**Pending**: A submitted Prompt awaiting admin approval. Invisible to players; never dealt.

**Day Snapshot**: The frozen list of approved Prompts captured at a Day's unlock moment. All of that Day's deals draw from the snapshot, so everyone's card reflects the same pool regardless of when they first open it.

**Tally Card**: The Feed's live, aggregated entry for one Prompt on one Day — bumped toward the top as new Players mark it. A rendering of the Tally, not a new record. _Avoid_: Wave, streak

### The card & play

**Board**: One Player's frozen 5×5 card for the Event — 24 sampled prompts plus the free centre. Private to its owner; dealt once and never reshuffled. _Avoid_: Card (fine informally), grid

**Square**: One of the 25 positions on a Board. Carries a Prompt's text and whether it's been marked. _Avoid_: Cell, tile, space

**Free Space**: The always-marked centre square, fixed text "Complain about Circuit Music". Counts toward lines but is never a Player-marked square.

**Mark**: The act (and resulting state) of a Player tapping a Square to say the thing happened. Marks are self-recorded on the Player's own Board — nobody else's approval is required by default.

**BINGO**: Five marked squares in any one line — row, column, or diagonal. The centre counts. A Player can score several.

**Blackout**: All 24 non-free squares marked. The maximal win.

### People

**User**: A person's global identity and profile — one per Google account, shared across every Event. Holds display name and photo. _Avoid_: Account, player

**Player**: A User's membership and stats *within one Event*: bingo count, squares marked, first-bingo time. The same User is a distinct Player in each Event. _Avoid_: User, member, participant

**Admin**: A User granted moderation and settings rights for an Event. The only privileged role.

### Trust, proof & claims

**Feed**: The live, public stream everyone sees — Proofs plus Moments, newest first. The social source of truth, where the group witnesses what happened in place of server verification.

**Moment**: A broadcast announcement of a big social beat — a BINGO, a Blackout, or the First to BINGO — posted to the Feed for everyone. Unlike a Proof it carries no attached evidence; it marks *that* something happened, not what it looked like. _Avoid_: Milestone, highlight, announcement

**Tally**: The public, attributed record of which Players have marked a given Prompt — shown on the card as a count plus a tap-to-see-who list, so you can see who else "got" it. An aggregate surface, separate from the Feed. _Avoid_: Count, score

**Share Card**: A retina image a Player generates on their own device — for a BINGO or the Leaderboard — to drop into the group chat. Out-of-app, unlike a Moment (which lives in the in-app Feed) or a Proof. _Avoid_: OG image, unfurl

**Leaderboard**: The for-fun ranking of Players (bingos, then squares marked, then earliest first-bingo), with a pinned First to BINGO. A social artefact, not a tamper-proof record. _Avoid_: Ranks (fine as a UI label)

**First to BINGO**: The pinned honour of the earliest first-bingo in the Event. Ceremonial; its time is self-reported like any other stat.

**Claim Mode**: The Event-wide setting for how much friction a Mark carries — a friction/vibe knob, *not* a trust level. One of Honor, Proof-to-mark, or Admin-confirmed. _Avoid_: Trust mode, verification level

**Honor**: The default Claim Mode — mark freely, proof optional.

**Proof-to-mark**: A Claim Mode where a Mark requires an attached Proof. Friction that enriches the Feed; it does not make the Mark more trustworthy. _Avoid_: Proof required

**Admin-confirmed**: A Claim Mode where a Mark starts pending and doesn't count until an Admin resolves its Claim. A dispute/ceremony tool, not anti-cheat. _Avoid_: Verified

**Proof**: A playful photo, audio clip, or text callout a Player attaches when marking a Square; it posts to the Feed. Flavour, never enforcement.

**Doubt**: One Player publicly asking another to back up a specific marked Prompt — "pics or it didn't happen." The count of doubts shows on the marked square and the Tally entry; attaching a Proof satisfies them. Social pressure, never a gate — it's how the group applies the "the group is the verification" principle in-app. _Avoid_: Callout, demand, challenge

**Claim**: In Admin-confirmed mode, the pending record raised when a Player marks a Square, for an Admin to confirm or reject.
