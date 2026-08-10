import { describe, expect, it, vi } from 'vitest';
import { CalendarClock, LayoutDashboard, Users, Wallet } from 'lucide-react';
import { buildLocalCommands, buildPageCommands, type CommandContext } from './commandRegistry';
import type { NavGroup } from '@/navigation/dashboardNavigation';
import type { User } from '@/types';

const adminNavigation: NavGroup[] = [
  { label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard },
  {
    label: 'Attendance',
    icon: CalendarClock,
    items: [
      { label: 'Attendance', to: '/attendance', icon: CalendarClock },
      { label: 'Leave', to: '/leave', icon: CalendarClock },
      { label: 'Approval Inbox', to: '/approval-inbox?section=leave&view=pending&leave_window=today', icon: CalendarClock },
    ],
  },
  { label: 'People', icon: Users, items: [{ label: 'Employees', to: '/employees', icon: Users }] },
  { label: 'Payroll', icon: Wallet, items: [{ label: 'Payroll', to: '/payroll', icon: Wallet }] },
];

/** What a plain employee's sidebar actually contains — no admin entries. */
const employeeNavigation: NavGroup[] = [
  { label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard },
  {
    label: 'Attendance',
    icon: CalendarClock,
    items: [
      { label: 'Attendance', to: '/attendance', icon: CalendarClock },
      { label: 'Leave', to: '/leave', icon: CalendarClock },
    ],
  },
];

const ALL_FEATURES = [
  'leave_management',
  'task_tracking',
  'project_tracking',
  'payroll',
  'performance_management',
];

function makeContext(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    user: { id: 1, role: 'admin' } as unknown as User,
    isAdminView: true,
    isStrictAdminView: true,
    isSuperAdminView: false,
    isEmployeeOrManagerView: false,
    isDesktopShell: false,
    hasFeature: (feature: string) => ALL_FEATURES.includes(feature),
    canAccess: () => true,
    navigation: adminNavigation,
    setTheme: vi.fn(),
    resolvedTheme: 'light',
    logout: vi.fn(),
    copyCurrentUrl: vi.fn(),
    ...overrides,
  };
}

const employeeContext = (overrides: Partial<CommandContext> = {}) =>
  makeContext({
    user: { id: 2, role: 'employee', hierarchy_level: 100, permissions: [] } as unknown as User,
    isAdminView: false,
    isStrictAdminView: false,
    isEmployeeOrManagerView: true,
    canAccess: () => false,
    navigation: employeeNavigation,
    ...overrides,
  });

const titles = (context: CommandContext) => buildLocalCommands(context).map((item) => item.title);

describe('buildPageCommands', () => {
  it('turns navigation into commands, keeping the parent as the subtitle', () => {
    const pages = buildPageCommands(adminNavigation);
    const leave = pages.find((page) => page.title === 'Leave');
    expect(leave?.subtitle).toBe('Attendance');
    expect(leave?.to).toBe('/leave');
  });

  it('adds the approval inbox entry points by their own names', () => {
    const pages = buildPageCommands(adminNavigation);
    expect(pages.map((page) => page.title)).toEqual(
      expect.arrayContaining(['Leave Approvals', 'Time Edit Approvals'])
    );
  });

  it('omits those entry points when the inbox is not in the navigation', () => {
    const pages = buildPageCommands(employeeNavigation);
    expect(pages.map((page) => page.title)).not.toContain('Leave Approvals');
  });

  it('produces a unique id per page', () => {
    const ids = buildPageCommands(adminNavigation).map((page) => page.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('permission filtering', () => {
  it('offers an admin the admin-only actions', () => {
    const list = titles(makeContext());
    expect(list).toContain('Add employee');
    expect(list).toContain('Run payroll');
    expect(list).toContain('Post an announcement');
    expect(list).toContain('Organization settings');
  });

  it('offers an employee none of them', () => {
    const list = titles(employeeContext());
    expect(list).not.toContain('Add employee');
    expect(list).not.toContain('Run payroll');
    expect(list).not.toContain('Post an announcement');
    expect(list).not.toContain('Organization settings');
    expect(list).not.toContain('Billing and plan');
    expect(list).not.toContain('Export attendance report');
  });

  it('never offers an employee a page missing from their own navigation', () => {
    const list = titles(employeeContext());
    expect(list).not.toContain('Employees');
    expect(list).not.toContain('Payroll');
    expect(list).not.toContain('Approval Inbox');
  });

  it('still offers an employee the things they can genuinely do', () => {
    const list = titles(employeeContext());
    expect(list).toContain('Apply for leave');
    expect(list).toContain('Log out');
    expect(list).toContain('Leave');
  });

  it('drops assets when the permission is absent and keeps it when present', () => {
    expect(titles(employeeContext())).not.toContain('Add asset');
    expect(titles(employeeContext({ canAccess: (_user, key) => key === 'assets.view' }))).toContain('Add asset');
  });
});

describe('plan gating', () => {
  it('hides leave, task and project actions on a plan without those features', () => {
    const list = titles(makeContext({ hasFeature: () => false }));
    expect(list).not.toContain('Apply for leave');
    expect(list).not.toContain('Create task');
    expect(list).not.toContain('Create project');
    expect(list).not.toContain('Run payroll');
  });

  it('shows them when the plan includes them', () => {
    const list = titles(makeContext());
    expect(list).toContain('Apply for leave');
    expect(list).toContain('Create task');
    expect(list).toContain('Create project');
  });
});

describe('theme commands', () => {
  it('offers the theme you are not currently using', () => {
    expect(titles(makeContext({ resolvedTheme: 'light' }))).toContain('Switch to dark theme');
    expect(titles(makeContext({ resolvedTheme: 'light' }))).not.toContain('Switch to light theme');

    expect(titles(makeContext({ resolvedTheme: 'dark' }))).toContain('Switch to light theme');
    expect(titles(makeContext({ resolvedTheme: 'dark' }))).not.toContain('Switch to dark theme');
  });

  it('wires the theme commands to setTheme', () => {
    const setTheme = vi.fn();
    const commands = buildLocalCommands(makeContext({ setTheme, resolvedTheme: 'light' }));
    commands.find((command) => command.title === 'Switch to dark theme')?.run?.();
    expect(setTheme).toHaveBeenCalledWith('dark');
  });

  it('wires log out', () => {
    const logout = vi.fn();
    const commands = buildLocalCommands(makeContext({ logout }));
    commands.find((command) => command.title === 'Log out')?.run?.();
    expect(logout).toHaveBeenCalled();
  });
});

describe('command shape', () => {
  it('gives every command either a destination or an effect, never neither', () => {
    buildLocalCommands(makeContext()).forEach((command) => {
      expect(Boolean(command.to || command.externalPath || command.run)).toBe(true);
    });
  });

  it('marks only client-side commands as "run"', () => {
    buildLocalCommands(makeContext())
      .filter((command) => command.effect === 'run')
      .forEach((command) => {
        expect(command.run).toBeTypeOf('function');
        expect(command.to).toBeUndefined();
      });
  });

  it('keeps every id unique across pages, actions and settings', () => {
    const ids = buildLocalCommands(makeContext()).map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('routes "Add employee" at the route that actually exists', () => {
    const addEmployee = buildLocalCommands(makeContext()).find((command) => command.title === 'Add employee');
    expect(addEmployee?.to).toBe('/add-user');
  });

  it('builds compose links the target pages can read', () => {
    const applyForLeave = buildLocalCommands(makeContext()).find((command) => command.title === 'Apply for leave');
    expect(applyForLeave?.to).toBe('/leave?compose=leave-request');
  });
});
