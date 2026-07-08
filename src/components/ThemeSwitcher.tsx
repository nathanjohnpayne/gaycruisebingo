import { useTheme } from '../theme/ThemeContext';
import { THEMES } from '../theme/themes';
import { useAuth } from '../auth/AuthContext';
import { savePlayerTheme } from '../data/api';
import { track } from '../analytics';

export default function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  const { user } = useAuth();
  return (
    <div className="themes" aria-label="Theme">
      {THEMES.map((t) => (
        <button
          key={t.id}
          className={'chip' + (theme === t.id ? ' active' : '')}
          onClick={() => {
            setTheme(t.id);
            track('theme_change', { theme: t.id });
            if (user) savePlayerTheme(user.uid, t.id).catch(() => {});
          }}
        >
          {t.emoji} {t.label}
        </button>
      ))}
    </div>
  );
}
