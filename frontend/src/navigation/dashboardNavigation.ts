import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  BarChart3,
  Bell,
  Building2,
  CalendarClock,
  Clock3,
  CreditCard,
  FileClock,
  FileSpreadsheet,
  Fingerprint,
  FolderKanban,
  Gauge,
  LayoutDashboard,
  LineChart,
  MessageSquare,
  Settings,
  ShieldCheck,
  SquareKanban,
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
    label: 'HRMS',
    icon: Users,
    items: [
      { label: 'Employees', to: '/employees', icon: Users, adminOnly: true },
      { label: 'Departments', to: '/employees/teams', icon: Building2, adminOnly: true },
      { label: 'Roles & Permissions', to: '/employees/roles', icon: ShieldCheck, adminOnly: true },
      { label: 'Announcements', to: '/notifications', icon: Bell, adminOnly: true },
      { label: 'Chat', to: '/chat', icon: MessageSquare },
    ],
  },
  {
    label: 'Attendance',
    icon: CalendarClock,
    items: [
      { label: 'Attendance', to: '/attendance', icon: CalendarClock },
      { label: 'Leave', to: '/approval-inbox', icon: Fingerprint, adminOnly: true },
      { label: 'Overtime', to: '/edit-time', icon: FileClock },
      { label: 'Monitoring', to: '/monitoring/productive-time', icon: Gauge, adminOnly: true },
    ],
  },
  {
    label: 'Payroll',
    icon: Wallet,
    adminOnly: true,
    items: [
      { label: 'Payroll', to: '/payroll', icon: Wallet, adminOnly: true },
      { label: 'Pay Slips', to: '/payroll/payslips', icon: CreditCard, adminOnly: true },
      { label: 'Reimbursements', to: '/payroll/adjustments', icon: Fingerprint, adminOnly: true },
      { label: 'Salary Structure', to: '/payroll/structures', icon: FileSpreadsheet, adminOnly: true },
    ],
  },
  {
    label: 'Time Tracker',
    icon: Clock3,
    items: [
      { label: 'Time Tracker', to: '/time-tracker', icon: Clock3 },
      { label: 'Timesheets', to: '/reports/hours-tracked', icon: FileClock, adminOnly: true },
      { label: 'Projects', to: '/tasks', icon: FolderKanban },
      { label: 'Tasks', to: '/tasks', icon: SquareKanban },
    ],
  },
  {
    label: 'Reports',
    icon: BarChart3,
    adminOnly: true,
    items: [
      { label: 'Reports', to: '/reports/attendance', icon: BarChart3, adminOnly: true },
      { label: 'Analytics', to: '/reports/productivity', icon: LineChart, adminOnly: true },
      { label: 'Timeline', to: '/reports/timeline', icon: Waypoints, adminOnly: true },
      { label: 'Web & App Usage', to: '/reports/web-app-usage', icon: Activity, adminOnly: true },
    ],
  },
  {
    label: 'Settings',
    icon: Settings,
    adminOnly: true,
    items: [
      { label: 'Settings', to: '/settings', icon: Settings, adminOnly: true },
      { label: 'Integrations', to: '/settings', icon: Building2, adminOnly: true },
      { label: 'Custom Fields', to: '/settings', icon: FileSpreadsheet, adminOnly: true },
      { label: 'Audit Logs', to: '/audit-logs', icon: ShieldCheck, adminOnly: true },
    ],
  },
];
