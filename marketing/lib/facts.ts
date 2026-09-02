/**
 * Every verifiable number on this website, in one place.
 *
 * Each entry carries the claim ID it was audited under in PRODUCT_TRUTH.md at
 * the repo root. That file names the file path the number was counted from.
 * The rule is that no sentence ships without a citation; keeping the numbers
 * here rather than inline in JSX is what makes that checkable — `grep -r
 * "10,000" app/` returning nothing is a test you can actually run.
 *
 * RE-AUDITED 20 Aug 2026. An earlier version of this file carried numbers taken
 * from a working tree that was mid-merge and missing eight modules. Every count
 * below moved. Before editing, read PRODUCT_TRUTH.md §0 — it records how that
 * happened and the one-second check that prevents it.
 *
 * If you are tempted to add a customer count, a review score, a logo or an
 * uptime figure: none of those exist. See DONT-01, DONT-02, DONT-10.
 */

export interface Fact {
  /** Claim ID in PRODUCT_TRUTH.md. */
  readonly id: string;
  /** Rendered value. Pre-formatted, because `37` and `₹15,000` differ. */
  readonly value: string;
  /** Numeric value where a count-up animation needs one. */
  readonly n?: number;
  /** What it counts — the label beside the number. */
  readonly label: string;
  /** One line of provenance, shown on /methodology and in the title attr. */
  readonly source: string;
}

const fact = <T extends Record<string, Fact>>(t: T) => Object.freeze(t);

/* ── Platform scale ───────────────────────────────────────────────────── */

export const SCALE = fact({
  routes: {
    id: 'NUM-01',
    value: '776',
    n: 776,
    label: 'API endpoints',
    source: 'Counted across backend/routes/ on 20 Aug 2026.',
  },
  models: {
    id: 'NUM-02',
    value: '190',
    n: 190,
    label: 'data models',
    source: 'backend/app/Models/*.php',
  },
  services: {
    id: 'NUM-03',
    value: '151',
    n: 151,
    label: 'business-logic services',
    source: 'backend/app/Services/**/*.php',
  },
  screens: {
    id: 'NUM-04',
    value: '133',
    n: 133,
    label: 'web screens',
    source: 'frontend/src/pages/**/*.tsx',
  },
  apps: {
    id: 'NUM-05',
    value: '4',
    n: 4,
    label: 'apps in the suite',
    source: 'Web (React), mobile (Expo), desktop tracker (Electron), browser extension.',
  },
  mobileScreens: {
    id: 'NUM-06',
    value: '18',
    n: 18,
    label: 'mobile screens',
    source: 'mobile-app/app/**/*.tsx',
  },
  payrollRoutes: {
    id: 'NUM-09',
    value: '215',
    n: 215,
    label: 'payroll endpoints alone',
    source: 'backend/routes/api/protected/payroll.php',
  },
  recruitmentRoutes: {
    id: 'NUM-10',
    value: '33',
    n: 33,
    label: 'recruitment endpoints',
    source: 'backend/routes/api/protected/recruitment.php',
  },
  backendTests: {
    id: 'NUM-11',
    value: '214',
    n: 214,
    label: 'backend test files',
    source: 'find backend/tests -name "*Test.php"',
  },
  frontendTests: {
    id: 'NUM-12',
    value: '132',
    n: 132,
    label: 'frontend test files',
    source: 'find frontend/src -name "*.test.*"',
  },
});

/* ── Statutory depth. The specificity IS the trust device. ────────────── */

export const STATUTORY = fact({
  ptStates: {
    id: 'NUM-07',
    value: '37',
    n: 37,
    label: 'states & UTs with PT resolved',
    source:
      'PTStateService::STATE_CONFIGS. 20 levy professional tax; 17 levy none and correctly return ₹0 rather than defaulting to a neighbour.',
  },
  ptNil: {
    id: 'STA-04',
    value: '17',
    n: 17,
    label: 'of those levy no PT at all',
    source: 'Zero is the correct answer there, and the engine returns it.',
  },
  filings: {
    id: 'NUM-08',
    value: '23',
    n: 23,
    label: 'statutory documents generated',
    source:
      'FilingGeneratorRegistry — all 23 generators produce output. Four are preparation sheets rather than returns (e-SHRAM, Shram card, S&E and Form 1), so 19 are returns. Nothing auto-submits: every filing is a document a human uploads.',
  },
  filingReturns: {
    id: 'FIL-06',
    value: '19',
    n: 19,
    label: 'of them are statutory returns',
    source: 'The other four are preparation sheets and say so on their face.',
  },
  pfCeiling: {
    id: 'STA-01',
    value: '₹15,000',
    n: 15000,
    label: 'PF wage ceiling',
    source:
      'PayrollCalculatorService::PF_WAGE_CAP — 12% each side, the employer half split EPS 8.33% / EPF 3.67%.',
  },
  esiThreshold: {
    id: 'STA-02',
    value: '₹21,000',
    n: 21000,
    label: 'ESI gross threshold',
    source: 'PayrollCalculatorService::ESI_GROSS_THRESHOLD — 0.75% employee, 3.25% employer.',
  },
  gratuityCeiling: {
    id: 'STA-07',
    value: '₹20,00,000',
    n: 2000000,
    label: 'statutory gratuity ceiling',
    source:
      'PayrollCalculatorService::GRATUITY_MAX_PAYOUT, with a five-year service floor enforced on the settlement path.',
  },
  amplification: {
    id: 'OVR-02',
    value: '1.668',
    n: 1.668,
    label: 'true cost of raising basic by ₹1',
    source:
      'OverrideBalancingService. HRA is derived from basic, and employer PF and the gratuity provision sit inside the CTC envelope, so four quantities move together: 1 + h + p + g.',
  },
});

/* ── Tenancy and security. Architecture claims, verifiable in the repo. ── */

export const SECURITY = fact({
  scopedModels: {
    id: 'SEC-01',
    value: '143',
    n: 143,
    label: 'models under tenant scope',
    source:
      'Models carrying App\\Traits\\BelongsToOrganization, which applies a global query scope and stamps organization_id on create. A test fails the build if a tenant-owned model omits it.',
  },
});

/* ── Pricing. Mirrors frontend/src/constants/pricing.ts exactly. ───────── */

export const PRICING_FACTS = fact({
  trialDays: {
    id: 'PRC-06',
    value: '14',
    n: 14,
    label: 'day free trial',
    source: 'Basic Tracking, 5 seats, no credit card. pricingUi.trialBadge / TRIAL_SEATS.',
  },
  annualDiscount: {
    id: 'PRC-07',
    value: '10%',
    n: 10,
    label: 'annual discount',
    source: 'Per-seat tracking plans only. getYearlySavingsPercent().',
  },
  gst: {
    id: 'PRC-08',
    value: '18%',
    n: 18,
    label: 'GST, charged on top',
    source: 'Indian GST on SaaS. All listed prices exclude it.',
  },
});

/**
 * The homepage proof strip (brief §5.2). No logos, no customer counts — there
 * are none. These are what a new entrant honestly has: the size and specificity
 * of what has actually been built.
 */
export const PROOF_STRIP: readonly Fact[] = Object.freeze([
  STATUTORY.ptStates,
  STATUTORY.filings,
  SCALE.apps,
  SCALE.routes,
]);

/** Flat lookup for the /methodology page, which lists every published number. */
export const ALL_FACTS: readonly Fact[] = Object.freeze([
  ...Object.values(SCALE),
  ...Object.values(STATUTORY),
  ...Object.values(SECURITY),
  ...Object.values(PRICING_FACTS),
]);
