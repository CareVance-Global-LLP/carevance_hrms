import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CalendarClock, CreditCard, Mail, Users } from 'lucide-react';
import PageHeader from '@/components/dashboard/PageHeader';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import StatusBadge from '@/components/ui/StatusBadge';
import { FeedbackBanner, PageErrorState, PageLoadingState } from '@/components/ui/PageState';
import { billingApi } from '@/services/api';
import { BillingSnapshot } from '@/types';
import { getPricingPlan, PricingBillingCycle } from '@/constants/pricing';
import { pricingUi } from '@/constants/pricing';
import { usePlan } from '@/hooks/usePlan';
import { buildUpgradePath } from '@/constants/pricing';

export default function BillingSettingsPage() {
  const [snapshot, setSnapshot] = useState<BillingSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const { planCode, maxSeats } = usePlan();

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      setError('');

      try {
        const response = await billingApi.current();
        setSnapshot(response.data);
      } catch (requestError: any) {
        setError(requestError?.response?.data?.message || 'Unable to load billing details right now.');
      } finally {
        setIsLoading(false);
      }
    };

    void load();
  }, []);

  if (isLoading) {
    return <PageLoadingState label="Loading billing details..." />;
  }

  if (error) {
    return <PageErrorState message={error} />;
  }

  const plan = snapshot?.plan;
  const workspace = snapshot?.workspace;
  const usedSeats = plan?.used_seats ?? 0;
  const remainingSeats = maxSeats - usedSeats;
  const selectedPlan = getPricingPlan(planCode);
  const isTrial = plan?.status === 'trial';

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Billing"
        title="Workspace Billing"
        description="Review current plan, seat usage, and upgrade paths for your workspace."
      />

      {!plan ? (
        <FeedbackBanner tone="error" message="No billing data is available for this workspace yet." />
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-4">
            <SurfaceCard className="p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-[18px] bg-sky-50 text-sky-700">
                  <CreditCard className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Current plan</p>
                  <p className="mt-1 text-lg font-semibold text-slate-950">{plan.name}</p>
                </div>
              </div>
            </SurfaceCard>
            <SurfaceCard className="p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Subscription status</p>
              <div className="mt-3">
                <StatusBadge tone={plan.status === 'trial' ? 'success' : plan.status === 'active' ? 'info' : 'warning'}>{plan.status}</StatusBadge>
              </div>
              <p className="mt-3 text-sm text-slate-500">Intent: {plan.subscription_intent || 'n/a'}</p>
            </SurfaceCard>
            <SurfaceCard className="p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-[18px] bg-emerald-50 text-emerald-700">
                  <CalendarClock className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                    {plan.is_trial ? 'Trial end date' : 'Renewal date'}
                  </p>
                  <p className="mt-1 text-lg font-semibold text-slate-950">
                    {plan.trial_end_date || plan.renewal_date ? new Date(plan.trial_end_date || plan.renewal_date || '').toLocaleDateString() : 'Not set'}
                  </p>
                </div>
              </div>
            </SurfaceCard>
            <SurfaceCard className="p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-[18px] bg-violet-50 text-violet-700">
                  <Users className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Seats</p>
                  <p className="mt-1 text-lg font-semibold text-slate-950">{usedSeats} / {maxSeats}</p>
                  <p className="mt-1 text-sm text-slate-500">{remainingSeats > 0 ? `${remainingSeats} available` : 'Full'}</p>
                </div>
              </div>
            </SurfaceCard>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
            <SurfaceCard className="p-6">
              <h2 className="text-lg font-semibold text-slate-950">Workspace Snapshot</h2>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <div className="rounded-[22px] border border-slate-200/85 bg-slate-50/80 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Workspace</p>
                  <p className="mt-2 text-base font-semibold text-slate-950">{workspace?.name || 'Current workspace'}</p>
                  <p className="mt-1 text-sm text-slate-500">{workspace?.slug || 'No slug available'}</p>
                </div>
                <div className="rounded-[22px] border border-slate-200/85 bg-slate-50/80 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Billing cycle</p>
                  <p className="mt-2 text-base font-semibold capitalize text-slate-950">{plan.billing_cycle || 'monthly'}</p>
                  <p className="mt-1 text-sm text-slate-500">{plan.description || selectedPlan.shortDescription}</p>
                </div>
              </div>
            </SurfaceCard>

            <SurfaceCard className="p-6">
              <h2 className="text-lg font-semibold text-slate-950">Actions</h2>
              <div className="mt-5 space-y-3">
                {isTrial ? (
                  <>
                    <p className="text-sm text-slate-600">Your trial is active. Upgrade to a paid plan to continue with full features.</p>
                    <Link
                      to={buildUpgradePath('basic', (plan.billing_cycle as PricingBillingCycle) || 'monthly')}
                      className="flex items-center justify-between rounded-[22px] border border-sky-200/90 bg-sky-50/80 px-4 py-4 text-sm font-semibold text-sky-800 transition hover:-translate-y-0.5 hover:border-sky-600"
                    >
                      Upgrade Plan
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </>
                ) : (
                  <>
                    <Link
                      to="/pricing"
                      className="flex items-center justify-between rounded-[22px] border border-slate-200/90 bg-white/90 px-4 py-4 text-sm font-semibold text-slate-800 transition hover:-translate-y-0.5 hover:border-slate-950"
                    >
                      Compare plans
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                    <a
                      href={`mailto:${pricingUi.contactEmail}?subject=CareVance%20Billing%20Support`}
                      className="flex items-center justify-between rounded-[22px] border border-slate-200/90 bg-white/90 px-4 py-4 text-sm font-semibold text-slate-800 transition hover:-translate-y-0.5 hover:border-slate-950"
                    >
                      Contact sales
                      <Mail className="h-4 w-4" />
                    </a>
                  </>
                )}
              </div>
            </SurfaceCard>
          </div>
        </>
      )}
    </div>
  );
}
