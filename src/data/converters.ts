import type {
  FirestoreDataConverter,
  QueryDocumentSnapshot,
  DocumentData,
} from 'firebase/firestore';
import type {
  ClaimMode,
  EventDoc,
  ItemDoc,
  BoardDoc,
  PlayerDoc,
  UserDoc,
  ProofDoc,
  ClaimDoc,
  TallyEntry,
  MomentDoc,
  DoubtDoc,
} from '../types';

function passthrough<T>(): FirestoreDataConverter<T> {
  return {
    toFirestore: (data) => data as DocumentData,
    fromFirestore: (snap: QueryDocumentSnapshot) => snap.data() as T,
  };
}

/**
 * Resolve a persisted Claim Mode to the current contract. Events seeded or
 * written before the rename persist the pre-rename value for what is now
 * `admin_confirmed`; coerce it on read so existing docs keep working. Unknown
 * or missing values fall back to the least-friction default, `honor`. Writes
 * only ever emit a current `ClaimMode` — the type no longer admits the old one.
 */
export function migrateClaimMode(raw: unknown): ClaimMode {
  if (raw === 'admin_confirmed' || raw === 'verified') return 'admin_confirmed';
  if (raw === 'honor' || raw === 'proof_required') return raw;
  return 'honor';
}

// Events read through the Claim Mode migration so a pre-rename persisted value
// (seeded or in-flight docs) resolves to the current contract; every other field
// passes through untouched.
export const eventConverter: FirestoreDataConverter<EventDoc> = {
  toFirestore: (data) => data as DocumentData,
  fromFirestore: (snap: QueryDocumentSnapshot) => {
    const data = snap.data() as EventDoc;
    return { ...data, claimMode: migrateClaimMode(data.claimMode) };
  },
};
export const boardConverter = passthrough<BoardDoc>();
export const playerConverter = passthrough<PlayerDoc>();
export const userConverter = passthrough<UserDoc>();

// Items carry their doc id (used as the stable key when dealing boards).
export const itemConverter: FirestoreDataConverter<ItemDoc> = {
  toFirestore: (data) => data as DocumentData,
  fromFirestore: (snap: QueryDocumentSnapshot) => ({
    ...(snap.data() as Omit<ItemDoc, 'id'>),
    id: snap.id,
  }),
};

export const proofConverter: FirestoreDataConverter<ProofDoc> = {
  toFirestore: (data) => data as DocumentData,
  fromFirestore: (snap: QueryDocumentSnapshot) => ({
    ...(snap.data() as Omit<ProofDoc, 'id'>),
    id: snap.id,
  }),
};

export const claimConverter: FirestoreDataConverter<ClaimDoc> = {
  toFirestore: (data) => data as DocumentData,
  fromFirestore: (snap: QueryDocumentSnapshot) => ({
    ...(snap.data() as Omit<ClaimDoc, 'id'>),
    id: snap.id,
  }),
};

// A Feed Moment (ADR 0002): a broadcast BINGO / Blackout / First-to-BINGO beat,
// read from events/{EVENT_ID}/moments/{momentId}. Like proofs/claims it carries
// its own doc id (the Feed keys on it), so pin `id` to `snap.id`. The write side
// (src/data/moments.ts) never stores media or a proofId — a Moment marks *that*
// something happened, not what it looked like.
export const momentConverter: FirestoreDataConverter<MomentDoc> = {
  toFirestore: (data) => data as DocumentData,
  fromFirestore: (snap: QueryDocumentSnapshot) => ({
    ...(snap.data() as Omit<MomentDoc, 'id'>),
    id: snap.id,
  }),
};

// A per-Prompt Tally marker (ADR 0002): one Player's attributed entry in a
// Prompt's Tally, read from events/{EVENT_ID}/tally/{itemId}/markers/{uid}. The
// doc id IS the marker's uid (firestore.rules keys the self-write on it — a
// forgery-deniable attribution), so pin `uid` to `snap.id` rather than trusting
// the stored field. This is the read side of the count + tap-to-see-who list.
export const tallyMarkerConverter: FirestoreDataConverter<TallyEntry> = {
  toFirestore: (data) => data as DocumentData,
  fromFirestore: (snap: QueryDocumentSnapshot) => ({
    ...(snap.data() as Omit<TallyEntry, 'uid'>),
    uid: snap.id,
  }),
};

// A Doubt (ADR 0001): one Player publicly asking another to back up a marked
// Prompt — "pics or it didn't happen", social pressure never a gate — read from
// events/{EVENT_ID}/doubts/{doubtId}. Like proofs/claims/moments it carries its
// own doc id (the read hook + derivation key on it), so pin `id` to `snap.id`.
// The write side (src/data/doubts.ts) uses a raw ref and never stores `id`.
export const doubtConverter: FirestoreDataConverter<DoubtDoc> = {
  toFirestore: (data) => data as DocumentData,
  fromFirestore: (snap: QueryDocumentSnapshot) => ({
    ...(snap.data() as Omit<DoubtDoc, 'id'>),
    id: snap.id,
  }),
};
