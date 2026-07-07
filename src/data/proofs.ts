import { collection, deleteDoc, doc, increment, updateDoc, writeBatch } from 'firebase/firestore';
import { db, EVENT_ID } from '../firebase';
import { uploadProofMedia, deleteStoragePath } from './storage';
import { completedLines, countMarked, isBlackout } from '../game/logic';
import type { Cell, ClaimMode, ProofType } from '../types';

const rawProofs = () => collection(db, 'events', EVENT_ID, 'proofs');
const rawProof = (id: string) => doc(db, 'events', EVENT_ID, 'proofs', id);
const rawClaims = () => collection(db, 'events', EVENT_ID, 'claims');
const rawBoard = (uid: string) => doc(db, 'events', EVENT_ID, 'boards', uid);
const rawPlayer = (uid: string) => doc(db, 'events', EVENT_ID, 'players', uid);

export interface AttachProofArgs {
  uid: string;
  displayName: string;
  photoURL: string | null;
  cells: Cell[];
  cellIndex: number;
  itemText: string;
  claimMode: ClaimMode;
  currentFirstBingoAt: number | null;
  proof: { type: ProofType; blob?: Blob; text?: string };
}

/**
 * Mark a square and attach a playful proof. In 'verified' mode the square goes
 * pending (doesn't count) and a claim is created for an admin/peer to confirm.
 */
export async function attachProof(args: AttachProofArgs): Promise<void> {
  const { uid, displayName, photoURL, cells, cellIndex, itemText, claimMode, currentFirstBingoAt, proof } =
    args;
  const now = Date.now();
  const pRef = doc(rawProofs());
  const proofId = pRef.id;

  let storagePath: string | null = null;
  let mediaURL: string | null = null;
  if ((proof.type === 'photo' || proof.type === 'audio') && proof.blob) {
    const up = await uploadProofMedia(uid, proofId, proof.blob, proof.type);
    storagePath = up.path;
    mediaURL = up.url;
  }

  const pending = claimMode === 'verified';
  const next: Cell[] = cells.map((c) =>
    c.index === cellIndex
      ? { ...c, marked: true, markedAt: now, proofId, status: pending ? 'pending' : 'confirmed' }
      : c,
  );

  const bingoCount = completedLines(next).length;
  const squares = countMarked(next);
  const blackout = isBlackout(next);
  const firstBingoAt = currentFirstBingoAt ?? (bingoCount > 0 ? now : null);

  const batch = writeBatch(db);
  batch.set(pRef, {
    uid,
    displayName,
    photoURL,
    type: proof.type,
    cellIndex,
    itemText,
    storagePath,
    mediaURL,
    thumbURL: null,
    text: proof.text ?? null,
    createdAt: now,
    reportCount: 0,
    status: 'active',
    visionFlag: null,
  });
  batch.set(rawBoard(uid), { cells: next }, { merge: true });
  batch.set(rawPlayer(uid), { squaresMarked: squares, bingoCount, firstBingoAt, blackout }, { merge: true });
  if (pending) {
    batch.set(doc(rawClaims()), {
      uid,
      displayName,
      cellIndex,
      itemText,
      proofId,
      status: 'pending',
      createdAt: now,
      resolvedBy: null,
    });
  }
  await batch.commit();
}

export async function reportProof(id: string): Promise<void> {
  await updateDoc(rawProof(id), { reportCount: increment(1) });
}

export async function deleteProof(id: string, storagePath?: string | null): Promise<void> {
  if (storagePath) await deleteStoragePath(storagePath);
  await deleteDoc(rawProof(id));
}
