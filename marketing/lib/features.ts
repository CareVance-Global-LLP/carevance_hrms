/**
 * The plan comparison matrix.
 *
 * Derived from the product's `featureCategories` in
 * frontend/src/constants/pricing.ts.
 *
 * RE-AUDITED 20 Aug 2026. An earlier version of this file removed
 * "Recruitment Management (ATS)" on the grounds that it did not exist. It does —
 * 33 endpoints, twelve models, five services and a screen. That removal, and a
 * long `NOT_BUILT` list built on the same mistake, came from auditing a working
 * tree that was mid-merge. See PRODUCT_TRUTH.md §0.
 *
 * Three entries from the product's config are still removed, because the
 * codebase still does not implement them (PRODUCT_TRUTH.md §5.1):
 *
 *   · Travel & Expense Tracking      — no travel model
 *   · Public Press / Company News    — no announcement model (polls are real)
 *   · White Label / SLA / Named CSM  — plan-config strings only
 *
 * One entry was CORRECTED rather than removed: the product lists "Announcements
 * & Polls". Polls are real (`Poll`, `PollOption`, `PollVote`); announcements are
 * not. It ships here as "Polls".
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
const ADVANCE_UP = { basic_tracking: false, advance_tracking: true, basic_payroll: true, professional_payroll: true };

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
      {
        name: 'Biometric terminal ingestion (ADMS push)',
        claim: 'BIO-01',
        ...PAYROLL_ONLY,
        caveat: 'Push protocol only — eSSL, ZKTeco, Biomax, Matrix. Devices offering SDK pull cannot connect.',
      },
    ],
  },
  {
    category: 'Attendance, shifts & rostering',
    features: [
      { name: 'Attendance, check-in / check-out', claim: 'TIM-06', ...ALL },
      { name: 'Overtime rules', claim: 'TIM-07', ...ALL },
      { name: 'Approval routing & forwarding', claim: 'TIM-08', ...ALL },
      { name: 'Shifts & timezone-aware resolution', claim: 'TIM-07', ...PAYROLL_ONLY },
      { name: 'Geofenced punch & attendance selfies', claim: 'TIM-06', ...PAYROLL_ONLY },
      { name: 'Comp-off balances', claim: 'TIM-07', ...PAYROLL_ONLY },
      {
        name: 'Rostering: rotations, generation, publishing, coverage',
        claim: 'ROS-01',
        ...PAYROLL_ONLY,
        caveat: 'No drag-and-drop calendar — a one-off day is set through the form, not by dragging.',
      },
      { name: 'Shift swaps (counterparty + manager approval)', claim: 'ROS-08', ...PAYROLL_ONLY },
      { name: 'Weekly-off, penalisation & shift-allowance policies', claim: 'WTP-01', ...PAYROLL_ONLY },
    ],
  },
  {
    category: 'Leave',
    features: [
      { name: 'Leave requests & approvals', claim: 'LVE-01', ...ALL },
      { name: 'Transfer a request to another approver', claim: 'LVE-01', ...ALL },
      { name: 'Holiday calendars', claim: 'LVE-02', ...ALL },
      { name: 'Per-type accrual (annual, half-yearly, quarterly, monthly)', claim: 'LVA-01', ...PAYROLL_ONLY },
      { name: 'Mid-year joiner pro-rating & probation rates', claim: 'LVA-01', ...PAYROLL_ONLY },
      { name: 'Balance as a dated ledger, not a counter', claim: 'LVA-02', ...PAYROLL_ONLY },
      { name: 'Year-end carry-forward, reset or encashment', claim: 'LVA-05', ...PAYROLL_ONLY },
      { name: 'Leave encashment into payroll', claim: 'LVE-03', ...PAYROLL_ONLY },
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
      { name: 'Effective-dated compensation & blended arrears', claim: 'HR-10', ...PAYROLL_ONLY },
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
        name: 'Statutory documents (PF ECR, 24Q, Form 16…)',
        claim: 'FIL-01',
        ...PAYROLL_ONLY,
        caveat: '23 generate; 19 are returns and 4 are preparation sheets. Nothing auto-submits.',
      },
      { name: 'Multiple legal entities, each with its own PAN/TAN', claim: 'ENT-01', ...PAYROLL_ONLY },
      { name: 'Filings generated per legal entity', claim: 'FIL-07', ...PAYROLL_ONLY },
      { name: 'Factories Act / S&E working-hour assessment', claim: 'SWT-01', ...PAYROLL_ONLY },
      { name: 'Overtime register priced against s.59', claim: 'SWT-08', ...PAYROLL_ONLY },
      { name: 'Employee tax declarations & proof review', claim: 'TAX-01', ...PAYROLL_ONLY },
      { name: 'Old vs new regime simulator', claim: 'TAX-03', ...PAYROLL_ONLY },
    ],
  },
  {
    category: 'Money movement & finance',
    features: [
      { name: 'NEFT / RTGS bank file', claim: 'BNK-01', ...PAYROLL_ONLY },
      { name: 'Exclusions returned, never dropped', claim: 'BNK-02', ...PAYROLL_ONLY },
      { name: 'UTR recording & reconciliation', claim: 'BNK-03', ...PAYROLL_ONLY },
      { name: 'Payment reversals & stop-payment flags', claim: 'BNK-04', ...PAYROLL_ONLY },
      { name: 'Loans & salary advance recovery', claim: 'EXP-03', ...PAYROLL_ONLY },
      { name: 'Reimbursements (two-stage approval)', claim: 'EXP-01', ...PAYROLL_ONLY },
      { name: 'Flexible Benefit Plan (FBP)', claim: 'EXP-02', ...PAYROLL_ONLY },
      {
        name: 'Double-entry journal → Tally XML / Zoho Books CSV',
        claim: 'ACC-01',
        ...PRO_ONLY,
        caveat: 'Produces a file to import. No live API push into Tally or Zoho.',
      },
      { name: 'GL mapping & cost centres', claim: 'RPT-03', ...PRO_ONLY },
    ],
  },
  {
    category: 'Hiring',
    features: [
      { name: 'Job openings & requisitions', claim: 'REC-01', ...PRO_ONLY },
      { name: 'Candidates, applications & a configurable pipeline', claim: 'REC-02', ...PRO_ONLY },
      { name: 'Every stage move recorded as an event', claim: 'REC-04', ...PRO_ONLY },
      { name: 'Interviews with per-interviewer panel feedback', claim: 'REC-08', ...PRO_ONLY },
      { name: 'Offers with an approval chain', claim: 'REC-11', ...PRO_ONLY },
      { name: 'Signed offer letter on a public link', claim: 'SGN-01', ...PRO_ONLY },
      {
        name: 'Consent-gated background verification',
        claim: 'BGV-01',
        ...PRO_ONLY,
        caveat: 'A human records the findings — no AuthBridge or IDfy integration.',
      },
      {
        name: 'Public careers page',
        claim: 'REC-CAVEAT',
        basic_tracking: false, advance_tracking: false, basic_payroll: false, professional_payroll: false,
        caveat: 'Not built. Candidates are recorded by a recruiter, not self-served.',
      },
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
      { name: 'Burn rate & CTC planning', claim: 'RPT-04', ...PRO_ONLY },
      { name: 'Advanced reports & employee timeline', claim: 'RPT-05', ...PRO_ONLY },
    ],
  },
  {
    category: 'Platform & security',
    features: [
      { name: 'Multi-tenant isolation enforced at the ORM layer', claim: 'SEC-01', ...ALL },
      { name: 'Two-factor authentication (TOTP), enforceable', claim: 'SEC-03', ...ALL },
      { name: 'Monitoring notice & consent', claim: 'CON-01', ...ALL },
      { name: 'Break-glass access as a recorded session', claim: 'SEC-05', ...ALL },
      { name: 'Mobile app (iOS & Android)', claim: 'NUM-06', ...PAYROLL_ONLY },
      {
        name: 'Chat',
        claim: 'WRK-CAVEAT',
        ...ADVANCE_UP,
        caveat: 'Polls for updates rather than pushing in real time.',
      },
      { name: 'Polls', claim: 'WRK-CAVEAT', ...PAYROLL_ONLY },
      { name: 'Open API access & webhooks', claim: 'SEC-09', ...ADVANCE_UP },
      { name: 'SAML 2.0 single sign-on', claim: 'SSO-01', ...PRO_ONLY },
      {
        name: 'SCIM provisioning & deprovisioning',
        claim: 'SCM-01',
        ...PRO_ONLY,
        caveat: 'Users sync and deprovision. /Groups is unimplemented, so roles do not sync.',
      },
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

/**
 * Stated plainly on /pricing rather than left for a buyer to discover.
 *
 * This list was much longer and mostly wrong — see the header. What remains is
 * what a re-audit against the settled tree actually confirms is absent.
 */
export const NOT_BUILT: readonly string[] = Object.freeze([
  'A public careers page — candidates are recorded by a recruiter, not self-served',
  'Background-check vendor integration (AuthBridge, IDfy) — findings are entered by a human',
  'SCIM group provisioning — people sync, the roles they should get do not',
  'Drag-and-drop roster calendar — a one-off day is set through a form',
  'Biometric SDK pull, or devices with no outbound route — ADMS push only',
  'Live accounting API push — Tally and Zoho get a file to import',
  'Travel expense management',
  'Company announcements — polls exist, announcements do not',
  'Real-time chat transport — the client polls',
  'Any language but English — there is no i18n layer',
  'Engagement surveys and an HR helpdesk',
  'SOC 2 or ISO 27001 certification, and any published uptime or SLA',
]);
