// Shared domain types. These describe Firestore documents and flow through
// the whole app (converters, hooks, components) as one contract.

/**
 * How much friction a Mark carries — a friction/vibe knob, NOT a trust level
 * (ADR 0001). `admin_confirmed` makes a Mark start pending until an Admin
 * resolves its Claim; it is a dispute/ceremony tool, not an integrity guarantee.
 * Events written before the rename are coerced on read by `migrateClaimMode`
 * (`data/converters`) so a pre-rename persisted value resolves to
 * `admin_confirmed`; writes only ever emit a current value.
 */
export type ClaimMode = 'honor' | 'proof_required' | 'admin_confirmed';

export type ThemeId =
  | 'neon-playground'
  | 'get-sporty'
  | 'duty-free'
  | 'glamiators'
  | 'summer-white'
  | 'dog-tag'
  | 'revival-disco'
  | 'seriously-pink'
  // Phase 1.5 tutorial-day themes (daily-cards-spec § "Theme reference"). The
  // two ThemeMeta entries + themes.css token blocks that back these land in
  // #206; reserved in the union here so this contract-ticket's downstream
  // consumers (DayDef.theme, day chrome) can name them without waiting.
  | 'welcome-aboard'
  | 'so-long-farewell';

// One Day of the cruise (daily-cards-spec § "Data model"). Ordered inside
// `EventDoc.days` (length 10 for the July sailing, but the model assumes no
// fixed length — a future cruise is a new EventDoc with its own days[]). Each
// Day names a date, port, ThemeId, and item pool; the tutorial Days sit at the
// ends but that placement is data, not a code assumption.
export interface DayDef {
  index: number;        // 0..9
  date: string;         // ISO date, e.g. '2026-07-16'
  port: string;         // 'Split'
  portEmoji: string;    // '🇭🇷'
  theme: ThemeId;       // drives card + chrome styling
  pool: 'main' | 'embark' | 'farewell';
  tutorial: boolean;    // true for the embark (Day 1) and farewell (Day 10) Days
  unlockAt: number;     // ms epoch — 08:00 event-tz on `date`; embark Day = event open
  freeText?: string;    // per-day free-space override (tutorial Days)
  // The Day Snapshot: the frozen list of item ids stamped at `unlockAt` by the
  // scheduler (#202). Optional on purpose — absent until that function runs, so
  // the client falls back to the "waking up" locked state rather than dealing
  // from an unfrozen pool.
  snapshotItemIds?: string[];
}

export interface EventDoc {
  name: string;
  sailStart: string; // ISO date
  sailEnd: string;   // ISO date
  status: 'active' | 'archived';
  defaultTheme: ThemeId;
  claimMode: ClaimMode;
  admins: string[];
  // IANA timezone the Day unlock schedule is computed in (e.g. 'Europe/Rome').
  // Required in the contract so day-scheduling consumers never branch on
  // undefined; `eventConverter` defaults a missing legacy field (Event docs
  // seeded before Phase 1.5) to 'Europe/Rome'.
  timezone: string;
  // The ordered per-Day schedule (daily-cards-spec § "Data model"). Required in
  // the contract; `eventConverter` defaults a missing legacy field to [] so a
  // not-yet-migrated Event doc read in dev/tests never throws downstream.
  days: DayDef[];
  // Finale freeze stamp (ms epoch): set by the Day 10 08:00 scheduler run when
  // the standings freeze and the podium Moment posts. Absent until the finale.
  frozenAt?: number;
  // Presentational, event-scoped hide/mute of a Player's content (ADR 0004
  // Phase 0) — NOT hard access revocation. An admin-maintained roster of banned
  // uids kept on the (already admin-writable) event doc; a follow-up (#108) will
  // filter their content client-side, mirroring the reportHideThreshold
  // auto-hide, never gate posting or reads server-side (that is #43/#44). Required
  // in the contract so consumers never branch on undefined; `eventConverter`
  // defaults a missing legacy field (event docs seeded before #113) to [].
  bannedUids: string[];
  settings: {
    reportHideThreshold: number;
    // Target share of spicy (🔞) Prompts among a Board's 24 non-free Squares,
    // read defensively (`typeof === 'number'`) at the deal-time call site the
    // same way `reportHideThreshold` is, even though it is typed required
    // above — optional here because an Event doc seeded before this field
    // existed has no key to read, and `dealBoard`'s own default (0.4) applies
    // when it is absent.
    spicyRatio?: number;
    // Phase 1.5 Proof & Claims admin panel (daily-cards-spec § "Data model").
    // All three are optional here and read defensively at their runtime call
    // sites — the event-level defaults (`camera_or_library` for source, `true`
    // for the exif strip and vision gate) are applied by the consuming tickets
    // (#211), not baked in as type-level defaults.
    photoProofSource?: 'camera_or_library' | 'camera_only';
    stripPhotoExif?: boolean; // geotags never leave the phone
    visionGate?: boolean;     // existing moderation function, now toggleable
  };
}

