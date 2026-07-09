import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthProvider, useAuth } from '../auth/AuthContext';

// Covers specs/w1-attestation.md — the 18+ re-prompt gate (#23). Mock the Firebase
// + data-layer boundary so the REAL AuthProvider + SignIn run under jsdom, and
// drive the auth callback by hand. AuthProvider renders the <SignIn/> re-prompt in
// place of its children when a SETTLED profile lacks the attestation.
const mocks = vi.hoisted(() => ({
  onAuthStateChanged: vi.fn(),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
  ensureUserProfile: vi.fn(),
  attestAdult: vi.fn(),
  readAdultAttestation: vi.fn(),
  joinAndDeal: vi.fn(),
  track: vi.fn(),
  // Mutable Firebase auth double: attest() reads auth.currentUser.uid.
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
  joinAndDeal: mocks.joinAndDeal,
}));
vi.mock('../analytics', () => ({ track: mocks.track }));

const FAKE_USER = { uid: 'sailor-1', displayName: 'Sailor', photoURL: null };

// The auth-state callback AuthProvider registers; emitting a User simulates
// Firebase resolving a returning session / the Google popup.
let emitAuth: (u: unknown) => unknown = () => {};

// A promise whose settlement the test drives, to hold the profile bootstrap in
// flight so the "does not flash" window is observable.
function deferred<T>() {
  let settle!: (v: T) => void;
  const promise = new Promise<T>((res) => (settle = res));
  return { promise, settle };
}

// The Board stand-in behind the gate; present only when the User is let through.
const BOARD = 'THE BINGO BOARD';
const mount = () =>
  render(
    <AuthProvider>
      <div>{BOARD}</div>
    </AuthProvider>,
  );

// Captures the context's signIn() so a test can await the FULL first-time
// continuation (popup → attest) deterministically — needed to reproduce the
// Finding-3 race where attest() lands optimistically before a later, still-stale
// auth-state callback read.
let ctxSignIn: () => Promise<void> = async () => {};
function CaptureContext() {
  ctxSignIn = useAuth().signIn;
  return null;
}
const mountWithCapture = () =>
  render(
    <AuthProvider>
      <CaptureContext />
      <div>{BOARD}</div>
    </AuthProvider>,
  );

const signIn = (u: unknown) => act(async () => void emitAuth(u));
const boardShown = () => screen.queryByText(BOARD) !== null;
const rePrompted = () =>
  screen.queryByRole('button', { name: /enter the event/i }) !== null;

beforeEach(() => {
  vi.clearAllMocks();
  emitAuth = () => {};
  ctxSignIn = async () => {};
  mocks.auth.currentUser = null;
  mocks.onAuthStateChanged.mockImplementation((_a: unknown, cb: (u: unknown) => unknown) => {
    emitAuth = cb;
    return () => {};
  });
  mocks.ensureUserProfile.mockResolvedValue(undefined);
  mocks.attestAdult.mockResolvedValue(undefined);
  mocks.joinAndDeal.mockResolvedValue(undefined);
  mocks.signInWithPopup.mockResolvedValue({});
  mocks.signOut.mockResolvedValue(undefined);
});

