import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Cell } from '../types';

// specs/w2-tally.md, unit layer. Proves setMark's per-Prompt Tally extension
// (ADR 0002): every non-free Mark self-publishes an ATTRIBUTED marker at
// tally/{itemId}/markers/{uid} in the SAME batch as the board + player writes
// (never a Feed post, never a transaction); unmarking deletes exactly that
// marker; the free centre never tallies; and the attribution is resolved +
// bounded so the write always satisfies the marker rule. The rules-side proof
// that this shape is accepted/denied is tests/rules/w2-tally.test.ts; the
// offline-durable proof is tests/offline/w2-tally.test.ts.

const EVENT_ID = 'med-2026'; // src/firebase.ts default when VITE_EVENT_ID is unset

type FakeSnap = { exists: () => boolean; data: () => unknown };

const { setSpy, deleteSpy, commitSpy, getDocFromCacheSpy } = vi.hoisted(() => ({
  setSpy: vi.fn(),
  deleteSpy: vi.fn(),
  commitSpy: vi.fn(() => Promise.resolve()),
  // Rejects by default (nothing cached); individual tests override to seed a
  // cached player row so the attribution-fallback path can be exercised.
  getDocFromCacheSpy: vi.fn((): Promise<FakeSnap> => Promise.reject(new Error('no cache'))),
}));

vi.mock('../firebase', () => ({ db: {}, EVENT_ID: 'med-2026' }));
vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return {
    ...actual,
    doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
    writeBatch: () => ({ set: setSpy, delete: deleteSpy, commit: commitSpy }),
    getDocFromCache: getDocFromCacheSpy,
    addDoc: vi.fn(),
    runTransaction: vi.fn(),
  };
});

import { setMark } from './api';
import { addDoc, runTransaction } from 'firebase/firestore';

// A dealt board: every non-free Square carries itemId `i{index}`; the free
// centre (12) is on and carries no itemId.
function dealt(): Cell[] {
  return Array.from({ length: 25 }, (_, index) => ({
    index,
    itemId: index === 12 ? null : `i${index}`,
    text: index === 12 ? 'FREE' : `p${index}`,
    free: index === 12,
    marked: index === 12,
    markedAt: null,
  }));
}

// The marker write is always the LAST batch.set (after board, then player).
const markerWrite = () => setSpy.mock.calls[setSpy.mock.calls.length - 1];

const base = {
  uid: 'u1',
  cells: dealt(),
  claimMode: 'honor' as const,
  currentFirstBingoAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  getDocFromCacheSpy.mockReset();
  getDocFromCacheSpy.mockRejectedValue(new Error('no cache'));
});

describe('setMark — per-Prompt Tally marker (specs/w2-tally.md)', () => {
  it('marking a non-free Square publishes an attributed marker in the same batch', async () => {
    await setMark({ ...base, index: 3, nextMarked: true, displayName: 'Alice' });

    // Board, then player, then the Tally marker — one batch, three writes.
    expect(setSpy).toHaveBeenCalledTimes(3);
    const [ref, data, mergeOpt] = markerWrite();
    expect(ref.path).toBe(`events/${EVENT_ID}/tally/i3/markers/u1`);
    expect(data).toMatchObject({ uid: 'u1', displayName: 'Alice' });
    expect(typeof data.markedAt).toBe('number');
    expect(mergeOpt).toBeUndefined(); // a full set of exactly { uid, displayName, markedAt }
    expect(deleteSpy).not.toHaveBeenCalled();

    // ADR 0002 / ADR 0006: the Tally is not a Feed post and rides a batch, not a tx.
    expect(addDoc).not.toHaveBeenCalled();
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it('unmarking removes exactly that Player’s marker via batch.delete', async () => {
    await setMark({ ...base, index: 3, nextMarked: false, displayName: 'Alice' });

    // Only the board + player are set; the marker is DELETED, not written.
    expect(setSpy).toHaveBeenCalledTimes(2);
    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(deleteSpy.mock.calls[0][0].path).toBe(`events/${EVENT_ID}/tally/i3/markers/u1`);
  });

  it('the free centre Square never tallies', async () => {
    await setMark({ ...base, index: 12, nextMarked: true, displayName: 'Alice' });

    // Board + player only — no marker set, no marker delete for the free centre.
    expect(setSpy).toHaveBeenCalledTimes(2);
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it('attribution falls back to the cached player row name when no displayName is passed', async () => {
    getDocFromCacheSpy.mockImplementation((ref?: unknown) => {
      const path = (ref as { path?: string })?.path ?? '';
      if (path.endsWith('/players/u1')) {
        return Promise.resolve({ exists: () => true, data: () => ({ displayName: 'Deck Daddy' }) });
      }
      return Promise.reject(new Error('not cached'));
    });

    await setMark({ ...base, index: 5, nextMarked: true }); // no displayName param

    expect(markerWrite()[1]).toMatchObject({ uid: 'u1', displayName: 'Deck Daddy' });
  });

  it("falls back to 'Anonymous' when neither a param nor a cached name is available", async () => {
    await setMark({ ...base, index: 5, nextMarked: true }); // no param, no cache

    expect(markerWrite()[1]).toMatchObject({ displayName: 'Anonymous' });
  });

  it('bounds an over-long attributed name to the 100-char marker cap', async () => {
    await setMark({ ...base, index: 5, nextMarked: true, displayName: 'x'.repeat(140) });

    expect((markerWrite()[1].displayName as string).length).toBe(100);
  });
});
