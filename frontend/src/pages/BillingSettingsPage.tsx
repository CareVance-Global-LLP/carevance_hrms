import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, CalendarClock, CreditCard, Mail, Users, Plus, X, Loader2, Minus } from 'lucide-react';
import PageHeader from '@/components/dashboard/PageHeader';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import StatusBadge from '@/components/ui/StatusBadge';
import { FeedbackBanner, PageErrorState, PageLoadingState } from '@/components/ui/PageState';
import { billingApi } from '@/services/api';
import { BillingSnapshot } from '@/types';
import { getPricingPlan, getPricePerUserPerMonth, PricingBillingCycle, MIN_SEATS } from '@/constants/pricing';
import { pricingUi } from '@/constants/pricing';
import { usePlan } from '@/hooks/usePlan';
import { buildUpgradePath } from '@/constants/pricing';

export default function BillingSettingsPage() {
  const [snapshot, setSnapshot] = useState<BillingSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const { planCode, maxSeats } = usePlan();
  const navigate = useNavigate();

  const [showAddSeatsModal, setShowAddSeatsModal] = useState(false);
  const [seatsToAdd, setSeatsToAdd] = useState(1);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingError, setProcessingError] = useState('');

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
  const billingCycle = (plan?.billing_cycle as PricingBillingCycle) || 'monthly';
  const pricePerUser = getPricePerUserPerMonth(selectedPlan, billingCycle);
  const totalMonths = billingCycle === 'yearly' ? 12 : 1;
  const addSeatsCost = seatsToAdd * pricePerUser * totalMonths;

  const handleAddSeats = async () => {
    setIsProcessing(true);
    setProcessingError('');

    try {
      await billingApi.addSeats({
        seats: maxSeats + seatsToAdd,
        billing_cycle: billingCycle,
      });

      navigate('/payment?add-seats=true', { replace: true });
    } catch (err: any) {
      setProcessingError(err?.response?.data?.message || 'Failed to add seats. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

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
                <button
                  onClick={() => setShowAddSeatsModal(true)}
                  className="flex w-full items-center justify-between rounded-[22px] border border-emerald-200/90 bg-emerald-50/80 px-4 py-4 text-sm font-semibold text-emerald-800 transition hover:-translate-y-0.5 hover:border-emerald-600"
                >
                  Add Seats
                  <Plus className="h-4 w-4" />
                </button>

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
                    {planCode === 'basic' && (
                      <Link
                        to={buildUpgradePath('advanced_tracker', (plan.billing_cycle as PricingBillingCycle) || 'monthly')}
                        className="flex items-center justify-between rounded-[22px] border border-sky-200/90 bg-sky-50/80 px-4 py-4 text-sm font-semibold text-sky-800 transition hover:-translate-y-0.5 hover:border-sky-600"
                      >
                        Upgrade to Advanced Tracker
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    )}
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

      {showAddSeatsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-md rounded-[28px] border border-slate-200/80 bg-white p-6 shadow-[0_30px_90px_-40px_rgba(15,23,42,0.3)] sm:p-8">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold tracking-[-0.04em]">Add Seats</h2>
              <button
                onClick={() => {
                  setShowAddSeatsModal(false);
                  setSeatsToAdd(1);
                  setProcessingError('');
                }}
                className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="mt-2 text-sm text-slate-600">
              Add more seats to your {selectedPlan.label} plan. You'll be charged for the remaining billing period.
            </p>

            <div className="mt-6 space-y-4">
              <div className="rounded-2xl bg-slate-50 px-5 py-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-600">Current seats</span>
                  <span className="text-sm font-semibold">{maxSeats}</span>
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-800">
                  Seats to add
                </label>
                <div className="flex items-center gap-4">
                  <button
                    onClick={() => setSeatsToAdd((s) => Math.max(1, s - 1))}
                    className="flex h-12 w-12 items-center justify-center rounded-full border border-slate-200 text-slate-600 transition hover:border-slate-950 hover:text-slate-950"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="min-w-[3ch] text-center text-2xl font-semibold tabular-nums">{seatsToAdd}</span>
                  <button
                    onClick={() => setSeatsToAdd((s) => s + 1)}
                    className="flex h-12 w-12 items-center justify-center rounded-full border border-slate-200 text-slate-600 transition hover:border-slate-950 hover:text-slate-950"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="rounded-2xl bg-slate-50 px-5 py-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-600">New total seats</span>
                  <span className="text-sm font-semibold">{maxSeats + seatsToAdd}</span>
                </div>
              </div>

              <div className="rounded-2xl bg-slate-50 px-5 py-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-600">Price per seat</span>
                  <span className="text-sm font-semibold">₹{pricePerUser}/user/month</span>
                </div>
              </div>

              <div className="rounded-2xl bg-slate-50 px-5 py-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-600">Billing cycle</span>
                  <span className="text-sm font-semibold capitalize">{billingCycle}</span>
                </div>
              </div>

              <div className="flex items-center justify-between rounded-2xl bg-slate-950 px-5 py-4 text-white">
                <span className="text-sm font-semibold">Total amount due</span>
                <span className="text-xl font-bold tabular-nums">₹{addSeatsCost.toLocaleString('en-IN')}</span>
              </div>

              <p className="text-xs text-slate-500">
                {seatsToAdd} seat{seatsToAdd > 1 ? 's' : ''} × ₹{pricePerUser}/user/month × {totalMonths} month{totalMonths > 1 ? 's' : ''}
              </p>
            </div>

            {processingError && (
              <p className="mt-3 text-center text-sm text-red-600">{processingError}</p>
            )}

            <button
              onClick={handleAddSeats}
              disabled={isProcessing}
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[linear-gradient(135deg,#020617_0%,#0f172a_30%,#0284c7_100%)] px-5 py-4 text-sm font-semibold text-white shadow-[0_22px_50px_-18px_rgba(14,165,233,0.6)] transition hover:-translate-y-0.5 hover:shadow-[0_28px_58px_-20px_rgba(14,165,233,0.7)] disabled:opacity-70"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Processing...
                </>
              ) : (
                <>
                  Proceed to payment <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
