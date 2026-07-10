import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import UpdatePrompt from './UpdatePrompt';

// Covers specs/app-update-reload-prompt.md: the needRefresh-driven reload banner
// (Reload activates the waiting service worker via updateServiceWorker(true),
// Not now dismisses for the session), the periodic registration.update() check
// that lets a long-lived tab discover a new deploy (skipped while offline), and
// the update-prompt-visible body class that reserves .app's bottom clearance
// while the banner is up (mirroring InstallPrompt's mechanism, specs/w1-pwa.md).

const VISIBLE_CLASS = 'update-prompt-visible';

type RegisterSWOptions = {
  onRegisteredSW?: (swUrl: string, registration: ServiceWorkerRegistration | undefined) => void;
};

// Stateful stand-in for virtual:pwa-register/react (a Vite virtual module —
// nothing real to import under Vitest). Backing needRefresh with real useState
// lets "Not now" actually hide the banner instead of only asserting a setter
// was called with false.
const { swState } = vi.hoisted(() => ({
  swState: {
    initialNeedRefresh: false,
    updateServiceWorker: vi.fn<(reloadPage?: boolean) => Promise<void>>(),
    capturedOptions: undefined as RegisterSWOptions | undefined,
  },
}));

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: (options: RegisterSWOptions) => {
    swState.capturedOptions = options;
    const [needRefresh, setNeedRefresh] = useState(swState.initialNeedRefresh);
    const [offlineReady, setOfflineReady] = useState(false);
    return {
      needRefresh: [needRefresh, setNeedRefresh],
      offlineReady: [offlineReady, setOfflineReady],
      updateServiceWorker: swState.updateServiceWorker,
    };
  },
}));

/** A registration whose update() resolves; only update() is ever touched. */
function makeRegistration() {
  return { update: vi.fn().mockResolvedValue(undefined) } as unknown as ServiceWorkerRegistration & {
    update: ReturnType<typeof vi.fn>;
  };
}

describe('UpdatePrompt', () => {
  beforeEach(() => {
    swState.initialNeedRefresh = false;
    swState.updateServiceWorker = vi.fn().mockResolvedValue(undefined);
    swState.capturedOptions = undefined;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    // Defensive: the component's effect cleanup already removes this on unmount
    // (RTL auto-cleanup), but a leaked body class would poison later tests.
    document.body.classList.remove(VISIBLE_CLASS);
  });

  it('renders nothing (and never sets the body class) while no update is pending', () => {
    render(<UpdatePrompt />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(document.body.classList.contains(VISIBLE_CLASS)).toBe(false);
  });

  it('shows the banner when a new version is waiting, and Reload activates it with a page reload', async () => {
    swState.initialNeedRefresh = true;
    const user = userEvent.setup();
    render(<UpdatePrompt />);
    expect(screen.getByRole('status')).toHaveTextContent(/new version of gay cruise bingo/i);
    await user.click(screen.getByRole('button', { name: /reload/i }));
    expect(swState.updateServiceWorker).toHaveBeenCalledWith(true);
  });

  it('"Not now" dismisses the banner for the session without touching the waiting worker', async () => {
    swState.initialNeedRefresh = true;
    const user = userEvent.setup();
    render(<UpdatePrompt />);
    await user.click(screen.getByRole('button', { name: /not now/i }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(swState.updateServiceWorker).not.toHaveBeenCalled();
  });

  it('toggles update-prompt-visible on <body> while the banner is up, and clears it on dismiss', async () => {
    swState.initialNeedRefresh = true;
    const user = userEvent.setup();
    render(<UpdatePrompt />);
    expect(document.body.classList.contains(VISIBLE_CLASS)).toBe(true);
    await user.click(screen.getByRole('button', { name: /not now/i }));
    expect(document.body.classList.contains(VISIBLE_CLASS)).toBe(false);
  });

  it('arms a periodic registration.update() check so a long-lived tab discovers a new deploy', () => {
    vi.useFakeTimers();
    render(<UpdatePrompt />);
    const registration = makeRegistration();
    swState.capturedOptions?.onRegisteredSW?.('/sw.js', registration);
    expect(registration.update).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(registration.update).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    expect(registration.update).toHaveBeenCalledTimes(3);
  });

  it('skips the update check while offline (navigator.onLine === false)', () => {
    vi.useFakeTimers();
    vi.stubGlobal('navigator', { ...window.navigator, onLine: false });
    render(<UpdatePrompt />);
    const registration = makeRegistration();
    swState.capturedOptions?.onRegisteredSW?.('/sw.js', registration);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(registration.update).not.toHaveBeenCalled();
  });

  it('tolerates a registration.update() rejection (transient network failure) without unhandled errors', async () => {
    vi.useFakeTimers();
    render(<UpdatePrompt />);
    const registration = {
      update: vi.fn().mockRejectedValue(new Error('network down')),
    } as unknown as ServiceWorkerRegistration;
    swState.capturedOptions?.onRegisteredSW?.('/sw.js', registration);
    await act(async () => {
      vi.advanceTimersByTime(60_000);
      // let the rejected promise's catch handler run
      await Promise.resolve();
    });
    expect(registration.update).toHaveBeenCalledTimes(1);
  });

  it('does nothing when registration is unavailable (no SW support)', () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    render(<UpdatePrompt />);
    swState.capturedOptions?.onRegisteredSW?.('/sw.js', undefined);
    expect(setIntervalSpy).not.toHaveBeenCalled();
    setIntervalSpy.mockRestore();
  });
});
