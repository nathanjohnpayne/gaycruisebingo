import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { auth, googleProvider } from '../firebase';
import {
  attestAdult,
  ensureUserProfile,
  joinAndDeal,
  readAdultAttestation,
  readAdultAttestationFromCache,
} from '../data/api';
import { track } from '../analytics';
import SignIn from '../components/SignIn';
import ConfirmWinMoments from '../components/ConfirmWinMoments';

// Connectivity probe for the boot path (#115). The auth bootstrap and the deal
// are both network-bound: a create-once transaction (ensureUserProfile) and a
// create path (joinAndDeal) never resolve/complete offline, so they must not sit
// on the render-critical path. `navigator.onLine` is the cheap synchronous
// signal (a definite `false` means "no network"); a missing navigator (SSR /
// exotic runtime) is treated as online so the normal online path still runs.
function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

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
  // Reactive connectivity, mirrored from the browser online/offline events (#115).
  // A REACT STATE (not just the imperative `isOnline()` probe) so the deal effect's
  // deps actually CHANGE on reconnect: a globally-attested User who cold-boots
  // offline onto a FRESH Event (no cached board) settles `attested === true` from
  // cache but must not deal until online — and the deferred deal has to FIRE on
  // reconnect, which only happens if `online` flipping true re-runs that effect.
  const [online, setOnline] = useState(isOnline());
  // Whether `attested === true` is AUTHORITATIVE (server-settled or a same-session
  // optimistic attest) vs merely PROVISIONAL (the offline cache lift). Distinct
  // from `attested` so the offline cache lift can settle the gate for RENDER —
  // the cached Board paints offline (#115) — while the network-write DEAL waits
  // for authority (Codex #117 finding, round 2). A cache-attested User who
  // cold-boots offline onto a fresh Event holds `attested === true` provisionally;
  // on reconnect `online` flips true BEFORE the authoritative read finishes, so
  // gating the deal on `online` alone would let joinAndDeal create board/player
  // rows for a User whose server read may then return NO stamp and downgrade to a
  // re-prompt — creating durable rows for an un-attested User. This flag holds the
  // deal until the authoritative read confirms the stamp. Re-armed false per auth
  // change; never set true offline (the cache lift is provisional).
  const [attestedAuthoritative, setAttestedAuthoritative] = useState(false);
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

  // The connectivity-aware profile/attestation bootstrap, run OFF the render path
  // (#115). The cache lifts the gate PROVISIONALLY offline; the server read is
  // AUTHORITATIVE when it arrives. Two mutually-exclusive branches:
  //
  //   OFFLINE — settle the 18+ gate CACHE-FIRST, no network, then DEFER the rest.
  //     A cached stamp (or a same-session optimistic attest, #112 Finding 3) lifts
  //     the gate so a returning User renders their cached Board offline; a cache
  //     miss or a definite-unstamped row leaves attestation UNKNOWN (never settled
  //     `true` without a real stamp — cache-first can't fail the age gate open —
  //     and never re-prompted offline, so it can't flash the gate). The auth
  //     callback already published `loading: false` for this branch, so the cached
  //     shell paints now; ensureUserProfile (a transaction that never resolves
  //     offline — transactions don't queue) and the authoritative read are
  //     deferred to the reconnect handler. OFFLINE is a non-error DEFERRED state,
  //     distinct from the DealError terminal (#112).
  //
  //   ONLINE — run the AUTHORITATIVE bootstrap; the session stays GATED on
  //     "Loading…" (the auth callback kept `loading` true for this branch) until
  //     it settles, so an un-attested returning User with a cached board can NOT
  //     view the Event during the read (Codex #117 finding B). The server read is
  //     definitive: it settles a present stamp true and a MISSING stamp false —
  //     DOWNGRADING even a provisional cache lift (finding D) — so a deleted /
  //     recreated users/{uid} row re-prompts. The only sticky override is
  //     attestedUidsRef (this session's own optimistic attest, #112 Finding 3),
  //     NOT a stale cache value. A genuine network FAILURE (thrown despite
  //     navigator.onLine) is not authoritative: it surfaces the retryable
  //     dealError (#61 / #112 round 2) and leaves attestation as-is.
  //
  // Every settle is guarded by `attempt` vs `profileAttemptRef` so a superseded
  // auth change / reconnect leaves the signal to whoever owns it now — the deal's
  // stale-attempt discipline, and what makes reconnect recovery deterministic.
  const bootstrapUser = useCallback(async (u: User, attempt: number) => {
    if (!isOnline()) {
      // OFFLINE: provisional cache-first lift, then defer. Only ever lift to
      // `true`, and only on a genuine cached stamp / same-session attest.
      try {
        const cachedStamp = await readAdultAttestationFromCache(u.uid);
        if (profileAttemptRef.current !== attempt) return;
        if (cachedStamp !== null || attestedUidsRef.current.has(u.uid)) setAttested(true);
      } catch {
        /* cache miss / indeterminate — stays UNKNOWN, gate holds, Board from cache */
      }
      return;
    }

    // ONLINE: the authoritative bootstrap. No provisional cache lift here — the
    // definitive server read is moments away and the app stays gated until it
    // lands, so lifting from cache first would only risk a premature deal.
    let attestedRead: boolean | undefined;
    let bootstrapFailure: { err: unknown } | null = null;
    try {
      await ensureUserProfile(u);
      // The SETTLED (create-or-existing) row: a definite present/absent.
      attestedRead = (await readAdultAttestation(u.uid)) !== null;
    } catch (err) {
      bootstrapFailure = { err };
    }
    if (profileAttemptRef.current !== attempt) return;
    const attestedSticky = attestedUidsRef.current.has(u.uid);
    if (bootstrapFailure) {
      // Not authoritative — keep the same-session optimistic attest if any (its
      // own transaction succeeded THIS session, so it IS authoritative and may
      // deal), else surface the retryable error and leave attestation UNKNOWN /
      // provisional (no downgrade, and no deal, on a mere network blip). The Retry
      // re-runs this whole bootstrap.
      if (attestedSticky) {
        setAttested(true);
        setAttestedAuthoritative(true);
      } else {
        setDealError(dealErrorMessage(bootstrapFailure.err));
      }
    } else {
      // Authoritative: a same-session optimistic attest wins (its transaction
      // succeeded), otherwise the server value is definitive — INCLUDING
      // downgrading a stale cache lift to a re-prompt (finding D). The read
      // SETTLED, so the deal may now fire for a confirmed-attested User (round 2).
      setAttested(attestedSticky ? true : attestedRead);
      setAttestedAuthoritative(true);
    }
    setProfileReady(true);
    // Online gate resolved — release the "Loading…" hold and render (finding B).
    setLoading(false);
  }, []);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      // Auth changed: retire the previous account's in-flight deal/bootstrap and
      // clear its stale state so a late result can't clobber the incoming User (P2).
      const profileAttempt = (profileAttemptRef.current += 1);
      dealAttemptRef.current += 1;
      setDealError(null);
      setDealing(false);
      // The incoming User's profile bootstrap has not settled yet (#77), so the
      // 18+ attestation is UNKNOWN — never `false` — until it does (#23), and its
      // authority is un-established until an authoritative read/attest settles it.
      setProfileReady(false);
      setAttested(undefined);
      setAttestedAuthoritative(false);
      setUser(u);
      if (!u) {
        // Signed out → App renders SignIn, never "Loading…".
        setLoading(false);
        return undefined;
      }
      if (isOnline()) {
        // ONLINE: stay GATED on "Loading…" until the authoritative bootstrap
        // settles the age gate (finding B) — do NOT render the Board before it.
        // Not an await (that was the offline hang); bootstrapUser releases the
        // hold with setLoading(false) when it settles.
        setLoading(true);
      } else {
        // OFFLINE: publish loading:false IMMEDIATELY (#115) so the cached Board
        // paints NOW — the old code awaited a transaction here and stuck on
        // "Loading…" forever. The gate settles cache-first inside bootstrapUser.
        setLoading(false);
      }
      // Bootstrap runs OFF the render path — fire-and-forget. Returning the
      // promise keeps the auth-change unit tests deterministic (Firebase ignores
      // an onAuthStateChanged callback's return value).
      return bootstrapUser(u, profileAttempt);
    });
  }, [bootstrapUser]);

  // Mirror connectivity into React state AND complete the DEFERRED offline
  // bootstrap when the network returns (#115). `online` flipping true re-runs the
  // deal effect (so a cache-attested User who booted offline onto a fresh Event
  // finally deals — finding C), and the guarded bootstrap re-run finishes the
  // deferred authoritative work exactly once. This is also the post-reconnect
  // determinism fix: the old code left an awaited transaction PENDING on the auth
  // callback across the whole dead zone, so on reconnect its retry backoff raced
  // the profileAttempt supersede logic and the bootstrap did not reliably re-run.
  // Now offline leaves NOTHING pending, and reconnect is a single guarded pass.
  useEffect(() => {
    const goOnline = () => {
      setOnline(true);
      const u = auth.currentUser;
      if (u) void bootstrapUser(u, (profileAttemptRef.current += 1));
    };
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, [bootstrapUser]);

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
  //
  // ALSO gated on connectivity (#115) AND on attestation AUTHORITY (Codex #117
  // round 2): a deal is a network-bound CREATE path (joinAndDeal writes a new
  // board/player row), so it must not fire offline, and must NEVER fire on a
  // PROVISIONAL (cache-derived) attestation. It gates on the reactive `online`
  // STATE (not the `isOnline()` probe) so the deps change on reconnect, and on
  // `attestedAuthoritative` so a cache-attested User who cold-boots OFFLINE onto a
  // fresh Event does NOT deal until the authoritative read confirms the stamp: on
  // reconnect `online` flips true first, but the deal waits for the server read to
  // settle `attestedAuthoritative` true — a server NULL downgrades to a re-prompt
  // WITHOUT ever dealing (no rows created for an un-attested User). The deal then
  // FIRES exactly once for a confirmed-attested User who lacks a board (finding C);
  // a same-session optimistic attest is authoritative too (its transaction
  // succeeded), so that User deals on reconnect. A returning boarded User re-runs
  // joinAndDeal on that flip but its board-exists early-return makes it a no-op;
  // the dealAttempt guard keeps any reconnect re-run from clobbering state.
  useEffect(() => {
    if (user && attested === true && attestedAuthoritative && online) void runDeal(user);
  }, [user, attested, attestedAuthoritative, online, runDeal]);

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
      // Authoritative settle (finding D): the server read is definitive — only a
      // same-session optimistic attest is sticky, never a prior provisional value.
      // The read SETTLED, so this settle is authoritative and may fire the deal.
      setAttested(attestedSticky ? true : read);
      setAttestedAuthoritative(true);
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
    // A same-session attest IS authoritative (the User asserted 18+ this session
    // and its transaction is the source of truth), so it may fire the deal — the
    // deal effect gates on `attestedAuthoritative`, and this is the immediate-
    // deal-after-attest path (Codex #117 round 2). The `online` gate still keeps a
    // just-attested User from dealing until connected.
    setAttestedAuthoritative(true);
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
