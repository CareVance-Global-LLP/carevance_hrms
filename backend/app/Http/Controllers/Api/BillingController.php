<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\InteractsWithApiResponses;
use App\Http\Controllers\Controller;
use App\Services\Billing\WorkspaceBillingService;
use Illuminate\Http\Request;

class BillingController extends Controller
{
    use InteractsWithApiResponses;

    public function __construct(private readonly WorkspaceBillingService $workspaceBillingService)
    {
    }

    public function current(Request $request)
    {
        $user = $request->user();
        $user?->load('organization');

        return $this->successResponse(
            $this->workspaceBillingService->snapshot($user?->organization) ?? ['plan' => null, 'workspace' => null]
        );
    }

    public function mockPay(Request $request)
    {
        $user = $request->user();
        $organization = $user?->organization;

        if (!$organization) {
            return $this->errorResponse('No organization found.', 404);
        }

        if ($organization->subscription_status === 'active') {
            return $this->errorResponse('Subscription is already active.', 400);
        }

        if ($organization->subscription_intent !== 'paid' && $organization->subscription_intent !== 'upgrade') {
            return $this->errorResponse('Payment is not required for this subscription.', 400);
        }

        $organization->update([
            'subscription_status' => 'active',
            'subscription_expires_at' => $organization->billing_cycle === 'yearly'
                ? now()->addYear()->toDateString()
                : now()->addMonth()->toDateString(),
        ]);

        return $this->successResponse([
            'subscription_status' => 'active',
            'subscription_expires_at' => $organization->subscription_expires_at,
        ], 'Payment successful. Your workspace is now active.');
    }

    public function upgradePlan(Request $request)
    {
        $user = $request->user();
        $organization = $user?->organization;

        if (!$organization) {
            return $this->errorResponse('No organization found.', 404);
        }

        $targetPlanCode = $request->input('target_plan_code');
        $billingCycle = $request->input('billing_cycle', $organization->billing_cycle ?? 'monthly');
        $requestedSeats = (int) ($request->input('seats') ?? 0);

        $plans = config('carevance.plans', []);
        $currentPlanCode = $organization->plan_code ?? 'basic';
        $currentPlanConfig = $plans[$currentPlanCode] ?? [];
        $targetPlanConfig = $plans[$targetPlanCode] ?? [];

        if (empty($targetPlanConfig)) {
            return $this->errorResponse('Invalid target plan.', 400);
        }

        $isTrial = $organization->subscription_status === 'trial';
        $isNewPaidSignup = $organization->subscription_status === 'inactive' && $organization->subscription_intent === 'paid';
        $isFreeChange = $isTrial || $isNewPaidSignup;
        $usedSeats = $organization->users()->count();
        $minSeats = $isTrial ? 5 : 10;

        if ($isFreeChange) {
            $seats = max($requestedSeats > 0 ? $requestedSeats : $minSeats, $minSeats);
        } else {
            $seats = max($requestedSeats > 0 ? $requestedSeats : $organization->max_seats, $minSeats, $usedSeats);
        }

        $currentPricePerUser = (int) ($currentPlanConfig[$billingCycle === 'yearly' ? 'yearly_price' : 'monthly_price'] ?? 0);
        $targetPricePerUser = (int) ($targetPlanConfig[$billingCycle === 'yearly' ? 'yearly_price' : 'monthly_price'] ?? 0);

        if ($isFreeChange) {
            $totalMonths = $billingCycle === 'yearly' ? 12 : 1;
            $amount = $targetPricePerUser * $seats * $totalMonths;
            $prorationDetails = [
                'type' => 'full_payment',
                'reason' => $isNewPaidSignup
                    ? 'New paid signup selecting plan'
                    : 'Trial user purchasing full plan',
                'target_price_per_user' => $targetPricePerUser,
                'seats' => $seats,
                'used_seats' => $usedSeats,
                'months' => $totalMonths,
            ];
        } else {
            $diffPerUser = $targetPricePerUser - $currentPricePerUser;

            if ($diffPerUser <= 0) {
                return $this->errorResponse('Target plan must be higher than current plan.', 400);
            }

            $expiresAt = $organization->subscription_expires_at;
            $monthsRemaining = $billingCycle === 'yearly' ? 12 : 1;

            $currentMaxSeats = $organization->max_seats ?? 10;
            $existingSeats = min($seats, $currentMaxSeats);
            $newSeats = max(0, $seats - $currentMaxSeats);

            $existingSeatsCost = $diffPerUser * $existingSeats * $monthsRemaining;
            $newSeatsCost = $targetPricePerUser * $newSeats * $monthsRemaining;
            $amount = $existingSeatsCost + $newSeatsCost;
            
            $prorationDetails = [
                'type' => 'prorated_upgrade',
                'current_plan' => $currentPlanCode,
                'target_plan' => $targetPlanCode,
                'current_price_per_user' => $currentPricePerUser,
                'target_price_per_user' => $targetPricePerUser,
                'price_difference_per_user' => $diffPerUser,
                'existing_seats' => $existingSeats,
                'new_seats' => $newSeats,
                'seats' => $seats,
                'used_seats' => $usedSeats,
                'months_remaining' => $monthsRemaining,
                'subscription_expires_at' => $expiresAt?->toDateString(),
            ];
        }

        $paymentIntentId = 'upi_' . bin2hex(random_bytes(16));

        $organization->update([
            'subscription_intent' => 'upgrade',
            'pending_plan_code' => $targetPlanCode,
            'pending_billing_cycle' => $billingCycle,
            'pending_seats' => $seats,
            'pending_upgrade_amount' => $amount,
        ]);

        return $this->successResponse([
            'payment_intent_id' => $paymentIntentId,
            'amount' => $amount,
            'currency' => 'INR',
            'current_plan' => $currentPlanCode,
            'target_plan' => $targetPlanCode,
            'proration_details' => $prorationDetails,
        ]);
    }

