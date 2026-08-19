import api from '@/services/api';

/**
 * The shift catalogue and the roster.
 *
 * Kept out of api.ts on purpose: that file is one shared export surface that
 * every screen edits, and a new domain does not need to widen it.
 */

export interface ShiftSummary {
  id: number;
  organization_id: number;
  name: string;
  code: string;
  type: 'general' | 'morning' | 'evening' | 'night' | 'rotating';
  description: string | null;
  /** Always H:i:s — the server normalises both Postgres and SQLite readings. */
  start_time: string;
  end_time: string;
  duration_minutes: number;
  break_duration_minutes: number;
  grace_period_minutes: number;
  early_exit_grace_minutes: number;
  is_night_shift: boolean;
  is_active: boolean;
  applicable_days: string[] | null;
  /** Clock-in to clock-out, breaks included. */
  span_minutes: number;
  /** Span less the unpaid break — what replaces the eight-hour constant. */
  expected_work_seconds: number;
  crosses_midnight: boolean;
  assigned_count: number;
}

export interface ShiftAssignment {
  id: number;
  organization_id: number;
  user_id: number;
  shift_id: number;
  /** date:Y-m-d on the server, so a plain calendar date reaches us intact. */
  effective_from: string;
  effective_to: string | null;
  is_active: boolean;
  custom_differential_rate: string | null;
  shift?: Pick<ShiftSummary, 'id' | 'name' | 'code' | 'type' | 'start_time' | 'end_time'> | null;
  user?: { id: number; name: string; email: string } | null;
}

/** One shift INSTANCE: the pattern plus the date it is being run on. */
export interface ResolvedShift {
  attendance_date: string;
  source: 'assignment' | 'work_info_shift' | 'work_info_time';
  shift_id: number | null;
  shift_name: string | null;
  shift_code: string | null;
  starts_at: string | null;
  ends_at: string | null;
  crosses_midnight: boolean;
  /** Null means "we know when they start, not how long they work". */
  expected_seconds: number | null;
}

export const shiftsApi = {
  list: () => api.get<{ data: ShiftSummary[] }>('/shifts'),

  create: (payload: Record<string, unknown>) => api.post<{ data: ShiftSummary }>('/shifts', payload),

  update: (id: number, payload: Record<string, unknown>) =>
    api.put<{ data: ShiftSummary }>(`/shifts/${id}`, payload),

  remove: (id: number) => api.delete<{ message: string }>(`/shifts/${id}`),

  /** The caller's own shift, or a colleague's when they may manage rosters. */
  mine: (params?: { date?: string; user_id?: number }) =>
    api.get<{ data: ResolvedShift | null; user_id: number }>('/shifts/my', { params }),

  assignments: (params?: { user_id?: number; shift_id?: number }) =>
    api.get<{ data: ShiftAssignment[] }>('/shifts/assignments', { params }),

  assign: (payload: {
    user_id: number;
    shift_id: number;
    effective_from: string;
    effective_to?: string | null;
  }) => api.post<{ data: ShiftAssignment }>('/shifts/assignments', payload),

  unassign: (id: number) => api.delete<{ message: string }>(`/shifts/assignments/${id}`),
};

export default shiftsApi;
