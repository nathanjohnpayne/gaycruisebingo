import { doc, updateDoc, deleteDoc, getDoc, writeBatch } from 'firebase/firestore';
import { db, EVENT_ID } from '../firebase';
import { completedLines, countMarked, isBlackout } from '../game/logic';
import type { Cell, ClaimMode, ThemeId, ClaimDoc } from '../types';

const evt = () => doc(db, 'events', EVENT_ID);
const item = (id: string) => doc(db, 'events', EVENT_ID, 'items', id);
const proof = (id: string) => doc(db, 'events', EVENT_ID, 'proofs', id);
const claim = (id: string) => doc(db, 'events', EVENT_ID, 'claims', id);
const board = (uid: string) => doc(db, 'events', EVENT_ID, 'boards', uid);
const player = (uid: string) => doc(db, 'events', EVENT_ID, 'players', uid);

export const hideItem = (id: string) => updateDoc(item(id), { status: 'hidden' });
export const restoreItem = (id: string) => updateDoc(item(id), { status: 'active' });
export const deleteItem = (id: string) => deleteDoc(item(id));
export const hideProof = (id: string) => updateDoc(proof(id), { status: 'hidden' });
export const restoreProof = (id: string) => updateDoc(proof(id), { status: 'active' });
export const setClaimMode = (mode: ClaimMode) => updateDoc(evt(), { claimMode: mode });
export const setEventTheme = (theme: ThemeId) => updateDoc(evt(), { defaultTheme: theme });

/** Recompute a player's stats after an admin resolves one of their claims. */
async function resolve(
  c: ClaimDoc,
  transform: (cells: Cell[]) => Cell[],
  adminUid: string,
  status: 'confirmed' | 'rejected',
): Promise<void> {
  const [bSnap, pSnap] = await Promise.all([getDoc(board(c.uid)), getDoc(player(c.uid))]);
  if (!bSnap.exists()) return;
  const cells = (bSnap.data().cells as Cell[]) ?? [];
  const next = transform(cells);
  const bingoCount = completedLines(next).length;
  const squares = countMarked(next);
  const blackout = isBlackout(next);
  const existingFirst = pSnap.exists() ? ((pSnap.data().firstBingoAt as number | null) ?? null) : null;
  const firstBingoAt = existingFirst ?? (bingoCount > 0 ? Date.now() : null);

  const batch = writeBatch(db);
  batch.set(board(c.uid), { cells: next }, { merge: true });
  batch.set(player(c.uid), { squaresMarked: squares, bingoCount, blackout, firstBingoAt }, { merge: true });
  batch.set(claim(c.id), { status, resolvedBy: adminUid }, { merge: true });
  await batch.commit();
}

/**
 * The board cell a claim resolves. Match on the claim's own proofId when it has
 * one, so resolving one of several pending claims for the same square acts on
 * that claim's proof — not whichever proof currently sits at the index (which may
 * be a newer submission). Fall back to cellIndex for legacy claims with no proofId.
 */
const isClaimCell = (x: Cell, c: ClaimDoc): boolean =>
  c.proofId != null ? x.proofId === c.proofId : x.index === c.cellIndex;

export function confirmClaim(c: ClaimDoc, adminUid: string): Promise<void> {
  return resolve(
    c,
    (cells) => cells.map((x) => (isClaimCell(x, c) ? { ...x, status: 'confirmed' as const } : x)),
    adminUid,
    'confirmed',
  );
}

export function rejectClaim(c: ClaimDoc, adminUid: string): Promise<void> {
  return resolve(
    c,
    (cells) =>
      cells.map((x) =>
        isClaimCell(x, c)
          ? { ...x, marked: false, status: 'confirmed' as const, proofId: null, markedAt: null }
          : x,
      ),
    adminUid,
    'rejected',
  );
}
