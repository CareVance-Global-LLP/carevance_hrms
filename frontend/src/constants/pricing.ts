import { salesContactEmail } from '@/lib/runtimeConfig';

export type PricingBillingCycle = 'monthly' | 'yearly';
export type SignupMode = 'trial' | 'paid';
export type PlanType = 'tracking' | 'payroll';

export interface PlanModule {
  name: string;
  icon: string;
  features: string[];
}

export interface PricingPlan {
  code: string;
  type: PlanType;
  label: string;
  tagline: string;
  shortDescription?: string;
  monthlyPrice: number | null;
  yearlyPrice: number | null;
  pricePerSeat: boolean;
  basePrice?: number;
  includedSeats?: number;
  extraSeatPrice?: number;
  modules: PlanModule[];
  features?: string[];
  ctaLabel: string;
  badge?: string;
  highlighted?: boolean;
  enterpriseContactOnly?: boolean;
  trialAvailable: boolean;
  minSeats?: number;
}

export const pricingUi = {
  trialBadge: '14-day free trial',
  noCardCopy: 'No credit card required initially',
  contactEmail: salesContactEmail,
};

export const PRICE_CURRENCY = '₹';
export const MIN_SEATS = 10;
export const TRIAL_SEATS = 5;

/* ── Module definitions per plan ── */

const trackingModules: PlanModule[] = [
  {
    name: 'Tracking Management',
    icon: 'Timer',
    features: [
      'Automatic Tracking',
      'Timeline',
      'Screenshots Online Tracking',
      'Screenshots Offline Tracking',
    ],
  },
  {
    name: 'Project & Task Management',
    icon: 'FolderKanban',
    features: [
      'Project Handling',
      'Task Handling',
    ],
  },
  {
    name: 'Team Management',
    icon: 'Users',
    features: [
      'Groups Assignment',
    ],
  },
  {
    name: 'Attendance Management',
    icon: 'CalendarClock',
    features: [
      'Attendance',
    ],
  },
  {
    name: 'Leave Management',
    icon: 'CalendarOff',
    features: [
      'Leave Management',
    ],
  },
  {
    name: 'Approval Management',
    icon: 'CheckCircle',
    features: [
      'Approval',
    ],
  },
  {
    name: 'Overtime Management',
    icon: 'Clock',
    features: [
      'Overtime',
    ],
  },
];

const advanceExtraModules: PlanModule[] = [
  {
    name: 'Activity Management',
    icon: 'Activity',
    features: [
      'Activity Summary',
    ],
  },
  {
    name: 'Break Management',
    icon: 'Coffee',
    features: [
      'Break Tracking',
    ],
  },
  {
    name: 'Notification Management',
    icon: 'Bell',
    features: [
      'Notification',
    ],
  },
  {
    name: 'Communication',
    icon: 'MessageSquare',
    features: [
      'Chat',
    ],
  },
  {
    name: 'Productivity Management',
    icon: 'TrendingUp',
    features: [
      'Idle Management',
      'Productive Ratings',
      'Web Usage Tracking',
      'Application Usage Tracking',
    ],
  },
  {
    name: 'Integration',
    icon: 'Plug',
    features: [
      'Open API Access',
      'AI Integration',
    ],
  },
  {
    name: 'Support',
    icon: 'Headphones',
    features: [
      '24hr Support',
    ],
  },
];

const basicPayrollModules: PlanModule[] = [
  ...trackingModules,
  {
    name: 'HRMS Core',
    icon: 'Building2',
    features: [
      'Organization Structure',
      'Document & Letter Submission',
      'Employee Onboarding',
      'Employee Profile Management',
      'Standard Access Roles',
      'Employee Resignation Management',
      'Shift Management',
    ],
  },
  {
    name: 'Payroll & Finance',
    icon: 'Wallet',
    features: [
      'Payroll Automation',
      'Statutory Compliance',
      'Bank Account Integration',
      'Loan & Salary Advance Management',
      'Expense Management',
      'Tax Management',
      'Gratuity Management',
    ],
  },
  {
    name: 'Communication & Engagement',
    icon: 'Megaphone',
    features: [
      'Announcements & Polls',
      'Public Press / Company News',
    ],
  },
  {
    name: 'Access & Integration',
    icon: 'Smartphone',
    features: [
      'Mobile App Access',
      'AI Integration',
    ],
  },
];

