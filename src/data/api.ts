import {
  addDoc,
  collection,
  deleteField,
  doc,
  getDoc,
  getDocFromCache,
  getDocFromServer,
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
import { markerDisplayName } from './attribution';
import { isReportHidden, isBanned } from './moderation';
import { itemsCol } from './paths';
import { FREE_TEXT } from './seed';
import {
  dealBoard,
  dayDealState,
  completedLines,
  countMarked,
  isBlackout,
  type DealItem,
} from '../game/logic';
import type { Cell, ClaimMode, DayDef, EventDoc, ItemDoc, UserDoc } from '../types';

// Raw (converter-free) refs for writes, to keep partial merges simple.
const rawUser = (uid: string) => doc(db, 'users', uid);
const rawBoard = (uid: string) => doc(db, 'events', EVENT_ID, 'boards', uid);
// A Player's Day Card write ref: events/{EVENT_ID}/days/{dayIndex}/boards/{uid}
// (daily-cards-spec § "Data model"). `String(dayIndex)` is the canonical decimal
// segment the day-scoped firestore.rules gate accepts (#201).
const rawDayBoard = (dayIndex: number, uid: string) =>
  doc(db, 'events', EVENT_ID, 'days', String(dayIndex), 'boards', uid);
const rawPlayer = (uid: string) => doc(db, 'events', EVENT_ID, 'players', uid);
const rawItems = () => collection(db, 'events', EVENT_ID, 'items');
const rawItem = (id: string) => doc(db, 'events', EVENT_ID, 'items', id);
const rawEvent = () => doc(db, 'events', EVENT_ID);

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

/**
 * The create-only bootstrap payload for a `users/{uid}` profile row: the
 * Google-sourced identity defaults `ensureUserProfile` writes on first sign-in.
 * Extracted as the ONE source of truth for the bootstrap shape so the attestation
 * transaction can write the SAME payload when it wins the create race on an absent
 * row (Codex P2, PR #112) — no duplicated shape to drift out of sync.
 */
function bootstrapProfile(u: User, now: number = Date.now()) {
  return {
    displayName: u.displayName ?? 'Anonymous',
    photoURL: u.photoURL ?? null,
    createdAt: now,
  };
}

/**
 * Create the global user profile on first sign-in — create-only, it must NEVER
 * overwrite an existing row. The transaction's read of `users/{uid}` is part of
 * the commit's optimistic-concurrency check: the exists-check no-ops when the doc
 * is already there, and if a user-initiated save (data/profile.ts) writes the doc
 * AFTER this read saw it absent, the stale read makes Firestore re-run the whole
 * function, which then re-reads the now-existing doc and no-ops. That is what
 * closes #77 — AuthContext publishes the User (and the app renders, so a fast
 * profile save can race) before this settles, so the create must not clobber a
 * save that landed first. Do NOT regress to a non-merge `setDoc`: that was the
 * original bug — it replaced the whole row with the Google-sourced defaults.
 * Pinned by src/data/auth-profile-race.test.ts.
 */
export async function ensureUserProfile(u: User): Promise<void> {
  const ref = rawUser(u.uid);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists()) return;
    tx.set(ref, bootstrapProfile(u));
  });
}

/**
 * Persist the honor-system 18+ self-attestation (ADR 0001) for a User: stamp
 * `users/{uid}.attestedAdultAt` with the ms-epoch time of their FIRST attestation.
 * This records the User's OWN statement — not identity verification — and is
 * covered by the EXISTING `users/{uid}` owner self-write (firestore.rules already
 * shape-checks `attestedAdultAt` as a number), so it ships with NO rules change.
 *
 * Create-only for the field, inside a transaction like `ensureUserProfile`: an
 * existing EARLIER stamp is NEVER overwritten, so re-attesting — a fresh sign-in
 * after a prior one, or the returning-User re-prompt — keeps the first timestamp
 * (the no-overwrite case in specs/w1-attestation.md).
 *
 * The row may be ABSENT: during first-time sign-in this transaction can win the
 * create race with `ensureUserProfile` on the not-yet-written `users/{uid}` row.
 * Writing ONLY `attestedAdultAt` then would leave a PARTIAL profile — the
 * create-only `ensureUserProfile` retry sees `exists()` and no-ops, so
 * displayName/photoURL/createdAt would be missing forever (Codex P2, PR #112). So
 * on an absent row we write the FULL `bootstrapProfile` payload `ensureUserProfile`
 * would have written PLUS the stamp (one create, the shared bootstrap shape); on a
 * PRESENT row we merge ONLY the stamp so no other field is clobbered. The
 * transaction's read makes this race-safe: a concurrent `ensureUserProfile` create
 * invalidates this attempt's read set and Firestore re-runs onto the now-present
 * row, which then takes the merge-only branch.
 */
