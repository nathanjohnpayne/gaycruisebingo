import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  AuthProvider,
  PENDING_REDIRECT_ATTESTATION_KEY,
  WEB_APP_AUTH_SETTLE_TIMEOUT_MS,
  useAuth,
} from './AuthContext';
// The mocked module instance (vi.mock below) — the fallback-handler test writes
// a config slot onto it to observe the #340 authDomain override.
import { auth as mockedAuth } from '../firebase';

// Mock the Firebase boundary so the real AuthProvider runs under jsdom: the tests
// drive the auth callback by hand and stub the data-layer deal.
const mocks = vi.hoisted(() => ({
  onAuthStateChanged: vi.fn(),
  getRedirectResult: vi.fn(),
  signInWithPopup: vi.fn(),
  signInWithRedirect: vi.fn(),
  signOut: vi.fn(),
  ensureUserProfile: vi.fn(),
  attestAdult: vi.fn(),
  readAdultAttestation: vi.fn(),
  readAdultAttestationFromCache: vi.fn(),
  joinAndDeal: vi.fn(),
  track: vi.fn(),
}));

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: mocks.onAuthStateChanged,
  getRedirectResult: mocks.getRedirectResult,
  signInWithPopup: mocks.signInWithPopup,
  signInWithRedirect: mocks.signInWithRedirect,
  signOut: mocks.signOut,
  GoogleAuthProvider: class {},
}));
vi.mock('../firebase', () => ({ auth: {}, googleProvider: {} }));
// AuthProvider now mounts the confirm-path listener (#41) beside the attestation
// gate; stub it — this suite exercises deal-error / stale-attempt hardening only.
vi.mock('../components/ConfirmWinMoments', () => ({ default: () => null }));
// AuthProvider also mounts the pool-recovery watcher (#70) beside the gate; stub it —
// this suite exercises the deal-error/stale-attempt state machine, not the watcher (the
// watcher has its own suite in src/components/w1-deal-auto-retry.test.tsx).
vi.mock('../components/PoolRecoveryWatcher', () => ({ default: () => null }));
vi.mock('../data/api', () => ({
  ensureUserProfile: mocks.ensureUserProfile,
  attestAdult: mocks.attestAdult,
  // AuthContext's authority read is now server-only (getDocFromServer, #117 r6);
  // point it at the same spy this suite already configures for the settled read.
  readAdultAttestationFromServer: mocks.readAdultAttestation,
  readAdultAttestationFromCache: mocks.readAdultAttestationFromCache,
  hasCachedBoard: vi.fn().mockResolvedValue(true),
  joinAndDeal: mocks.joinAndDeal,
}));
vi.mock('../analytics', () => ({ track: mocks.track }));

const FAKE_USER = { uid: 'sailor-1', displayName: 'Sailor', photoURL: null };

// The auth-state callback AuthProvider registers; emitting a User through it
// simulates Firebase resolving the Google popup.
let emitAuth: (u: unknown) => unknown = () => {};

function Harness() {
  const { dealError, dealing, retryDeal, signIn } = useAuth();
  return (
    <div>
      {dealError ? <p role="alert">{dealError}</p> : null}
      <span data-testid="dealing">{dealing ? 'dealing' : 'idle'}</span>
      <button onClick={() => retryDeal()}>retry</button>
      <button onClick={() => void signIn()}>signin</button>
    </div>
  );
}

// A promise whose settlement the test drives, to hold a deal in flight (P2/P3).
function deferred<T>() {
  let settle!: (v: T) => void;
  let fail!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((settle = res), (fail = rej)));
  return { promise, settle, fail };
}

const mount = () =>
  render(
    <AuthProvider>
      <Harness />
    </AuthProvider>,
  );
const signInUser = () => act(async () => void (await emitAuth(FAKE_USER)));

beforeEach(() => {
  vi.clearAllMocks();
  emitAuth = () => {};
  mocks.onAuthStateChanged.mockImplementation((_a: unknown, cb: (u: unknown) => unknown) => {
    emitAuth = cb;
    return () => {};
  });
  mocks.ensureUserProfile.mockResolvedValue(undefined);
  // These deal/error tests are not about attestation — read the signed-in User as
  // already attested so the re-prompt gate (#23) never intercepts the Harness. The
  // cache-first read (#115) is a MISS here (jsdom has no persistent Firestore
  // cache), so the online server read below is what settles the gate — the online
  // path these tests exercise.
  mocks.readAdultAttestationFromCache.mockRejectedValue(new Error('cache miss'));
  mocks.readAdultAttestation.mockResolvedValue(1);
  mocks.attestAdult.mockResolvedValue(undefined);
  mocks.getRedirectResult.mockResolvedValue(null);
  mocks.signInWithPopup.mockResolvedValue({});
  mocks.signInWithRedirect.mockResolvedValue(undefined);
  mocks.signOut.mockResolvedValue(undefined);
});

