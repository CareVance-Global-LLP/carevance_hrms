<?php

namespace App\Services\Billing;

use App\Models\Organization;

class PlanService
{
    const FEATURES = [
        'basic' => [
            'desktop_timer',
            'check_in_out',
            'idle_detection',
            'auto_stop',
            'screenshot',
            'screenshot_history',
            'reports',
            'csv_export',
            'user_management',
            'overtime',
            'approval_workflow',
            'overtime_history',
            'workspace_onboarding',
            'multi_role_access',
        ],
        'advanced_tracker' => [
            'desktop_timer',
            'check_in_out',
            'idle_detection',
            'auto_stop',
            'screenshot',
            'screenshot_history',
            'reports',
            'csv_export',
            'user_management',
            'overtime',
            'approval_workflow',
            'overtime_history',
            'workspace_onboarding',
            'multi_role_access',
            'chat',
            'geo_fencing',
            'leave_management',
            'employee_timeline',
            'project_tracking',
            'task_tracking',
        ],
        'enterprise' => [
            'desktop_timer',
            'check_in_out',
            'idle_detection',
            'auto_stop',
            'screenshot',
            'screenshot_history',
            'reports',
            'csv_export',
            'user_management',
            'overtime',
            'approval_workflow',
            'overtime_history',
            'workspace_onboarding',
            'multi_role_access',
            'chat',
            'geo_fencing',
            'leave_management',
            'employee_timeline',
            'project_tracking',
            'task_tracking',
        ],
    ];

    public static function hasFeature(Organization $organization, string $feature): bool
    {
        $planCode = $organization->plan_code ?? config('carevance.default_plan', 'basic');
        $features = self::FEATURES[$planCode] ?? self::FEATURES['basic'];

        return in_array($feature, $features, true);
    }

    public static function seatsRemaining(Organization $organization): int
    {
        $maxSeats = $organization->max_seats ?? 5;
        $usedSeats = $organization->users()->count();

        return max(0, $maxSeats - $usedSeats);
    }

    public static function seatsAvailable(Organization $organization): int
    {
        return $organization->max_seats ?? 5;
    }
}
