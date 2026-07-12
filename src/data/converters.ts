import type {
  FirestoreDataConverter,
  QueryDocumentSnapshot,
  DocumentData,
} from 'firebase/firestore';
import type {
  ClaimMode,
  EventDoc,
  ItemDoc,
  BoardDoc,
  PlayerDoc,
  UserDoc,
  ProofDoc,
  ClaimDoc,
  TallyEntry,
  MomentDoc,
  DoubtDoc,
  DayMetaDoc,
} from '../types';

function passthrough<T>(): FirestoreDataConverter<T> {
  return {
    toFirestore: (data) => data as DocumentData,
    fromFirestore: (snap: QueryDocumentSnapshot) => snap.data() as T,
  };
}

/**
 * Resolve a persisted Claim Mode to the current contract. Events seeded or
 * written before the rename persist the pre-rename value for what is now
 * `admin_confirmed`; coerce it on read so existing docs keep working. Unknown
 * or missing values fall back to the least-friction default, `honor`. Writes
 * only ever emit a current `ClaimMode` — the type no longer admits the old one.
 */
export function migrateClaimMode(raw: unknown): ClaimMode {
  if (raw === 'admin_confirmed' || raw === 'verified') return 'admin_confirmed';
  if (raw === 'honor' || raw === 'proof_required') return raw;
  return 'honor';
}

// The July sailing's zone — the default a missing or invalid `timezone` field
// resolves to so day-scheduling consumers always read a real IANA zone.
const DEFAULT_TIMEZONE = 'Europe/Rome';

/**
 * Resolve a persisted `timezone` to a usable IANA zone. A legacy Event doc
 * (seeded before Phase 1.5) carries no field; a malformed one can carry '',
 * whitespace, a non-string, or a bogus id like 'Mars/Olympus'. The contract is
 * a *real named IANA zone* — not an offset id ('+02:00', 'Etc/GMT+5') or a
 * bare abbreviation ('EST'), which some runtimes' `Intl.DateTimeFormat` will
 * happily accept even though day-scheduling consumers expect a canonical zone.
 *
 * Validate/canonicalize with `Intl.DateTimeFormat` after explicitly rejecting
 * offset-style ids, GMT/UTC/Etc zones, and separator-less abbreviations.
 * `supportedValuesOf('timeZone')` is not enough by itself because runtimes can
 * accept still-valid IANA aliases (for example Europe/Kyiv) while listing only
 * the runtime's canonical spelling. Anything that fails resolves to
 * `Europe/Rome`.
 */
