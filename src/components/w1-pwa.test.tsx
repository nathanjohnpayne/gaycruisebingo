import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import InstallPrompt from './InstallPrompt';

// Covers specs/w1-pwa.md: the beforeinstallprompt-driven install banner, the iOS
// "Add to Home Screen" hint, and install_pwa firing only on prompt acceptance.

const { track } = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock('../analytics', () => ({ track }));

const DISMISS_KEY = 'gcb.install.dismissedAt';
const IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

// Minimal in-memory localStorage stand-in — same stub + rationale as src/w2-ga4-events.test.tsx.
function createStorageStub(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

/** A minimal stand-in for the non-standard BeforeInstallPromptEvent. */
function makeBeforeInstallPromptEvent(outcome: 'accepted' | 'dismissed') {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  };
  event.prompt = vi.fn().mockResolvedValue(undefined);
  event.userChoice = Promise.resolve({ outcome, platform: 'web' });
  return event;
}

function fireOnWindow(event: Event) {
  act(() => {
    window.dispatchEvent(event);
  });
}

describe('InstallPrompt', () => {
  let storage: Storage;

  beforeEach(() => {
    track.mockClear();
    storage = createStorageStub();
    vi.stubGlobal('localStorage', storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders nothing with no install signal (unsupported browser, not iOS)', () => {
    render(<InstallPrompt />);
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('captures beforeinstallprompt (suppressing the mini-infobar), shows Install, and fires install_pwa on acceptance', async () => {
    const user = userEvent.setup();
    render(<InstallPrompt />);
    const event = makeBeforeInstallPromptEvent('accepted');
    fireOnWindow(event);
    expect(event.defaultPrevented).toBe(true);
    await user.click(screen.getByRole('button', { name: /install/i }));
    await waitFor(() => expect(track).toHaveBeenCalledWith('install_pwa'));
  });

  it('does not fire install_pwa when the native prompt is dismissed', async () => {
    const user = userEvent.setup();
    render(<InstallPrompt />);
    fireOnWindow(makeBeforeInstallPromptEvent('dismissed'));
    await user.click(screen.getByRole('button', { name: /install/i }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /install/i })).not.toBeInTheDocument());
    expect(track).not.toHaveBeenCalled();
  });

  it('dismissing the banner hides it and persists the dismissal to localStorage', async () => {
    const user = userEvent.setup();
    render(<InstallPrompt />);
    fireOnWindow(makeBeforeInstallPromptEvent('accepted'));
    await user.click(screen.getByRole('button', { name: /not now/i }));
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
    expect(storage.getItem(DISMISS_KEY)).not.toBeNull();
  });

  it('shows the iOS "Add to Home Screen" hint, since Safari never fires beforeinstallprompt', () => {
    const originalUA = window.navigator.userAgent;
    Object.defineProperty(window.navigator, 'userAgent', { value: IOS_UA, configurable: true });
    try {
      render(<InstallPrompt />);
      expect(screen.getByRole('note')).toHaveTextContent(/add to home screen/i);
      expect(screen.queryByRole('button', { name: /^install$/i })).not.toBeInTheDocument();
    } finally {
      Object.defineProperty(window.navigator, 'userAgent', { value: originalUA, configurable: true });
    }
  });
});
