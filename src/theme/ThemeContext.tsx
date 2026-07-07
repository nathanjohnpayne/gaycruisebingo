import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { ThemeId } from '../types';

const KEY = 'gcb.theme';
const DEFAULT: ThemeId = 'neon-playground';

interface ThemeContextValue {
  theme: ThemeId;
  setTheme: (t: ThemeId) => void;
}

const ThemeContext = createContext<ThemeContextValue>({ theme: DEFAULT, setTheme: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(
    () => (localStorage.getItem(KEY) as ThemeId | null) ?? DEFAULT,
  );

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
