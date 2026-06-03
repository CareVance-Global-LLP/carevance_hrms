import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  BarChart3,
  Bell,
  Building2,
  CalendarClock,
  Camera,
  FileClock,
  Fingerprint,
  FolderKanban,
  Gauge,
  LayoutDashboard,
  LineChart,
  MapPin,
  MessageSquare,
  Network,
  Settings,
  Share2,
  Shield,
  ShieldCheck,
  SquareKanban,
  UserMinus,
  UserPlus,
  Users,
  Waypoints,
} from 'lucide-react';

export type NavLinkItem = {
  label: string;
  to: string;
  icon: LucideIcon;
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

export const topNavigation: NavGroup[] = [
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
    label: 'HRMS',
    icon: Users,
    items: [
      { label: 'Employees', to: '/employees', icon: Users, adminOnly: true },
      { label: 'New Hires', to: '/new-hires', icon: UserPlus, adminOnly: true },
      { label: 'Resignations', to: '/resignations', icon: UserMinus, adminOnly: true },
      { label: 'Departments', to: '/employees/teams', icon: Building2, adminOnly: true },
      { label: 'Roles & Permissions', to: '/employees/roles', icon: ShieldCheck, adminOnly: true },
      { label: 'Announcements', to: '/notifications', icon: Bell, adminOnly: true },
      { label: 'My Team', to: '/my-team', icon: Share2, employeeOnly: true },
      { label: 'Chat', to: '/chat', icon: MessageSquare, planFeature: 'chat' },
    ],
  },
  {
    label: 'Attendance',
    icon: CalendarClock,
    items: [
      { label: 'Attendance', to: '/attendance', icon: CalendarClock },
      { label: 'Leave', to: '/leave', icon: CalendarClock, planFeature: 'leave_management', employeeAndManagerOnly: true },
      { label: 'Approval Inbox', to: '/approval-inbox?section=leave&view=pending&leave_window=today', icon: Fingerprint, adminOnly: true },
      { label: 'Overtime', to: '/edit-time', icon: FileClock },
      { label: 'Monitoring', to: '/monitoring/productive-time', icon: Gauge, adminOnly: true, planFeature: 'monitoring', permission: 'monitoring.view' },
      { label: 'Screenshots', to: '/monitoring/screenshots', icon: Camera, adminOnly: true, permission: 'screenshots.view' },
      { label: 'Selfies Map', to: '/attendance/selfies-map', icon: MapPin, adminOnly: true, planFeature: 'geo_fencing', permission: 'selfies.view' },
      { label: 'Attendance Report', to: '/reports/attendance', icon: BarChart3, adminOnly: true, permission: 'reports.view' },
    ],
  },
  {
    label: 'Work',
    icon: FolderKanban,
    items: [
      { label: 'Timesheets', to: '/reports/hours-tracked', icon: FileClock, adminOnly: true, permission: 'reports.view' },
      { label: 'Projects', to: '/projects', icon: FolderKanban, planFeature: 'project_tracking' },
      { label: 'Tasks', to: '/tasks', icon: SquareKanban, planFeature: 'task_tracking' },
      { label: 'Time Reports', to: '/tasks/time-reports', icon: BarChart3, planFeature: 'task_tracking', adminOnly: true, permission: 'reports.view' },
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
      { label: 'Timeline', to: '/reports/timeline', icon: Waypoints, adminOnly: true, planFeature: 'employee_timeline', permission: 'reports.view' },
      { label: 'Web & App Usage', to: '/reports/web-app-usage', icon: Activity, adminOnly: true, planFeature: 'monitoring', permission: 'monitoring.view' },
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
      { label: 'Roles', to: '/settings/roles', icon: Shield, adminOnly: true, planFeature: 'multi_role_access', permission: 'roles.manage' },
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
