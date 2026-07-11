// Small, framework-free presentational formatters. Pure + unit-tested so
// components can render event metadata without re-deriving the shape inline.

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * Format an Event's sail window as a compact human range:
 *   '2026-07-15', '2026-07-24' -> 'July 15–24, 2026'
 * Collapses a shared month (day–day) or a shared year (Mon d – Mon d, year),
 * and uses an en dash for the range per typographic convention.
 *
 * The ISO 'YYYY-MM-DD' parts are parsed directly rather than via `new Date()`:
 * `new Date('2026-07-15')` is parsed as UTC midnight and renders as the 14th in
 * negative-offset zones, so a naive parse would shift the displayed day.
 */
export function formatSailRange(sailStart: string, sailEnd: string): string {
  const parse = (s: string) => {
    const [y, m, d] = String(s ?? '')
      .split('-')
      .map(Number);
    return { y, m, d };
  };
  const a = parse(sailStart);
  const b = parse(sailEnd);
  // Degrade to no range (rather than throw) when a date is missing or malformed
  // — a partial Event doc must never crash the board.
  if (![a.y, a.m, a.d, b.y, b.m, b.d].every(Number.isFinite)) return '';
  const mA = MONTHS[a.m - 1] ?? '';
  const mB = MONTHS[b.m - 1] ?? '';

  if (a.y === b.y && a.m === b.m) return `${mA} ${a.d}–${b.d}, ${a.y}`;
  if (a.y === b.y) return `${mA} ${a.d} – ${mB} ${b.d}, ${a.y}`;
  return `${mA} ${a.d}, ${a.y} – ${mB} ${b.d}, ${b.y}`;
}

/**
 * The card's title line: the Event name joined to its sail range with an em
 * dash (no surrounding spaces), e.g.
 *   'Atlantis Med—Trieste to Barcelona' + dates
 *     -> 'Atlantis Med—Trieste to Barcelona—July 15–24, 2026'.
 * The `.card-meta` style uppercases it for display.
 */
export function eventTitle(name: string, sailStart: string, sailEnd: string): string {
  const range = formatSailRange(sailStart, sailEnd);
  return range ? `${name}—${range}` : name;
}