export async function attestAdult(u: User, now: number = Date.now()): Promise<void> {
  const ref = rawUser(u.uid);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) {
      // Won the create race on an absent row — write the complete profile, not a
      // stamp-only stub, so the create-only bootstrap retry cannot strand it.
      tx.set(ref, { ...bootstrapProfile(u, now), attestedAdultAt: now });
      return;
    }
    const existing = (snap.data() as Partial<UserDoc>).attestedAdultAt;
    if (typeof existing === 'number') return; // keep the FIRST attestation, never overwrite
    tx.set(ref, { attestedAdultAt: now }, { merge: true });
  });
}

/**
 * Read a User's settled 18+ attestation for the re-prompt gate (#23): the
 * ms-epoch `attestedAdultAt` when present, else `null` for a profile that is
 * DEFINITIVELY without one (missing doc or missing field). A single point read of
 * `users/{uid}`; AuthContext calls it once per auth change AFTER `ensureUserProfile`
 * has settled the row, and treats a THROWN read (offline / permission) as UNKNOWN
 * — never a re-prompt — so only a definite `null` gates a signed-in User. An
 * UNKNOWN is not a silent stall either: AuthContext surfaces the failure through
 * its retryable deal-error panel, whose Retry re-runs this read (#112 round 2).
 */
export async function readAdultAttestation(uid: string): Promise<number | null> {
  const snap = await getDoc(rawUser(uid));
  const v = snap.exists() ? (snap.data() as Partial<UserDoc>).attestedAdultAt : undefined;
  return typeof v === 'number' ? v : null;
}

/**
 * Read a User's 18+ attestation from the PERSISTENT LOCAL CACHE only — the
 * offline-safe, render-path read for the cold-boot gate (#115). Unlike
 * `readAdultAttestation` (a server point read that offline never resolves — a
 * transaction-free `getDoc` still awaits the network round trip when the doc is
 * absent from cache), this is `getDocFromCache`: it resolves SYNCHRONOUSLY from
 * the IndexedDB cache (ADR 0006) with no network, so a returning User's already-
 * cached row settles the gate while offline.
 *
 * Returns the ms-epoch `attestedAdultAt` when the cached row carries one, or
 * `null` for a cached row that DEFINITIVELY lacks it (present-but-unstamped, or a
 * cached "not found"). It REJECTS on a genuine cache MISS (the row was never
 * fetched into this device's cache). AuthContext maps those three outcomes to the
 * knownFirstBingoAt / hasServerData tri-state discipline: a stamp settles the gate
 * TRUE offline; a definite `null` or a cache miss stays UNKNOWN (never re-prompted
 * offline, never settled `true`), so cache-first can neither block render nor fail
 * the age gate OPEN. The authoritative present/absent determination — the one that
 * can settle a definite re-prompt — comes from the server `readAdultAttestation`
 * on the online/reconnect path, never from this cache read.
 */
export async function readAdultAttestationFromCache(uid: string): Promise<number | null> {
  const snap = await getDocFromCache(rawUser(uid));
  const v = snap.exists() ? (snap.data() as Partial<UserDoc>).attestedAdultAt : undefined;
  return typeof v === 'number' ? v : null;
}

