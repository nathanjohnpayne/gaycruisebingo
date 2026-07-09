import { render, screen, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuthProvider, useAuth } from './AuthContext';

// Covers specs/x-offline-cold-boot.md — the connectivity/attestation state
// machine (#115). The cache lifts the 18+ gate PROVISIONALLY offline so the app
// cold-boots from the persistent cache without awaiting the network; the server
// read is AUTHORITATIVE when it arrives (online sessions stay gated until it
// settles, and it downgrades a stale cache lift); and the deferred deal fires on
// reconnect. Mocks the Firebase + data-layer boundary so the REAL AuthProvider
// runs under jsdom, with connectivity driven by hand.
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
  // Mutable so the reconnect handler / attest() read the signed-in User (Firebase
  // restores the persisted User offline).
  auth: { currentUser: null as unknown },
}));

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: mocks.onAuthStateChanged,
  signInWithPopup: mocks.signInWithPopup,
  signOut: mocks.signOut,
  GoogleAuthProvider: class {},
}));
vi.mock('../firebase', () => ({ auth: mocks.auth, googleProvider: {} }));
vi.mock('../data/api', () => ({
  ensureUserProfile: mocks.ensureUserProfile,
  attestAdult: mocks.attestAdult,
  readAdultAttestation: mocks.readAdultAttestation,
  readAdultAttestationFromCache: mocks.readAdultAttestationFromCache,
  joinAndDeal: mocks.joinAndDeal,
}));
vi.mock('../analytics', () => ({ track: mocks.track }));

const RETURNING_USER = { uid: 'sailor-1', displayName: 'Sailor', photoURL: null };

// The auth-state callback AuthProvider registers; emitting a User through it
// simulates Firebase restoring the persisted account on a cold boot.
let emitAuth: (u: unknown) => unknown = () => {};

// Never settles — models a Firestore TRANSACTION offline: ensureUserProfile does
// not queue, so awaiting it on the render path is what stuck the old app on
// "Loading…" forever.
const NEVER = new Promise<void>(() => {});

function deferred<T>() {
  let settle!: (v: T) => void;
  const promise = new Promise<T>((res) => (settle = res));
  return { promise, settle };
}

// `loading` is App.tsx's Board gate (App renders "Loading…" while loading is true,
// the Board only once it is false), so a unit test can read it as the proxy for
// "would the Board render?". `board` renders only when the re-prompt gate is DOWN;
// when it is up, AuthProvider renders <SignIn/> in its place. signIn/attest are
// captured to drive the same-session optimistic-attest path (#112 Finding 3).
let ctxSignIn: () => Promise<void> = async () => {};
function Probe() {
  const { user, loading, signIn } = useAuth();
  ctxSignIn = signIn;
  return (
    <div>
      <span data-testid="loading">{loading ? 'loading' : 'ready'}</span>
      <span data-testid="uid">{user?.uid ?? 'none'}</span>
      <span data-testid="board">board</span>
    </div>
  );
}

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value });
}

const mount = () =>
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );

// Fire the auth callback and flush its SYNCHRONOUS publish WITHOUT awaiting the
// fire-and-forget bootstrap — mirroring Firebase, which ignores the callback's
// return value. Tests that need the bootstrap to have progressed use waitFor.
const coldBoot = (u: unknown) =>
  act(async () => {
    mocks.auth.currentUser = u;
    void emitAuth(u);
  });

// Simulate the network returning: flip the connectivity probe and dispatch the
// browser 'online' event AuthProvider listens on.
const reconnect = () =>
  act(async () => {
    setOnline(true);
    window.dispatchEvent(new Event('online'));
  });

const rePromptShown = () => screen.queryByText(/One quick thing/i) !== null;

beforeEach(() => {
  vi.clearAllMocks();
  emitAuth = () => {};
  ctxSignIn = async () => {};
  mocks.auth.currentUser = null;
  setOnline(true);
  mocks.onAuthStateChanged.mockImplementation((_a: unknown, cb: (u: unknown) => unknown) => {
    emitAuth = cb;
    return () => {};
  });
  mocks.ensureUserProfile.mockResolvedValue(undefined);
  mocks.readAdultAttestation.mockResolvedValue(1);
  mocks.readAdultAttestationFromCache.mockRejectedValue(new Error('cache miss'));
  mocks.attestAdult.mockResolvedValue(undefined);
  mocks.joinAndDeal.mockResolvedValue(undefined);
  mocks.signInWithPopup.mockResolvedValue({});
  mocks.signOut.mockResolvedValue(undefined);
});