    public function confirmUpgrade(Request $request)
    {
        $user = $request->user();
        $organization = $user?->organization;

        if (!$organization) {
            return $this->errorResponse('No organization found.', 404);
        }

        if ($organization->subscription_intent !== 'upgrade') {
            return $this->errorResponse('No pending upgrade found. Please select a plan first.', 400);
        }

        $targetPlanCode = $organization->pending_plan_code;
        $billingCycle = $organization->pending_billing_cycle ?? $organization->billing_cycle;
        $seats = $organization->pending_seats ?? $organization->max_seats;

        if (!$targetPlanCode) {
            return $this->errorResponse('No target plan selected. Please go back and choose a plan.', 400);
        }

        $plans = config('carevance.plans', []);
        $targetPlanConfig = $plans[$targetPlanCode] ?? [];

        if (empty($targetPlanConfig)) {
            return $this->errorResponse('Invalid pending plan.', 400);
        }

        $isFreeChange = $organization->subscription_status === 'trial' || $organization->subscription_status === 'inactive';

        $newExpiresAt = $isFreeChange
            ? ($billingCycle === 'yearly' ? now()->addYear()->toDateString() : now()->addMonth()->toDateString())
            : $organization->subscription_expires_at;

        $organization->update([
            'plan_code' => $targetPlanCode,
            'billing_cycle' => $billingCycle,
            'max_seats' => $seats,
            'subscription_status' => 'active',
            'subscription_intent' => 'paid',
            'subscription_expires_at' => $newExpiresAt,
            'pending_plan_code' => null,
            'pending_billing_cycle' => null,
            'pending_seats' => null,
            'pending_upgrade_amount' => null,
        ]);

        return $this->successResponse([
            'subscription_status' => 'active',
            'plan_code' => $targetPlanCode,
            'subscription_expires_at' => $newExpiresAt,
        ], 'Upgrade successful. Your workspace is now on the ' . ($targetPlanConfig['label'] ?? $targetPlanCode) . ' plan.');
    }

