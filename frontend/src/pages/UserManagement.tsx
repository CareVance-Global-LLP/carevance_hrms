import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { reportGroupApi, userApi } from '@/services/api';
import DateRangeFields from '@/components/dashboard/DateRangeFields';
import { useAuth } from '@/contexts/AuthContext';
import { deriveDateRangeFromPreset, getDateRangePresetLabel, isDateRangePreset, type DateRangePreset } from '@/lib/dateRange';
import { resolvePersistedDateRange } from '@/lib/dateRange';
import { readSessionStorageJson, writeSessionStorageJson } from '@/lib/filterPersistence';
import { hasAdminAccess, hasStrictAdminAccess, resolveUserRoleLabel } from '@/lib/permissions';
import { queryKeys } from '@/lib/queryKeys';
import { formatDuration } from '@/lib/formatters';
import { FeedbackBanner, PageEmptyState, PageErrorState, PageLoadingState } from '@/components/ui/PageState';
import Button from '@/components/ui/Button';
import { SelectInput } from '@/components/ui/FormField';
import SurfaceCard from '@/components/dashboard/SurfaceCard';

type OrgUser = {
  id: number;
  name: string;
  email: string;
  role: 'admin' | 'manager' | 'employee';
  is_working?: boolean;
  current_project?: string | null;
  total_duration?: number;
  total_elapsed_duration?: number;
};
type ReportGroup = { id: number; name: string; users: OrgUser[] };

const COUNTRY_TIMEZONES: Record<string, string[]> = {
  India: ['Asia/Kolkata'],
  USA: ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles'],
  UK: ['Europe/London'],
  UAE: ['Asia/Dubai'],
  Australia: ['Australia/Sydney', 'Australia/Perth'],
};

type PersistedUserManagementFilters = {
  datePreset: DateRangePreset;
  country: string;
  timezone: string;
  startDate: string;
  endDate: string;
  selectedProfileUserId: number | null;
};

const USER_MANAGEMENT_FILTER_STORAGE_KEY = 'user-management-filters';
const userManagementDefaultDateRange = deriveDateRangeFromPreset('today');

const getDefaultUserManagementFilters = (defaultTimezone: string): PersistedUserManagementFilters => ({
  datePreset: 'today',
  country: 'India',
  timezone: defaultTimezone,
  startDate: userManagementDefaultDateRange.startDate,
  endDate: userManagementDefaultDateRange.endDate,
  selectedProfileUserId: null,
});

const readPersistedUserManagementFilters = (defaultTimezone: string): PersistedUserManagementFilters => {
  const fallback = getDefaultUserManagementFilters(defaultTimezone);
  const parsed = readSessionStorageJson<PersistedUserManagementFilters>(USER_MANAGEMENT_FILTER_STORAGE_KEY);

  if (!parsed) {
    return fallback;
  }

  const nextCountry = typeof parsed.country === 'string' && COUNTRY_TIMEZONES[parsed.country] ? parsed.country : fallback.country;
  const timezoneOptions = COUNTRY_TIMEZONES[nextCountry] || COUNTRY_TIMEZONES[fallback.country];
  const datePreset = isDateRangePreset(String(parsed.datePreset || '')) ? parsed.datePreset as DateRangePreset : fallback.datePreset;
  const resolvedRange = resolvePersistedDateRange(
    datePreset,
    typeof parsed.startDate === 'string' && parsed.startDate ? parsed.startDate : fallback.startDate,
    typeof parsed.endDate === 'string' && parsed.endDate ? parsed.endDate : fallback.endDate
  );

  return {
    datePreset,
    country: nextCountry,
    timezone: typeof parsed.timezone === 'string' && timezoneOptions.includes(parsed.timezone) ? parsed.timezone : timezoneOptions[0],
    startDate: resolvedRange.startDate,
    endDate: resolvedRange.endDate,
    selectedProfileUserId:
      typeof parsed.selectedProfileUserId === 'number' && parsed.selectedProfileUserId > 0
        ? parsed.selectedProfileUserId
        : null,
  };
};

