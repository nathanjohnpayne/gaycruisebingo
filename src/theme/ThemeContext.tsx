import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
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
  const [theme, setThemeState] = useState<ThemeId>(() => savedTheme() ?? defaultTheme);

  // Has the user chosen a theme of their own? True if one was saved locally at
  // mount, or once they pick one this session. Guards the async-loaded event/
  // player default (below) from stomping that choice. Initialized once at mount.
  const userChoseTheme = useRef<boolean | null>(null);
  if (userChoseTheme.current === null) userChoseTheme.current = savedTheme() !== null;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* ignore storage errors */
    }
  }, [theme]);

  // The event/player default resolves from Firestore after mount; adopt it only
  // when the user has no explicit theme of their own.
  useEffect(() => {
    if (userChoseTheme.current) return;
    if (isThemeId(defaultTheme)) setThemeState(defaultTheme);
  }, [defaultTheme]);

  const setTheme = useCallback((t: ThemeId) => {
    userChoseTheme.current = true;
    setThemeState(t);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
