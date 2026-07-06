<?php

namespace App\Services\Billing;

use App\Models\Organization;

class PlanService
{
    const FEATURES = [
        // Tracking Plans
        'basic_tracking' => [
            // Core tracking
            'desktop_timer', 'check_in_out', 'idle_detection', 'auto_stop',
            'screenshot', 'screenshot_history', 'reports', 'csv_export',
            'user_management', 'overtime', 'approval_workflow', 'overtime_history',
            'workspace_onboarding', 'multi_role_access',
            // Module features
            'tracking_management', 'project_task_management', 'team_management',
            'attendance_management', 'leave_management', 'approval_management',
            'overtime_management', 'hrms_core',
        ],
        'advance_tracking' => [
            // All basic_tracking features
            'desktop_timer', 'check_in_out', 'idle_detection', 'auto_stop',
            'screenshot', 'screenshot_history', 'reports', 'csv_export',
            'user_management', 'overtime', 'approval_workflow', 'overtime_history',
            'workspace_onboarding', 'multi_role_access',
            'tracking_management', 'project_task_management', 'team_management',
            'attendance_management', 'leave_management', 'approval_management',
            'overtime_management', 'hrms_core',
            // Additional advance features
            'chat', 'geo_fencing', 'employee_timeline', 'project_tracking', 
            'task_tracking', 'activity_summary', 'break_tracking', 
            'notifications', 'productivity_ratings', 'web_usage_tracking',
            'application_usage_tracking', 'open_api_access', 'ai_integration',
            'support_24hr',
        ],
        
        // Payroll Plans
        'basic_payroll' => [
            // All advance_tracking features
            'desktop_timer', 'check_in_out', 'idle_detection', 'auto_stop',
            'screenshot', 'screenshot_history', 'reports', 'csv_export',
            'user_management', 'overtime', 'approval_workflow', 'overtime_history',
            'workspace_onboarding', 'multi_role_access',
            'tracking_management', 'project_task_management', 'team_management',
            'attendance_management', 'leave_management', 'approval_management',
            'overtime_management', 'hrms_core',
            'chat', 'geo_fencing', 'employee_timeline', 'project_tracking', 
            'task_tracking', 'activity_summary', 'break_tracking', 
            'notifications', 'productivity_ratings', 'web_usage_tracking',
            'application_usage_tracking', 'open_api_access', 'ai_integration',
            'support_24hr',
            // Payroll features
            'payroll', 'payroll_finance', 'payroll_automation', 'statutory_compliance',
            'bank_integration', 'loan_management', 'expense_management',
            'tax_management', 'gratuity_management', 'hrms_organization',
            'employee_onboarding', 'document_management', 'mobile_app',
            'announcements', 'company_news',
        ],
        'professional_payroll' => [
            // All basic_payroll features
            'desktop_timer', 'check_in_out', 'idle_detection', 'auto_stop',
            'screenshot', 'screenshot_history', 'reports', 'csv_export',
            'user_management', 'overtime', 'approval_workflow', 'overtime_history',
            'workspace_onboarding', 'multi_role_access',
            'tracking_management', 'project_task_management', 'team_management',
            'attendance_management', 'leave_management', 'approval_management',
            'overtime_management', 'hrms_core',
            'chat', 'geo_fencing', 'employee_timeline', 'project_tracking', 
            'task_tracking', 'activity_summary', 'break_tracking', 
            'notifications', 'productivity_ratings', 'web_usage_tracking',
            'application_usage_tracking', 'open_api_access', 'ai_integration',
            'support_24hr',
            'payroll', 'payroll_finance', 'payroll_automation', 'statutory_compliance',
            'bank_integration', 'loan_management', 'expense_management',
            'tax_management', 'gratuity_management', 'hrms_organization',
            'employee_onboarding', 'document_management', 'mobile_app',
            'announcements', 'company_news',
            // Professional extras
            'custom_roles', 'performance_management', 'preboarding', 
            'recruitment_ats', 'asset_tracking', 'advanced_analytics',
            'employee_timeline_advanced', 'travel_expense', 'priority_support',
            'sla_support', 'dedicated_manager', 'custom_integrations',
        ],
        
        // Enterprise
        'enterprise' => [
            // All professional_payroll features
            'desktop_timer', 'check_in_out', 'idle_detection', 'auto_stop',
            'screenshot', 'screenshot_history', 'reports', 'csv_export',
            'user_management', 'overtime', 'approval_workflow', 'overtime_history',
            'workspace_onboarding', 'multi_role_access',
            'tracking_management', 'project_task_management', 'team_management',
            'attendance_management', 'leave_management', 'approval_management',
            'overtime_management', 'hrms_core',
            'chat', 'geo_fencing', 'employee_timeline', 'project_tracking', 
            'task_tracking', 'activity_summary', 'break_tracking', 
            'notifications', 'productivity_ratings', 'web_usage_tracking',
            'application_usage_tracking', 'open_api_access', 'ai_integration',
            'support_24hr',
            'payroll', 'payroll_finance', 'payroll_automation', 'statutory_compliance',
            'bank_integration', 'loan_management', 'expense_management',
            'tax_management', 'gratuity_management', 'hrms_organization',
            'employee_onboarding', 'document_management', 'mobile_app',
            'announcements', 'company_news',
            'custom_roles', 'performance_management', 'preboarding', 
            'recruitment_ats', 'asset_tracking', 'advanced_analytics',
            'employee_timeline_advanced', 'travel_expense', 'priority_support',
            'sla_support', 'dedicated_manager', 'custom_integrations',
            // Enterprise extras
            'white_label', 'custom_api', 'dedicated_infrastructure',
        ],
    ];

