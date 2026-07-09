import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { auth, googleProvider } from '../firebase';
import { attestAdult, ensureUserProfile, joinAndDeal, readAdultAttestation } from '../data/api';
import { track } from '../analytics';
import SignIn from '../components/SignIn';
import ConfirmWinMoments from '../components/ConfirmWinMoments';

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
  // Player-worded, retryable failure on the path to a dealt Board — a failed
  // join/deal, or a failed attestation bootstrap (#112 round 2) — null once dealt.
  dealError: string | null;
  // True while a join/deal (initial or retry) or the bootstrap retry that
  // precedes a deferred deal is in flight.
  dealing: boolean;
  signIn: () => Promise<void>;
  signOutUser: () => Promise<void>;
  // Persist the current User's 18+ self-attestation (ADR 0001) and lift the gate.
  attest: () => Promise<void>;
  // Retry the current User's path to a dealt Board in place (no reload): re-runs
  // joinAndDeal when the attestation is settled true, else re-attempts the FAILED
  // ensureUserProfile + readAdultAttestation bootstrap (#112 round 2) — never the
  // deal itself while the attestation is unsettled (Finding 1).
  retryDeal: () => void;
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
      // A THROWN bootstrap must not stall silently (#112 round 2): with the deal
      // gated on attested === true (Finding 1), an attestation left UNKNOWN by a
      // transient Firestore failure would otherwise strand the User on the
      // Board's endless "Dealing your card…" — no deal, no re-prompt, no error.
      // Capture the failure and surface it through the retryable dealError below.
      let bootstrapFailure: { err: unknown } | null = null;
      if (u) {
        try {
          await ensureUserProfile(u);
          // Read the SETTLED row (create-or-existing) so the gate sees a definite
          // present/absent, not the pre-create absence; a thrown read stays
          // UNKNOWN below (no re-prompt), so only a definite miss gates.
          attestedRead = (await readAdultAttestation(u.uid)) !== null;
        } catch (err) {
          bootstrapFailure = { err };
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
        // Surface a failed bootstrap as the SAME Player-worded, retryable error a
        // failed deal gets (the #61 surface): App renders the DealError panel on
        // the Card tab, and its Retry re-attempts the bootstrap (retryDeal picks
        // the bootstrap path while the attestation is unsettled). A sticky-
        // attested User needs no surface here — their gate settles true above, so
        // the deferred deal fires and reports any genuine failure itself.
        if (bootstrapFailure && !attestedSticky) {
          setDealError(dealErrorMessage(bootstrapFailure.err));
        }
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

  // Re-attempt a FAILED attestation bootstrap (#112 round 2): re-runs
  // ensureUserProfile + readAdultAttestation under profileAttemptRef — the same
  // guard as the auth callback whose work it re-runs — so a newer auth change
  // supersedes it. On success the attestation settles: `true` fires the deferred
  // deal via the attested gate (keep `dealing` up so the retry surface shows
  // seamless progress, and let the deal's OWN settle replace dealError — the P3
  // discipline: never clear before settle); a definite `false` hands over to the
  // full-screen re-prompt, so the stale error and in-flight flag are dropped. A
  // repeat failure re-arms the same honest error+retry surface — never the
  // silent spinner this replaces.
  const retryBootstrap = useCallback(async (u: User) => {
    const attempt = (profileAttemptRef.current += 1);
    setDealing(true);
    try {
      await ensureUserProfile(u);
      const read = (await readAdultAttestation(u.uid)) !== null;
      if (profileAttemptRef.current !== attempt) return;
      const attestedSticky = attestedUidsRef.current.has(u.uid);
      setAttested((prev) => (prev === true || attestedSticky ? true : read));
      if (!read && !attestedSticky) {
        setDealError(null);
        setDealing(false);
      }
    } catch (err) {
      if (profileAttemptRef.current !== attempt) return;
      setDealError(dealErrorMessage(err));
      setDealing(false);
    }
  }, []);

  // Retry the current User's path to a dealt Board, in place (no reload): the
  // deal itself once the attestation is settled true, else the failed bootstrap —
  // never joinAndDeal while the attestation is unsettled (Finding 1's gate).
  const retryDeal = useCallback(() => {
    if (!user) return;
    if (attested === true) void runDeal(user);
    else void retryBootstrap(user);
  }, [user, attested, runDeal, retryBootstrap]);

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
      {/* The confirm-path Moment emitter (#41) mounts for ANY signed-in user,
          BESIDE the attestation gate rather than inside `children` — so an admin
          confirming an admin_confirmed Claim while the player sits on the
          attestation prompt still fires the win's Moment (Codex #116 R3 finding 2):
          the listener observes the Claim pending in-session and survives the gate,
          instead of unmounting and baselining the confirm as history after the
          player attests. Its uid-keyed module state (getConfirmState) also carries
          any parked ceremony across the remount. Renders nothing; scoped to the
          mount location only — the attestation gate itself is #117's surface. */}
      {user && <ConfirmWinMoments />}
      {needsAttestation ? <SignIn /> : children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
