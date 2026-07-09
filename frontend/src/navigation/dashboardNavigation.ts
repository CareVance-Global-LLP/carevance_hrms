import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  Award,
  BarChart3,
  Bell,
  Building2,
  Calculator,
  CalendarClock,
  Camera,
  ClipboardCheck,
  Coffee,
  FileClock,
  FileText,
  Fingerprint,
  FolderKanban,
  Gauge,
  LayoutDashboard,
  LineChart,
  MapPin,
  MessageSquare,
  Network,
  Package,
  Receipt,
  Settings,
  Target,
  Share2,
  Shield,
  ShieldCheck,
  SquareKanban,
  UserMinus,
  UserPlus,
  Users,
  Wallet,
  IndianRupee,
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
    label: 'People',
    icon: Users,
    items: [
      { label: 'Employees', to: '/employees', icon: Users, adminOnly: true },
      { label: 'New Hires', to: '/new-hires', icon: UserPlus, adminOnly: true },
      { label: 'Resignations', to: '/resignations', icon: UserMinus, adminOnly: true },
      { label: 'Departments', to: '/employees/teams', icon: Building2, adminOnly: true },
      { label: 'Roles & Permissions', to: '/employees/roles', icon: ShieldCheck, adminOnly: true },
      { label: 'Assets', to: '/assets', icon: Package, permission: 'assets.view' },
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
      { label: 'Leave', to: '/leave', icon: CalendarClock, planFeature: 'leave_management' },
      { label: 'Approval Inbox', to: '/approval-inbox?section=leave&view=pending&leave_window=today', icon: Fingerprint, adminOnly: true },
      { label: 'Overtime', to: '/edit-time', icon: FileClock },
      { label: 'Breaks', to: '/breaks', icon: Coffee },
      { label: 'Monitoring', to: '/monitoring/productive-time', icon: Gauge, adminOnly: true, planFeature: 'monitoring', permission: 'monitoring.view' },
      { label: 'Screenshots', to: '/monitoring/screenshots', icon: Camera, adminOnly: true, permission: 'screenshots.view' },
      { label: 'Selfies Map', to: '/attendance/selfies-map', icon: MapPin, adminOnly: true, planFeature: 'geo_fencing', permission: 'selfies.view' },
      { label: 'Attendance Report', to: '/reports/attendance', icon: BarChart3, adminOnly: true, permission: 'reports.view' },
    ],
  },
  {
    label: 'Performance',
    icon: Award,
    items: [
      { label: 'Performance Reviews', to: '/performance', icon: Award },
      { label: 'Goals', to: '/performance-goals', icon: Target },
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
    label: 'Payroll',
    icon: Wallet,
    planFeature: 'payroll',
    items: [
      // Overview
      { label: 'My Payroll', to: '/my-payroll', icon: Wallet, planFeature: 'payroll', section: 'Overview' },
      { label: 'Payroll Dashboard', to: '/payroll', icon: Wallet, planFeature: 'payroll', strictAdminOnly: true, section: 'Overview' },
      // TEMPORARILY DISABLED: Setup Wizard hidden
      // { label: 'Setup Wizard', to: '/payroll/setup', icon: Sparkles, planFeature: 'payroll', strictAdminOnly: true, section: 'Overview' },
      // Tax
      { label: 'Tax Declarations', to: '/tax-declarations', icon: FileText, planFeature: 'payroll', section: 'Tax' },
      { label: 'Tax Proofs Review', to: '/tax-proofs', icon: FileText, planFeature: 'payroll', strictAdminOnly: true, section: 'Tax' },
      { label: 'Tax Simulator', to: '/tax-simulator', icon: Calculator, planFeature: 'payroll', section: 'Tax' },
      // Compensation
      { label: 'Salary Revisions', to: '/salary-revisions', icon: FileText, planFeature: 'payroll', strictAdminOnly: true, section: 'Compensation' },
      { label: 'FBP', to: '/fbp', icon: IndianRupee, planFeature: 'payroll', strictAdminOnly: true, section: 'Compensation' },
      { label: 'Perquisites', to: '/perquisites', icon: IndianRupee, planFeature: 'payroll', strictAdminOnly: true, section: 'Compensation' },
      { label: 'Reimbursements', to: '/reimbursements', icon: Receipt, planFeature: 'payroll', section: 'Compensation' },
      { label: 'Loans & Advances', to: '/loans', icon: IndianRupee, planFeature: 'payroll', section: 'Compensation' },
      // Compliance
      { label: 'Pre-Payroll Checklist', to: '/pre-payroll-checklist', icon: ClipboardCheck, planFeature: 'payroll', strictAdminOnly: true, section: 'Compliance' },
      { label: 'Arrears', to: '/arrears', icon: IndianRupee, planFeature: 'payroll', strictAdminOnly: true, section: 'Compliance' },
      { label: 'Leave Encashment', to: '/leave-encashment', icon: FileText, planFeature: 'payroll', strictAdminOnly: true, section: 'Compliance' },
      { label: 'F&F Settlements', to: '/fnf-settlements', icon: UserMinus, planFeature: 'payroll', strictAdminOnly: true, section: 'Compliance' },
      // Reports & Advanced
      { label: 'Payroll Reports', to: '/payroll-reports', icon: BarChart3, planFeature: 'payroll', strictAdminOnly: true, section: 'Reports & Advanced' },
      { label: 'Advanced Payroll', to: '/filings', icon: FileText, planFeature: 'payroll', strictAdminOnly: true, section: 'Reports & Advanced' },
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