afterEach(() => setOnline(true));

describe('offline cold boot (#115)', () => {
  it('publishes the User and settles loading:false without awaiting the network transaction', async () => {
    // Offline: ensureUserProfile (a transaction) would never resolve; the cached
    // stamp settles the returning User attested.
    setOnline(false);
    mocks.ensureUserProfile.mockReturnValue(NEVER);
    mocks.readAdultAttestationFromCache.mockResolvedValue(1);

    mount();
    await coldBoot(RETURNING_USER);

    // The shell renders NOW, from the cache — not stuck on "Loading…".
    expect(screen.getByTestId('loading')).toHaveTextContent('ready');
    expect(screen.getByTestId('uid')).toHaveTextContent('sailor-1');
    expect(screen.getByTestId('board')).toBeInTheDocument();
    // The transaction was never even reached offline — it is deferred, not awaited.
    expect(mocks.ensureUserProfile).not.toHaveBeenCalled();
    // A deal is a network-bound create path; it must not fire offline.
    expect(mocks.joinAndDeal).not.toHaveBeenCalled();
    expect(rePromptShown()).toBe(false);
  });

  it('finding B: an ONLINE un-attested session stays gated on Loading until the server read settles, THEN re-prompts', async () => {
    // Online: the authoritative read is held in flight.
    setOnline(true);
    mocks.readAdultAttestationFromCache.mockRejectedValue(new Error('cache miss'));
    const read = deferred<number | null>();
    mocks.ensureUserProfile.mockResolvedValue(undefined);
    mocks.readAdultAttestation.mockReturnValue(read.promise);

    mount();
    await coldBoot(RETURNING_USER);

    // While the read is in flight the app is GATED: App would show "Loading…",
    // NOT the Board (loading still true), and no re-prompt has flashed.
    expect(screen.getByTestId('loading')).toHaveTextContent('loading');
    expect(rePromptShown()).toBe(false);
    expect(mocks.joinAndDeal).not.toHaveBeenCalled();

    // The server says NO stamp → the gate resolves to a re-prompt, loading released.
    await act(async () => {
      read.settle(null);
      await read.promise;
    });
    // The re-prompt appearing (needsAttestation requires profileReady) implies the
    // gate settled and loading was released; the Probe is now unmounted behind it.
    await waitFor(() => expect(rePromptShown()).toBe(true));
    expect(mocks.joinAndDeal).not.toHaveBeenCalled();
  });

  it('finding B (offline half): a cache-attested returning User renders the cached Board immediately offline', async () => {
    setOnline(false);
    mocks.readAdultAttestationFromCache.mockResolvedValue(1); // cached: attested
    mocks.ensureUserProfile.mockReturnValue(NEVER);

    mount();
    await coldBoot(RETURNING_USER);

    // Rendered immediately from cache — loading released, no gate, no deal offline.
    await waitFor(() => expect(screen.getByTestId('board')).toBeInTheDocument());
    expect(screen.getByTestId('loading')).toHaveTextContent('ready');
    expect(rePromptShown()).toBe(false);
    expect(mocks.joinAndDeal).not.toHaveBeenCalled();
  });

  it('finding C: a cache-attested User with no board for the Event defers the deal offline and fires it exactly once on reconnect', async () => {
    // Offline cold boot: attested from cache, but this is a FRESH Event so
    // joinAndDeal has real work (boards are per-Event). It must not run offline.
    setOnline(false);
    mocks.readAdultAttestationFromCache.mockResolvedValue(1);
    mocks.ensureUserProfile.mockResolvedValue(undefined);
    mocks.readAdultAttestation.mockResolvedValue(1); // server confirms on reconnect

    mount();
    await coldBoot(RETURNING_USER);

    expect(mocks.joinAndDeal).not.toHaveBeenCalled();
    expect(rePromptShown()).toBe(false);

    // Reconnect: the deferred deal fires exactly once (the online state flip
    // re-runs the gated deal effect), and never before.
    await reconnect();
    await waitFor(() => expect(mocks.joinAndDeal).toHaveBeenCalledTimes(1));
  });

  it('finding D: an authoritative server read with NO stamp downgrades a stale cache lift to a re-prompt on reconnect', async () => {
    // Offline: a STALE cached stamp provisionally lifts the gate.
    setOnline(false);
    mocks.readAdultAttestationFromCache.mockResolvedValue(1);
    mocks.ensureUserProfile.mockResolvedValue(undefined);

    mount();
    await coldBoot(RETURNING_USER);
    expect(rePromptShown()).toBe(false); // provisionally attested offline

    // Reconnect: the server row now has NO stamp (owner deleted/recreated it).
    // The authoritative read DOWNGRADES the provisional lift → re-prompt.
    mocks.readAdultAttestation.mockResolvedValue(null);
    await reconnect();

    await waitFor(() => expect(rePromptShown()).toBe(true));
    expect(mocks.joinAndDeal).not.toHaveBeenCalled();
  });

  it('finding D: an authoritative server read that CONFIRMS the stamp keeps the User attested', async () => {
    setOnline(false);
    mocks.readAdultAttestationFromCache.mockResolvedValue(1);
    mocks.ensureUserProfile.mockResolvedValue(undefined);

    mount();
    await coldBoot(RETURNING_USER);

    mocks.readAdultAttestation.mockResolvedValue(1); // server confirms
    await reconnect();

    await waitFor(() => expect(mocks.joinAndDeal).toHaveBeenCalled());
    expect(rePromptShown()).toBe(false);
    expect(screen.getByTestId('board')).toBeInTheDocument();
  });

  it('#112 preserved: a same-session optimistic attest stays sticky even when the server read returns no stamp', async () => {
    // A first-time sign-in this session records the uid in attestedUidsRef and
    // flips attested true optimistically; a later auth callback whose server read
    // does not yet see the write must NOT downgrade it.
    setOnline(true);
    mocks.readAdultAttestationFromCache.mockRejectedValue(new Error('cache miss'));
    mocks.ensureUserProfile.mockResolvedValue(undefined);
    mocks.readAdultAttestation.mockResolvedValue(null); // stale: attest txn not visible yet

    mount();
    mocks.auth.currentUser = RETURNING_USER;
    await act(async () => {
      await ctxSignIn(); // signInWithPopup → attest(): sticky + optimistic true
    });
    await coldBoot(RETURNING_USER);

    // The stale server null does NOT re-prompt — the same-session attest is sticky.
    await waitFor(() => expect(mocks.joinAndDeal).toHaveBeenCalled());
    expect(rePromptShown()).toBe(false);
  });

  it('does NOT fail the age gate open offline: no attestation anywhere means UNKNOWN, held, and never a deal', async () => {
    setOnline(false);
    mocks.readAdultAttestationFromCache.mockRejectedValue(new Error('cache miss'));
    mocks.ensureUserProfile.mockReturnValue(NEVER);

    mount();
    await coldBoot(RETURNING_USER);

    // Offline it never assumes attested — no deal, no re-prompt (UNKNOWN, held).
    expect(mocks.joinAndDeal).not.toHaveBeenCalled();
    expect(rePromptShown()).toBe(false);

    // Reconnect with a server that reports a genuinely UN-attested profile: the
    // gate HOLDS as a definite re-prompt, never a fail-open deal.
    mocks.ensureUserProfile.mockResolvedValue(undefined);
    mocks.readAdultAttestation.mockResolvedValue(null);
    await reconnect();

    await waitFor(() => expect(rePromptShown()).toBe(true));
    expect(mocks.joinAndDeal).not.toHaveBeenCalled();
  });

  it('online: a genuinely-new attested User still deals', async () => {
    setOnline(true);
    mocks.readAdultAttestationFromCache.mockRejectedValue(new Error('cache miss'));
    mocks.ensureUserProfile.mockResolvedValue(undefined);
    mocks.readAdultAttestation.mockResolvedValue(1); // server: attested

    mount();
    await coldBoot(RETURNING_USER);

    await waitFor(() => expect(mocks.joinAndDeal).toHaveBeenCalledTimes(1));
    expect(rePromptShown()).toBe(false);
    expect(screen.getByTestId('board')).toBeInTheDocument();
  });
});
