import { NavLink } from 'react-router-dom';
import { Grid3x3, Radio, Trophy, Ellipsis } from 'lucide-react';
import { visibleTabs } from './tabs';
import type { TabId } from './tabs';

const cls = ({ isActive }: { isActive: boolean }) => 'tab' + (isActive ? ' active' : '');

// Lucide chrome for the tab bar (daily-cards-spec § "Iconography — Lucide"):
// Card `grid-3x3`, Feed `radio`, Ranks `trophy`. More wears the Player's
// avatar (or the `ellipsis` fallback below) instead of a Lucide glyph.
const TAB_ICONS: Partial<Record<TabId, typeof Grid3x3>> = {
  card: Grid3x3,
  feed: Radio,
  ranks: Trophy,
};

/**
 * The bottom tab bar. Pure/presentational — takes its Firebase-derived value
 * (`morePhotoURL`) as a prop so it renders (and can be unit-tested) without the
 * auth/event hooks that `Nav.tsx` wires it up with, same pattern the old
 * `isAdmin` prop established. Part of the frozen mount-point contract in
 * `./tabs` — see that file's header comment before editing.
 *
 * The More tab wears the Player's avatar as its icon (spec § "Iconography"):
 * when `morePhotoURL` is set it renders the photo; signed-out it falls back to
 * an ellipsis glyph. Every other tab renders its plain-text label.
 */
export default function TabBar({ morePhotoURL = null }: { morePhotoURL?: string | null }) {
  return (
    <nav className="tabs" aria-label="Primary">
      {visibleTabs().map((tab) => {
        const Icon = TAB_ICONS[tab.id];
        return (
          <NavLink
            key={tab.id}
            to={tab.path}
            end={tab.end}
            className={cls}
            aria-label={tab.id === 'more' ? tab.label : undefined}
          >
            {tab.id === 'more' ? (
              morePhotoURL ? (
                <img className="avatar tab-avatar" src={morePhotoURL} alt={tab.label} referrerPolicy="no-referrer" />
              ) : (
                <Ellipsis className="tab-ellipsis" aria-hidden="true" />
              )
            ) : (
              <>
                {Icon && <Icon className="tab-icon" aria-hidden="true" />}
                {tab.label}
              </>
            )}
          </NavLink>
        );
      })}
    </nav>
  );
}
