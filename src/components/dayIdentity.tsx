import { THEMES } from '../theme/themes';
import type { EventDoc } from '../types';

/**
 * The header's two "where are we" lines (daily-cards-spec § "Header"): always
 * TODAY's port and theme — the header is a "where are we" instrument; the
 * board chrome communicates the viewed Day. Resolution is calendar-based in
 * the EVENT timezone (not unlock-based): on the morning of a port day the
 * header already names that port even though the Day Card unlocks at 8:00,
 * because the ship is there — `todaysDayTheme` (unlock-based) keeps owning the
 * Auto theme, which should not flip before the card does.
 *
 * States, per the spec:
 *   pre-cruise  → "Sails Jul 15" / the embark Day's theme line
 *   during      → "🇭🇷 Split"    / "🏋️ Get Sporty" (today's Day)
 *   post-cruise → "Barcelona"   / "👋 Until next year"
 *
 * Pure and Firestore-free like `theme/autoTheme.ts`, so the states are
 * unit-testable across clocks without mounting Nav.
 */
export interface DayIdentity {
  port: string;
  theme: string;
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2026-07-15' -> 'Jul 15'; null for a malformed date (caller degrades). */
function shortDate(iso: string): string | null {
  const [y, m, d] = String(iso ?? '')
    .split('-')
    .map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d) || m < 1 || m > 12 || d < 1 || d > 31) {
    return null;
  }
  return `${SHORT_MONTHS[m - 1]} ${d}`;
}

/** ThemeId -> "🏋️ Get Sporty"; falls back to the raw id for an unknown theme. */
function themeLine(themeId: string): string {
  const meta = THEMES.find((t) => t.id === themeId);
  return meta ? `${meta.emoji} ${meta.label}` : themeId;
}

/**
 * Today's calendar date as 'YYYY-MM-DD' in the given IANA timezone. en-CA is
 * the locale whose date format IS the ISO string, so the result compares
 * lexicographically against `DayDef.date`. An invalid timezone degrades to the
 * host zone rather than throwing — a hand-edited Event doc must never blank
 * the header.
 */
export function isoDateInTz(now: number, timeZone: string): string {
  const opts = { year: 'numeric', month: '2-digit', day: '2-digit' } as const;
  try {
    return new Intl.DateTimeFormat('en-CA', { ...opts, timeZone }).format(new Date(now));
  } catch {
    return new Intl.DateTimeFormat('en-CA', opts).format(new Date(now));
  }
}

/**
 * Presentational (hook-free, so renderToStaticMarkup-testable without the
 * Firebase-backed hooks Nav mounts): the two stacked header lines. Before the
 * Event doc arrives (or signed out) it renders the original placeholder
 * dashes, aria-hidden so they are not announced.
 */
export function DayIdentityLines({ identity }: { identity: DayIdentity | null }) {
  if (!identity) {
    return (
      <div className="day-identity" aria-hidden="true">
        <span className="day-identity-line day-identity-port">—</span>
        <span className="day-identity-line day-identity-theme">—</span>
      </div>
    );
  }
  return (
    <div className="day-identity">
      <span className="day-identity-line day-identity-port">{identity.port}</span>
      <span className="day-identity-line day-identity-theme">{identity.theme}</span>
    </div>
  );
}

export function headerDayIdentity(
  event: Pick<EventDoc, 'days' | 'timezone'> | null | undefined,
  now: number = Date.now(),
): DayIdentity | null {
  const days = event?.days;
  if (!days || days.length === 0) return null;
  const ordered = [...days].filter((d) => typeof d.date === 'string' && d.date !== '').sort((a, b) => a.index - b.index);
  if (ordered.length === 0) return null;
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const today = isoDateInTz(now, event?.timezone || 'Europe/Rome');
  if (today < first.date) {
    const sails = shortDate(first.date);
    return {
      port: sails ? `Sails ${sails}` : `${first.portEmoji} ${first.port}`.trim(),
      theme: themeLine(first.theme),
    };
  }
  if (today > last.date) {
    // Spec copy is the bare port ("Barcelona"), no flag — the cruise is over.
    return { port: last.port, theme: '👋 Until next year' };
  }
  // Latest Day whose date has started — an exact date match on a contiguous
  // schedule, and the right fallback across any hand-edited gap.
  let current = first;
  for (const d of ordered) {
    if (d.date <= today) current = d;
    else break;
  }
  return { port: `${current.portEmoji} ${current.port}`.trim(), theme: themeLine(current.theme) };
}
