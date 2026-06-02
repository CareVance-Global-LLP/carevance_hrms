// User Types
export interface User {
  id: number;
  name: string;
  email: string;
  email_verified_at?: string | null;
  role: 'admin' | 'manager' | 'employee' | 'client' | 'super_admin';
  role_id?: number | null;
  role_name?: string | null;
  hierarchy_level?: number | null;
  organization_id: number | null;
  invited_by?: number | null;
  avatar?: string | null;
  hourly_rate?: number;
  is_active: boolean;
  is_working?: boolean;
  current_duration?: number;
  current_project?: string | null;
  total_duration?: number;
  total_elapsed_duration?: number;
  settings?: Record<string, any>;
  employee_profile?: EmployeeProfileDetails | null;
  groups?: Group[];
  permissions?: string[];
  created_at: string;
  updated_at: string;
}

// Organization Types
export interface Organization {
  id: number;
  name: string;
  slug: string;
  owner_user_id?: number | null;
  plan_code?: string | null;
  billing_cycle?: 'monthly' | 'yearly' | null;
  subscription_status?: 'trial' | 'active' | 'inactive' | 'past_due' | 'cancelled' | 'expired';
  subscription_intent?: 'trial' | 'paid' | 'upgrade' | 'add_seats' | null;
  trial_starts_at?: string | null;
  trial_ends_at?: string;
  max_users?: number;
  max_seats?: number;
  settings?: Record<string, any>;
  pending_plan_code?: string | null;
  pending_billing_cycle?: 'monthly' | 'yearly' | null;
  pending_seats?: number | null;
  pending_upgrade_amount?: number | string | null;
  subscription_expires_at?: string | null;
  users_count?: number;
  created_at: string;
  updated_at: string;
}

export interface Group {
  id: number;
  organization_id: number;
  name: string;
  slug?: string | null;
  description?: string | null;
  is_active: boolean;
  tasks_count?: number;
  users?: Array<Pick<User, 'id' | 'name' | 'email' | 'role'>>;
  created_at: string;
  updated_at: string;
}

// Project Types
export interface Project {
  id: number;
  organization_id: number;
  group_id?: number | null;
  name: string;
  description?: string;
  color: string;
  budget?: number;
  budget_type?: 'hours' | 'amount';
  hourly_rate?: number;
  status: 'active' | 'on_hold' | 'completed' | 'archived';
  deadline?: string;
  client_name?: string;
  client_email?: string;
  created_at: string;
  updated_at: string;
  group?: Group | null;
}

// Task Types
export interface Task {
  id: number;
  group_id?: number | null;
  project_id?: number | null;
  assignee_id?: number | null;
  title: string;
  description?: string;
  status: 'todo' | 'in_progress' | 'in_review' | 'done';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  due_date?: string;
  estimated_time?: number;
  created_at: string;
  updated_at: string;
  group?: Group | null;
  project?: Project | null;
  assignee?: User | null;
  assignees?: User[];
  time_entries_sum_duration?: number;
  labels?: TaskLabel[];
  remind_at?: string | null;
  reminded_at?: string | null;
  checklist_items?: TaskChecklistItem[];
  dependencies?: TaskDependency[];
  recurrence?: TaskRecurrence[];
}

export interface TaskActivity {
  id: number;
  task_id: number;
  actor_id?: number | null;
  action: string;
  description: string;
  meta?: Record<string, any> | null;
  created_at: string;
  actor?: {
    id: number;
    name: string;
    email: string;
  } | null;
}

// Task Comment Types
export interface TaskComment {
  id: number;
  task_id: number;
  user_id: number;
  content: string;
  created_at: string;
  updated_at: string;
  user?: {
    id: number;
    name: string;
    email: string;
  } | null;
}

// Task Attachment Types
export interface TaskAttachment {
  id: number;
  task_id: number;
  user_id: number;
  filename: string;
  original_filename: string;
  mime_type?: string | null;
  file_size?: number | null;
  created_at: string;
  user?: {
    id: number;
    name: string;
    email: string;
  } | null;
}

