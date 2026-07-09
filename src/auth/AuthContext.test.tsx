import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthProvider, useAuth } from './AuthContext';

// Mock the Firebase boundary so the real AuthProvider runs under jsdom: the tests
// drive the auth callback by hand and stub the data-layer deal.
const mocks = vi.hoisted(() => ({
  onAuthStateChanged: vi.fn(),
  signInWithPopup: vi.fn(),
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
  signInWithPopup: mocks.signInWithPopup,
  signOut: mocks.signOut,
  GoogleAuthProvider: class {},
}));
vi.mock('../firebase', () => ({ auth: {}, googleProvider: {} }));
// AuthProvider now mounts the confirm-path listener (#41) beside the attestation
// gate; stub it — this suite exercises deal-error / stale-attempt hardening only.
vi.mock('../components/ConfirmWinMoments', () => ({ default: () => null }));
vi.mock('../data/api', () => ({
  ensureUserProfile: mocks.ensureUserProfile,
  attestAdult: mocks.attestAdult,
  // AuthContext's authority read is now server-only (getDocFromServer, #117 r6);
  // point it at the same spy this suite already configures for the settled read.
  readAdultAttestationFromServer: mocks.readAdultAttestation,
  readAdultAttestationFromCache: mocks.readAdultAttestationFromCache,
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

const mount = () => render(<AuthProvider><Harness /></AuthProvider>);
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
  mocks.signInWithPopup.mockResolvedValue({});
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
});

describe('AuthContext stale-attempt + retry hardening', () => {
  it('drops a stale deal rejection from a signed-out account after a new account has dealt (P2)', async () => {
    const stale = deferred<void>();
    mocks.joinAndDeal.mockReturnValueOnce(stale.promise).mockResolvedValueOnce(undefined);
    mount();
    await act(async () => void (await emitAuth(FAKE_USER))); // account A: deal left in flight
    await act(async () => void (await emitAuth(null))); // player signs out
    await act(async () => void (await emitAuth({ uid: 'sailor-2', displayName: 'Other', photoURL: null }))); // account B deals
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
