import { useAuth } from '../auth/AuthContext';
import { useEventDoc } from '../hooks/useData';
import ThemeSwitcher from './ThemeSwitcher';
import ProfileEditor from './ProfileEditor';
import TabBar from './TabBar';

/**
 * App shell chrome: a top identity bar (brand + avatar + sign-out) and the
 * bottom tab bar (`TabBar`). The tab bar is fixed to the viewport bottom via
 * `.tabs` in index.css for one-handed, thumb-reachable navigation — see
 * `./tabs` for the frozen route/tab contract this renders.
 *
 * The avatar IS the profile-edit affordance (#143): `ProfileEditor` renders the
 * player's photo as a button that opens the editor sheet — tap your photo to
 * edit — so there is no separate floating pencil to collide with anything.
 */
export default function Nav() {
  const { user, signOutUser } = useAuth();
  const { data: event } = useEventDoc();
  const isAdmin = !!(user && event?.admins?.includes(user.uid));

  return (
    <>
      <div className="nav">
        <div className="brand">
          GAY CRUISE <b>BINGO</b>
        </div>
        <ProfileEditor />
        <button className="iconbtn" title="Sign out" onClick={() => signOutUser()}>
          ⎋
        </button>
      </div>
      <ThemeSwitcher />
      <TabBar isAdmin={isAdmin} />
    </>
  );
}