describe('18+ attestation re-prompt gate (#23)', () => {
  it('re-prompts a signed-in User whose settled profile lacks attestedAdultAt', async () => {
    mocks.readAdultAttestation.mockResolvedValue(null); // settled: no stamp
    mount();
    await signIn(FAKE_USER);

    expect(rePrompted()).toBe(true);
    expect(boardShown()).toBe(false);
  });

  it('lets an already-attested User pass straight through to the Board', async () => {
    mocks.readAdultAttestation.mockResolvedValue(1_720_000_000_000); // settled: attested
    mount();
    await signIn(FAKE_USER);

    expect(boardShown()).toBe(true);
    expect(rePrompted()).toBe(false);
  });

  it('does not flash the prompt while the profile bootstrap is still in flight', async () => {
    const boot = deferred<void>();
    mocks.ensureUserProfile.mockReturnValueOnce(boot.promise); // bootstrap unsettled
    mocks.readAdultAttestation.mockResolvedValue(null); // would gate — but only after settle
    mount();
    await signIn(FAKE_USER);

    // Bootstrap unsettled → attestation UNKNOWN (not absent) → NO re-prompt.
    expect(rePrompted()).toBe(false);
    expect(boardShown()).toBe(true);

    // Once it settles with no stamp, the gate appears — proving the pre-settle
    // absence was UNKNOWN, not a flashed re-prompt.
    await act(async () => {
      boot.settle();
      await boot.promise;
    });
    expect(rePrompted()).toBe(true);
    expect(boardShown()).toBe(false);
  });

  it('lifts the gate when the re-prompted User attests, deferring the deal until then', async () => {
    mocks.readAdultAttestation.mockResolvedValue(null);
    mocks.auth.currentUser = FAKE_USER; // the returning User is signed in
    mount();
    await signIn(FAKE_USER);
    expect(rePrompted()).toBe(true);
    // Finding 1 (the P1): behind the re-prompt the deal side effect must NOT run —
    // no event board/player row is created before the 18+ box is ticked. A genuine
    // unattested callback keeps the gate closed (Finding 3 negative control).
    expect(mocks.joinAndDeal).not.toHaveBeenCalled();

    // Tick the 18+ box and enter — attest() persists + optimistically lifts the gate.
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: /enter the event/i }));

    expect(mocks.attestAdult).toHaveBeenCalledWith(FAKE_USER);
    expect(boardShown()).toBe(true);
    expect(rePrompted()).toBe(false);
    // Attesting fires the DEFERRED deal, exactly once.
    await waitFor(() => expect(mocks.joinAndDeal).toHaveBeenCalledTimes(1));
  });
});

// Finding 1 (P1): the attestation gate must gate the deal SIDE EFFECT, not just
// the UI — joinAndDeal cannot create the board/player row until attestation is
// settled true. Finding 3 (P2): the optimistic attested=true is sticky per uid,
// so a stale auth-state callback read cannot downgrade a just-attested User back
// to a re-prompt, and the deferred deal still fires on that optimistic path.
describe('attestation gates the deal side effect + sticky optimistic attest (#23, Findings 1 & 3)', () => {
  it('deals exactly once for an already-attested returning User', async () => {
    mocks.readAdultAttestation.mockResolvedValue(1_720_000_000_000); // settled: attested
    mount();
    await signIn(FAKE_USER);

    expect(boardShown()).toBe(true);
    await waitFor(() => expect(mocks.joinAndDeal).toHaveBeenCalledTimes(1));
  });

  it('keeps a just-attested first-time User attested through a stale callback read, dealing once', async () => {
    // First-time flow: the sign-in continuation calls attest() optimistically, then
    // the auth-state callback lands with a read that PREDATES the attest write's
    // visibility (null). The per-uid sticky marker must keep the User attested (no
    // downgrade, no re-prompt), and the deferred deal fires once (Finding 3 ∘ 1).
    mocks.readAdultAttestation.mockResolvedValue(null); // stale: attest txn not visible to the read
    mocks.auth.currentUser = FAKE_USER;
    mountWithCapture();

    // 1. Continuation: popup resolves → signIn calls attest() → attested flips true
    //    and the uid is marked sticky. The User is not published yet, so no deal.
    await act(async () => {
      await ctxSignIn();
    });
    expect(mocks.attestAdult).toHaveBeenCalledWith(FAKE_USER);
    expect(mocks.joinAndDeal).not.toHaveBeenCalled();

    // 2. The auth-state callback lands with the still-stale (null) read.
    await signIn(FAKE_USER);
    expect(rePrompted()).toBe(false);
    expect(boardShown()).toBe(true);
    await waitFor(() => expect(mocks.joinAndDeal).toHaveBeenCalledTimes(1));
  });
});
