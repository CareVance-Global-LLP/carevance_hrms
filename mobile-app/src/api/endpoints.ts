import api from './client';
import type {
  AuthResponse,
  EmployeeDashboard,
  GeofenceZone,
  LeaveBalanceResponse,
  LeaveRequest,
  Payslip,
  SelfieRecord,
  TodayAttendance,
  GeoPosition,
  OrgMember,
  Reimbursement,
  ReimbursementSummary,
  TimeEditRequest,
  AppNotification,
  NotificationsResponse,
  Holiday,
} from '../types';

export const authApi = {
  login: (email: string, password: string) =>
    api.post<AuthResponse>('/auth/login', { email, password }),
  me: () =>
    api.get<{ user: any }>('/auth/me'),
  logout: () =>
    api.post('/auth/logout'),
};

export const dashboardApi = {
  summary: () =>
    api.get<EmployeeDashboard>('/employee/dashboard'),
};

export const timeEntryApi = {
  start: (position?: GeoPosition) =>
    api.post<any>('/time-entries/start', {
      timer_slot: 'primary',
      latitude: position?.latitude,
      longitude: position?.longitude,
      accuracy: position?.accuracy,
    }),
  stop: (position?: GeoPosition) =>
    api.post<any>('/time-entries/stop', {
      timer_slot: 'primary',
      latitude: position?.latitude,
      longitude: position?.longitude,
      accuracy: position?.accuracy,
    }),
};

export const attendanceApi = {
  today: () =>
    api.get<{ record: TodayAttendance | null }>('/attendance/today'),
  checkIn: (position?: GeoPosition) =>
    api.post('/attendance/check-in', {
      latitude: position?.latitude,
      longitude: position?.longitude,
      accuracy: position?.accuracy,
    }),
  checkOut: (position?: GeoPosition) =>
    api.post('/attendance/check-out', {
      latitude: position?.latitude,
      longitude: position?.longitude,
      accuracy: position?.accuracy,
    }),
};

export const selfieApi = {
  checkToday: () =>
    api.get<{ uploaded: boolean; selfie?: SelfieRecord }>('/attendance/selfies/today'),
  upload: (base64: string, position: GeoPosition) => {
    const dataUri = `data:image/jpeg;base64,${base64}`;
    return api.post<{ message: string; selfie: SelfieRecord }>('/attendance/selfie', {
      image: dataUri,
      latitude: position.latitude,
      longitude: position.longitude,
      accuracy: position.accuracy,
    }, { timeout: 60000 });
  },
};

export const geofenceApi = {
  zones: () =>
    api.get<{ data: GeofenceZone[] }>('/geofence/zones'),
  verify: (position: GeoPosition) =>
    api.post<{ inside_zone: boolean; zone: GeofenceZone | null }>('/geofence/verify', {
      latitude: position.latitude,
      longitude: position.longitude,
      accuracy: position.accuracy,
    }),
};

export const leaveApi = {
  balance: () =>
    api.get<LeaveBalanceResponse>('/leave-requests/balances'),
  list: (page = 1) =>
    api.get<{ data: LeaveRequest[]; meta: { last_page: number } }>('/leave-requests', {
      params: { page },
    }),
  apply: (data: {
    leave_category: string;
    start_date: string;
    end_date: string;
    reason: string;
  }) => api.post<{ data: LeaveRequest }>('/leave-requests', data),
};

export const payslipApi = {
  list: () =>
    api.get<{ data: Payslip[] }>('/payroll/my/payslips'),
};

export const orgApi = {
  members: () =>
    api.get<OrgMember[]>('/me/team-members'),
};

export const holidayApi = {
  list: (month?: string) =>
    api.get<{ data: Holiday[] }>('/attendance/holidays', { params: month ? { month } : {} }),
};

