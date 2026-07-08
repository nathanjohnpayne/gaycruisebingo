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
vi.mock('../data/api', () => ({ ensureUserProfile: mocks.ensureUserProfile, joinAndDeal: mocks.joinAndDeal }));
vi.mock('../analytics', () => ({ track: mocks.track }));

const FAKE_USER = { uid: 'sailor-1', displayName: 'Sailor', photoURL: null };

// The auth-state callback AuthProvider registers; emitting a User through it
// simulates Firebase resolving the Google popup.
let emitAuth: (u: unknown) => unknown = () => {};

function Harness() {
  const { dealError, retryDeal, signIn } = useAuth();
  return (
    <div>
      {dealError ? <p role="alert">{dealError}</p> : null}
      <button onClick={() => retryDeal()}>retry</button>
      <button onClick={() => void signIn()}>signin</button>
    </div>
  );
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
  mocks.signInWithPopup.mockResolvedValue({});
  mocks.signOut.mockResolvedValue(undefined);
});

describe('AuthContext deal-error hardening', () => {
  it('surfaces the pool-below-24 failure and Retry re-invokes joinAndDeal, clearing it', async () => {
    mocks.joinAndDeal
      .mockRejectedValueOnce(new Error('dealBoard needs at least 24 prompts, received 5.'))
      .mockResolvedValueOnce(undefined);
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
