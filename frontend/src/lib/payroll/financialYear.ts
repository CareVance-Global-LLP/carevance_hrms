/**
 * The Indian financial year runs April to March.
 *
 * This lived in three places and was wrong in one of them: the Tax &
 * Compliance tab rendered the literal string "FY 2025–26" in its JSX, so it
 * showed the wrong year permanently — while the Overview tab, three clicks
 * away, correctly showed FY 2026-27 for the same data.
 *
 * The canonical form here matches the backend's
 * PayrollCalculatorService::financialYearKey() exactly ('YYYY-YY'), because
 * declarations are looked up by an exact string match on it. Sending anything
 * else — MyPayroll.tsx sent a bare calendar year — finds nothing, and an
 * employee whose declaration cannot be found is taxed as though they never
 * made one.
 */

/** The financial year containing a 'YYYY-MM' month, as 'YYYY-YY'. */
export function financialYearOfMonth(monthYear: string): string {
  const [yStr, mStr] = monthYear.split('-');
  const year = Number.parseInt(yStr, 10);
  const month = Number.parseInt(mStr, 10);

  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return monthYear;
  }

  const start = month >= 4 ? year : year - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
}

/** The financial year containing a date, as 'YYYY-YY'. Defaults to today. */
export function currentFinancialYear(now: Date = new Date()): string {
  const monthYear = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return financialYearOfMonth(monthYear);
}

/**
 * Display form, with an en dash: 'FY 2026–27'.
 *
 * Never use this as an API parameter — the en dash and the prefix are for
 * people, not for the exact-match lookup on the server.
 */
export function formatFinancialYear(financialYear: string): string {
  return `FY ${financialYear.replace('-', '–')}`;
}
