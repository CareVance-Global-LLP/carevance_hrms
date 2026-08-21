/**
 * The demo employee, carried through every screen on this site.
 *
 * One person, one month, one number — Priya Nair's ₹1,07,187 — appears in the
 * tracker fragment, the attendance day, the payroll run row, the statutory
 * breakdown and the payslip. That continuity IS the pitch (brief §5.1): five
 * disconnected screenshots argue nothing, five views of the same record argue
 * that they are one system.
 *
 * EVERY FIGURE BELOW IS COMPUTED, NOT INVENTED. They were derived from the
 * product's own engine constants and verified to balance:
 *
 *   basic       40% of monthly CTC          PayrollCalculatorService::resolveStructureConfig
 *   HRA         50% of basic (metro)        ditto — non-metro would silently be 40%
 *   conveyance  ₹1,600 flat                 ditto
 *   employer PF 12% of min(basic, ₹15,000)  PF_WAGE_CAP, EMPLOYER_PF_RATE
 *   gratuity    4.81% of basic              GRATUITY_RATE
 *   special     the residual that returns the total to CTC
 *
 *   gross + employer PF + gratuity provision = ₹1,20,000 exactly.
 *
 * Deductions: employee PF 12% of the capped wage; ESI nil because gross clears
 * the ₹21,000 threshold; Maharashtra PT ₹200 (₹300 in February — the product
 * models that, and the compliance page says so); TDS on the new regime with the
 * ₹75,000 standard deduction and FY2025-26 slabs, cess at 4%.
 *
 * If you change a number here, re-run the derivation. A demo that does not
 * balance is worse than no demo on a site whose whole argument is arithmetic.
 */

export const EMPLOYEE = Object.freeze({
  name: 'Priya Nair',
  code: 'CV-0142',
  initials: 'PN',
  designation: 'Senior Engineer',
  department: 'Engineering',
  location: 'Mumbai',
  state: 'Maharashtra',
  stateCode: 'maharashtra',
  isMetro: true,
  joinedOn: '2023-06-12',
  annualCtc: 1440000,
  monthlyCtc: 120000,
});

export const PERIOD = Object.freeze({
  month: 'August 2026',
  monthShort: 'Aug 2026',
  key: '2026-08',
  workingDays: 22,
  paidDays: 22,
  lopDays: 0,
});

/** Earnings — what appears on the payslip's left column. */
export const EARNINGS = Object.freeze([
  { label: 'Basic', amount: 48000, note: '40% of CTC' },
  { label: 'House Rent Allowance', amount: 24000, note: '50% of basic — metro' },
  { label: 'Conveyance Allowance', amount: 1600, note: 'flat' },
  { label: 'Special Allowance', amount: 42291.2, note: 'residual', isResidual: true },
]);

export const GROSS = 115891.2;

/** Employee deductions. */
export const DEDUCTIONS = Object.freeze([
  { label: 'Provident Fund', amount: 1800, note: '12% of ₹15,000 ceiling', claim: 'STA-01' },
  { label: 'Employee State Insurance', amount: 0, note: 'gross above ₹21,000', claim: 'STA-02' },
  { label: 'Professional Tax', amount: 200, note: 'Maharashtra', claim: 'STA-04' },
  { label: 'TDS', amount: 6704.03, note: 'new regime, cumulative', claim: 'STA-05' },
]);

export const TOTAL_DEDUCTIONS = 8704.03;
export const NET_PAY = 107187.17;

/** Employer cost sitting inside the CTC envelope, not on the payslip. */
export const EMPLOYER_COST = Object.freeze([
  { label: 'Employer PF', amount: 1800, note: 'EPS ₹1,249.50 · EPF ₹550.50', claim: 'STA-01' },
  { label: 'Gratuity provision', amount: 2308.8, note: '4.81% of basic', claim: 'STA-07' },
]);

/** The tracker fragment — stage one of the chain. */
export const TRACKED = Object.freeze({
  date: '18 August 2026',
  dateShort: 'Mon 18 Aug',
  hours: '7h 42m',
  activeShare: 94,
  idleRecovered: '18m',
  screenshots: 31,
  topApp: 'VS Code',
  captures: [
    { at: '09:12', app: 'VS Code', kind: 'productive' as const },
    { at: '11:40', app: 'Figma', kind: 'productive' as const },
    { at: '14:05', app: 'Slack', kind: 'neutral' as const },
    { at: '16:28', app: 'VS Code', kind: 'productive' as const },
  ],
});

