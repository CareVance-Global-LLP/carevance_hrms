import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { invitationApi, organizationApi, reportGroupApi, roleApi, userApi } from '@/services/api';
import QuickCreateGroupDialog from '@/components/groups/QuickCreateGroupDialog';
import Button from '@/components/ui/Button';
import EmployeeSelect from '@/components/ui/EmployeeSelect';
import { FeedbackBanner, PageEmptyState, PageErrorState, PageLoadingState } from '@/components/ui/PageState';
import { FieldLabel, SelectInput, TextInput, ToggleInput } from '@/components/ui/FormField';
import { useAuth } from '@/contexts/AuthContext';
import { getAssignableRoles, hasAdminAccess, hasStrictAdminAccess, resolveUserRoleLabel } from '@/lib/permissions';
import { formatDuration } from '@/lib/formatters';
import { ArrowRightLeft, Building2, KeyRound, MailPlus, Search, ShieldCheck, SlidersHorizontal, Trash2, UserPlus, UserPlus2, UserRound, Users } from 'lucide-react';
import { resolveTimeZone, DEFAULT_APP_TIMEZONE } from '@/lib/timezones';
import { formatDateTime } from '@/lib/dateTime';

type EmployeeWorkspaceMode = 'employees' | 'teams' | 'invitations' | 'roles';
type EmployeeDirectorySort = 'default' | 'name_asc' | 'tracked_desc' | 'working_first';

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
}: {
  title: string;
  description?: string;
  rows: T[];
  columns: TableColumn<T>[];
  emptyMessage: string;
  headerAction?: ReactNode;
  bodyClassName?: string;
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
      <div className={`overflow-x-auto ${bodyClassName}`.trim()}>
        <table className="min-w-full text-left text-xs">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
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

const piePalette = ['#2563eb', '#0ea5e9', '#14b8a6', '#22c55e', '#eab308', '#f97316', '#ef4444', '#8b5cf6'];

const polarToCartesian = (cx: number, cy: number, radius: number, angleInDegrees: number) => {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(angleInRadians),
    y: cy + radius * Math.sin(angleInRadians),
  };
};

