import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
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

  useEffect(() => {
    return onAuthStateChanged(auth, async (u) => {
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

  // Deal a Board once the User is known. Failures surface via `dealError` so
  // App.tsx can render a retry surface instead of the blank Board the old
  // `.catch(() => {})` left behind.
  const runDeal = useCallback(async (u: User) => {
    setDealing(true);
    setDealError(null);
    try {
      await joinAndDeal(u);
      track('join_event');
    } catch (err) {
      setDealError(dealErrorMessage(err));
    } finally {
      setDealing(false);
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
