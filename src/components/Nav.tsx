import { useAuth } from '../auth/AuthContext';
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
 * The two stacked header lines (today's port + theme) are placeholder-only
 * here: wiring them to live `EventDoc.days[]` data is #205's job, which depends
 * on this ticket AND the schema ticket. `ThemeSwitcher` no longer mounts here —
 * #208 relocated it into `More.tsx` (daily-cards-spec § "More menu"), the one
 * piece of Nav's Phase 1.5 simplification `d15-tab-contract` deliberately left
 * for this ticket.
 */
export default function Nav() {
  const { user } = useAuth();

  return (
    <>
      <div className="nav">
        <div className="brand">
          GAY CRUISE <b>BINGO</b>
        </div>
        {/* Two-line "where are we" header slot. Placeholder until #205 wires
            live EventDoc.days[] port/theme text; kept aria-hidden so the
            placeholder dashes are not announced. */}
        <div className="day-identity" aria-hidden="true">
          <span className="day-identity-line">—</span>
          <span className="day-identity-line">—</span>
        </div>
      </div>
      <TabBar morePhotoURL={user?.photoURL ?? null} />
    </>
  );
}