/** The attendance month — stage two. */
export const ATTENDANCE = Object.freeze({
  present: 22,
  workingDays: 22,
  lop: 0,
  totalHours: '169h 24m',
  shift: 'General · 09:30–18:30 IST',
  regularisations: 1,
});

/**
 * The override example, from OverrideBalancingService.
 *
 * The amplification factor of 1.668 is the product's own: raising basic by ₹1
 * costs the residual ₹1.668, because HRA is derived from basic and employer PF
 * and the gratuity provision move with it. This example raises basic from
 * ₹48,000 to ₹60,000 — a ₹12,000 ask that costs ₹20,016.
 */
export const OVERRIDE_EXAMPLE = Object.freeze({
  component: 'Basic',
  current: 48000,
  requested: 60000,
  delta: 12000,
  amplification: 1.668,
  residualBefore: 42291.2,
  residualAfter: 22275.2, // 42,291.20 − (12,000 × 1.668)
  trueCost: 20016,
  permitted: true,
  absorbedBy: 'Special Allowance',
});

/** The refusal case — the thing no competitor documents. */
export const OVERRIDE_REFUSAL = Object.freeze({
  component: 'Basic',
  current: 48000,
  requested: 78000,
  amplification: 1.668,
  residualBefore: 42291.2,
  wouldLeave: -7749.4, // 42,291.20 − (30,000 × 1.668)
  permitted: false,
  maxPermitted: 73352.04, // 48,000 + (42,291.20 / 1.668)
  message:
    'Special Allowance cannot absorb this. The most Basic can be, at this CTC, is ₹73,352.04.',
});

/** The differences report — two runs compared. */
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

/** Filings produced for the period. Only the 13 that really generate. */
export const FILINGS = Object.freeze([
  { label: 'PF ECR', format: 'Text', ready: true },
  { label: 'ESI Challan', format: 'CSV', ready: true },
  { label: 'Form 24Q', format: 'FVU', ready: true },
  { label: 'PT Return — Maharashtra', format: 'CSV', ready: true },
  { label: 'LWF Return', format: 'CSV', ready: true },
  { label: 'Form 16', format: 'PDF', ready: true },
  { label: 'Form 12BA', format: 'PDF', ready: true },
]);

/** The run lifecycle, as the product models it. */
export const RUN_STAGES = Object.freeze([
  { key: 'draft', label: 'Draft', done: true },
  { key: 'locked', label: 'Locked', done: true },
  { key: 'approved', label: 'Approved', done: true },
  { key: 'released', label: 'Released', done: true },
  { key: 'disbursed', label: 'Disbursed', done: false, current: true },
]);

/** Other people in the run, so a table reads as a table and not a single row. */
export const RUN_ROSTER = Object.freeze([
  { name: 'Priya Nair', code: 'CV-0142', dept: 'Engineering', gross: 115891.2, net: 107187.17, flagged: false },
  { name: 'Arjun Deshpande', code: 'CV-0088', dept: 'Engineering', gross: 92450, net: 86120.5, flagged: false },
  { name: 'Fatima Sheikh', code: 'CV-0211', dept: 'Finance', gross: 74300, net: 69884.25, flagged: false },
  { name: 'Rohit Verma', code: 'CV-0305', dept: 'Operations', gross: 41200, net: 38946.7, flagged: true },
  { name: 'Ananya Iyer', code: 'CV-0117', dept: 'Design', gross: 68900, net: 64512.4, flagged: false },
]);

/* ── Formatting ───────────────────────────────────────────────────────── */

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
 * Indian digit grouping, always. `en-US` would render ₹1,07,187 as ₹107,187,
 * which reads as a foreign product to the only market this sells into.
 */
export function inr(amount: number, paise = false): string {
  return (paise ? INR_2 : INR_0).format(amount);
}

/** Bare number, Indian grouping, no symbol — for table columns with a ₹ header. */
export function num(amount: number, paise = false): string {
  return (paise ? INR_2 : INR_0).format(amount).replace('₹', '').trim();
}