    public static function hasFeature(Organization $organization, string $feature): bool
    {
        $planCode = $organization->plan_code ?? config('carevance.default_plan', 'basic_tracking');
        $features = self::FEATURES[$planCode] ?? self::FEATURES['basic_tracking'];

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

    public static function calculateWorkspacePrice(string $planCode, int $seats, string $billingCycle): array
    {
        $config = config("carevance.plans.{$planCode}");
        
        if (!$config) {
            throw new \InvalidArgumentException("Invalid plan: {$planCode}");
        }
        
        $monthlyPrice = $config['monthly_price'] ?? 0;
        $yearlyPrice = $config['yearly_price'] ?? 0;
        
        // Calculate base price based on billing cycle
        if ($billingCycle === 'yearly' && $yearlyPrice > 0) {
            $basePrice = $yearlyPrice / 12; // Monthly equivalent
        } else {
            $basePrice = $monthlyPrice;
        }
        
        $includedSeats = $config['max_seats'] ?? 50;
        $extraSeatPrice = $config['extra_seat_price'] ?? 0;
        
        $extraSeats = max(0, $seats - $includedSeats);
        $extraCost = $extraSeats * $extraSeatPrice;
        $totalMonthly = $basePrice + $extraCost;
        
        if ($billingCycle === 'yearly') {
            $total = $totalMonthly * 12;
        } else {
            $total = $totalMonthly;
        }
        
        return [
            'base_price' => $basePrice,
            'included_seats' => $includedSeats,
            'extra_seats' => $extraSeats,
            'extra_cost' => $extraCost,
            'total_monthly' => $totalMonthly,
            'total' => $total,
        ];
    }

    public static function calculatePerUserPrice(string $planCode, int $seats, string $billingCycle): array
    {
        $config = config("carevance.plans.{$planCode}");
        
        if (!$config) {
            throw new \InvalidArgumentException("Invalid plan: {$planCode}");
        }
        
        $monthlyPrice = $config['monthly_price'] ?? 0;
        $yearlyPrice = $config['yearly_price'] ?? 0;
        
        $pricePerUser = $billingCycle === 'yearly' && $yearlyPrice > 0 
            ? $yearlyPrice 
            : $monthlyPrice;
            
        $total = $pricePerUser * $seats;
        
        return [
            'price_per_user' => $pricePerUser,
            'seats' => $seats,
            'total' => $total,
        ];
    }

    public static function isPayrollPlan(string $planCode): bool
    {
        $payrollPlans = ['basic_payroll', 'professional_payroll', 'enterprise'];
        return in_array($planCode, $payrollPlans, true);
    }

    public static function getPlanType(string $planCode): string
    {
        $config = config("carevance.plans.{$planCode}");
        return $config['type'] ?? 'tracking';
    }
}