/**
 * Read a User's 18+ attestation from the SERVER ONLY — the AUTHORITY read that
 * gates the deal (Codex #117 round 6). `readAdultAttestation` above wraps `getDoc`,
 * whose Web API MAY silently RETURN CACHED DATA when the server is unreachable, so
 * it is NOT server-truth and must never establish deal authority: a stale cached
 * stamp could authorize creating board/player rows for a User whose server row no
 * longer carries the 18+ stamp. `getDocFromServer` forces a server round trip and
 * REJECTS when the server cannot be reached — so AuthContext treats a thrown read
 * as "authority NOT established" (no `attestedAuthoritative`, no deal; fall to the
 * deferred/offline path), and only a server-returned stamp (or a same-session
 * optimistic attest) authorizes the deal. The provisional offline RENDER still uses
 * the cache-first `readAdultAttestationFromCache`; only the deal-authority gate is
 * server-only.
 */
export async function readAdultAttestationFromServer(uid: string): Promise<number | null> {
  const snap = await getDocFromServer(rawUser(uid));
  const v = snap.exists() ? (snap.data() as Partial<UserDoc>).attestedAdultAt : undefined;
  return typeof v === 'number' ? v : null;
}

/**
 * True when THIS device already has the User's Event board in the persistent
 * cache — i.e. they are a RETURNING, already-boarded Player (Codex #117 round 9,
 * finding A). Cache-only (`getDocFromCache`, no network) and never rejects: a
 * genuine cache MISS (a first-time User with no board yet) resolves `false`.
 * AuthContext uses it to scope the "bootstrap failed" retryable error to the
 * BOARDLESS case: a returning User with a cached board renders it (they need no
 * deal), while a first-time User whose online bootstrap failed on an
 * optimistic-only attestation gets a Retry instead of being stranded on
 * "Dealing…".
 */
export async function hasCachedBoard(uid: string): Promise<boolean> {
  try {
    return (await getDocFromCache(rawBoard(uid))).exists();
  } catch {
    return false; // not in this device's cache → no local board
  }
}

/**
 * Deal a frozen board + create the player row the first time a user joins.
 *
 * Returns `true` when it dealt a NEW board (an actual join), `false` when the
 * board already existed and it early-returned a no-op. The caller gates the
 * `join_event` analytic on this so a reconnect that re-runs the deal for an
 * already-boarded Player records nothing (Codex #117 round 8, finding B) —
 * `runDeal` re-fires on every online/authority flip, and an existing-board no-op
 * is not a join.
 */
