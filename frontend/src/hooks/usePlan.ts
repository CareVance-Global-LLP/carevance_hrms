import { useCallback, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { payrollEnabled } from '@/lib/runtimeConfig';

const PLAN_FEATURES: Record<string, string[]> = {
  // Tracking Plans - Basic: Only core tracking and attendance features
  basic_tracking: [
    // Automatic Tracking
    'desktop_timer',
    // Screenshots Online/Offline
    'screenshot',
    'screenshot_history',
    // Project & Task
    'project_tracking',
    'task_tracking',
    // Attendance & Leave
    'attendance_management',
    'leave_management',
    'overtime',
    'overtime_management',
    'approval_workflow',
    'approval_management',
    // Basic exports
    'reports',
    'csv_export',
    // Basic user management
    'user_management',
    'workspace_onboarding',
  ],
  advance_tracking: [
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
    'tracking_management', 'project_task_management', 'team_management',
    'attendance_management', 'leave_management', 'approval_management',
    'overtime_management', 'hrms_core',
    'chat', 'geo_fencing', 'employee_timeline', 'project_tracking', 
    'task_tracking', 'activity_summary', 'break_tracking', 
    'notifications', 'productivity_ratings', 'web_usage_tracking',
    'application_usage_tracking', 'open_api_access', 'ai_integration',
    'support_24hr', 'monitoring',
  ],
  
  // Payroll Plans
  basic_payroll: [
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
    'support_24hr', 'monitoring',
    'payroll', 'payroll_finance', 'payroll_automation', 'statutory_compliance',
    'bank_integration', 'loan_management', 'expense_management',
    'tax_management', 'gratuity_management', 'hrms_organization',
    'employee_onboarding', 'document_management', 'mobile_app',
    'announcements', 'company_news',
  ],
  professional_payroll: [
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
    'support_24hr', 'monitoring',
    'payroll', 'payroll_finance', 'payroll_automation', 'statutory_compliance',
    'bank_integration', 'loan_management', 'expense_management',
    'tax_management', 'gratuity_management', 'hrms_organization',
    'employee_onboarding', 'document_management', 'mobile_app',
    'announcements', 'company_news',
    'custom_roles', 'performance_management', 'preboarding', 
    'recruitment_ats', 'asset_tracking', 'advanced_analytics',
    'employee_timeline_advanced', 'travel_expense', 'priority_support',
    'sla_support', 'dedicated_manager', 'custom_integrations',
  ],
  enterprise: [
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
    'application_usage_access', 'open_api_access', 'ai_integration',
    'support_24hr', 'monitoring',
    'payroll', 'payroll_finance', 'payroll_automation', 'statutory_compliance',
    'bank_integration', 'loan_management', 'expense_management',
    'tax_management', 'gratuity_management', 'hrms_organization',
    'employee_onboarding', 'document_management', 'mobile_app',
    'announcements', 'company_news',
    'custom_roles', 'performance_management', 'preboarding', 
    'recruitment_ats', 'asset_tracking', 'advanced_analytics',
    'employee_timeline_advanced', 'travel_expense', 'priority_support',
    'sla_support', 'dedicated_manager', 'custom_integrations',
    'white_label', 'custom_api', 'dedicated_infrastructure',
  ],
  
  // Legacy support
  basic: [
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
  advanced_tracker: [
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
    'monitoring',
  ],
};

// Helper to check if a plan is a payroll plan
const PAYROLL_PLANS = ['basic_payroll', 'professional_payroll', 'enterprise'];

export function usePlan() {
  const { organization } = useAuth();

  const planCode = organization?.plan_code || 'basic_tracking';
  const maxSeats = organization?.max_seats ?? 5;
  const isTrial = organization?.subscription_status === 'trial';
  const effectivePlanCode = planCode;
  const features = PLAN_FEATURES[effectivePlanCode] || PLAN_FEATURES.basic_tracking;
  const isPayrollPlan = PAYROLL_PLANS.includes(effectivePlanCode);

  const hasFeature = useCallback(
    (feature: string) => {
      if (feature === 'payroll' && payrollEnabled) return true;
      return features.includes(feature);
    },
    [features]
  );

  return useMemo(() => ({
    planCode,
    maxSeats,
    hasFeature,
    isTrial,
    isPayrollPlan,
  }), [planCode, maxSeats, hasFeature, isTrial, isPayrollPlan]);
}