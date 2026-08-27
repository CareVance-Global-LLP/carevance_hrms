<?php

namespace App\Services\Billing;

use App\Models\Organization;

class WorkspaceBillingService
{
    public function __construct(
        private readonly SubscriptionCycleService $cycles,
        private readonly SeatGuard $seats,
        private readonly CompanyProfileService $companyProfile,
    ) {
    }

    public function snapshot(?Organization $organization): ?array
    {
        if (!$organization) {
            return null;
        }

        $plans = config('carevance.plans', []);
        $status = (string) ($organization->subscription_status ?: 'trial');
        $isTrial = $status === 'trial';

        // Get the actual plan code from database, even during trial
        $actualPlanCode = (string) ($organization->plan_code ?: config('carevance.default_plan', 'basic_tracking'));

        // For display purposes during trial, show the actual plan type (Tracking vs Payroll)
        if ($isTrial) {
            $isPayrollTrial = PlanService::isPayrollPlan($actualPlanCode);
            $planCode = $actualPlanCode; // Keep the actual plan code for reference
            $planConfig = $isPayrollTrial
                ? ['label' => 'Payroll Trial', 'description' => '14-day free trial of Basic Payroll with full HR + Payroll features.']
                : ['label' => 'Tracking Trial', 'description' => '14-day free trial of Basic Tracking with time tracking and HR features.'];
        } else {
            $planCode = $actualPlanCode;
            $planConfig = $plans[$planCode] ?? [];
        }

        $trialEndsAt = $organization->trial_ends_at ?? $organization->subscription_expires_at;
        $seats = $this->seats->summary($organization);
        $cycle = $this->cycles->summary($organization);

        $billingCycle = $organization->billing_cycle ?: 'monthly';
        $pricePerSeat = (int) ($planConfig[$billingCycle === 'yearly' ? 'yearly_price' : 'monthly_price'] ?? 0);

        return [
            'plan' => [
                'code' => $planCode,
                'name' => $planConfig['label'] ?? ucfirst($planCode),
                'description' => $planConfig['description'] ?? null,
                'status' => $status,
                'billing_cycle' => $billingCycle,
                'subscription_intent' => $organization->subscription_intent ?? ($isTrial ? 'trial' : 'paid'),
                'is_trial' => $isTrial,
                'trial_end_date' => $trialEndsAt?->toIso8601String(),
                'renewal_date' => $organization->subscription_expires_at?->toDateString()
                    ?? ($trialEndsAt?->toDateString()),
                'contact_sales_only' => (bool) ($planConfig['contact_sales_only'] ?? false),
                // Kept for existing callers. `seats` below is the shape new code
                // should read: it carries the floor and the over-cap figure,
                // which these two scalars cannot express.
                'max_seats' => $seats['max'],
                'used_seats' => $seats['used'],
                'users_count' => $seats['used'],
                'price_per_seat' => $pricePerSeat,
                'renewal_amount' => $pricePerSeat * max($seats['max'], 0) * ($billingCycle === 'yearly' ? 12 : 1),
                'pending_plan_code' => $organization->pending_plan_code,
                'pending_billing_cycle' => $organization->pending_billing_cycle,
                'pending_seats' => $organization->pending_seats,
                'pending_upgrade_amount' => $organization->pending_upgrade_amount,
            ],
            'seats' => $seats,
            'cycle' => $cycle,
            // What conversion needs from the company profile: the seat count to
            // put in the box, and whether we can raise an invoice at all. The
            // payment screen reads `billing_ready` to decide whether to ask for
            // an address before showing the pay button, rather than letting the
            // order call 422 after the customer has committed.
            'company_profile' => $this->companyProfile->summary(
                $organization,
                $isTrial ? 5 : 10,
                // `suggested_seats` prefills the seat box at conversion and is
                // posted straight back to be priced, so it is floored on the
                // people who still hold access — the same number `seats.used`
                // above reports and BillingController::upgradePlan prices on.
                // It was floored on every row ever, leavers included, which put
                // a seat count in the box that appeared nowhere else on the
                // screen and was billed anyway.
                $seats['used'],
            ),
            'workspace' => [
                'id' => $organization->id,
                'name' => $organization->name,
                'slug' => $organization->slug,
                'owner_user_id' => $organization->owner_user_id,
            ],
        ];
    }
}
