import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// specs/w2-ban-console.md, RTL-jsdom layer. The Admin ban (#108) is presentational
// (ADR 0004 Phase 0): a banned uid's content is filtered OUT of every PUBLIC/player
// read by the content's OWNER uid, mirroring the isReportHidden auto-hide. This
// suite drives the REAL read hooks with Firestore's onSnapshot stubbed so we can
// hand-deliver the event doc (carrying bannedUids) alongside each collection/query
// snapshot. It also pins the leaderboard/first-bingo split: useLeaderboard returns
// the RAW roster (Board's First-to-BINGO source), so a ban never removes a Player
// from the shared roster — the VIEW filter lives in the component (its own suite).

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
    ref.withConverter = () => ref;
    return ref;
  };
  return {
    doc: (...args: unknown[]) => makeRef('doc', args),
    collection: (...args: unknown[]) => makeRef('collection', args),
    query: (...args: unknown[]) => ({ query: args }),
    where: (...args: unknown[]) => ({ where: args }),
    onSnapshot: H.onSnapshot,
  };
});

import {
  isBanned,
  useItems,
  useProofFeed,
  useTally,
  useMoments,
  useDoubts,
  useProofsForItemText,
  useMyProofs,
  useLeaderboard,
} from './useData';
import type { ItemDoc, ProofDoc, TallyEntry, MomentDoc, DoubtDoc, PlayerDoc } from '../types';

beforeEach(() => {
  H.onSnapshot.mockReset();
  H.onSnapshot.mockReturnValue(() => {});
});

type SnapCb = (snap: unknown) => void;
function capture() {
  const cbs: { doc: SnapCb | null; query: SnapCb | null; col: SnapCb | null } = {
    doc: null,
    query: null,
    col: null,
  };
  H.onSnapshot.mockImplementation((target: unknown, _o: unknown, onNext: SnapCb) => {
    if (target && typeof target === 'object') {
      if ('query' in (target as object)) cbs.query = onNext;
      else if ((target as { kind?: string }).kind === 'doc') cbs.doc = onNext;
      else cbs.col = onNext;
    }
    return () => {};
  });
  return {
    fireDoc: (s: unknown) => act(() => cbs.doc?.(s)),
    fireQuery: (s: unknown) => act(() => cbs.query?.(s)),
    fireCol: (s: unknown) => act(() => cbs.col?.(s)),
  };
}

// The event doc carrying a bannedUids roster (and no threshold — the auto-hide is
// off, so only the ban is under test). `bannedUids === undefined` omits the field
// entirely — the "fresh event" case the converter would default to [].
const eventSnap = (bannedUids: string[] | undefined) => ({
  exists: () => true,
  data: () => (bannedUids === undefined ? { admins: [] } : { admins: [], bannedUids }),
  metadata: { fromCache: false },
});
const colSnap = (docs: object[]) => ({
  docs: docs.map((d) => ({ data: () => d })),
  metadata: { fromCache: false },
});

const item = (id: string, createdBy: string): ItemDoc =>
  ({
    id,
    text: `prompt ${id}`,
    createdBy,
    createdAt: 1,
    isFreeSpace: false,
    status: 'active',
    reportCount: 0,
  }) as ItemDoc;

const proof = (id: string, uid: string): ProofDoc =>
  ({
    id,
    uid,
    displayName: uid,
    photoURL: null,
    type: 'text',
    cellIndex: 0,
    itemText: 'Danced on the lido deck',
    storagePath: null,
    mediaURL: null,
    thumbURL: null,
    text: 'x',
    createdAt: 1,
    reportCount: 0,
    status: 'active',
    visionFlag: null,
  }) as ProofDoc;

const marker = (uid: string): TallyEntry => ({ uid, displayName: uid, markedAt: 1 });

const moment = (uid: string): MomentDoc => ({
  id: `${uid}-bingo`, // canonical id useMoments requires
  kind: 'bingo',
  uid,
  displayName: uid,
  photoURL: null,
  createdAt: 1,
});

