/**
 * Phase 1.5 daily scheduler core (issue #202, daily-cards-spec § "Unlock
 * mechanics" / "Security rules and functions (shape only)" / "Scoring and social
 * surfaces"). Owns the scheduled TRIGGERS and the snapshot / freeze WRITES only:
 *
 *   1. Snapshot at unlock — for every Day whose `unlockAt` has passed and which
 *      carries no `snapshotItemIds` yet, stamp the Day with the ids of every
 *      `status: 'active'` item in that Day's pool at that moment. Idempotent: a
 *      Day that already carries a snapshot (even an empty one) is never
 *      re-stamped, so retries and a second same-day run are no-ops.
 *   2. The finale two-beat finish — at 20:00 on Day 9 post exactly one
 *      `last_call` Moment (frozenAt untouched); at 08:00 on Day 10 (the farewell
 *      Day's `unlockAt`) set `EventDoc.frozenAt` and post exactly one `podium`
 *      Moment. The standings / podium CONTENT is #212 / #217; these Moments carry
 *      only the minimal payload those tickets render.
 *   3. A manual admin "unlock now" fallback (`manualUnlockNow`) that forces the
 *      SAME idempotent snapshot for one Day on demand, so function lag / failure
 *      can never leave a Day dealing from an unfrozen pool — and can never
 *      diverge from the scheduled path's semantics.
 *
 * Every decision is a pure, injectable function so the whole flow is unit-testable
 * without a Functions runtime (mirrors `autohide.ts`'s split between decision
 * logic and the thin `index.ts` trigger seam). The Firestore surface is passed in
 * — this module imports no `firebase-admin` / `firebase-functions`, so it never
 * touches a live backend under test. Best-effort throughout: a single Day or beat
 * failing is logged and skipped, never crashing the scheduled run (ADR 0001;
 * mirrors `autohide.ts` / `notify.ts`).
 */

// --- Minimal domain shapes (local, so this module stays decoupled from the app
// package — mirrors autohide.ts's ReportableDoc approach). --------------------

/** The subset of a `DayDef` the scheduler reads/writes. */
export interface DayLike {
  index: number;
  pool: string; // 'main' | 'embark' | 'farewell'
  unlockAt: number; // ms epoch
  snapshotItemIds?: string[];
}

/** The subset of an `EventDoc` the scheduler reads. */
export interface EventLike {
  days?: DayLike[];
  frozenAt?: number | null;
  admins?: string[];
}

/** The finale Moment kinds this ticket posts. */
export type FinaleMomentKind = 'last_call' | 'podium';

// --- Pure decisions -------------------------------------------------------------

/**
 * A Day is due for a snapshot iff its `unlockAt` has passed AND it carries no
 * snapshot yet. `snapshotItemIds == null` (absent/undefined) is the ONLY
 * unstamped state: an empty array `[]` is a valid stamp (a Day whose pool had no
 * active items at unlock) and must NOT be re-stamped — that is the idempotency
 * guarantee.
 */
export function isDueForSnapshot(day: DayLike, now: number): boolean {
  return day.unlockAt <= now && day.snapshotItemIds == null;
}

/** The Days due for a snapshot at `now`, in schedule order. */
export function daysDueForSnapshot(days: DayLike[], now: number): DayLike[] {
  return days.filter((d) => isDueForSnapshot(d, now));
}

/**
 * The ids that make up a Day's snapshot: every `status: 'active'` item in that
 * Day's pool. Items are pre-filtered to `active` by the query; this applies the
 * pool split, defaulting a missing `pool` to `'main'` so legacy (pre-Phase-1.5)
 * active items — which carry no `pool` field and are read as `'main'` by
 * `itemConverter` — are correctly included in a main-pool snapshot.
 */
export function activeSnapshotIds(items: Array<{ id: string; pool?: string }>, pool: string): string[] {
  return items.filter((it) => (it.pool ?? 'main') === pool).map((it) => it.id);
}

