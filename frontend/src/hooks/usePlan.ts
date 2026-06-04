import { useCallback, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { payrollEnabled } from '@/lib/runtimeConfig';

const PLAN_FEATURES: Record<string, string[]> = {
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
  enterprise: [
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
    'payroll',
  ],
};

export function usePlan() {
  const { organization } = useAuth();

  const planCode = organization?.plan_code || 'basic';
  const maxSeats = organization?.max_seats ?? 5;
  const isTrial = organization?.subscription_status === 'trial';
  // Trial users should get features from their selected plan (e.g., advanced_tracker), not force basic
  const effectivePlanCode = planCode;
  const features = PLAN_FEATURES[effectivePlanCode] || PLAN_FEATURES.basic;

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
  }), [planCode, maxSeats, hasFeature, isTrial]);
}