// Task Label Types
export interface TaskLabel {
  id: number;
  organization_id: number;
  name: string;
  color: string;
  created_at: string;
  updated_at: string;
}

// Task Checklist Types
export interface TaskChecklistItem {
  id: number;
  task_id: number;
  title: string;
  is_completed: boolean;
  position: number;
  created_at: string;
  updated_at: string;
}

// Task Dependency Types
export interface TaskDependency {
  id: number;
  task_id: number;
  depends_on_task_id: number;
  created_at: string;
  depends_on_task?: Task | null;
}

// Task Recurrence Types
export interface TaskRecurrence {
  id: number;
  task_id: number | null;
  template_title: string;
  template_description?: string | null;
  template_priority: string;
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval_value: number;
  days_of_week?: number[] | null;
  day_of_month?: number | null;
  start_date: string;
  end_date?: string | null;
  next_run_date: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// Time Entry Types
export interface TimeEntry {
  id: number;
  user_id: number;
  organization_id: number;
  project_id?: number | null;
  task_id?: number | null;
  timer_slot?: 'primary' | 'secondary';
  start_time: string;
  end_time?: string;
  duration: number;
  description?: string;
  billable: boolean;
  is_manual: boolean;
  activity_level?: number;
  created_at: string;
  updated_at: string;
  user?: User;
  project?: Project | null;
  task?: Task | null;
}

// Screenshot Types
export interface Screenshot {
  id: number;
  time_entry_id: number;
  session_id?: number;
  user_id: number;
  filename: string;
  thumbnail?: string;
  path: string;
  recorded_at: string;
  activity_state?: 'active';
  user?: User;
  time_entry?: TimeEntry;
}

// Activity Types
export interface Activity {
  id: number;
  user_id: number;
  time_entry_id?: number;
  source?: 'activity' | 'activity_session';
  type: 'app' | 'url' | 'idle';
  name: string;
  duration: number;
  recorded_at: string;
  normalized_label?: string | null;
  normalized_domain?: string | null;
  software_name?: string | null;
  tool_type?: 'software' | 'website' | 'idle' | null;
  classification?: 'productive' | 'unproductive' | 'neutral' | 'context_dependent' | null;
  classification_reason?: string | null;
  classified_at?: string | null;
  classifier_version?: string | null;
  user?: User;
  time_entry?: TimeEntry;
}

export interface ActivitySession {
  id: number;
  user_id: number;
  time_entry_id?: number | null;
  source: string;
  activity_kind: string;
  tool_type: 'software' | 'website' | 'idle' | string;
  display_name: string;
  app_name?: string | null;
  window_title?: string | null;
  url?: string | null;
  normalized_label?: string | null;
  normalized_domain?: string | null;
  software_name?: string | null;
  classification?: 'productive' | 'unproductive' | 'neutral' | 'context_dependent' | null;
  classification_reason?: string | null;
  started_at: string;
  ended_at?: string | null;
  duration_seconds: number;
  confidence?: number;
  metadata?: Record<string, any> | null;
  created_at?: string;
  updated_at?: string;
  user?: User;
  time_entry?: TimeEntry;
}

export interface BrowserTrackingEvent {
  kind: 'tab-focused' | 'tab-updated' | 'tab-closed' | 'window-blurred' | 'heartbeat';
  browser_name: string;
  profile_key: string;
  tab_id?: number | null;
  window_id?: number | null;
  url?: string | null;
  title?: string | null;
  recorded_at: string;
}

export interface BrowserTrackingPairingCode {
  value: string;
  expires_at: string;
  browser_name?: string;
  user_id?: number | null;
}

export interface BrowserTrackingConnection {
  browser_name: string;
  profile_key: string;
  extension_origin?: string | null;
  last_seen_at?: string | null;
  extension_version?: string | null;
  paired_at?: string | null;
  user_id?: number | null;
}

export interface BrowserTrackingState {
  ready: boolean;
  local_url?: string | null;
  connections: BrowserTrackingConnection[];
  pairing_code?: BrowserTrackingPairingCode | null;
  last_event_at?: string | null;
  last_error?: string | null;
}

export interface DesktopDeviceIdentity {
  device_id: string;
  device_label: string | null;
}

export interface BrowserTrackingConnectionSyncItem {
  browser_name: string;
  profile_key: string;
  extension_origin?: string | null;
  extension_version?: string | null;
  paired_at?: string | null;
  last_seen_at?: string | null;
}

export interface BrowserTrackingConnectionSyncRequest {
  device_id: string;
  device_label?: string | null;
  ready: boolean;
  last_error?: string | null;
  last_event_at?: string | null;
  connections: BrowserTrackingConnectionSyncItem[];
}

export interface BrowserTrackingConnectionSyncRecord {
  id: number;
  user_id: number;
  organization_id: number;
  device_id: string;
  device_label?: string | null;
  browser_name: string;
  browser_profile_key: string;
  extension_version?: string | null;
  status: 'connected' | 'disconnected' | 'disabled' | string;
  connected_at?: string | null;
  last_seen_at?: string | null;
  last_sync_at?: string | null;
  disconnected_at?: string | null;
  disconnect_reason?: string | null;
  meta?: Record<string, any> | null;
}

export interface BrowserTrackingHealthSummary {
  status: 'connected' | 'disconnected' | 'disabled' | 'unknown' | string;
  device_label?: string | null;
  connection_count: number;
  connected_connections: number;
  browsers: string[];
  last_seen_at?: string | null;
  last_sync_at?: string | null;
  disconnect_reason?: string | null;
  needs_attention: boolean;
  is_exact_tracking_active: boolean;
}

// Invoice Types
export interface Invoice {
  id: number;
  organization_id: number;
  user_id: number;
  invoice_number: string;
  client_name: string;
  client_email: string;
  client_address?: string;
  invoice_date: string;
  due_date: string;
  total_amount: number;
  status: 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled';
  notes?: string;
  paid_at?: string;
  created_at: string;
  updated_at: string;
  user?: User;
  organization?: Organization;
  items?: InvoiceItem[];
}

export interface InvoiceItem {
  id: number;
  invoice_id: number;
  time_entry_id?: number;
  description: string;
  quantity: number;
  rate: number;
  amount: number;
}

// Report Types
export interface DailyReport {
  date: string;
  total_time: number;
  by_user: ReportByUser[];
  by_project: ReportByProject[];
  entries: TimeEntry[];
}

export interface ReportByUser {
  user: User;
  total_time: number;
  entries?: TimeEntry[];
}

export interface ReportByProject {
  project: Project | null;
  total_time: number;
  entries?: TimeEntry[];
}

export interface WeeklyReport {
  start_date: string;
  end_date: string;
  total_time: number;
  working_time?: number;
  billable_time: number;
  by_day: ReportByDay[];
  by_user: ReportByUser[];
  by_project: ReportByProject[];
}

export interface ReportByDay {
  date: string;
  total_time: number;
}

// Auth Types
export interface LoginRequest {
  email: string;
  password: string;
  remember?: boolean;
  timezone?: string;
}

export interface RegisterRequest {
  name: string;
  email: string;
  password: string;
  password_confirmation: string;
  role?: 'admin' | 'employee';
  organization_name?: string;
}

export interface OwnerSignupRequest {
  company_name: string;
  name: string;
  email: string;
  password: string;
  password_confirmation: string;
  plan_code: string;
  signup_mode: 'trial' | 'paid';
  billing_cycle?: 'monthly' | 'yearly';
  seats?: number;
  terms_accepted?: boolean;
  timezone?: string;
  // Organization profile fields
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
}

export interface AuthResponse {
  user: User;
  token?: string;
  organization?: Organization;
  requires_verification?: boolean;
  email?: string;
  verification_email_sent?: boolean;
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface ResetPasswordRequest {
  token: string;
  email: string;
  password: string;
  password_confirmation: string;
}

export interface PasswordResetTokenValidationResponse {
  valid: boolean;
  message?: string;
}

export interface InvitationSummary {
  id: number;
  email: string;
  role: User['role'];
  status: 'pending' | 'accepted' | 'expired' | 'revoked';
  delivery_method: 'email' | 'link';
  invite_url?: string | null;
  email_sent_at?: string | null;
  expires_at?: string | null;
  accepted_at?: string | null;
  mail_delivery?: 'sent' | 'failed' | 'not_requested';
  can_accept?: boolean;
  organization?: Pick<Organization, 'id' | 'name' | 'slug'>;
  metadata?: {
    group_ids?: number[];
    project_ids?: number[];
  };
}

export interface InvitationListResponse {
  invitations: InvitationSummary[];
}

export interface InvitationCreateResponse {
  invitations: InvitationSummary[];
  failed: Array<{ email: string; message: string }>;
  invited_count: number;
}

export interface InviteValidationResponse {
  valid: boolean;
  email?: string;
  role?: string | null;
  expires_at?: string | null;
  organization?: Pick<Organization, 'id' | 'name' | 'slug'> | null;
  message?: string;
}

export interface BillingSnapshot {
  plan: {
    code?: string | null;
    name: string;
    description?: string | null;
    status: string;
    billing_cycle?: 'monthly' | 'yearly' | null;
    subscription_intent?: 'trial' | 'paid' | 'upgrade' | 'add_seats' | null;
    is_trial?: boolean;
    trial_end_date?: string | null;
    renewal_date?: string | null;
    contact_sales_only?: boolean;
    max_seats?: number;
    used_seats?: number;
    users_count?: number;
    pending_plan_code?: string | null;
    pending_billing_cycle?: 'monthly' | 'yearly' | null;
    pending_seats?: number | null;
    pending_upgrade_amount?: number | string | null;
  } | null;
  workspace?: {
    id: number;
    name: string;
    slug: string;
    owner_user_id?: number | null;
  } | null;
}

export interface BugReportRequest {
  name?: string;
  email: string;
  issue_category: 'bug' | 'ui' | 'performance' | 'billing' | 'account' | 'other';
  summary: string;
  description: string;
  current_path?: string | null;
}

export interface BugReportResponse {
  message: string;
  report_id?: number;
}

// API Response Types
export interface ApiResponse<T> {
  data: T;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  current_page: number;
  last_page: number;
  per_page: number;
  total: number;
}

export interface ChatConversation {
  id: number;
  type?: 'direct';
  other_user: {
    id: number;
    name: string;
    email: string;
    last_seen_at?: string | null;
    is_online?: boolean;
  };
  last_message?: ChatMessage;
  unread_count?: number;
  updated_at?: string;
}

export interface ChatGroup {
  id: number;
  type?: 'group';
  name: string;
  member_count?: number;
  members?: Array<{
    id: number;
    name: string;
    email: string;
    last_seen_at?: string | null;
    is_online?: boolean;
  }>;
  last_message?: ChatGroupMessage;
  unread_count?: number;
  updated_at?: string;
}

export interface ChatMessageReaction {
  emoji: string;
  count: number;
  reacted_by_me?: boolean;
}

export interface ChatMessage {
  id: number;
  conversation_id: number;
  sender_id: number;
  body: string;
  edited_at?: string | null;
  attachment_path?: string | null;
  attachment_name?: string | null;
  attachment_mime?: string | null;
  attachment_size?: number | null;
  has_attachment?: boolean;
  is_edited?: boolean;
  reactions?: ChatMessageReaction[];
  read_at?: string | null;
  created_at: string;
  updated_at: string;
  sender?: {
    id: number;
    name: string;
    email: string;
  };
}

export interface ChatGroupMessage {
  id: number;
  group_id: number;
  sender_id: number;
  body: string;
  edited_at?: string | null;
  attachment_path?: string | null;
  attachment_name?: string | null;
  attachment_mime?: string | null;
  attachment_size?: number | null;
  has_attachment?: boolean;
  is_edited?: boolean;
  reactions?: ChatMessageReaction[];
  created_at: string;
  updated_at: string;
  sender?: {
    id: number;
    name: string;
    email: string;
  };
}

export interface ChatTypingUser {
  id: number;
  name: string;
  email: string;
}

export interface ChatUnreadSummary {
  unread_messages: number;
  unread_conversations: number;
  unread_senders: number;
}

export interface AppNotificationItem {
  id: number;
  type: 'announcement' | 'news' | 'salary_credited' | 'task_assigned' | string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
  read_at?: string | null;
  sender?: {
    id: number;
    name: string;
    email: string;
  } | null;
  meta?: {
    route?: string;
    [key: string]: any;
  } | null;
}

export interface UserProfile360 {
  user: User;
  range: {
    start_date: string;
    end_date: string;
  };
  summary: {
    entries_count: number;
    total_duration: number;
    working_duration?: number;
    working_hours?: number;
    billable_duration: number;
    non_billable_duration: number;
    idle_duration?: number;
    attendance_days: number;
    present_days: number;
    absent_days?: number;
    late_days?: number;
    approved_leave_days: number;
    approved_time_edit_seconds: number;
    payslips_count: number;
  };
  status: {
    is_working: boolean;
    current_project?: string | null;
    current_task?: string | null;
    current_timer_started_at?: string | null;
    last_seen_at?: string | null;
    latest_attendance?: {
      attendance_date: string;
      status: string;
      worked_seconds: number;
      late_minutes: number;
      check_in_at?: string | null;
      check_out_at?: string | null;
    } | null;
    latest_notification?: AppNotificationItem | null;
  };
  recent_time_entries: TimeEntry[];
  attendance_records: Array<{
    id: number;
    attendance_date: string;
    status: string;
    worked_seconds: number;
    late_minutes: number;
    check_in_at?: string | null;
    check_out_at?: string | null;
  }>;
  leave_requests: Array<{
    id: number;
    start_date: string;
    end_date: string;
    reason?: string | null;
    status: string;
    revoke_status?: string | null;
    created_at: string;
  }>;
  time_edit_requests: Array<{
    id: number;
    attendance_date: string;
    extra_seconds: number;
    message?: string | null;
    status: string;
    created_at: string;
  }>;
  payslips: Array<{
    id: number;
    period_month: string;
    currency: string;
    net_salary: number;
    payment_status?: 'pending' | 'paid';
    generated_at?: string | null;
    paid_at?: string | null;
  }>;
}

export interface EmployeeProfileDetails {
  id: number;
  organization_id: number;
  user_id: number;
  first_name?: string | null;
  last_name?: string | null;
  display_name?: string | null;
  gender?: string | null;
  date_of_birth?: string | null;
  phone?: string | null;
  personal_email?: string | null;
  address_line?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_number?: string | null;
  emergency_contact_relationship?: string | null;
}

export interface EmployeeWorkInfo {
  id: number;
  organization_id: number;
  user_id: number;
  employee_code?: string | null;
  report_group_id?: number | null;
  designation?: string | null;
  reporting_manager_id?: number | null;
  work_location?: string | null;
  shift_name?: string | null;
  attendance_policy?: string | null;
  employment_type?: string | null;
  joining_date?: string | null;
  probation_status?: string | null;
  employment_status?: 'active' | 'inactive' | 'notice' | 'exited' | null;
  exit_date?: string | null;
  work_mode?: 'office' | 'remote' | 'hybrid' | null;
  expected_start_time?: string | null;
  expected_timezone?: string | null;
  department?: { id: number; name: string } | null;
  reporting_manager?: { id: number; name: string; email: string } | null;
}

export interface EmployeeDocumentRecord {
  id: number;
  organization_id: number;
  user_id: number;
  title: string;
  category: string;
  file_name: string;
  file_path: string;
  file_disk: string;
  mime_type?: string | null;
  file_size?: number | null;
  uploaded_at?: string | null;
  review_status: 'pending' | 'verified' | 'rejected' | string;
  notes?: string | null;
  uploader?: { id: number; name: string; email: string } | null;
}

export interface EmployeeGovernmentIdRecord {
  id: number;
  organization_id: number;
  user_id: number;
  id_type: string;
  id_number: string;
  status: 'verified' | 'pending' | 'rejected' | string;
  issue_date?: string | null;
  expiry_date?: string | null;
  notes?: string | null;
  employee_document_id?: number | null;
  document?: EmployeeDocumentRecord | null;
}

export interface EmployeeBankAccountRecord {
  id: number;
  organization_id: number;
  user_id: number;
  account_holder_name?: string | null;
  bank_name?: string | null;
  account_number?: string | null;
  ifsc_swift?: string | null;
  branch?: string | null;
  account_type?: string | null;
  upi_id?: string | null;
  payment_email?: string | null;
  payout_method?: string | null;
  is_default: boolean;
  verification_status: 'verified' | 'unverified' | 'pending' | 'rejected' | string;
  employee_document_id?: number | null;
  notes?: string | null;
  document?: EmployeeDocumentRecord | null;
}

export interface EmployeeWorkspacePayload {
  employee: User;
  
