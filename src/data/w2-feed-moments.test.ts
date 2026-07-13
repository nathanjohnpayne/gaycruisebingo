import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MomentDoc, MomentKind, ProofDoc } from '../types';

// specs/w2-feed-moments.md, unit layer. Two Feed halves proven here:
//
// 1. The Moment WRITER (src/data/moments.ts): a first BINGO broadcasts exactly ONE
//    `bingo` Moment, a Blackout exactly one `blackout`, First-to-BINGO exactly one
//    `first_bingo` — each a single offline-queueable setDoc (never addDoc/
//    runTransaction), carrying EXACTLY the MomentDoc fields (ADR 0002: no media,
//    no proofId), attributed + bounded like a Tally marker. Every write goes
//    through the write-once cache pre-check (round 3 finding C): a Moment already
//    in the LOCAL cache is skipped entirely so an optimistic duplicate can never
//    overwrite its own doc and reorder the Feed until the server denies it. The
//    deterministic doc id (per-Player `${uid}-bingo`/`-blackout`; event-singleton
//    `first_bingo`) is what makes the once-only structural — the rules half is
//    tests/rules/w2-feed-moments.test.ts.
// 2. The Feed MERGE (mergeFeed in src/hooks/useData.ts): Proofs + Moments fold into
//    one newest-first, capped stream; a bare Mark (neither a Proof nor a Moment)
//    contributes nothing.

const EVENT_ID = 'med-2026'; // src/firebase.ts default when VITE_EVENT_ID is unset

// Plain vi.fn() so `.mock.calls` stays loosely typed (indexable) like the sibling
// tally suite; the resolved Promise (moments.ts does `setDoc(...).catch(...)`) is
// set in beforeEach so a re-broadcast's .catch has something to attach to.
const { setDocSpy, getDocFromCacheSpy } = vi.hoisted(() => ({
  setDocSpy: vi.fn(),
  getDocFromCacheSpy: vi.fn(),
}));

vi.mock('../firebase', () => ({ db: {}, EVENT_ID: 'med-2026' }));
vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return {
    ...actual,
    doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
    setDoc: setDocSpy,
    getDocFromCache: getDocFromCacheSpy,
    addDoc: vi.fn(),
    runTransaction: vi.fn(),
  };
});

import {
  broadcastBingo,
  broadcastBlackout,
  broadcastFirstBingo,
  hasPriorBingoWitness,
  FIRST_BINGO_MOMENT_ID,
  enqueueWinMoments,
  enqueueFirstBingoMoment,
  peekPendingMoments,
  pendingBlackoutDayIndexes,
  removePendingBlackoutDay,
  clearPendingMoment,
  dropPendingWins,
  pendingActionGeneration,
  firstBingoCandidateCurrent,
  resetPendingMoments,
} from './moments';
import { hasCanonicalMomentId, mergeFeed } from '../hooks/useData';
import { addDoc, runTransaction } from 'firebase/firestore';

// Drain the write-once pre-check's microtasks (getDocFromCache → setDoc): the
// broadcasts stay fire-and-forget, so assertions settle the queue first.
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.clearAllMocks();
  setDocSpy.mockResolvedValue(undefined);
  // Cache-miss default: getDocFromCache REJECTS when the doc is not cached, which
  // is the fresh-state norm — the write-once pre-check then lets the write proceed.
  getDocFromCacheSpy.mockRejectedValue(new Error('unavailable'));
  // The pending-Moment queue is MODULE state (it survives unmounts on purpose,
  // issue #104), so reset it between cases for isolation.
  resetPendingMoments();
});

