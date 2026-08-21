/**
 * The plan comparison matrix.
 *
 * Derived from the product's `featureCategories` in
 * frontend/src/constants/pricing.ts, with four entries REMOVED because the
 * codebase does not implement them (PRODUCT_TRUTH.md DONT-12..DONT-15):
 *
 *   · Recruitment Management (ATS)   — no job/candidate/offer model or routes
 *   · Travel & Expense Tracking      — no travel model
 *   · Public Press / Company News    — no announcement model
 *   · White Label / SLA / Named CSM  — plan-config strings only
 *
 * One entry was CORRECTED rather than removed: the product lists "Announcements
 * & Polls". Polls are real (`Poll`, `PollOption`, `PollVote`); announcements are
 * not. It ships here as "Polls".
 *
 * One entry was DROPPED as unverifiable: "Screenshot Chat Monitoring" has no
 * clear implementation, and a feature nobody can point at is not a feature.
 *
 * Each row carries the claim ID that licenses it.
 */

export type PlanCode = 'basic_tracking' | 'advance_tracking' | 'basic_payroll' | 'professional_payroll';

export interface FeatureRow {
  name: string;
  claim: string;
  basic_tracking: boolean;
  advance_tracking: boolean;
  basic_payroll: boolean;
  professional_payroll: boolean;
  /** Shown as a footnote where the plain tick would overstate things. */
  caveat?: string;
}

export interface FeatureCategory {
  category: string;
  features: FeatureRow[];
}

const ALL = { basic_tracking: true, advance_tracking: true, basic_payroll: true, professional_payroll: true };
const PAYROLL_ONLY = { basic_tracking: false, advance_tracking: false, basic_payroll: true, professional_payroll: true };
const PRO_ONLY = { basic_tracking: false, advance_tracking: false, basic_payroll: false, professional_payroll: true };
const ADVANCE_ONLY = { basic_tracking: false, advance_tracking: true, basic_payroll: false, professional_payroll: false };

