/**
 * Pricing, mirrored from the product's frontend/src/constants/pricing.ts.
 *
 * That file is the source of truth because it is wired to real checkout — what
 * it says is what a buyer can actually sign up for. This module reproduces its
 * plan codes, prices, seat rules and `calculateTotal` arithmetic exactly, so the
 * slider on /pricing cannot quote a number the checkout will not honour.
 *
 * FOUR FEATURES WERE REMOVED ON THE WAY ACROSS. The product's pricing config
 * sells them; the codebase does not implement them. See PRODUCT_TRUTH.md
 * DONT-12..DONT-15:
 *
 *   · Recruitment Management (ATS)  — no job/candidate/offer model, no routes
 *   · Travel & Expense Tracking     — no travel model of any kind
 *   · Public Press / Company News   — no announcement model (polls are real)
 *   · White Label / SLA / Named CSM — plan-config strings, no implementation
 *
 * Do not re-add them here. If they get built, they get added to PRODUCT_TRUTH.md
 * first and arrive here with a claim ID.
 */

export type BillingCycle = 'monthly' | 'yearly';
export type PlanFamily = 'tracking' | 'payroll';

export interface Plan {
  readonly code: string;
  readonly family: PlanFamily;
  readonly label: string;
  readonly tagline: string;
  readonly blurb: string;
  /** Per-seat plans: price per user per month. Workspace plans: null. */
  readonly monthlyPerSeat: number | null;
  readonly yearlyPerSeat: number | null;
  /** Workspace plans: flat monthly base. Per-seat plans: null. */
  readonly basePrice: number | null;
  readonly includedSeats: number | null;
  readonly extraSeatPrice: number | null;
  readonly highlighted: boolean;
  readonly badge?: string;
  readonly trialAvailable: boolean;
  readonly contactOnly?: boolean;
  readonly ctaLabel: string;
}

export const CURRENCY = '₹';
export const MIN_SEATS = 10;
export const TRIAL_SEATS = 5;
export const TRIAL_DAYS = 14;
export const GST_PERCENT = 18;

export const PLANS: readonly Plan[] = Object.freeze([
  {
    code: 'basic_tracking',
    family: 'tracking',
    label: 'Basic',
    tagline: 'Tracking only',
    blurb: 'Evidence of work, attendance and leave — priced per person.',
    monthlyPerSeat: 399,
    yearlyPerSeat: 359,
    basePrice: null,
    includedSeats: null,
    extraSeatPrice: null,
    highlighted: false,
    trialAvailable: true,
    ctaLabel: 'Start free trial',
  },
  {
    code: 'advance_tracking',
    family: 'tracking',
    label: 'Advance',
    tagline: 'Tracking only',
    blurb: 'Adds activity classification, idle handling, breaks and chat.',
    monthlyPerSeat: 599,
    yearlyPerSeat: 539,
    basePrice: null,
    includedSeats: null,
    extraSeatPrice: null,
    highlighted: true,
    badge: 'Most popular',
    trialAvailable: false,
    ctaLabel: 'Get started',
  },
  {
    code: 'basic_payroll',
    family: 'payroll',
    label: 'Basic',
    tagline: 'Payroll + tracking',
    blurb: 'The full chain: tracked hours become the payroll run, statutory and bank file.',
    monthlyPerSeat: null,
    yearlyPerSeat: null,
    basePrice: 3999,
    includedSeats: 50,
    extraSeatPrice: 79,
    highlighted: false,
    trialAvailable: true,
    ctaLabel: 'Start free trial',
  },
  {
    code: 'professional_payroll',
    family: 'payroll',
    label: 'Professional',
    tagline: 'Payroll + tracking',
    blurb: 'Adds custom roles, performance, asset tracking and advanced reporting.',
    monthlyPerSeat: null,
    yearlyPerSeat: null,
    basePrice: 5999,
    includedSeats: 50,
    extraSeatPrice: 119,
    highlighted: true,
    badge: 'Full suite',
    trialAvailable: false,
    ctaLabel: 'Get started',
  },
  {
    code: 'enterprise',
    family: 'payroll',
    label: 'Enterprise',
    tagline: 'Custom',
    blurb: 'Custom integrations and commercial terms, agreed in writing.',
    monthlyPerSeat: null,
    yearlyPerSeat: null,
    basePrice: null,
    includedSeats: null,
    extraSeatPrice: null,
    highlighted: false,
    badge: 'Custom',
    trialAvailable: false,
    contactOnly: true,
    ctaLabel: 'Contact sales',
  },
]);

/**
 * Monthly total for a plan at a given seat count.
 *
 * Reproduces calculateTotal() from the product byte for byte, including the
 * detail that a workspace plan's base fee is NOT prorated below its included
 * seat count — 12 employees on Basic Payroll still pay ₹3,999. The slider on
 * /pricing exists partly to make that visible rather than to hide it.
 */
export function monthlyTotal(plan: Plan, seats: number, cycle: BillingCycle): number {
  if (plan.contactOnly) return 0;

  if (plan.monthlyPerSeat !== null) {
    const perSeat = cycle === 'yearly' ? plan.yearlyPerSeat ?? plan.monthlyPerSeat : plan.monthlyPerSeat;
    return perSeat * seats;
  }

  const base = plan.basePrice ?? 0;
  const included = plan.includedSeats ?? 0;
  const extra = Math.max(0, seats - included);
  return base + extra * (plan.extraSeatPrice ?? 0);
}

/**
 * What each employee actually costs at this seat count.
 *
 * The honest counterpart to the headline. On a workspace plan below its
 * included seats this is much higher than the sticker — 20 people on Basic
 * Payroll is ₹200 per person, not ₹79 — and the page says so rather than
 * letting a buyer discover it at checkout.
 */
export function effectivePerEmployee(plan: Plan, seats: number, cycle: BillingCycle): number {
  if (plan.contactOnly || seats <= 0) return 0;
  return monthlyTotal(plan, seats, cycle) / seats;
}

/** True when the buyer is paying for seats they do not have. */
export function isPayingForEmptySeats(plan: Plan, seats: number): boolean {
  return plan.includedSeats !== null && seats < plan.includedSeats;
}

/** Seats needed before a workspace plan stops wasting money. */
export function breakEvenSeats(plan: Plan): number | null {
  return plan.includedSeats;
}

export function formatINR(amount: number, opts: { paise?: boolean } = {}): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: opts.paise ? 2 : 0,
    maximumFractionDigits: opts.paise ? 2 : 0,
  }).format(amount);
}

export function withGst(amount: number): number {
  return amount * (1 + GST_PERCENT / 100);
}

export const SEAT_SLIDER = Object.freeze({
  min: 10,
  max: 1000,
  /** Non-linear: most buyers live under 100, so give that range the travel. */
  stops: [10, 15, 20, 25, 30, 40, 50, 60, 75, 100, 125, 150, 200, 250, 300, 400, 500, 750, 1000],
});
