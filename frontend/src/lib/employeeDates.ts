/**
 * Display helpers for calendar dates on employee screens.
 *
 * These are date-only values — a birthday, a joining date. They are not
 * instants, and must never be put through anything timezone-aware for display,
 * or a date stored as the 24th renders as the 23rd for every user ahead of UTC.
 */

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * Render `YYYY-MM-DD` (or a legacy ISO datetime) as `24 Aug 1996`.
 *
 * Parsed by string, deliberately. `new Date('1996-08-24')` is interpreted as
 * UTC midnight and then printed in local time, which moves the date backwards
 * anywhere west of UTC and is exactly the class of bug this avoids.
 */
export function formatCalendarDate(value: string | null | undefined): string {
  if (!value) return '';

  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return String(value);

  const [, year, month, day] = match;
  const monthIndex = Number(month) - 1;
  if (monthIndex < 0 || monthIndex > 11) return String(value);

  return `${Number(day)} ${MONTHS[monthIndex]} ${year}`;
}

/**
 * How long someone has been here, from a joining date.
 *
 * Future joining dates are valid and normal — pre-boarding is the expected
 * path — so those are reported as time remaining rather than as a negative
 * tenure or an empty cell.
 */
export function formatTenure(value: string | null | undefined): string {
  if (!value) return '';

  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return '';

  const [, y, m, d] = match.map(Number) as unknown as [string, number, number, number];
  const joined = new Date(y, m - 1, d);
  if (Number.isNaN(joined.getTime())) return '';

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (joined > today) {
    const days = Math.round((joined.getTime() - today.getTime()) / 86_400_000);
    return days === 1 ? 'Joins tomorrow' : `Joins in ${days} days`;
  }

  let months =
    (today.getFullYear() - joined.getFullYear()) * 12 + (today.getMonth() - joined.getMonth());
  if (today.getDate() < joined.getDate()) months -= 1;

  if (months < 1) {
    const days = Math.round((today.getTime() - joined.getTime()) / 86_400_000);
    if (days === 0) return 'Joined today';
    return days === 1 ? '1 day' : `${days} days`;
  }

  const years = Math.floor(months / 12);
  const remainder = months % 12;

  if (years === 0) return remainder === 1 ? '1 month' : `${remainder} months`;
  if (remainder === 0) return years === 1 ? '1 year' : `${years} years`;

  return `${years}y ${remainder}m`;
}
