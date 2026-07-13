import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useEventDoc } from '../hooks/useData';
import { DayIdentityLines, headerDayIdentity } from './dayIdentity';
import TabBar from './TabBar';

/**
 * App shell chrome: a top identity bar (brand + the day's identity) and the
 * bottom tab bar (`TabBar`). The tab bar is fixed to the viewport bottom via
 * `.tabs` in index.css for one-handed, thumb-reachable navigation — see
 * `./tabs` for the frozen route/tab contract this renders.
 *
 * Phase 1.5 (#203, specs/d15-tab-contract.md): the avatar (profile-edit
 * affordance) and sign-out button left this bar for the More menu, so the
 * brand and the day's identity own the header. The More tab wears the Player's
 * avatar as its icon — `Nav.tsx` resolves the photo URL from `useAuth()` and
 * passes it to the presentational `TabBar`.
 *
 * The two stacked header lines are TODAY's port and theme (#259,
 * daily-cards-spec § "Header") — a "where are we" instrument that never
 * follows the viewed Day. Resolution lives in `./dayIdentity` (pure,
 * clock-parameterized); this component only ticks the clock.
 */
export default function Nav() {
  const { user } = useAuth();
  const { data: event } = useEventDoc(!!user);
  // The identity is calendar-based in the event timezone, so it rolls over at
  // midnight (and flips pre-cruise → embark on sail day) while a tab stays
  // open. A minute tick is the simplest rollover-safe clock here: unlike
  // main.tsx's next-unlockAt timer, the boundary is a timezone-local midnight,
  // and a 60s interval on this one tiny component is cheaper than tz math.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const identity = headerDayIdentity(event, now);

  return (
    <>
      <div className="nav">
        <div className="brand">
          GAY CRUISE <b>BINGO</b>
        </div>
        <DayIdentityLines identity={identity} />
      </div>
      <TabBar morePhotoURL={user?.photoURL ?? null} />
    </>
  );
}