/** 20:00 Day 9 sits 12h after Day 9's 08:00 `unlockAt`; 08:00 Day 10 → freeze. */
export const LAST_CALL_LEAD_MS = 12 * 60 * 60 * 1000;

export interface FinaleTimes {
  lastCallAt: number;
  farewellUnlockAt: number;
  lastCallDayIndex: number;
  podiumDayIndex: number;
}

/**
 * Resolve the finale clock boundaries from the Day schedule. The farewell Day
 * (pool `'farewell'`, Day 10) anchors the freeze/podium at its own `unlockAt`
 * (08:00 disembark morning, the standard rule). The last-call beat is Day 9's
 * 08:00 `unlockAt` + 12h = 20:00 Day 9 (a same-day forward offset, so no
 * midnight/DST cross); if Day 9 is somehow absent it falls back to
 * `farewellUnlockAt - 12h` (the 08:00→08:00 gap less the last night). Returns
 * `null` when there is no farewell Day (a non-Phase-1.5 event), so callers skip
 * the finale entirely. DST caveat: the 12h wall gap assumes the sailing window
 * does not cross a Europe/Rome DST switch — true for this event; the 20:00 cron
 * lands inside `[lastCallAt, farewellUnlockAt)` under standard time.
 */
export function finaleTimes(days: DayLike[]): FinaleTimes | null {
  const farewell = days.find((d) => d.pool === 'farewell');
  if (!farewell) return null;
  const dayNine = days.find((d) => d.index === farewell.index - 1);
  const lastCallAt = dayNine ? dayNine.unlockAt + LAST_CALL_LEAD_MS : farewell.unlockAt - LAST_CALL_LEAD_MS;
  return {
    lastCallAt,
    farewellUnlockAt: farewell.unlockAt,
    lastCallDayIndex: farewell.index - 1,
    podiumDayIndex: farewell.index,
  };
}

export interface FinaleDecision {
  postLastCall: boolean;
  freezeAndPodium: boolean;
}

/**
 * Given the finale boundaries, `now`, and the current state (`frozenAt`, whether
 * a `last_call` Moment already exists), decide which beats fire:
 *
 *   - `postLastCall`: `now` is in `[lastCallAt, farewellUnlockAt)` and no
 *     last-call Moment exists yet. The upper bound means once the freeze time
 *     arrives the podium supersedes it (never both in one run); the
 *     already-posted guard makes a same-window retry a no-op.
 *   - `freezeAndPodium`: `now` has reached the farewell unlock and the event is
 *     not yet frozen. The actual freeze is a transactional flip of `frozenAt`, so
 *     exactly the run that wins the flip posts the single podium Moment.
 */
export function finaleActions(
  times: FinaleTimes,
  now: number,
  state: { frozenAt?: number | null; lastCallPosted: boolean },
): FinaleDecision {
  return {
    postLastCall: now >= times.lastCallAt && now < times.farewellUnlockAt && !state.lastCallPosted,
    freezeAndPodium: now >= times.farewellUnlockAt && state.frozenAt == null,
  };
}

/** An event admin is any uid on the event's `admins` roster (mirrors `isAdmin` in firestore.rules). */
export function isEventAdmin(event: EventLike | undefined, uid: string | undefined): boolean {
  return !!uid && Array.isArray(event?.admins) && event.admins.includes(uid);
}

/** Thrown by `manualUnlockNow` for a non-admin caller; mapped to an HttpsError at the trigger seam. */
export class UnlockPermissionError extends Error {}

// --- Injectable admin-SDK Firestore surface (minimal) ---------------------------

interface DocSnapshot {
  readonly exists: boolean;
  readonly id: string;
  data(): Record<string, unknown> | undefined;
}
interface DocRef {
  get(): Promise<DocSnapshot>;
  set(data: Record<string, unknown>): Promise<unknown>;
}
interface QueryRef {
  where(field: string, op: string, value: unknown): QueryRef;
  get(): Promise<{ docs: DocSnapshot[] }>;
}
interface CollectionRef extends QueryRef {
  doc(id?: string): DocRef;
}
interface Transaction {
  get(ref: DocRef): Promise<DocSnapshot>;
  update(ref: DocRef, data: Record<string, unknown>): void;
}
/** The minimal admin-SDK Firestore surface the scheduler uses. */
export interface AdminFirestore {
  doc(path: string): DocRef;
  collection(path: string): CollectionRef;
  runTransaction<T>(updateFunction: (tx: Transaction) => Promise<T>): Promise<T>;
}

