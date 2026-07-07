import { NavLink } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useEventDoc } from '../hooks/useData';
import ThemeSwitcher from './ThemeSwitcher';
import Avatar from './Avatar';

export default function Nav() {
  const { user, signOutUser } = useAuth();
  const { data: event } = useEventDoc();
  const isAdmin = !!(user && event?.admins?.includes(user.uid));
  const cls = ({ isActive }: { isActive: boolean }) => 'tab' + (isActive ? ' active' : '');

  return (
    <>
      <div className="nav">
        <div className="brand">
          GAY CRUISE <b>BINGO</b>
        </div>
        <Avatar name={user?.displayName ?? '?'} src={user?.photoURL ?? null} />
        <button className="iconbtn" title="Sign out" onClick={() => signOutUser()}>
          ⎋
        </button>
      </div>
      <ThemeSwitcher />
      <nav className="tabs">
        <NavLink to="/" className={cls} end>
          Card
        </NavLink>
        <NavLink to="/feed" className={cls}>
          Feed
        </NavLink>
        <NavLink to="/leaderboard" className={cls}>
          Ranks
        </NavLink>
        <NavLink to="/items" className={cls}>
          Prompts
        </NavLink>
        {isAdmin && (
          <NavLink to="/admin" className={cls}>
            Admin
          </NavLink>
        )}
      </nav>
    </>
  );
}