export const reimbursementApi = {
  list: () =>
    api.get<{ data: Reimbursement[] }>('/payroll/reimbursements'),
  show: (id: number) =>
    api.get<{ data: Reimbursement }>(`/payroll/reimbursements/${id}`),
  create: (data: {
    category: string;
    amount: number;
    currency: string;
    expense_date: string;
    description: string;
    receipt_url?: string;
    merchant_name?: string;
    location?: string;
  }) => api.post<{ message: string; reimbursement: Reimbursement }>('/payroll/reimbursements', data),
  update: (id: number, data: Partial<{
    category: string;
    amount: number;
    currency: string;
    expense_date: string;
    description: string;
    receipt_url?: string;
    merchant_name?: string;
    location?: string;
  }>) => api.put<{ message: string; reimbursement: Reimbursement }>(`/payroll/reimbursements/${id}`, data),
  approve: (id: number, notes?: string) =>
    api.post<{ message: string; reimbursement: Reimbursement }>(`/payroll/reimbursements/${id}/approve`, { notes }),
  reject: (id: number, notes: string) =>
    api.post<{ message: string; reimbursement: Reimbursement }>(`/payroll/reimbursements/${id}/reject`, { notes }),
  summary: () =>
    api.get<ReimbursementSummary>('/payroll/reimbursements/summary'),
};

export const timeEditApi = {
  list: () =>
    api.get<{ data: TimeEditRequest[] }>('/attendance-time-edit-requests'),
  create: (data: {
    attendance_date: string;
    extra_minutes: number;
    message?: string;
  }) => api.post<{ message: string; data: TimeEditRequest }>('/attendance-time-edit-requests', data),
};

export const notificationApi = {
  list: (type?: string) =>
    api.get<NotificationsResponse>('/notifications', { params: type ? { type } : {} }),
  markRead: (id: number) =>
    api.post(`/notifications/${id}/read`),
  markAllRead: () =>
    api.post('/notifications/read-all'),
  publish: (data: {
    type: 'announcement' | 'news' | 'poll';
    title?: string;
    message?: string;
    priority?: 'low' | 'medium' | 'high' | 'urgent';
    question?: string;
    options?: string[];
    is_multiple_choice?: boolean;
    expires_at?: string;
    recipient_user_ids?: number[];
  }) => api.post('/notifications/publish', data),
  registerDevice: (token: string, platform: string) =>
    api.post('/notifications/register-device', { token, platform }),
  votePoll: (pollId: number, optionIds: number[]) =>
    api.post(`/polls/${pollId}/vote`, { option_ids: optionIds }),
  getPollResults: (pollId: number) =>
    api.get<{ data: any[]; total_votes: number; is_multiple_choice: boolean; has_expired: boolean }>(`/polls/${pollId}/results`),
};

export const compOffApi = {
  balance: (year?: string) =>
    api.get<any>('/comp-off/balance', { params: year ? { year } : {} }),
  transactions: () =>
    api.get<{ data: any[] }>('/comp-off/transactions'),
  summary: () =>
    api.get<any>('/comp-off/summary'),
};

export const approvalApi = {
  pendingLeaves: () =>
    api.get<{ data: LeaveRequest[] }>('/leave-requests', { params: { status: 'pending' } }),
  pendingTimeEdits: () =>
    api.get<{ data: TimeEditRequest[] }>('/attendance-time-edit-requests', { params: { status: 'pending' } }),
  approveLeave: (id: number, review_note?: string) =>
    api.patch(`/leave-requests/${id}/approve`, { review_note }),
  rejectLeave: (id: number, review_note: string) =>
    api.patch(`/leave-requests/${id}/reject`, { review_note }),
  approveTimeEdit: (id: number, review_note?: string) =>
    api.patch(`/attendance-time-edit-requests/${id}/approve`, { review_note }),
  rejectTimeEdit: (id: number, review_note: string) =>
    api.patch(`/attendance-time-edit-requests/${id}/reject`, { review_note }),
  approveReimbursement: (id: number, notes?: string) =>
    api.post(`/payroll/reimbursements/${id}/approve`, { notes }),
  rejectReimbursement: (id: number, notes: string) =>
    api.post(`/payroll/reimbursements/${id}/reject`, { notes }),
};
