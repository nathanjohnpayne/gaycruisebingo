import { collection, doc, increment, runTransaction, updateDoc } from 'firebase/firestore';
import { db, EVENT_ID } from '../firebase';
import { uploadProofMedia, deleteStoragePath } from './storage';
import { completedLines, countMarked, isBlackout } from '../game/logic';
import type { Cell, ClaimMode, ProofDoc, ProofType } from '../types';

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
 * Mark a square and attach a playful proof. In admin_confirmed mode the square
 * goes pending (doesn't count) and a claim is created for an admin/peer to confirm.
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

  const pending = claimMode === 'admin_confirmed';

  // Recompute cells from the live board inside a transaction so a concurrent
  // mark from another tab/device isn't clobbered by this caller's stale snapshot.
  await runTransaction(db, async (tx) => {
    const boardRef = rawBoard(uid);
    const playerRef = rawPlayer(uid);
    // Read board + player before any write (transactions require reads first).
    const boardSnap = await tx.get(boardRef);
    const playerSnap = await tx.get(playerRef);
    const liveCells = (boardSnap.data()?.cells as Cell[] | undefined) ?? cells;
    const next: Cell[] = liveCells.map((c) =>
      c.index === cellIndex
        ? { ...c, marked: true, markedAt: now, proofId, status: pending ? 'pending' : 'confirmed' }
        : c,
    );

    const bingoCount = completedLines(next).length;
    const squares = countMarked(next);
    const blackout = isBlackout(next);
    // Derive firstBingoAt from the live player row, not the caller's stale prop,
    // so a concurrent proof/mark can't overwrite an earlier first-bingo stamp;
    // clear it when no bingo stands (mirrors setMark/deleteProof).
    const existingFirst =
      (playerSnap.data()?.firstBingoAt as number | null | undefined) ?? currentFirstBingoAt ?? null;
    const firstBingoAt = bingoCount > 0 ? (existingFirst ?? now) : null;

    tx.set(pRef, {
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
      // Admin-confirmed-mode proofs stay 'pending' (admin-only readable) until an admin
      // confirms the claim; otherwise the proof is public immediately.
      status: pending ? 'pending' : 'active',
      visionFlag: null,
    });
    tx.set(boardRef, { cells: next }, { merge: true });
    tx.set(playerRef, { squaresMarked: squares, bingoCount, firstBingoAt, blackout }, { merge: true });
    if (pending) {
      tx.set(doc(rawClaims()), {
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
  });
}

export async function reportProof(id: string): Promise<void> {
  await updateDoc(rawProof(id), { reportCount: increment(1) });
}

export async function deleteProof(id: string, storagePath?: string | null): Promise<void> {
  // Storage first (ordering preserved): if the blob delete throws we keep the
  // doc so the media isn't orphaned.
  if (storagePath) await deleteStoragePath(storagePath);

  await runTransaction(db, async (tx) => {
    const proofRef = rawProof(id);
    const proofSnap = await tx.get(proofRef);
    const proof = proofSnap.data() as ProofDoc | undefined;

    if (proof) {
      // A deleted proof must not leave its square marked-but-uncredited (in
      // proof_required mode a marked cell is backed by this proof). Unmark the
      // backing cell and recompute the owner's derived stats in the same txn.
      const boardRef = rawBoard(proof.uid);
      const playerRef = rawPlayer(proof.uid);
      const boardSnap = await tx.get(boardRef);
      const cells = boardSnap.data()?.cells as Cell[] | undefined;
      if (cells?.some((c) => c.proofId === id)) {
        const playerSnap = await tx.get(playerRef);
        const existingFirst = (playerSnap.data()?.firstBingoAt as number | null | undefined) ?? null;
        const next: Cell[] = cells.map((c) =>
          c.proofId === id
            ? { ...c, marked: false, markedAt: null, proofId: null, status: 'confirmed' }
            : c,
        );
        const bingoCount = completedLines(next).length;
        const squares = countMarked(next);
        const blackout = isBlackout(next);
        const firstBingoAt = bingoCount > 0 ? existingFirst : null;
        tx.set(boardRef, { cells: next }, { merge: true });
        tx.set(playerRef, { squaresMarked: squares, bingoCount, firstBingoAt, blackout }, { merge: true });
      }
    }

    tx.delete(proofRef);
  });
}
