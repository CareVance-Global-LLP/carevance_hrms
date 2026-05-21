<?php

namespace App\Services\Billing;

use App\Models\Organization;

class WorkspaceBillingService
{
    public function snapshot(?Organization $organization): ?array
    {
        if (!$organization) {
            return null;
        }

        $plans = config('carevance.plans', []);
        $status = (string) ($organization->subscription_status ?: 'trial');
        $isTrial = $status === 'trial';

        $planCode = $isTrial ? 'trial' : (string) ($organization->plan_code ?: config('carevance.default_plan', 'basic'));
        $planConfig = $isTrial ? ['label' => 'Trial', 'description' => '14-day free trial with limited features.'] : ($plans[$planCode] ?? []);

        $trialEndsAt = $organization->trial_ends_at ?? $organization->subscription_expires_at;
        $usedSeats = $organization->users()->count();

        return [
            'plan' => [
                'code' => $planCode,
                'name' => $planConfig['label'] ?? ucfirst($planCode),
                'description' => $planConfig['description'] ?? null,
                'status' => $status,
                'billing_cycle' => $organization->billing_cycle,
                'subscription_intent' => $organization->subscription_intent ?? ($isTrial ? 'trial' : 'paid'),
                'is_trial' => $isTrial,
                'trial_end_date' => $trialEndsAt?->toIso8601String(),
                'renewal_date' => $organization->subscription_expires_at?->toDateString()
                    ?? $trialEndsAt?->toDateString(),
                'contact_sales_only' => (bool) ($planConfig['contact_sales_only'] ?? false),
                'max_seats' => $organization->max_seats ?? 5,
                'used_seats' => $usedSeats,
                'users_count' => $usedSeats,
                'pending_plan_code' => $organization->pending_plan_code,
                'pending_billing_cycle' => $organization->pending_billing_cycle,
                'pending_seats' => $organization->pending_seats,
                'pending_upgrade_amount' => $organization->pending_upgrade_amount,
            ],
            'workspace' => [
                'id' => $organization->id,
                'name' => $organization->name,
                'slug' => $organization->slug,
                'owner_user_id' => $organization->owner_user_id,
            ],
        ];
    }
}
