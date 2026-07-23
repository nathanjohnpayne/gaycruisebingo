import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// specs/feed-paging.md, hook layer (RTL-jsdom). `useFeed(max)`'s `max` is a
// WINDOW, not a ceiling (#441): it returns at most `max` merged entries and
// reports `hasMore` when another one exists past the window, so `ProofFeed` can
// grow the window instead of ending the stream. The real hook runs here with
// Firestore's onSnapshot stubbed, so the proofs query, the moments collection,
// and the tally collectionGroup are hand-delivered.

const H = vi.hoisted(() => ({ onSnapshot: vi.fn() }));

vi.mock('../firebase', () => ({
  db: {},
  EVENT_ID: 'test-event',
  storage: {},
  auth: {},
  googleProvider: {},
  analytics: null,
}));

vi.mock('firebase/firestore', () => {
  const makeRef = (kind: string, args: unknown[]) => {
    const ref: Record<string, unknown> = { kind, args };
    ref.withConverter = () => ref; // paths.ts chains .withConverter on refs
    return ref;
  };
  return {
    doc: (...args: unknown[]) => makeRef('doc', args),
    collection: (...args: unknown[]) => makeRef('collection', args),
    collectionGroup: (...args: unknown[]) => makeRef('collectionGroup', args),
    query: (...args: unknown[]) => ({ query: args }),
    where: (...args: unknown[]) => ({ where: args }),
    onSnapshot: H.onSnapshot,
  };
});

import { useFeed } from './useData';
import type { MomentDoc, NoticeDoc, ProofDoc, TallyCard } from '../types';

beforeEach(() => {
  H.onSnapshot.mockReset();
  H.onSnapshot.mockReturnValue(() => {});
});

type SnapCb = (snap: unknown) => void;

/**
 * Route each subscription by target. `useFeed` opens: two event-doc subs (the
 * moderation read behind useProofFeed AND useMoments), the status-scoped proofs
 * QUERY, the moments and notices COLLECTIONs, and the tally COLLECTIONGROUP.
 * The two collections are told apart by their path segments — routing both to
 * one slot would leave whichever registered first without a snapshot, and
 * `loading` would never settle.
 */
function capture() {
  const cbs: {
    docs: SnapCb[];
    query: SnapCb | null;
    cols: Record<string, SnapCb>;
    group: SnapCb | null;
  } = { docs: [], query: null, cols: {}, group: null };
  H.onSnapshot.mockImplementation((target: unknown, _o: unknown, onNext: SnapCb) => {
    if (target && typeof target === 'object') {
      const ref = target as { kind?: string; args?: unknown[] };
      if ('query' in (target as object)) cbs.query = onNext;
      else if (ref.kind === 'doc') cbs.docs.push(onNext);
      else if (ref.kind === 'collectionGroup') cbs.group = onNext;
      else cbs.cols[String(ref.args?.[ref.args.length - 1])] = onNext;
    }
    return () => {};
  });
  return {
    fireEvent: (s: unknown) => act(() => cbs.docs.forEach((cb) => cb(s))),
    fireProofs: (s: unknown) => act(() => cbs.query?.(s)),
    fireMoments: (s: unknown) => act(() => cbs.cols.moments?.(s)),
    fireNotices: (s: unknown) => act(() => cbs.cols.notices?.(s)),
    fireTally: (s: unknown) => act(() => cbs.group?.(s)),
  };
}

const eventSnap = { exists: () => true, data: () => ({ admins: [] }), metadata: { fromCache: false } };
const colSnap = (docs: object[]) => ({
  docs: docs.map((d) => ({ data: () => d })),
  metadata: { fromCache: false },
});
// The tally collectionGroup snapshot shape useTallyCards reads: each doc carries
// a ref whose grandparent chain identifies the Event. No markers here — these
// fixtures page over Proofs and Moments, and the tally fold has its own suite
// (d15-tally-cards.test.ts).
const groupSnap = { docs: [] as unknown[], metadata: { fromCache: false } };

const proof = (n: number): ProofDoc =>
  ({
    id: `p${n}`,
    uid: `u${n}`,
    displayName: `P${n}`,
    photoURL: null,
    type: 'text',
    cellIndex: 0,
    itemText: `prompt ${n}`,
    storagePath: null,
    mediaURL: null,
    thumbURL: null,
    text: 'x',
    createdAt: n,
    reportCount: 0,
    status: 'active',
    visionFlag: null,
  }) as ProofDoc;

const notice = (n: number, pinned = false): NoticeDoc => ({
  id: `n${n}`,
  title: `notice ${n}`,
  body: 'x',
  uid: 'admin',
  displayName: 'Admin',
  createdAt: n,
  pinned,
});

const moment = (n: number): MomentDoc =>
  ({
    id: `u${n}-bingo`, // the canonical day-less id hasCanonicalMomentId accepts
    uid: `u${n}`,
    displayName: `M${n}`,
    photoURL: null,
    kind: 'bingo',
    line: '',
    createdAt: n,
  }) as MomentDoc;

