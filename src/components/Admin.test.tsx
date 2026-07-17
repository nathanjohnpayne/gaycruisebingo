import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { DayDef, EventDoc, ItemDoc } from '../types';

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
  adminAddItem: vi.fn((..._a: unknown[]) => Promise.resolve()),
  adminUpdateItemText: vi.fn((..._a: unknown[]) => Promise.resolve()),
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
  setDayTheme: vi.fn(),
  setPhotoProofSource: vi.fn(),
  setStripPhotoExif: vi.fn(),
  setVisionGate: vi.fn(),
  setReportHideThreshold: vi.fn(),
  setEasyMixRatio: vi.fn(),
  banUser: vi.fn(),
  unbanUser: vi.fn(),
  unlockDayNow: vi.fn(),
  resnapshotDayNow: vi.fn(),
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
  adminAddItem: (...a: unknown[]) => H.adminAddItem(...a),
  adminUpdateItemText: (...a: unknown[]) => H.adminUpdateItemText(...a),
  setClaimMode: (...a: unknown[]) => H.setClaimMode(...a),
  setEventTheme: (...a: unknown[]) => H.setEventTheme(...a),
  setDayTheme: (...a: unknown[]) => H.setDayTheme(...a),
  setPhotoProofSource: (...a: unknown[]) => H.setPhotoProofSource(...a),
  setStripPhotoExif: (...a: unknown[]) => H.setStripPhotoExif(...a),
  setVisionGate: (...a: unknown[]) => H.setVisionGate(...a),
  setReportHideThreshold: (...a: unknown[]) => H.setReportHideThreshold(...a),
  setEasyMixRatio: (...a: unknown[]) => H.setEasyMixRatio(...a),
  banUser: (...a: unknown[]) => H.banUser(...a),
  unbanUser: (...a: unknown[]) => H.unbanUser(...a),
  unlockDayNow: (...a: unknown[]) => H.unlockDayNow(...a),
  resnapshotDayNow: (...a: unknown[]) => H.resnapshotDayNow(...a),
}));
vi.mock('../data/proofs', () => ({ deleteProof: (...a: unknown[]) => H.deleteProof(...a) }));
vi.mock('../theme/themes', () => ({
  THEMES: [
    { id: 'neon-playground', emoji: '🎉', label: 'Neon' },
    { id: 'duty-free', emoji: '✈️', label: 'Duty Free' },
  ],
}));
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

const dayDef = (over: Partial<DayDef> = {}): DayDef => ({
  index: 0,
  date: '2026-07-16',
  port: 'Split',
  portEmoji: '🇭🇷',
  theme: 'neon-playground',
  pool: 'main',
  tutorial: false,
  unlockAt: Date.now() + 3600_000, // future by default — enabled
  ...over,
});

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

