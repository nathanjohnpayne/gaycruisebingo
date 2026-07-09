import { describe, it, expect, vi, beforeEach } from 'vitest';

// specs/w2-doubts.md, unit layer. Proves the two write-side + derivation halves of
// a Doubt (ADR 0001 — social pressure, never a gate):
//   1. `raiseDoubt` self-publishes a Doubt at events/{EVENT_ID}/doubts/{autoId}
//      with the rules-block shape (own fromUid, target's uid, itemId, numeric
//      cellIndex + createdAt), attributed via the SHARED saved-player helper
//      (`markerDisplayName`, bounded to the ≤100 rule), as a plain offline-
//      queueable `setDoc` (never a transaction, never a Feed post), and fires the
//      `demand_proof` analytics event at that single raise call site. A self-doubt
//      is a no-op — no write, no event (the rules deny it too).
//   2. Satisfaction is a PURE derivation over the Feed's Proofs — no write is added
//      to `attachProof`, no Doubt doc is mutated. `isDoubtSatisfied` /`openDoubts`/
//      `doubtStatusFor` are exercised as a truth table: a Doubt is answered when
//      the doubted Player has a Proof for the SAME Prompt (by itemText) at or after
//      the Doubt; a Proof before the Doubt, by another Player, or for another Prompt
//      does NOT answer it. None of this touches the Mark.
// The rules-side accept/deny proof is tests/rules/w2-doubts.test.ts; the Board
// wiring proof is src/components/w2-doubts.test.tsx.

const EVENT_ID = 'med-2026'; // src/firebase.ts default when VITE_EVENT_ID is unset

const { setDocSpy, trackSpy } = vi.hoisted(() => ({
  // Typed params so `.mock.calls[i]` carries the (ref, data) tuple types.
  setDocSpy: vi.fn((_ref: { path: string }, _data: Record<string, unknown>) => Promise.resolve()),
  trackSpy: vi.fn(),
}));

// Inline the id literal — a vi.mock factory is hoisted above the module-level
// `EVENT_ID` const, so referencing it here would hit its temporal dead zone.
vi.mock('../firebase', () => ({ db: {}, EVENT_ID: 'med-2026' }));
vi.mock('../analytics', () => ({ track: trackSpy }));
vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return {
    ...actual,
    // collection(db, ...segments) → a ref carrying its path; doc(collectionRef)
    // (no extra segments) → an auto-id child under it, matching raiseDoubt's
    // `doc(rawDoubts())` create-with-generated-id.
    collection: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
    doc: (refOrDb: unknown, ...segments: string[]) => {
      if (segments.length > 0) {
        return { path: segments.join('/'), id: segments[segments.length - 1] };
      }
      const base = (refOrDb as { path?: string }).path ?? '';
      return { path: `${base}/auto-doubt-id`, id: 'auto-doubt-id' };
    },
    setDoc: setDocSpy,
  };
});

import { raiseDoubt, isDoubtSatisfied, openDoubts, doubtStatusFor } from './doubts';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('raiseDoubt — self-published Doubt + demand_proof (specs/w2-doubts.md)', () => {
  it('writes a Doubt with the rules-block shape and fires demand_proof at the raise', () => {
    raiseDoubt({
      fromUid: 'alice',
      fromDisplayName: 'Alice',
      targetUid: 'bob',
      targetDisplayName: 'Bob',
      itemId: 'i3',
      cellIndex: 3,
    });

    // One plain setDoc — an auto-id doc under the flat doubts collection. Not a
    // transaction, not a Feed post (ADR 0001/0002).
    expect(setDocSpy).toHaveBeenCalledTimes(1);
    const [ref, data] = setDocSpy.mock.calls[0];
    expect(ref.path).toBe(`events/${EVENT_ID}/doubts/auto-doubt-id`);
    expect(data).toMatchObject({
      itemId: 'i3',
      cellIndex: 3,
      fromUid: 'alice',
      fromDisplayName: 'Alice',
      targetUid: 'bob',
      targetDisplayName: 'Bob',
    });
    expect(typeof data.createdAt).toBe('number');
    // The doc id is the auto-generated ref id (converter pins it on read); nothing
    // stores `id`, and satisfaction is DERIVED so no satisfied* is written.
    expect(data.id).toBeUndefined();
    expect(data.satisfiedAt).toBeUndefined();

    expect(trackSpy).toHaveBeenCalledTimes(1);
    expect(trackSpy).toHaveBeenCalledWith('demand_proof', { itemId: 'i3' });
  });

  it('attributes via the shared saved-player helper: Anonymous fallback + ≤100 bound', () => {
    raiseDoubt({ fromUid: 'alice', targetUid: 'bob', itemId: 'i1', cellIndex: 1 }); // no names
    expect(setDocSpy.mock.calls[0][1]).toMatchObject({
      fromDisplayName: 'Anonymous',
      targetDisplayName: 'Anonymous',
    });

    setDocSpy.mockClear();
    raiseDoubt({
      fromUid: 'alice',
      fromDisplayName: 'x'.repeat(140),
      targetUid: 'bob',
      targetDisplayName: 'y'.repeat(140),
      itemId: 'i1',
      cellIndex: 1,
    });
    const data = setDocSpy.mock.calls[0][1];
    expect((data.fromDisplayName as string).length).toBe(100);
    expect((data.targetDisplayName as string).length).toBe(100);
  });

  it('a self-doubt is a no-op — no write, no analytics (ADR 0001, rules deny it too)', () => {
    raiseDoubt({ fromUid: 'alice', targetUid: 'alice', itemId: 'i1', cellIndex: 1 });
    expect(setDocSpy).not.toHaveBeenCalled();
    expect(trackSpy).not.toHaveBeenCalled();
  });
});