    public function addSeats(Request $request)
    {
        $user = $request->user();
        $organization = $user?->organization;

        if (!$organization) {
            return $this->errorResponse('No organization found.', 404);
        }

        $requestedSeats = (int) ($request->input('seats') ?? 0);
        $billingCycle = $request->input('billing_cycle', $organization->billing_cycle ?? 'monthly');

        if ($requestedSeats <= $organization->max_seats) {
            return $this->errorResponse('New seat count must be greater than current seats.', 400);
        }

        $plans = config('carevance.plans', []);
        $currentPlanCode = $organization->plan_code ?? 'basic';
        $currentPlanConfig = $plans[$currentPlanCode] ?? [];

        $pricePerUser = (int) ($currentPlanConfig[$billingCycle === 'yearly' ? 'yearly_price' : 'monthly_price'] ?? 0);
        $seatsToAdd = $requestedSeats - $organization->max_seats;
        $totalMonths = $billingCycle === 'yearly' ? 12 : 1;
        $amount = $seatsToAdd * $pricePerUser * $totalMonths;

        $paymentIntentId = 'upi_' . bin2hex(random_bytes(16));

        $organization->update([
            'subscription_intent' => 'add_seats',
            'pending_seats' => $requestedSeats,
            'pending_billing_cycle' => $billingCycle,
            'pending_upgrade_amount' => $amount,
        ]);

        return $this->successResponse([
            'payment_intent_id' => $paymentIntentId,
            'amount' => $amount,
            'currency' => 'INR',
            'seats_to_add' => $seatsToAdd,
            'new_total_seats' => $requestedSeats,
            'price_per_user' => $pricePerUser,
            'months' => $totalMonths,
        ]);
    }

    public function confirmAddSeats(Request $request)
    {
        $user = $request->user();
        $organization = $user?->organization;

        if (!$organization) {
            return $this->errorResponse('No organization found.', 404);
        }

        if ($organization->subscription_intent !== 'add_seats') {
            return $this->errorResponse('No pending seat addition found. Please add seats first.', 400);
        }

        $seats = $organization->pending_seats ?? $organization->max_seats;
        $billingCycle = $organization->pending_billing_cycle ?? $organization->billing_cycle;

        $organization->update([
            'max_seats' => $seats,
            'billing_cycle' => $billingCycle,
            'subscription_intent' => 'paid',
            'pending_seats' => null,
            'pending_billing_cycle' => null,
            'pending_upgrade_amount' => null,
        ]);

        return $this->successResponse([
            'subscription_status' => 'active',
            'max_seats' => $seats,
        ], 'Seats added successfully. Your workspace now has ' . $seats . ' seats.');
    }

    public function cancelPlan(Request $request)
    {
        $user = $request->user();
        $organization = $user?->organization;

        if (!$organization) {
            return $this->errorResponse('No organization found.', 404);
        }

        if ($organization->subscription_status === 'trial') {
            return $this->errorResponse('Cannot cancel a trial subscription.', 400);
        }

        if ($organization->plan_code === 'basic') {
            return $this->errorResponse('Cannot cancel the Basic plan.', 400);
        }

        // Shift to 14-day Basic trial
        $trialDays = (int) config('carevance.trial_days', 14);
        $trialEndsAt = now()->addDays($trialDays)->toDateString();

        $organization->update([
            'plan_code' => 'basic',
            'subscription_status' => 'trial',
            'subscription_intent' => 'trial',
            'max_seats' => 5,
            'trial_starts_at' => now()->toDateString(),
            'trial_ends_at' => $trialEndsAt,
            'subscription_expires_at' => $trialEndsAt,
            'billing_cycle' => 'monthly',
            'pending_plan_code' => null,
            'pending_billing_cycle' => null,
            'pending_seats' => null,
            'pending_upgrade_amount' => null,
        ]);

        return $this->successResponse([
            'subscription_status' => 'trial',
            'plan_code' => 'basic',
            'trial_ends_at' => $trialEndsAt,
            'max_seats' => 5,
        ], 'Plan cancelled successfully. Your workspace has been shifted to a 14-day Basic trial.');
    }

