import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { ThemeId } from '../types';
import { THEMES } from './themes';

const KEY = 'gcb.theme';
const DEFAULT: ThemeId = 'neon-playground';
const VALID_THEMES = new Set<string>(THEMES.map((t) => t.id));

/** Type guard: only a currently-known theme id is a valid ThemeId. */
function isThemeId(value: string | null | undefined): value is ThemeId {
  return value != null && VALID_THEMES.has(value);
}

/** The locally-saved theme (localStorage) if it's still a valid id, else null. */
function savedTheme(): ThemeId | null {
  try {
    const saved = localStorage.getItem(KEY);
    if (isThemeId(saved)) return saved;
  } catch {
    /* ignore storage errors */
  }
  return null;
}

/**
 * A Player's theme PICK (daily-cards-spec § "More menu" — Theme row): either
 * a concrete `ThemeId`, or `'auto'` — "Auto: match the day", the new default.
 * `'auto'` is never itself persisted (see `setTheme` below), so a Player who
 * has never explicitly picked a theme (or who explicitly re-picks Auto)
 * always re-resolves against the current Day/event default on every load.
 */
export type ThemePreference = ThemeId | 'auto';

interface ThemeContextValue {
  /** The resolved, CONCRETE theme applied to `<html data-theme>` and CSS. */
  theme: ThemeId;
  /** What the Player picked — drives the ThemeSwitcher's active-chip highlight. */
  preference: ThemePreference;
  setTheme: (t: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: DEFAULT,
  preference: 'auto',
  setTheme: () => {},
});

export function ThemeProvider({
  children,
  defaultTheme = DEFAULT,
  autoThemeId = null,
}: {
  children: ReactNode;
  /** The event/player-set default (main.tsx), used whenever Auto has no
   *  `autoThemeId` to resolve against — the same fallback role `defaultTheme`
   *  played pre-Auto (adopted live on every render, no separate "arrived
   *  async" effect needed since `theme` below is a pure derivation). */
  defaultTheme?: ThemeId;
  /** Today's Day's ThemeId (daily-cards-spec § "More menu" Auto option),
   *  resolved by the caller from `EventDoc.days` (see `theme/autoTheme.ts`)
   *  so this Firestore-free module stays Firestore-free — mirrors how
   *  `defaultTheme` is already handed down precomputed. `null` before the
   *  Event doc has loaded, or with no Days configured. */
  autoThemeId?: ThemeId | null;
}) {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => savedTheme() ?? 'auto');

  // The resolved CSS theme: an explicit pick wins outright; 'auto' resolves to
  // today's Day theme when known, falling back to the event/player default
  // while it isn't. A pure derivation (not stored state), so it re-resolves on
  // every render as `autoThemeId`/`defaultTheme` arrive from Firestore — no
  // separate "adopt the async default" effect required.
  const theme: ThemeId = preference === 'auto' ? (autoThemeId ?? defaultTheme) : preference;

  // Apply the theme to the DOM for CSS. Deliberately does NOT persist here —
  // only an explicit concrete pick (setTheme below) is ever saved, so the
  // resolved auto/default value is never auto-saved.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const setTheme = useCallback((t: ThemePreference) => {
    if (t === 'auto') {
      // Picking Auto is itself never persisted — it un-saves any earlier
      // explicit pick so resolution re-derives from the Day/default on every
      // future load (daily-cards-spec § "More menu").
      try {
        localStorage.removeItem(KEY);
      } catch {
        /* ignore storage errors */
      }
      setPreferenceState('auto');
      return;
    }
    // Persist only explicit concrete choices, so the default is never auto-saved.
    try {
      localStorage.setItem(KEY, t);
    } catch {
      /* ignore storage errors */
    }
    setPreferenceState(t);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, preference, setTheme }}>{children}</ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