const professionalExtraModules: PlanModule[] = [
  {
    name: 'Advanced HRMS',
    icon: 'UserCheck',
    features: [
      'Custom Roles & Permissions',
      'Performance Management',
      'Pre-Boarding Management',
      'Recruitment Management (ATS)',
      'Asset Tracking',
    ],
  },
  {
    name: 'Advanced Analytics',
    icon: 'BarChart3',
    features: [
      'Advanced Reports & Analytics',
      'Employee Timeline',
    ],
  },
  {
    name: 'Travel & Expense',
    icon: 'MapPin',
    features: [
      'Travel & Expense Tracking',
    ],
  },
];

/* ── Plans ── */

export const pricingPlans: PricingPlan[] = [
  {
    code: 'basic_tracking',
    type: 'tracking',
    label: 'BASIC',
    tagline: 'Only Tracking',
    monthlyPrice: 399,
    yearlyPrice: 359,
    pricePerSeat: true,
    modules: trackingModules,
    ctaLabel: 'Get Started',
    trialAvailable: true,
  },
  {
    code: 'advance_tracking',
    type: 'tracking',
    label: 'ADVANCE',
    tagline: 'Only Tracking',
    monthlyPrice: 599,
    yearlyPrice: 539,
    pricePerSeat: true,
    modules: [...trackingModules, ...advanceExtraModules],
    ctaLabel: 'Get Started',
    badge: 'Most Popular',
    highlighted: true,
    trialAvailable: false,
  },
  {
    code: 'basic_payroll',
    type: 'payroll',
    label: 'BASIC',
    tagline: 'Tracker + Payroll',
    monthlyPrice: null,
    yearlyPrice: null,
    pricePerSeat: false,
    basePrice: 3999,
    includedSeats: 50,
    extraSeatPrice: 79,
    modules: basicPayrollModules,
    ctaLabel: 'Get Started',
    trialAvailable: false,
  },
  {
    code: 'professional_payroll',
    type: 'payroll',
    label: 'PROFESSIONAL',
    tagline: 'Tracker + Payroll',
    monthlyPrice: null,
    yearlyPrice: null,
    pricePerSeat: false,
    basePrice: 5999,
    includedSeats: 50,
    extraSeatPrice: 119,
    modules: [...basicPayrollModules, ...professionalExtraModules],
    ctaLabel: 'Get Started',
    badge: 'Full Suite',
    highlighted: true,
    trialAvailable: false,
  },
];

/* ── Pricing helpers ── */

export function getPricingPlan(code?: string | null) {
  return pricingPlans.find((plan) => plan.code === code) ?? pricingPlans[0];
}

export function getPerSeatPrice(plan: PricingPlan, billingCycle: PricingBillingCycle): number {
  if (!plan.pricePerSeat) return 0;
  return billingCycle === 'yearly' ? (plan.yearlyPrice ?? plan.monthlyPrice ?? 0) : (plan.monthlyPrice ?? 0);
}

export function calculateTotal(plan: PricingPlan, seats: number, billingCycle: PricingBillingCycle): number {
  if (plan.pricePerSeat) {
    const perSeat = getPerSeatPrice(plan, billingCycle);
    return perSeat * seats;
  }
  // Workspace plan: base + extra seats
  const base = plan.basePrice ?? 0;
  const included = plan.includedSeats ?? 50;
  const extra = Math.max(0, seats - included);
  const extraCost = extra * (plan.extraSeatPrice ?? 0);
  return base + extraCost;
}

export function getYearlySavingsPercent(plan: PricingPlan): number {
  if (!plan.pricePerSeat || !plan.monthlyPrice || !plan.yearlyPrice) return 0;
  return Math.round(((plan.monthlyPrice - plan.yearlyPrice) / plan.monthlyPrice) * 100);
}

export function buildCheckoutPath(planCode: string, billingCycle: PricingBillingCycle = 'monthly'): string {
  return `/checkout?plan=${planCode}&interval=${billingCycle}`;
}

export function buildUpgradePath(targetPlanCode: string, billingCycle: PricingBillingCycle = 'monthly'): string {
  return `/checkout?plan=${targetPlanCode}&interval=${billingCycle}&mode=upgrade`;
}

export function buildSignupQuery(planCode: string, mode: SignupMode, billingCycle: PricingBillingCycle = 'monthly', seats: number = MIN_SEATS) {
  return new URLSearchParams({
    plan: planCode,
    mode,
    interval: billingCycle,
    seats: String(seats),
  }).toString();
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
  const currentPrice = calculateTotal(currentPlan, seats, billingCycle) / (billingCycle === 'yearly' ? 12 : 1);
  const targetPrice = calculateTotal(targetPlan, seats, billingCycle) / (billingCycle === 'yearly' ? 12 : 1);
  const diffPerMonth = targetPrice - currentPrice;
  return diffPerMonth * monthsRemaining;
}

