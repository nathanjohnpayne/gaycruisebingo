import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
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

/**
 * Fold a single Mark toggle into the next Board cells plus the denormalized
 * Player stats it implies. Pure (no Firestore, no clock) and exported so the
 * write path (`setMark`) and its unit test share one source of truth — and,
 * critically, so the write never needs a server read to compute the next state.
 */
export function computeMark(params: {
  cells: Cell[];
  index: number;
  nextMarked: boolean;
  claimMode: ClaimMode;
  currentFirstBingoAt: number | null;
  now: number;
}): {
  cells: Cell[];
  player: { squaresMarked: number; bingoCount: number; firstBingoAt: number | null; blackout: boolean };
  bingo: boolean;
  blackout: boolean;
} {
  const { cells, index, nextMarked, claimMode, currentFirstBingoAt, now } = params;
  const next: Cell[] = cells.map((c) =>
    c.index === index
      ? {
          ...c,
          marked: nextMarked,
          markedAt: nextMarked ? now : null,
          status: claimMode === 'admin_confirmed' && nextMarked ? 'pending' : 'confirmed',
        }
      : c,
  );

  const bingoCount = completedLines(next).length;
  const squaresMarked = countMarked(next);
  const blackout = isBlackout(next);
  // Keep the first-bingo timestamp while a bingo still stands; clear it when
  // unmarking removes the last bingo, so the leaderboard stops crediting a
  // non-winner. `currentFirstBingoAt` is the caller's live value (the
  // useMyPlayer listener), so preserving it needs no server read.
  const firstBingoAt = bingoCount > 0 ? (currentFirstBingoAt ?? now) : null;

  return {
    cells: next,
    player: { squaresMarked, bingoCount, firstBingoAt, blackout },
    bingo: bingoCount > 0,
    blackout,
  };
}

/**
 * Toggle a Square and write the Board + the Player's denormalized stats.
 *
 * Client-authoritative (ADR 0001) and offline-queueable (ADR 0006). Deliberately
 * a plain batched write, NOT a `runTransaction`: a transaction needs a server
 * round-trip and REJECTS while offline, so a Mark made in a ship-wifi dead zone
 * would be dropped instead of queuing durably in the persistent local cache. A
 * Board is single-writer by design — only its owner writes `boards/{uid}` and
 * `players/{uid}` (firestore.rules) — and the live listener keeps the caller's
 * `cells` current across tabs via the shared persistent cache, so we compute the
 * next state from that local snapshot and write it last-write-wins. Both docs go
 * in one `writeBatch` so they queue and apply atomically. A bare Mark writes
 * ONLY these two docs — nothing to the Feed (moments/proofs), per ADR 0002.
 *
 * `commit()` is intentionally not awaited: offline it resolves only on a server
 * ack that may never come in this tab's lifetime, while the write lands in the
 * local cache synchronously (latency compensation) and the live listener
 * reflects it at once — awaiting would stall the Mark on the network. The caller
 * gets the win-detection result synchronously from the local compute.
 */
export async function setMark(params: {
  uid: string;
  cells: Cell[];
  index: number;
  nextMarked: boolean;
  claimMode: ClaimMode;
  currentFirstBingoAt: number | null;
  database?: Firestore;
}): Promise<{ cells: Cell[]; bingo: boolean; blackout: boolean }> {
  const { uid } = params;
  const database = params.database ?? db;
  const { cells, player, bingo, blackout } = computeMark({ ...params, now: Date.now() });

  const batch = writeBatch(database);
  batch.set(doc(database, 'events', EVENT_ID, 'boards', uid), { cells }, { merge: true });
  batch.set(doc(database, 'events', EVENT_ID, 'players', uid), player, { merge: true });
  void batch.commit().catch(() => {
    /* Offline: the write stays queued and drains on reconnect. A genuine
       failure is swallowed like the prior transaction's rejection — the Mark
       UX is client-authoritative and reconciled by the live listener. */
  });

  return { cells, bingo, blackout };
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
