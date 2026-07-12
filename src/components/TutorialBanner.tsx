import { useState } from 'react';
import type { DayDef } from '../types';

/**
 * The embark/farewell tutorial banners (daily-cards-spec §§ "Embark
 * (tutorial) view" / "Farewell view", specs/d15-tutorial-banners.md). Board
 * mounts this ONE component above the grid, gated on the viewed Day's
 * `tutorial` flag; it renders nothing for any of the eight main Days. Which
 * of the two banners shows is read off `day.pool` (`'embark'` |
 * `'farewell'`) rather than `day.index`, so the banner tracks the seeded
 * data (#207's `DAYS`) instead of assuming the tutorial Days sit at fixed
 * positions.
 *
 * Deliberately distinct from the first-open coach overlay (#214, not yet
 * landed): that overlay only decodes the badge notation (Tally count, 👀
 * Doubt badge, ＋ add-proof, free space); this banner carries the game's
 * narrative. They complement rather than repeat, per the spec's "First-open
 * coach overlay" section — this ticket does not touch that overlay.
 */

const EMBARK_BEATS: readonly string[] = [
  'Mark what happens. Tap a square when you see it, do it, or survive it.',
  "Five in a row is BINGO. The center is free. Blackout the card if you're ambitious.",
  'The feed is the proof. Attach a pic, doubt a friend, watch the Moments roll in.',
];

const EMBARK_CAPTION =
  "This one's a warm-up—easy squares, all on the ship. The real chaos starts tomorrow at 8.";

const FAREWELL_COPY = 'Last one. Mark your goodbyes—then go book next year.';

/**
 * The Welcome Aboard Day's three-beat "How this works" banner. Dismissible
 * by tapping anywhere on it — collapses for the rest of THIS component's
 * mount (session-scoped per the spec: "dismissal here does not need to
 * persist beyond the session the way the coach overlay's does"), since it
 * is replayable later from More → How to play (#208). Plain component
 * state, not localStorage — switching the Day switcher away and back is a
 * fresh "view" of the banner, matching the AC's "views the Welcome Aboard
 * Day for the first time in a session".
 */
function EmbarkBanner() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  const dismiss = () => setDismissed(true);
  return (
    <div
      className="tutorial-banner tutorial-banner-embark"
      role="button"
      tabIndex={0}
      aria-label="How this works — tap to dismiss"
      onClick={dismiss}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          dismiss();
        }
      }}
    >
      <p className="tutorial-banner-title">How this works</p>
      <ol className="tutorial-banner-beats">
        {EMBARK_BEATS.map((beat) => (
          <li key={beat}>{beat}</li>
        ))}
      </ol>
      <p className="tutorial-banner-caption">{EMBARK_CAPTION}</p>
    </div>
  );
}

/**
 * The So Long, Farewell Day's goodbye banner. NOT dismissible (spec: "the
 * ceremonial close of the cruise, not a tutorial to get out of the way") —
 * no dismiss affordance, no state. Sits below wherever the podium banner
 * mounts (#217's content — this ticket owns only the goodbye copy).
 */
function FarewellBanner() {
  return (
    <div className="tutorial-banner tutorial-banner-farewell" role="note">
      <p className="tutorial-banner-copy">{FAREWELL_COPY}</p>
    </div>
  );
}

export default function TutorialBanner({ day }: { day: DayDef }) {
  if (!day.tutorial) return null;
  if (day.pool === 'embark') return <EmbarkBanner />;
  if (day.pool === 'farewell') return <FarewellBanner />;
  return null;
}

/**
 * The "Warm-up" tag (daily-cards-spec § "Embark (tutorial) view": "Tutorial
 * days show a 'Warm-up' tag on the day chip and board header in place of
 * daily-honor competitiveness"). One shared bit of markup for both mount
 * points (DaySwitcher's chip, Board's header) so the two never drift. #212
 * owns the daily-honor pin the eight main Days show in this same slot —
 * this component only renders on the two tutorial Days, so it structurally
 * cannot collide with that pin (mutually exclusive on `tutorial`).
 */
export function WarmUpTag({ className }: { className?: string }) {
  return (
    <span className={`warm-up-tag${className ? ` ${className}` : ''}`} aria-label="Warm-up day">
      Warm-up
    </span>
  );
}
