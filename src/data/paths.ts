import { collection, doc } from 'firebase/firestore';
import { db, EVENT_ID } from '../firebase';
import {
  eventConverter,
  itemConverter,
  boardConverter,
  playerConverter,
  userConverter,
  proofConverter,
  claimConverter,
} from './converters';

// Typed, converter-attached references for reads.
export const eventRef = () => doc(db, 'events', EVENT_ID).withConverter(eventConverter);
export const itemsCol = () =>
  collection(db, 'events', EVENT_ID, 'items').withConverter(itemConverter);
export const boardRef = (uid: string) =>
  doc(db, 'events', EVENT_ID, 'boards', uid).withConverter(boardConverter);
export const playersCol = () =>
  collection(db, 'events', EVENT_ID, 'players').withConverter(playerConverter);
export const playerRef = (uid: string) =>
  doc(db, 'events', EVENT_ID, 'players', uid).withConverter(playerConverter);
export const userRef = (uid: string) => doc(db, 'users', uid).withConverter(userConverter);
export const proofsCol = () =>
  collection(db, 'events', EVENT_ID, 'proofs').withConverter(proofConverter);
export const proofRef = (id: string) =>
  doc(db, 'events', EVENT_ID, 'proofs', id).withConverter(proofConverter);
export const claimsCol = () =>
  collection(db, 'events', EVENT_ID, 'claims').withConverter(claimConverter);
export const claimRef = (id: string) =>
  doc(db, 'events', EVENT_ID, 'claims', id).withConverter(claimConverter);
