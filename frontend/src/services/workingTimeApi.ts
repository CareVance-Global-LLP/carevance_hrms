import api from '@/services/api';

/**
 * Working time: the four policies a shift used to be overloaded with.
 *
 * Kept out of api.ts for the same reason shiftsApi is — that file is one
 * shared export surface every screen edits, and a new domain does not need to
 * widen it.
 *
 * All four kinds have an identical route shape, so they share one factory. The
 * only thing that varies is the path segment and the row type; writing four
 * near-identical objects would guarantee that the fifth change to one of them
 * missed the other three.
 */

export type PolicyKind = 'weekly-off' | 'penalisation' | 'overtime' | 'shift-allowance';

interface PolicyBase {
  id: number;
  organization_id: number;
  name: string;
  description: string | null;
  is_default: boolean;
  is_active: boolean;
  assigned_count: number;
}

export interface WeeklyOffPolicySummary extends PolicyBase {
  /** Weekday => "every" | ordinals | {mode:'alternate',…}. Read through weeklyOff.ts. */
  day_rules: Record<string, unknown> | null;
}

export interface HalfDayRuleRow {
  id: number;
  sort_order: number;
  /** decimal:2 on the server, so a string on the wire. */
  percent_of_shift_hours: string;
  leaves_deducted: string;
}

export interface PenalisationPolicySummary extends PolicyBase {
  grace_period_minutes: number;
  late_rule_type: 'incident' | 'hours';
  late_threshold: string;
  exemptions_per_cycle: number;
  cycle: 'weekly' | 'monthly';
  ignore_late_when_hours_met: boolean;
  hours_basis: 'gross' | 'effective';
  /** Null means the organization runs no no-show rule, not a bar of zero. */
  no_show_below_hours: string | null;
  treat_penalties_as_lop: boolean;
  half_day_rules: HalfDayRuleRow[];
}

export interface OvertimeScopeRow {
  id: number;
  scope: 'working_day' | 'weekly_off' | 'holiday';
  treatment: 'pay' | 'comp_off';
  multiplier: string;
  applies_after_minutes: number;
  effective_from: string | null;
  effective_to: string | null;
}

export interface OvertimePolicySummary extends PolicyBase {
  hours_basis: 'gross' | 'effective';
  minimum_minutes_before_accrual: number;
  rounding: 'up' | 'down' | 'nearest';
  rounding_increment_minutes: number;
  requires_approval: boolean;
  pay_code: string | null;
  scopes: OvertimeScopeRow[];
}

export interface ShiftAllowancePolicySummary extends PolicyBase {
  night_allowance_type: 'none' | 'percentage' | 'fixed';
  night_percentage: string;
  night_fixed: string;
  /** H:i:s, or null. A wall-clock reading with no date — it crosses midnight. */
  night_window_start: string | null;
  night_window_end: string | null;
  night_minimum_minutes_in_window: number;
  weekend_allowance_type: 'none' | 'percentage' | 'fixed';
  weekend_percentage: string;
  weekend_fixed: string;
}

export interface PolicyAssignment {
  id: number;
  organization_id: number;
  user_id: number;
  /** date:Y-m-d on the server, so a calendar date reaches us intact. */
  effective_from: string;
  effective_to: string | null;
  is_active: boolean;
  policy?: { id: number; name: string } | null;
  user?: { id: number; name: string; email: string } | null;
}

export interface PolicyEndpoints<TPolicy> {
  kind: PolicyKind;
  list: () => Promise<{ data: { data: TPolicy[] } }>;
  create: (payload: Record<string, unknown>) => Promise<{ data: { data: TPolicy } }>;
  update: (id: number, payload: Record<string, unknown>) => Promise<{ data: { data: TPolicy } }>;
  remove: (id: number) => Promise<{ data: { message: string } }>;
  assignments: (params?: { user_id?: number; policy_id?: number }) => Promise<{
    data: { data: PolicyAssignment[] };
  }>;
  assign: (payload: {
    user_id: number;
    policy_id: number;
    effective_from: string;
    effective_to?: string | null;
  }) => Promise<{ data: { data: PolicyAssignment } }>;
  unassign: (id: number) => Promise<{ data: { message: string } }>;
}

const endpointsFor = <TPolicy>(kind: PolicyKind): PolicyEndpoints<TPolicy> => {
  const root = `/working-time/${kind}-policies`;

  return {
    kind,
    list: () => api.get<{ data: TPolicy[] }>(root),
    create: (payload) => api.post<{ data: TPolicy }>(root, payload),
    update: (id, payload) => api.put<{ data: TPolicy }>(`${root}/${id}`, payload),
    remove: (id) => api.delete<{ message: string }>(`${root}/${id}`),
    assignments: (params) => api.get<{ data: PolicyAssignment[] }>(`${root}/assignments`, { params }),
    assign: (payload) => api.post<{ data: PolicyAssignment }>(`${root}/assignments`, payload),
    unassign: (id) => api.delete<{ message: string }>(`${root}/assignments/${id}`),
  };
};

export const weeklyOffPolicyApi = endpointsFor<WeeklyOffPolicySummary>('weekly-off');
export const penalisationPolicyApi = endpointsFor<PenalisationPolicySummary>('penalisation');
export const overtimePolicyApi = endpointsFor<OvertimePolicySummary>('overtime');
export const shiftAllowancePolicyApi = endpointsFor<ShiftAllowancePolicySummary>('shift-allowance');

/** What one person is actually on for one date, with the source of each answer. */
export interface MyWorkingTimePolicies {
  date: string;
  user_id: number;
  weekly_off: { source: string; policy: WeeklyOffPolicySummary | null } | null;
  penalisation: { source: string; policy: PenalisationPolicySummary | null } | null;
  overtime: { source: string; policy: OvertimePolicySummary | null } | null;
  shift_allowance: { source: string; policy: ShiftAllowancePolicySummary | null } | null;
}

export const myWorkingTimePolicies = (params?: {
  date?: string;
  user_id?: number;
  base_amount?: string;
}) => api.get<MyWorkingTimePolicies>('/working-time/my-policies', { params });

export default {
  weeklyOffPolicyApi,
  penalisationPolicyApi,
  overtimePolicyApi,
  shiftAllowancePolicyApi,
  myWorkingTimePolicies,
};