describe('satisfied-by-Proof — pure derivation truth table (specs/w2-doubts.md)', () => {
  const TEXT = 'Saw a drag show';
  const doubt = (over: Partial<{ targetUid: string; createdAt: number }> = {}) => ({
    targetUid: 'bob',
    createdAt: 100,
    ...over,
  });
  const proof = (over: Partial<{ uid: string; itemText: string; createdAt: number }> = {}) => ({
    uid: 'bob',
    itemText: TEXT,
    createdAt: 150,
    ...over,
  });

  it('is answered ONLY by the doubted Player’s Proof for the same Prompt, at or after the Doubt', () => {
    expect(isDoubtSatisfied(doubt(), TEXT, [])).toBe(false); // no Proof
    expect(isDoubtSatisfied(doubt(), TEXT, [proof()])).toBe(true); // after, same target + Prompt
    expect(isDoubtSatisfied(doubt(), TEXT, [proof({ createdAt: 100 })])).toBe(true); // exactly at
    expect(isDoubtSatisfied(doubt(), TEXT, [proof({ createdAt: 50 })])).toBe(false); // before the Doubt
    expect(isDoubtSatisfied(doubt(), TEXT, [proof({ uid: 'carol' })])).toBe(false); // another Player
    expect(isDoubtSatisfied(doubt(), TEXT, [proof({ itemText: 'Other' })])).toBe(false); // another Prompt
  });

  it('openDoubts keeps only the unanswered Doubts (the per-Prompt open count)', () => {
    const answered = doubt({ targetUid: 'bob', createdAt: 100 }); // bob's Proof@150 answers it
    const stillOpen = doubt({ targetUid: 'carol', createdAt: 100 }); // carol never proofs
    const proofs = [proof()]; // bob only
    expect(openDoubts([answered, stillOpen], TEXT, proofs)).toEqual([stillOpen]);
    expect(openDoubts([answered, stillOpen], TEXT, [])).toEqual([answered, stillOpen]); // none answered
  });

  it('doubtStatusFor is none / open / satisfied per Player, open winning any mix', () => {
    const answered = doubt({ targetUid: 'bob', createdAt: 100 });
    const open = doubt({ targetUid: 'carol', createdAt: 100 });
    const proofs = [proof()]; // answers bob's

    expect(doubtStatusFor('dave', [answered, open], TEXT, proofs)).toBe('none'); // undoubted
    expect(doubtStatusFor('carol', [open], TEXT, proofs)).toBe('open'); // unanswered
    expect(doubtStatusFor('bob', [answered], TEXT, proofs)).toBe('satisfied'); // all answered
    // A second, still-open Doubt against bob flips the whole row back to open.
    const alsoOpen = doubt({ targetUid: 'bob', createdAt: 200 }); // after the Proof → unanswered
    expect(doubtStatusFor('bob', [answered, alsoOpen], TEXT, proofs)).toBe('open');
  });
});
