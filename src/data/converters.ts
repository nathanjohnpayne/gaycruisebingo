import type {
  FirestoreDataConverter,
  QueryDocumentSnapshot,
  DocumentData,
} from 'firebase/firestore';
import type { EventDoc, ItemDoc, BoardDoc, PlayerDoc, UserDoc, ProofDoc, ClaimDoc } from '../types';

function passthrough<T>(): FirestoreDataConverter<T> {
  return {
    toFirestore: (data) => data as DocumentData,
    fromFirestore: (snap: QueryDocumentSnapshot) => snap.data() as T,
  };
}

export const eventConverter = passthrough<EventDoc>();
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
