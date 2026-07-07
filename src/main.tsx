import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { ThemeProvider } from './theme/ThemeContext';
import { useEventDoc, useMyPlayer } from './hooks/useData';
import type { ThemeId } from './types';
import App from './App';
import './theme/themes.css';
import './index.css';

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
  return (
    <ThemeProvider defaultTheme={defaultTheme}>
      <App />
    </ThemeProvider>
  );
}

createRoot(rootEl).render(
  <React.StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <ThemedApp />
      </BrowserRouter>
    </AuthProvider>
  </React.StrictMode>,
);
