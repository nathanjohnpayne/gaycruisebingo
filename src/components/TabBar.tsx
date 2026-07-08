import { NavLink } from 'react-router-dom';
import { visibleTabs } from './tabs';

const cls = ({ isActive }: { isActive: boolean }) => 'tab' + (isActive ? ' active' : '');

/**
 * The bottom tab bar. Pure/presentational — takes `isAdmin` as a prop so it
 * renders (and can be unit-tested) without the Firebase-backed auth/event
 * hooks that `Nav.tsx` wires it up with. Part of the frozen mount-point
 * contract in `./tabs` — see that file's header comment before editing.
 */
export default function TabBar({ isAdmin }: { isAdmin: boolean }) {
  return (
    <nav className="tabs" aria-label="Primary">
      {visibleTabs(isAdmin).map((tab) => (
        <NavLink key={tab.id} to={tab.path} end={tab.end} className={cls}>
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
