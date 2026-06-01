import { useState } from 'react';
import { billingApi } from '@/services/api';
import { useRazorpayCheckout } from '@/hooks/useRazorpayCheckout';
import { ShieldCheck, Loader2, AlertCircle } from 'lucide-react';
import type { PricingBillingCycle } from '@/constants/pricing';

interface RazorpayPaymentButtonProps {
  amount: number;
  currency?: string;
  planCode: string;
  billingCycle: PricingBillingCycle;
  seats: number;
  paymentType?: 'subscription' | 'upgrade' | 'add_seats';
  organizationName?: string;
  userEmail?: string;
  userName?: string;
  onSuccess?: () => void;
  onError?: (error: string) => void;
  buttonText?: string;
  isTrial?: boolean;
  isPendingAddSeats?: boolean;
  isNewPaidSignup?: boolean;
  isPendingUpgrade?: boolean;
  disabled?: boolean;
}

export function RazorpayPaymentButton({
  amount,
  currency = 'INR',
  planCode,
  billingCycle,
  seats,
  paymentType = 'subscription',
  organizationName,
  userEmail,
  userName,
  onSuccess,
  onError,
  buttonText,
  isTrial,
  isPendingAddSeats,
  isNewPaidSignup,
  isPendingUpgrade,
  disabled,
}: RazorpayPaymentButtonProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const { openCheckout, isLoading: isScriptLoading, isScriptLoaded, error: checkoutError } = useRazorpayCheckout({
    onSuccess: async (response) => {
      try {
        // Verify payment on backend
        const verifyResult = await billingApi.verifyRazorpayPayment({
          razorpay_order_id: response.razorpay_order_id,
          razorpay_payment_id: response.razorpay_payment_id,
          razorpay_signature: response.razorpay_signature,
        });

        if (verifyResult.data?.subscription_status === 'active') {
          onSuccess?.();
        } else {
          onError?.(verifyResult.data?.message || 'Payment verification failed');
        }
      } catch (err: any) {
        onError?.(err?.response?.data?.message || 'Payment verification failed');
      }
    },
    onError: (razorpayError) => {
      onError?.(razorpayError.description);
      setError(razorpayError.description);
    },
    onClose: () => {
      setIsProcessing(false);
    },
  });

    const handlePay = async () => {
    setError(null);
    setIsProcessing(true);

    try {
      // Create Razorpay order
      const orderResult = await billingApi.createRazorpayOrder({
        amount,
        currency,
        payment_type: paymentType,
      });

      if (!orderResult.data?.success) {
        throw new Error(orderResult.data?.message || 'Failed to create payment order');
      }

      const { order_id, key_id, mock_mode } = orderResult.data;

      // If mock mode, simulate successful payment immediately
      if (mock_mode) {
        console.log('Mock payment mode - simulating successful payment');
        // Simulate payment success after 1 second
        setTimeout(() => {
          onSuccess?.();
          setIsProcessing(false);
        }, 1000);
        return;
      }

      // Open Razorpay checkout
      openCheckout({
        key: key_id,
        amount: orderResult.data.amount,
        currency: orderResult.data.currency,
        name: organizationName || 'CareVance HRMS',
        description: `${planCode} plan - ${seats} seats (${billingCycle})`,
        order_id: order_id,
        prefill: {
          name: userName,
          email: userEmail,
        },
        notes: {
          plan_code: planCode,
          billing_cycle: billingCycle,
          seats: String(seats),
          payment_type: paymentType,
        },
        handler: () => {
          // Handler is called by useRazorpayCheckout
        },
      });
    } catch (err: any) {
      const errorMessage = err?.response?.data?.message || err.message || 'Payment failed';
      console.error('Payment error:', err);
      setError(errorMessage);
      onError?.(errorMessage);
      setIsProcessing(false);
    }
  };

  const getButtonText = () => {
    if (isProcessing || isScriptLoading) return 'Processing...';
    if (buttonText) return buttonText;
    if (isTrial) return 'Pay & Activate';
    if (isPendingAddSeats) return 'Pay & Add Seats';
    if (isNewPaidSignup) return 'Pay & Activate';
    if (isPendingUpgrade) return 'Pay & Upgrade';
    return 'Pay Now';
  };

  return (
    <div className="space-y-3">
      {(error || checkoutError) && (
        <div className="flex items-center gap-2 text-sm text-red-600">
          <AlertCircle className="h-4 w-4" />
          <span>{error || checkoutError}</span>
        </div>
      )}
      
      <button
        onClick={handlePay}
        disabled={disabled || isProcessing || isScriptLoading || !isScriptLoaded}
        className={`w-full flex items-center justify-center gap-2 rounded-xl px-5 py-4 text-sm font-semibold text-white transition disabled:opacity-70 ${
          disabled || isProcessing || isScriptLoading
            ? 'bg-slate-400 cursor-not-allowed'
            : 'bg-sky-600 hover:bg-sky-700'
        }`}
      >
        {isProcessing || isScriptLoading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Processing...
          </>
        ) : (
          <>
            {getButtonText()} <ShieldCheck className="h-4 w-4" />
          </>
        )}
      </button>
      
      <p className="text-center text-xs text-slate-500">
        Secure payment processed via Razorpay
      </p>
    </div>
  );
}
