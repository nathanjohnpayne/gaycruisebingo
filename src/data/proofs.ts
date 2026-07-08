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
 * Mark a square and attach a playful proof (ADR 0002: the Proof IS the Feed
 * entry — a bare Mark posts nothing, an attached Proof posts here). In
 * admin_confirmed mode the square goes pending (doesn't count) and a claim is
 * created for an admin/peer to confirm. A Proof is flavour, never enforcement
 * (ADR 0001): it enriches the Feed, it does not make the Mark more trustworthy.
 *
 * Online-only, by design AND by rule (ADR 0006) — unlike a bare honor Mark
 * (`setMark`), attachProof does NOT queue offline:
 *   - it runs in a `runTransaction`, which needs a server round-trip and REJECTS
 *     offline (the read-modify-write folds onto the LIVE board/player so a
 *     concurrent admin resolve / another of the owner's tabs isn't clobbered),
 *     and
 *   - a photo/audio proof is unwritable before its media exists: firestore.rules
 *     pins `storagePath`/`mediaURL` to the EXACT uploaded Storage object, and a
 *     Storage upload needs signal — so a media proof doc can't be queued ahead of
 *     its upload. (A text proof carries no media, but still rides the same
 *     rejecting transaction.)
 * The offline-durable path is therefore the bare honor Mark; the Proof and its
 * media attach when connectivity returns (ADR 0006: "marks queue, proof media
 * doesn't"). Capture-then-retry lives in `ProofSheet`: a failed submit keeps the
 * captured blob/text in component state so the Player retries without
 * re-capturing — durable for the session, NOT across a reload (only the honor
 * Mark survives a reload).
 *
 * The proof→cell link is authoritative in the proof DOC (`uid` + `cellIndex`),
 * which this writes; `cells[i].proofId` is only a denormalized projection a
 * queued bare-Mark drain can wholesale-replace and drop
 * (specs/w1-board-mark-win.md § cross-writer). This is what discharges that
 * constraint for proof-capture: the Feed (`ProofFeed`/`useProofFeed`) renders
 * every entry from this doc, never from `cells`, so a dropped `proofId` never
 * removes a Proof from the Feed. `deleteProof` looks the backing cell up by
 * this same `cellIndex` rather than scanning for `proofId` — equivalent to the
 * scan given `proofId`'s uniqueness, so this is a clarity change, not a new
 * protection; see its own comment for what it does and does not do once a
 * drain has actually clobbered the projection.
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
      // Resolve the backing cell from the proof's OWN cellIndex — the
      // authoritative proof→cell link (specs/w1-board-mark-win.md § cross-writer)
      // — rather than scanning for `cells[i].proofId === id`. Given `proofId`'s
      // uniqueness and that a proof's `cellIndex` never changes after creation,
      // the two lookups pick out the same cell in every reachable state: this is
      // a clarity/consistency change, not a new protection, and it does NOT
      // recover a clobbered projection. A queued bare-Mark drain does a
      // whole-array { merge:true } replace of `cells` and can drop the
      // `proofId` at `cellIndex`; once that has happened, this lookup sees the
      // same dropped value a `cells.some(c => c.proofId === id)` scan would have
      // seen, so the guard below no-ops identically either way. We gate the
      // unmark on `proofId === id` so we never fight a bare Mark that has since
      // taken the cell over — if the projection was dropped, the drained bare
      // Mark owns the cell and deleteProof leaves it (accepted residual, ADR
      // 0001) rather than un-marking a live Mark. What DOES discharge the PR #75
      // constraint for proof-capture is that the Feed resolves a Proof from this
      // doc's own `uid`/`cellIndex`, never solely from `cells[i].proofId` — see
      // `ProofFeed`/`useProofFeed`.
      const backing = cells?.find((c) => c.index === proof.cellIndex);
      if (cells && backing?.proofId === id) {
        const playerSnap = await tx.get(playerRef);
        const existingFirst = (playerSnap.data()?.firstBingoAt as number | null | undefined) ?? null;
        const next: Cell[] = cells.map((c) =>
          c.index === proof.cellIndex
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