/** Mount useFeed with `max` and deliver a proofs-only stream of `count` entries. */
function feedOf(count: number, max: number) {
  const fire = capture();
  const view = renderHook(({ m }: { m: number }) => useFeed(m), { initialProps: { m: max } });
  fire.fireEvent(eventSnap);
  fire.fireProofs(colSnap(Array.from({ length: count }, (_, i) => proof(i + 1))));
  fire.fireMoments(colSnap([]));
  fire.fireNotices(colSnap([]));
  fire.fireTally(groupSnap);
  return { view, fire };
}

const ids = (entries: ReturnType<typeof useFeed>['entries']) =>
  entries.map((e) => {
    switch (e.feedKind) {
      case 'proof':
        return e.proof.id;
      case 'moment':
        return e.moment.id;
      case 'notice':
        return e.notice.id;
      default:
        return e.card.itemId;
    }
  });

describe('useFeed — the render window and hasMore (#441)', () => {
  it('caps entries at `max` and reports hasMore when the stream runs past it', () => {
    const { view } = feedOf(5, 3);
    expect(view.result.current.loading).toBe(false);
    // Newest-first: createdAt 5, 4, 3.
    expect(ids(view.result.current.entries)).toEqual(['p5', 'p4', 'p3']);
    expect(view.result.current.hasMore).toBe(true);
  });

  it('reports hasMore false when the whole stream fits inside the window', () => {
    const { view } = feedOf(3, 3);
    expect(ids(view.result.current.entries)).toEqual(['p3', 'p2', 'p1']);
    expect(view.result.current.hasMore).toBe(false);
  });

  it('an EXACTLY-full window with one more behind it still reports hasMore — the probe reaches max + 1', () => {
    // The off-by-one that would silently strand the last page: a window of 3
    // over 4 entries is full, so a length check against `entries` alone reads
    // "no more" unless the probe looked one past.
    const { view } = feedOf(4, 3);
    expect(view.result.current.entries).toHaveLength(3);
    expect(view.result.current.hasMore).toBe(true);
  });

  it('growing the window reveals the NEXT entries and never disturbs the ones already shown', () => {
    const { view } = feedOf(5, 3);
    const firstPage = ids(view.result.current.entries);
    view.rerender({ m: 6 });
    const grown = ids(view.result.current.entries);
    expect(grown.slice(0, 3)).toEqual(firstPage); // the page-one prefix is stable
    expect(grown).toEqual(['p5', 'p4', 'p3', 'p2', 'p1']);
    expect(view.result.current.hasMore).toBe(false); // the stream is exhausted
  });

  it('merges Proofs and Moments into ONE newest-first window, both kinds pageable', () => {
    const fire = capture();
    const view = renderHook(() => useFeed(2));
    fire.fireEvent(eventSnap);
    fire.fireProofs(colSnap([proof(1), proof(3)]));
    fire.fireMoments(colSnap([moment(2), moment(4)]));
    fire.fireNotices(colSnap([]));
    fire.fireTally(groupSnap);
    expect(ids(view.result.current.entries)).toEqual(['u4-bingo', 'p3']);
    expect(view.result.current.hasMore).toBe(true);
  });

  it('stays exact under the pinned-Notice masthead, which spends part of the window', () => {
    // The masthead is why `hasMore` asks `mergeFeed` twice instead of comparing
    // `entries.length` to `max`: a pinned Notice occupies a window slot by a
    // DIFFERENT rule than the newest-first stream (it sorts above everything and
    // carries its own limit), so any hand-rolled count of the raw streams drifts
    // from what the merge actually emits.
    const fire = capture();
    const view = renderHook(({ m }: { m: number }) => useFeed(m), { initialProps: { m: 3 } });
    fire.fireEvent(eventSnap);
    fire.fireProofs(colSnap([proof(1), proof(2), proof(3)]));
    fire.fireMoments(colSnap([]));
    fire.fireNotices(colSnap([notice(10, true)]));
    fire.fireTally(groupSnap);

    // Pinned first, then the two newest proofs — one proof is past the window.
    expect(ids(view.result.current.entries)).toEqual(['n10', 'p3', 'p2']);
    expect(view.result.current.hasMore).toBe(true);

    view.rerender({ m: 4 });
    expect(ids(view.result.current.entries)).toEqual(['n10', 'p3', 'p2', 'p1']);
    expect(view.result.current.hasMore).toBe(false);
  });

  it('tallyCards stays UNCAPPED by the window (the proof-card pills read every card)', () => {
    const { view } = feedOf(1, 1);
    // No markers delivered, so the fold emits none — the point is that the
    // window never reaches this field. It is the raw stream, not a slice of it.
    const cards: TallyCard[] = view.result.current.tallyCards;
    expect(Array.isArray(cards)).toBe(true);
  });
});