export async function joinAndDeal(u: User): Promise<boolean> {
  const existing = await getDoc(rawBoard(u.uid));
  if (existing.exists()) return false;

  // Denormalize the Player's SAVED identity, not the raw Google one (Codex P2
  // on PR #67, the join-side half): a Player who customized their users/{uid}
  // profile must not get their Google name/avatar re-published into the public
  // players row at join. Prefer the saved displayName, and the saved photoURL
  // only when it is a deliberate custom avatar (customPhoto) — otherwise the
  // profile photo is just a stale copy of the Google one, so the live auth
  // value wins. One extra read, join-path only (returning Players early-return
  // above), fetched alongside the pool; best-effort — a missing or unreadable
  // profile falls back to the auth values rather than blocking the deal.
  const [profileSnap, snap, eventSnap] = await Promise.all([
    getDoc(rawUser(u.uid)).catch(() => null),
    getDocs(query(itemsCol(), where('status', '==', 'active'))),
    getDoc(rawEvent()).catch(() => null),
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

  // The ADR 0004 Phase 0 community auto-hide threshold, read from the event doc so
  // a frozen card is dealt from the SAME pool a Player sees live (useItems): a
  // Prompt whose reportCount has reached a POSITIVE reportHideThreshold is hidden
  // everywhere, so it must never land on a new Player's board (Codex P2, PR #107
  // finding 1). One extra event-doc read, join-path only (returning Players
  // early-return above) and fetched in the SAME Promise.all as the pool + profile,
  // so it adds no latency. A missing/unreadable event doc, or an unset/non-positive
  // threshold, falls open to no filtering via `isReportHidden` — exactly the live
  // pool's behavior.
  const eventData = eventSnap?.exists() ? (eventSnap.data() as Partial<EventDoc>) : null;
  const threshold =
    typeof eventData?.settings?.reportHideThreshold === 'number'
      ? eventData.settings.reportHideThreshold
      : undefined;
  // The Admin ban roster (#108), read from the SAME event-doc fetch as the threshold
  // so the frozen card is dealt from the SAME pool a Player sees live (`useItems`):
  // a Prompt authored by a banned uid is hidden everywhere, so it must never land on
  // a new Player's board. A missing/unreadable event doc, or a malformed value,
  // falls open to no filtering via `isBanned` — exactly the live pool's behavior.
  const bannedUids = Array.isArray(eventData?.bannedUids) ? eventData.bannedUids : [];

  // Filter the active pool by the SAME predicates the live pool uses, AFTER the
  // status==='active' query and the free-space drop. Filtering here (before
  // dealBoard) keeps the MIN_POOL thin-pool guard honest: dealBoard needs >= 24
  // prompts AFTER the community hide AND the ban, so a pool padded past the floor by
  // heavily-reported or banned-author Prompts still fails fast rather than dealing a
  // card that hides squares the moment it renders.
  const pool: DealItem[] = snap.docs
    .map((d) => d.data())
    .filter(
      (it) =>
        !it.isFreeSpace &&
        (it.pool ?? 'main') === 'main' &&
        !isReportHidden(it.reportCount, threshold) &&
        !isBanned(it.createdBy, bannedUids),
    )
    // spicy is coerced to a strict boolean (CodeRabbit, PR #135): a legacy or
    // malformed item doc missing the field, or carrying a truthy non-boolean
    // like the string 'false', must read as tame rather than skew the
    // stratified deal.
    .map((it) => ({ id: it.id, text: it.text, spicy: it.spicy === true }));

  // The target spicy share for stratified composition (w1-seed-and-composition),
  // read defensively from the same already-fetched event doc as `threshold` above
  // — an event doc seeded before this field existed has no key to read, so
  // `dealBoard`'s own default (0.4) applies when it is absent.
  const spicyRatio =
    typeof eventData?.settings?.spicyRatio === 'number' ? eventData.settings.spicyRatio : undefined;

  const seed = seedFromUid(u.uid);
  const cells = dealBoard(pool, FREE_TEXT, seed, spicyRatio ?? 0.4);
  const now = Date.now();

  const batch = writeBatch(db);
  // dayIndex: 0 honors the now-required BoardDoc.dayIndex — today there is one
  // Board per Player per Event, read as Day 0; the day-scoped board path is #204.
  batch.set(rawBoard(u.uid), { uid: u.uid, dayIndex: 0, seed, createdAt: now, cells });
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
  return true; // dealt a NEW board — an actual join
}

/**
 * Deal a Player's Day Card for one Day, lazily, on first open at/after the Day's
 * `unlockAt` (daily-cards-spec § "Unlock mechanics"). The pool is drawn ONLY
 * from that Day's frozen `snapshotItemIds` Day Snapshot — never a live
 * `status: 'active'` query — so a Prompt approved mid-cruise can only "get in"
 * for a Day whose snapshot has not yet been stamped, never an already-dealt one.
 *
 * Returns `true` only when it dealt a NEW Day Card. It is a no-op (`false`) when:
 *   - the Day is still `locked` (`now < unlockAt`),
 *   - the Day is unlocked but its snapshot is not yet stamped (`waking` —
 *     scheduler lag; the client shows the wait state rather than dealing from an
 *     unfrozen pool), or
 *   - a Day Card already exists for this Player+Day (mirrors `joinAndDeal`'s
 *     existing-board early return; re-opening never re-deals).
 */
export async function dealDayCard(u: User, dayIndex: number): Promise<boolean> {
  const [existing, eventSnap] = await Promise.all([
    getDoc(rawDayBoard(dayIndex, u.uid)),
    getDoc(rawEvent()).catch(() => null),
  ]);
  // Existing Day Card → no-op, exactly like joinAndDeal's board-exists guard.
  if (existing.exists()) return false;

  const eventData = eventSnap?.exists() ? (eventSnap.data() as Partial<EventDoc>) : null;
  const days = Array.isArray(eventData?.days) ? (eventData.days as DayDef[]) : [];
  const day = days[dayIndex];
  // No such Day (unmigrated/out-of-range event) → nothing to deal.
  if (!day) return false;

  // The single deal gate (dayDealState): only 'ready' — unlocked AND snapshot
  // stamped — proceeds. 'locked' and 'waking' both return a no-op here; the
  // client renders the matching preview/wait state from the same helper.
  const state = dayDealState({
    unlockAt: day.unlockAt,
    snapshotItemIds: day.snapshotItemIds,
    now: Date.now(),
    hasBoard: false,
  });
  if (state !== 'ready') return false;

  const snapshotIds = day.snapshotItemIds ?? [];

  // Resolve the frozen snapshot ids to their Prompt text/spicy by reading those
  // specific item docs — NOT a live `status: 'active'` collection query. Pool
  // MEMBERSHIP is the snapshot alone; this only hydrates the text/spicy the deal
  // needs. A snapshot id whose doc is missing or is the free space is dropped.
  const itemSnaps = await Promise.all(snapshotIds.map((id) => getDoc(rawItem(id)).catch(() => null)));
  const pool: DealItem[] = itemSnaps
    .filter((s): s is NonNullable<typeof s> => !!s && s.exists())
    .map((s) => ({ id: s.id, data: s.data() as Partial<ItemDoc> }))
    .filter(({ data }) => data.isFreeSpace !== true)
    .map(({ id, data }) => ({ id, text: String(data.text ?? ''), spicy: data.spicy === true }));

  // No repeats across the cruise: exclude every Prompt already on this Player's
  // EARLIER Day Cards (daily-cards-spec § "No repeats across the cruise"). Reading
  // days 0..dayIndex-1 for this uid; `dealBoard`'s exclusion resets on its own
  // once the pool is exhausted, so we always pass the full history.
  const earlier = await Promise.all(
    Array.from({ length: dayIndex }, (_, i) => getDoc(rawDayBoard(i, u.uid)).catch(() => null)),
  );
  const excludeIds = new Set<string>();
  for (const snap of earlier) {
    if (!snap || !snap.exists()) continue;
    const cells = (snap.data() as { cells?: Cell[] }).cells ?? [];
    for (const c of cells) if (c.itemId) excludeIds.add(c.itemId);
  }

  // Tutorial pools (embark/farewell) are seeded all-tame → deal unstratified so
  // no spicy target is forced against an all-tame snapshot. Main days keep the
  // event's stratified spicy share.
  const stratify = day.pool === 'main';
  const spicyRatio =
    typeof eventData?.settings?.spicyRatio === 'number' ? eventData.settings.spicyRatio : 0.4;

  // Per-Day seed: mix the Player's stable seed with the Day index so each Day
  // Card has its own deterministic layout rather than repeating Day 0's.
  const seed = (seedFromUid(u.uid) ^ Math.imul(dayIndex + 1, 0x9e3779b1)) >>> 0;
  const cells = dealBoard(pool, day.freeText ?? FREE_TEXT, seed, spicyRatio, {
    excludeIds,
    stratify,
  });
  const now = Date.now();

  const batch = writeBatch(db);
  batch.set(rawDayBoard(dayIndex, u.uid), { uid: u.uid, dayIndex, seed, createdAt: now, cells });
  // Seed this Day's per-Day stat bucket (players/{uid}.dayStats[dayIndex]) so the
  // cruise-wide aggregates and the per-Day breakdown share one shape; the Mark
  // path folds real progress in later.
  batch.set(
    rawPlayer(u.uid),
    { dayStats: { [dayIndex]: { bingoCount: 0, squaresMarked: 0, firstBingoAt: null } } },
    { merge: true },
  );
  await batch.commit();
  return true; // dealt a NEW Day Card
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
  // The win TRANSITION this mark crossed — the synchronous verdict the Feed
  // Moment broadcast rides (issue #104). `bingo`/`blackout` above are the
  // STANDING state (a bingo/blackout holds NOW); these are the EDGE (this mark
  // newly COMPLETED one). `bingoTransition` is a no-bingo → bingo crossing
  // (`previousBingoCount === 0 && bingoCount > 0`); `blackoutTransition` is a
  // not-blackout → blackout crossing. An unmark can only remove a line, so it
  // never sets either. doMark broadcasts the per-Player bingo/blackout Moment
  // from THESE (not from snapshot diffing), so a broadcast is tied to the mark
  // that caused the win rather than to a component-lifetime edge ref that dies
  // on unmount (the #104 fix). Computed here — inside the folded next-state — so
  // the write path is the single source of truth for "this mark won".
  bingoTransition: boolean;
  blackoutTransition: boolean;
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
    // The rising edges, derived from the SAME folded state (no extra scan of a
    // caller-held snapshot): a bingo transition needs the prior board to hold no
    // line and this fold to hold one; a blackout transition needs the prior
    // board to be not-full and this fold to be full. `nextMarked` need not be
    // checked — an unmark can only reduce the mask, so neither count/mask can
    // rise on it.
    bingoTransition: previousBingoCount === 0 && bingoCount > 0,
    blackoutTransition: blackout && !isBlackout(cells),
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

// The shared marker-attribution helper (`markerDisplayName`) lives in the
// Firestore-free ./attribution module so proofs.ts can share it without
// pulling this file's firebase/firestore import surface into its tests
// (Codex P2, PR #87 round 2).

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
}): Promise<{
  cells: Cell[];
  bingo: boolean;
  blackout: boolean;
  bingoTransition: boolean;
  blackoutTransition: boolean;
}> {
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
): Promise<{
  cells: Cell[];
  bingo: boolean;
  blackout: boolean;
  bingoTransition: boolean;
  blackoutTransition: boolean;
}> {
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
  const { cells, player, bingo, blackout, bingoTransition, blackoutTransition } = computeMark({
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

  // The transition verdict rides back to doMark synchronously (from the local
  // fold above, computed BEFORE the fire-and-forget commit), which broadcasts
  // the matching Feed Moment off it — the win is tied to the mark that caused
  // it, not to a Board snapshot-diff that dies on unmount (issue #104).
  return { cells, bingo, blackout, bingoTransition, blackoutTransition };
}

// --- Phase 0 client-side rate limiting (add / report a Prompt, #28) ---
//
// No Cloud Functions exist yet (ADR 0004's Phase 0 posture), so this guard is
// CLIENT-SIDE and PRESENTATIONAL ONLY — it throttles the honest common case
// (a double-tap, a fast re-submit) so the pool doesn't get spammed by an
// enthusiastic or fat-fingered Player. It is trivially bypassable by a
// motivated caller (a second tab, a raw network call) and is NOT a security
// boundary; server-authoritative rate limiting (a Function or rules-enforced
// quota) is a Phase 1 concern — the same deferral ADR 0004 makes for the
// reactive-moderation hide. Module-scope state is fine for a client-only
// guard, same as `markChains` above — `Date.now()` is allowed in app code.
// Keyed by a caller-supplied string (`ItemPool.tsx` keys by
// `${action}:${uid}`) rather than one global bucket, so two different
// signed-in identities sharing a browser never share a throttle window.
export const ITEM_RATE_LIMIT_MS = 3_000;
const lastItemActionAt = new Map<string, number>();

/**
 * True when `key` last succeeded more than `ITEM_RATE_LIMIT_MS` ago (or
 * never) — and, in that case ONLY, stamps `now` as the new last-fired time so
 * a call inside the window is judged against that SAME stamp rather than
 * resetting its own clock (which would let a fast-enough drip of attempts
 * dodge the limit forever). Call once per user action, before the guarded
 * write — see the `addItem`/`reportItem` doc comments below for why the
 * write functions themselves never also call this.
 */
export function checkItemRateLimit(key: string, now: number = Date.now()): boolean {
  const last = lastItemActionAt.get(key);
  if (last !== undefined && now - last < ITEM_RATE_LIMIT_MS) return false;
  lastItemActionAt.set(key, now);
  return true;
}

/**
 * Milliseconds remaining until `key` will next satisfy `checkItemRateLimit`
 * — i.e., until `ITEM_RATE_LIMIT_MS` has elapsed since `key`'s last
 * SUCCESSFUL action — or `0` when there is no wait (no prior success, or the
 * window has already elapsed). Read-only: unlike `checkItemRateLimit`, this
 * never stamps `lastItemActionAt`, so a caller can call it on every blocked
 * attempt without itself consuming or resetting the window.
 *
 * `ItemPool.tsx` calls this the moment a blocked attempt lands, to arm its
 * disabled-timer for the ACTUAL time left rather than re-arming a full
 * `ITEM_RATE_LIMIT_MS` window on every blocked attempt. The guard's own
 * window is anchored to the last SUCCESSFUL call (a blocked call never moves
 * `last` — see above), so a retry late in the window (say, 2.9s into a 3s
 * window) has only ~100ms left; re-arming a full window from THAT retry
 * would keep the control disabled long after `checkItemRateLimit` itself
 * would allow the next attempt (Codex P2, PR #92).
 */
export function itemRateLimitRemainingMs(key: string, now: number = Date.now()): number {
  const last = lastItemActionAt.get(key);
  if (last === undefined) return 0;
  const remaining = ITEM_RATE_LIMIT_MS - (now - last);
  return remaining > 0 ? remaining : 0;
}

/**
 * Add a prompt to the community pool.
 *
 * No rate limit is enforced HERE — the caller (`ItemPool.tsx`) checks
 * `checkItemRateLimit` before invoking this, so the guard lives at the one
 * real call site rather than inside the write itself (checking again in here
 * would consume the SAME window a second time and silently drop the write
 * the caller's own check just approved).
 *
 * `spicy` defaults to `false`: a user-added Prompt is tame unless the ItemPool
 * 🔞 toggle was checked when they submitted it.
 */
export async function addItem(uid: string, text: string, spicy = false): Promise<void> {
  const t = text.trim();
  if (!t) return;
  await addDoc(rawItems(), {
    text: t.slice(0, 80),
    createdBy: uid,
    createdAt: Date.now(),
    isFreeSpace: false,
    // Phase 1.5 approval flow (daily-cards-spec § "Item pools and the approval
    // flow", #210): a main-pool player submission now lands `pending`, invisible
    // everywhere except the Admin Approvals queue and (as "pending review") its
    // own submitter, until an admin approves (→ 'active') or rejects it. Curated
    // pools (embark/farewell) are seeded/edited by admins directly — this path is
    // the main pool's ONLY writer, so it is the only one the gate applies to.
    status: 'pending',
    reportCount: 0,
    spicy,
    // Honor the now-required ItemDoc.pool: a player prompt-submission lands in
    // the main game pool. Embark/farewell pools are seeded directly (#207).
    pool: 'main',
  });
}

/**
 * Report a prompt (increments the report counter; auto-hide handled by
 * admin/threshold). Same rate-limit posture as `addItem` above — throttled by
 * the caller, not in here.
 */
export async function reportItem(id: string): Promise<void> {
  await updateDoc(rawItem(id), { reportCount: increment(1) });
}

/** Let a player set a display theme preference on their player row. */
export async function savePlayerTheme(uid: string, theme: string): Promise<void> {
  await setDoc(rawPlayer(uid), { theme }, { merge: true });
}

/**
 * Clear a player's saved cross-device theme pick (More menu § "Theme" —
 * picking Auto). Without this, `players/{uid}.theme` keeps the last concrete
 * pick, so `ThemeProvider`'s cross-device-adopt effect re-applies it on the
 * next load/device and Auto silently stops following the day (Codex P2 on
 * #232). Deletes the field rather than writing a sentinel so a stale reader
 * never mistakes "explicitly cleared" for a real ThemeId.
 */
export async function clearPlayerTheme(uid: string): Promise<void> {
  await setDoc(rawPlayer(uid), { theme: deleteField() }, { merge: true });
}
