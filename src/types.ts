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
  | 'seriously-pink';

export interface EventDoc {
  name: string;
  sailStart: string; // ISO date
  sailEnd: string;   // ISO date
  status: 'active' | 'archived';
  defaultTheme: ThemeId;
  claimMode: ClaimMode;
  admins: string[];
  settings: {
    reportHideThreshold: number;
  };
}

export interface ItemDoc {
  id: string;
  text: string;
  createdBy: string;
  createdAt: number; // ms epoch
  isFreeSpace: boolean;
  status: 'active' | 'hidden';
  reportCount: number;
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
  bingoCount: number;
  squaresMarked: number;
  firstBingoAt: number | null;
  blackout?: boolean;
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
  status: 'active' | 'hidden' | 'flagged';
  visionFlag?: string | null; // set by the moderation function for illegal/extreme content
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
}

// ---- Phase 2: social core (Tally / Doubts / Moments) ----

// One Player's attributed entry in a Prompt's Tally. Keyed by the marker's uid
// so unmarking removes exactly that Player's entry. No anonymity (ADR 0002).
export interface TallyEntry {
  uid: string;
  displayName: string;
  markedAt: number; // ms epoch
}

// The public, attributed per-Prompt Tally: who has marked a given Prompt, plus
// the denormalized count for the Square badge (ADR 0002). Keyed by itemId; every
// Mark — proofed or not — publishes here, even though the Board stays private.
export interface TallyDoc {
  itemId: string; // the Prompt this Tally aggregates
  count: number; // number of Players who have marked the Prompt
  markers: TallyEntry[];
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
}

export type MomentKind = 'bingo' | 'blackout' | 'first_bingo';

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
}
