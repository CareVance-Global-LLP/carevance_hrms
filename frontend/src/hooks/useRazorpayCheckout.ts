import { useState, useCallback, useEffect } from 'react';
import type { RazorpayOptions, RazorpayResponse, RazorpayInstance, RazorpayError } from '@/types/razorpay';

interface UseRazorpayCheckoutOptions {
  onSuccess?: (response: RazorpayResponse) => void;
  onError?: (error: RazorpayError) => void;
  onClose?: () => void;
}

export function useRazorpayCheckout(options: UseRazorpayCheckoutOptions = {}) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isScriptLoaded, setIsScriptLoaded] = useState(false);

  // Load Razorpay script
  useEffect(() => {
    if (document.getElementById('razorpay-script')) {
      setIsScriptLoaded(true);
      return;
    }

    const script = document.createElement('script');
    script.id = 'razorpay-script';
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => setIsScriptLoaded(true);
    script.onerror = () => setError('Failed to load Razorpay checkout script');
    document.body.appendChild(script);

    return () => {
      // Don't remove script on unmount as it might be used by other components
    };
  }, []);

  const openCheckout = useCallback((razorpayOptions: RazorpayOptions): void => {
    if (!isScriptLoaded || typeof window === 'undefined') {
      setError('Razorpay checkout is not ready');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const Razorpay = (window as any).Razorpay;
      
      if (!Razorpay) {
        throw new Error('Razorpay not available');
      }

      const checkoutOptions: RazorpayOptions = {
        ...razorpayOptions,
        handler: (response: RazorpayResponse) => {
          setIsLoading(false);
          razorpayOptions.handler?.(response);
          options.onSuccess?.(response);
        },
        theme: {
          color: '#0ea5e9', // Sky-500 color to match app theme
          ...razorpayOptions.theme,
        },
      };

      const rzp: RazorpayInstance = new Razorpay(checkoutOptions);

      (rzp as any).on('payment.failed', (response: any) => {
        setIsLoading(false);
        const error = response.error as RazorpayError;
        setError(error.description);
        options.onError?.(error);
      });

      rzp.on('modal.closed', () => {
        setIsLoading(false);
        options.onClose?.();
      });

      rzp.open();
    } catch (err) {
      setIsLoading(false);
      const errorMessage = err instanceof Error ? err.message : 'Failed to open Razorpay checkout';
      setError(errorMessage);
    }
  }, [isScriptLoaded, options]);

  const resetError = useCallback(() => {
    setError(null);
  }, []);

  return {
    openCheckout,
    isLoading,
    isScriptLoaded,
    error,
    resetError,
  };
}

// Extend Window interface for Razorpay
declare global {
  interface Window {
    Razorpay?: any;
  }
}
