import { render, screen, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuthProvider, useAuth } from './AuthContext';

// Covers specs/x-offline-cold-boot.md — the app must cold-boot from the
// persistent cache while OFFLINE (#115): publish the signed-in User and settle
// `loading: false` immediately, run the network-bound bootstrap OFF the render
// path, settle the 18+ gate cache-first without ever failing it open, and recover
// deterministically on reconnect. Mocks the Firebase + data-layer boundary so the
// REAL AuthProvider runs under jsdom and the tests drive connectivity by hand.
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
  // Mutable so the reconnect handler's `auth.currentUser` read resolves the
  // signed-in User (Firebase restores the persisted User offline).
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
// "Loading…" forever. If the fix touched it on the critical path, the mount would
// hang here.
const NEVER = new Promise<void>(() => {});

// Children render only when the re-prompt gate is DOWN (needsAttestation false);
// when it is up, AuthProvider renders <SignIn/> in their place (its re-prompt
// copy is asserted directly). So `board` present ⇔ the Board would render.
function Probe() {
  const { user, loading } = useAuth();
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

// Fire the auth callback and flush its SYNCHRONOUS publish (user + loading:false)
// WITHOUT awaiting the fire-and-forget bootstrap — mirroring Firebase, which
// ignores an onAuthStateChanged callback's return value. Tests that need the
// bootstrap to have progressed use waitFor.
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
    // Offline: ensureUserProfile (a transaction) would never resolve. The cached
    // stamp is present so the returning User is attested.
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
  });

  it("settles the 18+ gate offline from a cached attestation, and cache-first never fails it open on the server's word", async () => {
    setOnline(false);
    mocks.ensureUserProfile.mockReturnValue(NEVER);
    mocks.readAdultAttestationFromCache.mockResolvedValue(1); // cached: attested

    mount();
    await coldBoot(RETURNING_USER);

    // Gate DOWN offline: the Board renders, no re-prompt, and the deal is deferred
    // (returning boarded User needs none).
    await waitFor(() => expect(screen.getByTestId('board')).toBeInTheDocument());
    expect(rePromptShown()).toBe(false);
    expect(mocks.joinAndDeal).not.toHaveBeenCalled();

    // Prove the CACHE settled attestation TRUE (not merely UNKNOWN): reconnect
    // with a server read that (contrived) reports NO stamp. Because the cache
    // already settled `true`, the optimistic value wins — still no re-prompt. Had
    // the cache left it UNKNOWN, the server `null` would drop the re-prompt gate.
    mocks.ensureUserProfile.mockResolvedValue(undefined);
    mocks.readAdultAttestation.mockResolvedValue(null);
    await reconnect();

    await waitFor(() => expect(mocks.ensureUserProfile).toHaveBeenCalled());
    expect(rePromptShown()).toBe(false);
    expect(screen.getByTestId('board')).toBeInTheDocument();
    // Still a returning User — reconnect deals nothing (no undefined→true edge).
    expect(mocks.joinAndDeal).not.toHaveBeenCalled();
  });

  it('leaves attestation UNKNOWN with no cached stamp — the gate holds, the deal defers, and reconnect recovers deterministically', async () => {
    setOnline(false);
    mocks.ensureUserProfile.mockReturnValue(NEVER);
    mocks.readAdultAttestationFromCache.mockRejectedValue(new Error('cache miss'));

    mount();
    await coldBoot(RETURNING_USER);

    // UNKNOWN offline: the Board still renders (no blocking), but the gate holds —
    // no re-prompt flash, and the deal does not fire (attestation not settled true,
    // and offline anyway).
    expect(screen.getByTestId('board')).toBeInTheDocument();
    expect(rePromptShown()).toBe(false);
    expect(mocks.joinAndDeal).not.toHaveBeenCalled();

    // Reconnect: the DEFERRED bootstrap runs exactly once, the server settles the
    // attestation true, and the deferred deal fires — deterministic recovery, no
    // pending transaction left racing the supersede logic.
    mocks.ensureUserProfile.mockResolvedValue(undefined);
    mocks.readAdultAttestation.mockResolvedValue(1);
    await reconnect();

    await waitFor(() => expect(mocks.joinAndDeal).toHaveBeenCalledTimes(1));
    expect(rePromptShown()).toBe(false);
  });

  it('does NOT fail the age gate open offline: with no attestation anywhere, reconnect settles the re-prompt and never deals', async () => {
    setOnline(false);
    mocks.ensureUserProfile.mockReturnValue(NEVER);
    mocks.readAdultAttestationFromCache.mockRejectedValue(new Error('cache miss'));

    mount();
    await coldBoot(RETURNING_USER);

    // Offline it never assumes attested — no deal, no re-prompt (UNKNOWN, held).
    expect(mocks.joinAndDeal).not.toHaveBeenCalled();
    expect(rePromptShown()).toBe(false);

    // Reconnect with a server that reports a genuinely UN-attested profile: the
    // gate now HOLDS as a definite re-prompt (never a fail-open deal).
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