export function getMonthsRemaining(subscriptionExpiresAt: string | null, billingCycle: PricingBillingCycle): number {
  if (billingCycle === 'monthly') return 1;
  return 12;
}

/* ── Old exports for backward compatibility ── */

export const basicFeatures = trackingModules.flatMap((m) => m.features);
export const advancedOnlyFeatures = advanceExtraModules.flatMap((m) => m.features);
export const advancedFeatures = [...basicFeatures, ...advancedOnlyFeatures];

/** @deprecated Use getPerSeatPrice instead */
export function getPlanPrice(plan: PricingPlan, billingCycle: PricingBillingCycle) {
  return getPerSeatPrice(plan, billingCycle);
}

/** @deprecated Use getPerSeatPrice instead */
export function getPricePerUserPerMonth(plan: PricingPlan, billingCycle: PricingBillingCycle): number {
  return getPerSeatPrice(plan, billingCycle);
}

export const featureCategories = [
  {
    category: 'Tracking & Monitoring',
    features: [
      { name: 'Automatic Tracking', basic_tracking: true, advance_tracking: true, basic_payroll: true, professional_payroll: true },
      { name: 'Timeline', basic_tracking: true, advance_tracking: true, basic_payroll: true, professional_payroll: true },
      { name: 'Screenshots Online', basic_tracking: true, advance_tracking: true, basic_payroll: true, professional_payroll: true },
      { name: 'Screenshots Offline', basic_tracking: true, advance_tracking: true, basic_payroll: true, professional_payroll: true },
      { name: 'Screenshot Chat Monitoring', basic_tracking: false, advance_tracking: false, basic_payroll: false, professional_payroll: true },
    ],
  },
  {
    category: 'Project & Task',
    features: [
      { name: 'Project Handling', basic_tracking: true, advance_tracking: true, basic_payroll: true, professional_payroll: true },
      { name: 'Task Handling', basic_tracking: true, advance_tracking: true, basic_payroll: true, professional_payroll: true },
    ],
  },
  {
    category: 'Attendance & Leave',
    features: [
      { name: 'Attendance', basic_tracking: true, advance_tracking: true, basic_payroll: true, professional_payroll: true },
      { name: 'Leave Management', basic_tracking: true, advance_tracking: true, basic_payroll: true, professional_payroll: true },
      { name: 'Overtime', basic_tracking: true, advance_tracking: true, basic_payroll: true, professional_payroll: true },
      { name: 'Approval', basic_tracking: true, advance_tracking: true, basic_payroll: true, professional_payroll: true },
      { name: 'GPS Tracking', basic_tracking: false, advance_tracking: false, basic_payroll: false, professional_payroll: false },
    ],
  },
  {
    category: 'Activity & Productivity',
    features: [
      { name: 'Activity Summary', basic_tracking: false, advance_tracking: true, basic_payroll: false, professional_payroll: false },
      { name: 'Break Tracking', basic_tracking: false, advance_tracking: true, basic_payroll: false, professional_payroll: false },
      { name: 'Idle Management', basic_tracking: false, advance_tracking: true, basic_payroll: false, professional_payroll: false },
      { name: 'Productive Ratings', basic_tracking: false, advance_tracking: true, basic_payroll: false, professional_payroll: false },
      { name: 'Web Usage Tracking', basic_tracking: false, advance_tracking: true, basic_payroll: false, professional_payroll: false },
      { name: 'Application Usage Tracking', basic_tracking: false, advance_tracking: true, basic_payroll: false, professional_payroll: false },
    ],
  },
  {
    category: 'HRMS Core',
    features: [
      { name: 'Organization Structure', basic_tracking: false, advance_tracking: false, basic_payroll: true, professional_payroll: true },
      { name: 'Employee Onboarding', basic_tracking: false, advance_tracking: false, basic_payroll: true, professional_payroll: true },
      { name: 'Employee Profile Management', basic_tracking: false, advance_tracking: false, basic_payroll: true, professional_payroll: true },
      { name: 'Document & Letter Submission', basic_tracking: false, advance_tracking: false, basic_payroll: true, professional_payroll: true },
      { name: 'Standard Access Roles', basic_tracking: false, advance_tracking: false, basic_payroll: true, professional_payroll: true },
      { name: 'Custom Roles & Permissions', basic_tracking: false, advance_tracking: false, basic_payroll: false, professional_payroll: true },
      { name: 'Resignation Management', basic_tracking: false, advance_tracking: false, basic_payroll: true, professional_payroll: true },
      { name: 'Shift Management', basic_tracking: false, advance_tracking: false, basic_payroll: true, professional_payroll: true },
      { name: 'Performance Management', basic_tracking: false, advance_tracking: false, basic_payroll: false, professional_payroll: true },
      { name: 'Pre-Boarding Management', basic_tracking: false, advance_tracking: false, basic_payroll: false, professional_payroll: true },
      { name: 'Recruitment (ATS)', basic_tracking: false, advance_tracking: false, basic_payroll: false, professional_payroll: true },
      { name: 'Asset Tracking', basic_tracking: false, advance_tracking: false, basic_payroll: false, professional_payroll: true },
    ],
  },
  {
    category: 'Payroll & Finance',
    features: [
      { name: 'Payroll Automation', basic_tracking: false, advance_tracking: false, basic_payroll: true, professional_payroll: true },
      { name: 'Statutory Compliance', basic_tracking: false, advance_tracking: false, basic_payroll: true, professional_payroll: true },
      { name: 'Bank Account Integration', basic_tracking: false, advance_tracking: false, basic_payroll: true, professional_payroll: true },
      { name: 'Loan & Salary Advance', basic_tracking: false, advance_tracking: false, basic_payroll: true, professional_payroll: true },
      { name: 'Expense Management', basic_tracking: false, advance_tracking: false, basic_payroll: true, professional_payroll: true },
      { name: 'Travel & Expense Tracking', basic_tracking: false, advance_tracking: false, basic_payroll: false, professional_payroll: true },
      { name: 'Tax Management', basic_tracking: false, advance_tracking: false, basic_payroll: true, professional_payroll: true },
      { name: 'Gratuity Management', basic_tracking: false, advance_tracking: false, basic_payroll: true, professional_payroll: true },
    ],
  },
  {
    category: 'Communication & Engagement',
    features: [
      { name: 'Chat', basic_tracking: false, advance_tracking: true, basic_payroll: false, professional_payroll: false },
      { name: 'Notifications', basic_tracking: false, advance_tracking: true, basic_payroll: false, professional_payroll: false },
      { name: 'Announcements & Polls', basic_tracking: false, advance_tracking: false, basic_payroll: true, professional_payroll: true },
      { name: 'Public Press / Company News', basic_tracking: false, advance_tracking: false, basic_payroll: true, professional_payroll: true },
    ],
  },
  {
    category: 'Integration & Support',
    features: [
      { name: 'AI Integration', basic_tracking: false, advance_tracking: true, basic_payroll: true, professional_payroll: true },
      { name: 'Open API Access', basic_tracking: false, advance_tracking: true, basic_payroll: false, professional_payroll: false },
      { name: 'Mobile App Access', basic_tracking: false, advance_tracking: false, basic_payroll: true, professional_payroll: true },
      { name: '24hr Support', basic_tracking: false, advance_tracking: true, basic_payroll: false, professional_payroll: false },
      { name: 'Employee Timeline', basic_tracking: false, advance_tracking: false, basic_payroll: false, professional_payroll: true },
      { name: 'Advanced Reports & Analytics', basic_tracking: false, advance_tracking: false, basic_payroll: false, professional_payroll: true },
    ],
  },
];

export const pricingFaqs = [
  {
    question: 'How does the free trial work?',
    answer: 'You get 14 days of the Basic Tracking plan with 5 seats. No credit card required to start.',
  },
  {
    question: 'What is the difference between Tracking and Payroll plans?',
    answer: 'Tracking plans are per-user pricing focused on time tracking, screenshots, and productivity. Payroll plans include full HRMS with payroll automation, compliance, employee management, and all tracking features.',
  },
  {
    question: 'How is per-user pricing calculated for Tracking plans?',
    answer: 'Each Tracking plan has a per-user per-month price. You choose the number of seats during checkout. Annual billing gives you a 10% discount.',
  },
  {
    question: 'How is workspace pricing calculated for Payroll plans?',
    answer: 'Payroll plans have a base monthly price that includes 50 users. Additional users beyond 50 are charged per-user per-month.',
  },
  {
    question: 'Can I add more seats later?',
    answer: 'Yes. Visit Subscription settings in your workspace to add seats, upgrade your plan, or view your remaining seat count.',
  },
  {
    question: 'Can I upgrade from a Tracking plan to a Payroll plan?',
    answer: 'Yes. You can switch plans anytime from your subscription settings. The upgrade applies immediately with prorated billing.',
  },
];
