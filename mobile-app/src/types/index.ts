export interface User {
  id: number;
  name: string;
  email: string;
  organization_id?: number;
  employee_code?: string;
  designation?: string;
  department?: string;
  profile_photo?: string;
  role?: string;
  role_name?: string;
  hierarchy_level?: number;
  employee_profile?: {
    employee_code?: string;
    designation?: string;
    department?: { name: string };
  };
}

export interface AuthResponse {
  token: string;
  user: User;
  organization: unknown;
}

export interface GeofenceZone {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
  is_active?: boolean;
}

export interface TodayAttendance {
  id?: number;
  check_in_at?: string;
  check_out_at?: string;
  status?: string;
  is_checked_in?: boolean;
  worked_seconds?: number;
  punches?: AttendancePunch[];
}

export interface AttendancePunch {
  id: number;
  punch_type?: string;
  punch_in_at?: string;
  punch_out_at?: string;
  punched_at?: string;
  latitude?: number;
  longitude?: number;
  accuracy?: number;
}

export interface LeaveCategory {
  code: string;
  name: string;
  total: number;
  used: number;
  remaining: number;
}

export interface LeaveBalanceResponse {
  policy: { categories: unknown[]; unpaid: { code: string; name: string } };
  self: {
    total_earned: number;
    total_used: number;
    remaining: number;
    categories: LeaveCategory[];
  };
  team: unknown[];
  approval_scope: { can_manage: boolean; can_approve_levels: number[] };
}

export interface LeaveRequest {
  id: number;
  leave_type?: string;
  leave_category?: string;
  start_date: string;
  end_date: string;
  reason?: string;
  status: 'pending' | 'approved' | 'rejected';
  approver_remarks?: string;
}

export interface Payslip {
  id: number;
  month: string;
  year: number;
  net_pay: number;
  gross_earnings: number;
  total_deductions: number;
  status: 'generated' | 'locked';
  pdf_url?: string;
}

export interface SelfieRecord {
  id: number;
  image_url: string;
  latitude?: number;
  longitude?: number;
  captured_at: string;
}

export interface GeoPosition {
  latitude: number;
  longitude: number;
  accuracy: number;
}

export interface OrgMember {
  id: number;
  name: string;
  email: string;
  role: string;
  role_name: string;
  role_id: number | null;
  hierarchy_level: number;
  department: string;
  is_online: boolean;
  is_working: boolean;
  phone?: string;
  designation?: string;
  employee_code?: string;
  date_of_birth?: string;
  employee_profile?: {
    phone?: string;
    first_name?: string;
    last_name?: string;
    date_of_birth?: string;
  };
  employee_work_info?: {
    designation?: string;
    employee_code?: string;
    department?: { id: number; name: string; slug: string };
  };
  groups?: { id: number; name: string; slug: string }[];
}

export interface Holiday {
  id: number;
  holiday_date: string;
  title: string;
  details?: string;
  country: string;
}

export interface EmployeeDashboard {
  active_timer: {
    id: number;
    start_time: string;
    description?: string;
  } | null;
  attendance_today: TodayAttendance | null;
  geofence_zone: GeofenceZone | null;
  monthly_total_seconds: number;
  monthly_total_hours: string;
  monthly_days: number;
}

export interface Reimbursement {
  id: number;
  category: string;
  amount: number;
  currency: string;
  expense_date: string;
  description: string;
  receipt_url?: string;
  merchant_name?: string;
  location?: string;
  status: 'pending' | 'approved' | 'rejected';
  notes?: string;
  employee?: { id: number; name: string };
  approver?: { id: number; name: string };
  approved_at?: string;
  created_at: string;
}

export interface TimeEditRequest {
  id: number;
  attendance_date: string;
  extra_seconds: number;
  message?: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewed_by?: number;
  reviewed_at?: string;
  review_note?: string;
  user?: { id: number; name: string };
  reviewer?: { id: number; name: string };
  created_at: string;
}

export interface AppNotification {
  id: number;
  type: string;
  title: string;
  message: string;
  meta?: any;
  is_read: boolean;
  read_at?: string;
  sender?: { id: number; name: string };
  created_at: string;
  poll?: Poll;
}

export interface Poll {
  id: number;
  app_notification_id: number;
  question: string;
  expires_at: string | null;
  is_multiple_choice: boolean;
  options?: PollOption[];
}

export interface PollOption {
  id: number;
  poll_id: number;
  option_text: string;
  vote_count: number;
  has_voted?: boolean;
}

export interface PollResults {
  data: PollOption[];
  total_votes: number;
  is_multiple_choice: boolean;
  has_expired: boolean;
}

export interface NotificationsResponse {
  data: AppNotification[];
  unread_count: number;
}

export interface ReimbursementSummary {
  total_count: number;
  total_amount: number;
  pending_count: number;
  pending_amount: number;
  approved_count: number;
  approved_amount: number;
  by_category: { category: string; count: number; total: number }[];
}
