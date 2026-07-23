import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
// The default export's live container pulls useNotices → firebase; stub the hook so
// importing the module doesn't boot Firebase. The tests drive the pure View directly.
vi.mock('../hooks/useData', () => ({ useNotices: () => ({ notices: [] }) }));
import { NoticeBannerView } from './NoticeBanner'; // specs/admin-messages.md (#439)
import type { NoticeDoc } from '../types';

// The presentational + dismissal half is pure over its `notices` prop, so the
// banner's per-device persistence (localStorage keyed by notice id, CoachOverlay-
// style) tests without a Firestore mock.

function createStorageStub(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => void store.set(key, value),
  } as unknown as Storage;
}

const notice = (id: string, pinned: boolean, createdAt = 1000): NoticeDoc => ({
  id,
  title: `${id} title`,
  body: `${id} body`,
  uid: `u-${id}`,
  displayName: 'Nathan',
  createdAt,
  pinned,
});

describe('NoticeBanner (specs/admin-messages.md)', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = createStorageStub();
    vi.stubGlobal('localStorage', storage);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the newest pinned Notice as a dismissible banner', () => {
    render(<NoticeBannerView notices={[notice('n1', true)]} />);
    expect(screen.getByText('n1 title')).toBeInTheDocument();
    expect(screen.getByText('n1 body')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dismiss notice' })).toBeInTheDocument();
  });

  it('renders nothing when no Notice is pinned', () => {
    const { container } = render(<NoticeBannerView notices={[notice('n1', false)]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('tapping ✕ hides the banner and writes the per-device key', () => {
    render(<NoticeBannerView notices={[notice('n1', true)]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notice' }));
    expect(screen.queryByText('n1 title')).not.toBeInTheDocument();
    expect(storage.getItem('gcb.notice.n1.dismissedAt')).not.toBeNull();
  });

  it('a remount with that Notice dismissed does not render, but a DIFFERENT notice id still does', () => {
    storage.setItem('gcb.notice.n1.dismissedAt', String(Date.now()));
    const { unmount } = render(<NoticeBannerView notices={[notice('n1', true)]} />);
    expect(screen.queryByText('n1 title')).not.toBeInTheDocument(); // persists across "reload"
    unmount();
    render(<NoticeBannerView notices={[notice('n2', true)]} />);
    expect(screen.getByText('n2 title')).toBeInTheDocument(); // per-id isolation
  });

  it('dismissing the newest pinned Notice reveals the next still-undismissed pinned one', () => {
    // notices arrive newest-first (useNotices sorts); newer 'n2' shows first.
    render(<NoticeBannerView notices={[notice('n2', true, 2000), notice('n1', true, 1000)]} />);
    expect(screen.getByText('n2 title')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notice' }));
    expect(screen.getByText('n1 title')).toBeInTheDocument();
  });
});
