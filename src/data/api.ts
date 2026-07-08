import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocFromCache,
  getDocs,
  increment,
  query,
  runTransaction,
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
import type { Cell, ClaimMode, UserDoc } from '../types';

// Raw (converter-free) refs for writes, to keep partial merges simple.
const rawUser = (uid: string) => doc(db, 'users', uid);
const rawBoard = (uid: string) => doc(db, 'events', EVENT_ID, 'boards', uid);
const rawPlayer = (uid: string) => doc(db, 'events', EVENT_ID, 'players', uid);
const rawItems = () => collection(db, 'events', EVENT_ID, 'items');
const rawItem = (id: string) => doc(db, 'events', EVENT_ID, 'items', id);

/**
 * True only for a well-formed `https://` URL — the only photo shape the public
 * players row accepts from the self-writable users/{uid} profile. Rejects
 * non-strings, unparseable strings, and every other scheme (`http:`,
 * `javascript:`, `data:`, …), so a malformed saved photo can never be
 * denormalized into a public doc other clients render.
 */
function isHttpsUrl(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  try {
    return new URL(v).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * The public displayName to denormalize for a Player: their SAVED users/{uid}
 * name when it is a real, trimmed-non-empty string within the 100-char cap the
 * public-doc rules enforce (markers, moments, proofs), else the auth value, else
 * 'Anonymous'. Single source of truth for the join-side attribution (`joinAndDeal`)
 * and the per-Prompt Tally marker (`setMark`), so both resolve the name the SAME
 * validated way — a malformed self-written profile never flows into a public doc.
 */
export function resolveDisplayName(
  profile: { displayName?: unknown } | null | undefined,
  authFallback: string | null | undefined,
): string {
  const saved =
    typeof profile?.displayName === 'string' &&
    profile.displayName.trim().length > 0 &&
    profile.displayName.length <= 100
      ? profile.displayName
      : null;
  return saved ?? authFallback ?? 'Anonymous';
}

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
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists()) return;
    tx.set(ref, {
      displayName: u.displayName ?? 'Anonymous',
      photoURL: u.photoURL ?? null,
      createdAt: Date.now(),
    });
  });
}

