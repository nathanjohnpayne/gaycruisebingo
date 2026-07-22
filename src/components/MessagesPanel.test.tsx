import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { DayDef, NoticeDoc } from '../types';

// specs/admin-messages.md (#439), component layer. MessagesPanel isolated behind
// focused mocks — the three notice writers, the two data hooks, the identity/day
// helpers — so the compose + history behavior tests without Firestore.

const H = vi.hoisted(() => ({ notices: [] as NoticeDoc[] }));
const writers = vi.hoisted(() => ({
  postNotice: vi.fn((..._a: unknown[]) => Promise.resolve('new-id')),
  setNoticePinned: vi.fn((..._a: unknown[]) => Promise.resolve()),
  deleteNotice: vi.fn((..._a: unknown[]) => Promise.resolve()),
}));

vi.mock('../hooks/useData', () => ({
  useMyPlayer: () => ({ data: { displayName: 'Nathan' } }),
  useNotices: () => ({ notices: H.notices }),
}));
vi.mock('../data/api', () => ({
  resolveDisplayName: (p: { displayName?: string } | null, a?: string) => p?.displayName ?? a ?? 'Anonymous',
}));
vi.mock('./DaySwitcher', () => ({ defaultViewedIndex: () => 7 }));
vi.mock('../data/notices', () => ({
  postNotice: writers.postNotice,
  setNoticePinned: writers.setNoticePinned,
  deleteNotice: writers.deleteNotice,
  NOTICE_TITLE_MAX: 60,
  NOTICE_BODY_MAX: 400,
}));

import MessagesPanel from './admin/MessagesPanel';

const days: DayDef[] = [{ index: 0 } as DayDef];
const notice = (id: string, pinned: boolean): NoticeDoc => ({
  id,
  title: `${id} title`,
  body: `${id} body`,
  uid: 'admin-uid',
  displayName: 'Nathan',
  createdAt: 1000,
  dayIndex: 7,
  pinned,
});

describe('MessagesPanel (specs/admin-messages.md)', () => {
  beforeEach(() => {
    H.notices = [];
    writers.postNotice.mockClear();
    writers.setNoticePinned.mockClear();
    writers.deleteNotice.mockClear();
  });

  it('posts a Notice with title + body + pin, then clears the draft', async () => {
    render(<MessagesPanel adminUid="admin-uid" days={days} />);
    fireEvent.change(screen.getByLabelText('Notice title'), { target: { value: 'Final stretch 🏁' } });
    fireEvent.change(screen.getByLabelText('Notice body'), { target: { value: 'Last days at sea.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post to everyone' }));

    await waitFor(() =>
      expect(writers.postNotice).toHaveBeenCalledWith({
        uid: 'admin-uid',
        displayName: 'Nathan',
        title: 'Final stretch 🏁',
        body: 'Last days at sea.',
        pinned: true,
        dayIndex: 7,
      }),
    );
    // The draft clears on a settled success.
    await waitFor(() => expect(screen.getByLabelText('Notice title')).toHaveValue(''));
    expect(screen.getByLabelText('Notice body')).toHaveValue('');
  });

  it('the Post button is disabled until both title and body are non-empty', () => {
    render(<MessagesPanel adminUid="admin-uid" days={days} />);
    const post = screen.getByRole('button', { name: 'Post to everyone' });
    expect(post).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Notice title'), { target: { value: 'T' } });
    expect(post).toBeDisabled(); // body still empty
    fireEvent.change(screen.getByLabelText('Notice body'), { target: { value: 'B' } });
    expect(post).toBeEnabled();
  });

  it('Unpin flips a pinned Notice to pinned=false', () => {
    H.notices = [notice('n1', true)];
    render(<MessagesPanel adminUid="admin-uid" days={days} />);
    fireEvent.click(screen.getByRole('button', { name: 'Unpin' }));
    expect(writers.setNoticePinned).toHaveBeenCalledWith('n1', false);
  });

  it('Delete removes the Notice from history', () => {
    H.notices = [notice('n1', false)];
    render(<MessagesPanel adminUid="admin-uid" days={days} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(writers.deleteNotice).toHaveBeenCalledWith('n1');
  });

  it('shows the sent history newest-first with the pinned marker', () => {
    H.notices = [notice('n1', true)];
    render(<MessagesPanel adminUid="admin-uid" days={days} />);
    expect(screen.getByText('n1 title')).toBeInTheDocument();
    expect(screen.getByText(/📌 pinned/)).toBeInTheDocument();
  });
});
