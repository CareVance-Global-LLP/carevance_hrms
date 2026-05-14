import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import { clearAuthStorage, getStoredAuthValue } from '@/lib/authStorage';
import type { 
  LoginRequest, 
  RegisterRequest, 
  OwnerSignupRequest,
  AuthResponse,
  ApiResponse,
  ForgotPasswordRequest,
  ResetPasswordRequest,
  PasswordResetTokenValidationResponse,
  User,
  Organization,
  Group,
  Project,
  Task,
  TimeEntry,
  Screenshot,
  Activity,
  ActivitySession,
  BrowserTrackingConnectionSyncRecord,
  BrowserTrackingConnectionSyncRequest,
  ProductivityRule,
  Invoice,
  DailyReport,
  WeeklyReport,
  ChatConversation,
  ChatGroup,
  ChatGroupMessage,
  ChatMessage,
  ChatTypingUser,
  ChatUnreadSummary,
  AppNotificationItem,
  UserProfile360,
  EmployeeWorkspacePayload,
  EmployeeProfileDetails,
  EmployeeWorkInfo,
  EmployeeGovernmentIdRecord,
  EmployeeBankAccountRecord,
  EmployeeDocumentRecord,
  PaginatedResponse,
  InvitationSummary,
  InvitationListResponse,
  InvitationCreateResponse,
  InviteValidationResponse,
  BillingSnapshot,
  BugReportRequest,
  BugReportResponse,
  PayrollAdjustment,
  PayrollProfile,
  PayrollRecord,
  PayrollReportsPayload,
  PayrollRun,
  PayrollSettingsPayload,
  PayrollTransaction,
  SalaryComponentMaster,
  SalaryTemplate,
} from '@/types';
import { apiUrl } from '@/lib/runtimeConfig';

const api = axios.create({
  baseURL: apiUrl,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  },
});

// Request interceptor to add auth token
api.interceptors.request.use((config) => {
  const token = getStoredAuthValue('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  
  // Add request timeout for better error handling
  config.timeout = config.timeout || 30000; // 30 seconds default
  config.timeoutErrorMessage = 'Request timed out. Please check your connection.';
  
  return config;
});

// Response interceptor to handle errors
api.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    const status = error.response?.status;
    const errorCode = (error.response?.data as any)?.error_code;
    
    // Handle authentication errors
    if (status === 401 || errorCode === 'UNAUTHORIZED') {
      clearAuthStorage();
      window.dispatchEvent(new Event('app:auth-cleared'));
      // Don't reject - let the component handle the redirect
      return Promise.reject(error);
    }
    
    // Handle forbidden errors
    if (status === 403 || errorCode === 'FORBIDDEN') {
      console.error('Access forbidden:', error.response?.data?.message || 'You do not have permission to perform this action');
      return Promise.reject(error);
    }
    
    // Handle validation errors
    if (status === 422 || errorCode === 'VALIDATION_ERROR') {
      // Let the component handle validation errors
      return Promise.reject(error);
    }
    
    // Handle rate limiting
    if (status === 429 || errorCode === 'TOO_MANY_REQUESTS') {
      console.error('Rate limit exceeded. Please try again later.');
      return Promise.reject(error);
    }
    
    // Handle server errors
    if (status && status >= 500) {
      console.error('Server error. Please try again later.');
      const requestId = (error.response?.data as any)?.request_id;
      if (requestId) {
        console.error('Request ID:', requestId);
      }
      return Promise.reject(error);
    }
    
    return Promise.reject(error);
  }
);

// Auth API
export const authApi = {
  login: (data: LoginRequest) => 
    api.post<AuthResponse>('/auth/login', data),
  
  register: (data: RegisterRequest) => 
    api.post<AuthResponse>('/auth/register', data),

  signupOwner: (data: OwnerSignupRequest) =>
    api.post<AuthResponse>('/auth/signup-owner', data),

  forgotPassword: (data: ForgotPasswordRequest) =>
    api.post<{ message: string }>('/auth/forgot-password', data),

  validateResetToken: (params: { token: string; email: string }) =>
    api.get<PasswordResetTokenValidationResponse>('/auth/reset-password/validate', { params }),

  resetPassword: (data: ResetPasswordRequest) =>
    api.post<{ message: string }>('/auth/reset-password', data),

  resendVerificationEmail: () =>
    api.post<{ message: string; already_verified?: boolean }>('/auth/email/verification-notification'),

  requestVerificationEmail: (data: { email: string }) =>
    api.post<{ message: string; already_verified?: boolean; sent?: boolean }>(
      '/auth/email/verification-notification/request',
      data
    ),
  
  logout: () => 
    api.post('/auth/logout'),
  
  me: () => 
    api.get<ApiResponse<User> | User>('/auth/me'),
};

// Organization API
export const organizationApi = {
  getAll: () => 
    api.get<Organization[]>('/organizations'),
  
  get: (id: number) => 
    api.get<Organization>(`/organizations/${id}`),
  
  create: (data: Partial<Organization>) => 
    api.post<Organization>('/organizations', data),
  
  update: (id: number, data: Partial<Organization>) => 
    api.put<Organization>(`/organizations/${id}`, data),
  
  delete: (id: number) => 
    api.delete(`/organizations/${id}`),
  
  getMembers: (id: number) => 
    api.get<User[]>(`/organizations/${id}/members`),
  
  inviteMember: (id: number, data: { email: string; name: string; role: string; settings?: Record<string, any>; group_ids?: number[] }) => 
    api.post(`/organizations/${id}/invite`, data),
};