/** Deal a frozen board + create the player row the first time a user joins. */
export async function joinAndDeal(u: User): Promise<void> {
  const existing = await getDoc(rawBoard(u.uid));
  if (existing.exists()) return;

  // Denormalize the Player's SAVED identity, not the raw Google one (Codex P2
  // on PR #67, the join-side half): a Player who customized their users/{uid}
  // profile must not get their Google name/avatar re-published into the public
  // players row at join. Prefer the saved displayName, and the saved photoURL
  // only when it is a deliberate custom avatar (customPhoto) — otherwise the
  // profile photo is just a stale copy of the Google one, so the live auth
  // value wins. One extra read, join-path only (returning Players early-return
  // above), fetched alongside the pool; best-effort — a missing or unreadable
  // profile falls back to the auth values rather than blocking the deal.
  const [profileSnap, snap] = await Promise.all([
    getDoc(rawUser(u.uid)).catch(() => null),
    getDocs(query(itemsCol(), where('status', '==', 'active'))),
  ]);
  const profile = profileSnap?.exists() ? (profileSnap.data() as Partial<UserDoc>) : null;
  // Validate before denormalizing (Codex P2 on PR #66 round 3): users/{uid} is
  // self-writable — firestore.rules only shape-checks its attestedAdultAt — so
  // a malformed saved profile must not flow into the public players row (nor
  // fail the join against the rules' shape checks). The saved name is validated
  // by `resolveDisplayName` (real, trimmed-non-empty, within the 100-char cap
  // the rules enforce on every public displayName — markers, moments, proofs),
  // the SAME guard the Tally marker write uses; a saved photo only counts when
  // it is a well-formed https:// URL AND the profile's customPhoto flag is
  // EXACTLY boolean true (round 4: a malformed truthy value like 'false' or 1
  // must not publish the saved photo — the contract is customPhoto: true, and
  // everything else in this doc is untrusted junk). Anything malformed falls
  // back per-field to the auth values, exactly like a missing profile.
  const savedPhoto = profile && isHttpsUrl(profile.photoURL) ? profile.photoURL : null;
  const displayName = resolveDisplayName(profile, u.displayName);
  const photoURL =
    profile?.customPhoto === true ? (savedPhoto ?? u.photoURL ?? null) : (u.photoURL ?? null);

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
      displayName,
      photoURL,
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
  // `undefined` means the caller's first-bingo state is UNKNOWN (the player row
  // has not loaded yet AND nothing is cached); `null` is a KNOWN "no first
  // bingo yet". The two are folded differently below — see the firstBingoAt
  // handling — because stamping `now` over an UNKNOWN prior value can clobber a
  // real, earlier server timestamp (Codex P2, PR #75).
  currentFirstBingoAt: number | null | undefined;
  now: number;
}): {
  cells: Cell[];
  // firstBingoAt is OPTIONAL on purpose: it is omitted from the player payload
  // when the prior value is UNKNOWN, so the `{ merge: true }` write preserves
  // whatever stamp the server already holds instead of overwriting it.
  player: { squaresMarked: number; bingoCount: number; firstBingoAt?: number | null; blackout: boolean };
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
  const previousBingoCount = completedLines(cells).length;
  const squaresMarked = countMarked(next);
  const blackout = isBlackout(next);

  const player: {
    squaresMarked: number;
    bingoCount: number;
    blackout: boolean;
    firstBingoAt?: number | null;
  } = { squaresMarked, bingoCount, blackout };
  // firstBingoAt is the one denormalized field that depends on prior SERVER
  // state, not purely on `next` — but only in the "bingo was already standing"
  // direction. Clearing is prior-independent: whenever the new state holds NO
  // bingo, firstBingoAt must be null no matter what the server had, so a mark
  // that removes the last bingo always writes the clear — even when the prior
  // value is UNKNOWN (`undefined`: the caller's player row has not loaded and
  // nothing is cached), or a stale stamp would keep crediting a non-winner.
  // A transition from NO bingo to a standing bingo is also prior-independent:
  // the folded board itself proves this is the first current line, so stamp
  // `now` even if the player row is unknown. The only unknown-state write we
  // omit is a further mark while a bingo already stood, where stamping `now`
  // could clobber the server's earlier first-bingo timestamp.
  if (bingoCount === 0) {
    player.firstBingoAt = null;
  } else if (currentFirstBingoAt === undefined && previousBingoCount === 0) {
    player.firstBingoAt = now;
  } else if (currentFirstBingoAt !== undefined) {
    player.firstBingoAt = currentFirstBingoAt ?? now;
  }

  return {
    cells: next,
    player,
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
 * `players/{uid}` (firestore.rules) — but that does NOT make the caller's
 * render-time `cells` snapshot safe to fold onto blind: two Marks issued in
 * quick succession (two fast taps, or another of the owner's own tabs) fire
 * before the live listener has re-rendered the caller with the first Mark, so
 * both would fold onto the SAME stale `cells` and the second write's full-array
 * replacement would silently clobber the first — no other writer is needed for
 * that race, just the same owner acting twice before their own echo lands.
 * Two mechanisms close it together: `getDocFromCache` — a cache-only read
 * (works offline, no server round trip) that sees this client's own
 * just-applied mutations and, via the shared persistent multi-tab cache,
 * another tab's already-synced ones — folds onto the freshest LOCAL knowledge
 * of the Board (and, for `firstBingoAt`, the Player row) rather than a
 * potentially-stale prop; and the per-board serialization chain below, which
 * keeps OVERLAPPING calls from both reading that cache before either has
 * issued its batch (Codex P1, PR #75). Each
 * falls back to its caller-supplied param only when nothing is cached yet
 * (this write is the first local knowledge of the doc, e.g. a test double
 * with no cache). Both docs go in one `writeBatch` so they queue and apply
 * atomically. A bare Mark writes ONLY these two docs — nothing to the Feed
 * (moments/proofs), per ADR 0002.
 *
 * `commit()` is intentionally not awaited: offline it resolves only on a server
 * ack that may never come in this tab's lifetime, while the write lands in the
 * local cache synchronously (latency compensation) and the live listener
 * reflects it at once — awaiting would stall the Mark on the network. The caller
 * gets the win-detection result synchronously from the local compute.
 */
// Overlapping Marks must not interleave between the cache read and the local
// batch application: Board.toggle fires doMark without awaiting, so two fast
// taps can otherwise BOTH pass getDocFromCache before either commit()'s
// latency compensation applies, folding onto the same cached board and
// clobbering each other exactly like the stale-prop race the cache read
// closed (Codex P1, PR #75). setMark therefore serializes per board: each
// call's read runs only after the previous call has issued its batch.
const markChains = new Map<string, Promise<unknown>>();

/**
 * A rules-valid attributed name for a Tally marker, shared by the honor-Mark
 * (`setMark`) and proofed-Mark (`attachProof`) paths. Prefers the caller-resolved
 * `displayName` — production (Board.tsx) resolves the saved player-row identity +
 * auth fallback via `resolveDisplayName` (the SAME validated pattern joinAndDeal
 * uses) — falling back to the already-cached/looked-up player row's denormalized
 * name (so a direct caller like the offline durability harness still attributes),
 * then 'Anonymous'. Always a non-empty string within the 100-char cap the
 * tally-marker rule enforces, so a marker write can NEVER violate the rule and
 * poison the atomic board+player+marker batch (setMark) or the
 * proof+board+player+marker transaction (attachProof).
 */
export function markerDisplayName(preferred: string | undefined, cachedPlayerName: unknown): string {
  const candidate =
    typeof preferred === 'string' && preferred.trim().length > 0
      ? preferred
      : typeof cachedPlayerName === 'string' && cachedPlayerName.trim().length > 0
        ? cachedPlayerName
        : 'Anonymous';
  return candidate.slice(0, 100);
}

export async function setMark(params: {
  uid: string;
  cells: Cell[];
  index: number;
  nextMarked: boolean;
  claimMode: ClaimMode;
  // `undefined` = UNKNOWN (player row still loading, no cache); `null` = a known
  // "no first bingo yet". Board.tsx passes `undefined` while useMyPlayer is
  // loading so a cache-miss Mark can't restamp an earlier server value.
  currentFirstBingoAt: number | null | undefined;
  // The marker's attributed name for the per-Prompt Tally write (ADR 0002).
  // Board.tsx resolves it from the saved player-row identity + auth via
  // `resolveDisplayName` (the SAME validated pattern joinAndDeal uses). Optional
  // so direct callers (the offline durability harness) can omit it and fall back
  // to the cached player row's already-denormalized name — see `markerDisplayName`.
  displayName?: string;
  database?: Firestore;
}): Promise<{ cells: Cell[]; bingo: boolean; blackout: boolean }> {
  const { uid } = params;
  const database = params.database ?? db;
  const chainKey = `${(database as unknown as { app?: { name?: string } }).app?.name ?? 'default'}/${uid}`;
  const prev = markChains.get(chainKey) ?? Promise.resolve();
  const next = prev.then(
    () => runSetMark(params, database),
    () => runSetMark(params, database),
  );
  // The stored tail never rejects, so one failed Mark cannot poison the chain.
  markChains.set(
    chainKey,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

async function runSetMark(
  params: {
    uid: string;
    cells: Cell[];
    index: number;
    nextMarked: boolean;
    claimMode: ClaimMode;
    currentFirstBingoAt: number | null | undefined;
    displayName?: string;
  },
  database: Firestore,
): Promise<{ cells: Cell[]; bingo: boolean; blackout: boolean }> {
  const { uid } = params;
  const boardRef = doc(database, 'events', EVENT_ID, 'boards', uid);
  const playerRef = doc(database, 'events', EVENT_ID, 'players', uid);

  let baseCells = params.cells;
  let baseFirstBingoAt = params.currentFirstBingoAt;
  // The already-denormalized public name on the player row is the fallback
  // attribution for the Tally marker when the caller omits `displayName`.
  let cachedPlayerName: unknown;
  const [cachedBoard, cachedPlayer] = await Promise.allSettled([
    getDocFromCache(boardRef),
    getDocFromCache(playerRef),
  ]);
  // Nothing cached yet for either doc falls back to the caller-supplied param
  // (e.g. the very first local knowledge of it, or a test double with no
  // cache) — that is the pre-fix behavior, unchanged.
  if (cachedBoard.status === 'fulfilled' && cachedBoard.value.exists()) {
    baseCells = (cachedBoard.value.data() as { cells: Cell[] }).cells;
  }
  if (cachedPlayer.status === 'fulfilled' && cachedPlayer.value.exists()) {
    // A cached Player row is KNOWN state: the cached value always wins over the
    // caller's prop, and even a row that predates the firstBingoAt field is a
    // known "no first bingo yet" (null), never UNKNOWN. Only a genuine cache
    // MISS (below) leaves baseFirstBingoAt as the caller's param, which may be
    // `undefined` (UNKNOWN) so computeMark omits the field and the server value
    // survives (Codex P2, PR #75).
    const cachedData = cachedPlayer.value.data() as {
      firstBingoAt?: number | null;
      displayName?: unknown;
    };
    baseFirstBingoAt = cachedData.firstBingoAt ?? null;
    cachedPlayerName = cachedData.displayName;
  }

  const now = Date.now();
  const { cells, player, bingo, blackout } = computeMark({
    ...params,
    cells: baseCells,
    currentFirstBingoAt: baseFirstBingoAt,
    now,
  });

  const batch = writeBatch(database);
  batch.set(boardRef, { cells }, { merge: true });
  batch.set(playerRef, player, { merge: true });

  // Per-Prompt Tally (ADR 0002, the embarkation-critical differentiator): every
  // Mark — proofed or not — self-publishes an ATTRIBUTED entry to its Prompt's
  // Tally, in the SAME offline-queueable batch as the board + player writes (never
  // a second unserialized path or a transaction; the whole Mark path is
  // offline-durable by design). The Tally lives in its OWN subcollection, never in
  // the cells array a bare Mark rewrites, and the marker doc id IS the marker uid
  // so firestore.rules keeps a forged attribution out. Marking adds the entry;
  // unmarking deletes exactly that Player's entry, mirroring the cell toggle so the
  // Tally never drifts from the Board. The free centre Square (no itemId) never
  // tallies. A bare Mark still posts NOTHING to the Feed (moments/proofs) — the
  // Tally is a separate surface (ADR 0002).
  const toggled = cells.find((c) => c.index === params.index);
  const tallyItemId = toggled && !toggled.free ? toggled.itemId : null;
  if (tallyItemId) {
    const markerRef = doc(database, 'events', EVENT_ID, 'tally', tallyItemId, 'markers', uid);
    if (params.nextMarked) {
      batch.set(markerRef, {
        uid,
        displayName: markerDisplayName(params.displayName, cachedPlayerName),
        markedAt: now,
      });
    } else {
      batch.delete(markerRef);
    }
  }

  void batch.commit().catch((err: unknown) => {
    // A rejection here is NOT the offline case. Offline, commit() PENDS — it
    // neither resolves nor rejects in this tab's lifetime — while the write sits
    // durably in the persistent cache and drains on reconnect (ADR 0006). So a
    // rejection is always a genuine ONLINE failure: a permission-denied after an
    // auth-state change, or a malformed update the rules reject. Firestore's
    // latency compensation ROLLS BACK the optimistic local write on rejection,
    // so the live onSnapshot listener re-renders the Board without the Mark and
    // the optimistic UI self-corrects on its own. The Mark UX stays
    // client-authoritative (ADR 0001), so we do not surface a retry/toast here —
    // but the failure must not vanish silently (the prior code discarded it), so
    // log it with the Mark context for observability.
    console.error(
      '[setMark] batch.commit() rejected — online write failure; Firestore will roll back the optimistic Mark and the live listener will un-mark the UI',
      { uid, index: params.index, nextMarked: params.nextMarked },
      err,
    );
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