describe('Admin Schedule tab (specs/d15-admin-schedule.md)', () => {
  it('shows exactly the seeded Days in order, one row per Day', () => {
    H.event = {
      ...H.event,
      days: [dayDef({ index: 0, date: '2026-07-15', port: 'Trieste', portEmoji: '🇮🇹' }), dayDef({ index: 1 })],
    } as unknown as EventDoc;
    render(<Admin />);
    fireEvent.click(screen.getByRole('button', { name: 'Schedule' }));

    expect(screen.getByText(/Day 1 · 2026-07-15 · 🇮🇹 Trieste/)).toBeInTheDocument();
    expect(screen.getByText(/Day 2 · 2026-07-16 · 🇭🇷 Split/)).toBeInTheDocument();
  });

  it("a future Day's theme dropdown is enabled and invokes setDayTheme(days, dayIndex, theme) on change", () => {
    const days = [dayDef({ index: 0, unlockAt: Date.now() + 3600_000 })];
    H.event = { ...H.event, days } as unknown as EventDoc;
    render(<Admin />);
    fireEvent.click(screen.getByRole('button', { name: 'Schedule' }));

    const select = screen.getByLabelText('Day 1 theme') as HTMLSelectElement;
    expect(select.disabled).toBe(false);
    fireEvent.change(select, { target: { value: 'duty-free' } });
    expect(H.setDayTheme).toHaveBeenCalledWith(days, 0, 'duty-free');
  });

  it("a past/unlocked Day's theme dropdown is disabled", () => {
    const days = [dayDef({ index: 0, unlockAt: Date.now() - 3600_000 })];
    H.event = { ...H.event, days } as unknown as EventDoc;
    render(<Admin />);
    fireEvent.click(screen.getByRole('button', { name: 'Schedule' }));

    const select = screen.getByLabelText('Day 1 theme') as HTMLSelectElement;
    expect(select.disabled).toBe(true);
  });

  it('an "Unlock now" button appears ONLY for a Day that is unlocked but not yet snapshot-stamped, and invokes unlockDayNow(dayIndex)', async () => {
    H.unlockDayNow.mockResolvedValue('stamped');
    const days = [
      // due: unlocked, no snapshotItemIds yet — scheduler lag/failure.
      dayDef({ index: 0, unlockAt: Date.now() - 3600_000, snapshotItemIds: undefined }),
      // not due: still locked (future unlockAt).
      dayDef({ index: 1, unlockAt: Date.now() + 3600_000 }),
      // not due: unlocked AND already snapshot-stamped (the normal, healthy state).
      dayDef({ index: 2, unlockAt: Date.now() - 3600_000, snapshotItemIds: ['item-1'] }),
    ];
    H.event = { ...H.event, days } as unknown as EventDoc;
    render(<Admin />);
    fireEvent.click(screen.getByRole('button', { name: 'Schedule' }));

    expect(screen.getAllByRole('button', { name: 'Unlock now' })).toHaveLength(1);
    const dueRow = screen.getByText(/Day 1 ·/).closest('.row') as HTMLElement;
    expect(within(dueRow).getByRole('button', { name: 'Unlock now' })).toBeInTheDocument();
    const lockedRow = screen.getByText(/Day 2 ·/).closest('.row') as HTMLElement;
    expect(within(lockedRow).queryByRole('button', { name: 'Unlock now' })).toBeNull();
    const stampedRow = screen.getByText(/Day 3 ·/).closest('.row') as HTMLElement;
    expect(within(stampedRow).queryByRole('button', { name: 'Unlock now' })).toBeNull();

    fireEvent.click(within(dueRow).getByRole('button', { name: 'Unlock now' }));
    expect(H.unlockDayNow).toHaveBeenCalledWith(0);
    expect(await within(dueRow).findByText('Unlocked.')).toBeInTheDocument();
  });

  it('a failed unlockDayNow call surfaces an error message on the row instead of throwing', async () => {
    H.unlockDayNow.mockRejectedValue(new Error('permission-denied'));
    const days = [dayDef({ index: 0, unlockAt: Date.now() - 3600_000, snapshotItemIds: undefined })];
    H.event = { ...H.event, days } as unknown as EventDoc;
    render(<Admin />);
    fireEvent.click(screen.getByRole('button', { name: 'Schedule' }));

    fireEvent.click(screen.getByRole('button', { name: 'Unlock now' }));
    expect(await screen.findByText('permission-denied')).toBeInTheDocument();
  });
});

