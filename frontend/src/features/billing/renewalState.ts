import type { BillingSnapshot } from '@/types';

export type RenewalTone = 'ok' | 'closing' | 'past_due' | 'expired';

export interface RenewalNotice {
  tone: RenewalTone;
  title: string;
  body: string;
  /** Label for the primary action, or null when there is nothing to do. */
  action: string | null;
}

const formatDate = (value?: string | null) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

export const formatMoney = (amount: number) => `₹${Math.round(amount).toLocaleString('en-IN')}`;

/**
 * One place decides what a subscription state means in words, so the banner in
 * the app shell and the billing page cannot describe the same situation
 * differently.
 *
 * Returns null when there is nothing worth interrupting anyone about.
 */
export function resolveRenewalNotice(snapshot: BillingSnapshot | null): RenewalNotice | null {
  const cycle = snapshot?.cycle;
  const plan = snapshot?.plan;
  if (!cycle || !plan) {
    return null;
  }

  const renewalDate = formatDate(cycle.period_end);
  const seats = snapshot?.seats?.max ?? plan.max_seats ?? 0;
  const amount = plan.renewal_amount ? formatMoney(plan.renewal_amount) : null;
  const cost = amount ? `${amount} for ${seats} seat${seats === 1 ? '' : 's'}` : `${seats} seat${seats === 1 ? '' : 's'}`;

  if (cycle.state === 'expired') {
    return {
      tone: 'expired',
      title: 'This workspace is read-only',
      body: 'Everyone can still sign in and read, but tracking, payroll and exports are paused. Your data is untouched and returns the moment payment clears.',
      action: 'Reactivate',
    };
  }

  if (cycle.state === 'past_due') {
    const left = cycle.grace_days_left ?? 0;
    return {
      tone: 'past_due',
      title: left > 0
        ? `Payment is overdue — ${left} day${left === 1 ? '' : 's'} of grace left`
        : 'Payment is overdue — grace ends today',
      body: `Everything still works until ${formatDate(cycle.grace_ends_at) || 'the grace period ends'}. After that the workspace becomes read-only until payment clears. Nothing is deleted.`,
      action: amount ? `Pay ${amount}` : 'Pay now',
    };
  }

  const daysRemaining = cycle.days_remaining;
  const warnAt = cycle.reminder_stages?.[0] ?? 7;

  if (typeof daysRemaining === 'number' && daysRemaining >= 0 && daysRemaining <= warnAt) {
    const isTrial = cycle.state === 'trial';
    return {
      tone: 'closing',
      title: daysRemaining === 0
        ? `Your ${plan.name} plan ${isTrial ? 'trial ends' : 'renews'} today`
        : `Your ${plan.name} plan ${isTrial ? 'trial ends' : 'renews'} in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}`,
      body: cycle.auto_renew && cycle.has_mandate
        ? `${cost} on ${renewalDate}. Auto-renew is on, so this will be charged automatically.`
        : `${cost} on ${renewalDate}. Auto-renew is off, so it will not be charged automatically.`,
      action: cycle.auto_renew && cycle.has_mandate ? null : 'Pay now',
    };
  }

  return null;
}
