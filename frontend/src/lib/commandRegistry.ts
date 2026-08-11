/**
 * Everything the command bar can find or do.
 *
 * Pages come from the caller's already-filtered navigation, so the palette can
 * never offer a page the sidebar wouldn't — there is exactly one permission
 * model, not two. Actions and settings declare their own guards here, matching
 * the guard on the page each one belongs to.
 */

import type { LucideIcon } from 'lucide-react';
import {
  ArrowRightLeft,
  Bell,
  Building2,
  CalendarPlus,
  Coffee,
  Download,
  FolderPlus,
  Link2,
  ListPlus,
  LogOut,
  MailPlus,
  Moon,
  Monitor,
  Package,
  Palette,
  PlayCircle,
  ShieldCheck,
  Settings as SettingsIcon,
  Sun,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react';
import type { NavGroup } from '@/navigation/dashboardNavigation';
import type { User } from '@/types';

export type CommandKind =
  | 'page'
  | 'action'
  | 'setting'
  | 'person'
  | 'department'
  | 'task'
  | 'project'
  | 'leave'
  | 'asset'
  | 'announcement';

/** Display buckets, rendered in this order. */
export const COMMAND_GROUPS = ['Recent', 'Actions', 'Go to', 'Settings', 'People', 'Records'] as const;
export type CommandGroup = (typeof COMMAND_GROUPS)[number];

export interface CommandItem {
  id: string;
  title: string;
  subtitle?: string;
  /** Extra words that match but are never shown. */
  keywords?: string[];
  kind: CommandKind;
  group: CommandGroup;
  icon: LucideIcon;
  /** In-app route. Mutually exclusive with `run`. */
  to?: string;
  /** Desktop shell: open this path in the web dashboard instead. */
  externalPath?: string;
  /** Client-side effect. Mutually exclusive with `to`. */
  run?: () => void;
  /**
   * Short verb shown on the right of the row. Tells someone what pressing
   * Enter will actually do before they press it.
   */
  effect?: 'open' | 'run' | 'compose';
}

/**
 * Query parameter a page reads to open a form on arrival. See
 * `useComposeAction`. Kept as one constant so the producer and consumer can
 * never drift.
 */
export const COMPOSE_PARAM = 'compose';

export const COMPOSE_KEYS = {
  leaveRequest: 'leave-request',
  task: 'task-new',
  project: 'project-new',
  asset: 'asset-new',
} as const;

const composeUrl = (path: string, key: string) =>
  `${path}${path.includes('?') ? '&' : '?'}${COMPOSE_PARAM}=${key}`;

export interface CommandContext {
  user: User | null | undefined;
  isAdminView: boolean;
  isStrictAdminView: boolean;
  isSuperAdminView: boolean;
  isEmployeeOrManagerView: boolean;
  isDesktopShell: boolean;
  hasFeature: (feature: string) => boolean;
  canAccess: (user: User | null | undefined, permission: string) => boolean;
  /** Already permission-filtered by the caller. */
  navigation: NavGroup[];
  setTheme: (choice: 'light' | 'dark' | 'system') => void;
  resolvedTheme: 'light' | 'dark';
  logout: () => void | Promise<void>;
  copyCurrentUrl: () => void;
}

/**
 * Pages, from the navigation the user can actually see.
 *
 * Group entries that are only containers contribute their children; entries
 * that are themselves links contribute one item. The parent label becomes the
 * subtitle, which is how someone finds "Leave" by remembering it lives under
 * "Attendance".
 */
export function buildPageCommands(navigation: NavGroup[]): CommandItem[] {
  const items: CommandItem[] = [];

  navigation.forEach((group) => {
    if (group.to) {
      items.push({
        id: `page:${group.label}:${group.to}`,
        title: group.label,
        subtitle: 'Module',
        keywords: [group.label],
        kind: 'page',
        group: 'Go to',
        icon: group.icon,
        to: group.to,
        externalPath: group.externalPath,
        effect: 'open',
      });
      return;
    }

    (group.items || []).forEach((item) => {
      items.push({
        id: `page:${group.label}:${item.label}:${item.to}`,
        title: item.label,
        subtitle: group.label,
        keywords: [item.label, group.label],
        kind: 'page',
        group: 'Go to',
        icon: item.icon,
        to: item.to,
        externalPath: item.externalPath,
        effect: 'open',
      });
    });
  });

  // The approval inbox is one route with several meaningful entry points; the
  // old search hard-coded two of these, so keep them findable by their own name.
  const hasApprovalInbox = items.some((item) => String(item.to || '').startsWith('/approval-inbox'));
  if (hasApprovalInbox) {
    items.push(
      {
        id: 'page:approval-inbox:leave',
        title: 'Leave Approvals',
        subtitle: 'Approval Inbox',
        keywords: ['pending leave', 'approve leave', 'leave requests'],
        kind: 'page',
        group: 'Go to',
        icon: CalendarPlus,
        to: '/approval-inbox?section=leave&view=pending&leave_window=today',
        effect: 'open',
      },
      {
        id: 'page:approval-inbox:time-edit',
        title: 'Time Edit Approvals',
        subtitle: 'Approval Inbox',
        keywords: ['overtime approval', 'time edit', 'regularisation'],
        kind: 'page',
        group: 'Go to',
        icon: ArrowRightLeft,
        to: '/approval-inbox?section=time-edit&view=pending',
        effect: 'open',
      }
    );
  }

  /*
   * The words people reach for are the actions, not the page name.
   * "Invitations" is already contributed by the navigation; this adds the verbs
   * — someone chasing a joiner searches "resend", not the noun on the rail.
   */
  const hasInvitations = items.some((item) => String(item.to || '') === '/employees/invitations');
  if (hasInvitations) {
    items.push({
      id: 'page:invitations:manage',
      title: 'Pending Invitations',
      subtitle: 'Resend or revoke',
      keywords: ['resend invite', 'revoke invite', 'cancel invitation', 'pending invites', 'new invite link', 'invitation expired'],
      kind: 'page',
      group: 'Go to',
      icon: MailPlus,
      to: '/employees/invitations',
      effect: 'open',
    });
  }

  return items;
}

interface GuardedDefinition extends Omit<CommandItem, 'id'> {
  id: string;
  guard?: (context: CommandContext) => boolean;
}

/**
 * Actions come in three tiers, and the row's `effect` tells them apart:
 *
 *   run     — happens immediately, client-side only, trivially reversible.
 *   compose — navigates and opens the form; nothing is saved until you submit.
 *   open    — navigates to where the operation lives.
 *
 * Operations that move money or clock state (running payroll, punching in) are
 * deliberately `open`, not `run`. A command bar should not fire an irreversible
 * side effect from a fuzzy match on a half-typed word.
 */
function actionDefinitions(): GuardedDefinition[] {
  return [
    {
      id: 'action:leave-request',
      title: 'Apply for leave',
      subtitle: 'Opens the leave request form',
      keywords: ['request leave', 'pto', 'time off', 'holiday', 'vacation', 'day off', 'sick leave'],
      kind: 'action',
      group: 'Actions',
      icon: CalendarPlus,
      to: composeUrl('/leave', COMPOSE_KEYS.leaveRequest),
      effect: 'compose',
      guard: (context) => context.hasFeature('leave_management'),
    },
    {
      id: 'action:task-new',
      title: 'Create task',
      subtitle: 'Opens the new task form',
      keywords: ['new task', 'add task', 'new ticket', 'todo'],
      kind: 'action',
      group: 'Actions',
      icon: ListPlus,
      to: composeUrl('/tasks', COMPOSE_KEYS.task),
      effect: 'compose',
      guard: (context) => context.hasFeature('task_tracking'),
    },
    {
      id: 'action:project-new',
      title: 'Create project',
      subtitle: 'Opens the new project form',
      keywords: ['new project', 'add project'],
      kind: 'action',
      group: 'Actions',
      icon: FolderPlus,
      to: composeUrl('/projects', COMPOSE_KEYS.project),
      effect: 'compose',
      guard: (context) => context.hasFeature('project_tracking'),
    },
    {
      id: 'action:asset-new',
      title: 'Add asset',
      subtitle: 'Opens the new asset form',
      keywords: ['new asset', 'register laptop', 'add device', 'inventory'],
      kind: 'action',
      group: 'Actions',
      icon: Package,
      to: composeUrl('/assets', COMPOSE_KEYS.asset),
      effect: 'compose',
      guard: (context) => context.canAccess(context.user, 'assets.view'),
    },
    {
      id: 'action:employee-new',
      title: 'Add employee',
      subtitle: 'Opens the new employee form',
      keywords: ['new employee', 'hire', 'onboard', 'create user'],
      kind: 'action',
      group: 'Actions',
      icon: UserPlus,
      // Route is /add-user, guarded by StrictAdminRoute — mirror that guard here
      // so the palette never offers a page that would bounce them.
      to: '/add-user',
      effect: 'compose',
      guard: (context) => context.isStrictAdminView,
    },
    {
      id: 'action:clock',
      title: 'Clock in or out',
      subtitle: 'Go to your timer',
      keywords: ['punch in', 'punch out', 'start timer', 'stop timer', 'check in', 'check out'],
      kind: 'action',
      group: 'Actions',
      icon: PlayCircle,
      to: '/dashboard',
      effect: 'open',
    },
    {
      id: 'action:break',
      title: 'Start a break',
      subtitle: 'Go to break tracking',
      keywords: ['tea break', 'lunch', 'pause timer'],
      kind: 'action',
      group: 'Actions',
      icon: Coffee,
      to: '/breaks',
      effect: 'open',
      guard: (context) => context.isEmployeeOrManagerView,
    },
    {
      id: 'action:payroll-run',
      title: 'Run payroll',
      subtitle: 'Go to the current payroll run',
      keywords: ['process salary', 'pay run', 'generate payslips'],
      kind: 'action',
      group: 'Actions',
      icon: Wallet,
      to: '/payroll',
      effect: 'open',
      guard: (context) => context.isAdminView && context.hasFeature('payroll'),
    },
    {
      id: 'action:export-attendance',
      title: 'Export attendance report',
      subtitle: 'Go to the attendance report',
      keywords: ['download attendance', 'csv', 'muster', 'export'],
      kind: 'action',
      group: 'Actions',
      icon: Download,
      to: '/reports/attendance',
      effect: 'open',
      guard: (context) => context.isAdminView && context.canAccess(context.user, 'reports.view'),
    },
    {
      id: 'action:announce',
      title: 'Post an announcement',
      subtitle: 'Go to announcements',
      keywords: ['broadcast', 'notice', 'company news'],
      kind: 'action',
      group: 'Actions',
      icon: Bell,
      to: '/notifications',
      effect: 'open',
      guard: (context) => context.isAdminView,
    },
    {
      id: 'action:copy-link',
      title: 'Copy link to this page',
      subtitle: 'Puts the current URL on your clipboard',
      keywords: ['share', 'url', 'clipboard'],
      kind: 'action',
      group: 'Actions',
      icon: Link2,
      effect: 'run',
    },
    {
      id: 'action:logout',
      title: 'Log out',
      subtitle: 'End your session',
      keywords: ['sign out', 'signout', 'exit'],
      kind: 'action',
      group: 'Actions',
      icon: LogOut,
      effect: 'run',
    },
  ];
}

/** Appearance and settings deep links — Settings already reads `?tab=`. */
function settingDefinitions(): GuardedDefinition[] {
  return [
    {
      id: 'setting:theme-dark',
      title: 'Switch to dark theme',
      subtitle: 'Appearance',
      keywords: ['dark mode', 'night mode', 'theme'],
      kind: 'setting',
      group: 'Settings',
      icon: Moon,
      effect: 'run',
      guard: (context) => context.resolvedTheme !== 'dark',
    },
    {
      id: 'setting:theme-light',
      title: 'Switch to light theme',
      subtitle: 'Appearance',
      keywords: ['light mode', 'day mode', 'theme'],
      kind: 'setting',
      group: 'Settings',
      icon: Sun,
      effect: 'run',
      guard: (context) => context.resolvedTheme !== 'light',
    },
    {
      id: 'setting:theme-system',
      title: 'Match system theme',
      subtitle: 'Appearance',
      keywords: ['auto theme', 'system theme', 'os theme'],
      kind: 'setting',
      group: 'Settings',
      icon: Monitor,
      effect: 'run',
    },
    {
      id: 'setting:profile',
      title: 'My profile',
      subtitle: 'Settings',
      keywords: ['my account', 'change name', 'avatar', 'photo'],
      kind: 'setting',
      group: 'Settings',
      icon: SettingsIcon,
      to: '/settings?tab=profile',
      effect: 'open',
    },
    {
      id: 'setting:password',
      title: 'Change password',
      subtitle: 'Settings / Security',
      keywords: ['password', 'security', 'two factor', '2fa'],
      kind: 'setting',
      group: 'Settings',
      icon: ShieldCheck,
      to: '/settings?tab=security',
      effect: 'open',
    },
    {
      id: 'setting:notifications',
      title: 'Notification preferences',
      subtitle: 'Settings',
      keywords: ['email alerts', 'desktop push', 'mute'],
      kind: 'setting',
      group: 'Settings',
      icon: Bell,
      to: '/settings?tab=notifications',
      effect: 'open',
    },
    {
      id: 'setting:appearance',
      title: 'Appearance settings',
      subtitle: 'Settings',
      keywords: ['theme', 'dark mode', 'colours', 'colors'],
      kind: 'setting',
      group: 'Settings',
      icon: Palette,
      to: '/settings?tab=appearance',
      effect: 'open',
    },
    {
      id: 'setting:organization',
      title: 'Organization settings',
      subtitle: 'Settings',
      keywords: ['company', 'working hours', 'break types', 'logo', 'branding'],
      kind: 'setting',
      group: 'Settings',
      icon: Building2,
      to: '/settings?tab=organization',
      effect: 'open',
      guard: (context) => context.isStrictAdminView,
    },
    {
      id: 'setting:billing',
      title: 'Billing and plan',
      subtitle: 'Settings',
      keywords: ['subscription', 'invoice', 'upgrade', 'seats', 'payment'],
      kind: 'setting',
      group: 'Settings',
      icon: Wallet,
      to: '/settings?tab=billing',
      effect: 'open',
      guard: (context) => context.isStrictAdminView,
    },
    {
      id: 'setting:custom-fields',
      title: 'Custom fields',
      subtitle: 'Settings',
      keywords: ['extra fields', 'employee fields'],
      kind: 'setting',
      group: 'Settings',
      icon: SettingsIcon,
      to: '/settings?tab=custom-fields',
      effect: 'open',
      guard: (context) => context.canAccess(context.user, 'settings.view'),
    },
    {
      id: 'setting:integrations',
      title: 'Integrations',
      subtitle: 'Settings',
      keywords: ['api', 'webhook', 'connect', 'slack'],
      kind: 'setting',
      group: 'Settings',
      icon: Link2,
      to: '/settings?tab=integrations',
      effect: 'open',
      guard: (context) => context.canAccess(context.user, 'settings.view'),
    },
    {
      id: 'setting:team-directory',
      title: 'My team',
      subtitle: 'People',
      keywords: ['my reports', 'direct reports', 'reporting line'],
      kind: 'setting',
      group: 'Settings',
      icon: Users,
      to: '/my-team',
      effect: 'open',
      guard: (context) => !context.isAdminView,
    },
  ];
}

/** Client-side effects, keyed by command id. */
export function resolveCommandEffect(id: string, context: CommandContext): (() => void) | undefined {
  switch (id) {
    case 'setting:theme-dark':
      return () => context.setTheme('dark');
    case 'setting:theme-light':
      return () => context.setTheme('light');
    case 'setting:theme-system':
      return () => context.setTheme('system');
    case 'action:copy-link':
      return () => context.copyCurrentUrl();
    case 'action:logout':
      return () => {
        void context.logout();
      };
    default:
      return undefined;
  }
}

/**
 * Every local command the given user may use. Server-backed results (people,
 * records) are merged in by the caller — they arrive asynchronously and must
 * not block this list from rendering instantly.
 */
export function buildLocalCommands(context: CommandContext): CommandItem[] {
  const pages = buildPageCommands(context.navigation);

  const guarded = [...actionDefinitions(), ...settingDefinitions()]
    .filter((definition) => (definition.guard ? definition.guard(context) : true))
    .map(({ guard: _guard, ...definition }) => {
      const run = resolveCommandEffect(definition.id, context);
      return run ? { ...definition, run } : definition;
    });

  // The desktop shell only renders a handful of routes; anything else has to
  // open in the browser, which `externalPath` already expresses for pages.
  // Actions that would land on a route the shell cannot render are dropped
  // rather than shown as a dead end.
  const desktopSafe = context.isDesktopShell
    ? guarded.filter((definition) => definition.effect === 'run' || String(definition.to || '').startsWith('/dashboard') || String(definition.to || '').startsWith('/attendance') || String(definition.to || '').startsWith('/edit-time') || String(definition.to || '').startsWith('/chat'))
    : guarded;

  return [...desktopSafe, ...pages];
}
