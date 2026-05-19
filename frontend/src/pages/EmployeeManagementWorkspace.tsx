import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { invitationApi, organizationApi, reportGroupApi, userApi } from '@/services/api';
import Button from '@/components/ui/Button';
import EmployeeSelect from '@/components/ui/EmployeeSelect';
import { FeedbackBanner, PageEmptyState, PageErrorState, PageLoadingState } from '@/components/ui/PageState';
import { FieldLabel, SelectInput, TextInput, ToggleInput } from '@/components/ui/FormField';
import { useAuth } from '@/contexts/AuthContext';
import { getAssignableRoles, hasAdminAccess, hasStrictAdminAccess } from '@/lib/permissions';
import { KeyRound, MailPlus, ShieldCheck, SlidersHorizontal, UserPlus, Users } from 'lucide-react';

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

const formatDuration = (seconds: number) => {
  const safe = Number.isFinite(Number(seconds)) ? Number(seconds) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  return `${hours}h ${minutes}m`;
};

const resolveEmployeeDepartment = (user: any) =>
  String(
    user?.department
    || user?.employee_work_info?.department?.name
    || user?.employeeWorkInfo?.department?.name
    || user?.groups?.[0]?.name
    || 'Unassigned'
  ).trim() || 'Unassigned';

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
    payrollVisibility: targetUser?.role === 'employee' ? false : settings.payroll_visibility !== false,
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
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [directoryFilterUserId, setDirectoryFilterUserId] = useState<number | ''>('');
  const [directoryDepartmentFilter, setDirectoryDepartmentFilter] = useState('All departments');
  const [directorySort, setDirectorySort] = useState<EmployeeDirectorySort>('default');
  const [groupName, setGroupName] = useState('');
  const [groupMembers, setGroupMembers] = useState<number[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'manager' | 'employee'>('employee');
  const [roleSearchQuery, setRoleSearchQuery] = useState('');
  const [settingsUserId, setSettingsUserId] = useState<number | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<EmployeeSettingsDraft | null>(null);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const settingsPanelRef = useRef<HTMLDivElement | null>(null);
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

  const settingsTargetUser = useMemo(
    () => (usersQuery.data || []).find((item: any) => item.id === settingsUserId) || null,
    [settingsUserId, usersQuery.data]
  );

  useEffect(() => {
    if (!selectedUserId && (usersQuery.data || []).length > 0) {
      setSelectedUserId(usersQuery.data![0].id);
    }
  }, [selectedUserId, usersQuery.data]);

  useEffect(() => {
    if (mode !== 'employees') {
      return;
    }

    const params = new URLSearchParams(location.search);
    const nextDepartment = String(params.get('department') || '').trim();
    if (!nextDepartment) {
      return;
    }

    setDirectoryDepartmentFilter(nextDepartment);
  }, [location.search, mode]);

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

  const createGroupMutation = useMutation({
    mutationFn: async () => {
      await reportGroupApi.create({ name: groupName.trim(), user_ids: groupMembers });
    },
    onSuccess: async () => {
      setGroupName('');
      setGroupMembers([]);
      setFeedback({ tone: 'success', message: 'Team created successfully.' });
      await queryClient.invalidateQueries({ queryKey: ['employee-workspace-groups'] });
    },
    onError: (error: any) => {
      setFeedback({ tone: 'error', message: error?.response?.data?.message || 'Failed to create team.' });
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: number; role: 'admin' | 'manager' | 'employee' }) => {
      await userApi.update(userId, { role });
    },
    onSuccess: async () => {
      setFeedback({ tone: 'success', message: 'Role updated successfully.' });
      await queryClient.invalidateQueries({ queryKey: ['employee-workspace-users'] });
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
          payroll_visibility: targetUser.role === 'employee' ? false : draft.payrollVisibility,
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
  const users = usersQuery.data || [];
  const groups = groupsQuery.data || [];
  const members = membersQuery.data || [];
  const invitations = invitationsQuery.data || [];
  const managerManagedDepartment = useMemo(() => {
    if (user?.role !== 'manager') {
      return null;
    }

    const managedGroup = groups.find((group: any) =>
      Array.isArray(group?.users)
      && group.users.some((member: any) => Number(member?.id) === Number(user.id) && member?.role === 'manager')
    );

    const managedGroupName = String(managedGroup?.name || '').trim();
    if (managedGroupName) {
      return managedGroupName;
    }

    const currentUserRecord = users.find((item: any) => Number(item.id) === Number(user.id));
    const fallbackDepartment = resolveEmployeeDepartment(currentUserRecord);
    return fallbackDepartment === 'Unassigned' ? null : fallbackDepartment;
  }, [groups, user, users]);
  const departmentOptions = useMemo(
    () => {
      if (user?.role === 'manager' && managerManagedDepartment) {
        return ['All departments', managerManagedDepartment];
      }

      return ['All departments', ...Array.from(new Set(users.map((item: any) => resolveEmployeeDepartment(item)).filter(Boolean)))];
    },
    [managerManagedDepartment, user?.role, users]
  );
  const employeeDirectoryRows = useMemo(() => {
    const filteredRows = directoryFilterUserId === ''
      ? [...users]
      : users.filter((item: any) => Number(item.id) === Number(directoryFilterUserId));

    const departmentFilteredRows = directoryDepartmentFilter === 'All departments'
      ? filteredRows
      : filteredRows.filter((item: any) => resolveEmployeeDepartment(item) === directoryDepartmentFilter);

    switch (directorySort) {
      case 'name_asc':
        return departmentFilteredRows.sort((left: any, right: any) =>
          String(left.name || '').localeCompare(String(right.name || ''), undefined, { sensitivity: 'base' })
        );
      case 'tracked_desc':
        return departmentFilteredRows.sort((left: any, right: any) =>
          Number(right.total_elapsed_duration || right.total_duration || 0) - Number(left.total_elapsed_duration || left.total_duration || 0)
        );
      case 'working_first':
        return departmentFilteredRows.sort((left: any, right: any) => {
          const workingDifference = Number(Boolean(right.is_working)) - Number(Boolean(left.is_working));
          if (workingDifference !== 0) {
            return workingDifference;
          }

          return String(left.name || '').localeCompare(String(right.name || ''), undefined, { sensitivity: 'base' });
        });
      default:
        return departmentFilteredRows;
    }
  }, [directoryDepartmentFilter, directoryFilterUserId, directorySort, users]);
  const filteredRoleUsers = useMemo(() => {
    const normalizedQuery = roleSearchQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return users;
    }

    return users.filter((item: any) =>
      [item.name, item.email, item.role, resolveEmployeeDepartment(item)]
        .some((value) => String(value || '').toLowerCase().includes(normalizedQuery))
    );
  }, [roleSearchQuery, users]);

  useEffect(() => {
    if (!departmentOptions.includes(directoryDepartmentFilter)) {
      setDirectoryDepartmentFilter(departmentOptions[0] || 'All departments');
    }
  }, [departmentOptions, directoryDepartmentFilter]);

  const getPromoteRoleOptions = (row: any): Array<'admin' | 'manager' | 'employee'> => {
    const currentRole = row?.role as 'admin' | 'manager' | 'employee';

    if (user?.role === 'admin') {
      if (Number(row?.id) === Number(user.id)) {
        return ['admin'];
      }

      const roleOptions: Array<'admin' | 'manager' | 'employee'> = ['admin', 'manager', 'employee'];
      if (!roleOptions.includes(currentRole)) {
        roleOptions.unshift(currentRole);
      }

      return roleOptions;
    }

    if (user?.role === 'manager') {
      return currentRole ? [currentRole] : ['employee'];
    }

    return currentRole ? [currentRole] : ['employee'];
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
        ) : null}
      </header>

      {feedback ? <FeedbackBanner tone={feedback.tone} message={feedback.message} /> : null}

      {mode === 'employees' && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Employees" value={users.length} hint="Current organization users" icon={Users} accent="sky" />
            <MetricCard label="Working Now" value={users.filter((user: any) => user.is_working).length} hint="Active timers right now" icon={ShieldCheck} accent="emerald" />
            <MetricCard label="Managers / Admins" value={users.filter((user: any) => user.role !== 'employee').length} hint="Elevated roles" icon={KeyRound} accent="violet" />
            <MetricCard label="Tracked Time" value={formatDuration(users.reduce((sum: number, user: any) => sum + Number(user.total_elapsed_duration || user.total_duration || 0), 0))} hint="Visible across users" icon={Users} accent="amber" />
          </div>

          <DataTable
            title="Employee Directory"
            description={canManageDirectoryRoles ? 'Role, department, work state, tracked hours, and promotion controls from the existing users endpoint.' : 'Role, department, work state, and tracked hours from the existing users endpoint.'}
            rows={employeeDirectoryRows}
            emptyMessage="No employees found."
            bodyClassName="max-h-[34rem] overflow-auto"
            headerAction={(
              <div className="grid grid-cols-1 gap-2 lg:grid-cols-3">
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
              { key: 'role', header: 'Role', render: (row: any) => row.role },
              { key: 'department', header: 'Department', render: (row: any) => resolveEmployeeDepartment(row) },
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
                      const roleOptions = getPromoteRoleOptions(row);

                      return (
                        <SelectInput
                          value={row.role}
                          onChange={(event) =>
                            updateRoleMutation.mutate({
                              userId: row.id,
                              role: event.target.value as 'admin' | 'manager' | 'employee',
                            })
                          }
                          disabled={updateRoleMutation.isPending || roleOptions.length <= 1}
                          className="min-w-[10rem]"
                        >
                          {roleOptions.map((role) => (
                            <option key={role} value={role}>
                              {role.charAt(0).toUpperCase() + role.slice(1)}
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
                      Update monitoring interval and permission toggles for this {settingsTargetUser.role}. Screenshot capture uses this monitoring interval after the user refreshes or signs in again.
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
                          {settingsTargetUser.role === 'employee'
                            ? 'Employees do not receive payroll reporting access.'
                            : 'Allow payroll and reporting visibility for this user.'}
                        </p>
                      </div>
                      <ToggleInput
                        checked={settingsDraft.payrollVisibility}
                        disabled={settingsTargetUser.role === 'employee'}
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
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.95fr_1.05fr]">
          <SurfaceCard className="p-5">
            <h2 className="text-lg font-semibold text-slate-950">Create Team / Department</h2>
            <div className="mt-4 space-y-4">
              <div>
                <FieldLabel>Team Name</FieldLabel>
                <TextInput value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder="Engineering" />
              </div>
              <div>
                <FieldLabel>Members</FieldLabel>
                <div className="max-h-56 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3">
                  {users.map((user: any) => (
                    <label key={user.id} className="flex items-center gap-2 py-1.5 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={groupMembers.includes(user.id)}
                        onChange={(event) =>
                          setGroupMembers((current) =>
                            event.target.checked ? [...current, user.id] : current.filter((value) => value !== user.id)
                          )
                        }
                      />
                      {user.name} ({user.email})
                    </label>
                  ))}
                </div>
              </div>
              <Button onClick={() => createGroupMutation.mutate()} disabled={!groupName.trim() || createGroupMutation.isPending}>
                Create Team
              </Button>
            </div>
          </SurfaceCard>

          <DataTable
            title="Existing Teams"
            description="Current report groups reused as teams or departments."
            rows={groups}
            emptyMessage="No teams found."
            columns={[
              { key: 'name', header: 'Team', render: (row: any) => row.name },
              { key: 'members', header: 'Members', render: (row: any) => row.users?.length || 0 },
              { key: 'member_names', header: 'People', render: (row: any) => (row.users || []).map((user: any) => user.name).join(', ') || 'No members' },
            ]}
          />
        </div>
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
                { key: 'role', header: 'Role', render: (row: any) => row.role },
                { key: 'status', header: 'Status', render: (row: any) => row.status },
                { key: 'expires_at', header: 'Expires', render: (row: any) => row.expires_at ? new Date(row.expires_at).toLocaleString() : 'n/a' },
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
                { key: 'role', header: 'Role', render: (row: any) => row.role },
                { key: 'status', header: 'Status', render: (row: any) => (row.is_active ? 'Active' : 'Inactive') },
              ]}
            />
          </div>
        </div>
      )}

      {mode === 'roles' && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Admins" value={users.filter((user: any) => user.role === 'admin').length} hint="Organization admins" icon={ShieldCheck} accent="sky" />
            <MetricCard label="Managers" value={users.filter((user: any) => user.role === 'manager').length} hint="Managers" icon={ShieldCheck} accent="emerald" />
            <MetricCard label="Employees" value={users.filter((user: any) => user.role === 'employee').length} hint="Employee users" icon={Users} accent="violet" />
            <MetricCard label="Permission Model" value="Role-based" hint="Using current user.role field" icon={KeyRound} accent="amber" />
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
                filteredRoleUsers.map((user: any) => (
                  <div key={user.id} className="flex flex-col gap-3 rounded-lg border border-slate-100 bg-slate-50 px-4 py-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="font-medium text-slate-950">{user.name}</p>
                      <p className="text-sm text-slate-500">{user.email}</p>
                      <p className="mt-1 text-xs text-slate-500">{resolveEmployeeDepartment(user)} department</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <SelectInput
                        value={user.role}
                        onChange={(event) =>
                          updateRoleMutation.mutate({
                            userId: user.id,
                            role: event.target.value as 'admin' | 'manager' | 'employee',
                          })
                        }
                        disabled={!isStrictAdmin || updateRoleMutation.isPending}
                        className="min-w-[11rem]"
                      >
                        <option value="employee">Employee</option>
                        <option value="manager">Manager</option>
                        <option value="admin">Admin</option>
                      </SelectInput>
                    </div>
                  </div>
                ))
              )}
            </div>
          </SurfaceCard>
        </>
      )}
    </div>
  );
}
