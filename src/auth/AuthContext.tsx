import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { auth, googleProvider } from '../firebase';
import { attestAdult, ensureUserProfile, joinAndDeal, readAdultAttestation } from '../data/api';
import { track } from '../analytics';
import SignIn from '../components/SignIn';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  // False from the moment a signed-in User is published until THAT User's
  // ensureUserProfile bootstrap settles (#77). Unlike `loading` — which covers
  // only the first auth callback — it re-arms on every auth change (popup
  // sign-in, account switch), so a profile-writing consumer can gate on it and
  // never act on `user` before the users/{uid} bootstrap has settled.
  profileReady: boolean;
  // True when a signed-in User's SETTLED profile lacks the honor-system 18+
  // attestation (ADR 0001), so the re-prompt gate stands before the Board (#23).
  // Never true mid-bootstrap: it is gated on profileReady, so an attestation that
  // is still UNKNOWN during load can't flash the prompt.
  needsAttestation: boolean;
  dealError: string | null; // Player-worded deal failure, or null once the Board dealt.
  dealing: boolean; // True while a join/deal (initial or retry) is in flight.
  signIn: () => Promise<void>;
  signOutUser: () => Promise<void>;
  // Persist the current User's 18+ self-attestation (ADR 0001) and lift the gate.
  attest: () => Promise<void>;
  retryDeal: () => void; // Re-run joinAndDeal for the current User, no reload.
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  profileReady: false,
  needsAttestation: false,
  dealError: null,
  dealing: false,
  signIn: async () => {},
  signOutUser: async () => {},
  attest: async () => {},
  retryDeal: () => {},
});

