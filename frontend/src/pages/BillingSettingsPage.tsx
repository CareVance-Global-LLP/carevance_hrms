import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  CreditCard,
  Mail,
  Receipt,
  RefreshCw,
  Users,
} from 'lucide-react';
import PageHeader from '@/components/dashboard/PageHeader';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import StatusBadge from '@/components/ui/StatusBadge';
import Button from '@/components/ui/Button';
import { FeedbackBanner, PageErrorState, PageLoadingState } from '@/components/ui/PageState';
import { ToggleInput } from '@/components/ui/FormField';
import { useToast } from '@/components/ui/Toast';
import { billingApi } from '@/services/api';
import type { BillingSnapshot } from '@/types';
import { getPricingPlan, getPricePerUserPerMonth, PricingBillingCycle } from '@/constants/pricing';
import { pricingUi, buildUpgradePath } from '@/constants/pricing';
import SeatMeter from '@/features/billing/SeatMeter';
import CycleBar from '@/features/billing/CycleBar';
import RenewalBanner from '@/features/billing/RenewalBanner';
import { formatMoney, resolveRenewalNotice } from '@/features/billing/renewalState';
import SeatDialog from '@/features/billing/SeatDialog';
import CancelPlanDialog from '@/features/billing/CancelPlanDialog';

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

