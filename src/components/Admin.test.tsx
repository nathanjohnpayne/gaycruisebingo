import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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
  setDayTonight: vi.fn(),
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
  setDayTonight: (...a: unknown[]) => H.setDayTonight(...a),
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

// The console is route-driven now (specs/admin-console-ia.md): each surface
// mounts at /more/admin[/section], so every render pins the section under test
// via the router instead of clicking the retired sub-tabs.
const renderAdmin = (path = '/more/admin') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Admin />
    </MemoryRouter>,
  );

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
  tonight: [],
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

describe('Admin Approvals group (specs/d15-approvals.md, re-housed in the Review queue)', () => {
  it('is not on the hub; the hub card opens the Review queue where the pending row lists', () => {
    H.pendingItems = [pendingItem('p1', { text: 'Awaiting review', createdBy: 'alice' })];
    renderAdmin('/more/admin');

    expect(screen.queryByText('Awaiting review')).toBeNull(); // the hub shows cards, not queue rows
    fireEvent.click(screen.getByRole('button', { name: /Review queue/ }));
    expect(screen.getByText('Awaiting review')).toBeInTheDocument();
  });

  it('lists pending items with submitter attribution', () => {
    H.pendingItems = [pendingItem('p1', { text: 'A spicy dare', createdBy: 'alice-uid' })];
    renderAdmin('/more/admin/queue');

    expect(screen.getByText('A spicy dare')).toBeInTheDocument();
    expect(screen.getByText(/alice-uid/)).toBeInTheDocument();
  });

  it('Approve invokes approveItem(id, adminUid)', () => {
    H.pendingItems = [pendingItem('p1', { text: 'Approve me' })];
    renderAdmin('/more/admin/queue');

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(H.approveItem).toHaveBeenCalledWith('p1', 'admin-uid');
  });

  it('Reject invokes rejectItem(id, adminUid)', () => {
    H.pendingItems = [pendingItem('p1', { text: 'Reject me' })];
    renderAdmin('/more/admin/queue');

    fireEvent.click(screen.getByTitle('Reject'));
    expect(H.rejectItem).toHaveBeenCalledWith('p1', 'admin-uid');
  });

  it('bulk-approve ("Approve all") invokes bulkApproveItems with every listed row', () => {
    H.pendingItems = [pendingItem('p1', { text: 'Row one' }), pendingItem('p2', { text: 'Row two' })];
    renderAdmin('/more/admin/queue');

    fireEvent.click(screen.getByRole('button', { name: 'Approve all' }));
    expect(H.bulkApproveItems).toHaveBeenCalledWith(H.pendingItems, 'admin-uid');
  });

  it('an empty Approvals group shows "Nothing pending review." and no Approve all control', () => {
    H.pendingItems = [];
    // A report keeps the queue non-empty overall, so the per-group empty state
    // (not the whole-inbox "All clear") renders.
    H.items = [pendingItem('r1', { text: 'Reported prompt', status: 'active', reportCount: 2 })];
    renderAdmin('/more/admin/queue');

    expect(screen.getByText(/nothing pending review/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve all' })).toBeNull();
  });

  it('an entirely empty inbox shows the wireframes’ "All clear. Go enjoy the boat."', () => {
    renderAdmin('/more/admin/queue');
    expect(screen.getByText(/All clear\. Go enjoy the boat\./)).toBeInTheDocument();
  });

  it('the spicy checkbox toggle invokes setItemSpicy(id, checked)', () => {
    H.pendingItems = [pendingItem('p1', { text: 'Toggle me', spicy: false })];
    renderAdmin('/more/admin/queue');

    const row = screen.getByText('Toggle me').closest('.row') as HTMLElement;
    fireEvent.click(within(row).getByRole('checkbox'));
    expect(H.setItemSpicy).toHaveBeenCalledWith('p1', true);
  });
});

describe('Admin Schedule surface (specs/d15-admin-schedule.md, at /more/admin/schedule)', () => {
  it('shows exactly the seeded Days in order, one row per Day', () => {
    H.event = {
      ...H.event,
      days: [dayDef({ index: 0, date: '2026-07-15', port: 'Trieste', portEmoji: '🇮🇹' }), dayDef({ index: 1 })],
    } as unknown as EventDoc;
    renderAdmin('/more/admin/schedule');

    expect(screen.getByText(/Day 1 · 2026-07-15 · 🇮🇹 Trieste/)).toBeInTheDocument();
    expect(screen.getByText(/Day 2 · 2026-07-16 · 🇭🇷 Split/)).toBeInTheDocument();
  });

  it("a future Day's theme dropdown is enabled and invokes setDayTheme(days, dayIndex, theme) on change", () => {
    const days = [dayDef({ index: 0, unlockAt: Date.now() + 3600_000 })];
    H.event = { ...H.event, days } as unknown as EventDoc;
    renderAdmin('/more/admin/schedule');

    const select = screen.getByLabelText('Day 1 theme') as HTMLSelectElement;
    expect(select.disabled).toBe(false);
    fireEvent.change(select, { target: { value: 'duty-free' } });
    expect(H.setDayTheme).toHaveBeenCalledWith(days, 0, 'duty-free');
  });

  it("a past/unlocked Day's theme dropdown is disabled", () => {
    const days = [dayDef({ index: 0, unlockAt: Date.now() - 3600_000 })];
    H.event = { ...H.event, days } as unknown as EventDoc;
    renderAdmin('/more/admin/schedule');

    const select = screen.getByLabelText('Day 1 theme') as HTMLSelectElement;
    expect(select.disabled).toBe(true);
  });

  it('renders a "2 parties" pill on a two-party Day and none on a show+party Day (schedule correction)', () => {
    const days = [
      // Both events are parties → pill.
      dayDef({ index: 0, tonight: ['🪖 Dog Tag T-Dance', '✈️ Duty Free'] }),
      // Headline show (🎭) + party → no pill.
      dayDef({ index: 1, tonight: ['🎭 AirOtic', '🌌 Under the Stars'] }),
      // Tutorial Day → its own "tutorial" pill, never "2 parties".
      dayDef({ index: 2, tutorial: true, pool: 'embark', tonight: ['⛵ Sail-Away Party', '🎉 Welcome Party'] }),
    ];
    H.event = { ...H.event, days } as unknown as EventDoc;
    renderAdmin('/more/admin/schedule');

    const twoPartyRow = screen.getByText(/Day 1 ·/).closest('.row') as HTMLElement;
    expect(within(twoPartyRow).getByText('2 parties')).toBeInTheDocument();
    const showRow = screen.getByText(/Day 2 ·/).closest('.row') as HTMLElement;
    expect(within(showRow).queryByText('2 parties')).toBeNull();
    const tutorialRow = screen.getByText(/Day 3 ·/).closest('.row') as HTMLElement;
    expect(within(tutorialRow).queryByText('2 parties')).toBeNull();
    expect(within(tutorialRow).getByText('tutorial')).toBeInTheDocument();
  });

  it("a future Day's Tonight line is editable and invokes setDayTonight(days, dayIndex, tonight) on blur", () => {
    const days = [dayDef({ index: 0, unlockAt: Date.now() + 3600_000, tonight: ['🪖 Dog Tag T-Dance', '✈️ Duty Free'] })];
    H.event = { ...H.event, days } as unknown as EventDoc;
    renderAdmin('/more/admin/schedule');

    const input = screen.getByLabelText('Day 1 tonight') as HTMLInputElement;
    expect(input.disabled).toBe(false);
    expect(input.value).toBe('🪖 Dog Tag T-Dance · ✈️ Duty Free');
    fireEvent.change(input, { target: { value: '💦 Splash T-Dance · 🏋️ Get Sporty' } });
    fireEvent.blur(input);
    expect(H.setDayTonight).toHaveBeenCalledWith(days, 0, ['💦 Splash T-Dance', '🏋️ Get Sporty']);
  });

  it('surfaces a failed Tonight save and restores the persisted line', async () => {
    H.setDayTonight.mockRejectedValueOnce(new Error('locked'));
    const days = [dayDef({ index: 0, unlockAt: Date.now() + 3600_000, tonight: ['🪖 Dog Tag T-Dance', '✈️ Duty Free'] })];
    H.event = { ...H.event, days } as unknown as EventDoc;
    renderAdmin('/more/admin/schedule');

    const input = screen.getByLabelText('Day 1 tonight') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '💦 Splash T-Dance · 🏋️ Get Sporty' } });
    fireEvent.blur(input);

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Tonight save failed.'));
    expect(input.value).toBe('🪖 Dog Tag T-Dance · ✈️ Duty Free');
  });

  it('rejects one- or three-entry Tonight drafts before calling setDayTonight', () => {
    const days = [dayDef({ index: 0, unlockAt: Date.now() + 3600_000, tonight: ['🪖 Dog Tag T-Dance', '✈️ Duty Free'] })];
    H.event = { ...H.event, days } as unknown as EventDoc;
    renderAdmin('/more/admin/schedule');

    const input = screen.getByLabelText('Day 1 tonight') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '💦 Splash T-Dance' } });
    fireEvent.blur(input);
    expect(screen.getByRole('alert')).toHaveTextContent('Tonight needs exactly two entries.');
    expect(H.setDayTonight).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: '💦 Splash T-Dance · 🏋️ Get Sporty · 🌌 Under the Stars' } });
    fireEvent.blur(input);
    expect(screen.getByRole('alert')).toHaveTextContent('Tonight needs exactly two entries.');
    expect(H.setDayTonight).not.toHaveBeenCalled();
  });

  it("a past/unlocked Day's Tonight line is disabled (corrected via the owner migration, not the editor)", () => {
    const days = [dayDef({ index: 0, unlockAt: Date.now() - 3600_000, tonight: ['🪖 Dog Tag T-Dance', '✈️ Duty Free'] })];
    H.event = { ...H.event, days } as unknown as EventDoc;
    renderAdmin('/more/admin/schedule');

    const input = screen.getByLabelText('Day 1 tonight') as HTMLInputElement;
    expect(input.disabled).toBe(true);
    fireEvent.blur(input);
    expect(H.setDayTonight).not.toHaveBeenCalled();
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
    renderAdmin('/more/admin/schedule');

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
    renderAdmin('/more/admin/schedule');

    fireEvent.click(screen.getByRole('button', { name: 'Unlock now' }));
    expect(await screen.findByText('permission-denied')).toBeInTheDocument();
  });
});