export type SnapshotResult = 'stamped' | 'already-stamped' | 'not-due' | 'no-event' | 'no-day';

export interface UnlockDeps {
  /** Current time; defaults to `Date.now`. */
  now?: () => number;
}

async function queryActiveItems(db: AdminFirestore, eventId: string): Promise<Array<{ id: string; pool?: string }>> {
  const snap = await db.collection(`events/${eventId}/items`).where('status', '==', 'active').get();
  return snap.docs.map((d) => ({ id: d.id, pool: d.data()?.pool as string | undefined }));
}

async function hasMoment(db: AdminFirestore, eventId: string, kind: FinaleMomentKind): Promise<boolean> {
  const snap = await db.collection(`events/${eventId}/moments`).where('kind', '==', kind).get();
  return snap.docs.length > 0;
}

async function postFinaleMoment(
  db: AdminFirestore,
  eventId: string,
  kind: FinaleMomentKind,
  dayIndex: number,
  now: number,
): Promise<void> {
  // Minimal, scheduler-posted payload: the standings / podium CONTENT is #212 /
  // #217, which read this beat by `kind` + `dayIndex`. No human author — a
  // `system` uid keeps the MomentDoc shape intact without impersonating a Player.
  await db.collection(`events/${eventId}/moments`).doc().set({
    kind,
    uid: 'system',
    displayName: '',
    photoURL: null,
    createdAt: now,
    dayIndex,
  });
}

// --- Snapshot stamping ----------------------------------------------------------

/**
 * Idempotently stamp one Day's `snapshotItemIds`. Reads the event, locates the
 * Day by its `index`, and — if the Day is due (`unlockAt` passed) and unstamped —
 * queries the Day's active pool items, then writes the snapshot inside a
 * transaction that RE-CONFIRMS the Day is still unstamped and still due (a
 * concurrent run or the manual path may have won the race). Returns what it did.
 * The item query runs before the transaction (mirrors `autohide.ts`); the
 * transactional re-read is the idempotency guard, not the query.
 */
export async function stampDaySnapshot(
  db: AdminFirestore,
  eventId: string,
  dayIndex: number,
  deps: UnlockDeps = {},
): Promise<SnapshotResult> {
  const now = (deps.now ?? Date.now)();
  const eventRef = db.doc(`events/${eventId}`);
  const pre = (await eventRef.get()).data() as EventLike | undefined;
  if (!pre) return 'no-event';
  const days = Array.isArray(pre.days) ? pre.days : [];
  const day = days.find((d) => d.index === dayIndex);
  if (!day) return 'no-day';
  if (day.unlockAt > now) return 'not-due';
  if (day.snapshotItemIds != null) return 'already-stamped';

  const items = await queryActiveItems(db, eventId);
  const snapshotItemIds = activeSnapshotIds(items, day.pool);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(eventRef);
    const ev = snap.data() as EventLike | undefined;
    if (!ev) return 'no-event';
    const arr = Array.isArray(ev.days) ? [...ev.days] : [];
    const i = arr.findIndex((d) => d.index === dayIndex);
    if (i < 0) return 'no-day';
    if (arr[i].unlockAt > now) return 'not-due';
    if (arr[i].snapshotItemIds != null) return 'already-stamped'; // re-confirm: never overwrite an existing snapshot
    arr[i] = { ...arr[i], snapshotItemIds };
    tx.update(eventRef, { days: arr });
    return 'stamped';
  });
}

/**
 * Transactionally set `frozenAt` iff it is not already set. Exactly-once: only
 * the run that flips it from unset returns `true` (and therefore posts the single
 * podium Moment), so a retry or a racing run no-ops.
 */