export const invitationApi = {
  list: () =>
    api.get<InvitationListResponse>('/invitations'),

  create: (data: {
    email?: string;
    emails?: string[];
    role: User['role'];
    delivery?: 'email' | 'link';
    expires_in_hours?: number;
    group_ids?: number[];
    project_ids?: number[];
    settings?: Record<string, any>;
  }) => api.post<InvitationCreateResponse>('/invitations', data),

  importCsv: (data: {
    rows: Array<{
      email: string;
      role: User['role'];
      group_ids?: number[];
      project_ids?: number[];
      settings?: Record<string, any>;
    }>;
    default_group_ids?: number[];
    default_project_ids?: number[];
    settings?: Record<string, any>;
    expires_in_hours?: number;
  }) => api.post<InvitationCreateResponse>('/invitations/import', data),

  getByToken: (token: string) =>
    api.get<{ invitation: InvitationSummary }>(`/invitations/${token}`),

  accept: (token: string, data: { name: string; password: string; password_confirmation: string }) =>
    api.post<AuthResponse>(`/invitations/${token}/accept`, data),
};

export const inviteApi = {
  send: (data: { email: string; role?: string | null }) =>
    api.post('/invites/send', data),
  validate: (token: string) =>
    api.get<InviteValidationResponse>('/invites/validate', { params: { token } }),
  accept: (data: { token: string; name: string; password: string; password_confirmation: string }) =>
    api.post<AuthResponse>('/invites/accept', data),
};

// User API
export const userApi = {
  getAll: (params?: { 
      role?: string; 
      is_active?: boolean; 
      period?: 'today' | 'week' | 'all';
      simple?: boolean | number;
      country?: string;
      timezone?: string;
      start_date?: string;
      end_date?: string;
  }) => 
    api.get<User[]>('/users', { params }),
  
  get: (id: number) => 
    api.get<User>(`/users/${id}`),

  getGroups: (id: number) =>
    api.get<{ data: Group[] }>(`/users/${id}/groups`),
  
  create: (data: Partial<User> & { password?: string; group_ids?: number[] }) => 
    api.post<User>('/users', data),
  
  update: (id: number, data: Partial<User> & { group_ids?: number[] }) => 
    api.put<User>(`/users/${id}`, data),
  
  delete: (id: number) => 
    api.delete(`/users/${id}`),
  
  getStats: (id: number, params?: { start_date?: string; end_date?: string }) => 
    api.get(`/users/${id}/stats`, { params }),

  getProfile360: (id: number, params?: { start_date?: string; end_date?: string }) =>
    api.get<UserProfile360>(`/users/${id}/profile-360`, { params }),
};