describe('Admin Game settings (specs/d15-admin-proof-claims.md rows, re-housed at /more/admin/settings)', () => {
  const row = (label: string) => screen.getByText(label).closest('.row') as HTMLElement;

  it('renders its knob rows reflecting current EventDoc values, with the ADR 0001 caption and no "verified" language', () => {
    H.event = {
      ...H.event,
      claimMode: 'proof_required',
      settings: { reportHideThreshold: 6, photoProofSource: 'camera_only', stripPhotoExif: false, visionGate: false },
    } as unknown as EventDoc;
    H.claims = [{ id: 'c1', displayName: 'Alice', itemText: 'Do a thing' } as never];
    renderAdmin('/more/admin/settings');
    expect(within(row('Claim mode')).getByRole('button', { name: 'Proof-to-mark' })).toHaveClass('on');
    expect(within(row('Claim mode')).getByText('A friction knob, not a trust level.')).toBeInTheDocument();
    expect(within(row('Photo proof source')).getByRole('button', { name: 'Camera only' })).toHaveClass('on');
    expect((within(row('Strip location data')).getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
    expect((within(row('AI image screen')).getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
    // #268: the setting is live now — the old 'presentational' caveat is gone.
    expect(row('AI image screen').textContent).toMatch(/live setting/i);
    expect(within(row('Auto-hide after reports')).getByText('6')).toBeInTheDocument();
    // The claims queue lives in the Review queue now (admin-console-ia) — the
    // settings surface never renders a Pending-claims row.
    expect(screen.queryByText('Pending claims')).toBeNull();
    expect(document.body.textContent).not.toMatch(/verified/i);
  });

  it('each control writes via its data/admin.ts function on change, exercising the settings defaults when unset', () => {
    renderAdmin('/more/admin/settings'); // H.event.settings has no photoProofSource/stripPhotoExif/visionGate — exercises defaults
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
    renderAdmin('/more/admin/settings');
    const stepperRow = row('Auto-hide after reports');
    expect(within(stepperRow).getByText('4')).toBeInTheDocument();
    fireEvent.click(within(stepperRow).getByRole('button', { name: 'Increase auto-hide threshold' }));
    expect(H.setReportHideThreshold).toHaveBeenCalledWith(5);
    fireEvent.click(within(stepperRow).getByRole('button', { name: 'Decrease auto-hide threshold' }));
    expect(H.setReportHideThreshold).toHaveBeenCalledWith(3);
  });

  it('the Easy mix slider (specs/admin-console-ia.md) reflects easyMixRatio, shows the squares bubble, and commits on release', () => {
    // A stored 0.25 sits on the 5% grid — thumb, bubble, and aria-valuetext agree.
    H.event = { ...H.event, settings: { reportHideThreshold: 4, easyMixRatio: 0.25 } } as unknown as EventDoc;
    renderAdmin('/more/admin/settings');
    const slider = screen.getByRole('slider', { name: 'Easy mix percentage' }) as HTMLInputElement;
    expect(slider.min).toBe('0');
    expect(slider.max).toBe('100');
    expect(slider.step).toBe('5');
    expect(slider.value).toBe('25');
    expect(screen.getByText('25% · 6 of 24 squares')).toBeInTheDocument();
    expect(slider).toHaveAttribute('aria-valuetext', '25% · 6 of 24 squares');
    // The ticket's sublabel, verbatim.
    expect(screen.getByText('Applies from the next 8:00 unlock · reshuffles inherit it.')).toBeInTheDocument();

    // Dragging updates the bubble live but does NOT write until release.
    fireEvent.change(slider, { target: { value: '50' } });
    expect(screen.getByText('50% · 12 of 24 squares')).toBeInTheDocument();
    expect(slider).toHaveAttribute('aria-valuetext', '50% · 12 of 24 squares');
    expect(H.setEasyMixRatio).not.toHaveBeenCalled();

    // Release commits once, as a 0..1 ratio; a repeat release at the same
    // position dedups against the last REQUESTED ratio (not the stale prop).
    fireEvent.pointerUp(slider);
    expect(H.setEasyMixRatio).toHaveBeenCalledTimes(1);
    expect(H.setEasyMixRatio).toHaveBeenCalledWith(0.5);
    fireEvent.pointerUp(slider);
    expect(H.setEasyMixRatio).toHaveBeenCalledTimes(1);
  });

  it('the Easy mix slider defaults to 50%, never writes on an untouched release, and commits AT-only changes on blur', () => {
    renderAdmin('/more/admin/settings'); // H.event.settings has no easyMixRatio
    const slider = screen.getByRole('slider', { name: 'Easy mix percentage' }) as HTMLInputElement;
    expect(slider.value).toBe('50');

    // Untouched release: nothing to write.
    fireEvent.pointerUp(slider);
    expect(H.setEasyMixRatio).not.toHaveBeenCalled();

    // Keyboard: the arrow's change + keyup commits the 5%-step value.
    fireEvent.change(slider, { target: { value: '55' } });
    fireEvent.keyUp(slider, { key: 'ArrowRight' });
    expect(H.setEasyMixRatio).toHaveBeenCalledTimes(1);
    expect(H.setEasyMixRatio).toHaveBeenCalledWith(0.55);

    // Assistive tech: a value change with NO pointerup/keyup persists on blur;
    // a blur after an already-committed value writes nothing more.
    fireEvent.change(slider, { target: { value: '70' } });
    fireEvent.blur(slider);
    expect(H.setEasyMixRatio).toHaveBeenCalledTimes(2);
    expect(H.setEasyMixRatio).toHaveBeenCalledWith(0.7);
    fireEvent.blur(slider);
    expect(H.setEasyMixRatio).toHaveBeenCalledTimes(2);
  });

  it('normalizes a legacy off-grid ratio to the 5% grid for display without rewriting the stored value', () => {
    // 0.33 → 35 on the 5% grid; the untouched release must not write 0.35.
    H.event = { ...H.event, settings: { reportHideThreshold: 4, easyMixRatio: 0.33 } } as unknown as EventDoc;
    renderAdmin('/more/admin/settings');
    const slider = screen.getByRole('slider', { name: 'Easy mix percentage' }) as HTMLInputElement;
    expect(slider.value).toBe('35');
    expect(screen.getByText(/35% · 8 of 24 squares/)).toBeInTheDocument();
    fireEvent.pointerUp(slider);
    expect(H.setEasyMixRatio).not.toHaveBeenCalled();
  });

  // Legacy negative threshold (isReportHidden treats non-positive as "no filtering"):
  // BOTH steps must clamp to a floor of 1, not just decrement (Codex P2, PR #245).
  it('the stepper floors at 1 on both steps for an already-negative threshold', () => {
    H.event = { ...H.event, settings: { reportHideThreshold: -2 } } as unknown as EventDoc;
    renderAdmin('/more/admin/settings');
    const stepperRow = row('Auto-hide after reports');
    const decrement = within(stepperRow).getByRole('button', { name: 'Decrease auto-hide threshold' }) as HTMLButtonElement;
    expect(decrement.disabled).toBe(true);
    fireEvent.click(decrement);
    expect(H.setReportHideThreshold).not.toHaveBeenCalled();
    fireEvent.click(within(stepperRow).getByRole('button', { name: 'Increase auto-hide threshold' }));
    expect(H.setReportHideThreshold).toHaveBeenCalledWith(1);
  });

  it('the claims queue lives in the Review queue, admin-confirmed mode only, with its count in the group heading', () => {
    // #269's mode gate, re-housed (admin-console-ia): the group renders in
    // admin_confirmed mode only — the old count/jump-link row is superseded by
    // the hub badge and the queue's own heading count.
    H.event = { ...H.event, claimMode: 'admin_confirmed' } as unknown as EventDoc;
    H.claims = [
      { id: 'c1', displayName: 'Alice', itemText: 'Do a thing' } as never,
      { id: 'c2', displayName: 'Bob', itemText: 'Do another thing' } as never,
    ];
    const { unmount } = renderAdmin('/more/admin/queue');
    expect(screen.getByText('Pending claims (2)')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    unmount();

    // Outside admin_confirmed the group vanishes entirely.
    H.event = { ...H.event, claimMode: 'honor' } as unknown as EventDoc;
    renderAdmin('/more/admin/queue');
    expect(screen.queryByText(/Pending claims/)).toBeNull();
  });
});

describe('Admin curated pools (#269, at /more/admin/pool)', () => {
  it('the add form writes an active prompt into the chosen pool via adminAddItem', async () => {
    renderAdmin('/more/admin/pool');
    const input = screen.getByLabelText('New prompt text') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Final soft-serve encore' } });
    fireEvent.change(screen.getByLabelText('Pool'), { target: { value: 'farewell' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await Promise.resolve();
    expect(H.adminAddItem).toHaveBeenCalledWith('admin-uid', 'Final soft-serve encore', false, 'farewell');
  });

  it('forces embark/farewell prompt additions to stay tame even after 🔞 was checked on main', async () => {
    renderAdmin('/more/admin/pool');
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
    renderAdmin('/more/admin/pool');
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