describe('Admin Proof & Claims panel (specs/d15-admin-proof-claims.md)', () => {
  // Scope every query to the panel's own `.admin-section` — the page also has
  // an unrelated "Pending claims" section sharing this row's label text.
  const panel = () => screen.getByText('Proof & Claims').closest('.admin-section') as HTMLElement;
  const row = (label: string) => within(panel()).getByText(label).closest('.row') as HTMLElement;

  it('renders its knob rows reflecting current EventDoc values, with the ADR 0001 caption and no "verified" language', () => {
    H.event = {
      ...H.event,
      claimMode: 'proof_required',
      settings: { reportHideThreshold: 6, photoProofSource: 'camera_only', stripPhotoExif: false, visionGate: false },
    } as unknown as EventDoc;
    H.claims = [{ id: 'c1', displayName: 'Alice', itemText: 'Do a thing' } as never];
    render(<Admin />);
    expect(within(row('Claim mode')).getByRole('button', { name: 'Proof-to-mark' })).toHaveClass('on');
    expect(within(row('Claim mode')).getByText('A friction knob, not a trust level.')).toBeInTheDocument();
    expect(within(row('Photo proof source')).getByRole('button', { name: 'Camera only' })).toHaveClass('on');
    expect((within(row('Strip location data')).getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
    expect((within(row('AI image screen')).getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
    // #268: the setting is live now — the old 'presentational' caveat is gone.
    expect(row('AI image screen').textContent).toMatch(/live setting/i);
    expect(within(row('Auto-hide after reports')).getByText('6')).toBeInTheDocument();
    // #269 (the wireframes' caption): the Pending-claims row is admin_confirmed-
    // mode-only — absent here (proof_required).
    expect(within(panel()).queryByText('Pending claims')).toBeNull();
    expect(panel().textContent).not.toMatch(/verified/i);
  });

  it('each control writes via its data/admin.ts function on change, exercising the settings defaults when unset', () => {
    render(<Admin />); // H.event.settings has no photoProofSource/stripPhotoExif/visionGate — exercises defaults
    expect(within(row('Photo proof source')).getByRole('button', { name: 'Camera or library' })).toHaveClass('on');
    expect((within(row('Strip location data')).getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
    expect((within(row('AI image screen')).getByRole('checkbox') as HTMLInputElement).checked).toBe(true);

    fireEvent.click(within(row('Claim mode')).getByRole('button', { name: 'Admin-confirmed' }));
    expect(H.setClaimMode).toHaveBeenCalledWith('admin_confirmed');
    fireEvent.click(within(row('Photo proof source')).getByRole('button', { name: 'Camera only' }));
    expect(H.setPhotoProofSource).toHaveBeenCalledWith('camera_only');
    fireEvent.click(within(row('Strip location data')).getByRole('checkbox'));
    expect(H.setStripPhotoExif).toHaveBeenCalledWith(false);
    fireEvent.click(within(row('AI image screen')).getByRole('checkbox'));
    expect(H.setVisionGate).toHaveBeenCalledWith(false);
  });

  it('the report-threshold stepper reads the current value and +/- invoke setReportHideThreshold', () => {
    H.event = { ...H.event, settings: { reportHideThreshold: 4 } } as unknown as EventDoc;
    render(<Admin />);
    const stepperRow = row('Auto-hide after reports');
    expect(within(stepperRow).getByText('4')).toBeInTheDocument();
    fireEvent.click(within(stepperRow).getByRole('button', { name: 'Increase auto-hide threshold' }));
    expect(H.setReportHideThreshold).toHaveBeenCalledWith(5);
    fireEvent.click(within(stepperRow).getByRole('button', { name: 'Decrease auto-hide threshold' }));
    expect(H.setReportHideThreshold).toHaveBeenCalledWith(3);
  });

  it('the Easy mix control (specs/easy-mix.md) reflects easyMixRatio and writes via setEasyMixRatio', () => {
    // A stored 0.25 → the 25% step is on; the 0.5 default is used when unset.
    H.event = { ...H.event, settings: { reportHideThreshold: 4, easyMixRatio: 0.25 } } as unknown as EventDoc;
    render(<Admin />);
    const mixRow = row('Easy mix');
    expect(within(mixRow).getByRole('button', { name: '25%' })).toHaveClass('on');
    fireEvent.click(within(mixRow).getByRole('button', { name: '50%' }));
    expect(H.setEasyMixRatio).toHaveBeenCalledWith(0.5);
    fireEvent.click(within(mixRow).getByRole('button', { name: '0%' }));
    expect(H.setEasyMixRatio).toHaveBeenCalledWith(0);
  });

  it('the Easy mix control defaults to 50% when easyMixRatio is unset', () => {
    render(<Admin />); // H.event.settings has no easyMixRatio
    expect(within(row('Easy mix')).getByRole('button', { name: '50%' })).toHaveClass('on');
  });

  // Legacy negative threshold (isReportHidden treats non-positive as "no filtering"):
  // BOTH steps must clamp to a floor of 1, not just decrement (Codex P2, PR #245).
  it('the stepper floors at 1 on both steps for an already-negative threshold', () => {
    H.event = { ...H.event, settings: { reportHideThreshold: -2 } } as unknown as EventDoc;
    render(<Admin />);
    const stepperRow = row('Auto-hide after reports');
    const decrement = within(stepperRow).getByRole('button', { name: 'Decrease auto-hide threshold' }) as HTMLButtonElement;
    expect(decrement.disabled).toBe(true);
    fireEvent.click(decrement);
    expect(H.setReportHideThreshold).not.toHaveBeenCalled();
    fireEvent.click(within(stepperRow).getByRole('button', { name: 'Increase auto-hide threshold' }));
    expect(H.setReportHideThreshold).toHaveBeenCalledWith(1);
  });

  it("the Pending claims row's count matches usePendingClaims() and its jump link targets #admin-pending-claims", () => {
    // #269: the row renders in admin_confirmed mode only.
    H.event = { ...H.event, claimMode: 'admin_confirmed' } as unknown as EventDoc;
    H.claims = [
      { id: 'c1', displayName: 'Alice', itemText: 'Do a thing' } as never,
      { id: 'c2', displayName: 'Bob', itemText: 'Do another thing' } as never,
    ];
    render(<Admin />);
    const pendingRow = row('Pending claims');
    expect(within(pendingRow).getByText('2')).toBeInTheDocument();
    expect(within(pendingRow).getByRole('link', { name: /jump to queue/i })).toHaveAttribute(
      'href',
      '#admin-pending-claims',
    );
  });
});

describe('Admin curated pools (#269)', () => {
  it('the add form writes an active prompt into the chosen pool via adminAddItem', async () => {
    render(<Admin />);
    const input = screen.getByLabelText('New prompt text') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Final soft-serve encore' } });
    fireEvent.change(screen.getByLabelText('Pool'), { target: { value: 'farewell' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await Promise.resolve();
    expect(H.adminAddItem).toHaveBeenCalledWith('admin-uid', 'Final soft-serve encore', false, 'farewell');
  });

  it('forces embark/farewell prompt additions to stay tame even after 🔞 was checked on main', async () => {
    render(<Admin />);
    const input = screen.getByLabelText('New prompt text') as HTMLInputElement;
    const spicy = screen.getByRole('checkbox', { name: /🔞/ }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Embark icebreaker' } });
    fireEvent.click(spicy);
    expect(spicy.checked).toBe(true);

    fireEvent.change(screen.getByLabelText('Pool'), { target: { value: 'embark' } });
    expect(spicy.checked).toBe(false);
    expect(spicy.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await Promise.resolve();
    expect(H.adminAddItem).toHaveBeenCalledWith('admin-uid', 'Embark icebreaker', false, 'embark');
  });

  it('the inline edit saves via adminUpdateItemText and shows the pool pill', async () => {
    H.items = [
      { id: 'i1', text: 'Original wording', createdBy: 'u1', createdAt: 1, isFreeSpace: false, status: 'active', reportCount: 0, spicy: false, pool: 'embark' } as unknown as ItemDoc,
    ];
    render(<Admin />);
    // The row's sub line names its pool — the curated pools are visible.
    expect(screen.getByText(/active · embark/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByTitle('Edit text')[0]);
    const edit = screen.getByLabelText('Edit prompt text') as HTMLInputElement;
    fireEvent.change(edit, { target: { value: 'Sharper wording' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await Promise.resolve();
    expect(H.adminUpdateItemText).toHaveBeenCalledWith(expect.any(String), 'Sharper wording');
  });
});
