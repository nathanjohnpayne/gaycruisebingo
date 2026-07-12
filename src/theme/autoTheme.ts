import type { EventDoc, ThemeId } from '../types';

/**
 * Resolve "today's Day" from `EventDoc.days` for the More menu's Theme row
 * (daily-cards-spec § "More menu" — "Auto: match the day"): board chrome
 * already follows the VIEWED Day (a future ticket, #205); Auto makes the
 * WHOLE APP follow TODAY'S Day instead of a manual pick.
 *
 * "Today's Day" is the last Day whose `unlockAt` has passed relative to
 * `now` — a Day is "current" from its own unlock moment (which may be mid-
 * morning) until the NEXT Day's unlock, not by calendar date alone. Before
 * the first Day's `unlockAt` (pre-cruise) or with no `days` configured,
 * there is no "today" yet: returns `null` so the caller (ThemeContext's
 * `autoThemeId` prop) falls back to the event/player default instead of
 * guessing.
 *
 * Pure and Firestore-free (like the rest of `theme/`) so it is unit-testable
 * without mounting a component or opening a subscription; `main.tsx` is the
 * one caller, handing the resolved id down to `ThemeProvider`.
 */
export function todaysDayTheme(
  event: Pick<EventDoc, 'days'> | null | undefined,
  now: number = Date.now(),
): ThemeId | null {
  const days = event?.days;
  if (!days || days.length === 0) return null;
  let current: ThemeId | null = null;
  let currentUnlockAt = -Infinity;
  for (const day of days) {
    if (day.unlockAt <= now && day.unlockAt > currentUnlockAt) {
      current = day.theme;
      currentUnlockAt = day.unlockAt;
    }
  }
  return current;
}
