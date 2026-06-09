import api from './api';

export interface BreakTime {
  id: number;
  organization_id: number;
  user_id: number;
  break_date: string;
  start_at: string;
  end_at: string | null;
  duration_seconds: number;
  reason: string | null;
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

  startBreak: (reason?: string) =>
    api.post<{ message: string; break: BreakTime }>('/breaks/start', { reason }).then(r => r.data),

  endBreak: () =>
    api.post<{ message: string; break: BreakTime; total_break_seconds: number }>('/breaks/end').then(r => r.data),

  deleteBreak: (id: number) =>
    api.delete<{ message: string }>(`/breaks/${id}`).then(r => r.data),
};