export interface ItemDoc {
  id: string;
  text: string;
  createdBy: string;
  createdAt: number; // ms epoch
  isFreeSpace: boolean;
  // Phase 1.5 approval flow (daily-cards-spec § "Item pools and the approval
  // flow"): main-pool submissions written after #210 ships start `pending`;
  // an admin approve → `active`, reject → `rejected` (kept for audit, hidden
  // from non-admins). Every existing `active` item stays `active` — this
  // ticket only widens the union, it migrates no data.
  status: 'active' | 'hidden' | 'pending' | 'rejected';
  reportCount: number;
  // Whether this Prompt is in the 🔞-tagged "spicy" category (vs. "tame") for
  // stratified Board composition (`dealBoard`'s spicyRatio sampling).
  spicy: boolean;
  // Which of the three Phase 1.5 pools this Prompt belongs to (main game vs the
  // embark/farewell tutorial cards), separated by field within the one `items`
  // collection. Absent on legacy docs → `'main'` via `itemConverter` default;
  // no data backfill (daily-cards-spec § "Migration").
  pool: 'main' | 'embark' | 'farewell';
  approvedBy?: string; // uid of the approving admin
  approvedAt?: number; // ms epoch
}

export interface Cell {
  index: number;               // 0..24
  itemId: string | null;       // null for the free center
  text: string;
  free: boolean;
  marked: boolean;
  markedAt: number | null;     // ms epoch
  proofId?: string | null;     // Phase 1
  status?: 'confirmed' | 'pending'; // used only in admin_confirmed claim mode
}

export interface BoardDoc {
  uid: string;
  // Which Day this Board belongs to — one Board per Player per Day
  // (daily-cards-spec § "Data model"). Path wiring for the day-scoped location
  // `events/{eventId}/days/{dayIndex}/boards/{uid}` is added by #204; this
  // field is what lets the dealer look up a Player's earlier Day Cards to
  // exclude repeats across the cruise.
  dayIndex: number;
  seed: number;
  createdAt: number;
  cells: Cell[]; // length 25
}

export interface PlayerDoc {
  uid: string;
  displayName: string;
  photoURL: string | null;
  theme?: ThemeId;
  joinedAt: number;
  // Cruise-wide totals, summed across every Day Card (daily-cards-spec §
  // "Scoring and social surfaces").
  bingoCount: number;
  squaresMarked: number;
  firstBingoAt: number | null;
  blackout?: boolean;
  // Per-Day breakdown of the same three stats, keyed by dayIndex. Optional —
  // absent until a Player has played a Day; the aggregates above remain the
  // cruise-long leaderboard source.
  dayStats?: Record<
    number,
    { bingoCount: number; squaresMarked: number; firstBingoAt: number | null }
  >;
}

export interface UserDoc {
  displayName: string;
  handle?: string;
  photoURL: string | null;
  customPhoto?: boolean;
  createdAt: number;
  // Honor-system 18+ self-attestation (ADR 0001): the User's own statement,
  // recorded once, not identity verification. Absent until first attested.
  attestedAdultAt?: number; // ms epoch
}

// ---- Phase 1 ----

export type ProofType = 'photo' | 'audio' | 'text';