const describeArc = (cx: number, cy: number, radius: number, startAngle: number, endAngle: number) => {
  const start = polarToCartesian(cx, cy, radius, endAngle);
  const end = polarToCartesian(cx, cy, radius, startAngle);
  const angleDelta = Math.min(359.999, Math.max(0.001, endAngle - startAngle));
  const largeArcFlag = angleDelta <= 180 ? '0' : '1';

  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y} Z`;
};

const monitoringIntervalOptions = [
  { value: 1, label: 'Every 1 minute' },
  { value: 3, label: 'Every 3 minutes' },
  { value: 5, label: 'Every 5 minutes' },
  { value: 10, label: 'Every 10 minutes' },
  { value: 15, label: 'Every 15 minutes' },
  { value: 30, label: 'Every 30 minutes' },
] as const;

type MonitoringInterval = typeof monitoringIntervalOptions[number]['value'];

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
  const interval = Number(settings.monitoring_interval_minutes || 10);

  return {
    monitoringInterval: allowedMonitoringIntervals.includes(interval as MonitoringInterval)
      ? interval as MonitoringInterval
      : 10,
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
    description: 'Employee directory with work status, tracked time, and role management controls.',
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
  const queryClient = useQueryClient();
  const viewerTimezone = (user?.settings as any)?.timezone || DEFAULT_APP_TIMEZONE;
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [directoryFilterUserId, setDirectoryFilterUserId] = useState<number | ''>('');
  const [directoryDepartmentFilter, setDirectoryDepartmentFilter] = useState('All departments');
  const [directoryTimezoneFilter, setDirectoryTimezoneFilter] = useState('All timezones');
  const [directorySort, setDirectorySort] = useState<EmployeeDirectorySort>('default');
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [groupDirectoryQuery, setGroupDirectoryQuery] = useState('');
  const [groupDirectoryFilter, setGroupDirectoryFilter] = useState('all');
  const [memberDrafts, setMemberDrafts] = useState<Record<number, string>>({});
  const [memberMoveDrafts, setMemberMoveDrafts] = useState<Record<string, string>>({});
  const [deletingGroupId, setDeletingGroupId] = useState<number | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'manager' | 'employee'>('employee');
  const [roleSearchQuery, setRoleSearchQuery] = useState('');
  const [settingsUserId, setSettingsUserId] = useState<number | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<EmployeeSettingsDraft | null>(null);
  const [activeTeamId, setActiveTeamId] = useState<number | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const settingsPanelRef = useRef<HTMLDivElement | null>(null);
  const teamDetailRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const pendingSettingsScrollUserIdRef = useRef<number | null>(null);
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
    if (nextDepartment) {
      setDirectoryDepartmentFilter(nextDepartment);
      return;
    }

    if (currentUserLevel > 50 && managerManagedDepartment) {
      setDirectoryDepartmentFilter(managerManagedDepartment);
    }
  }, [location.search, mode, currentUserLevel, managerManagedDepartment]);

  useEffect(() => {
    if (allowedRoles.length === 0) {
      return;
    }

    if (!allowedRoles.includes(inviteRole)) {
      setInviteRole(allowedRoles[0]);
    }
  }, [allowedRoles, inviteRole]);

  useEffect(() => {
    if (
      !settingsTargetUser?.id ||
      !settingsDraft ||
      pendingSettingsScrollUserIdRef.current !== settingsTargetUser.id
    ) {
      return;
    }

    let nextFrameId: number | null = null;
    const frameId = window.requestAnimationFrame(() => {
      nextFrameId = window.requestAnimationFrame(() => {
        settingsPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        pendingSettingsScrollUserIdRef.current = null;
      });
    });

    return () => {
      window.cancelAnimationFrame(frameId);
      if (nextFrameId !== null) {
        window.cancelAnimationFrame(nextFrameId);
      }
    };
  }, [settingsDraft, settingsTargetUser?.id]);

  const inviteMutation = useMutation({
    mutationFn: async () => {
      if (!organization?.id) {
        throw new Error('Organization context unavailable.');
      }

      await invitationApi.create({
        email: inviteEmail.trim(),
        role: inviteRole,
        delivery: 'email',
      });
    },
    onSuccess: async () => {
      setInviteEmail('');
      setInviteRole('employee');
      setFeedback({ tone: 'success', message: 'Invitation sent successfully.' });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['employee-workspace-invitations'] }),
        queryClient.invalidateQueries({ queryKey: ['employee-workspace-members', organization?.id] }),
      ]);
    },
    onError: (error: any) => {
      setFeedback({ tone: 'error', message: error?.response?.data?.message || error?.message || 'Failed to send invitation.' });
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

  const deleteUserMutation = useMutation({
    mutationFn: async ({ userId }: { userId: number }) => {
      await userApi.delete(userId);
    },
    onSuccess: async (_data, variables) => {
      const remainingUsers = users.filter((item: any) => item.id !== variables.userId);
      setSelectedUserId(remainingUsers[0]?.id || null);
      setFeedback({ tone: 'success', message: 'Employee removed successfully.' });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['employee-workspace-users'] }),
        queryClient.invalidateQueries({ queryKey: ['employee-workspace-members', organization?.id] }),
      ]);
    },
    onError: (error: any) => {
      setFeedback({ tone: 'error', message: error?.response?.data?.message || 'Failed to remove employee.' });
    },
  });

  const isLoading = usersQuery.isLoading || groupsQuery.isLoading || membersQuery.isLoading || invitationsQuery.isLoading;
  const isError = usersQuery.isError || groupsQuery.isError || membersQuery.isError || invitationsQuery.isError;
  const pageTitle = modeCopy[mode];
  const employeeDirectoryRows = useMemo(() => {
    const filteredRows = directoryFilterUserId === ''
      ? [...users]
      : users.filter((item: any) => Number(item.id) === Number(directoryFilterUserId));

    const departmentFilteredRows = directoryDepartmentFilter === 'All departments'
      ? filteredRows
      : filteredRows.filter((item: any) => resolveEmployeeDepartment(item) === directoryDepartmentFilter);

    const timezoneFilteredRows = directoryTimezoneFilter === 'All timezones'
      ? departmentFilteredRows
      : departmentFilteredRows.filter((item: any) => resolveEmployeeTimezone(item) === directoryTimezoneFilter);

    switch (directorySort) {
      case 'name_asc':
        return timezoneFilteredRows.sort((left: any, right: any) =>
          String(left.name || '').localeCompare(String(right.name || ''), undefined, { sensitivity: 'base' })
        );
      case 'tracked_desc':
        return timezoneFilteredRows.sort((left: any, right: any) =>
          Number(right.total_elapsed_duration || right.total_duration || 0) - Number(left.total_elapsed_duration || left.total_duration || 0)
        );
      case 'working_first':
        return timezoneFilteredRows.sort((left: any, right: any) => {
          const workingDifference = Number(Boolean(right.is_working)) - Number(Boolean(left.is_working));
          if (workingDifference !== 0) {
            return workingDifference;
          }

          return String(left.name || '').localeCompare(String(right.name || ''), undefined, { sensitivity: 'base' });
        });
      default:
        return timezoneFilteredRows;
    }
  }, [directoryDepartmentFilter, directoryFilterUserId, directoryTimezoneFilter, directorySort, users]);
  const roleCards = useMemo(() => {
    const allRoles = [...(customRolesQuery.data || [])].sort((a: any, b: any) => a.hierarchy_level - b.hierarchy_level);
    return allRoles.map((role: any, idx: number) => {
      const count = role.is_system
        ? users.filter((u: any) => u.role_id === role.id || (!u.role_id && u.role === role.slug)).length
        : users.filter((u: any) => u.role_id === role.id).length;
      const isLast = idx === allRoles.length - 1;
      const isFirst = idx === 0;
      return {
        key: `role-card-${role.id}`,
        label: role.name,
        value: count,
        hint: role.is_system ? `System role \u2022 Level ${role.hierarchy_level}` : `Custom role \u2022 Level ${role.hierarchy_level}`,
        icon: isFirst ? ShieldCheck : isLast ? Users : KeyRound,
        accent: isFirst ? 'sky' as const : isLast ? 'violet' as const : 'amber' as const,
      };
    });
  }, [customRolesQuery.data, users]);

  const filteredRoleUsers = useMemo(() => {
    const normalizedQuery = roleSearchQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return users;
    }

    return users.filter((item: any) => {
      const roleLabel = resolveUserRoleLabel(item, customRolesQuery.data || []);
      return [item.name, item.email, item.role, roleLabel, resolveEmployeeDepartment(item)]
        .some((value) => String(value || '').toLowerCase().includes(normalizedQuery));
    });
  }, [roleSearchQuery, users, customRolesQuery.data]);

  const canCreateGroups = currentUserLevel <= 10;
  const canManageDepartments = currentUserLevel <= 50;
  const internalUsers = useMemo(
    () => users.filter((member: any) => member.role !== 'client'),
    [users]
  );
  const hasDirectorySearch = groupDirectoryQuery.trim().length > 0;
  const hasDirectorySelection = groupDirectoryFilter !== 'all';
  const shouldShowDirectoryResults = hasDirectorySearch || hasDirectorySelection;
  const filteredDirectoryGroups = useMemo(() => {
    if (!shouldShowDirectoryResults) {
      return [];
    }

    const needle = groupDirectoryQuery.trim().toLowerCase();

    return groups.filter((group: any) => {
      const matchesSelectedGroup = groupDirectoryFilter === 'all' || String(group.id) === groupDirectoryFilter;
      if (!matchesSelectedGroup) return false;

      if (!needle) return true;

      const searchable = [group.name, group.description]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return searchable.includes(needle);
    });
  }, [groupDirectoryFilter, groupDirectoryQuery, groups, shouldShowDirectoryResults]);

  const findUserById = (userId: number) => users.find((candidate: any) => Number(candidate.id) === Number(userId));
  const canManageGroupMember = (member: any) => {
    const memberLevel = getHierarchyLevel(member);
    return memberLevel >= 100 || (memberLevel <= 50 && currentUserLevel <= 10);
  };
  const isEligibleForDirectGroupAdd = (member: any) => canManageGroupMember(member) && (member.groups || []).length === 0;

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

  const handleMoveEmployeeToGroup = (member: any, currentGroup: any) => {
    const draftKey = `${currentGroup.id}:${member.id}`;
    const selectedTargetId = Number(memberMoveDrafts[draftKey] || 0);
    if (!selectedTargetId || selectedTargetId === currentGroup.id) {
      setFeedback({ tone: 'error', message: 'Choose a different department before moving this employee.' });
      return;
    }

    const targetGroup = groups.find((group: any) => Number(group.id) === selectedTargetId);
    if (!targetGroup) {
      setFeedback({ tone: 'error', message: 'Selected destination department could not be found.' });
      return;
    }

    syncMembershipMutation.mutate({
      userId: member.id,
      groupIds: [targetGroup.id],
      successMessage: `${member.name} was moved to ${targetGroup.name}.`,
    });
    setMemberMoveDrafts((current) => ({ ...current, [draftKey]: '' }));
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

      // Find lead: highest rank (lowest hierarchy_level)
      const sortedByRank = [...enrichedUsers].sort((a, b) => a.level - b.level);
      const lead = sortedByRank[0] ?? null;
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
        color: piePalette[index % piePalette.length],
      };
    });
  }, [groups, customRolesQuery.data]);

  const totalDepartmentEmployees = useMemo(
    () => teamInsights.reduce((sum, team) => sum + team.employeeCount, 0),
    [teamInsights]
  );
  const managedDepartmentsCount = useMemo(
    () => teamInsights.filter((team) => team.managerName !== 'Not assigned').length,
    [teamInsights]
  );
  const avgEmployeesPerDepartment = useMemo(
    () => teamInsights.length ? (totalDepartmentEmployees / teamInsights.length).toFixed(1) : '0.0',
    [teamInsights, totalDepartmentEmployees]
  );

  const pieSegments = useMemo(() => {
    const values = teamInsights.map((team) => team.membersCount);
    const total = values.reduce((sum, value) => sum + value, 0);
    if (total <= 0) {
      return teamInsights.map((team) => ({
        ...team,
        startAngle: 0,
        endAngle: 0,
        percentage: 0,
      }));
    }

    let currentAngle = 0;
    return teamInsights.map((team, index) => {
      const value = values[index];
      const sweep = (value / total) * 360;
      const startAngle = currentAngle;
      const endAngle = startAngle + sweep;
      currentAngle = endAngle;

      return {
        ...team,
        startAngle,
        endAngle,
        percentage: Math.round((value / total) * 100),
      };
    });
  }, [teamInsights]);

  const highlightedTeamId = activeTeamId ?? selectedTeamId ?? pieSegments[0]?.id ?? null;
  const highlightedTeam = pieSegments.find((team) => team.id === highlightedTeamId) || null;

  const scrollToTeamDetail = (teamId: number) => {
    setSelectedTeamId(teamId);
    const element = teamDetailRefs.current[teamId];
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  useEffect(() => {
    if (mode !== 'teams' || selectedTeamId === null) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      const element = teamDetailRefs.current[selectedTeamId];
      element?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [mode, selectedTeamId]);

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

  const getRoleDropdownOptions = (row: any): Array<{ value: string; label: string; isCustom: boolean; roleId?: number }> => {
    const currentRole = row?.role as string;
    const currentRoleId = row?.role_id as number | null;
    const customRoles = customRolesQuery.data || [];
    const options: Array<{ value: string; label: string; isCustom: boolean; roleId?: number }> = [];

    if (currentUserLevel <= 10) {
      if (Number(row?.id) === Number(user.id)) {
        if (currentRoleId) {
          const cr = customRoles.find((r: any) => r.id === currentRoleId);
          options.push({ value: `custom_${currentRoleId}`, label: cr?.name || 'Custom Role', isCustom: true, roleId: currentRoleId });
        } else {
          options.push({ value: currentRole, label: currentRole.charAt(0).toUpperCase() + currentRole.slice(1), isCustom: false });
        }
        return options;
      }

      options.push(
        { value: 'admin', label: 'Admin', isCustom: false },
        { value: 'manager', label: 'Manager', isCustom: false },
        { value: 'employee', label: 'Employee', isCustom: false },
      );

      for (const cr of customRoles) {
        if (!cr.is_system) {
          options.push({ value: `custom_${cr.id}`, label: cr.name, isCustom: true, roleId: cr.id });
        }
      }

      return options;
    }

    if (currentUserLevel <= 50) {
      const val = currentRoleId ? `custom_${currentRoleId}` : currentRole;
      const label = currentRoleId
        ? (customRoles.find((r: any) => r.id === currentRoleId)?.name || 'Custom Role')
        : (currentRole.charAt(0).toUpperCase() + currentRole.slice(1));
      options.push({ value: val, label, isCustom: !!currentRoleId, roleId: currentRoleId || undefined });
      return options;
    }

    const val = currentRoleId ? `custom_${currentRoleId}` : currentRole;
    const label = currentRoleId
      ? (customRoles.find((r: any) => r.id === currentRoleId)?.name || 'Custom Role')
      : (currentRole.charAt(0).toUpperCase() + currentRole.slice(1));
    options.push({ value: val, label, isCustom: !!currentRoleId, roleId: currentRoleId || undefined });
    return options;
  };

  const handleDeleteUser = (targetUser: any) => {
    if (!isStrictAdmin || !targetUser?.id) {
      return;
    }

    const targetName = targetUser.name || 'this employee';
    if (!confirm(`Remove ${targetName} from this workspace? This will delete the employee account.`)) {
      return;
    }

    deleteUserMutation.mutate({ userId: targetUser.id });
  };

  const handleOpenSettings = (targetUser: any) => {
    pendingSettingsScrollUserIdRef.current = targetUser.id;
    setSettingsUserId(targetUser.id);
    setSettingsDraft(resolveEmployeeSettings(targetUser));
    setFeedback(null);
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
    <div className="w-full space-y-5 bg-[#f5f7fb] pb-8 text-slate-900">
      <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950">{pageTitle.title}</h1>
          <p className="mt-3 text-sm font-medium text-slate-900">{pageTitle.eyebrow}</p>
          <p className="mt-1 max-w-4xl text-xs text-slate-500">{pageTitle.description}</p>
        </div>
        {mode === 'employees' && isStrictAdmin ? (
          <Link to="/add-user" className="inline-flex h-10 shrink-0 items-center gap-2 self-start rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/80 md:mr-6 md:mt-3">
            <UserPlus className="h-4 w-4" />
            Add Employee
          </Link>
        ) : mode === 'teams' && canCreateGroups ? (
          <Button variant="secondary" iconLeft={<Building2 className="h-4 w-4" />} onClick={() => setShowGroupModal(true)}>
            Add Department
          </Button>
        ) : null}
      </header>

      {feedback ? <FeedbackBanner tone={feedback.tone} message={feedback.message} /> : null}

      {mode === 'employees' && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Employees" value={users.length} hint="Current organization users" icon={Users} accent="sky" />
            <MetricCard label="Working Now" value={users.filter((user: any) => user.is_working).length} hint="Active timers right now" icon={ShieldCheck} accent="emerald" />
            <MetricCard label="Managers / Admins" value={users.filter((u: any) => getHierarchyLevel(u) < 100).length} hint="Elevated roles" icon={KeyRound} accent="violet" />
            <MetricCard label="Tracked Time" value={formatDuration(users.reduce((sum: number, user: any) => sum + Number(user.total_elapsed_duration || user.total_duration || 0), 0))} hint="Visible across users" icon={Users} accent="amber" />
          </div>

          <DataTable
            title="Employee Directory"
            description={canManageDirectoryRoles ? 'Role, department, work state, tracked hours, and promotion controls from the existing users endpoint.' : 'Role, department, work state, and tracked hours from the existing users endpoint.'}
            rows={employeeDirectoryRows}
            emptyMessage="No employees found."
            bodyClassName="max-h-[34rem] overflow-auto"
            headerAction={(
              <div className="grid grid-cols-1 gap-2 lg:grid-cols-4">
                <div className="min-w-[13rem]">
                  <FieldLabel>Specific employee</FieldLabel>
                  <EmployeeSelect
                    employees={users}
                    ariaLabel="Specific employee filter"
                    value={directoryFilterUserId}
                    onChange={(nextValue) => {
                      setDirectoryFilterUserId(nextValue);
                      if (typeof nextValue === 'number') {
                        setSelectedUserId(nextValue);
                      }
                    }}
                    includeAllOption
                    allOptionLabel="All employees"
                    searchPlaceholder="Search employee name"
                  />
                </div>
                <div className="min-w-[13rem]">
                  <FieldLabel>Department</FieldLabel>
                  <SelectInput
                    aria-label="Employee department filter"
                    value={directoryDepartmentFilter}
                    onChange={(event) => setDirectoryDepartmentFilter(event.target.value)}
                  >
                    {departmentOptions.map((department) => (
                      <option key={department} value={department}>
                        {department}
                      </option>
                    ))}
                  </SelectInput>
                </div>
                <div className="min-w-[13rem]">
                  <FieldLabel>Timezone</FieldLabel>
                  <SelectInput
                    aria-label="Employee timezone filter"
                    value={directoryTimezoneFilter}
                    onChange={(event) => setDirectoryTimezoneFilter(event.target.value)}
                  >
                    {timezoneOptions.map((tz) => (
                      <option key={tz} value={tz}>{tz}</option>
                    ))}
                  </SelectInput>
                </div>
                <div className="min-w-[13rem]">
                  <FieldLabel>Sort list</FieldLabel>
                  <SelectInput
                    aria-label="Employee directory sort"
                    value={directorySort}
                    onChange={(event) => setDirectorySort(event.target.value as EmployeeDirectorySort)}
                  >
                    <option value="default">Default order</option>
                    <option value="name_asc">Name A-Z</option>
                    <option value="tracked_desc">Tracked time high to low</option>
                    <option value="working_first">Working first</option>
                  </SelectInput>
                </div>
              </div>
            )}
            columns={[
              { key: 'employee', header: 'Employee', render: (row: any) => <div><Link to={`/employees/${row.id}`} className="font-medium text-slate-950 hover:text-sky-700">{row.name}</Link><p className="text-xs text-slate-500">{row.email}</p></div> },
              { key: 'role', header: 'Role', render: (row: any) => resolveUserRoleLabel(row, customRolesQuery.data || []) },
              { key: 'department', header: 'Department', render: (row: any) => resolveEmployeeDepartment(row) },
              { key: 'timezone', header: 'Timezone', render: (row: any) => resolveEmployeeTimezone(row) },
              { key: 'working', header: 'Working', render: (row: any) => (row.is_working ? 'Yes' : 'No') },
              { key: 'project', header: 'Current Task', render: (row: any) => row.current_task || row.current_project || 'No active timer' },
              { key: 'tracked', header: 'Tracked', render: (row: any) => formatDuration(row.total_elapsed_duration || row.total_duration || 0) },
              {
                key: 'settings',
                header: 'Settings',
                render: (row: any) => (
                  <Button variant="secondary" size="sm" onClick={() => handleOpenSettings(row)}>
                    <SlidersHorizontal className="h-4 w-4" />
                    Settings
                  </Button>
                ),
              },
              ...(isStrictAdmin
                ? [{
                    key: 'remove',
                    header: 'Remove',
                    render: (row: any) => (
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => handleDeleteUser(row)}
                        disabled={deleteUserMutation.isPending}
                      >
                        Remove
                      </Button>
                    ),
                  }]
                : []),
              ...(canManageDirectoryRoles
                ? [{
                    key: 'promote',
                    header: 'Promote',
                    render: (row: any) => {
                      const roleOptions = getRoleDropdownOptions(row);
                      const currentValue = row.role_id ? `custom_${row.role_id}` : row.role;

                      return (
                        <SelectInput
                          value={currentValue}
                          onChange={(event) => {
                            const val = event.target.value;
                            if (val.startsWith('custom_')) {
                              const roleId = parseInt(val.replace('custom_', ''));
                              updateRoleMutation.mutate({ userId: row.id, roleId });
                            } else {
                              updateRoleMutation.mutate({ userId: row.id, role: val });
                            }
                          }}
                          disabled={updateRoleMutation.isPending || roleOptions.length <= 1}
                          className="min-w-[10rem]"
                        >
                          {roleOptions.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </SelectInput>
                      );
                    },
                  }]
                : []),
            ]}
          />

          {settingsTargetUser && settingsDraft ? (
            <div ref={settingsPanelRef} className="scroll-mt-28">
              <SurfaceCard className="p-5">
                <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-700">Additional settings</p>
                    <h2 className="mt-2 text-lg font-semibold text-slate-950">{settingsTargetUser.name}</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      Update monitoring interval and permission toggles for this {resolveUserRoleLabel(settingsTargetUser, customRolesQuery.data || [])}. Screenshot capture uses this monitoring interval after the user refreshes or signs in again.
                    </p>
                  </div>
                  <Button
                    onClick={handleSaveSettings}
                    disabled={updateSettingsMutation.isPending}
                  >
                    {updateSettingsMutation.isPending ? 'Saving...' : 'Save Settings'}
                  </Button>
                </div>

                <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <FieldLabel>Monitoring Interval</FieldLabel>
                    <SelectInput
                      value={settingsDraft.monitoringInterval}
                      onChange={(event) => setSettingsDraft((current) => current ? {
                        ...current,
                        monitoringInterval: Number(event.target.value) as MonitoringInterval,
                      } : current)}
                    >
                      {monitoringIntervalOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </SelectInput>
                    <p className="mt-2 text-xs text-slate-500">Desktop screenshot capture follows this interval for the selected user.</p>
                  </div>

                  <div className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-950">Can edit time</p>
                        <p className="mt-1 text-sm text-slate-500">Allow time edit and overtime correction requests.</p>
                      </div>
                      <ToggleInput
                        checked={settingsDraft.canEditTime}
                        onChange={(checked) => setSettingsDraft((current) => current ? ({ ...current, canEditTime: checked }) : current)}
                      />
                    </div>
                  </div>

                  <div className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-950">Attendance monitoring</p>
                        <p className="mt-1 text-sm text-slate-500">Show attendance overview and attendance workflows.</p>
                      </div>
                      <ToggleInput
                        checked={settingsDraft.attendanceMonitoring}
                        onChange={(checked) => setSettingsDraft((current) => current ? ({ ...current, attendanceMonitoring: checked }) : current)}
                      />
                    </div>
                  </div>

                  <div className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-950">Payroll visibility</p>
                        <p className="mt-1 text-sm text-slate-500">
                          {(settingsTargetUser?.hierarchy_level ?? (settingsTargetUser?.role === 'employee' ? 100 : 50)) >= 100
                            ? 'Employees do not receive payroll reporting access.'
                            : 'Allow payroll and reporting visibility for this user.'}
                        </p>
                      </div>
                      <ToggleInput
                        checked={settingsDraft.payrollVisibility}
                        disabled={(settingsTargetUser?.hierarchy_level ?? (settingsTargetUser?.role === 'employee' ? 100 : 50)) >= 100}
                        onChange={(checked) => setSettingsDraft((current) => current ? ({ ...current, payrollVisibility: checked }) : current)}
                      />
                    </div>
                  </div>

                  <div className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3 md:col-span-2">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-950">Task assignment defaults</p>
                        <p className="mt-1 text-sm text-slate-500">Grant task assignment workflow access by default.</p>
                      </div>
                      <ToggleInput
                        checked={settingsDraft.taskAssignmentAccess}
                        onChange={(checked) => setSettingsDraft((current) => current ? ({ ...current, taskAssignmentAccess: checked }) : current)}
                      />
                    </div>
                  </div>
                </div>
              </SurfaceCard>
            </div>
          ) : null}
        </>
      )}

      {mode === 'teams' && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Total Departments" value={teamInsights.length} hint="Active team groups" icon={Building2} accent="sky" />
            <MetricCard label="Department Employees" value={totalDepartmentEmployees} hint="Employees in departments" icon={Users} accent="emerald" />
            <MetricCard label="Managed Departments" value={managedDepartmentsCount} hint="Assigned manager/admin" icon={UserRound} accent="violet" />
            <MetricCard label="Avg Employees/Dept" value={avgEmployeesPerDepartment} hint="Average headcount" icon={SlidersHorizontal} accent="amber" />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.95fr_1.05fr]">
            <SurfaceCard className="p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-600">Department directory</p>
                  <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-950">See every department and manage members from this page.</h2>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">Add existing members into a department, move them across departments, or remove membership with complete control.</p>
                </div>
              </div>

              <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,16rem)_auto] lg:items-end">
                  <div>
                    <FieldLabel>Search Department</FieldLabel>
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <TextInput
                        aria-label="Search department directory"
                        value={groupDirectoryQuery}
                        onChange={(event) => setGroupDirectoryQuery(event.target.value)}
                        placeholder="Search department by name"
                        className="pl-10"
                      />
                    </div>
                  </div>
                  <div>
                    <FieldLabel>Department Dropdown</FieldLabel>
                    <SelectInput value={groupDirectoryFilter} onChange={(event) => setGroupDirectoryFilter(event.target.value)}>
                      <option value="all">All departments</option>
                      {groups.map((group: any) => (
                        <option key={group.id} value={group.id}>{group.name}</option>
                      ))}
                    </SelectInput>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setGroupDirectoryQuery('');
                      setGroupDirectoryFilter('all');
                    }}
                  >
                    Reset
                  </Button>
                </div>
                <p className="mt-3 text-xs text-slate-500">
                  {shouldShowDirectoryResults
                    ? `Showing ${filteredDirectoryGroups.length} of ${groups.length} department${groups.length === 1 ? '' : 's'}.`
                    : 'Departments are hidden by default. Search by name or choose one department from the dropdown.'}
                </p>
              </div>

              {groups.length === 0 ? (
                <div className="mt-5 rounded-lg border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">No departments have been created yet.</div>
              ) : !shouldShowDirectoryResults ? (
                <div className="mt-5 rounded-lg border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">Search for a department name to view directory cards.</div>
              ) : filteredDirectoryGroups.length === 0 ? (
                <div className="mt-5 rounded-lg border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">No departments match your search right now.</div>
              ) : (
                <div className="mt-6 grid grid-cols-1 gap-4">
                  {filteredDirectoryGroups.map((group: any) => {
                    const membersInGroup = (group.users || [])
                      .map((member: any) => findUserById(member.id) || member)
                      .filter((member: any) => Boolean(member) && member.role !== 'client');
                    const addableMembers = internalUsers.filter((member: any) => isEligibleForDirectGroupAdd(member));

                    return (
                      <div key={group.id} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <h3 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">{group.name}</h3>
                            <p className="mt-2 text-sm leading-6 text-slate-600">{group.description || 'No department description yet.'}</p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700">
                              <Users className="h-3.5 w-3.5" />
                              {membersInGroup.length} member{membersInGroup.length === 1 ? '' : 's'}
                            </span>
                            {canCreateGroups ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                iconLeft={<Trash2 className="h-4 w-4" />}
                                className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                                disabled={deleteGroupMutation.isPending}
                                onClick={() => handleDeleteGroup(group)}
                              >
                                {deletingGroupId === group.id ? 'Deleting...' : 'Delete Department'}
                              </Button>
                            ) : null}
                          </div>
                        </div>

                        <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
                          <FieldLabel>Add Existing Member</FieldLabel>
                          <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                            <SelectInput
                              value={memberDrafts[group.id] || ''}
                              onChange={(event) => setMemberDrafts((current) => ({ ...current, [group.id]: event.target.value }))}
                              disabled={addableMembers.length === 0 || syncMembershipMutation.isPending}
                            >
                              <option value="">{addableMembers.length === 0 ? 'No eligible members available' : 'Select member to add'}</option>
                              {addableMembers.map((member: any) => (
                                <option key={member.id} value={member.id}>{member.name} ({member.email})</option>
                              ))}
                            </SelectInput>
                            <Button
                              size="sm"
                              variant="secondary"
                              iconLeft={<UserPlus2 className="h-4 w-4" />}
                              disabled={!memberDrafts[group.id] || syncMembershipMutation.isPending || !canManageDepartments}
                              onClick={() => handleAddMemberToGroup(group)}
                            >
                              {syncMembershipMutation.isPending ? 'Saving...' : 'Add Member'}
                            </Button>
                          </div>
                        </div>

                        <div className="mt-5 space-y-3">
                          {membersInGroup.length === 0 ? (
                            <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">No members are assigned to this department yet.</div>
                          ) : (
                            membersInGroup.map((member: any) => {
                              const moveKey = `${group.id}:${member.id}`;
                              const canManageMembership = getHierarchyLevel(member) >= 100 || (getHierarchyLevel(member) <= 50 && currentUserLevel <= 10);

                              return (
                                <div key={moveKey} className="rounded-lg border border-slate-200 bg-white p-4">
                                  <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                                    <div className="min-w-0">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <p className="font-semibold text-slate-950">{member.name}</p>
                                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">{resolveUserRoleLabel(member, customRolesQuery.data || [])}</span>
                                      </div>
                                      <p className="mt-1 truncate text-sm text-slate-500">{member.email}</p>
                                      <p className="mt-2 text-xs text-slate-500">
                                        Current department{(member.groups || []).length === 1 ? '' : 's'}: {(member.groups || []).map((assignedGroup: any) => assignedGroup.name).join(', ') || 'None'}
                                      </p>
                                    </div>

                                    {canManageMembership ? (
                                      <div className="grid min-w-full gap-3 xl:min-w-[22rem]">
                                        <SelectInput
                                          value={memberMoveDrafts[moveKey] || ''}
                                          onChange={(event) => setMemberMoveDrafts((current) => ({ ...current, [moveKey]: event.target.value }))}
                                          disabled={groups.length <= 1 || syncMembershipMutation.isPending || !canManageDepartments}
                                        >
                                          <option value="">{groups.length <= 1 ? 'Create another department first' : 'Move member to another department'}</option>
                                          {groups.filter((targetGroup: any) => targetGroup.id !== group.id).map((targetGroup: any) => (
                                            <option key={targetGroup.id} value={targetGroup.id}>{targetGroup.name}</option>
                                          ))}
                                        </SelectInput>
                                        <div className="flex flex-wrap gap-2 sm:justify-end">
                                          <Button
                                            size="sm"
                                            variant="ghost"
                                            iconLeft={<ArrowRightLeft className="h-4 w-4" />}
                                            disabled={!memberMoveDrafts[moveKey] || syncMembershipMutation.isPending || !canManageDepartments}
                                            onClick={() => handleMoveEmployeeToGroup(member, group)}
                                          >
                                            {syncMembershipMutation.isPending ? 'Moving...' : 'Move'}
                                          </Button>
                                          <Button
                                            size="sm"
                                            variant="ghost"
                                            iconLeft={<Trash2 className="h-4 w-4" />}
                                            className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                                            disabled={(member.groups || []).length <= 1 || syncMembershipMutation.isPending || !canManageDepartments}
                                            onClick={() => handleRemoveEmployeeFromGroup(member, group)}
                                          >
                                            {syncMembershipMutation.isPending ? 'Removing...' : 'Remove'}
                                          </Button>
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="rounded-full bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600">
                                        Only admins can move/remove managers.
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </SurfaceCard>

            <SurfaceCard className="p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-slate-950">Existing Teams Distribution</h2>
                  <p className="mt-1 text-sm text-slate-500">Hover a slice to preview manager and employee count. Click to jump to department details.</p>
                </div>
              </div>

              {pieSegments.length === 0 ? (
                <div className="mt-4 rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                  No departments found yet.
                </div>
              ) : (
                <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-[19rem_minmax(0,1fr)]">
                  <div className="mx-auto w-full max-w-[18rem]">
                    <svg viewBox="0 0 220 220" className="h-full w-full">
                      {pieSegments.length === 1 ? (
                        <circle
                          cx="110"
                          cy="110"
                          r="88"
                          fill={pieSegments[0].color}
                          stroke="white"
                          strokeWidth={3}
                          className="cursor-pointer transition-opacity"
                          style={{ opacity: highlightedTeamId === null || highlightedTeamId === pieSegments[0].id ? 1 : 0.5 }}
                          onMouseEnter={() => setActiveTeamId(pieSegments[0].id)}
                          onMouseLeave={() => setActiveTeamId(null)}
                          onClick={() => scrollToTeamDetail(pieSegments[0].id)}
                        />
                      ) : (
                        pieSegments.map((team) => (
                          <path
                            key={team.id}
                            d={describeArc(110, 110, 88, team.startAngle, team.endAngle)}
                            fill={team.color}
                            stroke="white"
                            strokeWidth={3}
                            className="cursor-pointer transition-opacity"
                            style={{ opacity: highlightedTeamId === null || highlightedTeamId === team.id ? 1 : 0.5 }}
                            onMouseEnter={() => setActiveTeamId(team.id)}
                            onMouseLeave={() => setActiveTeamId(null)}
                            onClick={() => scrollToTeamDetail(team.id)}
                          />
                        ))
                      )}
                      <circle cx="110" cy="110" r="43" fill="white" />
                      <text x="110" y="104" textAnchor="middle" className="fill-slate-500 text-[11px] font-semibold uppercase tracking-[0.22em]">Teams</text>
                      <text x="110" y="126" textAnchor="middle" className="fill-slate-900 text-[20px] font-semibold">{teamInsights.length}</text>
                    </svg>
                  </div>

                  <div className="space-y-3">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Hover summary</p>
                      {highlightedTeam ? (
                        <div className="mt-2 text-sm text-slate-700">
                          <p className="font-semibold text-slate-900">{highlightedTeam.name}</p>
                          <p className="mt-1">Employees: {highlightedTeam.employeeCount}</p>
                          <p>{highlightedTeam.leadLabel || 'Lead'}: {highlightedTeam.leadName}</p>
                        </div>
                      ) : (
                        <p className="mt-2 text-sm text-slate-500">Hover a department slice to preview details.</p>
                      )}
                    </div>

                    <div className="max-h-64 space-y-2 overflow-auto pr-1">
                      {pieSegments.map((team) => (
                        <button
                          key={team.id}
                          type="button"
                          onClick={() => scrollToTeamDetail(team.id)}
                          onMouseEnter={() => setActiveTeamId(team.id)}
                          onMouseLeave={() => setActiveTeamId(null)}
                          className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left transition ${
                            selectedTeamId === team.id ? 'border-blue-300 bg-blue-50' : 'border-slate-200 bg-white hover:border-slate-300'
                          }`}
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: team.color }} />
                            <p className="truncate text-sm font-medium text-slate-900">{team.name}</p>
                          </div>
                          <p className="text-xs font-semibold text-slate-500">{team.percentage}%</p>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </SurfaceCard>
          </div>

          <SurfaceCard className="p-5">
            <h2 className="text-lg font-semibold text-slate-950">Department Details</h2>
            <p className="mt-1 text-sm text-slate-500">Click any pie slice to view that department details here.</p>
            <div className="mt-4 space-y-3">
              {teamInsights.length === 0 ? (
                <PageEmptyState title="No departments yet" description="Create a department to see detailed cards here." />
              ) : selectedTeamId === null ? (
                <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                  Select a department from the pie chart to view details.
                </div>
              ) : (
                teamInsights
                  .filter((team) => team.id === selectedTeamId)
                  .map((team) => (
                    <div
                      key={team.id}
                      ref={(element) => {
                        teamDetailRefs.current[team.id] = element;
                      }}
                      className={`rounded-lg border p-4 transition ${selectedTeamId === team.id ? 'border-blue-300 bg-blue-50/40' : 'border-slate-200 bg-white'}`}
                    >
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <h3 className="text-base font-semibold text-slate-950">{team.name}</h3>
                          <p className="mt-1 text-sm text-slate-500">{team.description || 'No department description added yet.'}</p>
                        </div>
                        <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                          {team.employeeCount} employee{team.employeeCount === 1 ? '' : 's'}
                        </div>
                      </div>

                      <div className="mt-3 grid grid-cols-1 gap-3 text-sm text-slate-600 md:grid-cols-2">
                        <p><span className="font-semibold text-slate-900">{team.leadLabel || 'Lead'}:</span> {team.leadName}</p>
                        <p><span className="font-semibold text-slate-900">Contact:</span> {team.leadEmail || 'Not available'}</p>
                      </div>

                      <div className="mt-3 border-t border-slate-200 pt-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Members</p>
                        <p className="mt-2 text-sm text-slate-600">
                          {team.users.length > 0
                            ? team.users.map((member: any) => member.name).join(', ')
                            : 'No users assigned yet.'}
                        </p>
                      </div>
                    </div>
                  ))
              )}
            </div>
          </SurfaceCard>
        </>
      )}

      {mode === 'invitations' && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.95fr_1.05fr]">
          <SurfaceCard className="p-5">
            <h2 className="text-lg font-semibold text-slate-950">Send Invitation</h2>
            <p className="mt-1 text-sm text-slate-500">Invitation emails send secure accept links, and the backend locks email and role when the user completes signup.</p>
            <div className="mt-4 space-y-4">
              {allowedRoles.length === 0 ? (
                <PageEmptyState title="Invite permissions unavailable" description="Your current role does not allow sending workspace invitations." />
              ) : null}
              <div>
                <FieldLabel>Email</FieldLabel>
                <TextInput type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="employee@company.com" />
              </div>
              <div>
                <FieldLabel>Role</FieldLabel>
                <SelectInput value={inviteRole} onChange={(event) => setInviteRole(event.target.value as 'admin' | 'manager' | 'employee')}>
                  {allowedRoles.map((role) => (
                    <option key={role} value={role}>
                      {role.charAt(0).toUpperCase() + role.slice(1)}
                    </option>
                  ))}
                </SelectInput>
              </div>
              <Button onClick={() => inviteMutation.mutate()} disabled={!inviteEmail.trim() || inviteMutation.isPending || allowedRoles.length === 0}>
                <MailPlus className="h-4 w-4" />
                Send Invitation
              </Button>
            </div>
          </SurfaceCard>

          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <MetricCard label="Active Members" value={members.length} hint="Loaded from organization members" icon={Users} accent="sky" />
              <MetricCard label="Pending Invites" value={invitations.filter((item: any) => item.status === 'pending').length} hint="Tracked from the invitation system" icon={MailPlus} accent="amber" />
            </div>
            <DataTable
              title="Pending Invitations"
              description="Secure invites waiting to be accepted."
              rows={invitations}
              emptyMessage="No invitations found."
              columns={[
                { key: 'email', header: 'Email', render: (row: any) => row.email },
                { key: 'role', header: 'Role', render: (row: any) => row.role ? row.role.charAt(0).toUpperCase() + row.role.slice(1) : 'Employee' },
                { key: 'status', header: 'Status', render: (row: any) => row.status },
                { key: 'expires_at', header: 'Expires', render: (row: any) => row.expires_at ? formatDateTime(row.expires_at, viewerTimezone) : 'n/a' },
              ]}
            />
            <DataTable
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
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {roleCards.length > 0
              ? roleCards.map((card: any) => (
                  <MetricCard key={card.key} label={card.label} value={card.value} hint={card.hint} icon={card.icon} accent={card.accent} />
                ))
              : (
                <>
                  <MetricCard label="Admins" value={users.filter((u: any) => getHierarchyLevel(u) <= 10).length} hint="Organization admins" icon={ShieldCheck} accent="sky" />
                  <MetricCard label="Managers" value={users.filter((u: any) => getHierarchyLevel(u) === 50 && !u.role_id).length} hint="Managers" icon={ShieldCheck} accent="emerald" />
                  <MetricCard label="Employees" value={users.filter((u: any) => getHierarchyLevel(u) >= 100 && !u.role_id).length} hint="Default role users" icon={Users} accent="violet" />
                  <MetricCard label="Custom Roles" value={users.filter((u: any) => u.role_id).length} hint="Users with custom job roles" icon={KeyRound} accent="amber" />
                </>
              )}
          </div>

          <SurfaceCard className="p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">Role Assignment</h2>
                <p className="mt-1 text-sm text-slate-500">Search by person, email, role, or department to update access without scanning the full list.</p>
              </div>
              <div className="w-full lg:max-w-sm">
                <FieldLabel>Search people</FieldLabel>
                <TextInput
                  value={roleSearchQuery}
                  onChange={(event) => setRoleSearchQuery(event.target.value)}
                  placeholder="Search name, email, role, or department"
                />
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="rounded-full bg-slate-100 px-3 py-1">
                Showing <span className="font-semibold text-slate-700">{filteredRoleUsers.length}</span> of {users.length} users
              </span>
              {roleSearchQuery.trim() ? (
                <button
                  type="button"
                  onClick={() => setRoleSearchQuery('')}
                  className="rounded-full border border-slate-200 px-3 py-1 font-medium text-slate-600 transition hover:border-blue-200 hover:text-blue-700"
                >
                  Clear search
                </button>
              ) : null}
            </div>
            <div className="mt-4 space-y-3">
              {users.length === 0 ? (
                <PageEmptyState title="No users found" description="Users must exist before roles can be updated." />
              ) : filteredRoleUsers.length === 0 ? (
                <PageEmptyState title="No matching users" description="Try a different search term to find the role assignment you need." />
              ) : (
                filteredRoleUsers.map((targetUser: any) => {
                  const roleOptions = getRoleDropdownOptions(targetUser);
                  const currentValue = targetUser.role_id ? `custom_${targetUser.role_id}` : targetUser.role;
                  return (
                    <div key={targetUser.id} className="flex flex-col gap-3 rounded-lg border border-slate-100 bg-slate-50 px-4 py-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="font-medium text-slate-950">{targetUser.name}</p>
                        <p className="text-sm text-slate-500">{targetUser.email}</p>
                        <p className="mt-1 text-xs text-slate-500">{resolveEmployeeDepartment(targetUser)} department</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <SelectInput
                          value={currentValue}
                          onChange={(event) => {
                            const val = event.target.value;
                            if (val.startsWith('custom_')) {
                              const roleId = parseInt(val.replace('custom_', ''));
                              updateRoleMutation.mutate({ userId: targetUser.id, roleId });
                            } else {
                              updateRoleMutation.mutate({ userId: targetUser.id, role: val });
                            }
                          }}
                          disabled={!isStrictAdmin || updateRoleMutation.isPending}
                          className="min-w-[11rem]"
                        >
                          {roleOptions.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </SelectInput>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </SurfaceCard>
        </>
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
