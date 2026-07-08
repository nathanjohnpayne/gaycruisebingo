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
