import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Minus, Plus, ShieldCheck, Loader2 } from 'lucide-react';
import Navbar from '@/components/landing/Navbar';
import Footer from '@/components/landing/Footer';
import { useAuth } from '@/contexts/AuthContext';
import {
  calculateTotal,
  calculateUpgradeCost,
  getMonthsRemaining,
  getPlanPrice,
  getPricingPlan,
  getPricePerUserPerMonth,
  MIN_SEATS,
  PRICE_CURRENCY,
  PricingBillingCycle,
  buildSignupQuery,
  pricingPlans,
} from '@/constants/pricing';
import { billingApi } from '@/services/api';

export default function CheckoutPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { organization } = useAuth();

  const isUpgradeMode = searchParams.get('mode') === 'upgrade' && !!organization;
  const isTrial = organization?.subscription_status === 'trial';

  const initialPlanCode = searchParams.get('plan') || 'basic';
  const initialInterval = (searchParams.get('interval') as PricingBillingCycle | null) || 'monthly';
  const [selectedPlanCode, setSelectedPlanCode] = useState(initialPlanCode);
  const plan = getPricingPlan(selectedPlanCode);
  const [billingCycle, setBillingCycle] = useState<PricingBillingCycle>(initialInterval);
  const [isProcessing, setIsProcessing] = useState(false);
  const [upgradeError, setUpgradeError] = useState('');
  const [snapshotData, setSnapshotData] = useState<any>(null);

  const currentPlan = organization ? getPricingPlan(organization.plan_code || 'basic') : null;
  const monthsRemaining = organization?.subscription_expires_at
    ? getMonthsRemaining(organization.subscription_expires_at, billingCycle)
    : 1;

  const pricePerUser = getPricePerUserPerMonth(plan, billingCycle);

  const usedSeats = snapshotData?.plan?.used_seats ?? snapshotData?.plan?.users_count ?? 0;
  const minSeats = isTrial ? Math.max(MIN_SEATS - usedSeats, 1) : MIN_SEATS;
  const defaultSeats = Math.max(usedSeats, MIN_SEATS);
  const [seats, setSeats] = useState(defaultSeats);

  const total = isUpgradeMode && currentPlan
    ? calculateUpgradeCost(currentPlan, plan, seats, billingCycle, isTrial, monthsRemaining)
    : calculateTotal(plan, seats, billingCycle);

  const seatIncrement = () => setSeats((s) => s + 1);
  const seatDecrement = () => setSeats((s) => Math.max(minSeats, s - 1));

  const signupQuery = buildSignupQuery(selectedPlanCode, 'paid', billingCycle, seats);

  useEffect(() => {
    if (isUpgradeMode) {
      billingApi.current().then((res) => {
        setSnapshotData(res.data);
        const uSeats = res.data?.plan?.used_seats ?? res.data?.plan?.users_count ?? 0;
        setSeats(Math.max(uSeats, MIN_SEATS));
      }).catch(() => {});
    }
  }, [isUpgradeMode]);

  const handleUpgrade = async () => {
    if (!isUpgradeMode || !organization) return;

    setIsProcessing(true);
    setUpgradeError('');

    try {
      await billingApi.upgradePlan({
        target_plan_code: selectedPlanCode,
        billing_cycle: billingCycle,
        seats,
      });

      navigate('/payment?upgrade=true', { replace: true });
    } catch (err: any) {
      setUpgradeError(err?.response?.data?.message || 'Failed to initiate upgrade. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  if (plan.enterpriseContactOnly) {
    return (
      <div className="relative overflow-x-clip bg-[linear-gradient(180deg,#fcfdff_0%,#f2f8ff_24%,#eef5ff_48%,#f8fafc_100%)] text-slate-950">
        <Navbar />
        <section className="flex min-h-[60vh] items-center justify-center px-4 py-24">
          <div className="max-w-md text-center">
            <h1 className="text-3xl font-semibold tracking-[-0.06em]">Enterprise Plan</h1>
            <p className="mt-4 text-slate-600">This plan requires a sales conversation. Please contact our sales team.</p>
            <Link to="/contact-sales" className="mt-6 inline-flex items-center gap-2 rounded-full bg-slate-950 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-800">
              Contact Sales <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </section>
        <Footer />
      </div>
    );
  }

  return (
    <div className="relative overflow-x-clip bg-[linear-gradient(180deg,#fcfdff_0%,#f2f8ff_24%,#eef5ff_48%,#f8fafc_100%)] text-slate-950">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(circle_at_top,rgba(125,211,252,0.35),transparent_58%)]" />
      <Navbar />

      <section className="px-4 pb-24 pt-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl">
          <Link to={isUpgradeMode ? '/settings/billing' : '/pricing'} className="mb-8 inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-950 transition">
            <ArrowLeft className="h-4 w-4" /> {isUpgradeMode ? 'Back to billing' : 'Back to pricing'}
          </Link>

          <h1 className="text-4xl font-semibold tracking-[-0.06em] sm:text-[3.2rem] sm:leading-[0.94]">
            {isUpgradeMode ? (isTrial ? 'Choose your plan' : 'Upgrade your plan') : 'Complete your purchase'}
          </h1>
          <p className="mt-4 text-base leading-8 text-slate-600">
            {isUpgradeMode
              ? isTrial
                ? 'Your trial is active. Select a plan to continue with full features.'
                : `Upgrading from ${currentPlan?.label || 'Basic'} to ${plan.label}`
              : `${plan.label} plan · ${PRICE_CURRENCY}${pricePerUser}/user/month`
            }
          </p>

          <div className="mt-10 glass-panel premium-ring rounded-[28px] border border-slate-200/80 bg-white/70 p-6 shadow-[0_30px_90px_-40px_rgba(15,23,42,0.3)] sm:p-8">
            <h2 className="text-xl font-semibold tracking-[-0.04em]">Plan summary</h2>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {pricingPlans.filter((p) => !p.enterpriseContactOnly).map((p) => {
                const active = p.code === selectedPlanCode;
                return (
                  <button
                    key={p.code}
                    type="button"
                    onClick={() => setSelectedPlanCode(p.code)}
                    className={`rounded-[20px] border px-4 py-4 text-left transition ${
                      active
                        ? 'border-sky-300 bg-sky-50/85 shadow-[0_14px_30px_-20px_rgba(14,165,233,0.4)]'
                        : 'border-slate-200/90 bg-white/85 hover:border-slate-300'
                    }`}
                  >
                    <p className="text-sm font-semibold text-slate-950">{p.label}</p>
                    <p className="mt-1 text-xs leading-6 text-slate-500">{getPlanPrice(p, billingCycle)}/user/month</p>
                  </button>
                );
              })}
            </div>

            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-5 py-4">
                <span className="text-sm text-slate-600">Plan</span>
                <span className="text-sm font-semibold">{plan.label}</span>
              </div>
              <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-5 py-4">
                <span className="text-sm text-slate-600">Price per user</span>
                <span className="text-sm font-semibold">{getPlanPrice(plan, billingCycle)}</span>
              </div>
              <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-5 py-4">
                <span className="text-sm text-slate-600">Billing</span>
                <span className="text-sm font-semibold capitalize">{billingCycle}</span>
              </div>
            </div>

            <div className="mt-6">
              <label className="mb-2 block text-sm font-semibold text-slate-800">
                Number of seats (min {minSeats})
                {isTrial && usedSeats > 0 && (
                  <span className="ml-1 text-xs font-normal text-slate-500">· You have {usedSeats} employee(s), need {minSeats} more to reach minimum</span>
                )}
              </label>
              <div className="flex items-center gap-4">
                <button onClick={seatDecrement} disabled={seats <= minSeats} className="flex h-12 w-12 items-center justify-center rounded-full border border-slate-200 text-slate-600 transition hover:border-slate-950 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"><Minus className="h-4 w-4" /></button>
                <span className="min-w-[3ch] text-center text-2xl font-semibold tabular-nums">{seats}</span>
                <button onClick={seatIncrement} className="flex h-12 w-12 items-center justify-center rounded-full border border-slate-200 text-slate-600 transition hover:border-slate-950 hover:text-slate-950"><Plus className="h-4 w-4" /></button>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-between rounded-2xl bg-slate-950 px-5 py-4 text-white">
              <span className="text-sm font-semibold">
                {isUpgradeMode ? 'Total amount due' : `Total per ${billingCycle === 'monthly' ? 'month' : 'year'}`}
              </span>
              <span className="text-xl font-bold tabular-nums">{PRICE_CURRENCY}{total.toLocaleString('en-IN')}</span>
            </div>

            {isUpgradeMode && (
              <div className="mt-3 rounded-2xl bg-slate-50 px-5 py-3">
                <p className="text-xs text-slate-500">
                  {isTrial
                    ? `Full plan price: ${PRICE_CURRENCY}${calculateTotal(plan, seats, billingCycle).toLocaleString('en-IN')} (${billingCycle === 'yearly' ? '12' : '1'} months at ${PRICE_CURRENCY}${pricePerUser}/user/month × ${seats} seats)`
                    : `Prorated for ${monthsRemaining} remaining month${monthsRemaining > 1 ? 's' : ''} in your billing cycle`
                  }
                </p>
              </div>
            )}

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {(['monthly', 'yearly'] as PricingBillingCycle[]).map((cycle) => (
                <button
                  key={cycle}
                  onClick={() => setBillingCycle(cycle)}
                  className={`rounded-[22px] border px-4 py-3 text-left text-sm transition ${
                    billingCycle === cycle
                      ? 'border-sky-300 bg-sky-50/85 font-semibold text-sky-900'
                      : 'border-slate-200/90 bg-white/85 text-slate-600 hover:border-slate-300'
                  }`}
                >
                  {cycle === 'monthly' ? 'Monthly billing' : 'Yearly billing'}
                </button>
              ))}
            </div>

            {isUpgradeMode ? (
              <button
                onClick={handleUpgrade}
                disabled={isProcessing}
                className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[linear-gradient(135deg,#020617_0%,#0f172a_30%,#0284c7_100%)] px-5 py-4 text-sm font-semibold text-white shadow-[0_22px_50px_-18px_rgba(14,165,233,0.6)] transition hover:-translate-y-0.5 hover:shadow-[0_28px_58px_-20px_rgba(14,165,233,0.7)] disabled:opacity-70"
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
            ) : (
              <Link
                to={`/signup-owner?${signupQuery}`}
                className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[linear-gradient(135deg,#020617_0%,#0f172a_30%,#0284c7_100%)] px-5 py-4 text-sm font-semibold text-white shadow-[0_22px_50px_-18px_rgba(14,165,233,0.6)] transition hover:-translate-y-0.5 hover:shadow-[0_28px_58px_-20px_rgba(14,165,233,0.7)]"
              >
                Proceed to signup <ArrowRight className="h-4 w-4" />
              </Link>
            )}

            {upgradeError && (
              <p className="mt-3 text-center text-sm text-red-600">{upgradeError}</p>
            )}
          </div>

          <div className="mt-8 flex items-center gap-2 text-sm text-slate-500">
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
            {isUpgradeMode
              ? 'Secure payment processed via encrypted gateway. Plan upgrades take effect immediately.'
              : 'No payment collected yet. You will set up billing after signup.'
            }
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