async function freezeStandings(db: AdminFirestore, eventId: string, now: number): Promise<boolean> {
  const eventRef = db.doc(`events/${eventId}`);
  return db.runTransaction(async (tx) => {
    const ev = (await tx.get(eventRef)).data() as EventLike | undefined;
    if (!ev || ev.frozenAt != null) return false;
    tx.update(eventRef, { frozenAt: now });
    return true;
  });
}

// --- Finale beats ---------------------------------------------------------------

/**
 * Run the finale two-beat check for one event. Best-effort: each beat is
 * independently try/caught so one failing (e.g. a Moment write) never blocks the
 * other or crashes the run. Guards make it safe to call on any day and any number
 * of times — a non-finale day, or a re-run, simply posts nothing.
 */
export async function runFinaleBeats(db: AdminFirestore, eventId: string, deps: UnlockDeps = {}): Promise<void> {
  const now = (deps.now ?? Date.now)();
  const event = (await db.doc(`events/${eventId}`).get()).data() as EventLike | undefined;
  if (!event) return;
  const times = finaleTimes(Array.isArray(event.days) ? event.days : []);
  if (!times) return;

  const lastCallPosted = await hasMoment(db, eventId, 'last_call');
  const { postLastCall, freezeAndPodium } = finaleActions(times, now, {
    frozenAt: event.frozenAt,
    lastCallPosted,
  });

  if (postLastCall) {
    try {
      await postFinaleMoment(db, eventId, 'last_call', times.lastCallDayIndex, now);
    } catch (err) {
      console.error('runFinaleBeats: last_call post failed', eventId, err);
    }
  }
  if (freezeAndPodium) {
    try {
      // Freeze first; only the run that wins the frozenAt flip posts the podium,
      // so the podium Moment is exactly-once even if freeze + podium race.
      if (await freezeStandings(db, eventId, now)) {
        await postFinaleMoment(db, eventId, 'podium', times.podiumDayIndex, now);
      }
    } catch (err) {
      console.error('runFinaleBeats: freeze/podium failed', eventId, err);
    }
  }
}

// --- Orchestration --------------------------------------------------------------

/**
 * One scheduled sweep for one event: stamp every due Day's snapshot (each
 * best-effort, so one Day failing never blocks the rest), then run the finale
 * beats. Returns how many Days it stamped on this run. The scheduled trigger in
 * `index.ts` calls this per active event.
 */
export async function runScheduledUnlock(
  db: AdminFirestore,
  eventId: string,
  deps: UnlockDeps = {},
): Promise<{ stamped: number }> {
  const now = (deps.now ?? Date.now)();
  const event = (await db.doc(`events/${eventId}`).get()).data() as EventLike | undefined;
  if (!event) return { stamped: 0 };
  const days = Array.isArray(event.days) ? event.days : [];
  let stamped = 0;
  for (const day of daysDueForSnapshot(days, now)) {
    try {
      if ((await stampDaySnapshot(db, eventId, day.index, deps)) === 'stamped') stamped++;
    } catch (err) {
      console.error('runScheduledUnlock: stampDaySnapshot failed', eventId, day.index, err);
    }
  }
  await runFinaleBeats(db, eventId, deps);
  return { stamped };
}

/**
 * The manual admin "unlock now" fallback: force the SAME idempotent snapshot for
 * one Day on demand (function lag / failure). Denies a non-admin caller by
 * throwing `UnlockPermissionError`; on success runs the identical
 * `stampDaySnapshot` the scheduled path uses, so the two can never diverge.
 */
export async function manualUnlockNow(
  db: AdminFirestore,
  callerUid: string | undefined,
  eventId: string,
  dayIndex: number,
  deps: UnlockDeps = {},
): Promise<SnapshotResult> {
  const event = (await db.doc(`events/${eventId}`).get()).data() as EventLike | undefined;
  if (!isEventAdmin(event, callerUid)) {
    throw new UnlockPermissionError('Only an event admin can unlock a Day.');
  }
  return stampDaySnapshot(db, eventId, dayIndex, deps);
}
