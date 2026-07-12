import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { EventDoc, ItemDoc } from '../types';

// specs/d15-approvals.md, component layer (RTL-jsdom). Drives the REAL Admin
// console with the data boundary stubbed, focused on the NEW Approvals tab
// (#210) — the existing Moderation-tab coverage (report queue, bans, claim
// mode, theme, pending claims, the full Prompts list) is already pinned in
// src/components/w2-admin-console.test.tsx and is not re-asserted here.
//
// Proves: the tab defaults to Moderation with Approvals reachable by a click;
// the Approvals tab lists pending items with submitter attribution; Approve
// invokes approveItem(id, adminUid); Reject invokes rejectItem(id, adminUid);
// and Approve all invokes bulkApproveItems with every listed row.

const H = vi.hoisted(() => ({
  user: { uid: 'admin-uid' } as { uid: string } | null,
  event: {
    admins: ['admin-uid'],
    settings: { reportHideThreshold: 4 },
    claimMode: 'honor',
    defaultTheme: 'neon-playground',
  } as unknown as EventDoc,
  claims: [] as unknown[],
  flagged: [] as unknown[],
  items: [] as ItemDoc[],
  pendingItems: [] as ItemDoc[],
  approveItem: vi.fn(),
  rejectItem: vi.fn(),
  bulkApproveItems: vi.fn(),
  setItemSpicy: vi.fn(),
  hideItem: vi.fn(),
  restoreItem: vi.fn(),
  deleteItem: vi.fn(),
  clearItemReports: vi.fn(),
  deleteProof: vi.fn(),
  confirmClaim: vi.fn(),
  rejectClaim: vi.fn(),
  hideProof: vi.fn(),
  restoreProof: vi.fn(),
  clearProofReports: vi.fn(),
  setClaimMode: vi.fn(),
  setEventTheme: vi.fn(),
  banUser: vi.fn(),
  unbanUser: vi.fn(),
}));

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
    onSnapshot: vi.fn(() => () => {}),
  };
});

vi.mock('../hooks/useData', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/useData')>();
  return {
    ...actual,
    useEventDoc: () => ({ data: H.event, loading: false, hasServerData: true }),
    usePendingClaims: () => ({ claims: H.claims }),
    usePendingItems: () => ({ items: H.pendingItems, loading: false }),
    useReportedProofs: () => ({ flagged: H.flagged, loading: false }),
    useAllItems: () => ({ items: H.items, loading: false }),
  };
});
vi.mock('../data/admin', () => ({
  confirmClaim: (...a: unknown[]) => H.confirmClaim(...a),
  rejectClaim: (...a: unknown[]) => H.rejectClaim(...a),
  hideProof: (...a: unknown[]) => H.hideProof(...a),
  restoreProof: (...a: unknown[]) => H.restoreProof(...a),
  clearProofReports: (...a: unknown[]) => H.clearProofReports(...a),
  hideItem: (...a: unknown[]) => H.hideItem(...a),
  restoreItem: (...a: unknown[]) => H.restoreItem(...a),
  deleteItem: (...a: unknown[]) => H.deleteItem(...a),
  clearItemReports: (...a: unknown[]) => H.clearItemReports(...a),
  approveItem: (...a: unknown[]) => H.approveItem(...a),
  rejectItem: (...a: unknown[]) => H.rejectItem(...a),
  bulkApproveItems: (...a: unknown[]) => H.bulkApproveItems(...a),
  setItemSpicy: (...a: unknown[]) => H.setItemSpicy(...a),
  setClaimMode: (...a: unknown[]) => H.setClaimMode(...a),
  setEventTheme: (...a: unknown[]) => H.setEventTheme(...a),
  banUser: (...a: unknown[]) => H.banUser(...a),
  unbanUser: (...a: unknown[]) => H.unbanUser(...a),
}));
vi.mock('../data/proofs', () => ({ deleteProof: (...a: unknown[]) => H.deleteProof(...a) }));
vi.mock('../theme/themes', () => ({ THEMES: [{ id: 'neon-playground', emoji: '🎉', label: 'Neon' }] }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user: H.user }) }));

