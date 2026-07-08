import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { auth, googleProvider } from '../firebase';
import { ensureUserProfile, joinAndDeal } from '../data/api';
import { track } from '../analytics';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  dealError: string | null; // Player-worded deal failure, or null once the Board dealt.
  dealing: boolean; // True while a join/deal (initial or retry) is in flight.
  signIn: () => Promise<void>;
  signOutUser: () => Promise<void>;
  retryDeal: () => void; // Re-run joinAndDeal for the current User, no reload.
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  dealError: null,
  dealing: false,
  signIn: async () => {},
  signOutUser: async () => {},
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
  // Monotonic id of the latest deal attempt; runDeal captures it and re-checks
  // before each setState so a superseded attempt's late result is dropped (P2).
  const dealAttemptRef = useRef(0);

  useEffect(() => {
    return onAuthStateChanged(auth, async (u) => {
      // Auth changed: retire the previous account's in-flight deal and clear its
      // stale state so a late result can't clobber the incoming User (P2).
      dealAttemptRef.current += 1;
      setDealError(null);
      setDealing(false);
      setUser(u);
      if (u) {
        try {
          await ensureUserProfile(u);
        } catch {
          /* profile write can retry later */
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

  useEffect(() => {
    if (user) void runDeal(user);
  }, [user, runDeal]);

  const retryDeal = useCallback(() => {
    if (user) void runDeal(user);
  }, [user, runDeal]);

  const signIn = async () => {
    await signInWithPopup(auth, googleProvider);
    track('login', { method: 'google' });
  };

  const signOutUser = async () => {
    await signOut(auth);
  };

  return (
    <AuthContext.Provider
      value={{ user, loading, dealError, dealing, signIn, signOutUser, retryDeal }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
