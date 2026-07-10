import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { ThemeProvider } from './theme/ThemeContext';
import { useEventDoc, useMyPlayer } from './hooks/useData';
import { initPostHog, phIdentify, phReset, phPageview } from './posthog';
import type { ThemeId } from './types';
import App from './App';
import ConsentNotice from './components/ConsentNotice';
import InstallPrompt from './components/InstallPrompt';
import AcceptableUse from './components/AcceptableUse';
import './theme/themes.css';
import './index.css';

// Initialize client-side PostHog once (alongside GA4). No-op without a key. (#96)
initPostHog();

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('root element missing');

/**
 * Resolve the active theme from the signed-in player's saved preference, then the
 * event's admin-set default, and hand it to ThemeProvider so a player's
 * cross-device choice or the configured event default is actually applied. A
 * locally-saved theme and an explicit in-session pick still win (see ThemeProvider).
 */
function ThemedApp() {
  const { user } = useAuth();
  const { data: event } = useEventDoc(!!user);
  const { data: player } = useMyPlayer(user?.uid);
  const defaultTheme: ThemeId = player?.theme ?? event?.defaultTheme ?? 'neon-playground';
  const location = useLocation();
  // Tie PostHog events to the signed-in User by uid; clear on sign-out. (#96)
  // Kept here (not in AuthContext) so the analytics wiring stays out of the
  // protected src/auth/** path.
  useEffect(() => {
    if (user?.uid) phIdentify(user.uid);
    else phReset();
  }, [user?.uid]);
  // Manual SPA pageview on route change — path only, no PII. (#96)
  useEffect(() => {
    phPageview(location.pathname);
  }, [location.pathname]);
  return (
    <ThemeProvider defaultTheme={defaultTheme}>
      <App />
      {/* The Card route renders Guidelines from Board. Keep the same
          policy affordance reachable on every other signed-in route without
          duplicating it on Card: the fixed bottom-left control sits opposite
          the bug reporter on the right. */}
      {location.pathname !== '/' && <AcceptableUse />}
    </ThemeProvider>
  );
}

createRoot(rootEl).render(
  <React.StrictMode>
    {/* Mounted outside the auth-gated tree (stable, non-frozen mount point —
        see #17) so the 18+ analytics disclosure shows even on the signed-out
        SignIn screen, since GA4's automatic events can fire before sign-in. */}
    <ConsentNotice />
    {/* Same stable mount point (#17, #30): offers installation even on the
        signed-out SignIn screen, since a Player may install before ever
        signing in. */}
    <InstallPrompt />
    <AuthProvider>
      <BrowserRouter>
        <ThemedApp />
      </BrowserRouter>
    </AuthProvider>
  </React.StrictMode>,
);