describe('AuthContext deal-error hardening', () => {
  it('surfaces the pool-below-24 failure and Retry re-invokes joinAndDeal, clearing it', async () => {
    mocks.joinAndDeal
      .mockRejectedValueOnce(new Error('dealBoard needs at least 24 prompts, received 5.'))
      .mockResolvedValueOnce(true); // retry deals a NEW board → join_event fires (round 8)
    mount();
    await signInUser();

    // The once-swallowed error is now Player-worded, pool-below-24 copy.
    expect(await screen.findByRole('alert')).toHaveTextContent(/24 a card needs/);
    expect(mocks.joinAndDeal).toHaveBeenCalledTimes(1);

    // Retry re-deals in place (no reload); the second deal succeeds → the error
    // clears and join_event fires.
    await userEvent.click(screen.getByText('retry'));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(mocks.joinAndDeal).toHaveBeenCalledTimes(2);
    expect(mocks.track).toHaveBeenCalledWith('join_event');
  });

  it('surfaces a non-guard deal failure with connection-worded fallback copy', async () => {
    mocks.joinAndDeal.mockRejectedValue(new Error('network request failed'));
    mount();
    await signInUser();
    expect(await screen.findByRole('alert')).toHaveTextContent(/connection/i);
  });

  it("fires track('login', { method: 'google' }) on Google sign-in", async () => {
    mocks.joinAndDeal.mockResolvedValue(undefined);
    mount();
    await userEvent.click(screen.getByText('signin'));
    await waitFor(() => expect(mocks.track).toHaveBeenCalledWith('login', { method: 'google' }));
    expect(mocks.signInWithPopup).toHaveBeenCalledTimes(1);
  });

  it("fires track('login_failed', …) with a safe code and rethrows when the popup rejects (#163)", async () => {
    const err = Object.assign(new Error('Unable to process request due to missing initial state.'), {
      code: 'auth/missing-initial-state',
    });
    mocks.signInWithPopup.mockRejectedValueOnce(err);

    // Capture signIn directly so we can assert its rejection contract, rather
    // than routing through the Harness button (which discards the promise).
    let signIn!: () => Promise<void>;
    function Capture() {
      ({ signIn } = useAuth());
      return null;
    }
    render(
      <AuthProvider>
        <Capture />
      </AuthProvider>,
    );

    // Rethrow contract: signIn surfaces the original error to its caller.
    await expect(signIn()).rejects.toBe(err);

    // The failure event carries only allowlisted, PII-free fields.
    expect(mocks.track).toHaveBeenCalledWith('login_failed', {
      method: 'google',
      code: 'auth/missing-initial-state',
    });
    // The success path did not run: no login event, no attestation.
    expect(mocks.track).not.toHaveBeenCalledWith('login', { method: 'google' });
    expect(mocks.attestAdult).not.toHaveBeenCalled();
  });

  it('uses one top-level redirect instead of a popup on iOS Safari', async () => {
    vi.stubGlobal('navigator', {
      ...window.navigator,
      onLine: true,
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Version/18.5 Mobile/15E148 Safari/604.1',
      platform: 'iPhone',
      maxTouchPoints: 5,
    });
    const authMock = mockedAuth as { config?: { authDomain?: string } };
    authMock.config = { authDomain: window.location.hostname };

    mount();
    await userEvent.click(screen.getByText('signin'));

    expect(mocks.signInWithRedirect).toHaveBeenCalledTimes(1);
    expect(mocks.signInWithRedirect).toHaveBeenCalledWith(mockedAuth, expect.anything());
    expect(mocks.signInWithPopup).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(PENDING_REDIRECT_ATTESTATION_KEY)).not.toBeNull();

    delete authMock.config;
    sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it('keeps popup sign-in in an installed iOS PWA with a stable app window', async () => {
    vi.stubGlobal('navigator', {
      ...window.navigator,
      onLine: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
      platform: 'iPhone',
      maxTouchPoints: 5,
      standalone: true,
    });
    const authMock = mockedAuth as { config?: { authDomain?: string } };
    authMock.config = { authDomain: window.location.hostname };

    mount();
    await userEvent.click(screen.getByText('signin'));

    expect(mocks.signInWithPopup).toHaveBeenCalledTimes(1);
    expect(mocks.signInWithRedirect).not.toHaveBeenCalled();

    delete authMock.config;
    vi.unstubAllGlobals();
  });

  it('coalesces repeated sign-in calls into one Firebase auth transaction', async () => {
    const popup = deferred<Record<string, never>>();
    mocks.signInWithPopup.mockReturnValueOnce(popup.promise);

    let signIn!: () => Promise<void>;
    function Capture() {
      ({ signIn } = useAuth());
      return null;
    }
    render(
      <AuthProvider>
        <Capture />
      </AuthProvider>,
    );

    const first = signIn();
    const second = signIn();
    expect(mocks.signInWithPopup).toHaveBeenCalledTimes(1);

    popup.settle({});
    await Promise.all([first, second]);
  });

  it('persists the checked 18+ acknowledgement after returning from mobile redirect sign-in', async () => {
    sessionStorage.setItem(PENDING_REDIRECT_ATTESTATION_KEY, '1');
    mocks.getRedirectResult.mockResolvedValueOnce({ user: FAKE_USER });

    mount();

    await waitFor(() => expect(mocks.attestAdult).toHaveBeenCalledWith(FAKE_USER));
    expect(mocks.attestAdult).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(PENDING_REDIRECT_ATTESTATION_KEY)).toBeNull();
  });

  it('does not consume or report a redirect result without an app-owned pending marker', async () => {
    mount();
    await act(async () => {
      await Promise.resolve();
    });

    expect(mocks.getRedirectResult).not.toHaveBeenCalled();
    expect(mocks.track).not.toHaveBeenCalledWith('login_failed', expect.anything());
  });

  it('hands a signed-out web.app boot to firebaseapp.com before rendering a second sign-in screen', async () => {
    const replace = vi.fn();
    vi.stubGlobal('location', {
      hostname: 'gaycruisebingo.web.app',
      pathname: '/card',
      search: '',
      hash: '',
      replace,
    });
    mount();
    await act(async () => void (await emitAuth(null)));

    expect(replace).toHaveBeenCalledWith('https://gaycruisebingo.firebaseapp.com/card');
    expect(mocks.signInWithPopup).not.toHaveBeenCalled();
    expect(mocks.signInWithRedirect).not.toHaveBeenCalled();
    expect(mocks.track).not.toHaveBeenCalledWith('login', { method: 'google' });

    vi.unstubAllGlobals();
  });

  it('bounds a stalled online web.app auth bootstrap and hands off automatically', async () => {
    vi.useFakeTimers();
    const replace = vi.fn();
    vi.stubGlobal('location', {
      hostname: 'gaycruisebingo.web.app',
      pathname: '/card',
      search: '',
      hash: '',
      replace,
    });

    mount();
    expect(replace).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(WEB_APP_AUTH_SETTLE_TIMEOUT_MS);
    expect(replace).toHaveBeenCalledOnce();
    expect(replace).toHaveBeenCalledWith('https://gaycruisebingo.firebaseapp.com/card');

    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
});

describe('AuthContext stale-attempt + retry hardening', () => {
  it('drops a stale deal rejection from a signed-out account after a new account has dealt (P2)', async () => {
    const stale = deferred<void>();
    mocks.joinAndDeal.mockReturnValueOnce(stale.promise).mockResolvedValueOnce(undefined);
    mount();
    await act(async () => void (await emitAuth(FAKE_USER))); // account A: deal left in flight
    await act(async () => void (await emitAuth(null))); // player signs out
    await act(
      async () =>
        void (await emitAuth({
          uid: 'sailor-2',
          displayName: 'Other',
          photoURL: null,
        })),
    ); // account B deals
    await waitFor(() => expect(mocks.joinAndDeal).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    // Account A's late rejection must be ignored, not clobber account B's board.
    await act(async () => {
      stale.fail(new Error('network request failed'));
      await stale.promise.catch(() => {});
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps the retry surface mounted until the retry settles, never flashing a blank board (P3)', async () => {
    const retry = deferred<void>();
    mocks.joinAndDeal
      .mockRejectedValueOnce(new Error('network request failed')) // initial deal fails
      .mockReturnValueOnce(retry.promise); // retry stays in flight
    mount();
    await signInUser();
    expect(await screen.findByRole('alert')).toHaveTextContent(/connection/i);

    await userEvent.click(screen.getByText('retry'));
    await waitFor(() => expect(mocks.joinAndDeal).toHaveBeenCalledTimes(2));
    // Mid-retry: the error surface stays mounted (dealing), never a blank board.
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByTestId('dealing')).toHaveTextContent('dealing');

    await act(async () => {
      retry.settle();
      await retry.promise;
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument(); // clears only on settle
  });
});