export interface ProofDoc {
  id: string;
  uid: string;
  displayName: string;
  photoURL: string | null;
  type: ProofType;
  cellIndex: number;
  itemText: string;
  storagePath?: string | null;
  mediaURL?: string | null;
  thumbURL?: string | null;
  text?: string | null;
  createdAt: number;
  reportCount: number;
  // 'pending' = created under admin_confirmed Claim Mode (data/proofs attachProof);
  // admin-only readable per firestore.rules until confirming the Claim flips it
  // to 'active'. A rejected Claim leaves its Proof 'pending' rather than exposed.
  status: 'active' | 'pending' | 'hidden' | 'flagged';
  visionFlag?: string | null; // set by the moderation function for illegal/extreme content
  // Whether the photo came from the live camera or the photo library — stamps
  // the 🖼️ Feed badge on library picks (daily-cards-spec § "Square tap"; #190).
  // Optional: absent on Proofs written before the two-affordance photo body.
  // `null` (not just absent) is in the contract: attachProof ALWAYS writes the
  // key, storing `null` for audio/text/camera picks, so reads must model it.
  source?: 'camera' | 'library' | null;
  // Which Day this Proof belongs to, so the Feed reads "Day 2 · Get Sporty".
  // Optional until the day-scoped claim flow (#211) stamps it; `null` when the
  // write carries no viewed Day (attachProof always writes the key).
  dayIndex?: number | null;
}

export interface ClaimDoc {
  id: string;
  uid: string; // board owner who claimed the square
  displayName: string;
  cellIndex: number;
  itemText: string;
  proofId?: string | null;
  status: 'pending' | 'confirmed' | 'rejected';
  createdAt: number;
  resolvedBy?: string | null;
  // Which Day's board the claimed mark lives on (#246). Present on claims created
  // in daily-cards mode, so `confirmClaim`/`rejectClaim` resolve against the
  // day-scoped board `days/{dayIndex}/boards/{uid}` and fold `dayStats[dayIndex]`.
  // Absent on legacy claims → the single event-level board.
  dayIndex?: number;
}

// ---- Phase 2: social core (Tally / Doubts / Moments) ----

// One Player's attributed entry in a Prompt's Tally. Keyed by the marker's uid
// so unmarking removes exactly that Player's entry. No anonymity (ADR 0002).
export interface TallyEntry {
  uid: string;
  displayName: string;
  markedAt: number; // ms epoch
  // Day-scoped Tally Cards (#216): the Mark's own attributes, stamped so the
  // Feed can group markers of the SAME `(itemId, dayIndex)` into one live Tally
  // Card and label it. Optional/back-compat — legacy per-Prompt markers written
  // before #216 carry neither, so they contribute to the Square badge (`useTally`
  // counts every marker of the Prompt) but never form a day-scoped Feed card.
  // `itemText` is denormalized here (the marker path carries only `itemId`) so a
  // Tally Card can render "…got 'Balcony or porthole photo'" without a pool read.
  dayIndex?: number;
  itemText?: string;
}

// One live Tally Card in the Feed (#216): a derived, per-`(itemId, dayIndex)`
// aggregation of the Prompt's markers — NOT a stored record. The Feed renders one
// once anyone marks the Prompt on a Day and drops it when the group empties. Its
// `count`/names/avatars are the LIVE tally; `lastMarkedAt` is DERIVED as the max
// of the group's marker times (the parent `tally` doc is admin-only-write, so a
// Mark cannot stamp it client-side). `displayBump` is the debounced sort key the
// merge orders on (see `nextDisplayBumpTime`) so a hot square can't churn the Feed.
export interface TallyCard {
  itemId: string;
  dayIndex: number;
  itemText: string;
  count: number;
  markers: TallyEntry[]; // chronological (earliest first), like `useTally`
  lastMarkedAt: number; // max(marker.markedAt) over the group
  displayBump: number; // debounced Feed-position time (>= its previous value)
}

