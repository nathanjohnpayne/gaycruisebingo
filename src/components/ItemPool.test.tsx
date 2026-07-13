import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { ItemDoc } from '../types';

// specs/d15-approvals.md, component layer (RTL-jsdom). Drives the REAL ItemPool
// with the data boundary (useData hooks + data/api writes) stubbed. Proves: a
// submission calls the (now-pending) addItem write; the "goes to admin review"
// caption renders alongside the existing pre-sail note (additive, not a
// replacement); and the submitter's own pending item — invisible via useItems,
// only reachable via useMyPendingItems — still renders in their list, tagged
// "pending review".

const H = vi.hoisted(() => ({
  user: { uid: 'u1' } as { uid: string } | null,
  items: [] as ItemDoc[],
  myPending: [] as ItemDoc[],
  addItem: vi.fn(),
  reportItem: vi.fn(),
}));

vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user: H.user }) }));
vi.mock('../hooks/useData', () => ({
  // #264: day-meta honor reads — inert stubs (no pinned honors).
  useDayMeta: () => ({ data: null, loading: false, hasServerData: true }),
  useDayMetas: () => new Map(),
  useItems: () => ({ items: H.items, loading: false }),
  useMyPendingItems: () => ({ items: H.myPending, loading: false }),
}));
vi.mock('../data/api', () => ({
  addItem: (...a: unknown[]) => H.addItem(...a),
  reportItem: (...a: unknown[]) => H.reportItem(...a),
  checkItemRateLimit: () => true,
  itemRateLimitRemainingMs: () => 0,
}));
vi.mock('../analytics', () => ({ track: vi.fn() }));

import ItemPool from './ItemPool';

const item = (id: string, over: Partial<ItemDoc> = {}): ItemDoc =>
  ({
    id,
    text: `prompt ${id}`,
    createdBy: 'u1',
    createdAt: 1,
    isFreeSpace: false,
    status: 'active',
    reportCount: 0,
    spicy: false,
    pool: 'main',
    ...over,
  }) as ItemDoc;

beforeEach(() => {
  vi.clearAllMocks();
  H.user = { uid: 'u1' };
  H.items = [];
  H.myPending = [];
});

describe('ItemPool submission (specs/d15-approvals.md)', () => {
  it('calls addItem (which now lands status: "pending" — pinned at the data layer)', () => {
    render(<ItemPool />);
    fireEvent.change(screen.getByPlaceholderText('Add a prompt…'), {
      target: { value: 'A new prompt' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(H.addItem).toHaveBeenCalledWith('u1', 'A new prompt', false);
  });

  it('renders the "goes to admin review" caption alongside the existing pre-sail note', () => {
    render(<ItemPool />);
    expect(screen.getByText(/admin review/i)).toBeInTheDocument();
    expect(screen.getByText(/once your card is dealt it's frozen/i)).toBeInTheDocument();
  });
});

describe("A submitter's own pending item (specs/d15-approvals.md)", () => {
  it('renders in their list, tagged "pending review" — invisible via useItems alone', () => {
    H.items = [item('active-1', { text: 'Already live prompt' })];
    H.myPending = [item('pending-1', { text: 'My awaiting prompt', status: 'pending' })];
    render(<ItemPool />);

    expect(screen.getByText('Already live prompt')).toBeInTheDocument();
    const pendingRow = screen.getByText('My awaiting prompt').closest('.row') as HTMLElement;
    expect(within(pendingRow).getByText(/pending review/i)).toBeInTheDocument();
  });

  it('does not silently vanish after Add: an empty active pool still surfaces the pending row', () => {
    H.items = [];
    H.myPending = [item('pending-1', { text: 'Just submitted', status: 'pending' })];
    render(<ItemPool />);
    expect(screen.getByText('Just submitted')).toBeInTheDocument();
  });
});
