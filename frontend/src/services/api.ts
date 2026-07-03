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
  ProductivityClassificationItem,
  TeamHierarchyPayload,
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
  TaskActivity,
  TaskAttachment,
  TaskChecklistItem,
  TaskComment,
  TaskDependency,
  TaskLabel,
  TaskRecurrence,
  PayrollDashboardData,
  PayrollStats,
  PayrollTimeEntry,
  PayrollDepartment,
  PayrollDepartmentEmployee,
  PayGroupEmployee,
  PayGroupStepStatus,
  EmployeePayrollDetails,
  EmployeePayrollTemplate,
  ProcessPayrollRequest,
  CalculatePayrollRequest,
  PayrollCalculation,
  PayrollEmployee,
  AllEmployee,
  PayGroup,
  CreatePayGroupPayload,
  UpdatePayrollProfileRequest,
  PTState,
  PTSlab,
  ProcessPaymentRequest,
  ProcessPaymentResponse,
  PayslipData,
  PayrollSummary,
  PayrollOrganizationSettings,
  SalaryStructure,
  SalaryStructureBreakdown,
  CreateSalaryStructurePayload,
  EmployeePayrollCard,
  EmployeePayrollConfig,
  UpdateEmployeePayrollCardPayload,
  PayGroupSettings,
  CreatePayGroupSettingsPayload,
  UpdateFilingDetailsPayload,
  SalaryComponent,
  SalaryFormula,
  IndianState,
} from '@/types';
import { apiUrl } from '@/lib/runtimeConfig';

// Define API error response structure
interface ApiErrorResponse {
  message?: string;
  error_code?: string;
  errors?: Record<string, string[]>;
  request_id?: string;
}

// Get CSRF token from cookie (set by backend)
const getCsrfToken = (): string | null => {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/XSRF-TOKEN=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
};

// Check if request is retryable
const isRetryableError = (error: AxiosError): boolean => {
  if (!error.config) return false;
  // Don't retry if max retries reached
  const retryCount = (error.config as any)._retryCount || 0;
  if (retryCount >= 3) return false;
  
  // Retry on network errors or 5xx errors
  return !error.response || (error.response.status >= 500 && error.response.status < 600);
};

// Calculate retry delay with exponential backoff
const getRetryDelay = (retryCount: number): number => {
  return Math.min(1000 * Math.pow(2, retryCount), 30000); // Max 30s
};

// Check if browser is online
const isOnline = (): boolean => {
  return typeof navigator !== 'undefined' && navigator.onLine !== false;
};

const api = axios.create({
  baseURL: apiUrl,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'X-Requested-With': 'XMLHttpRequest', // CSRF protection header
  },
  // Global timeout to prevent hanging requests
  timeout: 30000,
  // Retry configuration for transient failures
  validateStatus: (status) => status >= 200 && status < 300,
});

// Request interceptor to add auth token and CSRF token
api.interceptors.request.use((config) => {
  // Check if online
  if (!isOnline()) {
    return Promise.reject(new Error('No internet connection. Please check your network.'));
  }
  
  const token = getStoredAuthValue('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  
  // Add CSRF token for state-changing requests (POST, PUT, DELETE, PATCH)
  if (['post', 'put', 'delete', 'patch'].includes(config.method?.toLowerCase() || '')) {
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      config.headers['X-XSRF-TOKEN'] = csrfToken;
    }
  }
  
  // Add request timeout for better error handling
  config.timeout = config.timeout || 30000; // 30 seconds default
  config.timeoutErrorMessage = 'Request timed out. Please check your connection.';
  
  // Track retry count
  (config as any)._retryCount = (config as any)._retryCount || 0;
  
  return config;
}, (error) => {
  return Promise.reject(error);
});

// Response interceptor to handle errors
api.interceptors.response.use(
  (response) => {
    const status = Number(response?.status || 0);
    const errorCode = (response?.data as ApiErrorResponse)?.error_code;

    if (status === 401 || errorCode === 'UNAUTHORIZED') {
      clearAuthStorage();
      window.dispatchEvent(new Event('app:auth-cleared'));
      return Promise.reject(new Error((response?.data as ApiErrorResponse)?.message || 'Unauthorized'));
    }

    return response;
  },
  async (error: AxiosError) => {
    const status = error.response?.status;
    const errorCode = (error.response?.data as ApiErrorResponse)?.error_code;
    
    // Handle authentication errors
    if (status === 401 || errorCode === 'UNAUTHORIZED') {
      clearAuthStorage();
      window.dispatchEvent(new Event('app:auth-cleared'));
      // Don't reject - let the component handle the redirect
      return Promise.reject(error);
    }
    
    // Handle forbidden errors
    if (status === 403 || errorCode === 'FORBIDDEN') {
      console.error('Access forbidden:', (error.response?.data as ApiErrorResponse)?.message || 'You do not have permission to perform this action');
      return Promise.reject(error);
    }

    // Handle trial expired
    if (errorCode === 'TRIAL_EXPIRED') {
      console.error('Trial expired:', (error.response?.data as ApiErrorResponse)?.message || 'Your free trial has expired');
      if (typeof window !== 'undefined' && window.location.pathname !== '/payment') {
        window.location.href = '/payment';
      }
      return Promise.reject(error);
    }
    
    // Handle validation errors - don't retry
    if (status === 422 || errorCode === 'VALIDATION_ERROR') {
      // Let the component handle validation errors
      return Promise.reject(error);
    }
    
    // Handle rate limiting - retry after delay
    if (status === 429 || errorCode === 'TOO_MANY_REQUESTS') {
      console.error('Rate limit exceeded. Please try again later.');
      return Promise.reject(error);
    }
    
    // Handle server errors
    if (status && status >= 500) {
      console.error('Server error. Please try again later.');
      const requestId = (error.response?.data as ApiErrorResponse)?.request_id;
      if (requestId) {
        console.error('Request ID:', requestId);
      }
      return Promise.reject(error);
    }
    
    // Handle network errors (ECONNABORTED, NETWORK_ERROR, etc.) with retry
    if (!error.response || error.code === 'ECONNABORTED' || error.message?.includes('Network Error')) {
      // Dispatch offline detection event for real-time UI updates
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('app:offline-detected'));
      }

      const config = error.config;
      if (config && isRetryableError(error)) {
        const retryCount = ((config as any)._retryCount || 0) + 1;
        (config as any)._retryCount = retryCount;
        
        console.warn(`Request failed, retrying (${retryCount}/3): ${config.url}`);
        
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, getRetryDelay(retryCount)));
        
        // Check if still online before retrying
        if (!isOnline()) {
          return Promise.reject(new Error('No internet connection. Please check your network.'));
        }
        
        // Retry the request
        return api(config);
      }
    }
    
    return Promise.reject(error);
  }
);

/**
 * Extract a user-friendly error message from an axios error.
 * Backend usually returns { success: false, message: '...' } on 4xx and
 * the validation 422 response has { message: '...' } or { errors: { field: [...] } }.
 * Falls back to a generic message for unexpected shapes.
 */
