import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { payrollApi } from '@/services/api';

export type SetupStepId =
  | 'welcome'
  | 'defaults'
  | 'departments'
  | 'employees'
  | 'compliance'
  | 'statutory'
  | 'pay_schedule'
  | 'bank'
  | 'test_run';

export interface PayrollOnboardingStatus {
  onboarded: boolean;
  dismissed_at: string | null;
  first_run_at: string | null;
  first_filing_at: string | null;
  steps: Record<string, boolean>;
  completed_steps: string[];
  next_action: string;
  completion_percentage: number;
  completed_count: number;
  total_count: number;
  has_payroll_run: boolean;
  has_filings: boolean;
  employees_with_ctc: number;
  employees_total: number;
  step_labels: Record<string, string>;
}

const ONBOARDING_KEY = ['payroll', 'onboarding-status'] as const;

/**
 * Hook that surfaces the payroll onboarding state for the current org.
 * Used to drive the "Next Steps" card and the page-based setup flow.
 */
export function usePayrollOnboarding() {
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ONBOARDING_KEY,
    queryFn: () => payrollApi.getOnboardingStatus().then(res => res.data),
    staleTime: 30_000,
  });

  const markDefaultsMutation = useMutation({
    mutationFn: () => payrollApi.markDefaultsConfigured(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ONBOARDING_KEY }),
  });

  const markSetupStepMutation = useMutation({
    mutationFn: (step: SetupStepId) => payrollApi.markSetupStep(step),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ONBOARDING_KEY }),
  });

  const unmarkSetupStepMutation = useMutation({
    mutationFn: (step: SetupStepId) => payrollApi.unmarkSetupStep(step),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ONBOARDING_KEY }),
  });

  const markWelcomeSeenMutation = useMutation({
    mutationFn: () => payrollApi.markWelcomeSeen(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ONBOARDING_KEY }),
  });

  const dismissMutation = useMutation({
    mutationFn: () => payrollApi.dismissOnboarding(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ONBOARDING_KEY }),
  });

  const reopenMutation = useMutation({
    mutationFn: () => payrollApi.reopenOnboarding(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ONBOARDING_KEY }),
  });

  const status: PayrollOnboardingStatus | undefined = data
    ? ({ ...(data as Record<string, any>) } as PayrollOnboardingStatus)
    : undefined;

  const isFirstTime = !isLoading && !status?.onboarded && !status?.dismissed_at;
  const showNextSteps = !!status && !status.onboarded;
  const setupComplete = !!status?.onboarded;

  return {
    status,
    isLoading,
    error,
    refetch,
    isFirstTime,
    showNextSteps,
    setupComplete,
    markDefaults: markDefaultsMutation.mutateAsync,
    markSetupStep: markSetupStepMutation.mutateAsync,
    unmarkSetupStep: unmarkSetupStepMutation.mutateAsync,
    markWelcomeSeen: markWelcomeSeenMutation.mutateAsync,
    dismiss: dismissMutation.mutateAsync,
    reopen: reopenMutation.mutateAsync,
    isMutating:
      markDefaultsMutation.isPending ||
      markSetupStepMutation.isPending ||
      unmarkSetupStepMutation.isPending ||
      markWelcomeSeenMutation.isPending ||
      dismissMutation.isPending ||
      reopenMutation.isPending,
  };
}
