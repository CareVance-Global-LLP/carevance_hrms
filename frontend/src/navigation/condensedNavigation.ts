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
  FileClock,
  Fingerprint,
  FolderKanban,
  Gauge,
  LayoutDashboard,
  LineChart,
  MapPin,
  MessageSquare,
  Network,
  Package,
  Settings,
  Target,
  Share2,
  ShieldCheck,
  SquareKanban,
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
  strictAdminOnly?: boolean;
  superAdminOnly?: boolean;
  employeeAndManagerOnly?: boolean;
  employeeOnly?: boolean;
  planFeature?: string;
  permission?: string;
  external?: boolean;
  externalPath?: string;
};

export type NavGroup = {
  label: string;
  to?: string;
  icon: LucideIcon;
  unreadCount?: number;
  adminOnly?: boolean;
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
    adminOnly: true,
  },
  {
    label: 'People',
    icon: Users,
    items: [
      { label: 'Employees', to: '/employees', icon: Users, adminOnly: true },
      { label: 'New Hires', to: '/new-hires', icon: UserPlus, adminOnly: true },
      { label: 'Exits', to: '/exits', icon: DoorOpen, adminOnly: true },
      { label: 'My Team', to: '/my-team', icon: Share2, employeeOnly: true },
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