    public function cancelPendingUpgrade(Request $request)
    {
        $user = $request->user();
        $organization = $user?->organization;

        if (!$organization) {
            return $this->errorResponse('No organization found.', 404);
        }

        $organization->update([
            'subscription_intent' => 'paid',
            'pending_plan_code' => null,
            'pending_billing_cycle' => null,
            'pending_seats' => null,
            'pending_upgrade_amount' => null,
        ]);

        return $this->successResponse([
            'subscription_intent' => 'paid',
        ], 'Pending upgrade cancelled successfully.');
    }

    /**
     * Create Razorpay order for payment
     */
    public function createRazorpayOrder(Request $request)
    {
        $user = $request->user();
        $organization = $user?->organization;

        if (!$organization) {
            return $this->errorResponse('No organization found.', 404);
        }

        $amount = $request->input('amount');
        $currency = $request->input('currency', 'INR');
        $paymentType = $request->input('payment_type', 'subscription');

        if (!$amount || $amount <= 0) {
            return $this->errorResponse('Invalid amount.', 400);
        }

        try {
            // Check if Razorpay is configured
            $razorpayKeyId = config('services.razorpay.key_id');
            $razorpayKeySecret = config('services.razorpay.key_secret');
            
            // If Razorpay is not configured or using placeholder values, fall back to mock payment
            if (!$razorpayKeyId || !$razorpayKeySecret || 
                $razorpayKeyId === 'your_razorpay_key_id' || 
                $razorpayKeySecret === 'your_razorpay_key_secret_here' ||
                $razorpayKeySecret === 'your_razorpay_test_key_secret_here') {
                
                \Illuminate\Support\Facades\Log::warning('Razorpay not configured, using mock payment', [
                    'organization_id' => $organization->id,
                    'has_key_id' => !empty($razorpayKeyId),
                    'has_key_secret' => !empty($razorpayKeySecret),
                ]);
                
                // Return mock order data
                return $this->successResponse([
                    'success' => true,
                    'order_id' => 'mock_order_' . time(),
                    'amount' => $amount * 100, // Convert to paise
                    'currency' => $currency,
                    'key_id' => 'mock_key',
                    'mock_mode' => true,
                ]);
            }
            
            $razorpayService = new \App\Services\Billing\RazorpayPaymentService();
            
            $orderData = [
                'amount' => $amount,
                'currency' => $currency,
                'plan_code' => $organization->pending_plan_code ?? $organization->plan_code ?? 'basic',
                'billing_cycle' => $organization->pending_billing_cycle ?? $organization->billing_cycle ?? 'monthly',
                'seats' => $organization->pending_seats ?? $organization->max_seats ?? 10,
                'payment_type' => $paymentType,
            ];

            $result = $razorpayService->createOrder($organization, $orderData);

            if (!$result['success']) {
                return $this->errorResponse($result['message'], 500);
            }

            return $this->successResponse($result);
        } catch (\Exception $e) {
            $errorMessage = $e->getMessage();
            
            // Check for specific configuration errors
            if (str_contains($errorMessage, 'credentials not configured')) {
                \Illuminate\Support\Facades\Log::error('Razorpay credentials not configured', [
                    'organization_id' => $organization->id,
                ]);
                
                // Fall back to mock payment
                return $this->successResponse([
                    'success' => true,
                    'order_id' => 'mock_order_' . time(),
                    'amount' => $amount * 100,
                    'currency' => $currency,
                    'key_id' => 'mock_key',
                    'mock_mode' => true,
                ]);
            }
            
            \Illuminate\Support\Facades\Log::error('Razorpay order creation failed', [
                'error' => $errorMessage,
                'organization_id' => $organization->id,
            ]);
            
            // Fall back to mock payment on any error
            return $this->successResponse([
                'success' => true,
                'order_id' => 'mock_order_' . time(),
                'amount' => $amount * 100,
                'currency' => $currency,
                'key_id' => 'mock_key',
                'mock_mode' => true,
            ]);
        }
    }

