import { NavLink } from 'react-router-dom';
import { visibleTabs } from './tabs';

const cls = ({ isActive }: { isActive: boolean }) => 'tab' + (isActive ? ' active' : '');

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
      {visibleTabs().map((tab) => (
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
              <span className="tab-ellipsis" aria-hidden="true">
                ⋯
              </span>
            )
          ) : (
            tab.label
          )}
        </NavLink>
      ))}
    </nav>
  );
}
