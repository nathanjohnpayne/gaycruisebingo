import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { EventDoc, ItemDoc, ProofDoc } from '../types';

// specs/w2-admin-console.md, component layer (RTL-jsdom). Drives the REAL Admin
// console with the data boundary (useData hooks + the admin/proofs write modules)
// stubbed. Proves: the report queue is surfaced (via useReportedProofs + the
// reported Prompts derived from useAllItems); a threshold-hidden row is REACHABLE
// there and tagged "auto-hidden" (through the REAL isReportHidden, kept via
// importOriginal, not a re-implementation); the moderation controls on a
// threshold-hidden row invoke the data/admin writes — so an Admin can restore or
// delete content the ADR 0004 Phase 0 community hide removed from every Player's
// Feed. No ban control is rendered: no ban surface exists in firestore.rules yet
// (documented in the spec's Self-review; deferred to a rules-owned follow-up).

const H = vi.hoisted(() => ({
  user: { uid: 'admin-uid' } as { uid: string } | null,
  event: {
    admins: ['admin-uid'],
    settings: { reportHideThreshold: 4 },
    claimMode: 'honor',
    defaultTheme: 'neon-playground',
  } as unknown as EventDoc,
  claims: [] as unknown[],
  flagged: [] as ProofDoc[],
  items: [] as ItemDoc[],
  hideProof: vi.fn(),
  restoreProof: vi.fn(),
  hideItem: vi.fn(),
  restoreItem: vi.fn(),
  deleteItem: vi.fn(),
  deleteProof: vi.fn(),
  confirmClaim: vi.fn(),
  rejectClaim: vi.fn(),
  setClaimMode: vi.fn(),
  setEventTheme: vi.fn(),
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

// Keep the REAL isReportHidden (the auto-hidden boundary under test) — override
// only the subscription hooks the console reads.
vi.mock('../hooks/useData', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/useData')>();
  return {
    ...actual,
    useEventDoc: () => ({ data: H.event, loading: false, hasServerData: true }),
    usePendingClaims: () => ({ claims: H.claims }),
    useReportedProofs: () => ({ flagged: H.flagged, loading: false }),
    useAllItems: () => ({ items: H.items, loading: false }),
  };
});
vi.mock('../data/admin', () => ({
  confirmClaim: (...a: unknown[]) => H.confirmClaim(...a),
  rejectClaim: (...a: unknown[]) => H.rejectClaim(...a),
  hideProof: (...a: unknown[]) => H.hideProof(...a),
  restoreProof: (...a: unknown[]) => H.restoreProof(...a),
  hideItem: (...a: unknown[]) => H.hideItem(...a),
  restoreItem: (...a: unknown[]) => H.restoreItem(...a),
  deleteItem: (...a: unknown[]) => H.deleteItem(...a),
  setClaimMode: (...a: unknown[]) => H.setClaimMode(...a),
  setEventTheme: (...a: unknown[]) => H.setEventTheme(...a),
}));
vi.mock('../data/proofs', () => ({ deleteProof: (...a: unknown[]) => H.deleteProof(...a) }));
vi.mock('../theme/themes', () => ({ THEMES: [{ id: 'neon-playground', emoji: '🎉', label: 'Neon' }] }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user: H.user }) }));

import Admin from './Admin';

const proof = (id: string, reportCount: number, over: Partial<ProofDoc> = {}): ProofDoc =>
  ({
    id,
    uid: `u-${id}`,
    displayName: id,
    photoURL: null,
    type: 'text',
    cellIndex: 0,
    itemText: `prompt ${id}`,
    storagePath: null,
    mediaURL: null,
    thumbURL: null,
    text: 'x',
    createdAt: 1,
    reportCount,
    status: 'active',
    visionFlag: null,
    ...over,
  }) as ProofDoc;

const item = (id: string, reportCount: number, over: Partial<ItemDoc> = {}): ItemDoc =>
  ({
    id,
    text: `prompt ${id}`,
    createdBy: `u-${id}`,
    createdAt: 1,
    isFreeSpace: false,
    status: 'active',
    reportCount,
    ...over,
  }) as ItemDoc;

const queue = () => document.querySelector('.admin-section.queue') as HTMLElement;

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
});

describe('Admin gate', () => {
  it('shows "Admins only." to a non-admin and renders no report queue', () => {
    H.user = { uid: 'rando' };
    render(<Admin />);
    expect(screen.getByText(/admins only/i)).toBeInTheDocument();
    expect(queue()).toBeNull();
  });
});

describe('Report queue (specs/w2-admin-console.md)', () => {
  it('lists a reported Proof with its report count', () => {
    H.flagged = [proof('p1', 2, { displayName: 'Barnacle Betty', itemText: 'Wore Crocs to dinner' })];
    render(<Admin />);

    const q = within(queue());
    expect(q.getByText(/Report queue \(1\)/)).toBeInTheDocument();
    expect(q.getByText('Barnacle Betty')).toBeInTheDocument();
    expect(q.getByText(/2 ⚑/)).toBeInTheDocument();
  });

  it('tags a threshold-hidden row "auto-hidden" and leaves a below-threshold row untagged (real isReportHidden at the boundary)', () => {
    // Threshold is 4: reportCount 4 is AT the threshold (hidden), 2 is below.
    H.flagged = [
      proof('over', 4, { displayName: 'Over Threshold' }),
      proof('under', 2, { displayName: 'Under Threshold' }),
    ];
    render(<Admin />);

    const overRow = screen.getByText('Over Threshold').closest('.row') as HTMLElement;
    const underRow = screen.getByText('Under Threshold').closest('.row') as HTMLElement;
    expect(within(overRow).getByText(/auto-hidden/i)).toBeInTheDocument();
    expect(within(underRow).queryByText(/auto-hidden/i)).toBeNull();
  });

  it('restore reaches a threshold-hidden Proof — clicking Restore invokes the data/admin write', () => {
    // A Proof both hard-hidden (status) AND over the community threshold: it is
    // gone from every Player's Feed, yet reachable here so an Admin can restore it.
    H.flagged = [proof('buried', 5, { status: 'hidden', displayName: 'Buried Proof' })];
    render(<Admin />);

    const q = within(queue());
    expect(q.getByText(/auto-hidden/i)).toBeInTheDocument(); // 5 ≥ 4
    fireEvent.click(q.getByRole('button', { name: 'Restore' }));
    expect(H.restoreProof).toHaveBeenCalledWith('buried');
  });

  it('deletes a threshold-hidden Proof through the queue', () => {
    H.flagged = [proof('gone', 9, { displayName: 'Deleteme', storagePath: 'proofs/e/u/gone.jpg' })];
    render(<Admin />);

    fireEvent.click(within(queue()).getByTitle('Delete'));
    expect(H.deleteProof).toHaveBeenCalledWith('gone', 'proofs/e/u/gone.jpg');
  });

  it('surfaces reported Prompts in the queue and omits unreported ones', () => {
    H.items = [
      item('i1', 3, { text: 'Reported prompt' }),
      item('i2', 0, { text: 'Clean prompt' }),
    ];
    render(<Admin />);

    const q = within(queue());
    expect(q.getByText('Reported prompt')).toBeInTheDocument();
    expect(q.queryByText('Clean prompt')).toBeNull(); // unreported, active → not queued
  });

  it('renders NO ban control — no ban surface exists in the rules yet (documented skip)', () => {
    H.flagged = [proof('p1', 4, { displayName: 'Someone' })];
    render(<Admin />);
    expect(screen.queryByRole('button', { name: /ban/i })).toBeNull();
  });
});
