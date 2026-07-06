<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        // Map old plan codes to new plan codes
        $planMapping = [
            'basic' => 'basic_tracking',
            'advanced_tracker' => 'advance_tracking',
            'enterprise' => 'professional_payroll',
        ];

        foreach ($planMapping as $oldCode => $newCode) {
            DB::table('organizations')
                ->where('plan_code', $oldCode)
                ->update(['plan_code' => $newCode]);
        }

        // Insert new plans into plans table
        $plans = [
            [
                'code' => 'basic_tracking',
                'name' => 'Basic Tracking',
                'description' => 'Essential time tracking and HR features for growing teams.',
                'price_monthly' => 399,
                'price_yearly' => 4319, // Monthly equivalent for comparison
                'max_employees' => -1,
                'features' => json_encode([
                    'desktop_timer', 'check_in_out', 'idle_detection', 'auto_stop',
                    'screenshot', 'screenshot_history', 'reports', 'csv_export',
                    'user_management', 'overtime', 'approval_workflow', 'overtime_history',
                    'workspace_onboarding', 'multi_role_access',
                    'tracking_management', 'project_task_management', 'team_management',
                    'attendance_management', 'leave_management', 'approval_management',
                    'overtime_management', 'hrms_core',
                ]),
                'is_active' => true,
                'is_popular' => false,
                'display_order' => 1,
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'code' => 'advance_tracking',
                'name' => 'Advance Tracking',
                'description' => 'Full tracking with screenshots, automation, and advanced productivity features.',
                'price_monthly' => 599,
                'price_yearly' => 6479,
                'max_employees' => -1,
                'features' => json_encode([
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
                ]),
                'is_active' => true,
                'is_popular' => true,
                'display_order' => 2,
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'code' => 'basic_payroll',
                'name' => 'Basic Payroll',
                'description' => 'Complete HR + Payroll automation with compliance for teams.',
                'price_monthly' => 3999,
                'price_yearly' => 43189, // 10% discount
                'max_employees' => 50,
                'features' => json_encode([
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
                ]),
                'is_active' => true,
                'is_popular' => false,
                'display_order' => 3,
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'code' => 'professional_payroll',
                'name' => 'Professional Payroll',
                'description' => 'Full suite with advanced HRMS, analytics, and dedicated support.',
                'price_monthly' => 5999,
                'price_yearly' => 64789, // 10% discount
                'max_employees' => 50,
                'features' => json_encode([
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
                ]),
                'is_active' => true,
                'is_popular' => true,
                'display_order' => 4,
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'code' => 'enterprise',
                'name' => 'Enterprise',
                'description' => 'Custom solution with dedicated support, SLA, and white-label options.',
                'price_monthly' => 0,
                'price_yearly' => 0,
                'max_employees' => -1,
                'features' => json_encode([
                    'all_professional_features', 'white_label', 'custom_api', 
                    'dedicated_infrastructure', 'dedicated_account_manager',
                    'custom_slack_integration', 'priority_phone_support',
                ]),
                'is_active' => true,
                'is_popular' => false,
                'display_order' => 5,
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ];

        foreach ($plans as $plan) {
            DB::table('plans')->insertOrIgnore($plan);
        }

        // Update organizations table - add extra_seat_price for payroll plans
        Schema::table('organizations', function (Blueprint $table) {
            if (!Schema::hasColumn('organizations', 'extra_seat_price')) {
                $table->integer('extra_seat_price')->nullable()->after('max_seats');
            }
            if (!Schema::hasColumn('organizations', 'pending_effective_date')) {
                $table->timestamp('pending_effective_date')->nullable()->after('pending_upgrade_amount');
            }
            if (!Schema::hasColumn('organizations', 'pending_downgrade')) {
                $table->boolean('pending_downgrade')->default(false)->after('pending_effective_date');
            }
            if (!Schema::hasColumn('organizations', 'pending_seat_reduction')) {
                $table->boolean('pending_seat_reduction')->default(false)->after('pending_downgrade');
            }
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        // Reverse plan code mapping
        $reverseMapping = [
            'basic_tracking' => 'basic',
            'advance_tracking' => 'advanced_tracker',
            'professional_payroll' => 'enterprise',
        ];

        foreach ($reverseMapping as $newCode => $oldCode) {
            DB::table('organizations')
                ->where('plan_code', $newCode)
                ->update(['plan_code' => $oldCode]);
        }

        // Remove new plans
        DB::table('plans')->whereIn('code', [
            'basic_tracking',
            'advance_tracking', 
            'basic_payroll',
            'professional_payroll',
        ])->delete();

        // Drop added columns
        Schema::table('organizations', function (Blueprint $table) {
            $table->dropColumnIfExists('extra_seat_price');
            $table->dropColumnIfExists('pending_effective_date');
            $table->dropColumnIfExists('pending_downgrade');
            $table->dropColumnIfExists('pending_seat_reduction');
        });
    }
};