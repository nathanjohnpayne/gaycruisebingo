import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// specs/d15-proof-chips-ranks.md, hooks layer (#218). Harness mirrors
// src/hooks/w2-doubts.test.tsx — the REAL hook with Firestore's onSnapshot
// stubbed, event doc + proofs query hand-delivered separately.

const H = vi.hoisted(() => ({ onSnapshot: vi.fn() }));

vi.mock('../firebase', () => ({ db: {}, EVENT_ID: 'test-event', storage: {}, auth: {}, googleProvider: {}, analytics: null }));
vi.mock('firebase/firestore', () => {
  const makeRef = (kind: string, args: unknown[]) => {
    const ref: Record<string, unknown> = { kind, args };
    ref.withConverter = () => ref;
    return ref;
  };
  return {
    doc: (...a: unknown[]) => makeRef('doc', a),
    collection: (...a: unknown[]) => makeRef('collection', a),
    query: (...a: unknown[]) => ({ query: a }),
    where: (...a: unknown[]) => ({ where: a }),
    onSnapshot: H.onSnapshot,
  };
});

import { useLatestProofByUid } from './useData';
import type { ProofDoc } from '../types';

beforeEach(() => {
  H.onSnapshot.mockReset();
  H.onSnapshot.mockReturnValue(() => {});
});

type SnapCb = (snap: unknown) => void;
function capture() {
  const cbs: { doc: SnapCb | null; query: SnapCb | null } = { doc: null, query: null };
  H.onSnapshot.mockImplementation((target: unknown, _o: unknown, onNext: SnapCb) => {
    if (target && typeof target === 'object') {
      if ('query' in (target as object)) cbs.query = onNext;
      else if ((target as { kind?: string }).kind === 'doc') cbs.doc = onNext;
    }
    return () => {};
  });
  return { fireDoc: (s: unknown) => act(() => cbs.doc?.(s)), fireQuery: (s: unknown) => act(() => cbs.query?.(s)) };
}

const eventSnap = (threshold: number | undefined, bannedUids: string[] = []) => ({
  exists: () => true,
  data: () => (threshold === undefined ? { admins: [], bannedUids } : { admins: [], bannedUids, settings: { reportHideThreshold: threshold } }),
  metadata: { fromCache: false },
});
const colSnap = (docs: object[]) => ({ docs: docs.map((d) => ({ data: () => d })), metadata: { fromCache: false } });

const proof = (id: string, uid: string, createdAt: number, over: Partial<ProofDoc> = {}): ProofDoc =>
  ({
    id, uid, displayName: uid, photoURL: null, type: 'text', cellIndex: 0,
    itemText: 'Wore a sequin harness', storagePath: null, mediaURL: null, thumbURL: null,
    text: 'x', createdAt, reportCount: 0, status: 'active', visionFlag: null, ...over,
  }) as ProofDoc;

describe('useLatestProofByUid (#218)', () => {
  it('keeps exactly the most recent Proof per uid across different Days', () => {
    const cap = capture();
    const { result } = renderHook(() => useLatestProofByUid());
    cap.fireDoc(eventSnap(undefined));
    cap.fireQuery(colSnap([
      proof('p1', 'bob', 1_000, { type: 'photo' }),
      proof('p2', 'bob', 3_000, { type: 'audio' }), // later — should win
      proof('p3', 'ana', 2_000, { type: 'text' }),
    ]));

    expect(result.current.latestByUid.bob.id).toBe('p2');
    expect(result.current.latestByUid.ana.id).toBe('p3');
    expect(Object.keys(result.current.latestByUid).sort()).toEqual(['ana', 'bob']);
  });

  it('applies the community auto-hide (report threshold) and the Admin ban (#108)', () => {
    // Threshold: an at/over-threshold Proof never wins "latest".
    let cap = capture();
    let hook = renderHook(() => useLatestProofByUid());
    cap.fireDoc(eventSnap(4));
    cap.fireQuery(colSnap([proof('p1', 'bob', 1_000, { reportCount: 2 }), proof('p2', 'bob', 3_000, { reportCount: 4 })]));
    expect(hook.result.current.latestByUid.bob.id).toBe('p1');

    // Ban: a banned Player's Proof is dropped entirely.
    cap = capture();
    hook = renderHook(() => useLatestProofByUid());
    cap.fireDoc(eventSnap(undefined, ['bob']));
    cap.fireQuery(colSnap([proof('p1', 'bob', 1_000), proof('p2', 'ana', 2_000)]));
    expect(hook.result.current.latestByUid.bob).toBeUndefined();
    expect(hook.result.current.latestByUid.ana.id).toBe('p2');
  });
});