export function normalizeTimezone(raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim() === '') return DEFAULT_TIMEZONE;
  const tz = raw.trim();

  if (
    /^[+-]\d/.test(tz) ||
    /GMT|UTC|Etc\//i.test(tz) ||
    !tz.includes('/')
  ) {
    return DEFAULT_TIMEZONE;
  }
  try {
    const canonical = new Intl.DateTimeFormat('en-US', { timeZone: tz }).resolvedOptions().timeZone;
    return canonical.includes('/') && !/GMT|UTC|Etc\//i.test(canonical)
      ? canonical
      : DEFAULT_TIMEZONE;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

// Events read through the Claim Mode migration so a pre-rename persisted value
// (seeded or in-flight docs) resolves to the current contract; every other field
// passes through untouched.
export const eventConverter: FirestoreDataConverter<EventDoc> = {
  toFirestore: (data) => data as DocumentData,
  fromFirestore: (snap: QueryDocumentSnapshot) => {
    const data = snap.data() as EventDoc;
    return {
      ...data,
      claimMode: migrateClaimMode(data.claimMode),
      // Event docs seeded/written before #113 carry no `bannedUids`; default a
      // missing (or malformed non-array) field to [] so consumers read the
      // presentational hide/mute roster (ADR 0004 Phase 0) as [] rather than
      // undefined. Writes only ever emit a real array.
      bannedUids: Array.isArray(data.bannedUids) ? data.bannedUids : [],
      // Event docs seeded/written before Phase 1.5 carry no `days`/`timezone`.
      // Default a missing (or malformed non-array) `days` to [] and resolve a
      // missing/empty/invalid `timezone` to a real IANA zone ('Europe/Rome',
      // the July sailing's zone) via `normalizeTimezone` so day-scheduling
      // consumers read a real schedule/zone rather than undefined and a
      // not-yet-migrated doc never throws downstream (daily-cards-spec §
      // "Migration"). Writes only ever emit real values.
      days: Array.isArray(data.days) ? data.days : [],
      timezone: normalizeTimezone(data.timezone),
      // `frozenAt` (the finale freeze stamp, #217) needs no default: it is
      // optional and absent until the 08:00-Day-10 scheduler run sets it, so a
      // pre-finale/legacy Event doc reads it through the spread above as
      // `undefined` (unset), exactly the pre-freeze state consumers branch on.
    };
  },
};
// Boards read through a `dayIndex` default so a legacy/current Board (written
// before the day-scoped path #204 exists, one Board per Player per Event) reads
// as Day 0 rather than `undefined`, which day-aware consumers would branch on.
// The write side stamps `dayIndex: 0` too; a real day-scoped write emits its own.
export const boardConverter: FirestoreDataConverter<BoardDoc> = {
  toFirestore: (data) => data as DocumentData,
  fromFirestore: (snap: QueryDocumentSnapshot) => {
    const data = snap.data() as BoardDoc;
    return {
      ...data,
      dayIndex: typeof data.dayIndex === 'number' ? data.dayIndex : 0,
    };
  },
};
export const playerConverter = passthrough<PlayerDoc>();
export const userConverter = passthrough<UserDoc>();

// Items carry their doc id (used as the stable key when dealing boards).
export const itemConverter: FirestoreDataConverter<ItemDoc> = {
  toFirestore: (data) => data as DocumentData,
  fromFirestore: (snap: QueryDocumentSnapshot) => {
    const data = snap.data() as Omit<ItemDoc, 'id'>;
    return {
      ...data,
      id: snap.id,
      // Items seeded/written before Phase 1.5 carry no `pool`; default a missing
      // field to 'main' (mirrors the `bannedUids` default above) so existing
      // Prompts read as main-pool without a data backfill (daily-cards-spec §
      // "Migration"). Writes only ever emit a real pool.
      pool: data.pool ?? 'main',
    };
  },
};

export const proofConverter: FirestoreDataConverter<ProofDoc> = {
  toFirestore: (data) => data as DocumentData,
  fromFirestore: (snap: QueryDocumentSnapshot) => ({
    ...(snap.data() as Omit<ProofDoc, 'id'>),
    id: snap.id,
  }),
};

export const claimConverter: FirestoreDataConverter<ClaimDoc> = {
  toFirestore: (data) => data as DocumentData,
  fromFirestore: (snap: QueryDocumentSnapshot) => ({
    ...(snap.data() as Omit<ClaimDoc, 'id'>),
    id: snap.id,
  }),
};

// A Feed Moment (ADR 0002): a broadcast BINGO / Blackout / First-to-BINGO beat,
// read from events/{EVENT_ID}/moments/{momentId}. Like proofs/claims it carries
// its own doc id (the Feed keys on it), so pin `id` to `snap.id`. The write side
// (src/data/moments.ts) never stores media or a proofId — a Moment marks *that*
// something happened, not what it looked like.
export const momentConverter: FirestoreDataConverter<MomentDoc> = {
  toFirestore: (data) => data as DocumentData,
  fromFirestore: (snap: QueryDocumentSnapshot) => ({
    ...(snap.data() as Omit<MomentDoc, 'id'>),
    id: snap.id,
  }),
};

// A per-Prompt Tally marker (ADR 0002): one Player's attributed entry in a
// Prompt's Tally, read from events/{EVENT_ID}/tally/{itemId}/markers/{uid}. The
// doc id IS the marker's uid (firestore.rules keys the self-write on it — a
// forgery-deniable attribution), so pin `uid` to `snap.id` rather than trusting
// the stored field. This is the read side of the count + tap-to-see-who list.
export const tallyMarkerConverter: FirestoreDataConverter<TallyEntry> = {
  toFirestore: (data) => data as DocumentData,
  fromFirestore: (snap: QueryDocumentSnapshot) => ({
    ...(snap.data() as Omit<TallyEntry, 'uid'>),
    uid: snap.id,
  }),
};

// A Doubt (ADR 0001): one Player publicly asking another to back up a marked
// Prompt — "pics or it didn't happen", social pressure never a gate — read from
// events/{EVENT_ID}/doubts/{doubtId}. Like proofs/claims/moments it carries its
// own doc id (the read hook + derivation key on it), so pin `id` to `snap.id`.
// The write side (src/data/doubts.ts) uses a raw ref and never stores `id`.
export const doubtConverter: FirestoreDataConverter<DoubtDoc> = {
  toFirestore: (data) => data as DocumentData,
  fromFirestore: (snap: QueryDocumentSnapshot) => ({
    ...(snap.data() as Omit<DoubtDoc, 'id'>),
    id: snap.id,
  }),
};

// A per-Day honor doc (daily-cards-spec § "Data model"), read from
// events/{EVENT_ID}/days/{dayIndex}/meta/{dayIndex} — a `meta` subcollection
// whose single document id IS the encoded dayIndex (a valid document path).
// Passthrough — no `id` to pin, because the doc id is that path-encoded
// dayIndex (the reading ticket, #212, owns the path helper). Holds that Day's
// own First to BINGO.
export const dayMetaConverter = passthrough<DayMetaDoc>();
