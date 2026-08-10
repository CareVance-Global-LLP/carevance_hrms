import api from './api';

export interface BreakTypeSummary {
  id: number;
  name: string;
  is_paid: boolean;
}

export interface BreakType extends BreakTypeSummary {
  /** null = no daily allowance for this type. */
  max_minutes_per_day: number | null;
  used_seconds_today: number;
}

export interface AdminBreakType {
  id: number;
  organization_id: number;
  name: string;
  is_paid: boolean;
  max_minutes_per_day: number | null;
  is_active: boolean;
}

export interface BreakTime {
  id: number;
  organization_id: number;
  user_id: number;
  break_date: string;
  start_at: string;
  end_at: string | null;
  duration_seconds: number;
  reason: string | null;
  break_type_id?: number | null;
  break_type?: BreakTypeSummary | null;
  created_at: string;
  updated_at: string;
  user?: { id: number; name: string };
}

interface TodayResponse {
  breaks: BreakTime[];
  active_break: BreakTime | null;
  total_break_seconds: number;
}

interface HistoryResponse {
  breaks: BreakTime[];
  total_break_seconds: number;
  user_id: number;
  date: string;
}

export const breakTrackingApi = {
  getToday: () => api.get<TodayResponse>('/breaks/today').then(r => r.data),

  getHistory: (params?: { date?: string; user_id?: number }) =>
    api.get<HistoryResponse>('/breaks/history', { params }).then(r => r.data),

  /** Org break types plus how much of each the caller has used today. */
  getTypes: () =>
    api.get<{ types: BreakType[] }>('/breaks/types').then(r => r.data.types),

  /**
   * breakTypeId is the current path; the free-text reason remains only so old
   * call sites keep compiling until they are migrated.
   */
  startBreak: (options?: { breakTypeId?: number; reason?: string }) =>
    api.post<{ message: string; break: BreakTime }>('/breaks/start', {
      ...(options?.breakTypeId ? { break_type_id: options.breakTypeId } : {}),
      ...(options?.reason ? { reason: options.reason } : {}),
    }).then(r => r.data),

  endBreak: () =>
    api.post<{ message: string; break: BreakTime; total_break_seconds: number }>('/breaks/end').then(r => r.data),

  deleteBreak: (id: number) =>
    api.delete<{ message: string }>(`/breaks/${id}`).then(r => r.data),

  // Admin-only management. The server enforces the admin check; these exist so
  // the Settings surface has a typed client.
  createType: (payload: { name: string; is_paid: boolean; max_minutes_per_day?: number | null }) =>
    api.post<AdminBreakType>('/breaks/types', payload).then(r => r.data),

  updateType: (id: number, payload: Partial<Pick<AdminBreakType, 'name' | 'is_paid' | 'max_minutes_per_day' | 'is_active'>>) =>
    api.put<AdminBreakType>(`/breaks/types/${id}`, payload).then(r => r.data),

  deactivateType: (id: number) =>
    api.delete<{ message: string }>(`/breaks/types/${id}`).then(r => r.data),
};
