/**
 * Site-level constants: identity, navigation, and the canonical page list that
 * sitemap.xml, the mega-menu and the footer all read from. One source, so a new
 * page cannot end up in the nav but missing from the sitemap.
 */

export const SITE = Object.freeze({
  name: 'CareVance',
  legalName: 'CareVance', // TODO(founder): registered entity name — see PRODUCT_TRUTH.md §6.1
  tagline: 'The hours are the payslip.',
  description:
    'CareVance is an Indian HR and payroll platform where the evidence of work and the payslip are the same system — tracked hours become the payroll run, the statutory computation and the bank file, with no export step.',
  /** Overridden by NEXT_PUBLIC_SITE_URL in preview and production. */
  url: process.env.NEXT_PUBLIC_SITE_URL ?? 'https://carevance.com',
  locale: 'en_IN',
  appUrl: 'https://app.carevance.com',
  salesEmail: 'sales@carevance.com',
  supportEmail: 'support@carevance.com',
  privacyEmail: 'privacy@carevance.com',
});

export interface NavItem {
  href: string;
  label: string;
  /** One line. Present on the six featured product items; absent elsewhere. */
  blurb?: string;
  /** P2 pages ship with placeholder copy and are marked so in the footer. */
  placeholder?: boolean;
}

/**
 * The six featured product pages, each with a description (brief §4).
 * A flat eleven-item list is explicitly on the do-not-build list — the other
 * product pages appear as a plain secondary column, not as equals.
 */
export const PRODUCT_FEATURED: readonly NavItem[] = Object.freeze([
  {
    href: '/product',
    label: 'Platform overview',
    blurb: 'The unbroken chain, from a tracked minute to a filed return.',
  },
  {
    href: '/product/payroll',
    label: 'Payroll',
    blurb: 'CTC to net, with the arithmetic to prove every line.',
  },
  {
    href: '/product/time-attendance',
    label: 'Time & attendance',
    blurb: 'Tracker, shifts and geofenced punch — and the handoff into payroll.',
  },
  {
    href: '/product/compliance',
    label: 'Compliance & filings',
    blurb: 'PF, ESI, PT across 37 states, TDS both regimes, and real ECR files.',
  },
  {
    href: '/product/core-hr',
    label: 'Core HR',
    blurb: 'Records, documents, onboarding journeys and exit.',
    placeholder: true,
  },
  {
    href: '/product/reports',
    label: 'Reports & controls',
    blurb: 'Differences, duplicates, negative cost and reconciliation.',
    placeholder: true,
  },
]);

/** Secondary product pages — links only, no descriptions. */
export const PRODUCT_MORE: readonly NavItem[] = Object.freeze([
  { href: '/product/leave', label: 'Leave', placeholder: true },
  { href: '/product/performance', label: 'Performance', placeholder: true },
  { href: '/product/expenses-fbp', label: 'Expenses & FBP', placeholder: true },
  { href: '/product/mobile', label: 'Mobile & desktop apps', placeholder: true },
]);

export const SOLUTIONS: readonly NavItem[] = Object.freeze([
  {
    href: '/solutions/staffing-agencies',
    label: 'Staffing agencies',
    blurb: 'Bill what was actually worked, with the evidence attached.',
    placeholder: true,
  },
  {
    href: '/solutions/it-services',
    label: 'IT services',
    blurb: 'Project time, utilisation and payroll in one ledger.',
    placeholder: true,
  },
  {
    href: '/solutions/small-business',
    label: 'Small business',
    blurb: 'Your first payroll system after the spreadsheet.',
    placeholder: true,
  },
]);

export const COMPARISONS: readonly NavItem[] = Object.freeze([
  { href: '/compare/spreadsheet-payroll', label: 'vs. spreadsheet payroll', placeholder: true },
  { href: '/compare/keka-alternative', label: 'Keka alternative', placeholder: true },
  { href: '/compare/greythr-alternative', label: 'greytHR alternative', placeholder: true },
]);

export const TOOLS: readonly NavItem[] = Object.freeze([
  {
    href: '/tools/salary-breakup-calculator',
    label: 'Salary breakup calculator',
    blurb: 'CTC to components, using the product’s own structure logic.',
  },
  {
    href: '/tools/take-home-salary-calculator',
    label: 'Take-home salary calculator',
    blurb: 'Net in hand after PF, PT, ESI and TDS.',
  },
  {
    href: '/tools/gratuity-calculator',
    label: 'Gratuity calculator',
    blurb: 'Five-year floor and the ₹20,00,000 ceiling, applied properly.',
  },
  {
    href: '/tools/hra-exemption-calculator',
    label: 'HRA exemption calculator',
    blurb: 'The least-of-three rule, metro and non-metro.',
  },
  {
    href: '/tools/professional-tax-by-state',
    label: 'Professional tax by state',
    blurb: 'All 37 states and UTs, including the ones that levy nothing.',
  },
]);

export const RESOURCES: readonly NavItem[] = Object.freeze([
  { href: '/why-carevance', label: 'Why CareVance' },
  { href: '/security', label: 'Security' },
  { href: '/methodology', label: 'How we count' },
  { href: '/resources', label: 'Guides', placeholder: true },
  { href: '/changelog', label: 'Changelog', placeholder: true },
]);

export const LEGAL: readonly NavItem[] = Object.freeze([
  { href: '/legal/privacy', label: 'Privacy policy' },
  { href: '/legal/terms', label: 'Terms of service' },
  { href: '/legal/dpa', label: 'Data processing addendum' },
]);

export const COMPANY: readonly NavItem[] = Object.freeze([
  { href: '/about', label: 'About', placeholder: true },
  { href: '/contact', label: 'Contact' },
  { href: '/careers', label: 'Careers', placeholder: true },
]);

/** Everything with a route, for sitemap.xml. */
export const ALL_ROUTES: readonly NavItem[] = Object.freeze([
  { href: '/', label: 'Home' },
  ...PRODUCT_FEATURED,
  ...PRODUCT_MORE,
  ...SOLUTIONS,
  ...COMPARISONS,
  { href: '/pricing', label: 'Pricing' },
  { href: '/tools', label: 'Free tools' },
  ...TOOLS,
  ...RESOURCES,
  ...COMPANY,
  ...LEGAL,
]);

export const CTA = Object.freeze({
  demo: { href: '/contact?intent=demo', label: 'Book a 20-minute demo' },
  demoShort: { href: '/contact?intent=demo', label: 'Book a demo' },
  tour: { href: '/product#tour', label: 'Take the 2-minute tour' },
  signIn: { href: `${SITE.appUrl}/login`, label: 'Sign in' },
  trial: { href: `${SITE.appUrl}/signup`, label: 'Start free trial' },
});