const doubt = (id: string, fromUid: string, targetUid: string): DoubtDoc => ({
  id,
  itemId: 'item-1',
  cellIndex: 0,
  fromUid,
  fromDisplayName: fromUid,
  targetUid,
  targetDisplayName: targetUid,
  createdAt: 1,
});

const player = (uid: string, firstBingoAt: number | null): PlayerDoc => ({
  uid,
  displayName: uid,
  photoURL: null,
  joinedAt: 1,
  bingoCount: firstBingoAt != null ? 1 : 0,
  squaresMarked: 5,
  firstBingoAt,
  blackout: false,
});

describe('useItems — a banned author’s Prompt drops from the public pool', () => {
  it('filters a Prompt whose createdBy is banned; keeps others; empty roster filters nothing', () => {
    const cap = capture();
    const { result, rerender } = renderHook(() => useItems());

    cap.fireDoc(eventSnap(['banned-uid']));
    cap.fireCol(colSnap([item('i1', 'banned-uid'), item('i2', 'ok-uid')]));
    expect(result.current.items.map((i) => i.id)).toEqual(['i2']);

    // Fail-open: an empty roster hides nothing (both prompts return).
    cap.fireDoc(eventSnap([]));
    rerender();
    expect(result.current.items.map((i) => i.id).sort()).toEqual(['i1', 'i2']);
  });
});

describe('useProofFeed — a banned author’s Proof drops from the public Feed', () => {
  it('filters by the Proof owner uid', () => {
    const cap = capture();
    const { result } = renderHook(() => useProofFeed());

    cap.fireDoc(eventSnap(['banned-uid']));
    cap.fireQuery(colSnap([proof('p1', 'banned-uid'), proof('p2', 'ok-uid')]));

    expect(result.current.proofs.map((p) => p.id)).toEqual(['p2']);
  });
});

describe('useTally — a banned marker drops from the who-list AND the count', () => {
  it('hides a banned marker and shrinks the derived count', () => {
    const cap = capture();
    const { result } = renderHook(() => useTally('item-1'));

    cap.fireDoc(eventSnap(['banned-uid']));
    cap.fireCol(colSnap([marker('banned-uid'), marker('ok-uid'), marker('ok-uid-2')]));

    expect(result.current.markers.map((m) => m.uid).sort()).toEqual(['ok-uid', 'ok-uid-2']);
    expect(result.current.count).toBe(2); // the banned marker is not counted
  });
});

describe('useMoments — a banned Player’s broadcast beats drop from the Feed', () => {
  it('filters Moments by uid', () => {
    const cap = capture();
    const { result } = renderHook(() => useMoments());

    cap.fireDoc(eventSnap(['banned-uid']));
    cap.fireCol(colSnap([moment('banned-uid'), moment('ok-uid')]));

    expect(result.current.moments.map((m) => m.uid)).toEqual(['ok-uid']);
  });
});

