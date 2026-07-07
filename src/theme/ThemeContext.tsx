import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { ThemeId } from '../types';
import { THEMES } from './themes';

const KEY = 'gcb.theme';
const DEFAULT: ThemeId = 'neon-playground';
const VALID_THEMES = new Set<string>(THEMES.map((t) => t.id));

/** Type guard: only a currently-known theme id is a valid ThemeId. */
function isThemeId(value: string | null): value is ThemeId {
  return value !== null && VALID_THEMES.has(value);
}

/** Saved theme (localStorage) if it's still a valid id, else the event/default theme. */
function initialTheme(fallback: ThemeId): ThemeId {
  try {
    const saved = localStorage.getItem(KEY);
    if (isThemeId(saved)) return saved;
  } catch {
    /* ignore storage errors */
  }
  return fallback;
}

interface ThemeContextValue {
  theme: ThemeId;
  setTheme: (t: ThemeId) => void;
}

const ThemeContext = createContext<ThemeContextValue>({ theme: DEFAULT, setTheme: () => {} });

export function ThemeProvider({
  children,
  defaultTheme = DEFAULT,
}: {
  children: ReactNode;
  defaultTheme?: ThemeId;
}) {
  const [theme, setThemeState] = useState<ThemeId>(() => initialTheme(defaultTheme));

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* ignore storage errors */
    }
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme: setThemeState }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
