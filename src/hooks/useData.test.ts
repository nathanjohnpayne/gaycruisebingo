import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Codex P3 on PR #66: Board must not keep a live listener on the whole
// Prompt pool once a Player already has a frozen Board (it fans every other
// Player's prompt add/report out as a full-pool read + rerender for no
// reason). `useItems`'s `enabled` gate is the mechanism — this proves the
// hook itself opens no `onSnapshot` subscription when disabled, independent
// of how Board.tsx wires the flag (that wiring is covered separately in
// src/components/w1-board-deal-join.test.tsx via a useItems spy).
//
// Codex P2 on PR #66 round 4: with the ADR 0006 persistent cache, the first
// snapshot can be served from IndexedDB (`metadata.fromCache`), so the subs
// also expose a `hasServerData` latch — false until a server-confirmed
// snapshot arrives, then latched for the life of the subscription key. The
// latch tests below drive the captured onSnapshot callback with cache/server
// snapshots against the real hooks.

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
    query: (...args: unknown[]) => ({ query: args }),
    where: (...args: unknown[]) => ({ where: args }),
    onSnapshot: H.onSnapshot,
  };
});

// Real module under test — imported after the mocks are declared.
import { useItems, useBoard } from './useData';

beforeEach(() => {
  H.onSnapshot.mockReset();
  H.onSnapshot.mockReturnValue(() => {}); // unsubscribe fn
});

// Capture the latest subscription's onNext callback so tests can deliver
// cache/server snapshots by hand. The real hooks call
// onSnapshot(target, options, onNext, onError).
type SnapCb = (snap: unknown) => void;
function captureOnNext(): { fire: (snap: unknown) => void } {
  const captured: { cb: SnapCb | null } = { cb: null };
  H.onSnapshot.mockImplementation(
    (_target: unknown, _options: unknown, onNext: SnapCb) => {
      captured.cb = onNext;
      return () => {};
    },
  );
  return {
    fire: (snap: unknown) => {
      if (!captured.cb) throw new Error('onSnapshot not subscribed');
      act(() => captured.cb!(snap));
    },
  };
}

const colSnap = (fromCache: boolean) => ({ docs: [], metadata: { fromCache } });
const docSnap = (fromCache: boolean) => ({
  exists: () => false,
  data: () => undefined,
  metadata: { fromCache },
});

describe('useItems enabled gate (Codex P3)', () => {
  // useItems now also reads the ADR 0004 threshold from useEventDoc(), which
  // opens a SEPARATE subscription on the event DOC. The P3 gate is specifically
  // about the heavy POOL listener (the items COLLECTION) — the one that fans
  // every Player's prompt add/report out as a full-pool read + rerender — so the
  // gate is asserted on collection subscriptions, not the raw call count. The
  // tiny event-doc read Board already makes anyway is not what P3 guards against.
  const poolSubCount = () =>
    H.onSnapshot.mock.calls.filter((c) => (c[0] as { kind?: string } | null)?.kind === 'collection')
      .length;

  it('subscribes to the pool by default (no Board yet)', () => {
    renderHook(() => useItems());

    expect(poolSubCount()).toBe(1);
  });

  it('opens no pool listener when disabled — a Player with a frozen Board', () => {
    renderHook(() => useItems(false));

    expect(poolSubCount()).toBe(0);
  });

  it('subscribes once more if `enabled` flips back to true', () => {
    const { rerender } = renderHook(({ enabled }) => useItems(enabled), {
      initialProps: { enabled: false },
    });
    expect(poolSubCount()).toBe(0);

    rerender({ enabled: true });

    expect(poolSubCount()).toBe(1);
  });
});

describe('hasServerData latch (Codex P2, round 4 — persistent-cache cold start)', () => {
  it('subscribes with includeMetadataChanges so the cache→server transition is observable', () => {
    // Without metadata events, a cache snapshot followed by byte-identical
    // server data produces NO second event and the latch would deadlock.
    renderHook(() => useItems());

    expect(H.onSnapshot).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ includeMetadataChanges: true }),
      expect.any(Function),
      expect.any(Function),
    );
  });

  it('useItems: false over a cache-only snapshot, latched true once the server confirms', () => {
    const sub = captureOnNext();
    const { result } = renderHook(() => useItems());
    expect(result.current.hasServerData).toBe(false);

    // Cold persistent cache: first snapshot is cache-served and empty. The
    // data "loads" (loading false) but is NOT server truth yet.
    sub.fire(colSnap(true));
    expect(result.current.loading).toBe(false);
    expect(result.current.hasServerData).toBe(false);

    // The backend confirms — latch on.
    sub.fire(colSnap(false));
    expect(result.current.hasServerData).toBe(true);

    // A later cache-served snapshot (offline flap) must not unlatch: the
    // subscription has seen server truth for this key.
    sub.fire(colSnap(true));
    expect(result.current.hasServerData).toBe(true);
  });

  it('useBoard: false over a cache-only missing doc, latched true once the server confirms', () => {
    const sub = captureOnNext();
    const { result } = renderHook(() => useBoard('sailor-1'));
    expect(result.current.hasServerData).toBe(false);

    sub.fire(docSnap(true)); // cache says "no board" — not trustworthy yet
    expect(result.current.loading).toBe(false);
    expect(result.current.hasServerData).toBe(false);

    sub.fire(docSnap(false)); // server agrees — now it is truth
    expect(result.current.hasServerData).toBe(true);
  });
});
