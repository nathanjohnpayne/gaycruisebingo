import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MomentDoc, MomentKind, ProofDoc } from '../types';

// specs/w2-feed-moments.md, unit layer. Two Feed halves proven here:
//
// 1. The Moment WRITER (src/data/moments.ts): a first BINGO broadcasts exactly ONE
//    `bingo` Moment, a Blackout exactly one `blackout`, First-to-BINGO exactly one
//    `first_bingo` — each a single offline-queueable setDoc (never addDoc/
//    runTransaction), carrying EXACTLY the MomentDoc fields (ADR 0002: no media,
//    no proofId), attributed + bounded like a Tally marker. The deterministic doc
//    id (per-Player `${uid}-bingo`/`-blackout`; event-singleton `first_bingo`) is
//    what makes the once-only structural — the rules half is
//    tests/rules/w2-feed-moments.test.ts.
// 2. The Feed MERGE (mergeFeed in src/hooks/useData.ts): Proofs + Moments fold into
//    one newest-first, capped stream; a bare Mark (neither a Proof nor a Moment)
//    contributes nothing.

const EVENT_ID = 'med-2026'; // src/firebase.ts default when VITE_EVENT_ID is unset

// Plain vi.fn() so `.mock.calls` stays loosely typed (indexable) like the sibling
// tally suite; the resolved Promise (moments.ts does `setDoc(...).catch(...)`) is
// set in beforeEach so a re-broadcast's .catch has something to attach to.
const { setDocSpy } = vi.hoisted(() => ({ setDocSpy: vi.fn() }));

vi.mock('../firebase', () => ({ db: {}, EVENT_ID: 'med-2026' }));
vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return {
    ...actual,
    doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
    setDoc: setDocSpy,
    addDoc: vi.fn(),
    runTransaction: vi.fn(),
  };
});

import { broadcastBingo, broadcastBlackout, broadcastFirstBingo, FIRST_BINGO_MOMENT_ID } from './moments';
import { mergeFeed } from '../hooks/useData';
import { addDoc, runTransaction } from 'firebase/firestore';

beforeEach(() => {
  vi.clearAllMocks();
  setDocSpy.mockResolvedValue(undefined);
});

describe('moments broadcasts — the Feed beat writer (specs/w2-feed-moments.md)', () => {
  it('a first BINGO broadcasts exactly one `bingo` Moment at the per-Player id, no evidence', () => {
    broadcastBingo({ uid: 'u1', displayName: 'Alice', photoURL: null });

    expect(setDocSpy).toHaveBeenCalledTimes(1);
    const [ref, payload] = setDocSpy.mock.calls[0];
    // Deterministic per-Player id → once-per-Player is structural (rules: update is admin-only).
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

  it('a Blackout broadcasts exactly one `blackout` Moment at the per-Player id', () => {
    broadcastBlackout({ uid: 'u1', displayName: 'Alice', photoURL: 'https://x/a.jpg' });

    expect(setDocSpy).toHaveBeenCalledTimes(1);
    const [ref, payload] = setDocSpy.mock.calls[0];
    expect(ref.path).toBe(`events/${EVENT_ID}/moments/u1-blackout`);
    expect(payload).toMatchObject({ kind: 'blackout', uid: 'u1', photoURL: 'https://x/a.jpg' });
  });

  it('First-to-BINGO broadcasts one `first_bingo` Moment at the EVENT-singleton id', () => {
    expect(FIRST_BINGO_MOMENT_ID).toBe('first_bingo');
    broadcastFirstBingo({ uid: 'u1', displayName: 'Alice', photoURL: null });

    expect(setDocSpy).toHaveBeenCalledTimes(1);
    const [ref, payload] = setDocSpy.mock.calls[0];
    // A fixed per-Event id → once-per-Event structurally (first create wins; the
    // race's later writers hit the admin-only update rule and are denied).
    expect(ref.path).toBe(`events/${EVENT_ID}/moments/first_bingo`);
    expect(payload).toMatchObject({ kind: 'first_bingo', uid: 'u1' });
  });

  it('bounds an over-long attributed name to the 100-char Moment cap (rules-valid)', () => {
    broadcastBingo({ uid: 'u1', displayName: 'x'.repeat(140), photoURL: null });
    expect((setDocSpy.mock.calls[0][1].displayName as string).length).toBe(100);
  });

  it('is offline-queueable — a plain setDoc, never addDoc or runTransaction', () => {
    broadcastBingo({ uid: 'u1', displayName: 'Alice', photoURL: null });
    expect(setDocSpy).toHaveBeenCalledTimes(1);
    expect(addDoc).not.toHaveBeenCalled();
    expect(runTransaction).not.toHaveBeenCalled();
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
    const merged = mergeFeed(many, [], 60);
    expect(merged).toHaveLength(60);
    expect(merged[0].createdAt).toBe(79); // the newest survives the cap
  });

  it('a bare Mark (neither a Proof nor a Moment) yields no Feed entry (ADR 0002)', () => {
    expect(mergeFeed([], [])).toEqual([]);
  });
});