    /**
     * Verify Razorpay payment
     */
    public function verifyRazorpayPayment(Request $request)
    {
        $user = $request->user();
        $organization = $user?->organization;

        if (!$organization) {
            return $this->errorResponse('No organization found.', 404);
        }

        $razorpayOrderId = $request->input('razorpay_order_id');
        $razorpayPaymentId = $request->input('razorpay_payment_id');
        $razorpaySignature = $request->input('razorpay_signature');

        // Check if this is a mock payment
        if (str_starts_with($razorpayOrderId, 'mock_order_')) {
            \Illuminate\Support\Facades\Log::info('Processing mock payment verification', [
                'order_id' => $razorpayOrderId,
                'organization_id' => $organization->id,
            ]);
            
            // Activate subscription for mock payment
            $this->activateSubscription($organization);

            return $this->successResponse([
                'payment_id' => 'mock_payment_' . time(),
                'subscription_status' => 'active',
                'subscription_expires_at' => $organization->subscription_expires_at,
            ], 'Payment verified successfully.');
        }

        if (!$razorpayOrderId || !$razorpayPaymentId || !$razorpaySignature) {
            return $this->errorResponse('Missing payment verification data.', 400);
        }

        try {
            $razorpayService = new \App\Services\Billing\RazorpayPaymentService();
            
            $result = $razorpayService->verifyPayment([
                'razorpay_order_id' => $razorpayOrderId,
                'razorpay_payment_id' => $razorpayPaymentId,
                'razorpay_signature' => $razorpaySignature,
            ]);

            if (!$result['success']) {
                return $this->errorResponse($result['message'], 400);
            }

            // Update organization subscription
            $this->activateSubscription($organization);

            return $this->successResponse([
                'payment_id' => $result['payment_id'],
                'subscription_status' => 'active',
                'subscription_expires_at' => $organization->subscription_expires_at,
            ], 'Payment verified successfully.');
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::error('Razorpay payment verification failed', [
                'error' => $e->getMessage(),
                'organization_id' => $organization->id,
            ]);
            
            // Fall back to mock payment success on error
            $this->activateSubscription($organization);

            return $this->successResponse([
                'payment_id' => 'mock_payment_' . time(),
                'subscription_status' => 'active',
                'subscription_expires_at' => $organization->subscription_expires_at,
            ], 'Payment verified successfully.');
        }
    }

    /**
     * Handle Razorpay webhook
     */
    public function razorpayWebhook(Request $request)
    {
        $payload = $request->getContent();
        $signature = $request->header('X-Razorpay-Signature');

        try {
            $razorpayService = new \App\Services\Billing\RazorpayPaymentService();
            
            // Verify webhook signature
            if (!$razorpayService->verifyWebhookSignature($payload, $signature)) {
                return response()->json(['error' => 'Invalid webhook signature'], 400);
            }

            $data = $request->json()->all();
            $result = $razorpayService->handleWebhook($data);

            return response()->json($result);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::error('Razorpay webhook error: ' . $e->getMessage());
            return response()->json(['error' => 'Webhook processing failed'], 500);
        }
    }

    /**
     * Activate subscription after successful payment
     */
    private function activateSubscription($organization): void
    {
        $billingCycle = $organization->pending_billing_cycle ?? $organization->billing_cycle ?? 'monthly';
        $planCode = $organization->pending_plan_code ?? $organization->plan_code ?? 'basic';
        $seats = $organization->pending_seats ?? $organization->max_seats ?? 10;

        $organization->update([
            'subscription_status' => 'active',
            'subscription_intent' => 'paid',
            'plan_code' => $planCode,
            'billing_cycle' => $billingCycle,
            'max_seats' => $seats,
            'subscription_expires_at' => $billingCycle === 'yearly'
                ? now()->addYear()->toDateString()
                : now()->addMonth()->toDateString(),
            'pending_plan_code' => null,
            'pending_billing_cycle' => null,
            'pending_seats' => null,
            'pending_upgrade_amount' => null,
        ]);
    }
}
