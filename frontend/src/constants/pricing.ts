import { salesContactEmail } from '@/lib/runtimeConfig';

export type PricingBillingCycle = 'monthly' | 'yearly';
export type SignupMode = 'trial' | 'paid';

export interface PricingPlan {
  code: 'basic' | 'advanced_tracker' | 'enterprise';
  label: string;
  shortDescription: string;
  monthlyPrice: string | null;
  yearlyPrice: string | null;
  features: string[];
  ctaLabel: string;
  badge?: string;
  enterpriseContactOnly: boolean;
  trialAvailable: boolean;
  minSeats: number;
}

export const pricingUi = {
  trialBadge: '14-day free trial',
  noCardCopy: 'No credit card required initially',
  contactEmail: salesContactEmail,
};

export const PRICE_CURRENCY = '₹';
export const MIN_SEATS = 10;
export const TRIAL_SEATS = 5;

export const basicFeatures = [
  'Desktop timer app',
  'Check-in / check-out',
  'Idle detection and auto-stop',
  'Screenshot capture and viewer history',
  'Reports module with CSV export',
  'User and role management',
  'Overtime calculation and history',
  'Approval workflow',
  'Workspace onboarding and invites',
  'Multi-role access',
];

export const advancedOnlyFeatures = [
  'Chat module',
  'Geo-fencing',
  'Leave application and approval workflow',
  'Employee timeline',
  'Project tracking',
  'Task tracking',
];

export const advancedFeatures = [
  ...basicFeatures,
  ...advancedOnlyFeatures,
];

export const pricingPlans: PricingPlan[] = [
  {
    code: 'basic',
    label: 'Basic',
    shortDescription: 'Core monitoring, attendance, and reporting for growing teams.',
    monthlyPrice: '₹300',
    yearlyPrice: '₹270',
    features: basicFeatures,
    ctaLabel: 'Buy Now',
    badge: 'Most popular',
    enterpriseContactOnly: false,
    trialAvailable: true,
    minSeats: MIN_SEATS,
  },
  {
    code: 'advanced_tracker',
    label: 'Advanced Tracker',
    shortDescription: 'Advanced monitoring, communication, and project management features for scaling teams.',
    monthlyPrice: '₹450',
    yearlyPrice: '₹400',
    features: advancedFeatures,
    ctaLabel: 'Buy Now',
    enterpriseContactOnly: false,
    trialAvailable: false,
    minSeats: MIN_SEATS,
  },
  {
    code: 'enterprise',
    label: 'Enterprise',
    shortDescription: 'For larger organizations that want custom rollout planning, controls, and guided onboarding.',
    monthlyPrice: null,
    yearlyPrice: null,
    features: [
      'Custom rollout and onboarding support',
      'Priority implementation planning',
      'Flexible billing and procurement support',
      'Enterprise contact and expansion workflows',
    ],
    ctaLabel: 'Contact Sales',
    badge: 'Custom rollout',
    enterpriseContactOnly: true,
    trialAvailable: false,
    minSeats: MIN_SEATS,
  },
];

export const freeTrial = {
  label: 'Start Free Trial',
  shortDescription: '14 days free. Basic plan with 5 seats.',
  ctaLabel: 'Start Free Trial',
  planCode: 'basic' as const,
  seats: 5,
  trialDays: 14,
};

export const pricingFaqs = [
  {
    question: 'How does the free trial work?',
    answer: 'You get 14 days of the Basic plan with 5 seats. Screenshot features are disabled during trial — upgrade to access them. No credit card required to start.',
  },
  {
    question: 'How is per-user pricing calculated?',
    answer: 'Each plan has a per-user per-month price. You choose the number of seats (minimum 10) during checkout. Annual billing gives you a discounted per-user rate.',
  },
  {
    question: 'Can I add more seats later?',
    answer: 'Yes. Visit Subscription settings in your workspace to add seats, upgrade your plan, or view your remaining seat count.',
  },
  {
    question: 'Do invited employees count toward my seat limit?',
    answer: 'Yes. Every active user in your workspace uses one seat. If you hit your seat limit, you\'ll need to add more seats before inviting new members.',
  },
  {
    question: 'Can I upgrade from Basic to Advanced Tracker?',
    answer: 'Yes. You can switch plans anytime from your subscription settings. The upgrade applies immediately.',
  },
];

export function getPricingPlan(code?: string | null) {
  return pricingPlans.find((plan) => plan.code === code) ?? pricingPlans[0];
}

export function getPlanPrice(plan: PricingPlan, billingCycle: PricingBillingCycle) {
  return billingCycle === 'yearly' ? plan.yearlyPrice : plan.monthlyPrice;
}

export function getPricePerUserPerMonth(plan: PricingPlan, billingCycle: PricingBillingCycle): number {
  const priceStr = getPlanPrice(plan, billingCycle) || '0';
  return parseInt(priceStr.replace(/[^0-9]/g, ''), 10) || 0;
}

export function calculateTotal(plan: PricingPlan, seats: number, billingCycle: PricingBillingCycle): number {
  const monthly = getPricePerUserPerMonth(plan, billingCycle) * seats;
  return billingCycle === 'yearly' ? monthly * 12 : monthly;
}

export function buildSignupQuery(planCode: string, mode: SignupMode, billingCycle: PricingBillingCycle = 'monthly', seats: number = MIN_SEATS) {
  return new URLSearchParams({
    plan: planCode,
    mode,
    interval: billingCycle,
    seats: String(seats),
  }).toString();
}

export function buildCheckoutPath(planCode: string, billingCycle: PricingBillingCycle = 'monthly'): string {
  return `/checkout?plan=${planCode}&interval=${billingCycle}`;
}

export function buildUpgradePath(targetPlanCode: string, billingCycle: PricingBillingCycle = 'monthly'): string {
  return `/checkout?plan=${targetPlanCode}&interval=${billingCycle}&mode=upgrade`;
}

export function calculateUpgradeCost(
  currentPlan: PricingPlan,
  targetPlan: PricingPlan,
  seats: number,
  billingCycle: PricingBillingCycle,
  isTrial: boolean,
  monthsRemaining: number = 1,
  currentMaxSeats: number = 10
): number {
  if (isTrial) {
    return calculateTotal(targetPlan, seats, billingCycle);
  }
  const currentPrice = getPricePerUserPerMonth(currentPlan, billingCycle);
  const targetPrice = getPricePerUserPerMonth(targetPlan, billingCycle);
  const diffPerUserPerMonth = targetPrice - currentPrice;
  
  const existingSeats = Math.min(seats, currentMaxSeats);
  const newSeats = Math.max(0, seats - currentMaxSeats);
  
  const existingSeatsCost = diffPerUserPerMonth * existingSeats * monthsRemaining;
  const newSeatsCost = targetPrice * newSeats * monthsRemaining;
  
  return existingSeatsCost + newSeatsCost;
}

export function getMonthsRemaining(subscriptionExpiresAt: string | null, billingCycle: PricingBillingCycle): number {
  if (!subscriptionExpiresAt) return 1;
  const expires = new Date(subscriptionExpiresAt);
  const now = new Date();
  const diffMs = expires.getTime() - now.getTime();
  const diffDays = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
  if (billingCycle === 'yearly') {
    return Math.max(1, Math.ceil(diffDays / 30));
  }
  return Math.max(1, Math.ceil(diffDays / 30));
}
