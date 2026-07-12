import { describe, it, expect, vi, beforeEach } from 'vitest';

// specs/d15-approvals.md, data layer. The one write-side claim this file pins:
// `addItem` now lands a main-pool submission `status: 'pending'` (was
// `'active'`) — the gate the rest of the approval flow (the Admin Approvals
// queue, the submitter's own "pending review" row in ItemPool) hangs off. No
// emulator needed — this is a pure "what payload did addDoc receive" check,
// mirroring the mocking shape src/data/w3-claim-modes.test.ts already uses for
// this module's sibling writes.

type Ref = { __kind: 'doc' | 'collection'; id?: string; path: string };

const { addDocMock } = vi.hoisted(() => ({
  addDocMock: vi.fn((..._args: unknown[]) => Promise.resolve({ id: 'new-item' })),
}));

vi.mock('../firebase', () => ({ db: {}, EVENT_ID: 'med-2026' }));
vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return {
    ...actual,
    collection: (_db: unknown, ...segments: string[]): Ref => ({
      __kind: 'collection',
      path: segments.join('/'),
    }),
    doc: (_a: unknown, ...rest: string[]): Ref => ({
      __kind: 'doc',
      id: rest[rest.length - 1],
      path: rest.join('/'),
    }),
    addDoc: (...args: unknown[]) => addDocMock(...args),
  };
});

import { addItem } from './api';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('addItem — main-pool submissions land pending (specs/d15-approvals.md)', () => {
  it('writes status: "pending" (not "active") alongside pool: "main"', async () => {
    await addItem('u1', 'Wore Crocs to dinner', false);

    expect(addDocMock).toHaveBeenCalledTimes(1);
    const [, payload] = addDocMock.mock.calls[0] as [Ref, Record<string, unknown>];
    expect(payload).toMatchObject({
      text: 'Wore Crocs to dinner',
      createdBy: 'u1',
      status: 'pending',
      pool: 'main',
      reportCount: 0,
      spicy: false,
    });
  });

  it('preserves the spicy flag the submitter checked', async () => {
    await addItem('u1', 'A spicy one', true);
    const [, payload] = addDocMock.mock.calls[0] as [Ref, Record<string, unknown>];
    expect(payload).toMatchObject({ status: 'pending', spicy: true });
  });

  it('a blank/whitespace-only submission never calls addDoc', async () => {
    await addItem('u1', '   ');
    expect(addDocMock).not.toHaveBeenCalled();
  });
});
