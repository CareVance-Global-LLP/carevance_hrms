import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import StatusBadge from '@/components/ui/StatusBadge';
import type { BillingSnapshot } from '@/types';
import SeatMeter from '@/features/billing/SeatMeter';
import CycleBar from '@/features/billing/CycleBar';
import RenewalBanner from '@/features/billing/RenewalBanner';
import { formatMoney, resolveRenewalNotice } from '@/features/billing/renewalState';
import SettingsCard from '../components/SettingsCard';

const STATE_TONE: Record<string, 'success' | 'info' | 'warning' | 'danger' | 'neutral'> = {
  active: 'success',
  trial: 'info',
  past_due: 'warning',
  expired: 'danger',
  cancelled: 'danger',
  inactive: 'neutral',
};

const STATE_LABEL: Record<string, string> = {
  active: 'Active',
  trial: 'Trial',
  past_due: 'Past due',
  expired: 'Expired',
  cancelled: 'Cancelled',
  inactive: 'Inactive',
};

export default function BillingPane({ snapshot }: { snapshot: BillingSnapshot | null }) {
  const plan = snapshot?.plan ?? null;
  const seats = snapshot?.seats ?? null;
  const cycle = snapshot?.cycle ?? null;
  const notice = resolveRenewalNotice(snapshot);
  const state = cycle?.state || plan?.status || 'trial';

  return (
    <div className="space-y-4">
      {notice ? <RenewalBanner notice={notice} /> : null}

      <SettingsCard
        title={plan?.name ? `${plan.name} plan` : 'Your plan'}
        description="Seats, renewal and invoices live in the billing workspace."
        aside={<StatusBadge tone={STATE_TONE[state] || 'neutral'}>{STATE_LABEL[state] || state}</StatusBadge>}
      >
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
              {cycle?.state === 'trial' ? 'Trial ends' : 'Renews'}
            </dt>
            <dd className="mt-1 text-lg font-semibold text-slate-900">
              {cycle?.period_end
                ? new Date(cycle.period_end).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
                : 'Not scheduled'}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
              {plan?.billing_cycle === 'yearly' ? 'Per year' : 'Per month'}
            </dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums text-slate-900">
              {plan?.renewal_amount ? formatMoney(plan.renewal_amount) : '—'}
            </dd>
          </div>
        </dl>

        {cycle ? (
          <div className="mt-5">
            <CycleBar cycle={cycle} />
          </div>
        ) : null}

        <Link
          to="/settings/billing"
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-on-brand transition hover:bg-blue-500"
        >
          Manage subscription <ArrowRight className="h-4 w-4" />
        </Link>
      </SettingsCard>

      {seats ? (
        <SettingsCard
          title="Seats"
          description="Every person with a login holds a seat, including admins."
          aside={
            seats.is_over_cap ? (
              <StatusBadge tone="danger">{seats.over_by} over cap</StatusBadge>
            ) : seats.max > 0 && seats.remaining <= 0 ? (
              <StatusBadge tone="warning">At capacity</StatusBadge>
            ) : seats.max > 0 ? (
              <StatusBadge tone="success">{seats.remaining} available</StatusBadge>
            ) : (
              <StatusBadge tone="neutral">No cap set</StatusBadge>
            )
          }
        >
          <SeatMeter used={seats.used} max={seats.max} />
        </SettingsCard>
      ) : null}
    </div>
  );
}
