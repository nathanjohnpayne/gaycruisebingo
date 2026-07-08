// Shared domain types. These describe Firestore documents and flow through
// the whole app (converters, hooks, components) as one contract.

export type ClaimMode = 'honor' | 'proof_required' | 'verified';

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
    blackoutEnabled: boolean;
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
  status?: 'confirmed' | 'pending'; // used only in 'verified' claim mode
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
