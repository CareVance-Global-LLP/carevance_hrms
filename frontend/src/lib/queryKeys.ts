export const queryKeys = {
  groups: ['groups'] as const,
  projects: ['projects'] as const,
  tasks: ['tasks'] as const,
  taskLabels: ['task-labels'] as const,
  invoices: ['invoices'] as const,
  users: (params?: Record<string, unknown>) => ['users', params ?? {}] as const,
  reportGroups: ['report-groups'] as const,
  reports: (params: Record<string, unknown>) => ['reports', params] as const,
};
