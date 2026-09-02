import { useEffect, useId, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { exitApi, invitationApi, organizationApi, reportGroupApi, roleApi, userApi } from '@/services/api';
import DepartmentWorkspace from '@/features/departments/DepartmentWorkspace';
import RoleAssignmentBoard from '@/features/roles/RoleAssignmentBoard';
import EmployeeRoster, {
  type RosterExit,
  type RosterUser,
  type Segment as RosterSegment,
} from '@/features/employees/EmployeeRoster';
import SlideOver from '@/features/employees/SlideOver';
import QuickCreateGroupDialog from '@/components/groups/QuickCreateGroupDialog';
import Button from '@/components/ui/Button';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { FeedbackBanner, PageEmptyState, PageErrorState, PageLoadingState } from '@/components/ui/PageState';
import { FieldLabel, SelectInput, TextInput, ToggleInput } from '@/components/ui/FormField';
import { useAuth } from '@/contexts/AuthContext';
import { getAssignableRoles, hasStrictAdminAccess, resolveUserRoleLabel } from '@/lib/permissions';
import { profileCompleteness } from '@/lib/employeeProfileFields';
import SettingsCard from '@/features/settings/components/SettingsCard';
import SettingRow from '@/features/settings/components/SettingRow';
import { CalendarCheck, Clock, Download, ListChecks, MailPlus, SlidersHorizontal, UserPlus, Users, Wallet } from 'lucide-react';
import { resolveTimeZone, DEFAULT_APP_TIMEZONE } from '@/lib/timezones';
import { formatDateTime } from '@/lib/dateTime';
import { todayIso } from '@/lib/formatters';
import { LIST_MAX_BODY_HEIGHT } from '@/lib/pagination';
import { brandLabel } from '@/config/brand';

type EmployeeWorkspaceMode = 'employees' | 'teams' | 'invitations' | 'roles';
type EmployeeDirectorySort = 'default' | 'name_asc' | 'working_first';

/**
 * The one decision on this page worth interrupting for.
 *
 * It uses ConfirmDialog rather than a native `confirm()` because the copy is a
 * paragraph, not a sentence: bringing somebody back takes a seat and re-bases
 * their joining date, and neither is obvious from the button.
 *
 * Deleting an employee used to live here too. It is gone — offboarding is an
 * exit, which the row menu now links to directly.
 */
type PendingConfirm = { kind: 'rejoin'; user: any; exitId: number };

type TableColumn<T> = {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
};

const SurfaceCard = ({ children, className = '' }: { children: ReactNode; className?: string }) => (
  <section className={`rounded-lg border border-slate-200 bg-white shadow-sm ${className}`}>{children}</section>
);

const MetricCard = ({ label, value, hint, icon: Icon, accent = 'sky' }: { label: string; value: string | number; hint?: string; icon: any; accent?: 'sky' | 'emerald' | 'violet' | 'amber' | 'rose' | 'slate' }) => {
  const accentClasses = {
    sky: 'bg-blue-50 text-blue-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    violet: 'bg-violet-50 text-violet-600',
    amber: 'bg-amber-50 text-amber-600',
    rose: 'bg-rose-50 text-rose-600',
    slate: 'bg-slate-100 text-slate-600',
  } as const;

  return (
    <SurfaceCard className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs text-slate-500">{label}</p>
          <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">{value}</p>
          {hint ? <p className="mt-2 text-[11px] text-slate-500">{hint}</p> : null}
        </div>
        <div className={`flex h-10 w-10 items-center justify-center rounded-full ${accentClasses[accent]}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </SurfaceCard>
  );
};

function DataTable<T>({
  title,
  description,
  rows,
  columns,
  emptyMessage,
  headerAction,
  bodyClassName = '',
  scrollBody = false,
}: {
  title: string;
  description?: string;
  rows: T[];
  columns: TableColumn<T>[];
  emptyMessage: string;
  headerAction?: ReactNode;
  bodyClassName?: string;
  /**
   * Cap the height and pin the header so the pager below stays on screen.
   * Mirrors the prop of the same name on components/dashboard/DataTable — this
   * file carries its own near-identical copy of that component, so the two have
   * to be kept in step by hand until one of them is deleted.
   */
  scrollBody?: boolean;
}) {
  return (
    <SurfaceCard className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-[15px] font-semibold text-slate-950">{title}</h2>
          {description ? <p className="mt-1 text-xs text-slate-500">{description}</p> : null}
        </div>
        {headerAction ? <div className="shrink-0">{headerAction}</div> : null}
      </div>
      <div className={`overflow-x-auto ${scrollBody ? `${LIST_MAX_BODY_HEIGHT} overflow-y-auto` : ''} ${bodyClassName}`.replace(/\s+/g, ' ').trim()}>
        <table className="min-w-full text-left text-xs">
          <thead className={`bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500 ${scrollBody ? 'sticky top-0 z-10' : ''}`.trim()}>
            <tr>
              {columns.map((column) => (
                <th key={column.key} className={`px-4 py-3 font-medium ${column.className || ''}`.trim()}>{column.header}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-sm text-slate-500">{emptyMessage}</td>
              </tr>
            ) : (
              rows.map((row, index) => (
                <tr key={index}>
                  {columns.map((column) => (
                    <td key={column.key} className={`px-4 py-3 align-middle text-slate-700 ${column.className || ''}`.trim()}>
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </SurfaceCard>
  );
}


const resolveEmployeeDepartment = (user: any) =>
  String(
    user?.department
    || user?.employee_work_info?.department?.name
    || user?.employeeWorkInfo?.department?.name
    || user?.groups?.[0]?.name
    || 'Unassigned'
  ).trim() || 'Unassigned';

const resolveEmployeeTimezone = (user: any) =>
  resolveTimeZone(user?.settings?.timezone || DEFAULT_APP_TIMEZONE);

const monitoringIntervalOptions = [
  { value: 1, label: 'Every 1 minute' },
  { value: 3, label: 'Every 3 minutes' },
  { value: 5, label: 'Every 5 minutes' },
  { value: 10, label: 'Every 10 minutes' },
  { value: 15, label: 'Every 15 minutes' },
  { value: 30, label: 'Every 30 minutes' },
] as const;

/** null = inherit the organization default. */
type MonitoringInterval = typeof monitoringIntervalOptions[number]['value'] | null;

type EmployeeSettingsDraft = {
  monitoringInterval: MonitoringInterval;
  canEditTime: boolean;
  attendanceMonitoring: boolean;
  payrollVisibility: boolean;
  taskAssignmentAccess: boolean;
};

const allowedMonitoringIntervals = monitoringIntervalOptions.map((option) => option.value);

const resolveEmployeeSettings = (targetUser: any): EmployeeSettingsDraft => {
  const settings = targetUser?.settings || {};
  // `== null` rather than a falsy check: absence of the key is what "inherit
  // from the organization" means, and it must be distinguishable from a real
  // per-user override.
  const rawInterval = settings.monitoring_interval_minutes;
  const interval = rawInterval == null ? null : Number(rawInterval);

  return {
    monitoringInterval: interval !== null && allowedMonitoringIntervals.includes(interval as any)
      ? interval as MonitoringInterval
      : null,
    canEditTime: settings.can_edit_time !== false,
    attendanceMonitoring: settings.attendance_monitoring !== false,
    payrollVisibility: (targetUser?.hierarchy_level ?? (targetUser?.role === 'employee' ? 100 : 50)) >= 100 ? false : settings.payroll_visibility !== false,
    taskAssignmentAccess: settings.task_assignment_access !== false,
  };
};

const modeCopy: Record<EmployeeWorkspaceMode, { title: string; description: string; eyebrow: string }> = {
  employees: {
    eyebrow: 'Employee Management',
    title: 'Employees',
    description: 'Manage employee profiles, roles, departments, and permissions.',
  },
  teams: {
    eyebrow: 'Employee Management',
    title: 'Teams / Departments',
    description: 'Manage report groups as teams or departments using the existing backend group model.',
  },
  invitations: {
    eyebrow: 'Employee Management',
    title: 'Invitations / Onboarding',
    description: 'Send secure invitations, review pending onboarding, and track active members.',
  },
  roles: {
    eyebrow: 'Employee Management',
    title: 'Roles / Permissions',
    description: 'Review and update employee roles against the existing user role model.',
  },
};

export default function EmployeeManagementWorkspace({ mode }: { mode: EmployeeWorkspaceMode }) {
  const { organization, user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const viewerTimezone = (user?.settings as any)?.timezone || DEFAULT_APP_TIMEZONE;
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [directoryDepartmentFilter, setDirectoryDepartmentFilter] = useState('All departments');
  const [directoryTimezoneFilter, setDirectoryTimezoneFilter] = useState('All timezones');
  const [directorySort, setDirectorySort] = useState<EmployeeDirectorySort>('default');
  const [directoryQuery, setDirectoryQuery] = useState('');
  const [directorySegment, setDirectorySegment] = useState<RosterSegment>('all');
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [groupDirectoryQuery, setGroupDirectoryQuery] = useState('');
  const [_groupDirectoryFilter, setGroupDirectoryFilter] = useState('all');
  const [memberDrafts, setMemberDrafts] = useState<Record<number, string>>({});
  const [_deletingGroupId, setDeletingGroupId] = useState<number | null>(null);
  const [roleSearchQuery, setRoleSearchQuery] = useState('');
  const [showIncompleteOnly, setShowIncompleteOnly] = useState(false);
  const [incompleteFilterType, setIncompleteFilterType] = useState<'all' | 'missing_pan' | 'missing_bank'>('all');
  const [settingsUserId, setSettingsUserId] = useState<number | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<EmployeeSettingsDraft | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const isStrictAdmin = hasStrictAdminAccess(user);
  const canManageDirectoryRoles = isStrictAdmin;
  const allowedRoles = useMemo(() => getAssignableRoles(user, organization), [organization, user]);

  const usersQuery = useQuery({
    queryKey: ['employee-workspace-users'],
    queryFn: async () => {
      const response = await userApi.getAll({ period: 'all' });
      return response.data || [];
    },
  });

  const customRolesQuery = useQuery({
    queryKey: ['employee-workspace-custom-roles'],
    queryFn: async () => {
      const response = await roleApi.list();
      return response.data.data || [];
    },
    enabled: !!user?.organization_id,
  });

  const groupsQuery = useQuery({
    queryKey: ['employee-workspace-groups'],
    queryFn: async () => {
      const response = await reportGroupApi.list();
      return response.data?.data || [];
    },
  });

  const membersQuery = useQuery({
    queryKey: ['employee-workspace-members', organization?.id],
    queryFn: async () => {
      if (!organization?.id) return [];
      const response = await organizationApi.getMembers(organization.id);
      return response.data || [];
    },
    enabled: Boolean(organization?.id),
  });

  const invitationsQuery = useQuery({
    queryKey: ['employee-workspace-invitations'],
    queryFn: async () => {
      const response = await invitationApi.list();
      return response.data?.invitations || [];
    },
    enabled: mode === 'invitations' && allowedRoles.length > 0,
  });

  const users = usersQuery.data || [];
  const groups = groupsQuery.data || [];
  const members = membersQuery.data || [];
  const invitations = invitationsQuery.data || [];

  const getHierarchyLevel = (u: any): number => {
    if (u?.hierarchy_level !== undefined && u.hierarchy_level !== null) return Number(u.hierarchy_level);
    if (u?.role_id && customRolesQuery.data) {
      const cr = customRolesQuery.data.find((r: any) => r.id === u.role_id);
      if (cr) return cr.hierarchy_level;
    }
    const role = String(u?.role || '').toLowerCase();
    if (role === 'admin') return 10;
    if (role === 'manager') return 50;
    if (role === 'employee') return 100;
    return 999;
  };

  const getRoleName = (u: any): string => {
    if (u?.role_name) return u.role_name;
    if (u?.role_id && customRolesQuery.data) {
      const cr = customRolesQuery.data.find((r: any) => r.id === u.role_id);
      if (cr) return cr.name;
    }
    const role = String(u?.role || '').toLowerCase();
    return role ? role.charAt(0).toUpperCase() + role.slice(1) : 'Employee';
  };

  const currentUserLevel = useMemo(() => getHierarchyLevel(user), [user, customRolesQuery.data]);

  /*
   * Only fetched for the Ex-employees segment, and only for people the exits
   * API will answer at all — it refuses hierarchy >= 100, so asking on every
   * page load would put a 403 in front of every employee for a tab they are
   * not looking at. Deliberately NOT part of the page's isLoading gate: the
   * other three segments must not wait on it.
   */
  const exitsQuery = useQuery({
    queryKey: ['employee-workspace-exits'],
    queryFn: async () => (await exitApi.list()).data.data,
    enabled: mode === 'employees' && directorySegment === 'former' && currentUserLevel < 100,
  });

  /**
   * The exit that speaks for each former employee: the LATEST one.
   *
   * Somebody rehired once and gone again has two, and the server's rejoin
   * refuses any but the most recent — offering the older, friendlier one would
   * be a button that always fails.
   */
  const exitByUserId = useMemo(() => {
    const map = new Map<number, RosterExit>();

    (exitsQuery.data ?? []).forEach((exit) => {
      const current = map.get(exit.user_id);
      const isNewer =
        !current ||
        exit.last_working_date > current.lastWorkingDate ||
        (exit.last_working_date === current.lastWorkingDate && exit.id > current.id);

      if (isNewer) {
        map.set(exit.user_id, {
          id: exit.id,
          lastWorkingDate: exit.last_working_date,
          exitType: exit.exit_type,
          rehireEligibility: exit.rehire_eligibility,
        });
      }
    });

    return map;
  }, [exitsQuery.data]);

  const managerManagedDepartment = useMemo(() => {
    if (currentUserLevel > 50) {
      return null;
    }

    // Strategy 1: Find a group where the user is the highest-ranked member
    const managedGroup = groups.find((group: any) => {
      if (!Array.isArray(group?.users)) return false;
      const members = group.users.map((m: any) => ({ ...m, level: getHierarchyLevel(m) }));
      const lead = members.sort((a: any, b: any) => a.level - b.level)[0];
      return lead && Number(lead.id) === Number(user.id);
    });
    if (managedGroup?.name) {
      return String(managedGroup.name).trim();
    }

    // Strategy 2: Use the auth user's own groups
    if (user?.groups && user.groups.length > 0) {
      const groupName = user.groups[0].name?.trim();
      if (groupName) {
        return groupName;
      }
    }

    // Strategy 3: Fallback to user's own department
    const fallbackDepartment = resolveEmployeeDepartment(user);
    return fallbackDepartment !== 'Unassigned' ? fallbackDepartment : null;
  }, [groups, user, currentUserLevel, customRolesQuery.data]);

  const departmentOptions = useMemo(
    () => {
      if (currentUserLevel > 50) {
        if (managerManagedDepartment) {
          return [managerManagedDepartment];
        }
        const departments = Array.from(new Set(users.map((item: any) => resolveEmployeeDepartment(item)).filter(Boolean)));
        return departments.length > 0 ? departments : ['Unassigned'];
      }

      return ['All departments', ...Array.from(new Set(users.map((item: any) => resolveEmployeeDepartment(item)).filter(Boolean)))];
    },
    [managerManagedDepartment, currentUserLevel, users]
  );

  const timezoneOptions = useMemo(
    () => ['All timezones', ...Array.from(new Set(users.map((item: any) => resolveEmployeeTimezone(item)).filter(Boolean))).sort()],
    [users]
  );

  const settingsTargetUser = useMemo(
    () => users.find((item: any) => item.id === settingsUserId) || null,
    [settingsUserId, users]
  );

  const monitoringIntervalId = useId();
  /* First name only — the drawer already carries the full name in its heading. */
  const settingsFirstName = String(settingsTargetUser?.name ?? 'this person').trim().split(/\s+/)[0] || 'this person';
  /*
   * Employees sit at hierarchy 100 and never receive payroll reporting. The
   * fallback mirrors the server default for a user whose level is not loaded.
   */
  const settingsPayrollLocked =
    (settingsTargetUser?.hierarchy_level ?? (settingsTargetUser?.role === 'employee' ? 100 : 50)) >= 100;
  const settingsGrantedCount = settingsDraft
    ? [
        settingsDraft.canEditTime,
        settingsDraft.attendanceMonitoring,
        settingsDraft.payrollVisibility,
        settingsDraft.taskAssignmentAccess,
      ].filter(Boolean).length
    : 0;

  useEffect(() => {
    if (!selectedUserId && users.length > 0) {
      setSelectedUserId(users[0].id);
    }
  }, [selectedUserId, users]);

  useEffect(() => {
    if (mode !== 'employees') {
      return;
    }

    const params = new URLSearchParams(location.search);
    const nextDepartment = String(params.get('department') || '').trim();
    const filterParam = String(params.get('filter') || '').trim();
    
    if (filterParam === 'incomplete' || filterParam === 'missing_pan' || filterParam === 'missing_bank') {
      setShowIncompleteOnly(true);
      setIncompleteFilterType(filterParam === 'incomplete' ? 'all' : filterParam);
    } else {
      setShowIncompleteOnly(false);
      setIncompleteFilterType('all');
    }
    
    if (nextDepartment) {
      setDirectoryDepartmentFilter(nextDepartment);
      return;
    }

    if (currentUserLevel > 50 && managerManagedDepartment) {
      setDirectoryDepartmentFilter(managerManagedDepartment);
    }
  }, [location.search, mode, currentUserLevel, managerManagedDepartment]);

  // The settings form used to render below the table, so opening it required a
  // double-rAF scroll to bring the panel into view. It is a drawer now — it
  // arrives already visible, and the list behind it never moves.

  /*
   * Resend and revoke.
   *
   * Until these existed an invitation was fire-and-forget: one whose mail
   * failed could only be replaced by sending another, and one sent to the wrong
   * address stayed valid for its whole window with no way to call it back.
   *
   * Resend rotates the token, so it doubles as "regenerate" for a link invite
   * whose URL was shown once and lost — the response carries the new one.
   */
  const [copiedInviteId, setCopiedInviteId] = useState<number | null>(null);

  const resendInviteMutation = useMutation({
    mutationFn: async (invitationId: number) => (await invitationApi.resend(invitationId)).data.invitation,
    onSuccess: async (invitation) => {
      if (invitation?.delivery_method === 'link' && invitation.invite_url) {
        await navigator.clipboard.writeText(invitation.invite_url).catch(() => undefined);
        setCopiedInviteId(invitation.id);
        setFeedback({
          tone: 'success',
          message: `New link for ${invitation.email} copied to your clipboard. The previous link no longer works.`,
        });
      } else {
        setFeedback({ tone: 'success', message: `Invitation to ${invitation?.email} sent again.` });
      }
      await queryClient.invalidateQueries({ queryKey: ['employee-workspace-invitations'] });
    },
    onError: (error: any) => {
      setFeedback({ tone: 'error', message: error?.response?.data?.message || 'Could not resend this invitation.' });
    },
  });

  const revokeInviteMutation = useMutation({
    mutationFn: async (invitationId: number) => (await invitationApi.revoke(invitationId)).data.invitation,
    onSuccess: async (invitation) => {
      setFeedback({ tone: 'success', message: `Invitation to ${invitation?.email} revoked. Its link no longer works.` });
      await queryClient.invalidateQueries({ queryKey: ['employee-workspace-invitations'] });
    },
    onError: (error: any) => {
      setFeedback({ tone: 'error', message: error?.response?.data?.message || 'Could not revoke this invitation.' });
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: async ({ userId, role, roleId }: { userId: number; role?: string; roleId?: number | null }) => {
      if (roleId !== undefined) {
        await roleApi.assignUser({ user_id: userId, role_id: roleId });
      } else if (role) {
        await userApi.update(userId, { role: role as 'admin' | 'manager' | 'employee' });
      }
    },
    onSuccess: async () => {
      setFeedback({ tone: 'success', message: 'Role updated successfully.' });
      await queryClient.invalidateQueries({ queryKey: ['employee-workspace-users'] });
      await queryClient.invalidateQueries({ queryKey: ['employee-workspace-custom-roles'] });
    },
    onError: (error: any) => {
      setFeedback({ tone: 'error', message: error?.response?.data?.message || 'Failed to update role.' });
    },
  });

  const updateSettingsMutation = useMutation({
    mutationFn: async ({ targetUser, draft }: { targetUser: any; draft: EmployeeSettingsDraft }) => {
      await userApi.update(targetUser.id, {
        settings: {
          ...(targetUser.settings || {}),
          monitoring_interval_minutes: draft.monitoringInterval,
          can_edit_time: draft.canEditTime,
          attendance_monitoring: draft.attendanceMonitoring,
          payroll_visibility: (targetUser?.hierarchy_level ?? (targetUser?.role === 'employee' ? 100 : 50)) >= 100 ? false : draft.payrollVisibility,
          task_assignment_access: draft.taskAssignmentAccess,
        },
      });
    },
    onSuccess: async () => {
      setFeedback({ tone: 'success', message: 'Additional settings updated successfully.' });
      await queryClient.invalidateQueries({ queryKey: ['employee-workspace-users'] });
    },
    onError: (error: any) => {
      setFeedback({ tone: 'error', message: error?.response?.data?.message || 'Failed to update additional settings.' });
    },
  });

  const rejoinMutation = useMutation({
    mutationFn: async ({ exitId, joiningDate }: { exitId: number; joiningDate: string; name: string }) =>
      (await exitApi.rejoin(exitId, { joining_date: joiningDate })).data.data,
    onSuccess: async (_data, variables) => {
      setFeedback({ tone: 'success', message: `${variables.name} is back. Their account is active again.` });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['employee-workspace-users'] }),
        queryClient.invalidateQueries({ queryKey: ['employee-workspace-exits'] }),
      ]);
    },
    onError: (error: any) => {
      /*
       * A seat refusal is a NORMAL outcome, and the server's message carries the
       * shortfall — "2 of 2 seats in use, add at least 1 more". Replacing it
       * with something generic leaves the admin with a button that failed and
       * no idea that buying a seat is the fix.
       */
      setFeedback({
        tone: 'error',
        message: error?.response?.data?.message || 'Could not bring this person back.',
      });
    },
  });

  const isLoading = usersQuery.isLoading || groupsQuery.isLoading || membersQuery.isLoading || invitationsQuery.isLoading;
  const isError = usersQuery.isError || groupsQuery.isError || membersQuery.isError || invitationsQuery.isError;
  const pageTitle = modeCopy[mode];

  /**
   * "Incomplete" now means the shared registry says so, rather than a local
   * two-field rule. The old version only looked at bank details and PAN, so a
   * record missing a date of birth, an address and an emergency contact counted
   * as complete — and one missing nothing but a bank row counted as incomplete.
   * The deep links from payroll still target their specific field.
   */
  const hasIncompleteProfile = (user: any, filterType: 'all' | 'missing_pan' | 'missing_bank' = 'all') => {
    if (filterType === 'missing_pan' || filterType === 'missing_bank') {
      const key = filterType === 'missing_pan' ? 'pan' : 'bank_account';
      return profileCompleteness(user).missing.some((field) => field.key === key);
    }

    return !profileCompleteness(user).isComplete;
  };

  const employeeCodeOf = (item: any) =>
    item.employee_work_info?.employee_code || item.employeeWorkInfo?.employee_code || '';

  const employeeDirectoryRows = useMemo(() => {
    // A free-text box replaced the "specific employee" dropdown: typing three
    // letters beats opening a picker and scrolling to a name.
    const needle = directoryQuery.trim().toLowerCase();
    const searchedRows = needle
      ? users.filter((item: any) =>
          [item.name, item.email, employeeCodeOf(item)]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
            .includes(needle)
        )
      : [...users];

    const departmentFilteredRows = directoryDepartmentFilter === 'All departments'
      ? searchedRows
      : searchedRows.filter((item: any) => resolveEmployeeDepartment(item) === directoryDepartmentFilter);

    const timezoneFilteredRows = directoryTimezoneFilter === 'All timezones'
      ? departmentFilteredRows
      : departmentFilteredRows.filter((item: any) => resolveEmployeeTimezone(item) === directoryTimezoneFilter);

    /*
     * Ex-employees are their own segment and appear in no other.
     *
     * Nothing filtered them out before — /api/users returns everyone — so
     * "Everyone" already listed leavers, and "Incomplete profiles" was telling
     * an admin to chase a PAN for somebody who left in June. An Ex-employees
     * tab beside an Everyone that still contained them would contradict itself
     * on one screen. This visibly reduces the headcount admins are used to.
     */
    const activeRows = timezoneFilteredRows.filter((item: any) => item.is_active !== false);

    // The segment is the coarse view; `showIncompleteOnly` is still honoured so
    // the deep link from the payroll dashboard keeps working.
    const segmentedRows =
      directorySegment === 'working'
        ? activeRows.filter((item: any) => Boolean(item.is_working))
        : directorySegment === 'incomplete'
          ? activeRows.filter((item: any) => hasIncompleteProfile(item, incompleteFilterType))
          : directorySegment === 'former'
            ? timezoneFilteredRows.filter((item: any) => item.is_active === false)
            : activeRows;

    const incompleteFilteredRows = showIncompleteOnly && directorySegment !== 'incomplete'
      ? segmentedRows.filter((item: any) => hasIncompleteProfile(item, incompleteFilterType))
      : segmentedRows;

    switch (directorySort) {
      case 'name_asc':
        return incompleteFilteredRows.sort((left: any, right: any) =>
          String(left.name || '').localeCompare(String(right.name || ''), undefined, { sensitivity: 'base' })
        );
      case 'working_first':
        return incompleteFilteredRows.sort((left: any, right: any) => {
          const workingDifference = Number(Boolean(right.is_working)) - Number(Boolean(left.is_working));
          if (workingDifference !== 0) {
            return workingDifference;
          }

          return String(left.name || '').localeCompare(String(right.name || ''), undefined, { sensitivity: 'base' });
        });
      default:
        return incompleteFilteredRows;
    }
  }, [directoryDepartmentFilter, directoryTimezoneFilter, directorySort, users, showIncompleteOnly, incompleteFilterType, directoryQuery, directorySegment]);

  /*
   * All three counts are taken over the same population as the rows they label.
   * Counting leavers in "working now" or "incomplete profiles" would put a pill
   * on a tab that then shows fewer rows than it promised.
   */
  const activeUsers = useMemo(() => users.filter((item: any) => item.is_active !== false), [users]);

  const workingNowCount = useMemo(
    () => activeUsers.filter((item: any) => Boolean(item.is_working)).length,
    [activeUsers]
  );
  const incompleteProfileCount = useMemo(
    () => activeUsers.filter((item: any) => hasIncompleteProfile(item, incompleteFilterType)).length,
    [activeUsers, incompleteFilterType]
  );
  const formerEmployeeCount = useMemo(
    () => users.filter((item: any) => item.is_active === false).length,
    [users]
  );

  const handleExportCsv = async () => {
    setIsExporting(true);
    try {
      const response = await userApi.exportCsv({
        department: directoryDepartmentFilter !== 'All departments'
          ? directoryDepartmentFilter
          : undefined,
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.download = `employees-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error: any) {
      setFeedback({
        tone: 'error',
        message: error?.response?.data?.message || 'Failed to export employees.',
      });
    } finally {
      setIsExporting(false);
    }
  };

  /* ── bulk actions on the employee roster ─────────────────────── */

  const [isBulkRunning, setIsBulkRunning] = useState(false);

  /**
   * Runs one write per person and reports once at the end. Failures are counted
   * rather than thrown away, so a partial run says so instead of claiming
   * success — there is no bulk endpoint to lean on here.
   */
  const runBulk = async (
    userIds: number[],
    write: (userId: number) => Promise<unknown>,
    describe: (okCount: number) => string,
    /*
     * Only bulk delete supplies this. A count is enough when a write was
     * refused for a reason the admin can guess; it is not enough when the
     * server refused specific PEOPLE for a rule they have never met, which is
     * exactly what the delete guard now does.
     */
    describeFailures?: (failures: Array<{ userId: number; message: string }>) => string
  ) => {
    setIsBulkRunning(true);
    setFeedback(null);
    let ok = 0;
    const failures: Array<{ userId: number; message: string }> = [];

    for (const userId of userIds) {
      try {
        await write(userId);
        ok += 1;
      } catch (error: any) {
        failures.push({ userId, message: String(error?.response?.data?.message || '') });
      }
    }

    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['employee-workspace-users'] }),
      queryClient.invalidateQueries({ queryKey: ['employee-workspace-groups'] }),
      queryClient.invalidateQueries({ queryKey: ['employee-workspace-custom-roles'] }),
    ]);

    setFeedback(
      failures.length === 0
        ? { tone: 'success', message: describe(ok) }
        : {
            tone: 'error',
            message: describeFailures
              ? describeFailures(failures)
              : `${describe(ok)} ${failures.length} could not be updated.`,
          }
    );
    setIsBulkRunning(false);
  };

  const handleBulkAddToDepartment = (userIds: number[], departmentId: number, departmentName: string) =>
    void runBulk(
      userIds,
      async (userId) => {
        // Union, never replace: someone may sit in more than one department and
        // overwriting the list here would quietly drop the others.
        const member = findUserById(userId);
        const existing = (member?.groups || []).map((group: any) => Number(group.id));
        await userApi.update(userId, {
          group_ids: Array.from(new Set([...existing, departmentId])),
        });
      },
      (ok) => `Added ${ok} ${ok === 1 ? 'person' : 'people'} to ${departmentName}.`
    );

  const handleBulkAssignRole = (userIds: number[], roleId: number, roleName: string) => {
    const role = (customRolesQuery.data || []).find((candidate: any) => candidate.id === roleId);
    if (!role) return;

    void runBulk(
      userIds,
      async (userId) => {
        if (role.is_system) {
          await userApi.update(userId, { role: role.slug as 'admin' | 'manager' | 'employee' });
        } else {
          await roleApi.assignUser({ user_id: userId, role_id: roleId });
        }
      },
      (ok) => `Assigned ${roleName} to ${ok} ${ok === 1 ? 'person' : 'people'}.`
    );
  };

  /**
   * Built in the browser from the rows already on screen. `userApi.exportCsv`
   * only accepts a department filter, so it cannot express "these ten people".
   */
  const handleExportSelected = (selectedUsers: any[]) => {
    const header = ['Employee code', 'Name', 'Email', 'Role', 'Department', 'Timezone'];
    const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;

    const csv = [
      header.map(escape).join(','),
      ...selectedUsers.map((row) =>
        [
          employeeCodeOf(row) || row.id,
          row.name,
          row.email,
          resolveUserRoleLabel(row, customRolesQuery.data || []),
          resolveEmployeeDepartment(row),
          resolveEmployeeTimezone(row),
        ]
          .map(escape)
          .join(',')
      ),
    ].join('\n');

    const url = window.URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `employees-selected-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  };

  const canCreateGroups = currentUserLevel <= 10;
  const canManageDepartments = currentUserLevel <= 50;

  const findUserById = (userId: number) => users.find((candidate: any) => Number(candidate.id) === Number(userId));
  const canManageGroupMember = (member: any) => {
    const memberLevel = getHierarchyLevel(member);
    return memberLevel >= 100 || (memberLevel <= 50 && currentUserLevel <= 10);
  };

  const syncMembershipMutation = useMutation({
    mutationFn: async ({ userId, groupIds, successMessage }: { userId: number; groupIds: number[]; successMessage: string }) => {
      await userApi.update(userId, { group_ids: groupIds });
      return successMessage;
    },
    onSuccess: async (message) => {
      setFeedback({ tone: 'success', message });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['employee-workspace-groups'] }),
        queryClient.invalidateQueries({ queryKey: ['employee-workspace-users'] }),
      ]);
    },
    onError: (error: any) => {
      const fieldError = Object.values(error?.response?.data?.errors || {}).flat().find(Boolean);
      setFeedback({ tone: 'error', message: String(fieldError || error?.response?.data?.message || 'Failed to update department membership.') });
    },
  });

  const deleteGroupMutation = useMutation({
    mutationFn: async (group: any) => {
      await reportGroupApi.delete(group.id);
      return group;
    },
    onMutate: (group) => {
      setDeletingGroupId(group.id);
    },
    onSuccess: async (group) => {
      setFeedback({ tone: 'success', message: `${group.name} was deleted.` });
      setGroupDirectoryFilter((current) => (current === String(group.id) ? 'all' : current));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['employee-workspace-groups'] }),
        queryClient.invalidateQueries({ queryKey: ['employee-workspace-users'] }),
      ]);
    },
    onError: (error: any) => {
      const fieldError = Object.values(error?.response?.data?.errors || {}).flat().find(Boolean);
      setFeedback({ tone: 'error', message: String(fieldError || error?.response?.data?.message || 'Failed to delete department.') });
    },
    onSettled: () => {
      setDeletingGroupId(null);
    },
  });

  const handleAddMemberToGroup = (group: any) => {
    const selectedUserId = Number(memberDrafts[group.id] || 0);
    if (!selectedUserId) {
      setFeedback({ tone: 'error', message: `Select one eligible member to add into ${group.name}.` });
      return;
    }

    const member = findUserById(selectedUserId);
    if (!member || !canManageGroupMember(member)) {
      setFeedback({ tone: 'error', message: 'Selected member could not be found.' });
      return;
    }

    const nextGroupIds = Array.from(new Set([...(member.groups || []).map((currentGroup: any) => currentGroup.id), group.id]));
    syncMembershipMutation.mutate({
      userId: member.id,
      groupIds: nextGroupIds,
      successMessage: `${member.name} was added to ${group.name}.`,
    });
    setMemberDrafts((current) => ({ ...current, [group.id]: '' }));
  };

  const handleRemoveEmployeeFromGroup = (member: any, currentGroup: any) => {
    const currentGroupIds = (member.groups || []).map((assignedGroup: any) => assignedGroup.id);
    const nextGroupIds = currentGroupIds.filter((groupId: number) => groupId !== currentGroup.id);
    if (nextGroupIds.length === 0) {
      setFeedback({
        tone: 'error',
        message: `${member.name} is currently only in ${currentGroup.name}. Move to another department before removing this membership.`,
      });
      return;
    }

    syncMembershipMutation.mutate({
      userId: member.id,
      groupIds: nextGroupIds,
      successMessage: `${member.name} was removed from ${currentGroup.name}.`,
    });
  };

  const handleDeleteGroup = (group: any) => {
    if (!confirm(`Delete "${group.name}"? Members will be detached and tasks in this department will become unassigned.`)) {
      return;
    }

    deleteGroupMutation.mutate(group);
  };

  const teamInsights = useMemo(() => {
    return groups.map((group: any, index: number) => {
      const teamUsers = Array.isArray(group?.users) ? group.users : [];
      const enrichedUsers = teamUsers.map((member: any) => ({
        ...member,
        level: getHierarchyLevel(member),
        displayRole: getRoleName(member),
      }));

      // The department lead is the most senior MANAGER — not simply the most
      // senior person. Sorting everyone by hierarchy_level and taking the first
      // picks an admin whenever one happens to be a member, which is why the
      // chart showed employees led by (and reporting to) an admin. Admins are
      // above the department, not the lead of it. Mirrors the server-side
      // ReportingManagerResolver rule: 10 < level < 100.
      const managerCandidates = enrichedUsers
        .filter((member: any) => member.level > 10 && member.level < 100)
        .sort((a: any, b: any) => a.level - b.level || String(a.name || '').localeCompare(String(b.name || '')));
      const lead = managerCandidates[0] ?? null;
      const leadLabel = lead?.displayRole || 'Lead';
      const memberCount = enrichedUsers.length;

      return {
        id: Number(group.id),
        name: String(group.name || 'Department'),
        description: String(group.description || '').trim(),
        users: enrichedUsers,
        employeeCount: memberCount - (lead ? 1 : 0),
        membersCount: memberCount,
        leadName: lead?.name || 'Not assigned',
        leadLabel,
        leadEmail: lead?.email || null,
        managerName: lead?.name || 'Not assigned', // keep for backward compat in UI refs
      };
    });
  }, [groups, customRolesQuery.data]);

  useEffect(() => {
    if (!departmentOptions.includes(directoryDepartmentFilter)) {
      setDirectoryDepartmentFilter(departmentOptions[0] || 'All departments');
    }
  }, [departmentOptions, directoryDepartmentFilter]);

  useEffect(() => {
    if (!timezoneOptions.includes(directoryTimezoneFilter)) {
      setDirectoryTimezoneFilter('All timezones');
    }
  }, [timezoneOptions, directoryTimezoneFilter]);

  const handleRejoin = (targetUser: any) => {
    const exit = exitByUserId.get(Number(targetUser?.id));
    if (!exit) {
      return;
    }

    setPendingConfirm({ kind: 'rejoin', user: targetUser, exitId: exit.id });
  };

  /*
   * Wording, not just plumbing. "This will delete the employee account" stopped
   * being true for almost everybody the day the server started refusing a
   * delete for anyone with history, and a confirm that promises something the
   * next request refuses is worse than no confirm at all.
   */
  const confirmCopy = ((): { title: string; message: string; label: string; tone: 'danger' | 'default' } | null => {
    if (!pendingConfirm) return null;

    const name = pendingConfirm.user?.name || 'this person';
    return {
      title: `Bring ${name} back?`,
      message:
        `Their account is reactivated today and takes a seat, exactly like a new hire. Their joining date ` +
        `becomes ${todayIso()}, because a break in service restarts the five-year continuous-service clock ` +
        `gratuity is measured against; the earlier period stays on their exit record.`,
      label: 'Bring them back',
      tone: 'default',
    };
  })();

  const handleConfirm = () => {
    if (!pendingConfirm) return;

    {
      rejoinMutation.mutate({
        exitId: pendingConfirm.exitId,
        joiningDate: todayIso(),
        name: pendingConfirm.user?.name || 'They',
      });
    }

    setPendingConfirm(null);
  };

  const handleOpenSettings = (targetUser: any) => {
    setSettingsUserId(targetUser.id);
    setSettingsDraft(resolveEmployeeSettings(targetUser));
    setFeedback(null);
  };

  const handleCloseSettings = () => {
    setSettingsUserId(null);
    setSettingsDraft(null);
  };

  const handleSaveSettings = () => {
    if (!settingsTargetUser || !settingsDraft) {
      return;
    }

    updateSettingsMutation.mutate({
      targetUser: settingsTargetUser,
      draft: settingsDraft,
    });
  };

  if (isLoading) {
    return <PageLoadingState label={`Loading ${pageTitle.title.toLowerCase()}...`} />;
  }

  if (isError) {
    return (
      <PageErrorState
        message={
          (usersQuery.error as any)?.response?.data?.message ||
          (groupsQuery.error as any)?.response?.data?.message ||
          (membersQuery.error as any)?.response?.data?.message ||
          (invitationsQuery.error as any)?.response?.data?.message ||
          'Failed to load employee management data.'
        }
        onRetry={() => {
          void usersQuery.refetch();
          void groupsQuery.refetch();
          void membersQuery.refetch();
        }}
      />
    );
  }

  return (
    // No background of its own: the shell already paints #F5F7F8, and this was
    // painting #f5f7fb over it — a near-miss shade that showed as a seam.
    <div className="w-full space-y-5 pb-8 text-slate-900">
      {mode !== 'teams' && (
      <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          {/*
            Eyebrow above the title, matching PageHeader.

            This block duplicates PageHeader rather than using it, so it kept
            the old order after that component was fixed: the eyebrow rendered
            BELOW the h1 at almost the same weight and colour, and on this page
            the two said the same thing - "Employee Management" under
            "Employees".
          */}
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{pageTitle.eyebrow}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">{pageTitle.title}</h1>
          <p className="mt-1 max-w-4xl text-xs text-slate-500">{pageTitle.description}</p>
        </div>
        {/* Add Employee and Export CSV live in the roster toolbar for this mode,
            beside the search and filters they act on — repeating them up here
            rendered each button twice on the page. */}
      </header>
      )}

      {feedback ? <FeedbackBanner tone={feedback.tone} message={feedback.message} /> : null}

      {mode === 'employees' && (
        <>
          <EmployeeRoster
            // Active people only: the Everyone pill counts what Everyone shows.
            users={activeUsers}
            rows={employeeDirectoryRows}
            segment={directorySegment}
            setSegment={setDirectorySegment}
            query={directoryQuery}
            setQuery={setDirectoryQuery}
            departmentOptions={departmentOptions}
            departmentFilter={directoryDepartmentFilter}
            setDepartmentFilter={setDirectoryDepartmentFilter}
            timezoneOptions={timezoneOptions}
            timezoneFilter={directoryTimezoneFilter}
            setTimezoneFilter={setDirectoryTimezoneFilter}
            sort={directorySort}
            setSort={setDirectorySort}
            workingCount={workingNowCount}
            incompleteCount={incompleteProfileCount}
            formerCount={formerEmployeeCount}
            canManage={isStrictAdmin}
            isExporting={isExporting}
            resolveExit={(row: RosterUser) => exitByUserId.get(Number(row.id)) ?? null}
            /*
             * Only offered when the EMPLOYER recorded 'eligible'. 'undecided' is
             * the default on every exit and the server does accept it, but a
             * rehire nobody has decided on is a conversation to have in Exits
             * first — and 'not_eligible' would be a button that always 422s.
             * Returns null for everyone else so the memoised rows keep their
             * identity instead of re-rendering on every keystroke.
             */
            rehireSlot={(row: RosterUser) => {
              if (!isStrictAdmin || row.is_active !== false) return null;
              const exit = exitByUserId.get(Number(row.id));
              if (!exit || exit.rehireEligibility !== 'eligible') return null;

              return (
                <button
                  type="button"
                  onClick={() => handleRejoin(row)}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-blue-800 transition hover:bg-blue-50"
                >
                  <UserPlus className="h-3.5 w-3.5" /> Bring back
                </button>
              );
            }}
            resolveCode={(row: any) => employeeCodeOf(row) || String(row.id)}
            resolveRole={(row: any) => resolveUserRoleLabel(row, customRolesQuery.data || [])}
            resolveDepartment={(row: any) => resolveEmployeeDepartment(row)}
            resolveTimezone={(row: any) => resolveEmployeeTimezone(row)}
            resolveHref={(row: any) => `/employees/${employeeCodeOf(row) || row.id}`}
            isIncomplete={(row: any) => hasIncompleteProfile(row, incompleteFilterType)}
            onOpenSettings={(row: any) => handleOpenSettings(row)}
            onExport={() => void handleExportCsv()}
            bulk={{
              departments: groups.map((group: any) => ({ id: Number(group.id), name: group.name })),
              roles: (customRolesQuery.data || []).map((role: any) => ({ id: role.id, name: role.name })),
              canMoveDepartment: canManageDepartments,
              canAssignRole: isStrictAdmin,
              isBusy: isBulkRunning,
              onAddToDepartment: handleBulkAddToDepartment,
              onAssignRole: handleBulkAssignRole,
              onExportSelected: handleExportSelected,
            }}
            addEmployeeSlot={isStrictAdmin ? (
              <Link
                to="/add-user"
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white transition hover:bg-blue-700"
              >
                <UserPlus className="h-4 w-4" /> Add employee
              </Link>
            ) : null}
          />

          {confirmCopy ? (
            <ConfirmDialog
              isOpen
              title={confirmCopy.title}
              message={confirmCopy.message}
              confirmLabel={confirmCopy.label}
              tone={confirmCopy.tone}
              isLoading={rejoinMutation.isPending || isBulkRunning}
              onConfirm={handleConfirm}
              onClose={() => setPendingConfirm(null)}
            />
          ) : null}

          <SlideOver
            open={Boolean(settingsTargetUser && settingsDraft)}
            title={settingsTargetUser?.name ?? ''}
            subtitle={[resolveUserRoleLabel(settingsTargetUser, customRolesQuery.data || []), settingsTargetUser?.email].filter(Boolean).join(' · ')}
            onClose={handleCloseSettings}
            footer={(
              <>
                <Button variant="secondary" size="sm" onClick={handleCloseSettings} disabled={updateSettingsMutation.isPending}>
                  Cancel
                </Button>
                <Button size="sm" onClick={handleSaveSettings} loading={updateSettingsMutation.isPending}>
                  Save settings
                </Button>
              </>
            )}
          >
            {settingsDraft ? (
              <div className="space-y-4">
                <SettingsCard
                  title="Screenshot capture"
                  description={`How often the desktop tracker takes a screenshot. A change takes effect after ${settingsFirstName} refreshes or signs in again.`}
                >
                  <FieldLabel htmlFor={monitoringIntervalId}>Capture interval</FieldLabel>
                  <SelectInput
                    id={monitoringIntervalId}
                    value={settingsDraft.monitoringInterval ?? ''}
                    onChange={(event) => setSettingsDraft((current) => current ? {
                      ...current,
                      monitoringInterval: event.target.value === ''
                        ? null
                        : Number(event.target.value) as MonitoringInterval,
                    } : current)}
                  >
                    <option value="">
                      {`Inherit from organization (every ${settingsTargetUser?.effective_monitoring_interval_minutes ?? 10} minutes)`}
                    </option>
                    {monitoringIntervalOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </SelectInput>
                </SettingsCard>

                <SettingsCard
                  title="Access"
                  description={`What ${settingsFirstName} can reach in ${brandLabel}.`}
                  aside={(
                    <span className="rounded-full border border-slate-200 bg-surface-sunken px-2.5 py-1 text-xs font-semibold text-slate-600">
                      {settingsGrantedCount} of 4 on
                    </span>
                  )}
                >
                  <SettingRow
                    icon={Clock}
                    title="Time edits"
                    description="Raise time edit and overtime correction requests."
                    control={(
                      <ToggleInput
                        checked={settingsDraft.canEditTime}
                        onChange={(checked) => setSettingsDraft((current) => current ? ({ ...current, canEditTime: checked }) : current)}
                      />
                    )}
                  />
                  <SettingRow
                    icon={CalendarCheck}
                    title="Attendance overview"
                    description="See the attendance overview and its workflows."
                    control={(
                      <ToggleInput
                        checked={settingsDraft.attendanceMonitoring}
                        onChange={(checked) => setSettingsDraft((current) => current ? ({ ...current, attendanceMonitoring: checked }) : current)}
                      />
                    )}
                  />
                  <SettingRow
                    icon={Wallet}
                    title="Payroll and reporting"
                    description={settingsPayrollLocked
                      ? 'Employees do not receive payroll reporting access. Change the role to grant it.'
                      : 'Open payroll figures and the reporting screens.'}
                    control={(
                      <>
                        {settingsPayrollLocked ? (
                          <span className="text-xs font-semibold text-slate-500">Locked</span>
                        ) : null}
                        <ToggleInput
                          checked={settingsDraft.payrollVisibility}
                          disabled={settingsPayrollLocked}
                          onChange={(checked) => setSettingsDraft((current) => current ? ({ ...current, payrollVisibility: checked }) : current)}
                        />
                      </>
                    )}
                  />
                  <SettingRow
                    icon={ListChecks}
                    title="Task assignment"
                    description="Assign tasks to other people by default."
                    control={(
                      <ToggleInput
                        checked={settingsDraft.taskAssignmentAccess}
                        onChange={(checked) => setSettingsDraft((current) => current ? ({ ...current, taskAssignmentAccess: checked }) : current)}
                      />
                    )}
                  />
                </SettingsCard>
              </div>
            ) : null}
          </SlideOver>
        </>
      )}

      {mode === 'teams' && (
        <DepartmentWorkspace
          groups={groups}
          users={users}
          customRoles={customRolesQuery.data || []}
          currentUserLevel={currentUserLevel}
          getHierarchyLevel={getHierarchyLevel}
          canManageDepartments={canManageDepartments}
          canCreateGroups={canCreateGroups}
          teamInsights={teamInsights}
          groupDirectoryQuery={groupDirectoryQuery}
          setGroupDirectoryQuery={setGroupDirectoryQuery}
          memberDrafts={memberDrafts}
          setMemberDrafts={setMemberDrafts}
          selectedTeamId={selectedTeamId}
          setSelectedTeamId={setSelectedTeamId}
          showGroupModal={showGroupModal}
          setShowGroupModal={setShowGroupModal}
          feedback={feedback}
          setFeedback={setFeedback}
          syncMembershipMutation={syncMembershipMutation}
          handleAddMemberToGroup={handleAddMemberToGroup}
          handleRemoveEmployeeFromGroup={handleRemoveEmployeeFromGroup}
          handleDeleteGroup={handleDeleteGroup}
        />
      )}

      {mode === 'invitations' && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.95fr_1.05fr]">
          {/*
            This used to be a second invite form.
            It sent only an email and a role, so anyone invited from here got no
            joining date and their onboarding checklist anchored on whenever
            they happened to click the link — the pre-boarding items, which sit
            at day -14, were always scheduled in the past. Rather than duplicate
            the fields, this now points at the one invite flow that has them.
          */}
          <SurfaceCard className="p-5">
            <h2 className="text-lg font-semibold text-slate-950">Invite someone</h2>
            <p className="mt-1 text-sm text-slate-500">
              Invitations carry a joining date, job title and departments, so onboarding is scheduled
              against their real start date rather than the day they accept.
            </p>
            {allowedRoles.length === 0 ? (
              <div className="mt-4">
                <PageEmptyState title="Invite permissions unavailable" description="Your current role does not allow sending workspace invitations." />
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                <div className="space-y-2 text-sm text-slate-600">
                  <p><span className="font-medium text-slate-900">Invite by email</span> — several people at once.</p>
                  <p><span className="font-medium text-slate-900">Invite by link</span> — one secure URL you share yourself.</p>
                  <p><span className="font-medium text-slate-900">Add by CSV</span> — bulk import, previewed before anything sends.</p>
                  <p><span className="font-medium text-slate-900">Create user</span> — set their password and skip the invite entirely.</p>
                </div>
                <Link
                  to="/add-user?tab=email"
                  className="inline-flex h-10 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white transition hover:bg-blue-700"
                >
                  <MailPlus className="h-4 w-4" />
                  Go to Add User
                </Link>
              </div>
            )}
          </SurfaceCard>

          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <MetricCard label="Active Members" value={members.length} hint="Loaded from organization members" icon={Users} accent="sky" />
              <MetricCard label="Pending Invites" value={invitations.filter((item: any) => item.status === 'pending').length} hint="Tracked from the invitation system" icon={MailPlus} accent="amber" />
            </div>
            <DataTable
              scrollBody
              title="Pending Invitations"
              description="Secure invites waiting to be accepted."
              rows={invitations}
              emptyMessage="No invitations found."
              columns={[
                { key: 'email', header: 'Email', render: (row: any) => row.email },
                { key: 'role', header: 'Role', render: (row: any) => row.role ? row.role.charAt(0).toUpperCase() + row.role.slice(1) : 'Employee' },
                { key: 'status', header: 'Status', render: (row: any) => row.status },
                {
                  // Whether the mail actually went out is the first thing an
                  // admin wants before deciding to resend — a created
                  // invitation whose delivery failed used to look identical to
                  // one sitting in someone's inbox.
                  key: 'sent',
                  header: 'Sent',
                  render: (row: any) => row.delivery_method === 'link'
                    ? 'Link — shared manually'
                    : row.email_sent_at
                      ? formatDateTime(row.email_sent_at, viewerTimezone)
                      : 'Not sent yet',
                },
                {
                  key: 'invited_by',
                  header: 'Invited by',
                  render: (row: any) => row.invited_by?.name || '—',
                },
                { key: 'expires_at', header: 'Expires', render: (row: any) => row.expires_at ? formatDateTime(row.expires_at, viewerTimezone) : 'n/a' },
                {
                  key: 'actions',
                  header: 'Actions',
                  render: (row: any) => {
                    if (!row.can_resend && !row.can_revoke) {
                      return <span className="text-slate-500">—</span>;
                    }

                    const isBusy = (resendInviteMutation.isPending && resendInviteMutation.variables === row.id)
                      || (revokeInviteMutation.isPending && revokeInviteMutation.variables === row.id);

                    return (
                      <div className="flex items-center gap-2">
                        {row.can_resend && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => resendInviteMutation.mutate(row.id)}
                            className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                          >
                            {copiedInviteId === row.id
                              ? 'Link copied'
                              : row.delivery_method === 'link' ? 'New link' : 'Resend'}
                          </button>
                        )}
                        {row.can_revoke && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => revokeInviteMutation.mutate(row.id)}
                            className="rounded-md border border-rose-200 px-2.5 py-1 text-xs font-medium text-rose-600 transition hover:bg-rose-50 disabled:opacity-50"
                          >
                            Revoke
                          </button>
                        )}
                      </div>
                    );
                  },
                },
              ]}
            />
            <DataTable
              scrollBody
              title="Current Members"
              description="Active organization members available from the current backend."
              rows={members}
              emptyMessage="No members found."
              columns={[
                { key: 'name', header: 'Name', render: (row: any) => row.name },
                { key: 'email', header: 'Email', render: (row: any) => row.email },
                { key: 'role', header: 'Role', render: (row: any) => resolveUserRoleLabel(row, customRolesQuery.data || []) },
                { key: 'status', header: 'Status', render: (row: any) => (row.is_active ? 'Active' : 'Inactive') },
              ]}
            />
          </div>
        </div>
      )}

      {mode === 'roles' && (
        <RoleAssignmentBoard
          users={users}
          roles={(customRolesQuery.data || []) as any[]}
          currentUserId={Number(user.id)}
          canAssign={isStrictAdmin}
          isPending={updateRoleMutation.isPending}
          query={roleSearchQuery}
          setQuery={setRoleSearchQuery}
          departmentOf={(target: any) => resolveEmployeeDepartment(target)}
          onAssign={(userIds, target, roleName) => {
            userIds.forEach((userId) => updateRoleMutation.mutate({ userId, ...target }));
            setFeedback({
              tone: 'success',
              message: `Assigning ${roleName} to ${userIds.length} ${userIds.length === 1 ? 'person' : 'people'}…`,
            });
          }}
          onManageDefinitions={() => navigate('/settings/roles')}
        />
      )}

      <QuickCreateGroupDialog
        open={showGroupModal}
        onClose={() => setShowGroupModal(false)}
        onCreated={async () => {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['employee-workspace-groups'] }),
            queryClient.invalidateQueries({ queryKey: ['employee-workspace-users'] }),
          ]);
        }}
        title="Create Department"
        eyebrow="Department quick add"
        description="Add a department and manage members from the directory below."
      />

    </div>
  );
}