// Player-facing copy for a deal failure. The main case (ADR 0003/0004) is
// `dealBoard` throwing when the active non-free pool is below the 24 a Board needs.
function dealErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/\b24 prompts\b/.test(raw)) {
    return "We couldn't deal your card yet — the prompt pool is below the 24 a card needs. Ask an admin to add a few prompts, then retry.";
  }
  return "We couldn't deal your bingo card. Check your connection and retry.";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [dealError, setDealError] = useState<string | null>(null);
  const [dealing, setDealing] = useState(false);
  // False from the moment a signed-in User is published until THAT User's
  // ensureUserProfile bootstrap settles (#77) — see the interface note.
  const [profileReady, setProfileReady] = useState(false);
  // Tri-state 18+ attestation for the current User (#23): `undefined` = UNKNOWN
  // (bootstrap unsettled, or an indeterminate read); `true` = attested; `false` =
  // a SETTLED profile with no stamp → re-prompt. A missing stamp during load is
  // UNKNOWN, not absent — the knownFirstBingoAt tri-state discipline — so it never
  // flashes the gate.
  const [attested, setAttested] = useState<boolean | undefined>(undefined);
  // Monotonic id of the latest deal attempt; runDeal captures it and re-checks
  // before each setState so a superseded attempt's late result is dropped (P2).
  const dealAttemptRef = useRef(0);
  // Monotonic id of the latest auth change, captured before the awaited
  // ensureUserProfile so a retired account's slower bootstrap can't flip
  // profileReady true for the account that already replaced it. A SEPARATE ref
  // from dealAttemptRef on purpose: runDeal bumps dealAttemptRef mid-sign-in,
  // which must not read as the profile bootstrap being superseded.
  const profileAttemptRef = useRef(0);
  // Per-uid record that this session has already called `attest()` for a User
  // (#23, Finding 3). `attest()` flips `attested` true optimistically, but the
  // auth-state callback re-arms `attested` to UNKNOWN on every change and then
  // settles it from a fresh `readAdultAttestation`. If that read lands BEFORE the
  // attest transaction is visible, the settle would DOWNGRADE a just-attested User
  // back to a re-prompt. The attest transaction's success is authoritative — it
  // wrote the stamp — so a uid recorded here is never settled back to `false`.
  const attestedUidsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    return onAuthStateChanged(auth, async (u) => {
      // Auth changed: retire the previous account's in-flight deal and clear its
      // stale state so a late result can't clobber the incoming User (P2).
      const profileAttempt = (profileAttemptRef.current += 1);
      dealAttemptRef.current += 1;
      setDealError(null);
      setDealing(false);
      // The incoming User's profile bootstrap has not settled yet (#77), so the
      // 18+ attestation is UNKNOWN — never `false` — until it does (#23).
      setProfileReady(false);
      setAttested(undefined);
      setUser(u);
      let attestedRead: boolean | undefined;
      if (u) {
        try {
          await ensureUserProfile(u);
          // Read the SETTLED row (create-or-existing) so the gate sees a definite
          // present/absent, not the pre-create absence; a thrown read stays
          // UNKNOWN below (no re-prompt), so only a definite miss gates.
          attestedRead = (await readAdultAttestation(u.uid)) !== null;
        } catch {
          /* profile bootstrap can retry later; attestation stays UNKNOWN */
        }
      }
      // Only the latest auth change settles this bootstrap: a superseded callback
      // (a newer sign-in / sign-out already ran) leaves it to that newer one,
      // which owns the signal now — mirrors the deal's stale-attempt guard.
      if (profileAttemptRef.current === profileAttempt) {
        // Never downgrade an attestation the User just made optimistically via
        // `attest()` (#23, Finding 3): its write may not be visible to the read
        // above yet, but the transaction's success is authoritative. A uid marked
        // in attestedUidsRef stays attested; the `prev === true` check also
        // preserves an optimistic flip that happened to land during this await.
        const attestedSticky = u != null && attestedUidsRef.current.has(u.uid);
        setAttested((prev) => (prev === true || attestedSticky ? true : attestedRead));
        setProfileReady(true);
      }
      setLoading(false);
    });
  }, []);

  // Deal a Board once the User is known; failures surface via `dealError` so
  // App renders a retry surface, not a blank Board. `dealError` is replaced only
  // when THIS attempt settles — clearing it up front would unmount the retry
  // surface mid-retry and flash the blank Board (P3) — and a superseded attempt
  // (sign-out / account switch mid-deal) is dropped entirely (P2).
  const runDeal = useCallback(async (u: User) => {
    const attempt = (dealAttemptRef.current += 1);
    setDealing(true);
    try {
      await joinAndDeal(u);
      if (dealAttemptRef.current !== attempt) return;
      setDealError(null);
      track('join_event');
    } catch (err) {
      if (dealAttemptRef.current !== attempt) return;
      setDealError(dealErrorMessage(err));
    } finally {
      if (dealAttemptRef.current === attempt) setDealing(false);
    }
  }, []);

  // Deal a Board only once the 18+ attestation is settled TRUE (#23, Finding 1):
  // the gate must gate the SIDE EFFECT, not just the UI. A signed-in returning
  // User whose settled profile lacks the stamp is re-prompted BEFORE joinAndDeal
  // creates their event board/player row — so the deal is DEFERRED, not merely
  // hidden. When such a User then attests, `attested` flips true and this fires the
  // deferred deal exactly once; an already-attested User deals as before (the read
  // settles `attested` true straight away); a first-time User deals after the
  // signed-in attest flow settles true. The dealAttempt guard + joinAndDeal's
  // board-exists early-return keep the flip from double-dealing.
  useEffect(() => {
    if (user && attested === true) void runDeal(user);
  }, [user, attested, runDeal]);

  const retryDeal = useCallback(() => {
    if (user) void runDeal(user);
  }, [user, runDeal]);

  // Persist the current User's honor-system 18+ self-attestation (ADR 0001) and
  // lift the re-prompt gate at once. Optimistic: the local flag flips before the
  // write acks, so a slow write never re-shows the prompt the User just satisfied;
  // a failed write stays optimistically attested for the session and re-attempts
  // on the next sign-in (honor-system self-statement, never a hard gate).
  const attest = useCallback(async () => {
    const u = auth.currentUser;
    if (!u) return;
    // Mark this uid attested for the session BEFORE the optimistic flip so a
    // later auth-state callback can never settle it back to a re-prompt on a
    // stale read (#23, Finding 3). Pass the full User so a create-race win writes
    // the COMPLETE profile, not just the stamp (Finding 2).
    attestedUidsRef.current.add(u.uid);
    setAttested(true);
    try {
      await attestAdult(u);
    } catch {
      /* keep the session optimistically attested; the write retries next sign-in */
    }
  }, []);

  const signIn = async () => {
    await signInWithPopup(auth, googleProvider);
    track('login', { method: 'google' });
    // The 18+ checkbox gated this sign-in (SignIn.tsx), so signing in IS the
    // attestation — persist it now that we have a uid, so a first-time User is not
    // re-prompted for the box they just ticked (#23).
    await attest();
  };

  const signOutUser = async () => {
    await signOut(auth);
  };

  // Re-prompt a signed-in User whose SETTLED profile lacks the 18+ attestation,
  // before they reach the Board (#23) — full-screen, mirroring the signed-out
  // SignIn gate App renders on `!user`. Gated on profileReady so a still-loading
  // bootstrap (attestation UNKNOWN) never flashes the prompt. `SignIn` reads
  // `user` from context to render its re-prompt mode.
  const needsAttestation = user != null && profileReady && attested === false;

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        profileReady,
        needsAttestation,
        dealError,
        dealing,
        signIn,
        signOutUser,
        attest,
        retryDeal,
      }}
    >
      {needsAttestation ? <SignIn /> : children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
