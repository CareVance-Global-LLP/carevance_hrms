import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { workspaceOnboardingApi, WorkspaceOnboardingStatus } from '@/services/api';

const ONBOARDING_KEY = ['workspace', 'onboarding-status'] as const;

/**
 * The workspace setup checklist a new owner sees on the dashboard.
 *
 * Deliberately the same shape as usePayrollOnboarding — same query key style,
 * same invalidate-on-success mutations — because the two cards sit next to each
 * other and the payroll steps are folded into this one when the plan grants
 * payroll.
 */
export function useWorkspaceOnboarding() {
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ONBOARDING_KEY,
    queryFn: () => workspaceOnboardingApi.getStatus().then((res) => res.data),
    staleTime: 30_000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ONBOARDING_KEY });

  const markStepMutation = useMutation({
    mutationFn: (step: string) => workspaceOnboardingApi.markStep(step),
    onSuccess: invalidate,
  });

  const dismissMutation = useMutation({
    mutationFn: () => workspaceOnboardingApi.dismiss(),
    onSuccess: invalidate,
  });

  const reopenMutation = useMutation({
    mutationFn: () => workspaceOnboardingApi.reopen(),
    onSuccess: invalidate,
  });

  const markTourSeenMutation = useMutation({
    mutationFn: () => workspaceOnboardingApi.markTourSeen(),
    onSuccess: invalidate,
  });

  const status: WorkspaceOnboardingStatus | undefined = data;

  return {
    status,
    isLoading,
    error,
    refetch,
    // Hidden once every step is done or the owner has dismissed it — a checklist
    // that never goes away stops reading as progress and starts reading as nag.
    isVisible: !isLoading && !!status && !status.onboarded && !status.dismissed_at,
    hasSeenTour: !!status?.tour_seen_at,
    markStep: markStepMutation.mutateAsync,
    dismiss: dismissMutation.mutateAsync,
    reopen: reopenMutation.mutateAsync,
    markTourSeen: markTourSeenMutation.mutateAsync,
    isMutating:
      markStepMutation.isPending
      || dismissMutation.isPending
      || reopenMutation.isPending
      || markTourSeenMutation.isPending,
  };
}
