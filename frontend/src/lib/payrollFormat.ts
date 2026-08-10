/**
 * One way to typeset money in the payroll module.
 *
 * The module currently carries sixteen money formatters — fourteen local
 * definitions plus two competing shared utils — and they disagree: some omit
 * the rupee symbol, some round, some render zero as an em dash. The same
 * amount is typeset differently depending on which screen you are looking at.
 *
 * These two are the canonical pair. New payroll code should import from here.
 */

/**
 * Full amount, Indian digit grouping, no paise.
 *
 * Payroll amounts are stored as decimals and rounded once at the boundary —
 * this is a display function, so it rounds for reading and never feeds a
 * calculation.
 */
export function formatPayrollAmount(amount: number | string | null | undefined): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '₹0';
  // Negative net pay is a real, meaningful state — payroll validation is what
  // should stop a run, and it can only do that if the figure stays visible.
  // Format the sign outside the grouping so it reads "−₹1,200", not "₹−1,200".
  const sign = n < 0 ? '−' : '';
  return `${sign}₹${Math.abs(Math.round(n)).toLocaleString('en-IN')}`;
}

/**
 * Abbreviated amount for axis ticks and tight cards.
 *
 * The crore branch matters: an earlier implementation divided by 1,00,00,000
 * and then appended "L", so ₹5 crore printed as "₹5.0L" — the right number
 * against the wrong unit, understating by a factor of 100.
 */
export function formatPayrollAmountShort(amount: number | string | null | undefined): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '₹0';

  const sign = n < 0 ? '−' : '';
  const abs = Math.abs(n);

  if (abs >= 1_00_00_000) return `${sign}₹${(abs / 1_00_00_000).toFixed(1)}Cr`;
  if (abs >= 1_00_000) return `${sign}₹${(abs / 1_00_000).toFixed(1)}L`;
  if (abs >= 1_000) return `${sign}₹${(abs / 1_000).toFixed(0)}K`;
  return `${sign}₹${Math.round(abs).toLocaleString('en-IN')}`;
}
