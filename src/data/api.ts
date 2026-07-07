import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db, EVENT_ID } from '../firebase';
import { itemsCol } from './paths';
import { FREE_TEXT } from './seed';
import {
  dealBoard,
  completedLines,
  countMarked,
  isBlackout,
  type DealItem,
} from '../game/logic';
import type { Cell, ClaimMode } from '../types';

// Raw (converter-free) refs for writes, to keep partial merges simple.
const rawUser = (uid: string) => doc(db, 'users', uid);
const rawBoard = (uid: string) => doc(db, 'events', EVENT_ID, 'boards', uid);
const rawPlayer = (uid: string) => doc(db, 'events', EVENT_ID, 'players', uid);
const rawItems = () => collection(db, 'events', EVENT_ID, 'items');
const rawItem = (id: string) => doc(db, 'events', EVENT_ID, 'items', id);

/** Deterministic 32-bit seed from a uid so a player's board is stable. */
export function seedFromUid(uid: string): number {
  let h = 2166136261;
  for (let i = 0; i < uid.length; i++) {
    h ^= uid.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Create the global user profile on first sign-in. */
export async function ensureUserProfile(u: User): Promise<void> {
  const ref = rawUser(u.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      displayName: u.displayName ?? 'Anonymous',
      photoURL: u.photoURL ?? null,
      createdAt: Date.now(),
    });
  }
}

/** Deal a frozen board + create the player row the first time a user joins. */
export async function joinAndDeal(u: User): Promise<void> {
  const existing = await getDoc(rawBoard(u.uid));
  if (existing.exists()) return;

  const snap = await getDocs(query(itemsCol(), where('status', '==', 'active')));
  const pool: DealItem[] = snap.docs
    .map((d) => d.data())
    .filter((it) => !it.isFreeSpace)
    .map((it) => ({ id: it.id, text: it.text }));

  const seed = seedFromUid(u.uid);
  const cells = dealBoard(pool, FREE_TEXT, seed);
  const now = Date.now();

  const batch = writeBatch(db);
  batch.set(rawBoard(u.uid), { uid: u.uid, seed, createdAt: now, cells });
  batch.set(
    rawPlayer(u.uid),
    {
      uid: u.uid,
      displayName: u.displayName ?? 'Anonymous',
      photoURL: u.photoURL ?? null,
      joinedAt: now,
      bingoCount: 0,
      squaresMarked: 0,
      firstBingoAt: null,
      blackout: false,
    },
    { merge: true },
  );
  await batch.commit();
}

/** Toggle a square and recompute the player's denormalized stats. */
export async function setMark(params: {
  uid: string;
  cells: Cell[];
  index: number;
  nextMarked: boolean;
  claimMode: ClaimMode;
  currentFirstBingoAt: number | null;
}): Promise<{ cells: Cell[]; bingo: boolean; blackout: boolean }> {
  const { uid, cells, index, nextMarked, claimMode, currentFirstBingoAt } = params;
  const now = Date.now();

  // Recompute cells from the live board inside a transaction so a concurrent
  // mark from another tab/device isn't clobbered by this caller's stale snapshot
  // (mirrors attachProof).
  return runTransaction(db, async (tx) => {
    const boardRef = rawBoard(uid);
    const playerRef = rawPlayer(uid);
    const boardSnap = await tx.get(boardRef);
    const liveCells = (boardSnap.data()?.cells as Cell[] | undefined) ?? cells;
    const next: Cell[] = liveCells.map((c) =>
      c.index === index
        ? {
            ...c,
            marked: nextMarked,
            markedAt: nextMarked ? now : null,
            status: claimMode === 'verified' && nextMarked ? 'pending' : 'confirmed',
          }
        : c,
    );

    const bingoCount = completedLines(next).length;
    const squares = countMarked(next);
    const blackout = isBlackout(next);
    // Keep the first-bingo timestamp while a bingo still stands; clear it when
    // unmarking removes the last bingo, so the leaderboard stops crediting a
    // non-winner (mirrors deleteProof). Read the live player row so a concurrent
    // update isn't lost.
    const playerSnap = await tx.get(playerRef);
    const existingFirst =
      (playerSnap.data()?.firstBingoAt as number | null | undefined) ?? currentFirstBingoAt ?? null;
    const firstBingoAt = bingoCount > 0 ? (existingFirst ?? now) : null;

    tx.set(boardRef, { cells: next }, { merge: true });
    tx.set(playerRef, { squaresMarked: squares, bingoCount, firstBingoAt, blackout }, { merge: true });

    return { cells: next, bingo: bingoCount > 0, blackout };
  });
}

/** Add a prompt to the community pool. */
export async function addItem(uid: string, text: string): Promise<void> {
  const t = text.trim();
  if (!t) return;
  await addDoc(rawItems(), {
    text: t.slice(0, 80),
    createdBy: uid,
    createdAt: Date.now(),
    isFreeSpace: false,
    status: 'active',
    reportCount: 0,
  });
}

/** Report a prompt (increments the report counter; auto-hide handled by admin/threshold). */
export async function reportItem(id: string): Promise<void> {
  await updateDoc(rawItem(id), { reportCount: increment(1) });
}

/** Let a player set a display theme preference on their player row. */
export async function savePlayerTheme(uid: string, theme: string): Promise<void> {
  await setDoc(rawPlayer(uid), { theme }, { merge: true });
}