describe('useDoubts — ban filter (viewer-aware target-side, #122 round 2)', () => {
  it('from ANOTHER viewer’s board: a Doubt drops when EITHER fromUid OR targetUid is banned', () => {
    // No viewer match: this is the OTHER-viewer perspective (or the free-centre with
    // no viewer). A banned accuser AND a banned target are both hidden.
    const cap = capture();
    const { result } = renderHook(() => useDoubts('item-1', 'some-other-viewer'));

    cap.fireDoc(eventSnap(['banned-uid']));
    cap.fireQuery(
      colSnap([
        doubt('d-fromBanned', 'banned-uid', 'ok-a'), // accuser banned → hidden
        doubt('d-targetBanned', 'ok-b', 'banned-uid'), // target banned, viewer≠target → hidden
        doubt('d-clean', 'ok-c', 'ok-d'), // neither → shown
      ]),
    );

    expect(result.current.doubts.map((d) => d.id)).toEqual(['d-clean']);
    expect(result.current.count).toBe(1);
  });

  it('own board: a banned Player STILL sees Doubts against THEMSELVES (own-content exception), but their own accusations stay hidden', () => {
    // The banned Player is the viewer, on their OWN board. A ban is presentational —
    // it hides content from OTHERS, not from oneself — so a Doubt whose targetUid IS
    // the viewer must remain visible so they can see and answer it. But a Doubt they
    // AUTHORED (fromUid banned, even == viewer) is hidden everywhere, and a Doubt
    // against a DIFFERENT banned target is still hidden.
    const cap = capture();
    const { result } = renderHook(() => useDoubts('item-1', 'banned-uid'));

    cap.fireDoc(eventSnap(['banned-uid', 'other-banned']));
    cap.fireQuery(
      colSnap([
        doubt('d-againstMe', 'ok-accuser', 'banned-uid'), // target == viewer → SHOWN
        doubt('d-fromMe', 'banned-uid', 'ok-target'), // viewer is the banned accuser → hidden
        doubt('d-otherBannedTarget', 'ok-x', 'other-banned'), // banned target ≠ viewer → hidden
        doubt('d-clean', 'ok-y', 'ok-z'), // neither → shown
      ]),
    );

    expect(result.current.doubts.map((d) => d.id).sort()).toEqual(['d-againstMe', 'd-clean']);
  });
});

describe('useProofsForItemText — the PUBLIC Tally-sheet read filters banned authors', () => {
  it('drops a banned author’s Proof so it never renders "Proof shown" for others', () => {
    const cap = capture();
    const { result } = renderHook(() => useProofsForItemText('Danced on the lido deck'));

    cap.fireDoc(eventSnap(['banned-uid']));
    cap.fireQuery(colSnap([proof('p1', 'banned-uid'), proof('p2', 'ok-uid')]));

    expect(result.current.proofs.map((p) => p.id)).toEqual(['p2']);
  });
});

describe('useMyProofs — the viewer’s OWN content is NOT ban-filtered', () => {
  it('a banned viewer still sees their own Proofs in their own UI (presentational, hides from OTHERS)', () => {
    const cap = capture();
    // The viewer IS banned, yet useMyProofs must still return their own proofs — a
    // ban hides a Player's content from OTHERS (the public reads above), never from
    // themselves; the badge derivation over their own proofs stays intact.
    const { result } = renderHook(() => useMyProofs('banned-uid'));

    cap.fireDoc(eventSnap(['banned-uid']));
    cap.fireQuery(colSnap([proof('mine-1', 'banned-uid'), proof('mine-2', 'banned-uid')]));

    expect(result.current.proofs.map((p) => p.id).sort()).toEqual(['mine-1', 'mine-2']);
  });
});

describe('useLeaderboard — the RAW roster is UNfiltered (Board’s First-to-BINGO source)', () => {
  it('returns a banned Player in the roster — the shared first-bingo source must stay raw', () => {
    // THE leaderboard/first-bingo split, hook half: useLeaderboard is the SHARED
    // roster Board reads for its First-to-BINGO ceremony. If the ban filter were
    // (wrongly) applied HERE, banning the original first-bingo Player would let a
    // later Player retroactively become "first to BINGO" — rewriting history. This
    // hook must therefore stay RAW; the VIEW filter lives in Leaderboard.tsx (its
    // own suite pins that half). This assertion FAILS if the filter is moved here.
    const cap = capture();
    const { result } = renderHook(() => useLeaderboard());

    // useLeaderboard opens NO event subscription (it never reads bannedUids), so
    // there is nothing to fireDoc — only the players collection.
    cap.fireCol(colSnap([player('first-banned', 100), player('later-ok', 200)]));

    expect(result.current.players.map((p) => p.uid).sort()).toEqual(['first-banned', 'later-ok']);
  });
});

describe('isBanned re-export from useData', () => {
  it('is the same predicate the components import from here', () => {
    expect(isBanned('x', ['x'])).toBe(true);
    expect(isBanned('x', [])).toBe(false);
  });
});