export function getApiErrorMessage(err: any, fallback = 'Something went wrong. Please try again.'): string {
  const data = err?.response?.data;
  if (!data) {
    if (err?.code === 'ECONNABORTED') return 'Request timed out. Please try again.';
    if (err?.message?.includes('Network Error')) return 'Network error. Check your connection.';
    return err?.message || fallback;
  }
  if (typeof data.message === 'string' && data.message.trim()) {
    return data.message;
  }
  if (data.errors && typeof data.errors === 'object') {
    const first = Object.keys(data.errors)[0];
    const msg = first ? data.errors[first]?.[0] : null;
    if (msg) return `${first}: ${msg}`;
  }
  return fallback;
}

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

  checkEmail: (email: string) =>
    api.post<{
      success: boolean;
      exists: boolean;
      has_verified_email: boolean;
    }>('/auth/check-email', { email }),

  googleLogin: (credential: string, timezone?: string) =>
    api.post<{
      success: boolean;
      token: string;
      user: User;
      organization?: Organization;
      has_workspace: boolean;
      google_data?: { name: string; email: string };
    }>('/auth/google/login', { credential, ...(timezone ? { timezone } : {}) }),

  completeGoogleRegistration: (data: {
    name: string;
    company_name: string;
    company_description?: string;
    plan_code?: string;
    billing_cycle?: string;
    seats?: number;
    signup_mode?: string;
    timezone?: string;
    description?: string;
    website?: string;
    industry?: string;
    size?: string;
    phone?: string;
    org_email?: string;
    address_line?: string;
    city?: string;
    state?: string;
    postal_code?: string;
    country?: string;
  }) =>
    api.post<{
      success: boolean;
      token: string;
      user: User;
      organization: Organization;
    }>('/auth/google/complete', data),
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
    organization_id?: number;
    email?: string;
    emails?: string[];
    role: User['role'];
    delivery?: 'email' | 'link';
    expires_in_hours?: number;
    group_ids?: number[];
    department_ids?: number[];
    project_ids?: number[];
    settings?: Record<string, any>;
  }) => api.post<InvitationCreateResponse>('/invitations', data),

  importCsv: (data: {
    rows: Array<{
      email: string;
      role: User['role'];
      group_ids?: number[];
      department_ids?: number[];
      project_ids?: number[];
      settings?: Record<string, any>;
    }>;
    default_group_ids?: number[];
    default_department_ids?: number[];
    default_project_ids?: number[];
    settings?: Record<string, any>;
    expires_in_hours?: number;
  }) => api.post<InvitationCreateResponse>('/invitations/import', data),

  getByToken: (token: string) =>
    api.get<{ invitation: InvitationSummary }>(`/invitations/${token}`),

  accept: (token: string, data: { name: string; password: string; password_confirmation: string; timezone?: string }) =>
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
  getWorkspace: (id: number | string, params?: { payroll_month?: string }) =>
    api.get<EmployeeWorkspacePayload>(`/employees/${id}/workspace`, { params }),

  updateProfile: (id: number | string, data: Partial<EmployeeProfileDetails>) =>
    api.put<EmployeeProfileDetails>(`/employees/${id}/profile`, data),

  updateWorkInfo: (id: number | string, data: Partial<EmployeeWorkInfo>) =>
    api.put<EmployeeWorkInfo>(`/employees/${id}/work-info`, data),

  saveGovernmentId: (id: number | string, data: Record<string, any> & { proof_file?: File | null }) => {
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

  saveBankAccount: (id: number | string, data: Record<string, any> & { proof_file?: File | null }) => {
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

  uploadDocument: (id: number | string, data: { title: string; category: string; review_status?: string; notes?: string; file: File }) => {
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

  downloadDocument: (employeeId: number | string, documentId: number) =>
    api.get<Blob>(`/employees/${employeeId}/documents/${documentId}/download`, {
      responseType: 'blob' as AxiosRequestConfig['responseType'],
    }),
};

// Resignation API
export const resignationApi = {
  submit: (data: { last_working_date: string; reason?: string }) =>
    api.post('/resignations', data),
  
  getMyResignation: () =>
    api.get('/resignations/my'),
  
  getMyResignationHistory: () =>
    api.get('/resignations/my/history'),
  
  cancel: () =>
    api.delete('/resignations/my'),
  
  list: (params?: { status?: 'pending' | 'approved' | 'rejected'; employee_id?: number }) =>
    api.get('/resignations', { params }),
  
  approve: (id: number, data?: { approved_last_date?: string; notes?: string }) =>
    api.post(`/resignations/${id}/approve`, data),
  
  reject: (id: number, data?: { reason?: string }) =>
    api.post(`/resignations/${id}/reject`, data),
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

  getActivities: (id: number) =>
    api.get<TaskActivity[]>(`/tasks/${id}/activities`),

  watch: (id: number) =>
    api.post<{ message: string; watching: boolean; watchers_count: number }>(`/tasks/${id}/watch`),

  unwatch: (id: number) =>
    api.post<{ message: string; watching: boolean; watchers_count: number }>(`/tasks/${id}/unwatch`),

  watchStatus: (id: number) =>
    api.get<{ watching: boolean; watchers_count: number }>(`/tasks/${id}/watch-status`),

  getComments: (id: number) =>
    api.get<TaskComment[]>(`/tasks/${id}/comments`),

  createComment: (id: number, data: { content: string }) =>
    api.post<TaskComment>(`/tasks/${id}/comments`, data),

  deleteComment: (commentId: number) =>
    api.delete(`/tasks/comments/${commentId}`),

  getAttachments: (id: number) =>
    api.get<TaskAttachment[]>(`/tasks/${id}/attachments`),

  createAttachment: (id: number, data: FormData) =>
    api.post<TaskAttachment>(`/tasks/${id}/attachments`, data, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),

  deleteAttachment: (attachmentId: number) =>
    api.delete(`/tasks/attachments/${attachmentId}`),

  addLabel: (id: number, labelId: number) =>
    api.post<Task>(`/tasks/${id}/labels`, { label_id: labelId }),

  removeLabel: (id: number, labelId: number) =>
    api.delete<Task>(`/tasks/${id}/labels/${labelId}`),

  getChecklistItems: (id: number) =>
    api.get<TaskChecklistItem[]>(`/tasks/${id}/checklist-items`),

  createChecklistItem: (id: number, data: { title: string }) =>
    api.post<TaskChecklistItem>(`/tasks/${id}/checklist-items`, data),

  updateChecklistItem: (itemId: number, data: { title?: string; is_completed?: boolean; position?: number }) =>
    api.patch<TaskChecklistItem>(`/tasks/checklist-items/${itemId}`, data),

  deleteChecklistItem: (itemId: number) =>
    api.delete(`/tasks/checklist-items/${itemId}`),

  getDependencies: (id: number) =>
    api.get<TaskDependency[]>(`/tasks/${id}/dependencies`),

  createDependency: (id: number, dependsOnTaskId: number) =>
    api.post<TaskDependency>(`/tasks/${id}/dependencies`, { depends_on_task_id: dependsOnTaskId }),

  deleteDependency: (dependencyId: number) =>
    api.delete(`/tasks/dependencies/${dependencyId}`),

  storeRecurrence: (id: number, data: {
    frequency: string; interval_value?: number; days_of_week?: number[]; day_of_month?: number; end_date?: string;
  }) => api.post<TaskRecurrence>(`/tasks/${id}/recurrence`, data),

  getRecurrence: (id: number) =>
    api.get<TaskRecurrence | null>(`/tasks/${id}/recurrence`),

  updateRecurrence: (recurrenceId: number, data: { is_active?: boolean; end_date?: string; next_run_date?: string }) =>
    api.put<TaskRecurrence>(`/tasks/recurrence/${recurrenceId}`, data),

  deleteRecurrence: (recurrenceId: number) =>
    api.delete(`/tasks/recurrence/${recurrenceId}`),

  updateReminder: (id: number, remindAt: string | null) =>
    api.patch<Task>(`/tasks/${id}/remind`, { remind_at: remindAt }),
};

// Task Label API
export const taskLabelApi = {
  getAll: () =>
    api.get<TaskLabel[]>('/task-labels'),

  create: (data: { name: string; color?: string }) =>
    api.post<TaskLabel>('/task-labels', data),

  delete: (id: number) =>
    api.delete(`/task-labels/${id}`),
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
  
  start: (data?: { project_id?: number | null; task_id?: number | null; description?: string; billable?: boolean; timer_slot?: 'primary' | 'secondary'; latitude?: number; longitude?: number; accuracy?: number }) => 
    api.post<TimeEntry>('/time-entries/start', data || {}),
  
  stop: (data?: {
    timer_slot?: 'primary' | 'secondary';
    auto_stopped_for_idle?: boolean;
    idle_seconds?: number;
    last_activity_at?: string;
    latitude?: number;
    longitude?: number;
    accuracy?: number;
    // Optional client-supplied stop timestamp (ISO-8601). The offline sync
    // engine posts this so a session that ran offline can be closed with the
    // original click-time. The backend falls back to "now" if the value is
    // missing, in the future, or would create a negative duration.
    ended_at?: string;
  }) =>
    api.post<TimeEntry>('/time-entries/stop', data || {}),
  
  active: (params?: { timer_slot?: 'primary' | 'secondary' }) => 
    api.get<TimeEntry>('/time-entries/active', { params }),
  
  today: () => 
    api.get<{ time_entries: TimeEntry[]; total_duration: number }>('/time-entries/today'),
};

// Geofence API
export const geofenceApi = {
  zones: () =>
    api.get<{ data: Array<{ id: number; name: string; latitude: number; longitude: number; radius_meters: number; is_active: boolean }> }>('/geofence/zones'),

  verify: (data: { latitude: number; longitude: number; accuracy?: number }) =>
    api.post<{ inside_zone: boolean; zone: { id: number; name: string; latitude: number; longitude: number; radius_meters: number } | null }>('/geofence/verify', data),

  create: (data: { name: string; latitude: number; longitude: number; radius_meters: number; is_active?: boolean }) =>
    api.post('/geofence/zones', data),

  update: (id: number, data: { name?: string; latitude?: number; longitude?: number; radius_meters?: number; is_active?: boolean }) =>
    api.put(`/geofence/zones/${id}`, data),

  delete: (id: number) =>
    api.delete(`/geofence/zones/${id}`),
};

// Employee Dashboard API
export const employeeDashboardApi = {
  dashboard: (month?: string) =>
    api.get('/employee/dashboard', { params: { month } }),
};

// Selfie API
export const selfieApi = {
  upload: (data: { image: string; latitude?: number; longitude?: number; accuracy?: number }) =>
    api.post('/attendance/selfie', data),

  todayStatus: () =>
    api.get<{ uploaded: boolean; selfie?: { id: number; image_url: string; created_at: string } }>('/attendance/selfies/today'),

  mapData: (params?: { user_id?: number; start_date?: string; end_date?: string }) =>
    api.get<{ data: Array<{
      id: number;
      user: { id: number; name: string } | null;
      image_url: string;
      latitude: number | null;
      longitude: number | null;
      accuracy_meters: number | null;
      attendance_date: string;
      created_at: string;
    }> }>('/attendance/selfies/map', { params }),
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

  getAllPages: async (params?: { user_id?: number; group_ids?: number[]; type?: string; classification?: string; tool_type?: string; start_date?: string; end_date?: string; processed?: boolean; simple?: boolean | number; per_page?: number; max_records?: number }) => {
    const pageSize = Math.max(1, Number(params?.per_page || 100));
    const maxRecords = Math.min(1000, Number(params?.max_records || 1000)); // Hard limit: 1000 records max
    let page = 1;
    let hasMore = true;
    const results: Activity[] = [];

    while (hasMore && results.length < maxRecords) {
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

      // Stop if we've reached the limit
      if (results.length >= maxRecords) {
        results.splice(maxRecords); // Trim to exact limit
        break;
      }

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

export const productivityClassificationApi = {
  history: (params?: { search?: string; classification?: string; target_type?: string; days?: number; page?: number; per_page?: number }) =>
    api.get<{ data: ProductivityClassificationItem[]; meta: Record<string, any> }>('/settings/productivity/history', { params }),
  create: (data: { target_type: string; target_value: string; classification: string }) =>
    api.post<ProductivityClassificationItem>('/settings/productivity/classifications', data),
  update: (id: number, data: { classification: string }) =>
    api.put<ProductivityClassificationItem>(`/settings/productivity/classifications/${id}`, data),
  remove: (id: number) =>
    api.delete<{ message: string }>(`/settings/productivity/classifications/${id}`),
  batchUpdate: (data: { classification: string; items: Array<{ target_type: string; target_value: string }> }) =>
    api.post<{ message: string }>('/settings/productivity/classifications/batch', data),
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

  exportAttendance: (params?: {
    start_date?: string;
    end_date?: string;
    user_ids?: number[];
  }) => 
    api.get('/reports/attendance/export', { 
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
      timezone?: string;
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
        can_approve_levels: number[];
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

export const notificationApi = {
  list: (params?: { limit?: number; type?: string; types?: string[]; exclude_types?: string[]; q?: string; unread_only?: boolean }) =>
    api.get<{
      data: AppNotificationItem[];
      unread_count: number;
    }>('/notifications', { params }),

  publish: (data: { type: 'announcement' | 'news'; title: string; message: string; priority?: 'low' | 'medium' | 'high' | 'urgent'; recipient_user_ids?: number[] }) =>
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
        users: Array<{
          id: number;
          name?: string;
          email?: string;
          role?: string;
          role_id?: number | null;
          role_name?: string;
          hierarchy_level?: number;
        }>;
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
      employee_profile?: EmployeeProfileDetails | null;
      profile_onboarding_completed?: boolean;
      profile_onboarding_skipped?: boolean;
    }>('/settings/me'),

  updateOnboardingProfile: (data: Partial<EmployeeProfileDetails>) =>
    api.put<{
      message: string;
      user: User;
      employee_profile: EmployeeProfileDetails;
      profile_onboarding_completed: boolean;
    }>('/settings/onboarding-profile', data),

  skipOnboardingProfile: () =>
    api.put<{
      message: string;
      user: User;
      profile_onboarding_skipped: boolean;
    }>('/settings/onboarding-profile/skip'),

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
    timezone?: string;
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
  mockPay: () =>
    api.post<{ success: boolean; message?: string; subscription_status: string; subscription_expires_at: string }>('/billing/mock-pay'),
  upgradePlan: (data: { target_plan_code: string; billing_cycle: string; seats?: number }) =>
    api.post<{ success: boolean; message?: string; amount: number; currency: string; proration_details: any; current_plan: string; target_plan: string }>('/billing/upgrade', data),
  confirmUpgrade: (data: { payment_intent_id: string }) =>
    api.post<{ success: boolean; message?: string; subscription_status: string; plan_code: string; subscription_expires_at: string }>('/billing/confirm-upgrade', data),
  addSeats: (data: { seats: number; billing_cycle: string }) =>
    api.post<{ amount: number; currency: string; seats_to_add: number; new_total_seats: number; price_per_user: number; months: number }>('/billing/add-seats', data),
  cancelPlan: () =>
    api.post<{ success: boolean; message?: string }>('/billing/cancel-plan'),
  cancelPendingUpgrade: () =>
    api.post<{ success: boolean; message?: string }>('/billing/cancel-pending-upgrade'),
  confirmAddSeats: (data: { payment_intent_id: string }) =>
    api.post<{ success: boolean; message?: string; subscription_status: string; max_seats: number }>('/billing/confirm-add-seats', data),
  
  // Razorpay payment methods
  createRazorpayOrder: (data: { amount: number; currency?: string; payment_type?: string }) =>
    api.post<{ success: boolean; order_id: string; amount: number; currency: string; key_id: string; mock_mode?: boolean; message?: string }>('/billing/razorpay/create-order', data),
  verifyRazorpayPayment: (data: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) =>
    api.post<{ success: boolean; payment_id: string; subscription_status: string; subscription_expires_at: string; message?: string }>('/billing/razorpay/verify-payment', data),
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

// Roles & Permissions API
export const roleApi = {
  list: () =>
    api.get<{ data: Array<{
      id: number;
      name: string;
      slug: string;
      description: string | null;
      hierarchy_level: number;
      is_system: boolean;
      is_active: boolean;
      users_count: number;
      permissions: string[];
      created_at: string;
      updated_at: string;
    }> }>('/roles'),

  show: (id: number) =>
    api.get<{ data: {
      id: number;
      name: string;
      slug: string;
      description: string | null;
      hierarchy_level: number;
      is_system: boolean;
      is_active: boolean;
      users_count: number;
      permissions: string[];
      created_at: string;
      updated_at: string;
    } }>(`/roles/${id}`),

  create: (data: { name: string; description?: string; hierarchy_level: number; permissions?: string[] }) =>
    api.post<{ data: any }>('/roles', data),

  update: (id: number, data: { name?: string; description?: string; hierarchy_level?: number; is_active?: boolean; permissions?: string[] }) =>
    api.put<{ data: any }>(`/roles/${id}`, data),

  delete: (id: number) =>
    api.delete(`/roles/${id}`),

  assignUser: (data: { user_id: number; role_id: number | null }) =>
    api.post('/roles/assign-user', data),
};

export const permissionApi = {
  list: () =>
    api.get<{ data: Array<{
      group: string;
      permissions: Array<{
        key: string;
        name: string;
        description: string | null;
        plan_feature: string | null;
      }>;
    }> }>('/permissions'),
};

export const teamApi = {
  getHierarchy: () =>
    api.get<TeamHierarchyPayload>('/me/team-hierarchy'),
};

// Payroll API - Comprehensive
export const payrollApi = {
  // Dashboard & Stats
  getDashboard: () =>
    api.get<PayrollDashboardData>('/payroll/dashboard'),

  getStats: (params?: { month_year?: string }) =>
    api.get<PayrollStats>('/payroll/stats', { params }),

  // Time tracking
  checkIn: () =>
    api.post<{ success: boolean; message: string; entry: PayrollTimeEntry }>('/payroll/check-in'),

  checkOut: () =>
    api.post<{ success: boolean; message: string; entry: PayrollTimeEntry }>('/payroll/check-out'),

  getTimeEntries: (params?: { from?: string; to?: string }) =>
    api.get<PayrollTimeEntry[]>('/payroll/time-entries', { params }),

  // Departments
  getDepartments: (params?: { month_year?: string }) =>
    api.get<{ departments: PayrollDepartment[]; unassigned_count: number; month_year: string }>('/payroll/departments', { params }),

  getDepartmentEmployees: (departmentId: number, params?: { month_year?: string; search?: string }) =>
    api.get<{ department_id: number; employees: PayrollDepartmentEmployee[]; month_year: string }>(`/payroll/departments/${departmentId}/employees`, { params }),

  // Employee Payroll
  getEmployeePayrollDetails: (userId: number, params?: { month_year?: string; annual_ctc?: number }) =>
    api.get<EmployeePayrollDetails>(`/payroll/employees/${userId}`, { params }),

  // Combined benefits summary (reimbursements + FBP + loans) for the
  // 6-step wizard's Steps 3 and 4.
  getBenefitsSummary: (userId: number) =>
    api.get<{
      reimbursements: any[];
      fbp_allocations: any[];
      active_loans: any[];
      totals: { reimbursements: number; fbp: number; monthly_emi: number };
    }>(`/payroll/employees/${userId}/benefits-summary`),

  // Monthly attendance summary (single source of truth for payroll).
  // Returns days AND hours. Default month_year = current month; default
  // user_id = the caller.
  getMonthlyAttendanceSummary: (params?: { user_id?: number; month_year?: string }) =>
    api.get<{
      success: boolean;
      user_id: number;
      month_year: string;
      summary: {
        month_year: string;
        days_in_month: number;
        working_days: number;
        holidays: number;
        weekend_days: number;
        present_days: number;
        absent_days: number;
        paid_leave_days: number;
        lop_days: number;
        half_days: number;
        late_count: number;
        unregularized_absences: number;
        overtime_seconds: number;
        total_worked_seconds: number;
        attendance_source: 'tracker' | 'no_records';
        hours: { worked_hours: number; overtime_hours: number };
      };
    }>('/payroll/attendance-summary', { params }),

  updateEmployeeTemplate: (userId: number, data: Partial<EmployeePayrollTemplate>) =>
    api.put<{ success: boolean; message: string; template: EmployeePayrollTemplate }>(`/payroll/employees/${userId}/template`, data),

  quickSaveCtc: (userId: number, data: { annual_ctc: number; month_year: string }) =>
    api.patch<{ success: boolean; message: string; template: EmployeePayrollTemplate }>(`/payroll/employees/${userId}/ctc`, data),

  processEmployeePayroll: (userId: number, data: ProcessPayrollRequest) =>
    api.post<{ success: boolean; message: string; payroll_item: any }>(`/payroll/employees/${userId}/process`, data),

  // Unified run-payroll entry point (single|department|all). Routes through
  // the same PayrollAutoProcessService::processForUsers, so bulk == individual.
  processScoped: (data: { month_year: string; scope: 'single' | 'department' | 'all'; user_ids?: number[]; department_ids?: number[] }) =>
    api.post<{ success: boolean; run: any; scope: string; user_count: number | null; message: string }>('/payroll/auto/process-scoped', data),

  // Department-level salary template (3-level hierarchy: org -> dept -> employee).
  listDepartmentTemplates: () =>
    api.get<{ success: boolean; templates: any[]; departments_without_template: Array<{ id: number; name: string; slug: string }> }>('/payroll/department-templates'),

  upsertDepartmentTemplate: (departmentId: number, data: any) =>
    api.post<{ success: boolean }>(`/payroll/departments/${departmentId}/template`, data),

  deleteDepartmentTemplate: (templateId: number) =>
    api.delete(`/payroll/department-templates/${templateId}`),

  processSelectedEmployees: (departmentId: number, data: { month_year: string; user_ids: number[]; working_days: number; default_annual_ctc?: number; lOP_days?: number; overtime_hours?: number }) =>
    api.post<{ success: boolean; message: string; succeeded: Array<{ user_id: number; payroll_item_id: number | null }>; failed: Array<{ user_id: number; reason: string }> }>(`/payroll/departments/${departmentId}/process-selected`, data),

  // Calculations
  calculate: (data: CalculatePayrollRequest) =>
    api.post<{ success: boolean; calculation: PayrollCalculation }>('/payroll/calculate', data),

  calculateBulk: (data: { employees: Array<{ user_id: number; annual_ctc: number }>; state?: string; tax_regime?: 'new' | 'old'; is_metro_city?: boolean }) =>
    api.post<{ success: boolean; results: Array<{ user_id: number; calculation: PayrollCalculation }> }>('/payroll/calculate-bulk', data),

  // Legacy - All Employees
  getEmployees: () =>
    api.get<PayrollEmployee[]>('/payroll/employees'),

  updateEmployeeProfile: (userId: number, data: UpdatePayrollProfileRequest) =>
    api.put<{ success: boolean; message: string; profile: any }>(`/payroll/employees/${userId}/profile`, data),

  // Professional Tax
  getPTStates: () =>
    api.get<{ all_states: PTState[]; states_with_pt: PTState[]; states_without_pt: PTState[] }>('/payroll/pt-states'),

  getPTConfiguration: (state: string) =>
    api.get<{ success: boolean; state: string; configuration: { monthly: PTSlab[] }; has_pt: boolean; annual_limit: number }>(`/payroll/pt-states/${state}/configuration`),

  // Payments
  processPayment: (data: ProcessPaymentRequest) =>
    api.post<ProcessPaymentResponse>('/payroll/process-payment', data),

  // Payslips
  generatePayslip: (data: { user_id: number; month: string; payroll_data: PayrollCalculation }) =>
    api.post<{ success: boolean; payslip: PayslipData; download_url: string | null }>('/payroll/generate-payslip', data),

  // Payroll Run Lifecycle
  getPayrollRuns: () =>
    api.get<{ runs: any[] }>('/payroll/runs'),

  /**
   * Atomic "Process & Pay" — creates the run, processes every active
   * employee, locks, approves, and releases in one call. Returns the
   * generated bank file inline so the UI can offer download immediately.
   */
  processAndPay: (data: {
    month_year: string;
    working_days?: number;
    lock_reason?: string;
  }) =>
    api.post<{
      success: boolean;
      already_advanced?: boolean;
      message: string;
      run: any;
      summary?: {
        employees_processed: number;
        employees_skipped_no_ctc: number;
        expected_count: number;
        processed_count: number;
      };
      bank_file?: {
        success: boolean;
        filename: string;
        content: string;
        entries: any[];
        total_amount: number;
        total_employees: number;
        total_pending: number;
        skipped_employees: Array<{
          user_id: number;
          name: string;
          net_pay: number;
          missing_fields: string[];
        }>;
        partial: boolean;
      };
    }>('/payroll/process-and-pay', data),

  /**
   * Disburse a released payroll run. Operator confirms bank file was
   * uploaded to the bank portal; marks all items paid and transitions
   * run to immutable `disbursed` state.
   */
  disburseRun: (runId: number, opts?: { payment_method?: string; pay_date?: string }) =>
    api.post<{ success: boolean; message: string; run: any }>(
      `/payroll/runs/${runId}/disburse`,
      { payment_method: opts?.payment_method ?? 'bank_transfer', pay_date: opts?.pay_date },
    ),

  getPayrollRunDetail: (runId: number) =>
    api.get<{ run: any; items: any[] }>(`/payroll/runs/${runId}`),

  getRunChecklist: (runId: number) =>
    api.get<{
      success: boolean;
      run_id: number;
      month_year: string;
      status: string;
      steps: Array<{
        id: string;
        title: string;
        status: 'completed' | 'pending' | 'no_action';
        detail: string | null;
        icon: string | null;
        last_changed_at: string | null;
        last_changed_by: string | null;
      }>;
      completed_count: number;
      total_count: number;
      pending_count: number;
    }>(`/payroll/runs/${runId}/checklist`),

  getRunActivity: (runId: number) =>
    api.get<{
      success: boolean;
      run_id: number;
      entries: Array<{
        id: number;
        action: string;
        actor_name: string | null;
        metadata: Record<string, unknown> | null;
        ip_address: string | null;
        created_at: string;
      }>;
    }>(`/payroll/runs/${runId}/activity`),

  getRunCompleteness: (runId: number) =>
    api.get<{
      success: boolean;
      run_id: number;
      month_year: string;
      status: string;
      expected_count: number;
      processed_count: number;
      missing_count: number;
      is_complete: boolean;
      missing_employees: Array<{ id: number; name: string; email: string }>;
    }>(`/payroll/runs/${runId}/completeness`),

  processRemainingForRun: (runId: number) =>
    api.post<{
      success: boolean;
      message: string;
      succeeded: number;
      failed: number;
      skipped_no_ctc: number;
      completeness: {
        expected_count: number;
        processed_count: number;
        missing_count: number;
        is_complete: boolean;
        missing_employees: Array<{ id: number; name: string; email: string }>;
      };
    }>(`/payroll/runs/${runId}/process-remaining`),

  unlockPayrollRun: (runId: number, reason: string) =>
    api.post<{ success: boolean; message: string; run: any }>(`/payroll/runs/${runId}/unlock`, { reason }),

  lockPayrollRun: (runId: number, opts?: { force?: boolean; reason?: string; notes?: string }) =>
    api.post<{
      success: boolean;
      message: string;
      run: any;
      completeness?: {
        expected_count: number;
        processed_count: number;
        missing_count: number;
        is_complete: boolean;
        missing_employees: Array<{ id: number; name: string; email: string }>;
      };
    }>(`/payroll/runs/${runId}/lock`, {
      force: opts?.force ? 1 : 0,
      reason: opts?.reason,
      notes: opts?.notes,
    }),

  approvePayrollRun: (runId: number, notes?: string) =>
    api.post<{ success: boolean; message: string; run: any }>(`/payroll/runs/${runId}/approve`, { notes }),

  releasePayrollRun: (runId: number, notes?: string) =>
    api.post<{ success: boolean; message: string; run: any }>(`/payroll/runs/${runId}/release`, { notes }),

  processRunPayment: (runId: number, paymentMethod?: string, payDate?: string) =>
    api.post<{ success: boolean; message: string; run: any }>(`/payroll/runs/${runId}/process-payment`, { payment_method: paymentMethod, pay_date: payDate }),

  markItemPaid: (itemId: number, paymentReference?: string, paymentMethod?: string) =>
    api.post<{ success: boolean; message: string; item: any }>(`/payroll/items/${itemId}/mark-paid`, {
      payment_reference: paymentReference,
      payment_method: paymentMethod,
    }),

  generateBankFile: (runId: number) =>
    api.get<{ success: boolean; filename: string; content: string; entries: any[]; total_amount: number; total_employees: number; total_pending: number; skipped_employees: any[]; partial: boolean }>(`/payroll/runs/${runId}/bank-file`),

  getRunMissingBankDetails: (runId: number) =>
    api.get<{ success: boolean; run_id: number; missing_count: number; missing_employees: any[] }>(`/payroll/runs/${runId}/missing-bank-details`),

  generateBulkPayslips: (runId: number) =>
    api.get<{ success: boolean; run: any; payslips: any[]; total_employees: number }>(`/payroll/runs/${runId}/payslips`),

  // Tax Declarations (Form 12BB)
  getTaxSections: () =>
    api.get<{ sections: Record<string, string>; categories: Record<string, string[]> }>('/payroll/tax-sections'),

  getMyTaxDeclaration: (params?: { financial_year?: string }) =>
    api.get<{ declaration: any; sections: Record<string, string>; categories: Record<string, string[]> }>('/payroll/my/declaration', { params }),

  saveTaxDeclarationItems: (data: { items: any[]; financial_year?: string }) =>
    api.post<{ success: boolean; message: string; declaration: any }>('/payroll/my/declaration/items', data),

  submitTaxDeclaration: (declarationId: number) =>
    api.post<{ success: boolean; message: string; declaration: any }>(`/payroll/my/declaration/${declarationId}/submit`),

  uploadTaxProof: (itemId: number, file: File) => {
    const formData = new FormData();
    formData.append('proof', file);
    return api.post<{ success: boolean; message: string; proof_path: string }>(`/payroll/declaration-items/${itemId}/proof`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  reviewTaxDeclaration: (declarationId: number, data: { action: 'approve' | 'reject'; remarks?: string; items?: any[] }) =>
    api.post<{ success: boolean; message: string; declaration: any }>(`/payroll/declarations/${declarationId}/review`, data),

  listTaxDeclarations: (params?: { financial_year?: string; status?: string }) =>
    api.get<{ declarations: any[]; financial_year: string }>('/payroll/declarations', { params }),

  // ---- Form 12BB / Tax proof upload (employee + admin) ----
  // Employee: list & upload proofs for their own declarations.
  listMyTaxProofs: (params?: { financial_year?: string; status?: string }) =>
    api.get<{ data: any[]; count: number }>('/payroll/tax-proofs/mine', { params }),

  uploadTaxProofV2: (data: { declaration_item_id: number; financial_year: string; amount: number; description?: string; file: File }) => {
    const formData = new FormData();
    formData.append('declaration_item_id', String(data.declaration_item_id));
    if (data.financial_year) formData.append('financial_year', data.financial_year);
    formData.append('amount', String(data.amount));
    if (data.description) formData.append('description', data.description);
    formData.append('proof_file', data.file);
    return api.post<{ success: boolean; message: string; data: any }>(
      '/payroll/tax-proofs', formData,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    );
  },

  downloadMy12BB: (financialYear: string) =>
    api.get<{ message: string; financial_year: string; submissions: any[]; total_declared: number }>(`/payroll/tax-proofs/my-12bb/${encodeURIComponent(financialYear)}`),

  // Admin: list, review, bulk-approve, get compliance summary.
  listTaxProofs: (params?: { financial_year?: string; status?: string; user_id?: number; section?: string }) =>
    api.get<{ data: any[]; count: number; summary?: any }>('/payroll/tax-proofs', { params }),

  reviewTaxProof: (id: number, data: { decision: 'approved' | 'rejected' | 'partial'; approved_amount?: number; notes?: string }) =>
    api.post<{ message: string; data: any }>(`/payroll/tax-proofs/${id}/review`, data),

  bulkApproveTaxProofs: (userId: number, financialYear?: string) =>
    api.post<{ message: string; count: number }>(
      '/payroll/tax-proofs/bulk-approve', { user_id: userId, financial_year: financialYear },
    ),

  taxProofsSummary: (financialYear?: string) =>
    api.get<{ total_submissions: number; by_status: Record<string, number>; pending_amount: number; approved_amount: number; organisation_id: number; financial_year?: string }>(
      '/payroll/tax-proofs/summary', { params: financialYear ? { financial_year: financialYear } : undefined },
    ),

  // Loan / Advance Management
  requestLoan: (data: { loan_type: string; amount: number; emi_amount: number; total_installments: number; purpose?: string }) =>
    api.post<{ success: boolean; message: string; loan: any }>('/payroll/loans/request', data),

  getMyLoans: () =>
    api.get<{ loans: any[]; active_loan: any | null }>('/payroll/my/loans'),

  listLoans: (params?: { user_id?: number; status?: string }) =>
    api.get<{ loans: any[] }>('/payroll/loans', { params }),

  approveLoan: (loanId: number) =>
    api.post<{ success: boolean; message: string; loan: any }>(`/payroll/loans/${loanId}/approve`),

  rejectLoan: (loanId: number, rejection_reason: string) =>
    api.post<{ success: boolean; message: string; loan: any }>(`/payroll/loans/${loanId}/reject`, { rejection_reason }),

  closeLoan: (loanId: number) =>
    api.post<{ success: boolean; message: string; loan: any }>(`/payroll/loans/${loanId}/close`),

  // Employee Self-Service
  getMyPayslips: () =>
    api.get<{ payslips: any[]; ytd: { gross: number; deductions: number; net_pay: number; months_count: number }; employee: any }>('/payroll/my/payslips'),

  downloadPayslipPdf: (userId: number, monthYear: string, config?: any) =>
    api.get(`/payroll/payslip/${userId}/${monthYear}/download`, { ...config, responseType: 'blob' }),

  viewPayslipPdf: (userId: number, monthYear: string, config?: any) =>
    api.get(`/payroll/payslip/${userId}/${monthYear}/view`, { ...config, responseType: 'blob' }),

  // Payroll Organization Settings
  getPayrollSettings: () =>
    api.get<{ success: boolean; settings: PayrollOrganizationSettings }>('/payroll/settings'),
  
  updatePayrollSettings: (settings: Partial<PayrollOrganizationSettings>) =>
    api.put<{ success: boolean; message: string; settings: PayrollOrganizationSettings }>('/payroll/settings', settings),

  resetPayrollSettings: () =>
    api.post<{ success: boolean; message: string; settings: PayrollOrganizationSettings }>('/payroll/settings/reset'),

  applySettingsToAllEmployees: (force: boolean = false) =>
    api.post<{ success: boolean; message: string; affected_count: number; applied_fields: string[] }>('/payroll/settings/apply-to-all-employees', null, { params: { force } }),

  // Dashboard Data
  getDashboardData: (params?: { month_year?: string }) =>
    api.get<{ success: boolean; data: any }>('/payroll/dashboard-data', { params }),

  // Legacy Summary
  getSummary: (params?: { month?: string }) =>
    api.get<PayrollSummary>('/payroll/summary', { params }),

  // ===== Statutory Filings =====
  listFilings: (params?: Record<string, any>) =>
    api.get<any>('/payroll/filings', { params }),
  getFiling: (id: number) =>
    api.get<any>(`/payroll/filings/${id}`),
  downloadFiling: (id: number) =>
    api.get(`/payroll/filings/${id}/download`, { responseType: 'blob' }),
  generatePfEcr: (payrollRunId: number) =>
    api.post<any>('/payroll/filings/generate/pf-ecr', { payroll_run_id: payrollRunId }),
  generateEsiChallan: (payrollRunId: number) =>
    api.post<any>('/payroll/filings/generate/esi-challan', { payroll_run_id: payrollRunId }),
  generateForm24Q: (payrollRunId: number) =>
    api.post<any>('/payroll/filings/generate/form-24q', { payroll_run_id: payrollRunId }),
  generateForm16: (userId: number, financialYear: string) =>
    api.post<any>('/payroll/filings/generate/form-16', { user_id: userId, financial_year: financialYear }),
  generateForm12BA: (payrollRunId: number) =>
    api.post<any>('/payroll/filings/generate/form-12ba', { payroll_run_id: payrollRunId }),
  generatePtReturn: (payrollRunId: number, state: string) =>
    api.post<any>('/payroll/filings/generate/pt-return', { payroll_run_id: payrollRunId, state }),
  generateLwfReturn: (payrollRunId: number) =>
    api.post<any>('/payroll/filings/generate/lwf-return', { payroll_run_id: payrollRunId }),
  generateAllFilings: (payrollRunId: number) =>
    api.post<any>('/payroll/filings/generate/all', { payroll_run_id: payrollRunId }),

  // ===== FBP =====
  getFbpComponents: () =>
    api.get<any>('/payroll/fbp/components'),
  getFbpAllocations: (userId: number) =>
    api.get<any>(`/payroll/fbp/allocations/${userId}`),
  allocateFbp: (data: { user_id: number; fbp_component_id: number; amount: number }) =>
    api.post<any>('/payroll/fbp/allocate', data),
  submitFbpClaim: (data: Record<string, any>) =>
    api.post<any>('/payroll/fbp/claims', data),
  approveFbpClaim: (id: number, approvedAmount: number, monthYear?: string) =>
    api.post<any>(`/payroll/fbp/claims/${id}/approve`, { approved_amount: approvedAmount, month_year: monthYear }),
  rejectFbpClaim: (id: number, reason: string) =>
    api.post<any>(`/payroll/fbp/claims/${id}/reject`, { reason }),

  // ===== Perquisites =====
  createPerquisite: (data: Record<string, any>) =>
    api.post<any>('/payroll/perquisites', data),
  getUserPerquisites: (userId: number) =>
    api.get<any>(`/payroll/perquisites/user/${userId}`),

  // ===== Tax Simulator =====
  compareTaxRegimes: (data: { annual_ctc: number; exemptions?: Record<string, number>; is_metro?: boolean }) =>
    api.post<any>('/payroll/tax-simulator/compare', data),
  taxWhatIf: (data: { current_ctc: number; scenarios: Record<string, any>[] }) =>
    api.post<any>('/payroll/tax-simulator/what-if', data),
  calculateMonthlyTakeHome: (data: { annual_ctc: number; regime?: string; exemptions?: Record<string, number> }) =>
    api.post<any>('/payroll/tax-simulator/monthly-take-home', data),

  // ===== Salary Revision Letters =====
  generateRevisionLetter: (data: { user_id: number; new_ctc: number; revision_type: string; reason: string }) =>
    api.post<any>('/payroll/revision-letters', data),
  getRevisionLetters: (userId?: number) =>
    api.get<any>(userId ? `/payroll/revision-letters/user/${userId}` : '/payroll/revision-letters'),
  acceptRevisionLetter: (id: number) =>
    api.post<any>(`/payroll/revision-letters/${id}/accept`),
  rejectRevisionLetter: (id: number) =>
    api.post<any>(`/payroll/revision-letters/${id}/reject`),

  // ===== Checklist =====
  runPayrollValidation: (payrollRunId: number) =>
    api.post<any>('/payroll/checklist/validate-run', { payroll_run_id: payrollRunId }),
  getChecklistStatus: (runId: number) =>
    api.get<any>(`/payroll/checklist/run/${runId}`),
  resolveCheck: (checkId: number, resolution: string) =>
    api.post<any>('/payroll/checklist/resolve', { check_id: checkId, resolution }),

  // ===== Arrears =====
  listArrears: (params?: { status?: string }) =>
    api.get<{ data: any[] }>('/payroll/arrears', { params }),
  createArrear: (data: Record<string, any>) =>
    api.post<any>('/payroll/arrears', data),
  approveArrear: (id: number) =>
    api.post<any>(`/payroll/arrears/${id}/approve`),
  rejectArrear: (id: number, reason: string) =>
    api.post<any>(`/payroll/arrears/${id}/reject`, { reason }),
  detectCtcArrears: (userId: number, currentMonthYear: string) =>
    api.get<any>(`/payroll/arrears/detect/${userId}`, { params: { current_month_year: currentMonthYear } }),
  calculateArrear: (data: { user_id: number; month_year: string; amount: number; reason: string }) =>
    api.post<any>('/payroll/arrears/calculate', data),

  // ===== Leave Encashment =====
  listLeaveEncashments: (params?: { status?: string }) =>
    api.get<{ data: any[] }>('/payroll/leave-encashments', { params }),
  requestLeaveEncashment: (data: Record<string, any>) =>
    api.post<any>('/payroll/leave-encashments', data),
  approveLeaveEncashment: (id: number) =>
    api.post<any>(`/payroll/leave-encashments/${id}/approve`),
  rejectLeaveEncashment: (id: number, reason: string) =>
    api.post<any>(`/payroll/leave-encashments/${id}/reject`, { reason }),

  // ===== F&F Settlements =====
  listFnFSettlements: (params?: { status?: string }) =>
    api.get<{ data: any[] }>('/payroll/fnf-settlements', { params }),
  createFnFSettlement: (data: Record<string, any>) =>
    api.post<any>('/payroll/fnf-settlements', data),
  approveFnFSettlement: (id: number) =>
    api.post<any>(`/payroll/fnf-settlements/${id}/approve`),
  rejectFnFSettlement: (id: number, reason: string) =>
    api.post<any>(`/payroll/fnf-settlements/${id}/reject`, { reason }),
  processFnFPayment: (id: number, paymentMethod: string, reference?: string) =>
    api.post<any>(`/payroll/fnf-settlements/${id}/process-payment`, { payment_method: paymentMethod, payment_reference: reference }),

  // ===== Variable Pay =====
  calculateVariablePay: (userId: number, payrollItemId: number) =>
    api.post<any>('/payroll/variable-pay/calculate', { user_id: userId, payroll_item_id: payrollItemId }),

  // ===== Reports =====
  getPayrollRegister: (data: { month_year: string; filters?: Record<string, any> }) =>
    api.post<any>('/payroll/reports/payroll-register', data),
  getStatutoryRegister: (data: { month_year: string; type: string }) =>
    api.post<any>('/payroll/reports/statutory-register', data),
  getBankReconciliation: (monthYear: string) =>
    api.post<any>('/payroll/reports/bank-reconciliation', { month_year: monthYear }),

  // ===== Bank Integration =====
  listBatches: () =>
    api.get<any>('/payroll/bank/batches'),
  createTransferBatch: (payrollRunId: number, bankName?: string) =>
    api.post<any>('/payroll/bank/create-batch', { payroll_run_id: payrollRunId, bank_name: bankName }),
  processBatch: (batchId: number) =>
    api.post<any>(`/payroll/bank/batches/${batchId}/process`),
  generateBatchBankFile: (batchId: number, format?: string) =>
    api.post<any>(`/payroll/bank/batches/${batchId}/file`, { format }),
  initiatePaymentReversal: (data: { payroll_item_id: number; reason: string }) =>
    api.post<any>('/payroll/bank/payment-reversal', data),

  // ===== Formula Engine =====
  evaluateFormula: (expression: string, variables?: Record<string, number>) =>
    api.post<{ success: boolean; result?: number; expression?: string; variables_used?: Record<string, number>; error?: string }>('/payroll/formula-engine/evaluate', { expression, variables }).then(r => r.data),
  validateFormula: (expression: string) =>
    api.post<{ valid: boolean; errors?: string[]; parsed?: string }>('/payroll/formula-engine/validate', { expression }).then(r => r.data),

  // ===== Pay Groups =====
  listPayGroups: (params?: { month_year?: string }) =>
    api.get<{ pay_groups: PayGroup[] }>('/payroll/pay-groups', { params }),
  createPayGroup: (data: Record<string, any>) =>
    api.post<any>('/payroll/pay-groups', data),
  // All employees across the organization (for the Create Pay Group
  // modal). Supports ?search= (matches name/email/designation) and
  // ?department_id= filters. Paginated server-side (50 per page by
  // default); use `page` to fetch subsequent pages.
  getAllEmployees: (params?: {
    search?: string;
    department_id?: number;
    page?: number;
    per_page?: number;
  }) =>
    api.get<{
      employees: AllEmployee[];
      total: number;
      current_page: number;
      last_page: number;
      per_page: number;
    }>('/payroll/all-employees', { params }),
  // Employees not assigned to any pay group (paginated, searchable)
  getUnassignedEmployees: (params?: {
    search?: string;
    page?: number;
    per_page?: number;
  }) =>
    api.get<{
      employees: AllEmployee[];
      total: number;
      current_page: number;
      last_page: number;
      per_page: number;
    }>('/payroll/unassigned-employees', { params }),
  // Create a pay group and assign employees in one call. The backend
  // auto-derives the `code` and handles re-assignment by closing any
  // existing active assignment for the same user.
  assignEmployeesToPayGroup: (data: CreatePayGroupPayload) =>
    api.post<{
      success: boolean;
      pay_group_id: number;
      pay_group_name: string;
      pay_group_code: string;
      assigned_count: number;
    }>('/payroll/pay-groups/assign', data),
  assignEmployeeToExistingPayGroup: (data: { pay_group_id: number; user_ids: number[]; salary_structure_id?: number; effective_from?: string }) =>
    api.post<{
      success: boolean;
      pay_group_id: number;
      pay_group_name: string;
      pay_group_code: string;
      assigned_count: number;
    }>('/payroll/pay-groups/assign-existing', data),
  // Get the active employees in a pay group with their per-month
  // payroll status. Response shape mirrors getDepartmentEmployees so
  // the EmployeeCard component is shared.
  getPayGroupEmployees: (payGroupId: number, params?: { month_year?: string }) =>
    api.get<{
      pay_group: { id: number; name: string; code: string; pay_frequency: string };
      employees: PayGroupEmployee[];
    }>(`/payroll/pay-groups/${payGroupId}/employees`, { params }),
  // Bulk-process payroll for the selected members of a pay group.
  // Mirrors processSelectedEmployees but validates against
  // pay-group membership instead of department membership.
  processPayGroupSelectedEmployees: (
    payGroupId: number,
    data: {
      month_year: string;
      user_ids: number[];
      working_days: number;
      default_annual_ctc?: number;
      lOP_days?: number;
      overtime_hours?: number;
    },
  ) =>
    api.post<{
      success: boolean;
      message: string;
      succeeded: Array<{ user_id: number; payroll_item_id: number | null }>;
      failed: Array<{ user_id: number; reason: string }>;
    }>(`/payroll/pay-groups/${payGroupId}/process-selected`, data),
  // Bulk Payroll Matrix — step completion tracking.
  // Marks a single wizard step (1..6) as complete for one or more
  // employees in a pay group.
  completeStep: (
    payGroupId: number,
    data: { step: number; user_ids: number[] },
  ) =>
    api.post<{
      success: boolean;
      step: number;
      updated_count: number;
    }>(`/payroll/pay-groups/${payGroupId}/complete-step`, data),
  // Marks a single wizard step as complete for every active member
  // of the pay group in one call. Used by the "Done All for Step N"
  // button in the BulkPayrollMatrix.
  completeAllSteps: (payGroupId: number, data: { step: number }) =>
    api.post<{
      success: boolean;
      step: number;
      updated_count: number;
      total_members: number;
    }>(`/payroll/pay-groups/${payGroupId}/complete-all-steps`, data),
  // Returns the per-step completion counts for a pay group. The
  // BulkPayrollMatrix footer renders "X of Y employees on this
  // step" from these counts.
  getStepStatus: (payGroupId: number) =>
    api.get<PayGroupStepStatus>(
      `/payroll/pay-groups/${payGroupId}/step-status`,
    ),

  // ===== Compensation =====
  listDailyWageStructures: () =>
    api.get<any>('/payroll/compensation/daily-wage-structures'),
  listCtcBands: () =>
    api.get<any>('/payroll/compensation/ctc-bands'),
  findCtcBand: (annualCtc: number) =>
    api.post<any>('/payroll/compensation/find-ctc-band', { annual_ctc: annualCtc }),

  // ===== Auto Process (One-Click Payroll - Keka/GreytHR-style) =====
  quickProcessPayroll: (monthYear: string) =>
    api.post<{ success: boolean; run: any; message: string }>('/payroll/auto/quick-process', { month_year: monthYear }),
  processPayrollWithChecklist: (monthYear: string) =>
    api.post<any>('/payroll/auto/process-with-checklist', { month_year: monthYear }),
  quickValidatePayroll: (monthYear: string) =>
    api.post<any>('/payroll/auto/quick-validate', { month_year: monthYear }),
  detectPayrollChanges: (monthYear: string) =>
    api.post<{ success: boolean; changes: Record<string, any>; has_changes: boolean }>('/payroll/auto/detect-changes', { month_year: monthYear }),
  getPayrollDiff: (monthYear: string) =>
    api.post<{ success: boolean; has_prev: boolean; diff: Record<string, any>; current: Record<string, any>; previous: Record<string, any> }>('/payroll/auto/diff', { month_year: monthYear }),
  autoGenerateFilings: (runId: number) =>
    api.post<{ success: boolean; filings_generated: number; filings: any[] }>('/payroll/auto/generate-filings', { run_id: runId }),
  validatePayrollRun: (runId: number) =>
    api.post<any>('/payroll/auto/validate-run', { run_id: runId }),
  getAutoChecklistStatus: (runId: number) =>
    api.get<any>(`/payroll/auto/checklist-status/${runId}`),

  // ===== Reimbursements =====
  listReimbursements: (params?: { status?: string }) =>
    api.get<{ data: any[] }>('/payroll/reimbursements', { params }),
  createReimbursement: (data: Record<string, any>) =>
    api.post<any>('/payroll/reimbursements', data),
  approveReimbursement: (id: number) =>
    api.post<any>(`/payroll/reimbursements/${id}/approve`),
  rejectReimbursement: (id: number, reason: string) =>
    api.post<any>(`/payroll/reimbursements/${id}/reject`, { reason }),
  // Soft-remove a previously-approved reimbursement so it stops being
  // included in the next payroll run. Sets status='removed' on the
  // server. Idempotent on the backend but the UI treats each click as
  // a deliberate confirmation.
  removeReimbursement: (id: number) =>
    api.post<any>(`/payroll/reimbursements/${id}/remove`),
  // Used by the Salary Structure wizard to show approved reimbursements
  // for the current employee.
  getEmployeeReimbursements: (employeeId: number, status?: 'pending' | 'approved' | 'rejected' | 'removed') =>
    api.get<any[]>('/payroll/reimbursements', {
      params: { user_id: employeeId, status: status ?? 'approved' },
    }),

  // ===== Revision Letters (Employee self-service) =====
  myRevisionLetters: () =>
    api.get<{ data: any[] }>('/payroll/revision-letters/user/me'),

  // ===== Onboarding (first-time user guidance) =====
  getOnboardingStatus: () =>
    api.get<{
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
    }>('/payroll/onboarding-status'),
  markDefaultsConfigured: () =>
    api.post<{ success: boolean; message: string }>('/payroll/onboarding/mark-defaults-configured'),
  dismissOnboarding: () =>
    api.post<{ success: boolean; message: string }>('/payroll/onboarding/dismiss'),
  reopenOnboarding: () =>
    api.post<{ success: boolean; message: string }>('/payroll/onboarding/reopen'),
  markSetupStep: (step: string) =>
    api.post<{ success: boolean; message: string; completed_steps: string[] }>('/payroll/onboarding/mark-setup-step', { step }),
  unmarkSetupStep: (step: string) =>
    api.post<{ success: boolean; message: string; completed_steps: string[] }>('/payroll/onboarding/unmark-setup-step', { step }),
  markWelcomeSeen: () =>
    api.post<{ success: boolean; message: string }>('/payroll/onboarding/mark-welcome-seen'),

  // Salary Structure Templates
  getSalaryStructures: () =>
    api.get<{ success: boolean; templates: SalaryStructure[] }>('/payroll/salary-structures'),
  createSalaryStructure: (data: CreateSalaryStructurePayload) =>
    api.post<{ success: boolean; message: string; template: SalaryStructure }>('/payroll/salary-structures', data),
  getDefaultSalaryStructure: () =>
    api.get<{ success: boolean; template: SalaryStructure }>('/payroll/salary-structures/default'),
  getSalaryStructure: (id: number, annualCtc?: number) =>
    api.get<{ success: boolean; template: SalaryStructure; breakdown?: SalaryStructureBreakdown }>(
      `/payroll/salary-structures/${id}`,
      { params: annualCtc ? { annual_ctc: annualCtc } : undefined }
    ),
  updateSalaryStructure: (id: number, data: Partial<CreateSalaryStructurePayload>) =>
    api.put<{ success: boolean; message: string; template: SalaryStructure }>(`/payroll/salary-structures/${id}`, data),
  deleteSalaryStructure: (id: number) =>
    api.delete<{ success: boolean; message: string }>(`/payroll/salary-structures/${id}`),
  previewSalaryStructure: (id: number, annualCtc: number) =>
    api.post<{ success: boolean; breakdown: SalaryStructureBreakdown; annual_ctc: number }>(
      `/payroll/salary-structures/${id}/preview`,
      { annual_ctc: annualCtc }
    ),

  // Employee Payroll Cards
  getEmployeePayrollCards: (params?: { department_id?: number; pay_group_id?: number; state?: string }) =>
    api.get<{ success: boolean; employees: EmployeePayrollCard[] }>('/payroll/employee-cards', { params }),
  getEmployeePayrollCard: (userId: number) =>
    api.get<{ success: boolean; employee: any; payroll_config: EmployeePayrollConfig }>(`/payroll/employee-cards/${userId}`),
  updateEmployeePayrollCard: (userId: number, data: UpdateEmployeePayrollCardPayload) =>
    api.put<{ success: boolean; employee: any; payroll_config: EmployeePayrollConfig }>(`/payroll/employee-cards/${userId}`, data),

  // Pay Group Settings
  getPayGroupSettings: () =>
    api.get<{ success: boolean; pay_groups: PayGroupSettings[] }>('/payroll/pay-group-settings'),
  createPayGroupSettings: (data: CreatePayGroupSettingsPayload) =>
    api.post<{ success: boolean; message: string; pay_group: PayGroupSettings }>('/payroll/pay-group-settings', data),
  getPayGroupSetting: (id: number) =>
    api.get<{ success: boolean; pay_group: PayGroupSettings }>(`/payroll/pay-group-settings/${id}`),
  updatePayGroupSettings: (id: number, data: Partial<CreatePayGroupSettingsPayload>) =>
    api.put<{ success: boolean; message: string; pay_group: PayGroupSettings }>(`/payroll/pay-group-settings/${id}`, data),
  deletePayGroupSettings: (id: number) =>
    api.delete<{ success: boolean; message: string }>(`/payroll/pay-group-settings/${id}`),
  updatePayGroupStatutoryRules: (id: number, data: {
    pf_enabled?: boolean;
    esi_enabled?: boolean;
    pt_enabled?: boolean;
    lwf_enabled?: boolean;
    tds_enabled?: boolean;
  }) =>
    api.put<{ success: boolean; message: string; statutory_rules: any }>(`/payroll/pay-group-settings/${id}/statutory-rules`, data),

  // Payslip Management
  generatePayslips: (data: { pay_group_id: number; pay_month: number; pay_year: number }) =>
    api.post<{ success: boolean; message: string; data: any }>('/payroll/payslips/generate', data),
  listPayslips: (params: { pay_group_id: number; pay_month: number; pay_year: number }) =>
    api.get<{ success: boolean; data: any[] }>('/payroll/payslips', { params }),
  getPayslip: (id: number) =>
    api.get<{ success: boolean; data: any }>(`/payroll/payslips/${id}`),
  downloadPayslipPdfById: (id: number) =>
    api.get<{ success: boolean; url: string }>(`/payroll/payslips/${id}/pdf`),
  getPayslipYtd: (id: number, payYear: number) =>
    api.get<{ success: boolean; data: any[] }>(`/payroll/payslips/${id}/ytd`, { params: { pay_year: payYear } }),
  updatePayGroupFilingDetails: (id: number, data: UpdateFilingDetailsPayload) =>
    api.put<{ success: boolean; message: string; pay_group: PayGroupSettings }>(`/payroll/pay-group-settings/${id}/filing-details`, data),
  getPayGroups: (params?: { is_active?: boolean }) =>
    api.get<{ success: boolean; pay_groups: PayGroup[] }>('/payroll/pay-groups', { params }),

  // ===== Salary Components (org-level component manager) =====
  listSalaryComponents: () =>
    api.get<{ success: boolean; components: SalaryComponent[] }>('/payroll/salary-components').then(r => r.data),
  getSalaryComponent: (id: number) =>
    api.get<{ success: boolean; component: SalaryComponent }>(`/payroll/salary-components/${id}`).then(r => r.data),
  createSalaryComponent: (data: {
    name: string;
    code: string;
    category: 'earning' | 'deduction';
    value_type: 'flat' | 'percentage' | 'formula';
    calculation_basis?: string;
    default_value?: number;
    is_taxable?: boolean;
    is_compliance_component?: boolean;
  }) => api.post<{ success: boolean; message: string; component: SalaryComponent }>('/payroll/salary-components', data).then(r => r.data),
  updateSalaryComponent: (id: number, data: Record<string, unknown>) =>
    api.put<{ success: boolean; message: string; component: SalaryComponent }>(`/payroll/salary-components/${id}`, data).then(r => r.data),
  deleteSalaryComponent: (id: number) =>
    api.delete<{ success: boolean; message: string }>(`/payroll/salary-components/${id}`).then(r => r.data),
  toggleSalaryComponent: (id: number) =>
    api.post<{ success: boolean; message: string; component: SalaryComponent }>(`/payroll/salary-components/${id}/toggle`).then(r => r.data),
  saveComponentFormula: (componentId: number, data: { formula_expression: string; description?: string }) =>
    api.post<{ success: boolean; message: string; formula: SalaryFormula; component: SalaryComponent }>(
      `/payroll/salary-components/${componentId}/formula`, data).then(r => r.data),
  deleteComponentFormula: (componentId: number, formulaId: number) =>
    api.delete<{ success: boolean; message: string }>(
      `/payroll/salary-components/${componentId}/formula/${formulaId}`).then(r => r.data),
  validateComponentFormula: (componentId: number, data: { formula_expression: string }) =>
    api.post<{ success: boolean; valid: boolean; message: string }>(
      `/payroll/salary-components/${componentId}/formula/validate`, data).then(r => r.data),
};

export default api;
