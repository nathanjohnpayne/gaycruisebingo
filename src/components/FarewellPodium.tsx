import type { DayDef, DayMetaDoc, PlayerDoc } from '../types';
import { buildPodium, type Podium } from '../data/finale';

/**
 * The farewell view's podium banner (#217, daily-cards-spec § "Farewell view"):
 * the cruise champion, the cruise-wide First to BINGO, and the ten daily honors,
 * shown once the standings freeze. Mounts ABOVE the goodbye banner
 * (`TutorialBanner`'s farewell copy) — Board owns that stacking order — so the
 * ceremony reads podium-then-goodbye. `d15-tutorial-banners` owns the goodbye
 * copy; this component owns only the podium.
 *
 * The standings are frozen: `buildPodium` excludes the farewell Day's own marks,
 * so a post-freeze goodbye mark never changes who is on the podium (the
 * "as of `frozenAt`, not live" rule).
 */

/** A Day-index → label mapper for the honors strip; mirrors the Leaderboard's
 *  "Day N · Port" shape, degrading to a bare "Day N" when the Day can't be
 *  resolved from the schedule. */
function makeDayLabel(days: readonly DayDef[] | undefined): (dayIndex: number) => string {
  return (dayIndex: number): string => {
    const d = days?.find((day) => day.index === dayIndex);
    if (!d) return `Day ${dayIndex + 1}`;
    return `Day ${dayIndex + 1} · ${d.port}${d.portEmoji ? ` ${d.portEmoji}` : ''}`;
  };
}

/**
 * Presentational podium — renders a prebuilt `Podium` payload. Split from the
 * data wrapper below so it can be tested against a fixture payload without a
 * roster. Renders nothing when the podium is entirely empty (no champion, no
 * First to BINGO, no honors) so a pre-play farewell view shows only the goodbye
 * banner rather than an empty ceremony shell.
 */
export function FarewellPodiumView({
  podium,
  dayLabel = (i: number) => `Day ${i + 1}`,
}: {
  podium: Podium;
  dayLabel?: (dayIndex: number) => string;
}) {
  const { champion, firstBingo, dailyHonors } = podium;
  if (!champion && !firstBingo && dailyHonors.length === 0) return null;

  return (
    <section className="farewell-podium" aria-label="Cruise podium">
      <p className="farewell-podium-title">The podium</p>
      {champion && (
        <div className="farewell-podium-champion">
          <span className="farewell-podium-medal" aria-hidden="true">
            🏆
          </span>
          <span className="farewell-podium-role">Cruise champion</span>
          <span className="farewell-podium-name">{champion.displayName}</span>
          <span className="farewell-podium-stat">
            {champion.bingoCount} bingo{champion.bingoCount === 1 ? '' : 's'} · {champion.squaresMarked} squares
          </span>
        </div>
      )}
      {firstBingo && (
        <div className="farewell-podium-first">
          <span className="farewell-podium-medal" aria-hidden="true">
            👑
          </span>
          <span className="farewell-podium-role">First to BINGO</span>
          <span className="farewell-podium-name">{firstBingo.displayName}</span>
        </div>
      )}
      {dailyHonors.length > 0 && (
        <div className="farewell-podium-honors" aria-label="Daily First to BINGO">
          <p className="farewell-podium-honors-title">Daily honors</p>
          <ul className="farewell-podium-honors-strip">
            {dailyHonors.map((h) => (
              <li key={h.dayIndex} className="farewell-podium-honor">
                <span className="farewell-podium-honor-day">{dayLabel(h.dayIndex)}</span>
                <span className="farewell-podium-honor-name">{h.displayName}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/**
 * The data wrapper Board mounts: computes the frozen podium from the live roster
 * + schedule and renders it. Kept thin so the presentational view stays payload-
 * driven and testable.
 */
export default function FarewellPodium({
  players,
  days,
  dayMetas,
  dayMetasLoaded = true,
}: {
  players: readonly PlayerDoc[];
  days: readonly DayDef[] | undefined;
  dayMetas?: ReadonlyMap<number, DayMetaDoc>;
  dayMetasLoaded?: boolean;
}) {
  return <FarewellPodiumView podium={buildPodium(players, days, dayMetas, dayMetasLoaded)} dayLabel={makeDayLabel(days)} />;
}