describe('moments broadcasts — the Feed beat writer (specs/w2-feed-moments.md)', () => {
  it('a first BINGO broadcasts exactly one `bingo` Moment at the per-Player id, no evidence', async () => {
    broadcastBingo({ uid: 'u1', displayName: 'Alice', photoURL: null });
    await settle();

    expect(setDocSpy).toHaveBeenCalledTimes(1);
    const [ref, payload] = setDocSpy.mock.calls[0];
    // Deterministic per-Player id → once-per-Player is structural (rules: update is denied).
    expect(ref.path).toBe(`events/${EVENT_ID}/moments/u1-bingo`);
    // EXACTLY the MomentDoc fields — no media, mediaURL, storagePath, or proofId (ADR 0002).
    expect(payload).toEqual({
      kind: 'bingo',
      uid: 'u1',
      displayName: 'Alice',
      photoURL: null,
      createdAt: expect.any(Number),
    });
    expect('mediaURL' in payload).toBe(false);
    expect('proofId' in payload).toBe(false);
  });

  it('a legacy (day-less) Blackout broadcasts one `blackout` Moment at the per-Player id', async () => {
    broadcastBlackout({ uid: 'u1', displayName: 'Alice', photoURL: 'https://x/a.jpg' });
    await settle();

    expect(setDocSpy).toHaveBeenCalledTimes(1);
    const [ref, payload] = setDocSpy.mock.calls[0];
    expect(ref.path).toBe(`events/${EVENT_ID}/moments/u1-blackout`);
    expect(payload).toMatchObject({ kind: 'blackout', uid: 'u1', photoURL: 'https://x/a.jpg' });
  });

  it('a per-card Blackout (#267) writes a per-(Player, Day) id — a second Day posts its own Moment, the same Day dedupes', async () => {
    broadcastBlackout({ uid: 'u1', displayName: 'Alice', photoURL: null }, 3);
    broadcastBlackout({ uid: 'u1', displayName: 'Alice', photoURL: null }, 6);
    await settle();

    expect(setDocSpy).toHaveBeenCalledTimes(2);
    expect(setDocSpy.mock.calls[0][0].path).toBe(`events/${EVENT_ID}/moments/u1-blackout-d3`);
    expect(setDocSpy.mock.calls[0][1]).toMatchObject({ kind: 'blackout', uid: 'u1', dayIndex: 3 });
    expect(setDocSpy.mock.calls[1][0].path).toBe(`events/${EVENT_ID}/moments/u1-blackout-d6`);
    expect(setDocSpy.mock.calls[1][1]).toMatchObject({ kind: 'blackout', uid: 'u1', dayIndex: 6 });
  });

  it('First-to-BINGO broadcasts one `first_bingo` Moment at the EVENT-singleton id', async () => {
    expect(FIRST_BINGO_MOMENT_ID).toBe('first_bingo');
    broadcastFirstBingo({ uid: 'u1', displayName: 'Alice', photoURL: null });
    await settle();

    expect(setDocSpy).toHaveBeenCalledTimes(1);
    const [ref, payload] = setDocSpy.mock.calls[0];
    // A fixed per-Event id → once-per-Event structurally (first create wins; the
    // race's later writers hit the deny-all update rule and are denied).
    expect(ref.path).toBe(`events/${EVENT_ID}/moments/first_bingo`);
    expect(payload).toMatchObject({ kind: 'first_bingo', uid: 'u1' });
  });

  it('bounds an over-long attributed name to the 100-char Moment cap (rules-valid)', async () => {
    broadcastBingo({ uid: 'u1', displayName: 'x'.repeat(140), photoURL: null });
    await settle();
    expect((setDocSpy.mock.calls[0][1].displayName as string).length).toBe(100);
  });

  it('is offline-queueable — a plain setDoc, never addDoc or runTransaction', async () => {
    broadcastBingo({ uid: 'u1', displayName: 'Alice', photoURL: null });
    await settle();
    expect(setDocSpy).toHaveBeenCalledTimes(1);
    expect(addDoc).not.toHaveBeenCalled();
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it('SKIPS the write when the Moment is already in the local cache (round 3 finding C)', async () => {
    // A duplicate deterministic-id setDoc would be denied server-side, but latency
    // compensation applies it LOCALLY first — the refreshed createdAt would pin the
    // old Moment to the Feed top until the denial (indefinitely offline). The
    // write-once pre-check catches exactly this: doc cached → no write at all.
    getDocFromCacheSpy.mockResolvedValue({ exists: () => true });
    broadcastBingo({ uid: 'u1', displayName: 'Alice', photoURL: null });
    await settle();
    expect(setDocSpy).not.toHaveBeenCalled();
  });

  it('writes when the cache has no copy — a cached tombstone (exists=false) or a cache miss both proceed', async () => {
    // exists() === false: the cache KNOWS the doc is absent (e.g. deleted) — write.
    getDocFromCacheSpy.mockResolvedValue({ exists: () => false });
    broadcastBingo({ uid: 'u1', displayName: 'Alice', photoURL: null });
    await settle();
    expect(setDocSpy).toHaveBeenCalledTimes(1);

    // Cache miss (rejection — fresh device): the pre-check cannot protect anything
    // (no cached copy to overwrite), so the write proceeds and any duplicate still
    // resolves server-side via the create-only rule.
    getDocFromCacheSpy.mockRejectedValue(new Error('unavailable'));
    broadcastBlackout({ uid: 'u1', displayName: 'Alice', photoURL: null });
    await settle();
    expect(setDocSpy).toHaveBeenCalledTimes(2);
  });
});

describe('hasPriorBingoWitness — the durable prior-win witness (PR #99 round 2 finding D)', () => {
  it('reads the player’s OWN bingo Moment doc from the LOCAL cache only', async () => {
    getDocFromCacheSpy.mockResolvedValue({ exists: () => true });
    await expect(hasPriorBingoWitness('u1')).resolves.toBe(true);
    // The witness is the per-Player `${uid}-bingo` doc — the same immutable Moment
    // broadcastBingo writes — so the Moment collection is its own memory.
    expect(getDocFromCacheSpy).toHaveBeenCalledTimes(1);
    expect(getDocFromCacheSpy.mock.calls[0][0].path).toBe(`events/${EVENT_ID}/moments/u1-bingo`);
  });

  it('resolves false when the cached doc does not exist', async () => {
    getDocFromCacheSpy.mockResolvedValue({ exists: () => false });
    await expect(hasPriorBingoWitness('u1')).resolves.toBe(false);
  });

  it('resolves false — NEVER rejects — on a cache miss (fresh device / cold cache)', async () => {
    // getDocFromCache rejects when the doc is not in the local cache; the caller
    // (Board) then falls back to the roster check — the narrowed residual the
    // spec documents.
    getDocFromCacheSpy.mockRejectedValue(new Error('unavailable'));
    await expect(hasPriorBingoWitness('u1')).resolves.toBe(false);
  });
});

describe('the pending-Moment queue — module state that survives Board unmounts (issue #104)', () => {
  it('enqueues a bingo/blackout win off the mark transition verdict; peek reads it back', () => {
    enqueueWinMoments({ uid: 'u1', bingoTransition: true, blackoutTransition: false });
    expect(peekPendingMoments('u1')).toEqual({ bingo: true, blackout: false, firstBingo: false });

    enqueueWinMoments({ uid: 'u1', bingoTransition: false, blackoutTransition: true });
    expect(peekPendingMoments('u1')).toEqual({ bingo: true, blackout: true, firstBingo: false });
  });

  it('a no-op enqueue (neither transition) leaves the queue untouched — never resurrects a drained flag', () => {
    enqueueWinMoments({ uid: 'u1', bingoTransition: false, blackoutTransition: false });
    expect(peekPendingMoments('u1')).toEqual({ bingo: false, blackout: false, firstBingo: false });
  });

  it('enqueues the ceremonial First-to-BINGO candidate separately (Board gates it on the witness first)', () => {
    enqueueFirstBingoMoment('u1');
    expect(peekPendingMoments('u1').firstBingo).toBe(true);
  });

  it('is keyed per-uid: a held win for one account never leaks into another', () => {
    enqueueWinMoments({ uid: 'u1', bingoTransition: true, blackoutTransition: false });
    expect(peekPendingMoments('u2')).toEqual({ bingo: false, blackout: false, firstBingo: false });
  });

  it('SURVIVES across calls — the state lives in module scope, so an unmount cannot lose it', () => {
    // The headline #104 fix: enqueue is one call (a mark in doMark), peek is a
    // LATER call (a drain from a fresh Board mount). Module state bridges them.
    enqueueWinMoments({ uid: 'u1', bingoTransition: true, blackoutTransition: false });
    enqueueFirstBingoMoment('u1');
    // …a Board unmount / remount happens between enqueue and drain in the app; here
    // the two calls are simply separated, and the flags are still queued.
    expect(peekPendingMoments('u1')).toEqual({ bingo: true, blackout: false, firstBingo: true });
  });

  it('clears one drained kind and drops the entry once empty', () => {
    enqueueWinMoments({ uid: 'u1', bingoTransition: true, blackoutTransition: true });
    clearPendingMoment('u1', 'bingo');
    expect(peekPendingMoments('u1')).toEqual({ bingo: false, blackout: true, firstBingo: false });
    clearPendingMoment('u1', 'blackout');
    // Empty now → peek still returns a stable empty triple (the map entry is gone).
    expect(peekPendingMoments('u1')).toEqual({ bingo: false, blackout: false, firstBingo: false });
  });

  it('resetPendingMoments drops the whole queue (test-support)', () => {
    enqueueWinMoments({ uid: 'u1', bingoTransition: true, blackoutTransition: false });
    enqueueWinMoments({ uid: 'u2', bingoTransition: false, blackoutTransition: true });
    resetPendingMoments();
    expect(peekPendingMoments('u1')).toEqual({ bingo: false, blackout: false, firstBingo: false });
    expect(peekPendingMoments('u2')).toEqual({ bingo: false, blackout: false, firstBingo: false });
  });
});

describe('pendingBlackoutDayIndexes — the blackout Day(s) captured at ENQUEUE time (#267, per-card)', () => {
  it('is empty when nothing is queued', () => {
    expect(pendingBlackoutDayIndexes('u1')).toEqual([]);
  });

  it('stamps the Day the enqueue carried, so a later drain (after the Player switches Days) still reads it', () => {
    enqueueWinMoments({ uid: 'u1', bingoTransition: false, blackoutTransition: true, dayIndex: 3 });
    expect(pendingBlackoutDayIndexes('u1')).toEqual([3]);
    // The Player switches the viewed Day before the drain fires — the STORED
    // value (from enqueue time) is what a later drain must read, never a
    // re-derivation from whatever is on screen now. Nothing re-enqueues here;
    // this asserts the getter keeps returning the ORIGINAL stamp.
    expect(pendingBlackoutDayIndexes('u1')).toEqual([3]);
  });

  it('omits the Day entirely (empty) for a legacy, non-daily enqueue — never a misleading "Day 1"', () => {
    enqueueWinMoments({ uid: 'u1', bingoTransition: false, blackoutTransition: true }); // no dayIndex
    expect(peekPendingMoments('u1').blackout).toBe(true);
    expect(pendingBlackoutDayIndexes('u1')).toEqual([]);
  });

  it('accumulates one entry per distinct Day (#267 — blackout is per-card), deduping re-enqueues of the same Day', () => {
    enqueueWinMoments({ uid: 'u1', bingoTransition: false, blackoutTransition: true, dayIndex: 2 });
    enqueueWinMoments({ uid: 'u1', bingoTransition: false, blackoutTransition: true, dayIndex: 5 });
    enqueueWinMoments({ uid: 'u1', bingoTransition: false, blackoutTransition: true, dayIndex: 5 });
    expect(pendingBlackoutDayIndexes('u1')).toEqual([2, 5]);
  });

  it('clearPendingMoment("blackout") (the drain FIRED it) resets the stamp — nothing left to protect', () => {
    enqueueWinMoments({ uid: 'u1', bingoTransition: false, blackoutTransition: true, dayIndex: 4 });
    clearPendingMoment('u1', 'blackout');
    expect(pendingBlackoutDayIndexes('u1')).toEqual([]);
  });

  it('dropPendingWins({ blackout: true }) (an observed fall) resets the stamp — the fallen blackout no longer applies', () => {
    enqueueWinMoments({ uid: 'u1', bingoTransition: false, blackoutTransition: true, dayIndex: 4 });
    dropPendingWins('u1', { blackout: true });
    expect(pendingBlackoutDayIndexes('u1')).toEqual([]);
  });

  it('is isolated per-uid', () => {
    enqueueWinMoments({ uid: 'u1', bingoTransition: false, blackoutTransition: true, dayIndex: 1 });
    expect(pendingBlackoutDayIndexes('u2')).toEqual([]);
  });

  it('removePendingBlackoutDay drops ONE fired Day, keeping siblings queued and the flag owed (#267, Codex P2 on #275)', () => {
    enqueueWinMoments({ uid: 'u1', bingoTransition: false, blackoutTransition: true, dayIndex: 2 });
    enqueueWinMoments({ uid: 'u1', bingoTransition: false, blackoutTransition: true, dayIndex: 5 });
    removePendingBlackoutDay('u1', 2);
    expect(pendingBlackoutDayIndexes('u1')).toEqual([5]);
    expect(peekPendingMoments('u1').blackout).toBe(true); // Day 5 still owed
    removePendingBlackoutDay('u1', 5);
    expect(pendingBlackoutDayIndexes('u1')).toEqual([]);
    expect(peekPendingMoments('u1').blackout).toBe(false); // queue empty — nothing owed
  });

  it('removePendingBlackoutDay is a no-op for a Day not in the queue (and for an empty queue)', () => {
    removePendingBlackoutDay('u1', 3);
    expect(peekPendingMoments('u1').blackout).toBe(false);
    enqueueWinMoments({ uid: 'u1', bingoTransition: false, blackoutTransition: true, dayIndex: 4 });
    removePendingBlackoutDay('u1', 9);
    expect(pendingBlackoutDayIndexes('u1')).toEqual([4]);
    expect(peekPendingMoments('u1').blackout).toBe(true);
  });
});

describe('the action generation + fall-driven drops (Codex P1/P2, PR #110)', () => {
  // The generation is the token Board's witness continuation checks: captured
  // before the async durable-witness read, compared after. It bumps ONLY on an
  // OBSERVED BINGO FALL (round 4 narrowed it): its sole consumers are the
  // ceremonial machinery, and only what changes whether the bingo stands may
  // stale them — a non-falling unmark or a blackout-only fall preserves a
  // legitimate ceremony mid-witness-read.

  it('starts at 0, bumps ONLY on an actual bingo fall — never on a fire-clear, a no-drop unmark, or a blackout-only fall (round 4)', () => {
    expect(pendingActionGeneration('u1')).toBe(0);

    enqueueWinMoments({ uid: 'u1', bingoTransition: true, blackoutTransition: false });
    clearPendingMoment('u1', 'bingo'); // a drain fired it: the win stood, not a fall
    expect(pendingActionGeneration('u1')).toBe(0); // fires do not invalidate continuations

    // An unmark that dropped NO win (another line still standing) must not stale
    // a ceremony whose bingo stands continuously (the round-4 finding)…
    dropPendingWins('u1', {});
    expect(pendingActionGeneration('u1')).toBe(0);
    // …and a blackout-only fall does not touch whether the BINGO stands either.
    dropPendingWins('u1', { blackout: true });
    expect(pendingActionGeneration('u1')).toBe(0);

    dropPendingWins('u1', { bingo: true }); // an ACTUAL bingo fall
    expect(pendingActionGeneration('u1')).toBe(1);
  });

  it('dropPendingWins clears the fallen kinds — a bingo fall also drops the ceremonial candidate', () => {
    enqueueWinMoments({ uid: 'u1', bingoTransition: true, blackoutTransition: true });
    enqueueFirstBingoMoment('u1');
    dropPendingWins('u1', { bingo: true });
    // The ceremonial candidate cannot outlive the bingo it accompanies.
    expect(peekPendingMoments('u1')).toEqual({ bingo: false, blackout: true, firstBingo: false });
    dropPendingWins('u1', { blackout: true });
    expect(peekPendingMoments('u1')).toEqual({ bingo: false, blackout: false, firstBingo: false });
  });

  it('the generation SURVIVES the flags entry being emptied — a stale continuation cannot false-match a recreated entry', () => {
    enqueueWinMoments({ uid: 'u1', bingoTransition: true, blackoutTransition: false });
    dropPendingWins('u1', { bingo: true }); // empties + deletes the flags entry
    enqueueWinMoments({ uid: 'u1', bingoTransition: true, blackoutTransition: false }); // recreated
    expect(pendingActionGeneration('u1')).toBe(1); // monotonic — not reset by the delete
  });

  it('generations are per-uid; resetPendingMoments clears them (test-support)', () => {
    dropPendingWins('u1', { bingo: true });
    expect(pendingActionGeneration('u1')).toBe(1);
    expect(pendingActionGeneration('u2')).toBe(0); // isolated
    resetPendingMoments();
    expect(pendingActionGeneration('u1')).toBe(0);
  });

  it('a NON-falling drop preserves the candidate as CURRENT; a bingo fall clears it (round 4 corrected round 2 finding 3)', () => {
    enqueueFirstBingoMoment('u1');
    expect(firstBingoCandidateCurrent('u1')).toBe(true);

    // A no-drop unmark and a blackout-only fall leave the candidate BOTH queued
    // and current — the bingo it accompanies still stands, nothing was
    // un-witnessed, and the ceremony must survive (the round-4 finding: the old
    // unconditional bump made exactly this candidate stale).
    dropPendingWins('u1', {});
    dropPendingWins('u1', { blackout: true });
    expect(peekPendingMoments('u1').firstBingo).toBe(true);
    expect(firstBingoCandidateCurrent('u1')).toBe(true);

    // An actual bingo fall clears the candidate outright (and bumps): after it,
    // nothing is queued and nothing is current. Every in-app bump site also
    // clears, so the stamp's stale-kill is belt-and-braces for future bump sites.
    dropPendingWins('u1', { bingo: true });
    expect(peekPendingMoments('u1').firstBingo).toBe(false);
    expect(firstBingoCandidateCurrent('u1')).toBe(false);

    // A fresh re-enqueue at the new generation is current again.
    enqueueFirstBingoMoment('u1');
    expect(firstBingoCandidateCurrent('u1')).toBe(true);
  });

  it('firstBingoCandidateCurrent is false when no candidate is queued', () => {
    expect(firstBingoCandidateCurrent('u1')).toBe(false);
    enqueueWinMoments({ uid: 'u1', bingoTransition: true, blackoutTransition: false });
    expect(firstBingoCandidateCurrent('u1')).toBe(false); // a plain bingo is not a candidate
  });
});

// Minimal docs — only the fields mergeFeed reads (createdAt) plus an id for keying.
const proof = (id: string, createdAt: number): ProofDoc =>
  ({ id, createdAt, uid: `u-${id}`, displayName: id, type: 'text', itemText: 't' } as unknown as ProofDoc);
const moment = (id: string, createdAt: number, kind: MomentKind): MomentDoc => ({
  id,
  kind,
  uid: `u-${id}`,
  displayName: id,
  photoURL: null,
  createdAt,
});

describe('mergeFeed — Proofs + Moments into one newest-first stream (specs/w2-feed-moments.md)', () => {
  it('interleaves Proofs and Moments strictly newest-first', () => {
    const merged = mergeFeed(
      [proof('a', 2000), proof('b', 500)],
      [moment('c', 3000, 'bingo'), moment('d', 1000, 'first_bingo')],
    );
    expect(merged.map((e) => e.createdAt)).toEqual([3000, 2000, 1000, 500]);
    expect(merged.map((e) => e.feedKind)).toEqual(['moment', 'proof', 'moment', 'proof']);
    expect(merged[0]).toMatchObject({ feedKind: 'moment', moment: { id: 'c' } });
    expect(merged[1]).toMatchObject({ feedKind: 'proof', proof: { id: 'a' } });
  });

  it('keeps the slice cap so the Feed stays light on ship wifi', () => {
    const many = Array.from({ length: 80 }, (_, i) => proof(`p${i}`, i));
    const merged = mergeFeed(many, [], [], 60);
    expect(merged).toHaveLength(60);
    expect(merged[0].createdAt).toBe(79); // the newest survives the cap
  });

  it('a bare Mark (neither a Proof nor a Moment) yields no Feed entry (ADR 0002)', () => {
    expect(mergeFeed([], [])).toEqual([]);
  });
});

describe('hasCanonicalMomentId — read-side singleton/per-player Moment filter', () => {
  it('accepts only the deterministic ids the writer uses for each Moment kind', () => {
    expect(hasCanonicalMomentId({ ...moment('u1-bingo', 1, 'bingo'), uid: 'u1' })).toBe(true);
    expect(hasCanonicalMomentId({ ...moment('u1-blackout', 1, 'blackout'), uid: 'u1' })).toBe(true);
    expect(hasCanonicalMomentId({ ...moment('first_bingo', 1, 'first_bingo'), uid: 'u1' })).toBe(true);

    // Per-card blackout ids (#267): day-stamped, and the id's Day must match
    // the doc's own dayIndex — a forged mismatch (or a day-suffixed id with no
    // dayIndex field) is dropped.
    expect(hasCanonicalMomentId({ ...moment('u1-blackout-d4', 1, 'blackout'), uid: 'u1', dayIndex: 4 })).toBe(true);
    expect(hasCanonicalMomentId({ ...moment('u1-blackout-d4', 1, 'blackout'), uid: 'u1', dayIndex: 5 })).toBe(false);
    expect(hasCanonicalMomentId({ ...moment('u1-blackout-d4', 1, 'blackout'), uid: 'u1' })).toBe(false);
    expect(hasCanonicalMomentId({ ...moment('u2-blackout-d4', 1, 'blackout'), uid: 'u1', dayIndex: 4 })).toBe(false);

    expect(hasCanonicalMomentId({ ...moment('spoof-first', 1, 'first_bingo'), uid: 'u1' })).toBe(false);
    expect(hasCanonicalMomentId({ ...moment('u1-first_bingo', 1, 'first_bingo'), uid: 'u1' })).toBe(false);
    expect(hasCanonicalMomentId({ ...moment('spoof-bingo', 1, 'bingo'), uid: 'u1' })).toBe(false);
    expect(hasCanonicalMomentId({ ...moment('u2-bingo', 1, 'bingo'), uid: 'u1' })).toBe(false);
    expect(hasCanonicalMomentId({ ...moment('u1-streak', 1, 'bingo'), kind: 'streak' as MomentKind, uid: 'u1' })).toBe(false);
  });
});
