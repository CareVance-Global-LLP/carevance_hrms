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
  MessageSquare,
  Network,
  Play,
  Receipt,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  SquareKanban,
  UserMinus,
  UserPlus,
  Users,
  Wallet,
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
  planFeature?: string;
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
  planFeature?: string;
  payroll?: boolean;
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
    label: 'Org.Hierarchy',
    to: '/org-hierarchy',
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
      { label: 'Chat', to: '/chat', icon: MessageSquare, planFeature: 'chat' },
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
      { label: 'Monitoring', to: '/monitoring/productive-time', icon: Gauge, adminOnly: true, planFeature: 'monitoring' },
      { label: 'Screenshots', to: '/monitoring/screenshots', icon: Camera, adminOnly: true },
      { label: 'Attendance Report', to: '/reports/attendance', icon: BarChart3, adminOnly: true },
    ],
  },
  {
    label: 'Payroll',
    icon: Wallet,
    adminOnly: true,
    payroll: true,
    items: [
      { label: 'Overview', to: '/payroll', icon: Wallet, adminOnly: true },
      { label: 'Run Payroll', to: '/payroll/runs', icon: Play, adminOnly: true },
      { label: 'Salary Setup', to: '/payroll/employees', icon: Users, adminOnly: true },
      { label: 'Adjustments', to: '/payroll/adjustments', icon: SlidersHorizontal, adminOnly: true },
      { label: 'Payslips', to: '/payroll/payslips', icon: Receipt, adminOnly: true },
      { label: 'Payroll Settings', to: '/payroll/settings', icon: Settings, adminOnly: true },
    ],
  },
  {
    label: 'Work',
    icon: FolderKanban,
    items: [
      { label: 'Timesheets', to: '/reports/hours-tracked', icon: FileClock, adminOnly: true },
      { label: 'Projects', to: '/projects', icon: FolderKanban, planFeature: 'project_tracking' },
      { label: 'Tasks', to: '/tasks', icon: SquareKanban, planFeature: 'task_tracking' },
    ],
  },
  {
    label: 'Reports',
    icon: BarChart3,
    adminOnly: true,
    items: [
      { label: 'Reports', to: '/reports', icon: BarChart3, adminOnly: true },
      { label: 'Analytics', to: '/analytics', icon: LineChart, adminOnly: true },
      { label: 'Timeline', to: '/reports/timeline', icon: Waypoints, adminOnly: true, planFeature: 'employee_timeline' },
      { label: 'Web & App Usage', to: '/reports/web-app-usage', icon: Activity, adminOnly: true, planFeature: 'monitoring' },
    ],
  },
  {
    label: 'Settings',
    icon: Settings,
    adminOnly: true,
    items: [
      { label: 'Settings', to: '/settings', icon: Settings, adminOnly: true },
      { label: 'Audit Logs', to: '/audit-logs', icon: ShieldCheck, adminOnly: true },
    ],
  },
];
