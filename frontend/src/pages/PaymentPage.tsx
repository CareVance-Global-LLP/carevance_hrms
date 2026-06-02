import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { ShieldCheck, CheckCircle, Loader2, ArrowUpRight, X } from 'lucide-react';
import { getPricingPlan, PRICE_CURRENCY, PricingBillingCycle, calculateTotal } from '@/constants/pricing';
import { apiUrl } from '@/lib/runtimeConfig';
import { billingApi } from '@/services/api';
import { RazorpayPaymentButton } from '@/components/payment/RazorpayPaymentButton';

export default function PaymentPage() {
  const { organization, updateOrganization, isLoading } = useAuth();
  const navigate = useNavigate();
  const [isProcessing, setIsProcessing] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [paymentError, setPaymentError] = useState('');
  const [snapshotData, setSnapshotData] = useState<any>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(true);

  useEffect(() => {
    const handleBeforeUnload = () => {
      navigator.sendBeacon(`${apiUrl}/auth/cleanup-pending`);
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  useEffect(() => {
    billingApi.current().then((res) => {
      setSnapshotData(res.data);
      if (res.data?.plan) {
        const updatedOrg = {
          ...organization,
          pending_plan_code: res.data.plan.pending_plan_code || organization?.pending_plan_code,
          pending_billing_cycle: res.data.plan.pending_billing_cycle || organization?.pending_billing_cycle,
          pending_seats: res.data.plan.pending_seats || organization?.pending_seats,
          pending_upgrade_amount: res.data.plan.pending_upgrade_amount || organization?.pending_upgrade_amount,
          subscription_intent: res.data.plan.subscription_intent || organization?.subscription_intent,
        };
        updateOrganization(updatedOrg);
      }
    }).catch(() => {}).finally(() => setSnapshotLoading(false));
  }, []);

  if (isLoading || snapshotLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-sky-500" />
      </div>
    );
  }

  if (!organization) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <p className="text-slate-600">No organization found. Please sign in again.</p>
      </div>
    );
  }

  const isPendingUpgrade = organization.subscription_intent === 'upgrade';
  const isPendingAddSeats = organization.subscription_intent === 'add_seats';
  const isTrial = organization.subscription_status === 'trial';
  const isNewPaidSignup = organization.subscription_status === 'inactive' && organization.subscription_intent === 'paid';

  const planCode = isNewPaidSignup
    ? (organization.plan_code || 'basic')
    : (organization.pending_plan_code || 'basic');
  const targetPlan = getPricingPlan(planCode);
  const billingCycle = (organization.pending_billing_cycle || organization.billing_cycle || 'monthly') as PricingBillingCycle;
  const seats = organization.pending_seats || organization.max_seats || 10;

  const pendingAmount = organization.pending_upgrade_amount;
  const total = (isPendingUpgrade || isPendingAddSeats) && pendingAmount
    ? Number(pendingAmount)
    : isNewPaidSignup
      ? calculateTotal(targetPlan, seats, billingCycle)
      : 0;

  const handlePayNow = async () => {
    setIsProcessing(true);
    setPaymentStatus('idle');
    setPaymentError('');

    try {
      if (isPendingUpgrade) {
        const response = await billingApi.confirmUpgrade({ payment_intent_id: 'upi_pending' });

        if (response.data?.success === false) {
          setPaymentError(response.data?.message || 'Upgrade failed. Please try again.');
          setPaymentStatus('error');
          return;
        }

        const updatedOrg = {
          ...organization,
          subscription_status: 'active' as const,
          plan_code: response.data.plan_code || planCode,
          billing_cycle: organization.pending_billing_cycle || organization.billing_cycle,
          max_seats: seats,
          subscription_intent: 'paid' as const,
          subscription_expires_at: response.data.subscription_expires_at,
          pending_plan_code: null,
          pending_billing_cycle: null,
          pending_seats: null,
          pending_upgrade_amount: null,
        };
        updateOrganization(updatedOrg);
      } else if (isPendingAddSeats) {
        const response = await billingApi.confirmAddSeats({ payment_intent_id: 'upi_pending' });

        if (response.data?.success === false) {
          setPaymentError(response.data?.message || 'Failed to add seats. Please try again.');
          setPaymentStatus('error');
          return;
        }

        const updatedOrg = {
          ...organization,
          max_seats: response.data.max_seats || seats,
          subscription_intent: 'paid' as const,
          pending_seats: null,
          pending_billing_cycle: null,
          pending_upgrade_amount: null,
        };
        updateOrganization(updatedOrg);
      } else {
        const response = await billingApi.mockPay();

        if (response?.data?.success === false) {
          setPaymentError(response.data?.message || 'Payment failed. Please try again.');
          setPaymentStatus('error');
          return;
        }

        const updatedOrg = { ...organization, subscription_status: 'active' as const };
        updateOrganization(updatedOrg);
      }

      setPaymentStatus('success');

      setTimeout(() => navigate('/dashboard', { replace: true }), 1500);
    } catch (err: any) {
      const errorMsg = err?.response?.data?.message || err?.response?.data?.error || 'Payment failed. Please try again.';
      console.error('Payment failed:', err, errorMsg);
      setPaymentError(errorMsg);
      setPaymentStatus('error');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRetry = () => {
    setPaymentStatus('idle');
    setPaymentError('');
  };

  const handleCancel = async () => {
    setIsProcessing(true);
    try {
      if (isPendingUpgrade || isPendingAddSeats) {
        await billingApi.cancelPendingUpgrade();
      }

      // For new paid signup or pending actions: go back to checkout to re-select plan
      const backParams = new URLSearchParams();
      backParams.set('plan', planCode);
      backParams.set('interval', billingCycle);
      backParams.set('seats', String(seats));
      backParams.set('mode', 'upgrade');

      // Clear pending upgrade by updating organization
      const updatedOrg = {
        ...organization,
        subscription_intent: 'paid' as const,
        pending_plan_code: null,
        pending_billing_cycle: null,
        pending_seats: null,
        pending_upgrade_amount: null,
      };
      updateOrganization(updatedOrg);

      navigate(`/checkout?${backParams.toString()}`, { replace: true });
    } catch (err) {
      console.error('Failed to cancel:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-lg p-8">
        <div className="text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-sky-100 text-sky-700">
            <ArrowUpRight className="h-7 w-7" />
          </div>
          <h1 className="mt-4 text-2xl font-semibold">
            {isTrial ? 'Activate your plan' : isPendingAddSeats ? 'Add seats to your plan' : isNewPaidSignup ? 'Complete your purchase' : 'Complete your upgrade'}
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            {isTrial
              ? `Start your ${targetPlan.label} plan with full features.`
              : isPendingAddSeats
                ? `Add ${seats - (organization.max_seats || 10)} seat${seats - (organization.max_seats || 10) > 1 ? 's' : ''} to your ${targetPlan.label} plan.`
                : isNewPaidSignup
                  ? `Purchase your ${targetPlan.label} plan with ${seats} seat${seats > 1 ? 's' : ''}.`
                  : `Upgrade to ${targetPlan.label} to unlock all features.`
            }
          </p>
        </div>

        <div className="mt-6 space-y-3">
          {isTrial ? (
            <div className="flex items-center justify-between rounded-xl bg-emerald-50 px-5 py-4">
              <span className="text-sm text-emerald-700">Trial ending</span>
              <span className="text-sm font-semibold text-emerald-700">Switching to paid</span>
            </div>
          ) : isPendingAddSeats ? (
            <>
              <div className="flex items-center justify-between rounded-xl bg-slate-50 px-5 py-4">
                <span className="text-sm text-slate-600">Current plan</span>
                <span className="text-sm font-semibold">{targetPlan.label}</span>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-emerald-50 px-5 py-4">
                <span className="text-sm text-emerald-700">Adding seats</span>
                <span className="text-sm font-semibold text-emerald-700">+{seats - (organization.max_seats || 10)}</span>
              </div>
            </>
          ) : isNewPaidSignup ? (
            <>
              <div className="flex items-center justify-between rounded-xl bg-sky-50 px-5 py-4">
                <span className="text-sm text-sky-700">Selected plan</span>
                <span className="text-sm font-semibold text-sky-700">{targetPlan.label}</span>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between rounded-xl bg-slate-50 px-5 py-4">
                <span className="text-sm text-slate-600">Current plan</span>
                <span className="text-sm font-semibold">{getPricingPlan(organization.plan_code || 'basic').label}</span>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-sky-50 px-5 py-4">
                <span className="text-sm text-sky-700">Selected plan</span>
                <span className="text-sm font-semibold text-sky-700">{targetPlan.label}</span>
              </div>
            </>
          )}
          <div className="flex items-center justify-between rounded-xl bg-slate-50 px-5 py-4">
            <span className="text-sm text-slate-600">Billing</span>
            <span className="text-sm font-semibold capitalize">{billingCycle}</span>
          </div>
          <div className="flex items-center justify-between rounded-xl bg-slate-50 px-5 py-4">
            <span className="text-sm text-slate-600">Seats</span>
            <span className="text-sm font-semibold">{seats}</span>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between rounded-xl bg-slate-900 px-5 py-4 text-white">
          <span className="text-sm font-semibold">Total amount due</span>
          <span className="text-xl font-bold">{PRICE_CURRENCY}{total.toLocaleString('en-IN')}</span>
        </div>

        {paymentStatus === 'error' ? (
          <div className="mt-6 space-y-3">
            <p className="text-center text-sm text-red-600">{paymentError}</p>
            <div className="flex gap-3">
              <button
                onClick={handleCancel}
                disabled={isProcessing}
                className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-70"
              >
                <X className="h-4 w-4" /> {isTrial || isNewPaidSignup || isPendingUpgrade ? 'Change plan' : 'Cancel'}
              </button>
              <button
                onClick={handlePayNow}
                disabled={isProcessing}
                className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-sky-600 px-5 py-4 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:opacity-70"
              >
                Retry Payment <ShieldCheck className="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : paymentStatus === 'success' ? (
          <button
            className="mt-6 w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-4 text-sm font-semibold text-white"
          >
            <CheckCircle className="h-4 w-4" /> Payment Successful
          </button>
        ) : (
          <>
            <RazorpayPaymentButton
              amount={total}
              currency="INR"
              planCode={planCode}
              billingCycle={billingCycle}
              seats={seats}
              paymentType={isPendingUpgrade ? 'upgrade' : isPendingAddSeats ? 'add_seats' : 'subscription'}
              organizationName={organization?.name}
              userEmail={snapshotData?.workspace?.email}
              userName={snapshotData?.workspace?.name}
              isTrial={isTrial}
              isPendingAddSeats={isPendingAddSeats}
              isNewPaidSignup={isNewPaidSignup}
              isPendingUpgrade={isPendingUpgrade}
              onSuccess={async () => {
                setIsProcessing(true);
                
                try {
                  if (isPendingUpgrade) {
                    const response = await billingApi.confirmUpgrade({ payment_intent_id: 'upi_pending' });
                    
                    if (response.data?.success === false) {
                      setPaymentError(response.data?.message || 'Upgrade failed. Please try again.');
                      setPaymentStatus('error');
                      setIsProcessing(false);
                      return;
                    }
                    
                    const updatedOrg = {
                      ...organization,
                      subscription_status: 'active' as const,
                      plan_code: response.data.plan_code || planCode,
                      billing_cycle: organization.pending_billing_cycle || organization.billing_cycle,
                      max_seats: seats,
                      subscription_intent: 'paid' as const,
                      subscription_expires_at: response.data.subscription_expires_at,
                      pending_plan_code: null,
                      pending_billing_cycle: null,
                      pending_seats: null,
                      pending_upgrade_amount: null,
                    };
                    updateOrganization(updatedOrg);
                  } else if (isPendingAddSeats) {
                    const response = await billingApi.confirmAddSeats({ payment_intent_id: 'upi_pending' });
                    
                    if (response.data?.success === false) {
                      setPaymentError(response.data?.message || 'Failed to add seats. Please try again.');
                      setPaymentStatus('error');
                      setIsProcessing(false);
                      return;
                    }
                    
                    const updatedOrg = {
                      ...organization,
                      max_seats: response.data.max_seats || seats,
                      subscription_intent: 'paid' as const,
                      pending_seats: null,
                      pending_billing_cycle: null,
                      pending_upgrade_amount: null,
                    };
                    updateOrganization(updatedOrg);
                  } else {
                    const response = await billingApi.mockPay();
                    
                    if (response?.data?.success === false) {
                      setPaymentError(response.data?.message || 'Payment failed. Please try again.');
                      setPaymentStatus('error');
                      setIsProcessing(false);
                      return;
                    }
                    
                    const updatedOrg = { ...organization, subscription_status: 'active' as const };
                    updateOrganization(updatedOrg);
                  }
                  
                  setPaymentStatus('success');
                  setTimeout(() => navigate('/dashboard', { replace: true }), 1500);
                } catch (err: any) {
                  const errorMsg = err?.response?.data?.message || err?.response?.data?.error || 'Payment failed. Please try again.';
                  console.error('Payment confirmation failed:', err, errorMsg);
                  setPaymentError(errorMsg);
                  setPaymentStatus('error');
                } finally {
                  setIsProcessing(false);
                }
              }}
              onError={(error) => {
                setPaymentError(error);
                setPaymentStatus('error');
              }}
              disabled={isProcessing}
            />
            <button
              onClick={handleCancel}
              disabled={isProcessing}
              className="mt-3 w-full flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-70"
            >
              {isTrial || isNewPaidSignup || isPendingUpgrade ? 'Change plan' : 'Cancel and go back to billing'}
            </button>
          </>
        )}

        <p className="mt-4 text-center text-xs text-slate-500">
          Secure payment processed via encrypted gateway.
        </p>
      </div>
    </div>
  );
}