export default function BillingSettingsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [seatDialog, setSeatDialog] = useState<'add' | 'reduce' | null>(null);
  const [showCancel, setShowCancel] = useState(false);

  const { data: snapshot, isLoading, error } = useQuery<BillingSnapshot>({
    queryKey: ['billing-snapshot'],
    queryFn: async () => (await billingApi.current()).data,
    retry: false,
  });

  const autoRenewMutation = useMutation({
    mutationFn: (next: boolean) => billingApi.setAutoRenew(next),
    onSuccess: (response) => {
      toast.show({
        kind: response.data.requires_mandate ? 'info' : 'success',
        message: response.data.message || 'Renewal preference saved.',
      });
      void queryClient.invalidateQueries({ queryKey: ['billing-snapshot'] });
    },
    onError: (e: any) => {
      toast.show({ kind: 'error', message: e?.response?.data?.message || 'Could not save that preference.' });
    },
  });

  const notice = useMemo(() => resolveRenewalNotice(snapshot ?? null), [snapshot]);

  if (isLoading) {
    return <PageLoadingState label="Loading billing details..." />;
  }

  if (error) {
    return <PageErrorState message={(error as any)?.response?.data?.message || 'Unable to load billing details right now.'} />;
  }

  const plan = snapshot?.plan;
  const workspace = snapshot?.workspace;
  // Both numbers come from the snapshot that was just fetched. Reading the cap
  // from the cached organization is what produced "86 / 5": two sources of
  // truth, and the stale one won the denominator.
  const seats = snapshot?.seats;
  const cycle = snapshot?.cycle;

  if (!plan) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Billing" title="Workspace billing" description="Plan, seats and renewal for this workspace." />
        <FeedbackBanner tone="error" message="No billing data is available for this workspace yet." />
      </div>
    );
  }

  const planCode = plan.code || 'basic_tracking';
  const selectedPlan = getPricingPlan(planCode);
  const billingCycle = (plan.billing_cycle as PricingBillingCycle) || 'monthly';
  const pricePerSeat = plan.price_per_seat || getPricePerUserPerMonth(selectedPlan, billingCycle);
  const state = cycle?.state || plan.status;
  const isTrial = state === 'trial';
  const usedSeats = seats?.used ?? plan.used_seats ?? 0;
  const maxSeats = seats?.max ?? plan.max_seats ?? 0;
  const isOverCap = seats?.is_over_cap ?? false;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Billing"
        title="Workspace billing"
        description="Plan, seats and renewal for this workspace."
        actions={
          <Link
            to="/pricing"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-surface-card px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-blue-400"
          >
            Compare plans <ArrowRight className="h-4 w-4" />
          </Link>
        }
      />

      {notice ? <RenewalBanner notice={notice} /> : null}

      <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-4">
          {/* ---- plan + cycle ---- */}
          <SurfaceCard className="p-5">
            <div className="flex flex-wrap items-start gap-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-blue-50 text-blue-700">
                <CreditCard className="h-5 w-5" />
              </span>
              <div className="min-w-[12rem] flex-1">
                <h2 className="text-xl font-semibold tracking-tight text-slate-950">{plan.name}</h2>
                <p className="mt-1 max-w-lg text-xs leading-5 text-slate-600">
                  {plan.description || selectedPlan.shortDescription}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xl font-semibold tabular-nums text-slate-950">
                  {plan.renewal_amount ? formatMoney(plan.renewal_amount) : '—'}
                </p>
                <p className="text-xs text-slate-600">
                  per {billingCycle === 'yearly' ? 'year' : 'month'} · {maxSeats} seat{maxSeats === 1 ? '' : 's'}
                </p>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <StatusBadge tone={STATE_TONE[state] || 'neutral'}>{STATE_LABEL[state] || state}</StatusBadge>
              <StatusBadge tone="neutral">{billingCycle}</StatusBadge>
              {pricePerSeat ? (
                <StatusBadge tone="neutral">
                  ₹{pricePerSeat} / seat / month
                </StatusBadge>
              ) : null}
            </div>

            {cycle ? (
              <div className="mt-5">
                <CycleBar cycle={cycle} />
              </div>
            ) : null}
          </SurfaceCard>

          {/* ---- seats ---- */}
          <SurfaceCard className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Seats</h3>
                <p className="mt-1 text-xs text-slate-600">
                  Every person with a login holds a seat, including admins.
                </p>
              </div>
              {isOverCap ? (
                <StatusBadge tone="danger">{seats?.over_by} over cap</StatusBadge>
              ) : maxSeats > 0 && usedSeats >= maxSeats ? (
                <StatusBadge tone="warning">At capacity</StatusBadge>
              ) : maxSeats > 0 ? (
                <StatusBadge tone="success">{maxSeats - usedSeats} available</StatusBadge>
              ) : (
                <StatusBadge tone="neutral">No cap set</StatusBadge>
              )}
            </div>

            <div className="mt-4">
              <SeatMeter used={usedSeats} max={maxSeats} />
            </div>

            <p className="mt-3 max-w-xl text-xs leading-5 text-slate-600">
              {isOverCap ? (
                <>
                  This workspace is <span className="font-semibold text-rose-700">{seats?.over_by} seats over</span> what
                  it pays for. Everyone already here keeps their access — the cap now applies to the next person added,
                  who will be refused until it is raised.
                </>
              ) : maxSeats > 0 && usedSeats >= maxSeats ? (
                <>Every paid seat is taken. The next person you add will be refused until you raise the cap.</>
              ) : (
                <>Raising the cap is charged for the rest of this cycle. Reducing it takes effect at the next renewal, and cannot go below the people already here.</>
              )}
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={() => setSeatDialog('add')} iconLeft={<Users className="h-4 w-4" />}>
                {isOverCap ? `Raise cap to ${usedSeats}` : 'Add seats'}
              </Button>
              {!isTrial ? (
                <Button variant="secondary" onClick={() => setSeatDialog('reduce')}>
                  Reduce seats
                </Button>
              ) : null}
            </div>
          </SurfaceCard>
        </div>

        <div className="space-y-4">
          {/* ---- renewal ---- */}
          <SurfaceCard className="p-5">
            <h3 className="text-sm font-semibold text-slate-900">Renewal</h3>

            <div className="mt-4 flex items-center gap-3 border-t border-slate-200 pt-3 first:border-t-0">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-surface-sunken text-slate-600">
                <RefreshCw className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-900">Auto-renew</p>
                <p className="mt-0.5 text-xs leading-5 text-slate-600">
                  {cycle?.auto_renew
                    ? cycle.has_mandate
                      ? 'We will charge your saved mandate on the renewal date.'
                      : 'On, but no payment mandate is set up yet — we will remind you to pay instead.'
                    : 'Charge automatically on the renewal date instead of reminding you.'}
                </p>
              </div>
              <ToggleInput
                checked={Boolean(cycle?.auto_renew)}
                disabled={autoRenewMutation.isPending}
                onChange={(next) => autoRenewMutation.mutate(next)}
              />
            </div>

            <div className="flex items-center gap-3 border-t border-slate-200 py-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-surface-sunken text-slate-600">
                <Mail className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-900">Reminders</p>
                <p className="mt-0.5 text-xs leading-5 text-slate-600">
                  {(cycle?.reminder_stages || [7, 3, 1]).join(', ')} days before renewal, to workspace admins.
                </p>
              </div>
              <StatusBadge tone="success">On</StatusBadge>
            </div>
          </SurfaceCard>

          {/* ---- workspace ---- */}
          <SurfaceCard className="p-5">
            <h3 className="text-sm font-semibold text-slate-900">Workspace</h3>
            <dl className="mt-4 space-y-3">
              <div>
                <dt className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Name</dt>
                <dd className="mt-0.5 text-sm font-semibold text-slate-900">{workspace?.name || 'Current workspace'}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Address</dt>
                <dd className="mt-0.5 text-sm text-slate-700">{workspace?.slug || 'No slug available'}</dd>
              </div>
            </dl>
          </SurfaceCard>

          {/* ---- manage ---- */}
          <SurfaceCard className="p-5">
            <h3 className="text-sm font-semibold text-slate-900">Manage</h3>
            <div className="mt-2">
              {isTrial ? (
                <Link
                  to={buildUpgradePath('basic_tracking', billingCycle)}
                  className="flex items-center justify-between gap-3 border-t border-slate-200 py-3 text-sm font-medium text-slate-900 transition hover:text-blue-700"
                >
                  Upgrade to a paid plan <ArrowRight className="h-4 w-4" />
                </Link>
              ) : (
                <>
                  {(planCode === 'basic_tracking' || planCode === 'basic') && (
                    <Link
                      to={buildUpgradePath('advance_tracking', billingCycle)}
                      className="flex items-center justify-between gap-3 border-t border-slate-200 py-3 text-sm font-medium text-slate-900 transition hover:text-blue-700"
                    >
                      Upgrade to Advance Tracking <ArrowRight className="h-4 w-4" />
                    </Link>
                  )}
                  {(planCode === 'advance_tracking' || planCode === 'advanced_tracker') && (
                    <Link
                      to={buildUpgradePath('basic_tracking', billingCycle)}
                      className="flex items-center justify-between gap-3 border-t border-slate-200 py-3 text-sm font-medium text-slate-900 transition hover:text-blue-700"
                    >
                      Downgrade to Basic Tracking <ArrowRight className="h-4 w-4" />
                    </Link>
                  )}
                </>
              )}

              <Link
                to="/settings/billing"
                className="flex items-center justify-between gap-3 border-t border-slate-200 py-3 text-sm font-medium text-slate-900 transition hover:text-blue-700"
              >
                <span className="flex items-center gap-2">
                  <Receipt className="h-4 w-4 text-slate-600" /> Payment history
                </span>
                <span className="text-xs text-slate-600">In the payment screen</span>
              </Link>

              <a
                href={`mailto:${pricingUi.contactEmail}?subject=CareVance%20Billing%20Support`}
                className="flex items-center justify-between gap-3 border-t border-slate-200 py-3 text-sm font-medium text-slate-900 transition hover:text-blue-700"
              >
                Contact sales <Mail className="h-4 w-4" />
              </a>

              {!isTrial ? (
                <button
                  type="button"
                  onClick={() => setShowCancel(true)}
                  className="flex w-full items-center justify-between gap-3 border-t border-slate-200 py-3 text-left text-sm font-medium text-rose-700 transition hover:text-rose-800"
                >
                  Cancel plan <AlertTriangle className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          </SurfaceCard>
        </div>
      </div>

      {seatDialog ? (
        <SeatDialog
          mode={seatDialog}
          usedSeats={usedSeats}
          maxSeats={maxSeats}
          minAllowed={seats?.min_allowed ?? usedSeats}
          pricePerSeat={pricePerSeat}
          billingCycle={billingCycle}
          planLabel={plan.name}
          onClose={() => setSeatDialog(null)}
          onAdded={() => navigate('/payment?add-seats=true', { replace: true })}
          onReduced={() => {
            setSeatDialog(null);
            void queryClient.invalidateQueries({ queryKey: ['billing-snapshot'] });
          }}
        />
      ) : null}

      {showCancel ? (
        <CancelPlanDialog
          planLabel={plan.name}
          periodEnd={cycle?.period_end}
          onClose={() => setShowCancel(false)}
          onCancelled={() => {
            setShowCancel(false);
            void queryClient.invalidateQueries({ queryKey: ['billing-snapshot'] });
          }}
        />
      ) : null}
    </div>
  );
}
