/**
 * The worked example carried through every product screen on the landing page.
 *
 * WHY THIS FILE EXISTS AT ALL. The tour used to be illustrated with real PNG
 * screenshots from a demo tenant, and they showed an EMPTY system: Productive
 * Share 0.0%, Tracked Time 0h 0m, "No tool analytics found", Total Payroll ₹0,
 * Run Status "No Run", and all seven statutory filings marked "Needs run" — sat
 * directly beneath captions claiming the work is captured and the payslip is
 * produced. The picture argued against the sentence.
 *
 * So the screens are rebuilt in markup from these figures instead. That buys
 * three things a screenshot cannot: the image always matches its caption
 * because both are generated from one source, it stays legible at any size
 * instead of being a 2880×10572 full-page capture crushed into a card, and it
 * cannot silently go stale when the app's UI moves.
 *
 * EVERY FIGURE BELOW IS COMPUTED, NOT INVENTED, from the payroll engine's own
 * constants — and it balances:
 *
 *   basic       40% of monthly CTC              PayrollCalculatorService
 *   HRA         50% of basic (metro)            ditto — non-metro would be 40%
 *   conveyance  ₹1,600 flat                     ditto
 *   special     the residual that returns the total to CTC
 *   employer PF 12% of min(basic, ₹15,000)      PF_WAGE_CAP, EMPLOYER_PF_RATE
 *   gratuity    4.81% of basic                  GRATUITY_RATE
 *
 *   gross + employer PF + gratuity provision = ₹1,20,000 exactly.
 *
 * Deductions: employee PF 12% of the capped wage; ESI nil because gross clears
 * the ₹21,000 threshold; Maharashtra PT ₹200 (₹300 in February — the product
 * models that); TDS on the new regime with the ₹75,000 standard deduction and
 * FY2025-26 slabs, cess at 4%.
 *
 * These are deliberately identical to the marketing site's lib/demo.ts, so the
 * two properties cannot quote different numbers for the same example. If you
 * change one, change both, and re-run the derivation — a demo that does not
 * balance is worse than no demo on a page whose whole argument is arithmetic.
 *
 * IT IS A WORKED EXAMPLE, NOT A CUSTOMER. Every screen that renders it is
 * labelled as such. Nothing here describes a real organisation's data.
 */

export const EMPLOYEE = Object.freeze({
  name: 'Priya Nair',
  code: 'CV-0142',
  designation: 'Senior Engineer',
  department: 'Engineering',
  location: 'Mumbai',
  state: 'Maharashtra',
});

export const PERIOD = Object.freeze({
  month: 'August 2026',
  monthShort: 'Aug 2026',
  workingDays: 22,
});

/** Stage 1 — what the desktop tracker recorded on one day. */
export const TRACKED = Object.freeze({
  dateShort: 'Mon 18 Aug',
  hours: '7h 42m',
  activeShare: 94,
  idleRecovered: '18m',
  screenshots: 31,
  captures: [
    { at: '09:12', app: 'VS Code', kind: 'productive' as const },
    { at: '11:40', app: 'Figma', kind: 'productive' as const },
    { at: '14:05', app: 'Slack', kind: 'neutral' as const },
    { at: '16:28', app: 'VS Code', kind: 'productive' as const },
  ],
});

/** Stage 2 — the attendance month the payroll run reads. */
export const ATTENDANCE = Object.freeze({
  present: 22,
  workingDays: 22,
  lop: 0,
  totalHours: '169h 24m',
  shift: 'General · 09:30–18:30 IST',
  regularisations: 1,
});

/** Stage 3 — the run lifecycle, exactly as the product models it. */
export const RUN_STAGES = Object.freeze([
  { key: 'draft', label: 'Draft', done: true },
  { key: 'locked', label: 'Locked', done: true },
  { key: 'approved', label: 'Approved', done: true },
  { key: 'released', label: 'Released', done: true },
  { key: 'disbursed', label: 'Disbursed', done: false, current: true },
]);

/**
 * Stage 3 — the differences report.
 *
 * The amplification factor is the product's own: raising basic by ₹1 costs the
 * residual ₹1.668, because HRA derives from basic and employer PF and the
 * gratuity provision move with it. Override #418 raises basic from ₹48,000 to
 * ₹60,000 — a ₹12,000 ask that costs ₹20,016, which is why Special Allowance
 * falls from ₹42,291.20 to ₹22,275.20.
 */
export const DIFFERENCES = Object.freeze([
  { component: 'Basic', from: 48000, to: 48000, reason: null },
  { component: 'House Rent Allowance', from: 24000, to: 24000, reason: null },
  {
    component: 'Special Allowance',
    from: 42291.2,
    to: 22275.2,
    reason: 'Override #418 — Basic raised to ₹60,000',
  },
  { component: 'Professional Tax', from: 200, to: 300, reason: 'February — Maharashtra' },
  { component: 'TDS', from: 6704.03, to: 6704.03, reason: null },
]);

/** Stage 4 — the payslip. */
export const EARNINGS = Object.freeze([
  { label: 'Basic', amount: 48000, note: '40% of CTC' },
  { label: 'House Rent Allowance', amount: 24000, note: '50% of basic — metro' },
  { label: 'Conveyance Allowance', amount: 1600, note: 'flat' },
  { label: 'Special Allowance', amount: 42291.2, note: 'residual' },
]);

export const DEDUCTIONS = Object.freeze([
  { label: 'Provident Fund', amount: 1800, note: '12% of ₹15,000 ceiling', claim: 'STA-01' },
  { label: 'Employee State Insurance', amount: 0, note: 'gross above ₹21,000', claim: 'STA-02' },
  { label: 'Professional Tax', amount: 200, note: 'Maharashtra', claim: 'STA-04' },
  { label: 'TDS', amount: 6704.03, note: 'new regime, cumulative', claim: 'STA-05' },
]);

export const GROSS = 115891.2;
export const TOTAL_DEDUCTIONS = 8704.03;
export const NET_PAY = 107187.17;

const INR_0 = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const INR_2 = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Indian digit grouping, always. `en-US` renders ₹1,07,187 as ₹107,187, which
 * reads as a foreign product to the only market this sells into.
 */
export function inr(amount: number, paise = false): string {
  return (paise ? INR_2 : INR_0).format(amount);
}

/** Bare number, Indian grouping, for a column that already has a ₹ header. */
export function num(amount: number, paise = false): string {
  return (paise ? INR_2 : INR_0).format(amount).replace('₹', '').trim();
}