  about?: EmployeeProfileDetails | null;
  work_info?: EmployeeWorkInfo | null;

  government_ids: EmployeeGovernmentIdRecord[];
  bank_accounts: EmployeeBankAccountRecord[];
  documents: EmployeeDocumentRecord[];
  attendance: Record<string, any>;
  leave: Record<string, any>;
  activity: Array<{
    id: string;
    source: string;
    action: string;
    description: string;
    created_at: string;
    actor?: { id: number; name: string; email: string } | null;
    meta?: Record<string, any> | null;
  }>;
  overview: {
    reporting_manager?: { id: number; name: string; email: string } | null;
    department?: string | null;
    designation?: string | null;
    documents_uploaded: number;
    salary_template?: string | null;
    pending_reimbursements: number;
    payslips_count: number;
  };
  readiness: {
    overall_percentage: number;
    sections: Record<string, boolean>;
    missing_sections: string[];
    payroll_readiness: { is_ready: boolean; warnings: string[] };
    payout_readiness: { is_ready: boolean; warnings: string[] };
    declaration_status?: string;
    compliance_status?: string;
    attendance: Record<string, any>;
    leave: Record<string, any>;
  };
  options: {
    departments: Array<{ id: number; name: string }>;
    managers: Array<{ id: number; name: string; email: string }>;
  };
}

export interface ProductivityClassificationItem {
  id: string;
  target_type: 'domain' | 'app';
  target_value: string;
  display_label: string;
  current_classification: 'productive' | 'unproductive' | 'neutral';
  override_classification: string | null;
  override_id: number | null;
  user_count: number;
  total_duration_seconds: number;
  last_seen_at: string;
}

// Team Hierarchy Types
export interface TeamPerson {
  id: number;
  name: string;
  email?: string | null;
  avatar?: string | null;
  role: string | null;
  role_id: number | null;
  role_name: string;
  hierarchy_level: number;
  designation?: string | null;
  department: string | null;
  department_id: number | null;
}

export interface TeamHierarchyMember {
  id: number;
  name: string;
  email: string | null;
  avatar: string | null;
  role: string | null;
  role_id: number | null;
  role_name: string;
  hierarchy_level: number;
  reporting_manager_id: number | null;
  designation: string | null;
  department: string;
  department_id: number | null;
  groups: Array<{ id: number; name: string; slug: string | null }>;
  is_self: boolean;
}

export interface TeamManagedDepartment {
  id: number;
  name: string;
  slug: string | null;
  description: string | null;
  is_active: boolean;
  is_primary: boolean;
}

export interface TeamHierarchyPayload {
  current_user: TeamPerson & { department: { id: number; name: string; slug: string | null } | null };
  manager: TeamPerson | null;
  ancestors: TeamPerson[];
  direct_reports: TeamPerson[];
  direct_reports_count: number;
  department: { id: number; name: string; slug: string | null } | null;
  managed_departments: TeamManagedDepartment[];
  scope: {
    is_admin: boolean;
    is_manager: boolean;
    level: number;
    total_members: number;
  };
  members: TeamHierarchyMember[];
}
