import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  Award,
  BarChart3,
  Bell,
  Building2,
  CalendarClock,
  Camera,
  Coffee,

  DoorOpen,
  Eye,
  FileClock,
  Fingerprint,
  FolderKanban,
  Gauge,
  LayoutDashboard,
  LineChart,
  MailPlus,
  MapPin,
  MessageSquare,
  Network,
  Package,
  Settings,
  Target,
  Share2,
  ShieldCheck,
  SquareKanban,
  Briefcase,
  CalendarRange,
  Users,
  UserMinus,
  UserPlus,
  Wallet,
  Waypoints,
} from 'lucide-react';

export type NavLinkItem = {
  label: string;
  to: string;
  icon: LucideIcon;
  section?: string;
  unreadCount?: number;
  adminOnly?: boolean;
  /** Admin, HR and payroll_manager only — mirrors the API's `role:payroll`. */
  payrollAdminOnly?: boolean;
  strictAdminOnly?: boolean;
  superAdminOnly?: boolean;
  employeeAndManagerOnly?: boolean;
  employeeOnly?: boolean;
  planFeature?: string;
  permission?: string;
  /** Hidden unless this flag is true on the server-resolved tracker policy. */
  trackerPolicyFlag?: 'can_view_own_activity';
  external?: boolean;
  externalPath?: string;
};

export type NavGroup = {
  label: string;
  to?: string;
  icon: LucideIcon;
  unreadCount?: number;
  adminOnly?: boolean;
  /** Admin, HR and payroll_manager only — mirrors the API's `role:payroll`. */
  payrollAdminOnly?: boolean;
  strictAdminOnly?: boolean;
  superAdminOnly?: boolean;
  employeeAndManagerOnly?: boolean;
  employeeOnly?: boolean;
  planFeature?: string;
  payroll?: boolean;
  permission?: string;
  items?: NavLinkItem[];
  external?: boolean;
  externalPath?: string;
};