import Admin from './Admin';

const pendingItem = (id: string, over: Partial<ItemDoc> = {}): ItemDoc =>
  ({
    id,
    text: `prompt ${id}`,
    createdBy: `u-${id}`,
    createdAt: 1,
    isFreeSpace: false,
    status: 'pending',
    reportCount: 0,
    spicy: false,
    pool: 'main',
    ...over,
  }) as ItemDoc;

beforeEach(() => {
  vi.clearAllMocks();
  H.user = { uid: 'admin-uid' };
  H.event = {
    admins: ['admin-uid'],
    settings: { reportHideThreshold: 4 },
    claimMode: 'honor',
    defaultTheme: 'neon-playground',
  } as unknown as EventDoc;
  H.claims = [];
  H.flagged = [];
  H.items = [];
  H.pendingItems = [];
});

describe('Admin Approvals tab (specs/d15-approvals.md)', () => {
  it('defaults to Moderation; the Approvals queue is reachable by clicking the Approvals sub-tab', () => {
    H.pendingItems = [pendingItem('p1', { text: 'Awaiting review', createdBy: 'alice' })];
    render(<Admin />);

    expect(screen.queryByText('Awaiting review')).toBeNull(); // not shown on Moderation by default
    fireEvent.click(screen.getByRole('button', { name: 'Approvals' }));
    expect(screen.getByText('Awaiting review')).toBeInTheDocument();
  });

  it('lists pending items with submitter attribution', () => {
    H.pendingItems = [pendingItem('p1', { text: 'A spicy dare', createdBy: 'alice-uid' })];
    render(<Admin />);
    fireEvent.click(screen.getByRole('button', { name: 'Approvals' }));

    expect(screen.getByText('A spicy dare')).toBeInTheDocument();
    expect(screen.getByText(/alice-uid/)).toBeInTheDocument();
  });

  it('Approve invokes approveItem(id, adminUid)', () => {
    H.pendingItems = [pendingItem('p1', { text: 'Approve me' })];
    render(<Admin />);
    fireEvent.click(screen.getByRole('button', { name: 'Approvals' }));

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(H.approveItem).toHaveBeenCalledWith('p1', 'admin-uid');
  });

  it('Reject invokes rejectItem(id, adminUid)', () => {
    H.pendingItems = [pendingItem('p1', { text: 'Reject me' })];
    render(<Admin />);
    fireEvent.click(screen.getByRole('button', { name: 'Approvals' }));

    fireEvent.click(screen.getByTitle('Reject'));
    expect(H.rejectItem).toHaveBeenCalledWith('p1', 'admin-uid');
  });

  it('bulk-approve ("Approve all") invokes bulkApproveItems with every listed row', () => {
    H.pendingItems = [pendingItem('p1', { text: 'Row one' }), pendingItem('p2', { text: 'Row two' })];
    render(<Admin />);
    fireEvent.click(screen.getByRole('button', { name: 'Approvals' }));

    fireEvent.click(screen.getByRole('button', { name: 'Approve all' }));
    expect(H.bulkApproveItems).toHaveBeenCalledWith(H.pendingItems, 'admin-uid');
  });

  it('an empty pending queue shows "Nothing pending review." and no Approve all control', () => {
    H.pendingItems = [];
    render(<Admin />);
    fireEvent.click(screen.getByRole('button', { name: 'Approvals' }));

    expect(screen.getByText(/nothing pending review/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve all' })).toBeNull();
  });

  it('the spicy checkbox toggle invokes setItemSpicy(id, checked)', () => {
    H.pendingItems = [pendingItem('p1', { text: 'Toggle me', spicy: false })];
    render(<Admin />);
    fireEvent.click(screen.getByRole('button', { name: 'Approvals' }));

    const row = screen.getByText('Toggle me').closest('.row') as HTMLElement;
    fireEvent.click(within(row).getByRole('checkbox'));
    expect(H.setItemSpicy).toHaveBeenCalledWith('p1', true);
  });
});