export const FEATURE_MATRIX: readonly FeatureCategory[] = Object.freeze([
  {
    category: 'Evidence of work',
    features: [
      { name: 'Desktop tracker with screenshots', claim: 'TIM-01', ...ALL },
      { name: 'Offline capture queue', claim: 'TIM-01', ...ALL },
      { name: 'Timeline & timesheets', claim: 'RPT-01', ...ALL },
      { name: 'Browser extension (URL context)', claim: 'TIM-02', ...ADVANCE_ONLY },
      { name: 'Activity & productivity classification', claim: 'TIM-03', ...ADVANCE_ONLY },
      { name: 'Idle detection and rewind', claim: 'TIM-04', ...ADVANCE_ONLY },
      { name: 'Application & web usage tracking', claim: 'TIM-03', ...ADVANCE_ONLY },
      { name: 'Break tracking', claim: 'TIM-07', ...ADVANCE_ONLY },
    ],
  },
  {
    category: 'Attendance & leave',
    features: [
      { name: 'Attendance, check-in / check-out', claim: 'TIM-06', ...ALL },
      { name: 'Leave requests & approvals', claim: 'LVE-01', ...ALL },
      {
        name: 'Leave balances',
        claim: 'LVE-02',
        ...ALL,
        caveat: 'Flat annual quota. No accrual schedule or mid-year pro-rating.',
      },
      { name: 'Overtime rules', claim: 'TIM-07', ...ALL },
      { name: 'Approval routing & forwarding', claim: 'TIM-08', ...ALL },
      { name: 'Shifts & shift allowance rules', claim: 'TIM-07', ...PAYROLL_ONLY },
      { name: 'Geofenced punch & attendance selfies', claim: 'TIM-06', ...PAYROLL_ONLY },
      { name: 'Comp-off balances', claim: 'TIM-07', ...PAYROLL_ONLY },
    ],
  },
  {
    category: 'Payroll',
    features: [
      { name: 'Payroll run lifecycle (draft → disbursed)', claim: 'PAY-02', ...PAYROLL_ONLY },
      { name: 'Salary structures: formula, slab, lookup', claim: 'PAY-03', ...PAYROLL_ONLY },
      { name: 'Attendance sync into the run', claim: 'TIM-09', ...PAYROLL_ONLY },
      { name: 'Governed overrides with maker-checker', claim: 'OVR-05', ...PAYROLL_ONLY },
      { name: 'Override CSV round-trip with validation', claim: 'OVR-07', ...PAYROLL_ONLY },
      { name: 'Arrears, LOP, pro-rating, notice recovery', claim: 'PAY-07', ...PAYROLL_ONLY },
      { name: 'Off-cycle and on-demand runs', claim: 'PAY-06', ...PAYROLL_ONLY },
      { name: 'Full & final settlement', claim: 'HR-06', ...PAYROLL_ONLY },
    ],
  },
  {
    category: 'Statutory & filings',
    features: [
      { name: 'PF, ESI, PT, TDS, LWF, gratuity', claim: 'STA-01', ...PAYROLL_ONLY },
      { name: 'Professional tax across 37 states & UTs', claim: 'STA-04', ...PAYROLL_ONLY },
      { name: 'ESI contribution-period lock-in', claim: 'STA-03', ...PAYROLL_ONLY },
      {
        name: 'Statutory returns (PF ECR, 24Q, Form 16…)',
        claim: 'FIL-01',
        ...PAYROLL_ONLY,
        caveat: '13 returns generate today. 10 declaration forms are registered but unavailable.',
      },
      { name: 'Employee tax declarations & proof review', claim: 'TAX-01', ...PAYROLL_ONLY },
      { name: 'Old vs new regime simulator', claim: 'TAX-03', ...PAYROLL_ONLY },
    ],
  },
  {
    category: 'Money movement',
    features: [
      { name: 'NEFT / RTGS bank file', claim: 'BNK-01', ...PAYROLL_ONLY },
      { name: 'Exclusions returned, never dropped', claim: 'BNK-02', ...PAYROLL_ONLY },
      { name: 'UTR recording & reconciliation', claim: 'BNK-03', ...PAYROLL_ONLY },
      { name: 'Payment reversals & stop-payment flags', claim: 'BNK-04', ...PAYROLL_ONLY },
      { name: 'Loans & salary advance recovery', claim: 'EXP-03', ...PAYROLL_ONLY },
      { name: 'Reimbursements (two-stage approval)', claim: 'EXP-01', ...PAYROLL_ONLY },
      { name: 'Flexible Benefit Plan (FBP)', claim: 'EXP-02', ...PAYROLL_ONLY },
    ],
  },
  {
    category: 'Core HR',
    features: [
      { name: 'Employee records, documents, government IDs', claim: 'HR-01', ...PAYROLL_ONLY },
      { name: 'Onboarding journeys (18-step checklist)', claim: 'HR-02', ...PAYROLL_ONLY },
      { name: 'Resignation & exit lifecycle', claim: 'HR-05', ...PAYROLL_ONLY },
      { name: 'Org structure, departments, teams', claim: 'HR-08', ...PAYROLL_ONLY },
      { name: 'Standard access roles', claim: 'SEC-04', ...PAYROLL_ONLY },
      { name: 'Custom roles & permissions', claim: 'SEC-04', ...PRO_ONLY },
      { name: 'Performance goals, reviews, 360', claim: 'WRK-CAVEAT', ...PRO_ONLY },
      { name: 'Asset tracking & assignment', claim: 'WRK-CAVEAT', ...PRO_ONLY },
    ],
  },
  {
    category: 'Reports & controls',
    features: [
      { name: 'Daily, weekly, monthly & productivity reports', claim: 'RPT-01', ...ALL },
      { name: 'CSV export', claim: 'RPT-01', ...ALL },
      { name: 'Payroll & statutory registers', claim: 'RPT-02', ...PAYROLL_ONLY },
      { name: 'Differences, duplicates, negative-cost reports', claim: 'CTL-01', ...PAYROLL_ONLY },
      { name: 'Payroll audit log & run activity feed', claim: 'CTL-05', ...PAYROLL_ONLY },
      { name: 'GL mapping & cost centres', claim: 'RPT-03', ...PRO_ONLY },
      { name: 'Advanced reports & employee timeline', claim: 'RPT-05', ...PRO_ONLY },
    ],
  },
  {
    category: 'Platform',
    features: [
      { name: 'Multi-tenant isolation enforced at the ORM layer', claim: 'SEC-01', ...ALL },
      { name: 'Two-factor authentication (TOTP)', claim: 'SEC-03', ...ALL },
      { name: 'Monitoring notice & consent', claim: 'CON-01', ...ALL },
      { name: 'Mobile app (iOS & Android)', claim: 'NUM-06', ...PAYROLL_ONLY },
      {
        name: 'Chat',
        claim: 'WRK-CAVEAT',
        ...ADVANCE_ONLY,
        caveat: 'Polls for updates rather than pushing in real time.',
      },
      { name: 'Polls', claim: 'WRK-CAVEAT', ...PAYROLL_ONLY },
      { name: 'Open API access & webhooks', claim: 'SEC-09', ...ADVANCE_ONLY },
    ],
  },
]);

export const PLAN_COLUMNS: ReadonlyArray<{ code: PlanCode; label: string; sub: string }> =
  Object.freeze([
    { code: 'basic_tracking', label: 'Basic', sub: 'Tracking' },
    { code: 'advance_tracking', label: 'Advance', sub: 'Tracking' },
    { code: 'basic_payroll', label: 'Basic', sub: 'Payroll' },
    { code: 'professional_payroll', label: 'Professional', sub: 'Payroll' },
  ]);

/** Stated plainly on /pricing rather than left for a buyer to discover. */
export const NOT_BUILT: readonly string[] = Object.freeze([
  'Recruitment / applicant tracking (ATS)',
  'Offer letters, e-signature, background verification',
  'SSO and SAML (Google OAuth is the only federated sign-in)',
  'Multi-entity legal structure — one organisation is one PAN/TAN',
  'Effective-dated compensation history',
  'Leave accrual schedules and mid-year pro-rating',
  'Travel expense management',
  'Real-time chat transport',
]);