export const condensedNavigation: NavGroup[] = [
  {
    label: 'Dashboard',
    to: '/dashboard',
    icon: LayoutDashboard,
  },
  {
    label: 'Organization',
    to: '/organization-tree',
    icon: Network,
  },
  {
    label: 'People',
    icon: Users,
    items: [
      // First in the group because it is where people enter the company:
      // hired, then invited, then joined, then gone.
      { label: 'Hiring', to: '/hiring', icon: Briefcase, adminOnly: true },
      { label: 'Employees', to: '/employees', icon: Users, adminOnly: true },
      // Before New Hires because that is the order people move through: invited,
      // then joined, then gone. The route existed with nothing linking to it, so
      // pending invitations were only reachable by typing the URL.
      { label: 'Invitations', to: '/employees/invitations', icon: MailPlus, adminOnly: true },
      { label: 'New Hires', to: '/new-hires', icon: UserPlus, adminOnly: true },
      { label: 'Exits', to: '/exits', icon: DoorOpen, adminOnly: true },
      { label: 'My Team', to: '/my-team', icon: Share2, employeeOnly: true },
      // Shown only where the organization has switched self-view on.
      { label: 'My Activity', to: '/my-activity', icon: Eye, trackerPolicyFlag: 'can_view_own_activity' },
    ],
  },
  {
    label: 'ROLES & PERMISSIONS',
    icon: ShieldCheck,
    adminOnly: true,
    items: [
      { label: 'Roles', to: '/employees/roles', icon: ShieldCheck, adminOnly: true },
      { label: 'Department', to: '/employees/teams', icon: Building2, adminOnly: true },
    ],
  },
  {
    label: 'Attendance',
    icon: CalendarClock,
    items: [
      { label: 'Attendance', to: '/attendance', icon: CalendarClock },
      // Visible to everybody: the whole point of publishing a rota is that
      // people can see it without asking.
      { label: 'Rota', to: '/roster', icon: CalendarRange },
      { label: 'Leave', to: '/leave', icon: CalendarClock, planFeature: 'leave_management' },
      { label: 'Approval Inbox', to: '/approval-inbox?section=leave&view=pending&leave_window=today', icon: Fingerprint, adminOnly: true },
      { label: 'Overtime', to: '/edit-time', icon: FileClock },
      // Personal break tracker — hidden from admins. See dashboardNavigation.
      { label: 'Breaks', to: '/breaks', icon: Coffee, employeeAndManagerOnly: true },
      { label: 'Shifts', to: '/shifts', icon: Coffee, adminOnly: true, planFeature: 'shift_management' },
    ],
  },
  {
    label: 'Monitoring',
    icon: Gauge,
    adminOnly: true,
    planFeature: 'monitoring',
    permission: 'monitoring.view',
    items: [
      { label: 'Monitoring', to: '/monitoring/productive-time', icon: Gauge, adminOnly: true, planFeature: 'monitoring', permission: 'monitoring.view' },
      { label: 'Screenshots', to: '/monitoring/screenshots', icon: Camera, adminOnly: true, permission: 'screenshots.view' },
      { label: 'Selfies Map', to: '/attendance/selfies-map', icon: MapPin, adminOnly: true, planFeature: 'geo_fencing', permission: 'selfies.view' },
      { label: 'Timeline', to: '/reports/timeline', icon: Waypoints, adminOnly: true, planFeature: 'employee_timeline', permission: 'reports.view' },
      { label: 'Web & App Usage', to: '/reports/web-app-usage', icon: Activity, adminOnly: true, planFeature: 'monitoring', permission: 'monitoring.view' },
    ],
  },
  {
    label: 'Performance',
    icon: Award,
    planFeature: 'performance_management',
    items: [
      { label: 'Performance Reviews', to: '/performance', icon: Award, planFeature: 'performance_management' },
      { label: 'Goals', to: '/performance-goals', icon: Target, planFeature: 'performance_management' },
    ],
  },
  {
    label: 'Work',
    icon: FolderKanban,
    items: [
      { label: 'Timesheets', to: '/work/timesheets', icon: FileClock, adminOnly: true, permission: 'reports.view' },
      { label: 'Projects', to: '/projects', icon: FolderKanban, planFeature: 'project_tracking' },
      { label: 'Tasks', to: '/tasks', icon: SquareKanban, planFeature: 'task_tracking' },
      { label: 'Time Reports', to: '/tasks/time-reports', icon: BarChart3, planFeature: 'task_tracking', adminOnly: true, permission: 'reports.view' },
    ],
  },
  {
    label: 'Communication',
    icon: MessageSquare,
    items: [
      { label: 'Announcements', to: '/notifications', icon: Bell, adminOnly: true },
      { label: 'Chat', to: '/chat', icon: MessageSquare, planFeature: 'chat' },
    ],
  },
  {
    label: 'Assets',
    icon: Package,
    items: [
      { label: 'Assets', to: '/assets', icon: Package, permission: 'assets.view' },
    ],
  },
  {
    label: 'Reports',
    icon: BarChart3,
    adminOnly: true,
    permission: 'reports.view',
    items: [
      { label: 'Reports', to: '/reports', icon: BarChart3, adminOnly: true, permission: 'reports.view' },
      { label: 'Analytics', to: '/analytics', icon: LineChart, adminOnly: true, permission: 'reports.view' },
      { label: 'Attendance Report', to: '/reports/attendance', icon: BarChart3, adminOnly: true, permission: 'reports.view' },
    ],
  },
  {
    label: 'Payroll',
    icon: Wallet,
    planFeature: 'payroll',
    items: [
      { label: 'Payroll', to: '/payroll', icon: Wallet, planFeature: 'payroll', adminOnly: true },
      { label: 'My Payroll', to: '/my-payroll', icon: Wallet, planFeature: 'payroll' },
    ],
  },
  {
    label: 'Settings',
    icon: Settings,
    adminOnly: true,
    permission: 'settings.view',
    items: [
      { label: 'Settings', to: '/settings', icon: Settings, adminOnly: true, permission: 'settings.view' },
      { label: 'Audit Logs', to: '/audit-logs', icon: ShieldCheck, adminOnly: true, permission: 'audit.view' },
      { label: 'Geofence Zones', to: '/settings/geofence', icon: MapPin, adminOnly: true, planFeature: 'geo_fencing', permission: 'geofence.manage' },
    ],
  },
  {
    label: 'Resignation',
    icon: UserMinus,
    employeeAndManagerOnly: true,
    items: [
      { label: 'Submit Resignation', to: '/resignation', icon: UserMinus },
      { label: 'My Resignation', to: '/resignation/status', icon: FileClock },
    ],
  },
];