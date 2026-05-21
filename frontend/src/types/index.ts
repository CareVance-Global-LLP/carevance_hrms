// User Types
export interface User {
  id: number;
  name: string;
  email: string;
  email_verified_at?: string | null;
  role: 'admin' | 'manager' | 'employee' | 'client' | 'super_admin';
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
  subscription_intent?: 'trial' | 'paid' | 'upgrade' | null;
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

export interface ProductivityRule {
  id: number;
  organization_id?: number | null;
  name?: string | null;
  target_type: 'app' | 'domain' | 'title_pattern' | 'url_pattern';
  match_mode: 'exact' | 'contains' | 'starts_with' | 'ends_with' | 'regex';
  target_value: string;
  classification: 'productive' | 'unproductive' | 'neutral' | 'context_dependent';
  priority: number;
  scope_type: 'global' | 'workspace' | 'group' | 'user';
  scope_id?: number | null;
  is_active: boolean;
  reason?: string | null;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
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
    subscription_intent?: 'trial' | 'paid' | 'upgrade' | null;
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

export interface PayrollComponent {
  id?: number;
  name: string;
  calculation_type: 'fixed' | 'percentage';
  amount?: number;
  value?: number;
  computed_amount?: number;
}

export interface PayrollStructure {
  id: number;
  user_id: number;
  organization_id: number;
  basic_salary: number;
  currency: string;
  effective_from: string;
  effective_to?: string | null;
  is_active: boolean;
  user?: User;
  allowances: PayrollComponent[];
  deductions: PayrollComponent[];
}

export interface Payslip {
  id: number;
  organization_id: number;
  user_id: number;
  payroll_structure_id?: number | null;
  period_month: string;
  currency: string;
  basic_salary: number;
  total_allowances: number;
  total_deductions: number;
  net_salary: number;
  payment_status?: 'pending' | 'paid';
  allowances: PayrollComponent[];
  deductions: PayrollComponent[];
  generated_by?: number | null;
  generated_at?: string | null;
  paid_at?: string | null;
  paid_by?: number | null;
  created_at: string;
  updated_at: string;
  user?: User;
}

export interface PayrollRecord {
  id: number;
  organization_id: number;
  user_id: number;
  payroll_month: string;
  basic_salary: number;
  allowances: number;
  deductions: number;
  bonus: number;
  tax: number;
  gross_salary?: number;
  net_salary: number;
  payroll_status: 'draft' | 'review' | 'approved' | 'cancelled' | 'validated' | 'manager_approved' | 'finance_approved' | 'processed' | 'paid';
  payout_method: 'mock' | 'stripe' | 'bank_transfer';
  payout_status: 'pending' | 'success' | 'failed';
  attendance_summary?: Record<string, any> | null;
  salary_breakdown?: Record<string, any> | null;
  adjustment_breakdown?: Record<string, any> | null;
  compliance_breakdown?: Record<string, any> | null;
  tax_breakdown?: Record<string, any> | null;
  warnings?: string[] | null;
  generated_by?: number | null;
  updated_by?: number | null;
  processed_at?: string | null;
  paid_at?: string | null;
  payment_reference?: string | null;
  failure_reason?: string | null;
  created_at: string;
  updated_at: string;
  user?: User;
  transactions?: PayrollTransaction[];
}

export interface PayrollTransaction {
  id: number;
  payroll_id: number;
  provider: 'mock' | 'stripe' | 'bank_transfer';
  transaction_id?: string | null;
  amount: number;
  currency: string;
  status: 'pending' | 'success' | 'failed';
  raw_response?: Record<string, any> | null;
  created_at: string;
  updated_at: string;
}

export interface PayrollWorkspaceOverview {
  month: string;
  summary: {
    gross_payroll: number;
    net_payroll: number;
    employees_in_current_run: number;
    pending_approvals: number;
    paid_count: number;
    failed_or_pending_payouts: number;
    total_overtime_value: number;
    reimbursements_pending: number;
  };
  current_pay_run: PayrollRun | null;
  missing_profiles: PayrollReadinessWarning[];
  recent_transactions: Array<{
    id: number;
    provider: string;
    status: string;
    amount: number;
    currency: string;
    created_at: string;
    employee?: Pick<User, 'id' | 'name' | 'email'> | null;
  }>;
  pending_actions: {
    leave_requests: number;
    attendance_time_edits: number;
    payroll_adjustments: number;
  };
  status_distribution: Record<string, number>;
  quick_links: Record<string, number>;
  readiness_warnings: PayrollReadinessWarning[];
}

export interface PayrollReadinessWarning {
  user_id: number;
  name: string;
  email: string;
  warnings: string[];
}

export interface PayrollRun {
  id: number;
  run_code: string;
  payroll_month: string;
  status: string;
  currency: string;
  items_count?: number;
  gross_payroll?: number;
  net_payroll?: number;
  paid_count?: number;
  failed_payouts?: number;
  warnings_count?: number;
  generated_at?: string | null;
  locked_at?: string | null;
  approval_summary?: Record<string, any>;
  items?: PayrollRunItem[];
  summary?: Record<string, any>;
  warnings?: Array<{ user_id: number; warnings: string[] }>;
  approvals?: PayRunApproval[];
}

export interface PayrollRunItem {
  id: number;
  pay_run_id: number;
  organization_id: number;
  user_id: number;
  payroll_id?: number | null;
  payroll_profile_id?: number | null;
  payable_days: number;
  worked_seconds: number;
  overtime_seconds: number;
  approved_leave_days: number;
  approved_time_edit_seconds: number;
  gross_pay: number;
  total_deductions: number;
  net_pay: number;
  status: string;
  payout_status: string;
  salary_breakdown?: Record<string, any> | null;
  adjustment_breakdown?: Record<string, any> | null;
  compliance_breakdown?: Record<string, any> | null;
  attendance_summary?: Record<string, any> | null;
  warnings?: string[] | null;
  user?: User;
  payroll?: PayrollRecord;
  payroll_profile?: PayrollProfile | null;
}

export interface PayRunApproval {
  id: number;
  stage: string;
  status: string;
  comment?: string | null;
  rejection_reason?: string | null;
  action_at?: string | null;
  actor?: Pick<User, 'id' | 'name' | 'email'> | null;
  meta?: Record<string, any> | null;
}

export interface PayrollProfile {
  id: number;
  organization_id: number;
  user_id: number;
  payroll_code?: string | null;
  salary_template_id?: number | null;
  currency: string;
  pay_group?: string | null;
  payout_method: string;
  bank_name?: string | null;
  bank_account_number?: string | null;
  bank_ifsc_swift?: string | null;
  payment_email?: string | null;
  bank_verification_status?: string | null;
  tax_identifier?: string | null;
  tax_regime?: 'old' | 'new' | string | null;
  pan_or_tax_id?: string | null;
  pf_account_number?: string | null;
  uan?: string | null;
  esi_number?: string | null;
  professional_tax_state?: string | null;
  professional_tax_jurisdiction?: string | null;
  payroll_start_date?: string | null;
  declaration_status?: string | null;
  payout_readiness_status?: string | null;
  compliance_readiness_status?: string | null;
  payroll_eligible: boolean;
  reimbursements_eligible: boolean;
  is_active: boolean;
  earning_components?: Array<Record<string, any>> | null;
  deduction_components?: Array<Record<string, any>> | null;
  bonus_amount: number;
  tax_amount: number;
  compliance_overrides?: Record<string, any> | null;
  declaration_snapshot?: Record<string, any> | null;
  meta?: Record<string, any> | null;
  current_cycle_adjustments_count?: number;
  current_cycle_adjustments_total?: number;
  pending_adjustments_count?: number;
  last_revision_date?: string | null;
  latest_tax_declaration?: PayrollTaxDeclaration | null;
  setup_readiness?: Record<string, any> | null;
  created_at?: string;
  updated_at?: string;
  user?: User;
  salary_template?: SalaryTemplate | null;
}

export interface SalaryComponentMaster {
  id: number;
  organization_id: number;
  name: string;
  code: string;
  category: 'basic' | 'allowance' | 'overtime' | 'bonus' | 'reimbursement' | 'penalty' | 'tax' | 'deduction' | 'other';
  impact?: 'earning' | 'deduction' | 'tax' | 'reimbursement' | 'employer_contribution';
  value_type: 'fixed' | 'percentage';
  calculation_basis?: 'basic' | 'gross' | null;
  default_value: number;
  is_taxable: boolean;
  is_compliance_component?: boolean;
  is_system_default?: boolean;
  is_active: boolean;
  template_components_count?: number;
  meta?: Record<string, any> | null;
  created_at?: string;
  updated_at?: string;
}

export interface SalaryTemplateComponentItem {
  id: number;
  salary_template_id: number;
  salary_component_id: number;
  value_type: 'fixed' | 'percentage';
  value: number;
  sort_order: number;
  is_enabled: boolean;
  component?: SalaryComponentMaster;
}

export interface SalaryTemplate {
  id: number;
  organization_id: number;
  name: string;
  description?: string | null;
  currency: string;
  is_active: boolean;
  assignments_count?: number;
  assignments_max_effective_from?: string | null;
  components: SalaryTemplateComponentItem[];
}

export interface PayrollAdjustment {
  id: number;
  organization_id: number;
  user_id: number;
  payroll_profile_id?: number | null;
  reimbursement_id?: number | null;
  title: string;
  description?: string | null;
  kind: 'reimbursement' | 'bonus' | 'manual_deduction' | 'penalty' | 'one_time_adjustment';
  source?: string | null;
  effective_month: string;
  amount: number;
  currency: string;
  status: 'draft' | 'pending_approval' | 'approved' | 'rejected' | 'applied';
  approval_note?: string | null;
  approved_at?: string | null;
  rejected_at?: string | null;
  applied_at?: string | null;
  rejection_reason?: string | null;
  attachment_meta?: Record<string, any> | null;
  approval_trail?: Array<Record<string, any>> | null;
  applied_run_id?: number | null;
  claim_reference?: string | null;
  claim_category?: string | null;
  merchant_name?: string | null;
  user?: User;
  reimbursement?: ReimbursementClaim | null;
  approved_by?: number | null;
  approvedBy?: Pick<User, 'id' | 'name' | 'email'> | null;
  appliedBy?: Pick<User, 'id' | 'name' | 'email'> | null;
  rejectedBy?: Pick<User, 'id' | 'name' | 'email'> | null;
  appliedRun?: { id: number; run_code: string; payroll_month: string } | null;
}

export interface PayrollTaxDeclaration {
  id: number;
  organization_id: number;
  user_id: number;
  payroll_profile_id?: number | null;
  financial_year: string;
  tax_regime: 'old' | 'new' | string;
  status: 'draft' | 'submitted' | 'approved' | 'rejected' | string;
  sections?: Record<string, any> | null;
  summary?: Record<string, any> | null;
  approved_snapshot?: Record<string, any> | null;
  rejection_reason?: string | null;
  submitted_at?: string | null;
  reviewed_at?: string | null;
  user?: User;
}

export interface ReimbursementClaim {
  id: number;
  organization_id: number;
  user_id: number;
  title: string;
  description?: string | null;
  expense_date?: string | null;
  amount: number;
  currency: string;
  status: string;
  approved_at?: string | null;
  user?: User;
}

export interface PayrollReportsPayload {
  monthly_summary: Record<string, any>;
  employee_payroll_sheet: Array<Record<string, any>>;
  department_payroll_cost: Array<Record<string, any>>;
  deductions_report: Array<Record<string, any>>;
  tax_report?: Array<Record<string, any>>;
  compliance_report?: Array<Record<string, any>>;
  payout_status_report: Array<Record<string, any>>;
  payout_bank_advice?: Array<Record<string, any>>;
  attendance_vs_payable_days: Array<Record<string, any>>;
  overtime_summary: Array<Record<string, any>>;
  component_totals: Array<Record<string, any>>;
  payout_history: Array<Record<string, any>>;
  failed_payout_report: Array<Record<string, any>>;
  monthly_trend: Array<Record<string, any>>;
}

export interface PayrollSettingsPayload {
  id: number;
  organization_id: number;
  payroll_calendar?: Record<string, any> | null;
  default_payout_method?: Record<string, any> | null;
  overtime_rules?: Record<string, any> | null;
  late_deduction_rules?: Record<string, any> | null;
  leave_mapping?: Record<string, any> | null;
  adjustment_rules?: Record<string, any> | null;
  approval_workflow?: Record<string, any> | null;
  compliance_settings?: Record<string, any> | null;
  tax_settings?: Record<string, any> | null;
  payslip_branding?: Record<string, any> | null;
  payslip_issue_rules?: Record<string, any> | null;
  payout_workflow?: Record<string, any> | null;
}

export interface AppNotificationItem {
  id: number;
  type: 'announcement' | 'news' | 'salary_credited' | string;
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
  payroll_month: string;
  about?: EmployeeProfileDetails | null;
  work_info?: EmployeeWorkInfo | null;
  payroll: {
    profile?: PayrollProfile | null;
    salary_assignments: Array<{
      id: number;
      effective_from: string;
      effective_to?: string | null;
      is_active: boolean;
      salary_template?: { id: number; name: string; currency?: string } | null;
    }>;
    current_compensation?: Record<string, any> | null;
    warnings: string[];
    tax_declarations?: PayrollTaxDeclaration[];
    pending_reimbursements: number;
    recent_reimbursements: ReimbursementClaim[];
    recent_adjustments: PayrollAdjustment[];
  };
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