export default function UserManagement() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = hasAdminAccess(user);
  const isStrictAdmin = hasStrictAdminAccess(user);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const defaultTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';
  const [datePreset, setDatePreset] = useState<DateRangePreset>(() => readPersistedUserManagementFilters(defaultTimezone).datePreset);
  const [country, setCountry] = useState(() => readPersistedUserManagementFilters(defaultTimezone).country);
  const [timezone, setTimezone] = useState(() => readPersistedUserManagementFilters(defaultTimezone).timezone);
  const [startDate, setStartDate] = useState(() => readPersistedUserManagementFilters(defaultTimezone).startDate);
  const [endDate, setEndDate] = useState(() => readPersistedUserManagementFilters(defaultTimezone).endDate);
  const [selectedProfileUserId, setSelectedProfileUserId] = useState<number | null>(() => readPersistedUserManagementFilters(defaultTimezone).selectedProfileUserId);

  const [userForm, setUserForm] = useState({ id: 0, name: '', email: '', role: 'employee' as OrgUser['role'], password: '' });
  const [groupForm, setGroupForm] = useState({ id: 0, name: '', user_ids: [] as number[] });

  useEffect(() => {
    if (!COUNTRY_TIMEZONES[country]?.includes(timezone)) {
      setTimezone(COUNTRY_TIMEZONES[country][0]);
    }
  }, [country, timezone]);

  useEffect(() => {
    writeSessionStorageJson(USER_MANAGEMENT_FILTER_STORAGE_KEY, {
      datePreset,
      country,
      timezone,
      startDate,
      endDate,
      selectedProfileUserId,
    } satisfies PersistedUserManagementFilters);
  }, [country, datePreset, defaultTimezone, endDate, selectedProfileUserId, startDate, timezone]);

  const handleDatePresetChange = (preset: DateRangePreset) => {
    setDatePreset(preset);
    if (preset === 'custom') {
      return;
    }

    const nextRange = deriveDateRangeFromPreset(preset);
    setStartDate(nextRange.startDate);
    setEndDate(nextRange.endDate);
  };

  const userQueryParams = useMemo(
    () => ({
      period: 'all' as const,
      country,
      timezone,
      start_date: startDate || undefined,
      end_date: endDate || undefined,
    }),
    [country, timezone, startDate, endDate]
  );

  const usersQuery = useQuery({
    queryKey: queryKeys.users(userQueryParams),
    queryFn: async () => {
      const response = await userApi.getAll(userQueryParams);
      return (response.data || []).map((u: any) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        is_working: Boolean(u.is_working),
        current_project: u.current_project || null,
        total_duration: Number(u.total_duration || 0),
        total_elapsed_duration: Number(u.total_elapsed_duration || 0),
      })) as OrgUser[];
    },
    enabled: isAdmin,
    refetchInterval: isAdmin ? 15000 : false,
  });

  const groupsQuery = useQuery({
    queryKey: queryKeys.reportGroups,
    queryFn: async () => {
      const response = await reportGroupApi.list();
      return (response.data?.data || []).map((g: any) => ({ id: g.id, name: g.name, users: g.users || [] })) as ReportGroup[];
    },
    enabled: isAdmin,
  });

  const users = usersQuery.data || [];
  const groups = groupsQuery.data || [];
  const selectedGroup = useMemo(() => groups.find((g) => g.id === groupForm.id) || null, [groups, groupForm.id]);
  const selectedUser = useMemo(
    () => users.find((item) => item.id === selectedProfileUserId) || users[0] || null,
    [users, selectedProfileUserId]
  );

  useEffect(() => {
    if (!selectedProfileUserId && users.length > 0) {
      setSelectedProfileUserId(users[0].id);
    }
  }, [selectedProfileUserId, users]);

  useEffect(() => {
    if (!selectedProfileUserId) {
      return;
    }

    const hasSelectedUser = users.some((item) => item.id === selectedProfileUserId);
    if (!hasSelectedUser) {
      setSelectedProfileUserId(users[0]?.id || null);
    }
  }, [selectedProfileUserId, users]);

  const profile360Query = useQuery({
    queryKey: ['user-profile-360', selectedUser?.id, startDate, endDate],
    queryFn: async () => {
      if (!selectedUser?.id) return null;
      const response = await userApi.getProfile360(selectedUser.id, {
        start_date: startDate || undefined,
        end_date: endDate || undefined,
      });
      return response.data;
    },
    enabled: isAdmin && Boolean(selectedUser?.id),
  });

  const refreshQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.users(userQueryParams) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.reportGroups }),
    ]);
  };

  const saveUserMutation = useMutation({
    mutationFn: async () => {
      if (userForm.id) {
        await userApi.update(userForm.id, {
          name: userForm.name.trim(),
          email: userForm.email.trim(),
          role: userForm.role,
        });
        return 'User updated';
      }

      await userApi.create({
        name: userForm.name.trim(),
        email: userForm.email.trim(),
        role: userForm.role,
        password: userForm.password || undefined,
      });
      return 'User created';
    },
    onSuccess: async (message) => {
      setFeedback({ tone: 'success', message });
      setUserForm({ id: 0, name: '', email: '', role: 'employee', password: '' });
      await refreshQueries();
    },
    onError: (mutationError: any) => {
      setFeedback({
        tone: 'error',
        message: mutationError?.response?.data?.message || 'Failed to save user.',
      });
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (id: number) => {
      await userApi.delete(id);
    },
    onSuccess: async () => {
      setFeedback({ tone: 'success', message: 'User deleted' });
      await refreshQueries();
    },
    onError: (mutationError: any) => {
      setFeedback({
        tone: 'error',
        message: mutationError?.response?.data?.message || 'Failed to delete user.',
      });
    },
  });

  const saveGroupMutation = useMutation({
    mutationFn: async () => {
      if (groupForm.id) {
        await reportGroupApi.update(groupForm.id, { name: groupForm.name.trim(), user_ids: groupForm.user_ids });
        return 'Group updated';
      }

      await reportGroupApi.create({ name: groupForm.name.trim(), user_ids: groupForm.user_ids });
      return 'Group created';
    },
    onSuccess: async (message) => {
      setFeedback({ tone: 'success', message });
      setGroupForm({ id: 0, name: '', user_ids: [] });
      await queryClient.invalidateQueries({ queryKey: queryKeys.reportGroups });
    },
    onError: (mutationError: any) => {
      setFeedback({
        tone: 'error',
        message: mutationError?.response?.data?.message || 'Failed to save group.',
      });
    },
  });

  const deleteGroupMutation = useMutation({
    mutationFn: async (id: number) => {
      await reportGroupApi.delete(id);
    },
    onSuccess: async (_, id) => {
      setFeedback({ tone: 'success', message: 'Group deleted' });
      if (groupForm.id === id) {
        setGroupForm({ id: 0, name: '', user_ids: [] });
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.reportGroups });
    },
    onError: (mutationError: any) => {
      setFeedback({
        tone: 'error',
        message: mutationError?.response?.data?.message || 'Failed to delete group.',
      });
    },
  });

  const saveUser = async () => {
    if (!userForm.name.trim() || !userForm.email.trim()) return;
    setFeedback(null);
    await saveUserMutation.mutateAsync();
  };

  const editUser = (u: OrgUser) => {
    setUserForm({ id: u.id, name: u.name, email: u.email, role: u.role, password: '' });
  };

  const removeUser = async (id: number) => {
    if (!isStrictAdmin) return;
    if (!confirm('Delete this user?')) return;
    setFeedback(null);
    await deleteUserMutation.mutateAsync(id);
  };

  const saveGroup = async () => {
    if (!groupForm.name.trim()) return;
    setFeedback(null);
    await saveGroupMutation.mutateAsync();
  };

  const editGroup = (g: ReportGroup) => {
    setGroupForm({ id: g.id, name: g.name, user_ids: (g.users || []).map((u) => u.id) });
  };

  const removeGroup = async (id: number) => {
    if (!confirm('Delete this group?')) return;
    setFeedback(null);
    await deleteGroupMutation.mutateAsync(id);
  };

  const getRoleColor = (role: OrgUser['role']) => {
    switch (role) {
      case 'admin': return 'bg-purple-100 text-purple-700';
      case 'manager': return 'bg-blue-100 text-blue-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  if (!isAdmin) {
    return <div className="text-sm text-gray-500">Only admin or manager can access user management.</div>;
  }

  if (usersQuery.isLoading || groupsQuery.isLoading) {
    return <PageLoadingState label="Loading user management..." />;
  }

  if (usersQuery.isError || groupsQuery.isError) {
    return (
      <PageErrorState
        message={(usersQuery.error as any)?.response?.data?.message || (groupsQuery.error as any)?.response?.data?.message || 'Failed to load user management data.'}
        onRetry={() => {
          void usersQuery.refetch();
          void groupsQuery.refetch();
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      {feedback ? <FeedbackBanner tone={feedback.tone} message={feedback.message} /> : null}

      <div>
        <h1 className="text-2xl font-bold text-gray-900">User Management</h1>
        <p className="text-gray-500 mt-1">Add/edit users and create groups for reports</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-6">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Country</label>
          <SelectInput value={country} onChange={(e) => setCountry(e.target.value)} className="border-gray-300 shadow-none">
            {Object.keys(COUNTRY_TIMEZONES).map((countryName) => (
              <option key={countryName} value={countryName}>{countryName}</option>
            ))}
          </SelectInput>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Timezone</label>
          <SelectInput value={timezone} onChange={(e) => setTimezone(e.target.value)} className="border-gray-300 shadow-none">
            {(COUNTRY_TIMEZONES[country] || []).map((tz) => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
          </SelectInput>
        </div>
        <DateRangeFields
          datePreset={datePreset}
          onDatePresetChange={handleDatePresetChange}
          startDate={startDate}
          endDate={endDate}
          onStartDateChange={(value) => {
            setDatePreset('custom');
            setStartDate(value);
          }}
          onEndDateChange={(value) => {
            setDatePreset('custom');
            setEndDate(value);
          }}
          inputClassName="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm shadow-none"
        />
        <div className="flex items-end">
          <button
            onClick={() => {
              const nextRange = deriveDateRangeFromPreset('today');
              setDatePreset('today');
              setStartDate(nextRange.startDate);
              setEndDate(nextRange.endDate);
            }}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
          >
            Reset Range
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {users.length === 0 ? (
          <div className="col-span-full">
            <PageEmptyState title="No users found" description="Adjust filters or add a new user." />
          </div>
        ) : users.map((u) => (
          <button
            key={`summary-${u.id}`}
            type="button"
            onClick={() => setSelectedProfileUserId(u.id)}
            className={`bg-white rounded-xl border p-5 text-left transition ${
              selectedUser?.id === u.id ? 'border-sky-300 shadow-sm' : 'border-gray-200 hover:border-sky-200'
            }`}
          >
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold text-gray-900">{u.name}</h3>
                <p className="text-sm text-gray-500">{u.email}</p>
              </div>
              <span className={`px-2 py-1 rounded-full text-xs font-medium ${getRoleColor(u.role)}`}>{resolveUserRoleLabel(u)}</span>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <span className={`text-xs ${u.is_working ? 'text-green-600' : 'text-gray-500'}`}>
                {u.is_working ? `Working${u.current_project ? ` on ${u.current_project}` : ''}` : 'Not working'}
              </span>
              <span className={`text-xs font-medium ${u.is_working ? 'text-green-600' : 'text-gray-500'}`}>
                {u.is_working ? 'Active now' : 'Inactive'}
              </span>
            </div>
            <div className="mt-2 text-xs text-gray-600">
              Attendance: <span className={u.is_working ? 'text-green-600' : 'text-gray-500'}>{u.is_working ? 'Present (Working)' : 'Not Working'}</span>
            </div>
            <div className="mt-1 text-xs text-gray-600">
              Total worked ({datePreset === 'custom' ? 'Custom Range' : getDateRangePresetLabel(datePreset)} - {timezone}): {formatDuration(u.total_elapsed_duration ?? u.total_duration)}
            </div>
          </button>
        ))}
      </div>

      <SurfaceCard className="p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-sm font-medium text-sky-700">Employee 360</p>
            <h2 className="text-xl font-semibold text-slate-950">
              {selectedUser ? `${selectedUser.name} overview` : 'Select an employee'}
            </h2>
            <p className="text-sm text-slate-500">
              Consolidated view of work, attendance, leave, time edits, and payroll history for the selected employee.
            </p>
          </div>
          <Button onClick={() => void profile360Query.refetch()} variant="secondary" size="sm" disabled={!selectedUser}>
            Refresh 360
          </Button>
        </div>

        {!selectedUser ? (
          <div className="mt-4">
            <PageEmptyState title="No employee selected" description="Choose an employee card to load the profile view." />
          </div>
        ) : profile360Query.isLoading ? (
          <PageLoadingState label="Loading employee 360..." />
        ) : profile360Query.isError || !profile360Query.data ? (
          <div className="mt-4">
            <PageErrorState
              message={(profile360Query.error as any)?.response?.data?.message || 'Failed to load employee profile.'}
              onRetry={() => void profile360Query.refetch()}
            />
          </div>
        ) : (
          <div className="mt-5 space-y-5">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Worked</p>
                <p className="mt-2 text-2xl font-semibold text-slate-950">{formatDuration(profile360Query.data.summary.total_duration)}</p>
                <p className="mt-1 text-xs text-slate-500">{profile360Query.data.summary.entries_count} entries in range</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Attendance</p>
                <p className="mt-2 text-2xl font-semibold text-slate-950">{profile360Query.data.summary.present_days}</p>
                <p className="mt-1 text-xs text-slate-500">{profile360Query.data.summary.attendance_days} tracked days</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Approved Leave</p>
                <p className="mt-2 text-2xl font-semibold text-slate-950">{profile360Query.data.summary.approved_leave_days}</p>
                <p className="mt-1 text-xs text-slate-500">Days approved</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Time Adjustments</p>
                <p className="mt-2 text-2xl font-semibold text-slate-950">{formatDuration(profile360Query.data.summary.approved_time_edit_seconds)}</p>
                <p className="mt-1 text-xs text-slate-500">Approved overtime/time edits</p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="rounded-lg border border-slate-200 p-4">
                <h3 className="text-sm font-semibold text-slate-950">Current status</h3>
                <div className="mt-3 space-y-2 text-sm text-slate-600">
                  <p>Role: <span className="font-medium text-slate-950">{resolveUserRoleLabel(profile360Query.data.user)}</span></p>
                  <p>Working now: <span className="font-medium text-slate-950">{profile360Query.data.status.is_working ? 'Yes' : 'No'}</span></p>
                  <p>Current project: <span className="font-medium text-slate-950">{profile360Query.data.status.current_project || 'No active timer'}</span></p>
                  <p>Last seen: <span className="font-medium text-slate-950">{profile360Query.data.status.last_seen_at ? new Date(profile360Query.data.status.last_seen_at).toLocaleString() : 'Unavailable'}</span></p>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 p-4">
                <h3 className="text-sm font-semibold text-slate-950">Latest attendance</h3>
                {profile360Query.data.status.latest_attendance ? (
                  <div className="mt-3 space-y-2 text-sm text-slate-600">
                    <p>Date: <span className="font-medium text-slate-950">{profile360Query.data.status.latest_attendance.attendance_date}</span></p>
                    <p>Status: <span className="font-medium capitalize text-slate-950">{profile360Query.data.status.latest_attendance.status}</span></p>
                    <p>Worked: <span className="font-medium text-slate-950">{formatDuration(profile360Query.data.status.latest_attendance.worked_seconds)}</span></p>
                    <p>Late: <span className="font-medium text-slate-950">{profile360Query.data.status.latest_attendance.late_minutes} min</span></p>
                  </div>
                ) : <p className="mt-3 text-sm text-slate-500">No attendance record found.</p>}
              </div>

              <div className="rounded-lg border border-slate-200 p-4">
                <h3 className="text-sm font-semibold text-slate-950">Latest notification</h3>
                {profile360Query.data.status.latest_notification ? (
                  <div className="mt-3 space-y-2 text-sm text-slate-600">
                    <p className="font-medium text-slate-950">{profile360Query.data.status.latest_notification.title}</p>
                    <p>{profile360Query.data.status.latest_notification.message}</p>
                    <p className="text-xs text-slate-500">{new Date(profile360Query.data.status.latest_notification.created_at).toLocaleString()}</p>
                  </div>
                ) : <p className="mt-3 text-sm text-slate-500">No recent notification.</p>}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="rounded-lg border border-slate-200 p-4">
                <h3 className="text-sm font-semibold text-slate-950">Recent time entries</h3>
                <div className="mt-3 space-y-2">
                  {profile360Query.data.recent_time_entries.length === 0 ? (
                    <p className="text-sm text-slate-500">No time entries in the selected range.</p>
                  ) : profile360Query.data.recent_time_entries.map((entry) => (
                    <div key={entry.id} className="rounded-xl border border-slate-100 px-3 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium text-slate-950">{entry.task?.title || entry.project?.name || 'No task'}</p>
                        <p className="text-xs text-slate-500">{formatDuration(entry.duration)}</p>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">{entry.description || 'No description'}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 p-4">
                <h3 className="text-sm font-semibold text-slate-950">Payroll snapshots</h3>
                <div className="mt-3 space-y-2">
                  {profile360Query.data.payslips.length === 0 ? (
                    <p className="text-sm text-slate-500">No payslips available.</p>
                  ) : profile360Query.data.payslips.map((payslip) => (
                    <div key={payslip.id} className="rounded-xl border border-slate-100 px-3 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium text-slate-950">{payslip.period_month}</p>
                        <p className="text-xs uppercase text-slate-500">{payslip.payment_status || 'pending'}</p>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        {new Intl.NumberFormat('en-IN', {
                          style: 'currency',
                          currency: payslip.currency || 'INR',
                          maximumFractionDigits: 2,
                        }).format(Number(payslip.net_salary || 0))}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="rounded-lg border border-slate-200 p-4">
                <h3 className="text-sm font-semibold text-slate-950">Leave history</h3>
                <div className="mt-3 space-y-2">
                  {profile360Query.data.leave_requests.length === 0 ? (
                    <p className="text-sm text-slate-500">No leave requests found.</p>
                  ) : profile360Query.data.leave_requests.map((leaveRequest) => (
                    <div key={leaveRequest.id} className="rounded-xl border border-slate-100 px-3 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium text-slate-950">{leaveRequest.start_date} to {leaveRequest.end_date}</p>
                        <p className="text-xs uppercase text-slate-500">{leaveRequest.status}</p>
                      </div>
                      {leaveRequest.reason ? <p className="mt-1 text-xs text-slate-500">{leaveRequest.reason}</p> : null}
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 p-4">
                <h3 className="text-sm font-semibold text-slate-950">Time edit history</h3>
                <div className="mt-3 space-y-2">
                  {profile360Query.data.time_edit_requests.length === 0 ? (
                    <p className="text-sm text-slate-500">No time edit requests found.</p>
                  ) : profile360Query.data.time_edit_requests.map((request) => (
                    <div key={request.id} className="rounded-xl border border-slate-100 px-3 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium text-slate-950">{request.attendance_date}</p>
                        <p className="text-xs uppercase text-slate-500">{request.status}</p>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        {formatDuration(request.extra_seconds)} {request.message ? `- ${request.message}` : ''}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </SurfaceCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <h2 className="font-semibold text-gray-900">{userForm.id ? 'Edit User' : 'Add User'}</h2>
          <input value={userForm.name} onChange={(e) => setUserForm((p) => ({ ...p, name: e.target.value }))} placeholder="Name" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          <input value={userForm.email} onChange={(e) => setUserForm((p) => ({ ...p, email: e.target.value }))} placeholder="Email" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          <SelectInput value={userForm.role} onChange={(e) => setUserForm((p) => ({ ...p, role: e.target.value as OrgUser['role'] }))} className="border-gray-300 shadow-none">
            <option value="employee">Employee</option>
            <option value="manager">Manager</option>
            <option value="admin">Admin</option>
          </SelectInput>
          {!userForm.id ? (
            <input type="password" value={userForm.password} onChange={(e) => setUserForm((p) => ({ ...p, password: e.target.value }))} placeholder="Password (optional)" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          ) : null}
          <div className="flex gap-2">
            <button onClick={saveUser} disabled={saveUserMutation.isPending} className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm disabled:opacity-60">{saveUserMutation.isPending ? 'Saving...' : userForm.id ? 'Update User' : 'Add User'}</button>
            {userForm.id ? <button onClick={() => setUserForm({ id: 0, name: '', email: '', role: 'employee', password: '' })} className="px-4 py-2 border border-gray-300 rounded-lg text-sm">Cancel</button> : null}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <h2 className="font-semibold text-gray-900">{groupForm.id ? 'Edit Group' : 'Create Group'}</h2>
          <input value={groupForm.name} onChange={(e) => setGroupForm((p) => ({ ...p, name: e.target.value }))} placeholder="Group name" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          <div className="max-h-44 overflow-auto border border-gray-200 rounded-lg p-2">
            {users.map((u) => (
              <label key={u.id} className="flex items-center gap-2 text-sm py-1">
                <input
                  type="checkbox"
                  checked={groupForm.user_ids.includes(u.id)}
                  onChange={(e) => {
                    setGroupForm((prev) => ({
                      ...prev,
                      user_ids: e.target.checked ? [...prev.user_ids, u.id] : prev.user_ids.filter((id) => id !== u.id),
                    }));
                  }}
                />
                {u.name} ({u.email})
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={saveGroup} disabled={saveGroupMutation.isPending} className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm disabled:opacity-60">{saveGroupMutation.isPending ? 'Saving...' : groupForm.id ? 'Update Group' : 'Create Group'}</button>
            {groupForm.id ? <button onClick={() => setGroupForm({ id: 0, name: '', user_ids: [] })} className="px-4 py-2 border border-gray-300 rounded-lg text-sm">Cancel</button> : null}
          </div>
          {selectedGroup ? <p className="text-xs text-gray-500">Editing members for: {selectedGroup.name}</p> : null}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h2 className="font-semibold text-gray-900 mb-2">Users</h2>
        <div className="space-y-2">
          {users.map((u) => (
            <div key={u.id} className="flex items-center justify-between border border-gray-200 rounded-lg px-3 py-2">
              <div className="text-sm">{u.name} ({u.email}) <span className="text-gray-500">[{resolveUserRoleLabel(u)}]</span></div>
              <div className="flex gap-2">
                <button onClick={() => editUser(u)} className="px-2 py-1 text-xs border border-gray-300 rounded">Edit</button>
                {isStrictAdmin ? <button onClick={() => removeUser(u.id)} className="px-2 py-1 text-xs border border-red-300 text-red-700 rounded">Delete</button> : null}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h2 className="font-semibold text-gray-900 mb-2">Groups</h2>
        <div className="space-y-2">
          {groups.length === 0 ? <p className="text-sm text-gray-500">No groups yet.</p> : groups.map((g) => (
            <div key={g.id} className="border border-gray-200 rounded-lg px-3 py-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-gray-900">{g.name}</p>
                <div className="flex gap-2">
                  <button onClick={() => editGroup(g)} className="px-2 py-1 text-xs border border-gray-300 rounded">Edit</button>
                  <button onClick={() => removeGroup(g.id)} className="px-2 py-1 text-xs border border-red-300 text-red-700 rounded">Delete</button>
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-1">Members: {(g.users || []).map((u) => u.name).join(', ') || 'None'}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