export const employeeWorkspaceApi = {
  getWorkspace: (id: number, params?: { payroll_month?: string }) =>
    api.get<EmployeeWorkspacePayload>(`/employees/${id}/workspace`, { params }),

  updateProfile: (id: number, data: Partial<EmployeeProfileDetails>) =>
    api.put<EmployeeProfileDetails>(`/employees/${id}/profile`, data),

  updateWorkInfo: (id: number, data: Partial<EmployeeWorkInfo>) =>
    api.put<EmployeeWorkInfo>(`/employees/${id}/work-info`, data),

  saveGovernmentId: (id: number, data: Record<string, any> & { proof_file?: File | null }) => {
    const formData = new FormData();
    Object.entries(data).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return;
      if (key === 'proof_file' && value instanceof File) {
        formData.append('proof_file', value);
        return;
      }
      formData.append(key, String(value));
    });
    return api.post<EmployeeGovernmentIdRecord>(`/employees/${id}/government-ids`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  saveBankAccount: (id: number, data: Record<string, any> & { proof_file?: File | null }) => {
    const formData = new FormData();
    Object.entries(data).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return;
      if (key === 'proof_file' && value instanceof File) {
        formData.append('proof_file', value);
        return;
      }
      if (typeof value === 'boolean') {
        formData.append(key, value ? '1' : '0');
        return;
      }
      formData.append(key, String(value));
    });
    return api.post<EmployeeBankAccountRecord>(`/employees/${id}/bank-accounts`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  uploadDocument: (id: number, data: { title: string; category: string; review_status?: string; notes?: string; file: File }) => {
    const formData = new FormData();
    formData.append('title', data.title);
    formData.append('category', data.category);
    if (data.review_status) formData.append('review_status', data.review_status);
    if (data.notes) formData.append('notes', data.notes);
    formData.append('file', data.file);
    return api.post<EmployeeDocumentRecord>(`/employees/${id}/documents`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  downloadDocument: (employeeId: number, documentId: number) =>
    api.get<Blob>(`/employees/${employeeId}/documents/${documentId}/download`, {
      responseType: 'blob' as AxiosRequestConfig['responseType'],
    }),
};

// Project API
export const projectApi = {
  getAll: (params?: { status?: string }) => 
    api.get<Project[]>('/projects', { params }),
  
  get: (id: number) => 
    api.get<Project>(`/projects/${id}`),
  
  create: (data: Partial<Project>) => 
    api.post<Project>('/projects', data),
  
  update: (id: number, data: Partial<Project>) => 
    api.put<Project>(`/projects/${id}`, data),
  
  delete: (id: number) => 
    api.delete(`/projects/${id}`),
  
  getTimeEntries: (id: number, params?: { start_date?: string; end_date?: string }) => 
    api.get(`/projects/${id}/time-entries`, { params }),
  
  getTasks: (id: number, params?: { status?: string }) => 
    api.get<Task[]>(`/projects/${id}/tasks`, { params }),
  
  getStats: (id: number, params?: { start_date?: string; end_date?: string }) => 
    api.get(`/projects/${id}/stats`, { params }),
};

export const groupApi = {
  getAll: () =>
    api.get<{ data: Group[] }>('/groups'),

  get: (id: number) =>
    api.get<Group>(`/groups/${id}`),

  create: (data: { name: string; description?: string; is_active?: boolean; user_ids?: number[] }) =>
    api.post<Group>('/groups', data),

  update: (id: number, data: { name?: string; description?: string; is_active?: boolean; user_ids?: number[] }) =>
    api.patch<Group>(`/groups/${id}`, data),

  delete: (id: number) =>
    api.delete(`/groups/${id}`),
};

// Task API
export const taskApi = {
  getAll: (params?: { project_id?: number; group_id?: number; status?: string; assignee_id?: number; timer_only?: boolean }) =>
    api.get<Task[]>('/tasks', { params }),
  
  get: (id: number) => 
    api.get<Task>(`/tasks/${id}`),
  
  create: (data: Partial<Task> & { assignee_ids?: number[] }) => 
    api.post<Task>('/tasks', data),
  
  update: (id: number, data: Partial<Task> & { assignee_ids?: number[] }) => 
    api.put<Task>(`/tasks/${id}`, data),
  
  delete: (id: number) => 
    api.delete(`/tasks/${id}`),
  
  updateStatus: (id: number, status: string) => 
    api.patch<Task>(`/tasks/${id}/status`, { status }),
  
  getTimeEntries: (id: number) => 
    api.get(`/tasks/${id}/time-entries`),
};

// Time Entry API
export const timeEntryApi = {
  getAll: (params?: { 
    user_id?: number; 
    project_id?: number; 
    start_date?: string; 
    end_date?: string;
    page?: number;
    per_page?: number;
  }) => 
    api.get<{ data: TimeEntry[]; current_page: number; last_page: number; total: number }>('/time-entries', { params }),
  
  get: (id: number) => 
    api.get<TimeEntry>(`/time-entries/${id}`),
  
  create: (data: Partial<TimeEntry>) => 
    api.post<TimeEntry>('/time-entries', data),
  
  update: (id: number, data: Partial<TimeEntry> & { project_id?: number | null; task_id?: number | null }) => 
    api.put<TimeEntry>(`/time-entries/${id}`, data),
  
  delete: (id: number) => 
    api.delete(`/time-entries/${id}`),
  
  start: (data?: { project_id?: number | null; task_id?: number | null; description?: string; billable?: boolean; timer_slot?: 'primary' | 'secondary' }) => 
    api.post<TimeEntry>('/time-entries/start', data || {}),
  
  stop: (data?: {
    timer_slot?: 'primary' | 'secondary';
    auto_stopped_for_idle?: boolean;
    idle_seconds?: number;
    last_activity_at?: string;
  }) => 
    api.post<TimeEntry>('/time-entries/stop', data || {}),
  
  active: (params?: { timer_slot?: 'primary' | 'secondary' }) => 
    api.get<TimeEntry>('/time-entries/active', { params }),
  
  today: () => 
    api.get<{ time_entries: TimeEntry[]; total_duration: number }>('/time-entries/today'),
};

// Screenshot API
export const screenshotApi = {
  getAll: (params?: { user_id?: number; time_entry_id?: number; start_date?: string; end_date?: string; page?: number; per_page?: number }) => 
    api.get<PaginatedResponse<Screenshot>>('/screenshots', { params }),
  
  get: (id: number) => 
    api.get<Screenshot>(`/screenshots/${id}`),
  
  upload: (timeEntryId: number, imageDataUrl: string, filename?: string) =>
    api.post<Screenshot>('/screenshots', {
      time_entry_id: timeEntryId,
      image_data_url: imageDataUrl,
      ...(filename ? { filename } : {}),
    }),
  
  bulkDelete: (data: { screenshot_ids?: number[]; user_id?: number; time_entry_id?: number; start_date?: string; end_date?: string; delete_all_in_range?: boolean }) =>
    api.post<{ message: string; deleted_count: number }>('/screenshots/bulk-delete', data),

  delete: (id: number) => 
    api.delete(`/screenshots/${id}`),
};

// Activity API
export const activityApi = {
  getAll: (params?: { user_id?: number; group_ids?: number[]; type?: string; classification?: string; tool_type?: string; start_date?: string; end_date?: string; processed?: boolean; simple?: boolean | number; page?: number; per_page?: number }) =>
    api.get<{ data: Activity[]; current_page?: number; last_page?: number; total?: number; has_more?: boolean }>('/activities', { params }),

  getAllPages: async (params?: { user_id?: number; group_ids?: number[]; type?: string; classification?: string; tool_type?: string; start_date?: string; end_date?: string; processed?: boolean; simple?: boolean | number; per_page?: number }) => {
    const pageSize = Math.max(1, Number(params?.per_page || 200));
    let page = 1;
    let hasMore = true;
    const results: Activity[] = [];

    while (hasMore) {
      const response = await api.get<{
        data: Activity[];
        current_page?: number;
        last_page?: number;
        next_page_url?: string | null;
      }>('/activities', {
        params: {
          ...params,
          page,
          per_page: pageSize,
        },
      });

      const payload = response.data;
      results.push(...(Array.isArray(payload.data) ? payload.data : []));

      if (payload.next_page_url) {
        page += 1;
        continue;
      }

      const currentPage = Number(payload.current_page || page);
      const lastPage = Number(payload.last_page || currentPage);
      hasMore = currentPage < lastPage;
      page += 1;
    }

    return results;
  },
  
  get: (id: number) => 
    api.get<Activity>(`/activities/${id}`),
  
  create: (data: Partial<Activity>) => 
    api.post<Activity>('/activities', data),

  update: (id: number, data: Partial<Activity>) =>
    api.put<Activity>(`/activities/${id}`, data),
  
  delete: (id: number) => 
    api.delete(`/activities/${id}`),
};

export const activitySessionApi = {
  create: (data: Partial<ActivitySession>) =>
    api.post<ActivitySession>('/activity-sessions', data),

  update: (id: number, data: Partial<ActivitySession>) =>
    api.patch<ActivitySession>(`/activity-sessions/${id}`, data),
};

export const browserTrackingConnectionApi = {
  sync: (data: BrowserTrackingConnectionSyncRequest) =>
    api.post<{ data: BrowserTrackingConnectionSyncRecord[] }>('/browser-tracking/connections/sync', data),
};

export const productivityRuleApi = {
  list: () =>
    api.get<{ data: ProductivityRule[]; meta: Record<string, string[]> }>('/settings/productivity-rules'),
  create: (data: Partial<ProductivityRule>) =>
    api.post<ProductivityRule>('/settings/productivity-rules', data),
  update: (id: number, data: Partial<ProductivityRule>) =>
    api.put<ProductivityRule>(`/settings/productivity-rules/${id}`, data),
  remove: (id: number) =>
    api.delete<{ message: string }>(`/settings/productivity-rules/${id}`),
  test: (data: { name?: string; type?: string; window_title?: string; app_name?: string; url?: string }) =>
    api.post<Record<string, any>>('/settings/productivity-rules/test', data),
};

// Invoice API
export const invoiceApi = {
  getAll: (params?: { status?: string; page?: number }) => 
    api.get<{ data: Invoice[] }>('/invoices', { params }),
  
  get: (id: number) => 
    api.get<Invoice>(`/invoices/${id}`),
  
  create: (data: Partial<Invoice> & { time_entry_ids?: number[]; items?: any[] }) => 
    api.post<Invoice>('/invoices', data),
  
  update: (id: number, data: Partial<Invoice>) => 
    api.put<Invoice>(`/invoices/${id}`, data),
  
  delete: (id: number) => 
    api.delete(`/invoices/${id}`),
  
  send: (id: number) => 
    api.post<Invoice>(`/invoices/${id}/send`),
  
  markPaid: (id: number) => 
    api.post<Invoice>(`/invoices/${id}/mark-paid`),
};

// Report API
export const reportApi = {
  daily: (params?: { date?: string; scope?: 'self' | 'organization' }) => 
    api.get<DailyReport>('/reports/daily', { params }),
  
  weekly: (params?: { start_date?: string; end_date?: string; scope?: 'self' | 'organization' }) => 
    api.get<WeeklyReport>('/reports/weekly', { params }),
  
  monthly: (params?: { start_date?: string; end_date?: string; scope?: 'self' | 'organization' }) => 
    api.get<WeeklyReport>('/reports/monthly', { params }),
  
  productivity: (params?: { start_date?: string; end_date?: string }) => 
    api.get('/reports/productivity', { params }),
  
  team: (params?: { start_date?: string; end_date?: string }) => 
    api.get('/reports/team', { params }),

  attendance: (params?: { start_date?: string; end_date?: string; user_id?: number; group_ids?: number[]; q?: string; country?: string }) =>
    api.get('/reports/attendance', { params }),

  employeeInsights: (params?: { start_date?: string; end_date?: string; user_id?: number; group_ids?: number[]; q?: string; recent_screenshot_limit?: number; dashboard_lite?: boolean | number }) =>
    api.get('/reports/employee-insights', { params }),

  overall: (params?: { start_date?: string; end_date?: string; user_ids?: number[]; group_ids?: number[]; dashboard_lite?: boolean | number; skip_activity?: boolean | number; page?: number; per_page?: number }) =>
    api.get('/reports/overall', { params }),
  
  project: (projectId: number, params?: { start_date?: string; end_date?: string }) => 
    api.get(`/reports/project/${projectId}`, { params }),
  
  export: (params?: {
    start_date?: string;
    end_date?: string;
    user_ids?: number[];
    group_ids?: number[];
    export_scope?: 'employee' | 'department';
    fields?: string[];
  }) => 
    api.get('/reports/export', { 
      params, 
      responseType: 'blob' as AxiosRequestConfig['responseType'] 
    }),
};

export const dashboardApi = {
  summary: () => api.get('/dashboard'),
};

export const attendanceApi = {
  today: (params?: { user_id?: number }) =>
    api.get<{
      record: {
        id: number;
        attendance_date: string;
        check_in_at?: string | null;
        check_out_at?: string | null;
        worked_seconds: number;
        manual_adjustment_seconds: number;
        late_minutes: number;
        status: string;
        is_checked_in: boolean;
        total_break_seconds: number;
        shift_target_seconds: number;
        remaining_shift_seconds: number;
        completed_shift: boolean;
        punches: Array<{
          id: number;
          punch_in_at: string;
          punch_out_at?: string | null;
          worked_seconds: number;
        }>;
      } | null;
      late_after: string;
      office_start?: string;
      shift_target_seconds: number;
      has_approved_leave_today: boolean;
    }>('/attendance/today', { params }),

  checkIn: () => api.post('/attendance/check-in'),

  checkOut: () => api.post('/attendance/check-out'),

  calendar: (params?: { month?: string; user_id?: number; scope?: 'selected' | 'overall'; country?: string }) =>
    api.get<{
      month: string;
      user_id: number;
      scope?: 'selected' | 'overall';
      viewer_country?: string;
      days: Array<{
        date: string;
        status: 'present' | 'checked_in' | 'leave' | 'holiday' | 'none';
        is_weekend: boolean;
        is_leave?: boolean;
        is_holiday?: boolean;
        check_in_at?: string | null;
        check_out_at?: string | null;
        late_minutes: number;
        worked_seconds: number;
        holiday?: {
          id: number;
          date: string;
          country: string;
          title: string;
          details?: string | null;
        } | null;
      }>;
      summary: {
        present_days: number;
        absent_days: number;
        weekend_days: number;
        leave_days?: number;
        holiday_days?: number;
        late_days: number;
        total_worked_seconds: number;
        overall_employee_count?: number;
      };
    }>('/attendance/calendar', { params }),

  summary: (params?: { start_date?: string; end_date?: string; q?: string }) =>
    api.get<{
      start_date: string;
      end_date: string;
      data: Array<{
        user: { id: number; name: string; email: string; role: string };
        present_days: number;
        late_days: number;
        late_minutes?: number;
        total_worked_seconds: number;
        is_checked_in: boolean;
        check_in_at?: string | null;
        check_out_at?: string | null;
        open_punch_in_at?: string | null;
        last_check_in_at?: string | null;
        last_check_out_at?: string | null;
        last_attendance_date?: string | null;
        attendance_status?: string | null;
      }>;
    }>('/attendance/summary', { params }),
};

export const attendanceHolidayApi = {
  list: (params?: { month?: string; country?: string }) =>
    api.get<{
      data: Array<{
        id: number;
        organization_id: number;
        holiday_date: string;
        country: string;
        title: string;
        details?: string | null;
        created_by?: number | null;
        updated_by?: number | null;
        created_at: string;
        updated_at: string;
      }>;
    }>('/attendance/holidays', { params }),

  upsert: (data: { holiday_date: string; country?: string; title: string; details?: string }) =>
    api.post<{
      message: string;
      data: {
        id: number;
        organization_id: number;
        holiday_date: string;
        country: string;
        title: string;
        details?: string | null;
        created_by?: number | null;
        updated_by?: number | null;
        created_at: string;
        updated_at: string;
      };
    }>('/attendance/holidays', data),

  delete: (id: number) =>
    api.delete<{ message: string }>(`/attendance/holidays/${id}`),
};

export const leaveApi = {
  list: (params?: {
    status?: 'pending' | 'approved' | 'rejected' | 'revoked' | 'auto_cancelled';
    user_id?: number;
    start_date?: string;
    end_date?: string;
    limit?: number;
  }) =>
    api.get<{
      data: Array<{
        id: number;
        user_id: number;
        organization_id: number;
        start_date: string;
        end_date: string;
        leave_category?: string;
        consumed_breakdown?: Array<{ category: string; units: number }> | null;
        reason?: string | null;
        status: 'pending' | 'approved' | 'rejected' | 'revoked' | 'auto_cancelled';
        revoke_status?: 'pending' | 'approved' | 'rejected' | null;
        revoke_requested_at?: string | null;
        revoke_reviewed_by?: number | null;
        revoke_reviewed_at?: string | null;
        revoke_review_note?: string | null;
        reviewed_by?: number | null;
        reviewed_at?: string | null;
        review_note?: string | null;
        user?: { id: number; name: string; email: string; role: string };
        reviewer?: { id: number; name: string; email: string } | null;
        revoke_reviewer?: { id: number; name: string; email: string } | null;
        approval_destination?: string | null;
        created_at: string;
      }>;
    }>('/leave-requests', { params }),

  balances: () =>
    api.get<{
      policy: {
        categories: Array<{ code: string; name: string; annual_quota: number }>;
        unpaid: { code: 'unpaid'; name: string };
      };
      self: {
        cycle: { start_date: string; end_date: string };
        categories: Array<{ code: string; name: string; annual_quota: number; used: number; remaining: number }>;
        unpaid: { used: number };
        totals: { quota: number; used: number; remaining: number };
      };
      team: Array<{
        user: { id: number; name: string; email: string; role: string };
        balance: {
          cycle: { start_date: string; end_date: string };
          categories: Array<{ code: string; name: string; annual_quota: number; used: number; remaining: number }>;
          unpaid: { used: number };
          totals: { quota: number; used: number; remaining: number };
        };
      }>;
      approval_scope: {
        can_manage: boolean;
        can_approve_roles: string[];
      };
    }>('/leave-requests/balances'),

  create: (data: {
    start_date: string;
    end_date: string;
    reason?: string;
    leave_type?: 'full_day' | 'half_day';
    leave_category?: string;
  }) =>
    api.post('/leave-requests', data),

  approve: (id: number, review_note?: string) =>
    api.patch(`/leave-requests/${id}/approve`, { review_note }),

  reject: (id: number, review_note?: string) =>
    api.patch(`/leave-requests/${id}/reject`, { review_note }),

  requestRevoke: (id: number) =>
    api.post(`/leave-requests/${id}/revoke-request`),

  approveRevoke: (id: number, review_note?: string) =>
    api.patch(`/leave-requests/${id}/revoke-approve`, { review_note }),

  rejectRevoke: (id: number, review_note?: string) =>
    api.patch(`/leave-requests/${id}/revoke-reject`, { review_note }),
};

export const attendanceTimeEditApi = {
  list: (params?: { status?: 'pending' | 'approved' | 'rejected'; user_id?: number }) =>
    api.get<{
      data: Array<{
        id: number;
        user_id: number;
        organization_id: number;
        attendance_date: string;
        extra_seconds: number;
        message?: string | null;
        status: 'pending' | 'approved' | 'rejected';
        reviewed_by?: number | null;
        reviewed_at?: string | null;
        review_note?: string | null;
        user?: { id: number; name: string; email: string; role: string };
        reviewer?: { id: number; name: string; email: string } | null;
        approval_destination?: string | null;
        created_at: string;
      }>;
    }>('/attendance-time-edit-requests', { params }),

  create: (data: { attendance_date: string; extra_minutes: number; message?: string; worked_seconds?: number; overtime_seconds?: number }) =>
    api.post('/attendance-time-edit-requests', data),

  approve: (id: number, review_note?: string) =>
    api.patch(`/attendance-time-edit-requests/${id}/approve`, { review_note }),

  reject: (id: number, review_note?: string) =>
    api.patch(`/attendance-time-edit-requests/${id}/reject`, { review_note }),
};

export const chatApi = {
  getConversations: () => api.get<ChatConversation[]>('/chat/conversations'),
  getGroups: () => api.get<ChatGroup[]>('/chat/groups'),
  getAvailableUsers: () => api.get<Array<{ id: number; name: string; email: string; role: string }>>('/chat/available-users'),
  getUnreadSummary: () => api.get<ChatUnreadSummary>('/chat/unread-summary'),
  startConversation: (email: string) => api.post<ChatConversation>('/chat/conversations', { email }),
  createGroup: (data: { name: string; user_ids: number[] }) => api.post<ChatGroup>('/chat/groups', data),
  getMessages: (conversationId: number, params?: { since_id?: number }) =>
    api.get<ChatMessage[]>(`/chat/conversations/${conversationId}/messages`, { params }),
  getGroupMessages: (groupId: number, params?: { since_id?: number }) =>
    api.get<ChatGroupMessage[]>(`/chat/groups/${groupId}/messages`, { params }),
  sendMessage: (conversationId: number, data: { body?: string; attachment?: File | null }) => {
    if (data.attachment) {
      const formData = new FormData();
      if (data.body?.trim()) {
        formData.append('body', data.body.trim());
      }
      formData.append('attachment', data.attachment);
      return api.post<ChatMessage>(`/chat/conversations/${conversationId}/messages`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    }

    return api.post<ChatMessage>(`/chat/conversations/${conversationId}/messages`, { body: data.body || '' });
  },
  sendGroupMessage: (groupId: number, data: { body?: string; attachment?: File | null }) => {
    if (data.attachment) {
      const formData = new FormData();
      if (data.body?.trim()) {
        formData.append('body', data.body.trim());
      }
      formData.append('attachment', data.attachment);
      return api.post<ChatGroupMessage>(`/chat/groups/${groupId}/messages`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    }

    return api.post<ChatGroupMessage>(`/chat/groups/${groupId}/messages`, { body: data.body || '' });
  },
  updateMessage: (conversationId: number, messageId: number, data: { body: string }) =>
    api.patch<ChatMessage>(`/chat/conversations/${conversationId}/messages/${messageId}`, { body: data.body }),
  updateGroupMessage: (groupId: number, messageId: number, data: { body: string }) =>
    api.patch<ChatGroupMessage>(`/chat/groups/${groupId}/messages/${messageId}`, { body: data.body }),
  deleteMessage: (conversationId: number, messageId: number) =>
    api.delete<{ message: string }>(`/chat/conversations/${conversationId}/messages/${messageId}`),
  deleteGroupMessage: (groupId: number, messageId: number) =>
    api.delete<{ message: string }>(`/chat/groups/${groupId}/messages/${messageId}`),
  reactToMessage: (conversationId: number, messageId: number, data: { emoji: string }) =>
    api.post<ChatMessage>(`/chat/conversations/${conversationId}/messages/${messageId}/reactions`, { emoji: data.emoji }),
  reactToGroupMessage: (groupId: number, messageId: number, data: { emoji: string }) =>
    api.post<ChatGroupMessage>(`/chat/groups/${groupId}/messages/${messageId}/reactions`, { emoji: data.emoji }),
  markRead: (conversationId: number) =>
    api.post(`/chat/conversations/${conversationId}/read`),
  markGroupRead: (groupId: number) =>
    api.post(`/chat/groups/${groupId}/read`),
  setTyping: (conversationId: number, isTyping: boolean) =>
    api.post(`/chat/conversations/${conversationId}/typing`, { is_typing: isTyping }),
  setGroupTyping: (groupId: number, isTyping: boolean) =>
    api.post(`/chat/groups/${groupId}/typing`, { is_typing: isTyping }),
  getTyping: (conversationId: number) =>
    api.get<ChatTypingUser[]>(`/chat/conversations/${conversationId}/typing`),
  getGroupTyping: (groupId: number) =>
    api.get<ChatTypingUser[]>(`/chat/groups/${groupId}/typing`),
  getAttachment: (messageId: number) =>
    api.get<Blob>(`/chat/messages/${messageId}/attachment`, {
      responseType: 'blob' as AxiosRequestConfig['responseType'],
    }),
  getGroupAttachment: (messageId: number) =>
    api.get<Blob>(`/chat/groups/messages/${messageId}/attachment`, {
      responseType: 'blob' as AxiosRequestConfig['responseType'],
    }),
};

export const payrollSimpleApi = {
  overview: (month: string) =>
    api.get<any>('/payroll/overview', { params: { month } }),

  salaryProfiles: () =>
    api.get<any>('/payroll/salary-profiles'),

  saveSalaryProfile: (userId: number, data: Record<string, any>) =>
    api.put<any>(`/payroll/salary-profiles/${userId}`, data),

  runs: (month: string) =>
    api.get<any>('/payroll/runs', { params: { month } }),

  run: (id: number) =>
    api.get<any>(`/payroll/runs/${id}`),

  generateRun: (month: string) =>
    api.post<any>('/payroll/runs/generate', { month }),

  approveRun: (id: number) =>
    api.post<any>(`/payroll/runs/${id}/approve`),

  markPaid: (id: number) =>
    api.post<any>(`/payroll/runs/${id}/mark-paid`),

  adjustments: (month: string) =>
    api.get<any>('/payroll/adjustments', { params: { month } }),

  createAdjustment: (data: Record<string, any>) =>
    api.post<any>('/payroll/adjustments', data),

  payslips: (month?: string) =>
    api.get<any>('/payroll/payslips', { params: month ? { month } : undefined }),

  downloadPayslipPdf: (id: number) =>
    api.get<Blob>(`/payroll/payslips/${id}/pdf`, {
      responseType: 'blob' as AxiosRequestConfig['responseType'],
    }),

  settings: () =>
    api.get<any>('/payroll/settings'),

  saveSettings: (data: Record<string, any>) =>
    api.put<any>('/payroll/settings', data),
};

export const payrollApi = {
  getEmployees: () =>
    api.get<{ data: User[] }>('/users', { params: { role: 'employee', is_active: true } }),

  getRecords: (params?: {
    user_id?: number;
    payroll_month?: string;
    payroll_status?: string;
    payout_status?: string;
  }) =>
    api.get<{ data: PayrollRecord[]; mode?: 'mock' | 'stripe_test' | 'stripe_live' }>('/payroll/records', { params }),

  generateRecords: (data: {
    payroll_month: string;
    user_id?: number;
    payout_method?: string;
    allow_overwrite?: boolean;
  }) =>
    payrollSimpleApi.generateRun(data.payroll_month),

  updateRecord: (id: number, data: Partial<PayrollRecord>) =>
    api.put<PayrollRecord>(`/payroll/records/${id}`, data),

  updateRecordStatus: (id: number, status: PayrollRecord['payroll_status']) =>
    api.put<PayrollRecord>(`/payroll/records/${id}/status`, { status }),

  payoutRecord: (id: number, data?: Record<string, any>) =>
    api.post<{
      payroll: PayrollRecord;
      transaction: PayrollTransaction;
      checkout_url?: string;
      mode: 'mock' | 'stripe_test' | 'stripe_live';
    }>(`/payroll/records/${id}/payout`, data || {}),

  getRecordTransactions: (id: number) =>
    api.get<{ data: PayrollTransaction[] }>(`/payroll/records/${id}/transactions`),

  syncStripeCheckout: (id: number, checkoutSessionId: string) =>
    api.post(`/payroll/records/${id}/sync-stripe-checkout`, { checkout_session_id: checkoutSessionId }),

  getStructures: () =>
    api.get<{ data: any[]; structures: any[] }>('/payroll/structures'),

  saveStructure: (data: Record<string, any>) =>
    api.post('/payroll/structures', data),

  updateStructure: (id: number, data: Record<string, any>) =>
    api.put(`/payroll/structures/${id}`, data),

  deleteStructure: (id: number) =>
    api.delete(`/payroll/structures/${id}`),

  getPayslips: (params?: { user_id?: number; period_month?: string; payroll_month?: string; status?: string }) =>
    api.get<{ data: any[] }>('/payroll/payslips', { params }),

  downloadPayslipPdf: payrollSimpleApi.downloadPayslipPdf,

  generatePayslip: (data: { user_id: number; period_month: string }) =>
    api.post('/payroll/payslips/generate', data),

  payNow: (data: { payslip_ids: number[] }) =>
    api.post('/payroll/payslips/pay-now', data),
};

export const payrollWorkspaceApi = {
  overview: (params: { payroll_month: string }) =>
    payrollSimpleApi.overview(params.payroll_month),

  getRuns: (params?: { payroll_month?: string }) =>
    payrollSimpleApi.runs(params?.payroll_month || new Date().toISOString().slice(0, 7)),

  getRun: (id: number) =>
    payrollSimpleApi.run(id),

  updateRunStatus: (id: number, status: string) => {
    if (status === 'paid') return payrollSimpleApi.markPaid(id);
    if (['approved', 'validated', 'manager_approved', 'finance_approved', 'processed'].includes(status)) {
      return payrollSimpleApi.approveRun(id);
    }
    return api.post(`/payroll/runs/${id}/status`, { status });
  },

  getProfiles: (params?: { payroll_month?: string }) =>
    api.get<{ profiles: PayrollProfile[]; employees: User[]; templates: SalaryTemplate[] }>('/payroll/salary-profiles', { params }),

  createProfile: (data: Partial<PayrollProfile>) =>
    api.post<PayrollProfile>('/payroll/salary-profiles', data),

  updateProfile: (id: number, data: Partial<PayrollProfile>) =>
    api.put<PayrollProfile>(`/payroll/salary-profiles/${id}`, data),

  getComponents: () =>
    api.get<{ data: SalaryComponentMaster[] }>('/payroll/components'),

  createComponent: (data: Partial<SalaryComponentMaster>) =>
    api.post<SalaryComponentMaster>('/payroll/components', data),

  updateComponent: (id: number, data: Partial<SalaryComponentMaster>) =>
    api.put<SalaryComponentMaster>(`/payroll/components/${id}`, data),

  deleteComponent: (id: number) =>
    api.delete(`/payroll/components/${id}`),

  getTemplates: () =>
    api.get<{ data: SalaryTemplate[]; components: SalaryComponentMaster[] }>('/payroll/templates'),

  createTemplate: (data: Record<string, any>) =>
    api.post<SalaryTemplate>('/payroll/templates', data),

  updateTemplate: (id: number, data: Record<string, any>) =>
    api.put<SalaryTemplate>(`/payroll/templates/${id}`, data),

  deleteTemplate: (id: number) =>
    api.delete(`/payroll/templates/${id}`),

  getAdjustments: (params?: { effective_month?: string; status?: string; user_id?: number }) =>
    api.get<{ data: PayrollAdjustment[]; adjustments: PayrollAdjustment[]; employees: User[] }>('/payroll/adjustments', { params }),

  createAdjustment: (data: Partial<PayrollAdjustment>) =>
    payrollSimpleApi.createAdjustment(data),

  updateAdjustment: (id: number, data: Partial<PayrollAdjustment>) =>
    api.put<PayrollAdjustment>(`/payroll/adjustments/${id}`, data),

  approveAdjustment: (id: number) =>
    api.post(`/payroll/adjustments/${id}/approve`),

  rejectAdjustment: (id: number) =>
    api.post(`/payroll/adjustments/${id}/reject`),

  applyAdjustment: (id: number) =>
    api.post(`/payroll/adjustments/${id}/apply`),

  reports: (params?: { payroll_month?: string }) =>
    api.get<PayrollReportsPayload>('/payroll/reports', { params }),

  settings: () =>
    payrollSimpleApi.settings(),

  updateSettings: (data: Partial<PayrollSettingsPayload>) =>
    payrollSimpleApi.saveSettings(data),
};

export const notificationApi = {
  list: (params?: { limit?: number; type?: string; exclude_types?: string[]; q?: string; unread_only?: boolean }) =>
    api.get<{
      data: AppNotificationItem[];
      unread_count: number;
    }>('/notifications', { params }),

  publish: (data: { type: 'announcement' | 'news'; title: string; message: string; recipient_user_ids?: number[] }) =>
    api.post('/notifications/publish', data),

  markRead: (id: number) =>
    api.post(`/notifications/${id}/read`),

  markAllRead: (data?: { exclude_types?: string[] }) =>
    api.post('/notifications/read-all', data),
};

export const reportGroupApi = {
  list: (params?: { simple?: boolean | number }) =>
    api.get<{
      data: Array<{
        id: number;
        organization_id: number;
        name: string;
        users: Array<{ id: number; name?: string; email?: string; role?: string }>;
      }>;
    }>('/report-groups', { params }),

  create: (data: { name: string; user_ids?: number[] }) =>
    api.post('/report-groups', data),

  update: (id: number, data: { name?: string; user_ids?: number[] }) =>
    api.put(`/report-groups/${id}`, data),

  delete: (id: number) =>
    api.delete(`/report-groups/${id}`),
};

export const settingsApi = {
  me: () =>
    api.get<{
      user: User;
      organization: Organization | null;
      can_manage_org: boolean;
    }>('/settings/me'),

  updateProfile: (data: FormData | { name: string; email?: string; avatar?: string | null }) => {
    if (data instanceof FormData) {
      data.append('_method', 'PUT');
      return api.post<{ message: string; user: User }>('/settings/profile', data, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    }

    return api.put<{ message: string; user: User }>('/settings/profile', data);
  },

  updatePassword: (data: { current_password: string; new_password: string; new_password_confirmation: string }) =>
    api.put<{ message: string }>('/settings/password', data),

  updatePreferences: (data: {
    timezone?: string;
    notifications?: {
      email?: boolean;
      in_app?: boolean;
      desktop_push?: boolean;
      chat_messages?: boolean;
      weekly_summary?: boolean;
      project_updates?: boolean;
      task_assignments?: boolean;
    };
  }) => api.put<{ message: string; settings: Record<string, any> }>('/settings/preferences', data),

  updateOrganization: (data: FormData | {
    name: string;
    slug: string;
    office_start_time?: string | null;
    late_after_time?: string | null;
    leave_categories?: Array<{ code: string; name: string; annual_quota: number }>;
  }) => {
    if (data instanceof FormData) {
      data.append('_method', 'PUT');
      return api.post<{ message: string; organization: Organization }>('/settings/organization', data, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    }

    return api.put<{ message: string; organization: Organization }>('/settings/organization', data);
  },

  billing: () =>
    api.get<BillingSnapshot>('/settings/billing'),
};

export const billingApi = {
  current: () =>
    api.get<BillingSnapshot>('/billing/current'),
};

export const companyApi = {
  current: () =>
    api.get<{ company: Organization | null }>('/me/company'),
};

export const supportApi = {
  submitBugReport: (data: BugReportRequest) =>
    api.post<BugReportResponse>('/support/bug-reports', data),
};

export const auditApi = {
  list: (params?: {
    action?: string;
    actor_user_id?: number;
    target_type?: string;
    target_id?: number;
    date_from?: string;
    date_to?: string;
    page?: number;
    per_page?: number;
  }) =>
    api.get<{
      success: boolean;
      data: Array<{
        id: number;
        action: string;
        target_type?: string | null;
        target_id?: number | null;
        metadata?: Record<string, any> | null;
        ip_address?: string | null;
        user_agent?: string | null;
        created_at: string;
        actor?: { id: number; name: string; email: string; role: string } | null;
      }>;
      pagination: {
        current_page: number;
        last_page: number;
        per_page: number;
        total: number;
      } | null;
    }>('/audit-logs', { params }),
};

export default api;
