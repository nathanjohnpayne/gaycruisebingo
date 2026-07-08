import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// Codex P3 on PR #66: Board must not keep a live listener on the whole
// Prompt pool once a Player already has a frozen Board (it fans every other
// Player's prompt add/report out as a full-pool read + rerender for no
// reason). `useItems`'s `enabled` gate is the mechanism — this proves the
// hook itself opens no `onSnapshot` subscription when disabled, independent
// of how Board.tsx wires the flag (that wiring is covered separately in
// src/components/w1-board-deal-join.test.tsx via a useItems spy).

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
import { useItems } from './useData';

beforeEach(() => {
  H.onSnapshot.mockReset();
  H.onSnapshot.mockReturnValue(() => {}); // unsubscribe fn
});

describe('useItems enabled gate (Codex P3)', () => {
  it('subscribes to the pool by default (no Board yet)', () => {
    renderHook(() => useItems());

    expect(H.onSnapshot).toHaveBeenCalledTimes(1);
  });

  it('opens no pool listener when disabled — a Player with a frozen Board', () => {
    renderHook(() => useItems(false));

    expect(H.onSnapshot).not.toHaveBeenCalled();
  });

  it('subscribes once more if `enabled` flips back to true', () => {
    const { rerender } = renderHook(({ enabled }) => useItems(enabled), {
      initialProps: { enabled: false },
    });
    expect(H.onSnapshot).not.toHaveBeenCalled();

    rerender({ enabled: true });

    expect(H.onSnapshot).toHaveBeenCalledTimes(1);
  });
});
