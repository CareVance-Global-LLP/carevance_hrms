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
        $usedSeats = $organization->users()->count();
        $minSeats = 10;

        if ($isTrial) {
            $seats = max($requestedSeats > 0 ? $requestedSeats : $minSeats, $minSeats);
        } else {
            $seats = max($requestedSeats > 0 ? $requestedSeats : $organization->max_seats, $minSeats, $usedSeats);
        }

        $currentPricePerUser = (int) ($currentPlanConfig['monthly_price'] ?? 0);
        $targetPricePerUser = (int) ($targetPlanConfig['monthly_price'] ?? 0);

        if ($isTrial) {
            $totalMonths = $billingCycle === 'yearly' ? 12 : 1;
            $amount = $targetPricePerUser * $seats * $totalMonths;
            $prorationDetails = [
                'type' => 'full_payment',
                'reason' => 'Trial user purchasing full plan',
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
            $now = now();
            $monthsRemaining = 1;

            if ($expiresAt) {
                $diffDays = $now->diffInDays($expiresAt, false);
                $monthsRemaining = max(1, (int) ceil($diffDays / 30));
            }

            $amount = $diffPerUser * $seats * $monthsRemaining;
            $prorationDetails = [
                'type' => 'prorated_upgrade',
                'current_plan' => $currentPlanCode,
                'target_plan' => $targetPlanCode,
                'current_price_per_user' => $currentPricePerUser,
                'target_price_per_user' => $targetPricePerUser,
                'price_difference_per_user' => $diffPerUser,
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

        $isTrial = $organization->subscription_status === 'trial' || $organization->subscription_status === 'inactive';

        $newExpiresAt = $isTrial
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
}