// The public, attributed per-Prompt Tally: who has marked a given Prompt, plus
// the denormalized count for the Square badge (ADR 0002). Keyed by itemId; every
// Mark — proofed or not — publishes here, even though the Board stays private.
export interface TallyDoc {
  itemId: string; // the Prompt this Tally aggregates
  count: number; // number of Players who have marked the Prompt
  markers: TallyEntry[];
  // ms epoch of the most recent Mark, so the Feed can re-sort a Tally Card
  // toward the top as new Players get the Prompt. Optional until a day-scoped
  // consumer stamps it.
  lastMarkedAt?: number;
  // Which Day this Tally aggregates — a Mark of "Lost passport" on Tuesday's
  // card is a different Tally entry than Thursday's (daily-cards-spec § "Data
  // model"). Optional until the day-scoped surfaces stamp it.
  dayIndex?: number;
}

// One Player publicly asking another to back up a marked Prompt ("pics or it
// didn't happen") — social pressure, never a gate (ADR 0001). It never blocks,
// unmarks, or discounts the Mark. Attaching a Proof satisfies it, so `satisfied*`
// tracks open vs answered without gating play.
export interface DoubtDoc {
  id: string;
  itemId: string; // the doubted Prompt
  cellIndex: number; // the doubted Square on the target's Board
  fromUid: string; // the Player raising the Doubt
  fromDisplayName: string;
  targetUid: string; // the Player whose Mark is doubted
  targetDisplayName: string;
  createdAt: number; // ms epoch
  satisfiedAt?: number | null; // set when a Proof answers the Doubt
  satisfiedProofId?: string | null;
  // Which Day the doubted Mark is on, so day-scoped surfaces stay per-Day.
  // Optional until the day-scoped Doubt flow stamps it.
  dayIndex?: number;
}

// The finale adds two scheduler-posted beats (daily-cards-spec § "Scoring and
// social surfaces"): `last_call` at 20:00 on Day 9 (going-into-the-final-night
// standings) and `podium` at the 08:00 Day 10 freeze (champion + honors).
export type MomentKind =
  | 'bingo'
  | 'blackout'
  | 'first_bingo'
  | 'last_call'
  | 'podium';

// A broadcast announcement of a big social beat, posted to the Feed for everyone
// (ADR 0002). Unlike a Proof it carries no attached evidence — it marks *that*
// something happened, not what it looked like; a bare Mark broadcasts nothing.
export interface MomentDoc {
  id: string;
  kind: MomentKind;
  uid: string;
  displayName: string;
  photoURL: string | null;
  createdAt: number; // ms epoch
  // Which Day this beat belongs to, so the Feed reads "BINGO — Day 4 ·
  // Glamiators". Optional until the day-scoped Moment writers stamp it.
  dayIndex?: number;
  // #266 — the finale beats' CONTENT, written by the scheduler
  // (functions/src/unlockDay.ts). `line` is the last-call standings copy
  // ("X leads by 2 bingos—standings freeze at 8 a.m."); `podium` is the
  // Day-10 freeze payload. Both optional: an older minimal beat (or a
  // content-build failure) renders the generic line.
  line?: string;
  lastCall?: LastCallMomentPayload;
  podium?: PodiumMomentPayload;
}

export interface LastCallMomentPayload {
  players: { uid: string; displayName: string; bingoCount: number; squaresMarked: number }[];
}

// The podium Moment's payload (#266) — the shape
// functions/src/finaleContent.ts buildPodiumPayload writes.
export interface PodiumMomentPayload {
  champion: { uid: string; displayName: string; bingoCount: number; squaresMarked: number } | null;
  firstBingo: { uid: string; displayName: string; at: number } | null;
  dailyHonors: { dayIndex: number; uid: string; displayName: string; at: number }[];
}

// Per-Day honor doc at events/{eventId}/days/{dayIndex}/meta/{dayIndex} — a
// `meta` subcollection holding one document whose id IS the encoded dayIndex,
// so the shape carries no id field (the path above is a valid document path:
// events/days/meta are the three collection segments, each with its id). Holds
// that Day's own First to BINGO, pinned on the Day's board view and the honors
// strip (daily-cards-spec § "Data model" / "Scoring and social surfaces").
// Every Day gets its own daily honor, tutorial Days included; the cruise-wide
// First to BINGO's exclusion of tutorial Days is a query-time filter in #212,
// not a distinction at this type level.
export interface DayMetaDoc {
  firstBingo?: { uid: string; displayName: string; at: number };
}
