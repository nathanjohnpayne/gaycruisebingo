import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import InstallPrompt from './InstallPrompt';
import { __resetInstallPromptStateForTests, useInstallPrompt } from '../hooks/useInstallPrompt';

// Covers specs/w1-pwa.md: the beforeinstallprompt-driven install banner, the iOS
// "Add to Home Screen" hint, install_pwa firing on prompt acceptance or a bare
// appinstalled (deduped so a banner-accepted install never double-counts), and the
// install-prompt-visible body class that reserves .app's bottom clearance while the
// banner is up.

const { track } = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock('../analytics', () => ({ track }));

const DISMISS_KEY = 'gcb.install.dismissedAt';
const VISIBLE_CLASS = 'install-prompt-visible';
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
    // useInstallPrompt is now a module-level singleton (shared across mount
    // points, Codex P2 on #232) — reset it between tests so each `it` starts
    // from a clean, un-captured, un-installed state.
    __resetInstallPromptStateForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    // Defensive: InstallPrompt's own effect cleanup already removes this on
    // unmount (which RTL's auto-cleanup triggers), but a bare body-class
    // toggle is easy to leak across tests if that ever regresses.
    document.body.classList.remove(VISIBLE_CLASS);
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

  it('fires install_pwa and hides the banner when appinstalled arrives without ever using this button (installed via the browser UI directly)', async () => {
    render(<InstallPrompt />);
    // The banner is up (a Chromium install signal exists) but the Player never taps
    // Install — `userChoice` is deliberately never consulted on this path.
    fireOnWindow(makeBeforeInstallPromptEvent('accepted'));
    expect(screen.getByRole('button', { name: /install/i })).toBeInTheDocument();
    fireOnWindow(new Event('appinstalled'));
    await waitFor(() => expect(track).toHaveBeenCalledWith('install_pwa'));
    expect(track).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('fires install_pwa when appinstalled arrives with no beforeinstallprompt signal at all', async () => {
    render(<InstallPrompt />);
    fireOnWindow(new Event('appinstalled'));
    await waitFor(() => expect(track).toHaveBeenCalledWith('install_pwa'));
    expect(track).toHaveBeenCalledTimes(1);
  });

  it('does not double-fire install_pwa when appinstalled follows a banner-accepted install', async () => {
    const user = userEvent.setup();
    render(<InstallPrompt />);
    fireOnWindow(makeBeforeInstallPromptEvent('accepted'));
    await user.click(screen.getByRole('button', { name: /install/i }));
    await waitFor(() => expect(track).toHaveBeenCalledWith('install_pwa'));
    fireOnWindow(new Event('appinstalled'));
    await waitFor(() => expect(screen.queryByRole('note')).not.toBeInTheDocument());
    expect(track).toHaveBeenCalledTimes(1);
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

  // index.css keys extra `.app` bottom clearance off this class (body.install-prompt-visible)
  // so the banner never covers the last row of scrollable content — see specs/w1-pwa.md. jsdom
  // has no layout engine, so these assert the toggle itself, not the resulting padding.
  it('never sets install-prompt-visible with no install signal (unsupported browser, not iOS)', () => {
    render(<InstallPrompt />);
    expect(document.body.classList.contains(VISIBLE_CLASS)).toBe(false);
  });

  it('sets install-prompt-visible while the Chromium banner is up, and clears it once dismissed', async () => {
    const user = userEvent.setup();
    render(<InstallPrompt />);
    expect(document.body.classList.contains(VISIBLE_CLASS)).toBe(false);
    fireOnWindow(makeBeforeInstallPromptEvent('accepted'));
    expect(document.body.classList.contains(VISIBLE_CLASS)).toBe(true);
    await user.click(screen.getByRole('button', { name: /not now/i }));
    expect(document.body.classList.contains(VISIBLE_CLASS)).toBe(false);
  });

  it('sets install-prompt-visible for the iOS hint too', () => {
    const originalUA = window.navigator.userAgent;
    Object.defineProperty(window.navigator, 'userAgent', { value: IOS_UA, configurable: true });
    try {
      render(<InstallPrompt />);
      expect(document.body.classList.contains(VISIBLE_CLASS)).toBe(true);
    } finally {
      Object.defineProperty(window.navigator, 'userAgent', { value: originalUA, configurable: true });
    }
  });

  it('clears install-prompt-visible once the banner is gone after an accepted install', async () => {
    const user = userEvent.setup();
    render(<InstallPrompt />);
    fireOnWindow(makeBeforeInstallPromptEvent('accepted'));
    expect(document.body.classList.contains(VISIBLE_CLASS)).toBe(true);
    await user.click(screen.getByRole('button', { name: /install/i }));
    await waitFor(() => expect(track).toHaveBeenCalledWith('install_pwa'));
    expect(document.body.classList.contains(VISIBLE_CLASS)).toBe(false);
  });
});

// Codex P2s on #232: `beforeinstallprompt` is a one-shot browser event, and
// the tracked-install guard must dedupe across mount points, not just within
// one. useInstallPrompt is now a shared singleton store (see its module doc)
// instead of one independent listener/state pair per mount — these cover
// that sharing directly, with two simultaneous consumers standing in for the
// always-mounted `InstallPrompt` banner and More's row (#208).
describe('useInstallPrompt — shared across mount points (Codex P2 on #232)', () => {
  beforeEach(() => {
    track.mockClear();
    __resetInstallPromptStateForTests();
  });

  function TwoConsumers() {
    return (
      <>
        <div data-testid="a">
          <Probe />
        </div>
        <div data-testid="b">
          <Probe />
        </div>
      </>
    );
  }

  function Probe() {
    const { deferred, install, standalone } = useInstallPrompt();
    return (
      <button type="button" onClick={install}>
        {standalone ? 'standalone' : deferred ? 'captured' : 'idle'}
      </button>
    );
  }

  it('a beforeinstallprompt captured while only one mount point is on screen still surfaces on a mount point that appears later', async () => {
    // Mount ONLY the always-present banner first (More's row isn't on screen
    // yet — the Player is on a different route), fire the one-shot event,
    // THEN mount the second consumer — the exact "not on /more yet" scenario
    // from the finding.
    const { rerender } = render(
      <div data-testid="a">
        <Probe />
      </div>,
    );
    fireOnWindow(makeBeforeInstallPromptEvent('accepted'));
    await waitFor(() => expect(screen.getByTestId('a')).toHaveTextContent('captured'));

    rerender(<TwoConsumers />);
    // The second (later-mounted) consumer sees the SAME already-captured prompt.
    expect(screen.getByTestId('b')).toHaveTextContent('captured');
  });

  it('install_pwa fires exactly once when appinstalled follows a button tap on one of two simultaneously-mounted consumers', async () => {
    const user = userEvent.setup();
    render(<TwoConsumers />);
    fireOnWindow(makeBeforeInstallPromptEvent('accepted'));
    await waitFor(() => expect(screen.getByTestId('a')).toHaveTextContent('captured'));
    expect(screen.getByTestId('b')).toHaveTextContent('captured');

    // Tap the button under mount point "a" only.
    await user.click(screen.getByTestId('a').querySelector('button')!);
    await waitFor(() => expect(track).toHaveBeenCalledWith('install_pwa'));
    // The browser's own appinstalled follow-up must not double-count against
    // mount point "b"'s independent (but shared-store) trackedInstall guard.
    fireOnWindow(new Event('appinstalled'));
    await waitFor(() => expect(screen.getByTestId('a')).toHaveTextContent('standalone'));
    expect(screen.getByTestId('b')).toHaveTextContent('standalone');
    expect(track).toHaveBeenCalledTimes(1);
  });
});
