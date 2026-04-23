import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { activityApi, attendanceApi, attendanceHolidayApi, attendanceTimeEditApi, leaveApi, organizationApi, reportApi, screenshotApi, userApi } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import { canReviewApprovalRequest, hasAdminAccess } from '@/lib/permissions';
import DateRangeFields from '@/components/dashboard/DateRangeFields';
import PageHeader from '@/components/dashboard/PageHeader';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import FilterPanel from '@/components/dashboard/FilterPanel';
import MetricCard from '@/components/dashboard/MetricCard';
import Button from '@/components/ui/Button';
import EmployeeSelect from '@/components/ui/EmployeeSelect';
import { FeedbackBanner, PageEmptyState, PageLoadingState } from '@/components/ui/PageState';
import { FieldLabel, SelectInput, TextInput, TextareaInput } from '@/components/ui/FormField';
import { classifyActivityProductivity as classifyProductivity, normalizeActivityToolLabel as normalizeToolLabel } from '@/lib/activityProductivity';
import { deriveDateRangeFromPreset, resolvePersistedDateRange, type DateRangePreset } from '@/lib/dateRange';
import { coercePositiveNumber, readSessionStorageJson, writeSessionStorageJson } from '@/lib/filterPersistence';
import StatusBadge from '@/components/ui/StatusBadge';
import { Briefcase, CalendarDays, Clock, Eye, FolderKanban, Layers3, Users } from 'lucide-react';
import type { UserProfile360 } from '@/types';

const formatDuration = (seconds: number) => {
  const safe = Number.isFinite(Number(seconds)) ? Number(seconds) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  return `${hours}h ${minutes}m`;
};
const formatDateTime = (value?: string | null) => (value ? new Date(value).toLocaleString() : 'Not available');
const productivityTone = (classification?: string | null) =>
  classification === 'productive'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : classification === 'unproductive'
      ? 'border-rose-200 bg-rose-50 text-rose-700'
      : 'border-slate-200 bg-slate-100 text-slate-600';

const pad2 = (n: number) => String(n).padStart(2, '0');
const formatMonth = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
const formatLocalDate = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

const parseTimeToMinutes = (time: string) => {
  // expected "HH:mm:ss" (from backend env ATTENDANCE_LATE_AFTER)
  const [hh, mm] = time.split(':').map((v) => Number(v));
  const h = Number.isFinite(hh) ? hh : 0;
  const m = Number.isFinite(mm) ? mm : 0;
  return h * 60 + m;
};

const HOLIDAY_COUNTRIES = [
  { value: 'ALL', label: 'All Countries' },
  { value: 'INDIA', label: 'India' },
  { value: 'USA', label: 'USA' },
  { value: 'UK', label: 'UK' },
  { value: 'UAE', label: 'UAE' },
  { value: 'AUSTRALIA', label: 'Australia' },
];

const normalizeCountryValue = (value?: string | null) => {
  const normalized = String(value || '').trim().toUpperCase();
  return normalized || 'ALL';
};

const resolveCountryFromSettings = (settings?: Record<string, any> | null) => {
  const explicitCountry = normalizeCountryValue(settings?.country);
  if (explicitCountry !== 'ALL') {
    return explicitCountry;
  }

  const timezone = String(settings?.timezone || '').trim().toLowerCase();
  if (timezone === 'asia/kolkata') return 'INDIA';
  if (timezone.startsWith('america/')) return 'USA';
  if (timezone === 'europe/london') return 'UK';
  if (timezone === 'asia/dubai') return 'UAE';
  if (timezone.startsWith('australia/')) return 'AUSTRALIA';

  return 'ALL';
};

const formatCountryLabel = (value?: string | null) => {
  const normalized = normalizeCountryValue(value);
  const known = HOLIDAY_COUNTRIES.find((country) => country.value === normalized);
  if (known) return known.label;
  if (normalized === 'ALL') return 'All Countries';
  return normalized;
};

const buildMonthGrid = (month: string) => {
  // month: YYYY-MM
  const [y, m] = month.split('-').map((v) => Number(v));
  const first = new Date(y, (m || 1) - 1, 1);
  const start = new Date(first);
  // Monday-based grid
  const day = start.getDay(); // 0 Sun ... 6 Sat
  const diffToMonday = (day + 6) % 7;
  start.setDate(start.getDate() - diffToMonday);

  const weeks: Date[][] = [];
  const cursor = new Date(start);

  for (let w = 0; w < 6; w++) {
    const week: Date[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }

  return { first, weeks };
};

type AttendanceProps = {
  mode?: 'full' | 'time-edit';
};

type SectionFeedback = {
  tone: 'success' | 'error';
  message: string;
} | null;

type PersistedAttendanceFilters = {
  selectedFilterUserId: number | '';
  countryFilter: string;
  calendarScope: 'selected' | 'overall';
  datePreset: DateRangePreset;
  startDate: string;
  endDate: string;
};

const ATTENDANCE_FILTER_STORAGE_KEY = 'attendance-page-filters';
const attendanceDefaultDateRange = deriveDateRangeFromPreset('today');

const getDefaultAttendanceFilters = (): PersistedAttendanceFilters => ({
  selectedFilterUserId: '',
  countryFilter: 'ALL',
  calendarScope: 'selected',
  datePreset: 'today',
  startDate: attendanceDefaultDateRange.startDate,
  endDate: attendanceDefaultDateRange.endDate,
});

const readPersistedAttendanceFilters = (): PersistedAttendanceFilters => {
  const fallback = getDefaultAttendanceFilters();
  const parsed = readSessionStorageJson<PersistedAttendanceFilters>(ATTENDANCE_FILTER_STORAGE_KEY);

  if (!parsed) {
    return fallback;
  }

  const datePreset: DateRangePreset =
    parsed.datePreset === 'today'
    || parsed.datePreset === '2d'
    || parsed.datePreset === '7d'
    || parsed.datePreset === '15d'
    || parsed.datePreset === '30d'
    || parsed.datePreset === 'custom'
      ? parsed.datePreset
      : fallback.datePreset;
  const resolvedRange = resolvePersistedDateRange(
    datePreset,
    typeof parsed.startDate === 'string' && parsed.startDate ? parsed.startDate : fallback.startDate,
    typeof parsed.endDate === 'string' && parsed.endDate ? parsed.endDate : fallback.endDate
  );
  return {
    selectedFilterUserId: coercePositiveNumber(parsed.selectedFilterUserId) ?? '',
    countryFilter: typeof parsed.countryFilter === 'string' && parsed.countryFilter ? parsed.countryFilter : fallback.countryFilter,
    calendarScope: parsed.calendarScope === 'overall' ? 'overall' : fallback.calendarScope,
    datePreset,
    startDate: resolvedRange.startDate,
    endDate: resolvedRange.endDate,
  };
};
export default function Attendance({ mode = 'full' }: AttendanceProps) {
  const navigate = useNavigate();
  const { user, organization } = useAuth();
  const [selectedFilterUserId, setSelectedFilterUserId] = useState<number | ''>(() => readPersistedAttendanceFilters().selectedFilterUserId);
  const [countryFilter, setCountryFilter] = useState(() => readPersistedAttendanceFilters().countryFilter);
  const [calendarScope, setCalendarScope] = useState<'selected' | 'overall'>(() => readPersistedAttendanceFilters().calendarScope);
  const [datePreset, setDatePreset] = useState<DateRangePreset>(() => readPersistedAttendanceFilters().datePreset);
  const [startDate, setStartDate] = useState(() => readPersistedAttendanceFilters().startDate);
  const [endDate, setEndDate] = useState(() => readPersistedAttendanceFilters().endDate);
  const [rows, setRows] = useState<any[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [workingDays, setWorkingDays] = useState(0);
  const [weekendDays, setWeekendDays] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  const [todayRecord, setTodayRecord] = useState<null | {
    id: number | null;
    attendance_date: string;
    check_in_at?: string | null;
    check_out_at?: string | null;
    worked_seconds: number;
    manual_adjustment_seconds: number;
    late_minutes: number;
    status: string;
    is_checked_in: boolean;
    total_break_seconds: number;
    shift_target_seconds: number;
    remaining_shift_seconds: number;
    completed_shift: boolean;
    leave_type?: 'full_day' | 'half_day' | null;
    leave_units?: number;
    punches: Array<{
      id: number;
      punch_in_at: string;
      punch_out_at?: string | null;
      worked_seconds: number;
    }>;
  }>(null);
  const [hasApprovedLeaveToday, setHasApprovedLeaveToday] = useState(false);
  const [lateAfter, setLateAfter] = useState('09:30:00');
  const [isPunchLoading, setIsPunchLoading] = useState(false);

  const [calendarMonth, setCalendarMonth] = useState(formatMonth(new Date()));
  const [calendarDays, setCalendarDays] = useState<any[]>([]);
  const [calendarSummary, setCalendarSummary] = useState<any | null>(null);
  const [isCalendarLoading, setIsCalendarLoading] = useState(false);
  const [holidayItems, setHolidayItems] = useState<any[]>([]);
  const [isHolidayLoading, setIsHolidayLoading] = useState(false);
  const [isHolidaySubmitting, setIsHolidaySubmitting] = useState(false);
  const [isHolidayDeleting, setIsHolidayDeleting] = useState(false);
  const [holidayDate, setHolidayDate] = useState(formatLocalDate(new Date()));
  const [holidayCountry, setHolidayCountry] = useState('ALL');
  const [holidayTitle, setHolidayTitle] = useState('');
  const [holidayDetails, setHolidayDetails] = useState('');
  const [selectedHolidayId, setSelectedHolidayId] = useState<number | null>(null);
  const [leaveRequests, setLeaveRequests] = useState<any[]>([]);
  const [isLeaveLoading, setIsLeaveLoading] = useState(false);
  const [isLeaveSubmitting, setIsLeaveSubmitting] = useState(false);
  const [leaveStartDate, setLeaveStartDate] = useState(formatLocalDate(new Date()));
  const [leaveEndDate, setLeaveEndDate] = useState(formatLocalDate(new Date()));
  const [leaveType, setLeaveType] = useState<'full_day' | 'half_day'>('full_day');
  const [leaveReason, setLeaveReason] = useState('');
  const [timeEditRequests, setTimeEditRequests] = useState<any[]>([]);
  const [isTimeEditLoading, setIsTimeEditLoading] = useState(false);
  const [isTimeEditSubmitting, setIsTimeEditSubmitting] = useState(false);
  const [timeEditDate, setTimeEditDate] = useState(formatLocalDate(new Date()));
  const [extraMinutes, setExtraMinutes] = useState(60);
  const [timeEditMessage, setTimeEditMessage] = useState('');
  const [punchFeedback, setPunchFeedbackState] = useState<SectionFeedback>(null);
  const [holidayFeedback, setHolidayFeedbackState] = useState<SectionFeedback>(null);
  const [leaveFeedback, setLeaveFeedbackState] = useState<SectionFeedback>(null);
  const [timeEditFeedback, setTimeEditFeedbackState] = useState<SectionFeedback>(null);
  const [employeeProfile, setEmployeeProfile] = useState<UserProfile360 | null>(null);
  const [employeeMonitoring, setEmployeeMonitoring] = useState<any | null>(null);
  const [employeeMonitoringScreenshots, setEmployeeMonitoringScreenshots] = useState<any[]>([]);
  const [employeeWebsiteUsage, setEmployeeWebsiteUsage] = useState<any[]>([]);
  const [employeeGroups, setEmployeeGroups] = useState<Array<{ id: number; name: string }>>([]);
  useEffect(() => {
    writeSessionStorageJson(ATTENDANCE_FILTER_STORAGE_KEY, {
      selectedFilterUserId,
      countryFilter,
      calendarScope,
      datePreset,
      startDate,
      endDate,
    } satisfies PersistedAttendanceFilters);
  }, [calendarScope, countryFilter, datePreset, endDate, selectedFilterUserId, startDate]);
  const [organizationMembersCount, setOrganizationMembersCount] = useState(0);
  const [isEmployeePanelLoading, setIsEmployeePanelLoading] = useState(false);
  const [hasHalfDayLeaveToday, setHasHalfDayLeaveToday] = useState(false);
  const [leaveToday, setLeaveToday] = useState<{ leave_type: 'full_day' | 'half_day'; units: number; label: string } | null>(null);

  const isAdmin = hasAdminAccess(user);
  const canSeeAttendanceMonitoring = isAdmin;
  const canAccessAttendance = isAdmin || user?.settings?.attendance_monitoring !== false;
  const canRequestTimeEdit = user?.settings?.can_edit_time !== false;
  const adminUsersQuery = useQuery({
    queryKey: ['attendance-admin-users'],
    queryFn: async () => {
      const response = await userApi.getAll({ period: 'all' });
      return response.data || [];
    },
    enabled: isAdmin,
  });
  const employeeFilterOptions = useMemo(() => {
    const fetchedUsers = Array.isArray(adminUsersQuery.data) ? adminUsersQuery.data : [];
    if (fetchedUsers.length > 0) {
      return fetchedUsers;
    }

    const dedupedUsers = new Map<number, any>();
    rows.forEach((row) => {
      const employee = row?.user;
      const employeeId = Number(employee?.id || 0);
      if (employeeId > 0 && !dedupedUsers.has(employeeId)) {
        dedupedUsers.set(employeeId, employee);
      }
    });

    return Array.from(dedupedUsers.values());
  }, [adminUsersQuery.data, rows]);
  const handleDatePresetChange = (preset: DateRangePreset) => {
    setDatePreset(preset);
    if (preset === 'custom') {
      return;
    }

    const nextRange = deriveDateRangeFromPreset(preset);
    setStartDate(nextRange.startDate);
    setEndDate(nextRange.endDate);
  };

  const setPunchFeedback = (nextMessage = '', nextError = '') => {
    if (nextMessage) {
      setPunchFeedbackState({ tone: 'success', message: nextMessage });
      return;
    }

    if (nextError) {
      setPunchFeedbackState({ tone: 'error', message: nextError });
      return;
    }

    setPunchFeedbackState(null);
  };
  const setHolidayFeedback = (nextMessage = '', nextError = '') => {
    if (nextMessage) {
      setHolidayFeedbackState({ tone: 'success', message: nextMessage });
      return;
    }

    if (nextError) {
      setHolidayFeedbackState({ tone: 'error', message: nextError });
      return;
    }

    setHolidayFeedbackState(null);
  };
  const setLeaveFeedback = (nextMessage = '', nextError = '') => {
    if (nextMessage) {
      setLeaveFeedbackState({ tone: 'success', message: nextMessage });
      return;
    }

    if (nextError) {
      setLeaveFeedbackState({ tone: 'error', message: nextError });
      return;
    }

    setLeaveFeedbackState(null);
  };
  const setTimeEditFeedback = (nextMessage = '', nextError = '') => {
    if (nextMessage) {
      setTimeEditFeedbackState({ tone: 'success', message: nextMessage });
      return;
    }

    if (nextError) {
      setTimeEditFeedbackState({ tone: 'error', message: nextError });
      return;
    }

    setTimeEditFeedbackState(null);
  };
  const fetchAttendance = async () => {
    setIsLoading(true);
    try {
      const response = await reportApi.attendance({
        start_date: startDate,
        end_date: endDate,
        user_id: isAdmin && selectedFilterUserId ? Number(selectedFilterUserId) : undefined,
        country: isAdmin && countryFilter !== 'ALL' ? countryFilter : undefined,
      });
      const payload = response.data as any;
      const nextRows = payload?.data || [];
      setRows(nextRows);
      setWorkingDays(Number(payload?.working_days || 0));
      setWeekendDays(Number(payload?.weekend_days || 0));
      if (!selectedUserId && nextRows.length > 0) {
        setSelectedUserId(nextRows[0].user.id);
      }
    } catch (error) {
      console.error('Attendance fetch failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchToday = async () => {
    try {
      const res = await attendanceApi.today();
      setTodayRecord(res.data.record);
      setLateAfter(res.data.late_after || '09:30:00');
      setHasApprovedLeaveToday(Boolean((res.data as any).has_approved_leave_today));
      setHasHalfDayLeaveToday(Boolean((res.data as any).has_half_day_leave_today));
      setLeaveToday((res.data as any).leave_today || null);
    } catch (e) {
      console.error('Attendance today fetch failed:', e);
    }
  };

  const doCheckIn = async () => {
    setIsPunchLoading(true);
    setPunchFeedback();
    try {
      const res = await attendanceApi.checkIn();
      const payload = res.data as any;
      if (payload?.record) setTodayRecord(payload.record);
      await Promise.all([fetchAttendance(), fetchCalendar(), fetchToday()]);
      setPunchFeedback('Checked in successfully');
    } catch (e) {
      console.error('Check-in failed:', e);
      setPunchFeedback('', (e as any)?.response?.data?.message || 'Check-in failed');
    } finally {
      setIsPunchLoading(false);
    }
  };

  const doCheckOut = async () => {
    setIsPunchLoading(true);
    setPunchFeedback();
    try {
      const res = await attendanceApi.checkOut();
      const payload = res.data as any;
      if (payload?.record) setTodayRecord(payload.record);
      await Promise.all([fetchAttendance(), fetchCalendar(), fetchToday()]);
      setPunchFeedback('Checked out successfully');
    } catch (e) {
      console.error('Check-out failed:', e);
      setPunchFeedback('', (e as any)?.response?.data?.message || 'Check-out failed');
    } finally {
      setIsPunchLoading(false);
    }
  };

  const fetchCalendar = async () => {
    setIsCalendarLoading(true);
    try {
      const res = await attendanceApi.calendar({
        month: calendarMonth,
        user_id: isAdmin && calendarScope === 'selected' ? selectedUserId || undefined : undefined,
        scope: isAdmin ? calendarScope : undefined,
        country: isAdmin && countryFilter !== 'ALL' ? countryFilter : undefined,
      });

      setCalendarDays(res.data.days || []);
      setCalendarSummary(res.data.summary || null);
    } catch (e) {
      console.error('Attendance calendar fetch failed:', e);
    } finally {
      setIsCalendarLoading(false);
    }
  };

  const fetchHolidays = async () => {
    if (!isAdmin) {
      setHolidayItems([]);
      return;
    }

    setIsHolidayLoading(true);
    try {
      const res = await attendanceHolidayApi.list({ month: calendarMonth });
      setHolidayItems((res.data as any)?.data || []);
    } catch (e) {
      console.error('Attendance holidays fetch failed:', e);
    } finally {
      setIsHolidayLoading(false);
    }
  };

  const saveHoliday = async () => {
    if (!holidayDate) {
      setHolidayFeedback('', 'Please select a holiday date.');
      return;
    }

    if (!holidayTitle.trim()) {
      setHolidayFeedback('', 'Please enter a holiday title.');
      return;
    }

    setIsHolidaySubmitting(true);
    setHolidayFeedback();

    try {
      const response = await attendanceHolidayApi.upsert({
        holiday_date: holidayDate,
        country: holidayCountry,
        title: holidayTitle.trim(),
        details: holidayDetails.trim() || undefined,
      });

      const savedHoliday = (response.data as any)?.data || null;
      setSelectedHolidayId(savedHoliday?.id ?? null);
      await Promise.all([fetchHolidays(), fetchCalendar()]);
      setHolidayFeedback((response.data as any)?.message || 'Holiday saved successfully.');
    } catch (error) {
      console.error('Save holiday failed:', error);
      setHolidayFeedback('', (error as any)?.response?.data?.message || 'Failed to save holiday.');
    } finally {
      setIsHolidaySubmitting(false);
    }
  };

  const deleteHoliday = async () => {
    const targetHoliday = selectedHolidayId
      ? holidayItems.find((item) => item.id === selectedHolidayId)
      : holidayItems.find((item) => item.holiday_date === holidayDate && normalizeCountryValue(item.country) === normalizeCountryValue(holidayCountry));

    if (!targetHoliday?.id) {
      setHolidayFeedback('', 'No holiday found for the selected date and country.');
      return;
    }

    if (!confirm('Delete this holiday?')) {
      return;
    }

    setIsHolidayDeleting(true);
    setHolidayFeedback();

    try {
      await attendanceHolidayApi.delete(targetHoliday.id);
      setSelectedHolidayId(null);
      setHolidayTitle('');
      setHolidayDetails('');
      await Promise.all([fetchHolidays(), fetchCalendar()]);
      setHolidayFeedback('Holiday deleted successfully.');
    } catch (error) {
      console.error('Delete holiday failed:', error);
      setHolidayFeedback('', (error as any)?.response?.data?.message || 'Failed to delete holiday.');
    } finally {
      setIsHolidayDeleting(false);
    }
  };

  const fetchLeaveRequests = async () => {
    setIsLeaveLoading(true);
    try {
      const res = await leaveApi.list();
      setLeaveRequests((res.data as any).data || []);
    } catch (e) {
      console.error('Leave requests fetch failed:', e);
    } finally {
      setIsLeaveLoading(false);
    }
  };

  const submitLeaveRequest = async () => {
    if (!leaveStartDate || !leaveEndDate) {
      setLeaveFeedback('', 'Please select start and end date');
      return;
    }

    if (leaveType === 'half_day' && leaveStartDate !== leaveEndDate) {
      setLeaveFeedback('', 'Half day leave can only be requested for one date.');
      return;
    }

    setIsLeaveSubmitting(true);
    setLeaveFeedback();
    try {
      await leaveApi.create({
        start_date: leaveStartDate,
        end_date: leaveEndDate,
        leave_type: leaveType,
        reason: leaveReason || undefined,
      });
      setLeaveReason('');
      setLeaveType('full_day');
      await fetchLeaveRequests();
      await Promise.all([fetchCalendar(), fetchToday(), fetchAttendance()]);
      setLeaveFeedback('Leave request submitted');
    } catch (e) {
      console.error('Leave request submit failed:', e);
      setLeaveFeedback('', (e as any)?.response?.data?.message || 'Failed to submit leave request');
    } finally {
      setIsLeaveSubmitting(false);
    }
  };

  const approveLeave = async (id: number) => {
    setLeaveFeedback();
    try {
      await leaveApi.approve(id);
      await Promise.all([fetchLeaveRequests(), fetchAttendance(), fetchCalendar(), fetchToday()]);
      setLeaveFeedback('Leave request approved');
    } catch (e) {
      console.error('Approve leave failed:', e);
      setLeaveFeedback('', (e as any)?.response?.data?.message || 'Failed to approve leave request');
    }
  };

  const rejectLeave = async (id: number) => {
    setLeaveFeedback();
    try {
      await leaveApi.reject(id);
      await fetchLeaveRequests();
      setLeaveFeedback('Leave request rejected');
    } catch (e) {
      console.error('Reject leave failed:', e);
      setLeaveFeedback('', (e as any)?.response?.data?.message || 'Failed to reject leave request');
    }
  };

  const requestLeaveRevoke = async (id: number) => {
    setLeaveFeedback();
    try {
      await leaveApi.requestRevoke(id);
      await fetchLeaveRequests();
      setLeaveFeedback('Leave revoke request submitted');
    } catch (e) {
      console.error('Leave revoke request failed:', e);
      setLeaveFeedback('', (e as any)?.response?.data?.message || 'Failed to request leave revoke');
    }
  };

  const approveLeaveRevoke = async (id: number) => {
    setLeaveFeedback();
    try {
      await leaveApi.approveRevoke(id);
      await Promise.all([fetchLeaveRequests(), fetchCalendar(), fetchAttendance(), fetchToday()]);
      setLeaveFeedback('Leave revoke approved');
    } catch (e) {
      console.error('Approve leave revoke failed:', e);
      setLeaveFeedback('', (e as any)?.response?.data?.message || 'Failed to approve leave revoke');
    }
  };

  const rejectLeaveRevoke = async (id: number) => {
    setLeaveFeedback();
    try {
      await leaveApi.rejectRevoke(id);
      await fetchLeaveRequests();
      setLeaveFeedback('Leave revoke rejected');
    } catch (e) {
      console.error('Reject leave revoke failed:', e);
      setLeaveFeedback('', (e as any)?.response?.data?.message || 'Failed to reject leave revoke');
    }
  };

  const fetchTimeEditRequests = async () => {
    setIsTimeEditLoading(true);
    try {
      const res = await attendanceTimeEditApi.list();
      setTimeEditRequests((res.data as any).data || []);
    } catch (e) {
      console.error('Time edit requests fetch failed:', e);
    } finally {
      setIsTimeEditLoading(false);
    }
  };

  const submitTimeEditRequest = async () => {
    if (!canRequestTimeEdit) {
      setTimeEditFeedback('', 'Time edit requests are disabled for your account.');
      return;
    }

    if (!timeEditDate || !extraMinutes || extraMinutes <= 0) {
      setTimeEditFeedback('', 'Please enter a valid date and extra minutes');
      return;
    }

    const requestedDay = calendarDays.find((day) => day?.date === timeEditDate);
    if (requestedDay?.status === 'holiday' || requestedDay?.is_holiday) {
      setTimeEditFeedback('', 'Time edit request is not allowed on holidays.');
      return;
    }
    if (requestedDay?.status === 'leave' || (requestedDay?.is_leave && !requestedDay?.is_half_leave)) {
      setTimeEditFeedback('', 'Time edit request is not allowed on leave days.');
      return;
    }

    setIsTimeEditSubmitting(true);
    setTimeEditFeedback();
    try {
      const response = await attendanceTimeEditApi.create({
        attendance_date: timeEditDate,
        extra_minutes: extraMinutes,
        message: timeEditMessage || undefined,
      });
      setTimeEditMessage('');
      await fetchTimeEditRequests();
      setTimeEditFeedback((response.data as any)?.message || 'Time edit request submitted and sent to your group manager.');
    } catch (e) {
      console.error('Time edit request submit failed:', e);
      setTimeEditFeedback('', (e as any)?.response?.data?.message || 'Failed to submit time edit request');
    } finally {
      setIsTimeEditSubmitting(false);
    }
  };

  const approveTimeEdit = async (id: number) => {
    setTimeEditFeedback();
    try {
      await attendanceTimeEditApi.approve(id);
      await Promise.all([fetchTimeEditRequests(), fetchAttendance(), fetchCalendar(), fetchToday()]);
      setTimeEditFeedback('Time edit request approved');
    } catch (e) {
      console.error('Approve time edit failed:', e);
      setTimeEditFeedback('', (e as any)?.response?.data?.message || 'Failed to approve time edit request');
    }
  };

  const rejectTimeEdit = async (id: number) => {
    setTimeEditFeedback();
    try {
      await attendanceTimeEditApi.reject(id);
      await fetchTimeEditRequests();
      setTimeEditFeedback('Time edit request rejected');
    } catch (e) {
      console.error('Reject time edit failed:', e);
      setTimeEditFeedback('', (e as any)?.response?.data?.message || 'Failed to reject time edit request');
    }
  };

  useEffect(() => {
    if (mode !== 'full') return;
    fetchAttendance();
  }, [countryFilter, endDate, isAdmin, mode, selectedFilterUserId, startDate]);

  useEffect(() => {
    fetchTimeEditRequests();
    if (mode !== 'full') return;
    fetchToday();
    fetchLeaveRequests();
  }, [mode]);

  useEffect(() => {
    if (mode !== 'full') return;
    if (!isAdmin) {
      fetchCalendar();
      return;
    }

    if (calendarScope === 'overall' || selectedUserId) {
      fetchCalendar();
    }
  }, [calendarMonth, calendarScope, countryFilter, isAdmin, mode, selectedUserId]);

  useEffect(() => {
    if (mode !== 'full' || !isAdmin) return;
    fetchHolidays();
  }, [calendarMonth, isAdmin, mode]);

  useEffect(() => {
    if (mode !== 'full') return;

    const interval = window.setInterval(() => {
      if (document.visibilityState !== 'visible') {
        return;
      }

      void fetchAttendance();
      void fetchCalendar();
      void fetchToday();
    }, 30000);

    return () => window.clearInterval(interval);
  }, [calendarMonth, calendarScope, countryFilter, endDate, isAdmin, mode, selectedFilterUserId, selectedUserId, startDate]);

  useEffect(() => {
    if (!isAdmin) return;
    if (selectedFilterUserId) {
      setSelectedUserId(Number(selectedFilterUserId));
      return;
    }

    if (rows.length === 0) {
      setSelectedUserId(null);
      return;
    }

    const hasSelectedRow = rows.some((row) => row?.user?.id === selectedUserId);
    if (!hasSelectedRow) {
      setSelectedUserId(rows[0].user.id);
    }
  }, [isAdmin, rows, selectedUserId]);

  useEffect(() => {
    if (!user?.id) return;
    const preferredCountry = resolveCountryFromSettings((user as any)?.settings);
    if (preferredCountry !== 'ALL') {
      setHolidayCountry(preferredCountry);
    }
  }, [user?.id]);

  useEffect(() => {
    if (mode !== 'full' || isAdmin || !user?.id) return;

    let active = true;

    const fetchEmployeePanel = async () => {
      setIsEmployeePanelLoading(true);
      try {
        const requests: Promise<any>[] = [
          userApi.getProfile360(user.id, { start_date: startDate, end_date: endDate }),
          userApi.getGroups(user.id),
        ];

        if (organization?.id) {
          requests.push(organizationApi.getMembers(organization.id));
        }

        const [profileResponse, groupsResponse, membersResponse] = await Promise.all(requests);

        if (!active) return;

        setEmployeeProfile(profileResponse.data || null);
        setEmployeeGroups(((groupsResponse.data?.data || []) as any[]).map((group) => ({ id: group.id, name: group.name })));
        setOrganizationMembersCount(Array.isArray((membersResponse as any)?.data) ? (membersResponse as any).data.length : 1);
      } catch (fetchError) {
        console.error('Employee attendance panel fetch failed:', fetchError);
        if (active) {
          setEmployeeProfile(null);
          setEmployeeGroups([]);
          setOrganizationMembersCount(1);
        }
      } finally {
        if (active) {
          setIsEmployeePanelLoading(false);
        }
      }
    };

    void fetchEmployeePanel();

    return () => {
      active = false;
    };
  }, [endDate, isAdmin, mode, organization?.id, startDate, user?.id]);

  useEffect(() => {
    if (mode !== 'full') return;
    if (!canSeeAttendanceMonitoring) {
      setEmployeeMonitoring(null);
      setEmployeeMonitoringScreenshots([]);
      setEmployeeWebsiteUsage([]);
      return;
    }

    const monitoringUserId = selectedUserId;
    if (!monitoringUserId) return;

    let active = true;

    const fetchMonitoringPanel = async () => {
      try {
        const [insightsResponse, screenshotsResponse, websiteResponse] = await Promise.all([
          reportApi.employeeInsights({ start_date: startDate, end_date: endDate, user_id: monitoringUserId }),
          screenshotApi.getAll({ user_id: monitoringUserId, start_date: startDate, end_date: endDate, page: 1 }),
          activityApi.getAll({ user_id: monitoringUserId, type: 'url', start_date: startDate, end_date: endDate, page: 1 }),
        ]);

        if (!active) return;

        const websiteRows = ((websiteResponse.data as any)?.data || []).reduce((rows: any[], item: any) => {
          const website = normalizeToolLabel(item.name || '', item.type || 'url');
          const classification = classifyProductivity(website, item.type || 'url');
          const existing = rows.find((row) => row.website === website && row.classification === classification);

          if (existing) {
            existing.duration += Number(item.duration || 0);
            existing.events += 1;
            existing.lastUsedAt =
              item.recorded_at && (!existing.lastUsedAt || +new Date(item.recorded_at) > +new Date(existing.lastUsedAt))
                ? item.recorded_at
                : existing.lastUsedAt;
            return rows;
          }

          rows.push({
            website,
            classification,
            duration: Number(item.duration || 0),
            events: 1,
            lastUsedAt: item.recorded_at || null,
          });
          return rows;
        }, []).sort((a: any, b: any) => Number(b.duration || 0) - Number(a.duration || 0));

        setEmployeeMonitoring((insightsResponse.data as any) || null);
        setEmployeeMonitoringScreenshots(((screenshotsResponse.data as any)?.data || []).slice(0, 8));
        setEmployeeWebsiteUsage(websiteRows);
      } catch (monitoringError) {
        console.error('Attendance monitoring panel fetch failed:', monitoringError);
        if (active) {
          setEmployeeMonitoring(null);
          setEmployeeMonitoringScreenshots([]);
          setEmployeeWebsiteUsage([]);
        }
      }
    };

    void fetchMonitoringPanel();

    return () => {
      active = false;
    };
  }, [canSeeAttendanceMonitoring, endDate, mode, selectedUserId, startDate]);

  const selectedRow = rows.find((row) => row.user.id === selectedUserId) || rows[0];
  const employeePanelUser = employeeProfile?.user || user;
  const attendancePanelUser = isAdmin ? selectedRow?.user : employeePanelUser;
  const monitoringUserId = canSeeAttendanceMonitoring ? selectedUserId : null;
  const canReviewLeaveRequest = (item: any) => canReviewApprovalRequest(user, item?.user);
  const canReviewTimeEditRequest = (item: any) => canReviewApprovalRequest(user, item?.user);
  const pendingLeaveRequests = useMemo(
    () => leaveRequests.filter((item) => item.status === 'pending' && canReviewApprovalRequest(user, item?.user)),
    [leaveRequests, user]
  );
  const pendingTimeEditRequests = useMemo(
    () => timeEditRequests.filter((item) => item.status === 'pending' && canReviewApprovalRequest(user, item?.user)),
    [timeEditRequests, user]
  );

  const lateLabel = useMemo(() => {
    if (!todayRecord?.check_in_at) return null;
    const checkIn = new Date(todayRecord.check_in_at);
    const mins = checkIn.getHours() * 60 + checkIn.getMinutes();
    const lateMins = Math.max(0, mins - parseTimeToMinutes(lateAfter));
    if (lateMins <= 0) return null;
    return `${lateMins} min late`;
  }, [todayRecord?.check_in_at, lateAfter]);

  const monthGrid = useMemo(() => buildMonthGrid(calendarMonth), [calendarMonth]);
  const todayDate = useMemo(() => formatLocalDate(new Date()), []);
  const canRequestRevoke = (item: any) => {
    if (!item || item.status !== 'approved' || item.revoke_status) return false;
    const [y, m, d] = String(item.start_date || '').split('-').map((v: string) => Number(v));
    if (!y || !m || !d) return false;
    const deadline = new Date(y, m - 1, d - 1);
    return todayDate <= formatLocalDate(deadline);
  };
  const calendarMap = useMemo(() => {
    const map = new Map<string, any>();
    for (const d of calendarDays) map.set(d.date, d);
    return map;
  }, [calendarDays]);
  const holidayMapByDateAndCountry = useMemo(() => {
    const map = new Map<string, any>();
    for (const holiday of holidayItems) {
      map.set(`${holiday.holiday_date}|${normalizeCountryValue(holiday.country)}`, holiday);
    }
    return map;
  }, [holidayItems]);

  useEffect(() => {
    if (!isAdmin) return;
    const selectedKey = `${holidayDate}|${normalizeCountryValue(holidayCountry)}`;
    const matchedHoliday = holidayMapByDateAndCountry.get(selectedKey);

    if (!matchedHoliday) {
      setSelectedHolidayId(null);
      setHolidayTitle('');
      setHolidayDetails('');
      return;
    }

    setSelectedHolidayId(matchedHoliday.id);
    setHolidayTitle(matchedHoliday.title || '');
    setHolidayDetails(matchedHoliday.details || '');
  }, [holidayCountry, holidayDate, holidayMapByDateAndCountry, isAdmin]);

  const employeeAttendanceRow = useMemo(
    () => rows.find((row) => Number(row?.user?.id) === Number(user?.id)) || null,
    [rows, user?.id]
  );
  const employeeWorkspaceGroups = useMemo(
    () => (employeeGroups.length ? employeeGroups : ((user as any)?.groups || []).map((group: any) => ({ id: group.id, name: group.name }))),
    [employeeGroups, user]
  );
  const employeeWorkspaceIsWorking = Boolean(
    employeeProfile?.status?.is_working
    || employeeAttendanceRow?.is_working
    || todayRecord?.is_checked_in
  );
  const employeeWorkspaceLastSeenLabel = employeeProfile?.status?.last_seen_at
    ? new Date(employeeProfile.status.last_seen_at).toLocaleString()
    : employeeWorkspaceIsWorking
      ? 'Active now'
      : 'Unavailable';
  const employeeWorkspaceCurrentTask =
    employeeProfile?.status?.current_task
    || employeeProfile?.status?.current_project
    || (employeeWorkspaceIsWorking ? 'Timer running' : 'No active task');
  const employeeWorkspaceCurrentTaskHint =
    employeeWorkspaceIsWorking
      ? employeeProfile?.status?.current_task || employeeProfile?.status?.current_project
        ? 'You are currently working'
        : 'Timer is active without a selected task'
      : 'No active timer right now';
  const employeeSummaryCards = useMemo(
    () => [
      {
        label: 'Workspace Users',
        value: String(organizationMembersCount || 0),
        hint: 'People in your organization',
        icon: Users,
      },
      {
        label: 'Groups',
        value: String(employeeWorkspaceGroups.length),
        hint: employeeWorkspaceGroups.length ? employeeWorkspaceGroups.map((group) => group.name).join(', ') : 'No group assigned yet',
        icon: Layers3,
      },
      {
        label: 'Current Task',
        value: employeeWorkspaceCurrentTask,
        hint: employeeWorkspaceCurrentTaskHint,
        icon: Briefcase,
      },
      {
        label: 'Recent Tasks',
        value: String(new Set((employeeProfile?.recent_time_entries || []).map((entry) => entry.task?.id || entry.project?.id).filter(Boolean)).size),
        hint:
          (employeeProfile?.recent_time_entries || [])
            .map((entry) => entry.task?.title || entry.project?.name)
            .filter(Boolean)
            .filter((value, index, list) => list.indexOf(value) === index)
            .slice(0, 3)
            .join(', ') || 'Tasks will appear here after time is tracked',
        icon: FolderKanban,
      },
    ],
    [
      employeeProfile,
      employeeWorkspaceCurrentTask,
      employeeWorkspaceCurrentTaskHint,
      employeeWorkspaceGroups,
      organizationMembersCount,
    ]
  );
  const employeeLiveMonitoring = employeeMonitoring?.live_monitoring?.selected_user || null;
  const openMonitoringScreenshotGallery = () => {
    if (!monitoringUserId) return;

    const params = new URLSearchParams();
    params.set('user', String(monitoringUserId));
    params.set('start', startDate);
    params.set('end', endDate);
    navigate(`/monitoring/screenshots?${params.toString()}`);
  };

  if (!canAccessAttendance && mode !== 'time-edit') {
    return (
      <PageEmptyState
        title="Attendance monitoring disabled"
        description="Attendance monitoring is not enabled for your account."
      />
    );
  }

  if (mode === 'time-edit') {
    if (!canRequestTimeEdit) {
      return (
        <PageEmptyState
          title="Edit time disabled"
          description="Time edit requests are not enabled for your account."
        />
      );
    }

    return (
      <div className="space-y-6 animate-fade-in">
        <PageHeader eyebrow="Attendance adjustments" title="Edit Time" description="Request overtime or attendance time adjustments and review approval status." />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {timeEditFeedback ? (
            <div className="lg:col-span-2">
              <FeedbackBanner tone={timeEditFeedback.tone} message={timeEditFeedback.message} />
            </div>
          ) : null}
          <SurfaceCard className="p-4">
            <h2 className="font-semibold text-gray-900 mb-3">Request Time Edit / Overtime</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <FieldLabel>Attendance Date</FieldLabel>
                <TextInput type="date" value={timeEditDate} onChange={(e) => setTimeEditDate(e.target.value)} />
              </div>
              <div>
                <FieldLabel>Extra Minutes</FieldLabel>
                <TextInput
                  type="number"
                  min={1}
                  max={600}
                  value={extraMinutes}
                  onChange={(e) => setExtraMinutes(Number(e.target.value))}
                />
              </div>
            </div>
            <div className="mt-3">
              <FieldLabel>Message to Admin</FieldLabel>
              <TextareaInput
                value={timeEditMessage}
                onChange={(e) => setTimeEditMessage(e.target.value)}
                rows={3}
                placeholder="Example: I worked 1 hour extra after shift due to release deployment."
              />
            </div>
            <div className="mt-3">
              <Button onClick={submitTimeEditRequest} disabled={isTimeEditSubmitting}>
                {isTimeEditSubmitting ? 'Submitting...' : 'Submit Time Edit Request'}
              </Button>
            </div>
          </SurfaceCard>

          <SurfaceCard className="p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">Time Edit Requests</h2>
              <Button onClick={fetchTimeEditRequests} variant="ghost" size="sm">Refresh</Button>
            </div>
            {isTimeEditLoading ? (
              <PageLoadingState label="Loading requests..." />
            ) : timeEditRequests.length === 0 ? (
              <PageEmptyState title="No time edit requests found" description="Submitted overtime and time adjustments will appear here." />
            ) : (
              <div className="mt-3 space-y-2 max-h-72 overflow-auto">
                {timeEditRequests.map((item) => (
                  <div key={item.id} className="rounded-[22px] border border-slate-200 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-gray-900">
                        {item.user?.name || 'You'}: {item.attendance_date} (+{formatDuration(item.extra_seconds)})
                      </p>
                      <StatusBadge tone={item.status === 'approved' ? 'success' : item.status === 'rejected' ? 'danger' : 'warning'}>{item.status}</StatusBadge>
                    </div>
                    {item.approval_destination ? (
                      <p className="mt-1 text-xs font-medium text-sky-700">{item.approval_destination}</p>
                    ) : null}
                    {item.message ? <p className="text-xs text-gray-600 mt-1">{item.message}</p> : null}
                    {canReviewTimeEditRequest(item) && item.status === 'pending' ? (
                      <div className="mt-2 flex gap-2">
                        <Button onClick={() => approveTimeEdit(item.id)} size="sm" className="bg-emerald-600 shadow-[0_18px_40px_-24px_rgba(5,150,105,0.6)] hover:bg-emerald-700">Approve</Button>
                        <Button onClick={() => rejectTimeEdit(item.id)} variant="danger" size="sm">Reject</Button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
            {pendingTimeEditRequests.length > 0 ? (
              <p className="text-xs text-gray-500 mt-2">Pending approvals: {pendingTimeEditRequests.length}</p>
            ) : null}
          </SurfaceCard>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader eyebrow="Attendance operations" title="Attendance" description={isAdmin ? 'Track attendance, punches, leave, and overtime requests across the team.' : 'Review your attendance, punches, leave requests, and overtime history.'} />

      <FilterPanel className={`grid grid-cols-1 gap-3 ${isAdmin ? 'md:grid-cols-6' : 'md:grid-cols-3'}`}>
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
        />
        {isAdmin && (
          <div>
            <FieldLabel>Employee</FieldLabel>
            <EmployeeSelect
              employees={employeeFilterOptions}
              value={selectedFilterUserId}
              onChange={setSelectedFilterUserId}
              includeAllOption
            />
          </div>
        )}
        {isAdmin && (
          <div>
            <FieldLabel>Country</FieldLabel>
            <SelectInput value={countryFilter} onChange={(e) => setCountryFilter(normalizeCountryValue(e.target.value))}>
              {HOLIDAY_COUNTRIES.map((country) => (
                <option key={country.value} value={country.value}>{country.label}</option>
              ))}
            </SelectInput>
          </div>
        )}
        {isAdmin && (
          <div>
            <FieldLabel>Calendar View</FieldLabel>
            <SelectInput value={calendarScope} onChange={(e) => setCalendarScope(e.target.value as 'selected' | 'overall')}>
              <option value="selected">Selected Employee</option>
              <option value="overall">Overall</option>
            </SelectInput>
          </div>
        )}
      </FilterPanel>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <MetricCard label="Working Days" value={workingDays} hint="Excluding weekends" icon={CalendarDays} accent="sky" />
        <MetricCard label="Weekend Days" value={weekendDays} hint="Within selected range" icon={Clock} accent="amber" />
        <MetricCard label="Employees in View" value={rows.length} hint={isAdmin ? 'Based on current filter' : 'Your own attendance view'} icon={Users} accent="emerald" />

        {!isAdmin ? (
          <SurfaceCard className="lg:col-span-3 p-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-sky-700">Attendance Workspace</p>
                <h2 className="mt-2 text-xl font-semibold text-slate-950">
                  {employeePanelUser?.name || 'Your profile'}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {employeePanelUser?.email || 'No email available'}
                  {employeePanelUser?.role ? <span className="ml-2 capitalize">• {employeePanelUser.role}</span> : null}
                </p>
                <p className="mt-2 text-sm text-slate-600">
                  {organization?.name || 'Organization workspace'}
                </p>
              </div>
              <div className="rounded-[24px] border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-600">
                {isEmployeePanelLoading ? (
                  <p>Loading workspace details...</p>
                ) : (
                  <>
                    <p>
                      Working now: <span className="font-semibold text-slate-950">{employeeWorkspaceIsWorking ? 'Yes' : 'No'}</span>
                    </p>
                    <p className="mt-1">
                      Last seen:{' '}
                      <span className="font-semibold text-slate-950">
                        {employeeWorkspaceLastSeenLabel}
                      </span>
                    </p>
                  </>
                )}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              {employeeSummaryCards.map((item) => (
                <div key={item.label} className="rounded-[24px] border border-slate-200 bg-white/85 p-4 shadow-[0_18px_38px_-28px_rgba(15,23,42,0.25)]">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{item.label}</p>
                    <item.icon className="h-4 w-4 text-sky-700" />
                  </div>
                  <p className="mt-3 text-lg font-semibold text-slate-950">{item.value}</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">{item.hint}</p>
                </div>
              ))}
            </div>
          </SurfaceCard>
        ) : null}

        {canSeeAttendanceMonitoring ? (
        <SurfaceCard className="lg:col-span-3 p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-sky-700">Monitoring Panel</p>
              <h2 className="mt-2 text-xl font-semibold text-slate-950">
                {attendancePanelUser?.name || employeePanelUser?.name || 'Employee monitoring'}
              </h2>
              <p className="mt-1 text-sm text-slate-500">Live activity, screenshot previews, and website productivity directly inside attendance.</p>
            </div>
            <div className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold capitalize ${productivityTone(employeeLiveMonitoring?.classification)}`}>
              {employeeLiveMonitoring?.classification || 'neutral'}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="rounded-[22px] border border-slate-200 bg-slate-50/70 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Current tool</p>
              <p className="mt-2 text-sm font-semibold text-slate-950">{employeeLiveMonitoring?.current_tool || 'No active tool detected'}</p>
              <p className="mt-1 text-xs capitalize text-slate-500">{employeeLiveMonitoring?.tool_type || employeeLiveMonitoring?.activity_type || 'No tool type'}</p>
            </div>
            <div className="rounded-[22px] border border-slate-200 bg-slate-50/70 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Work status</p>
              <p className="mt-2 text-sm font-semibold capitalize text-slate-950">{employeeLiveMonitoring?.work_status?.replace('_', ' ') || 'inactive'}</p>
              <p className="mt-1 text-xs text-slate-500">{employeeLiveMonitoring?.is_working ? 'Timer active now' : 'No active timer right now'}</p>
            </div>
            <div className="rounded-[22px] border border-slate-200 bg-slate-50/70 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Last activity</p>
              <p className="mt-2 text-sm font-semibold text-slate-950">{formatDateTime(employeeLiveMonitoring?.last_activity_at)}</p>
              <p className="mt-1 text-xs text-slate-500">{employeeMonitoring?.stats?.activity_events || 0} activity events in selected range</p>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[1.15fr_0.85fr]">
            <div className="rounded-[24px] border border-slate-200 bg-white/85 p-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-semibold text-slate-950">Screenshot captures</h3>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">{employeeMonitoringScreenshots.length} shown</span>
                  <Button
                    variant="secondary"
                    size="sm"
                    iconLeft={<Eye className="h-4 w-4" />}
                    onClick={openMonitoringScreenshotGallery}
                    disabled={!monitoringUserId || employeeMonitoringScreenshots.length === 0}
                  >
                    View all screenshots
                  </Button>
                </div>
              </div>
              {employeeMonitoringScreenshots.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">No screenshots found for the selected employee in this attendance panel.</p>
              ) : (
                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {employeeMonitoringScreenshots.map((shot: any) => (
                    <a
                      key={shot.id}
                      href={shot.path}
                      target="_blank"
                      rel="noreferrer"
                      className="overflow-hidden rounded-[20px] border border-slate-200 bg-white transition hover:border-sky-200"
                    >
                      <img src={shot.path} alt={shot.filename || `Screenshot ${shot.id}`} className="h-32 w-full object-cover" />
                      <div className="space-y-2 p-3">
                        <p className="text-xs font-semibold text-slate-950">{formatDateTime(shot.recorded_at)}</p>
                        <p className="text-[11px] text-slate-500">{shot.filename || 'Captured screenshot'}</p>
                      </div>
                    </a>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-[24px] border border-slate-200 bg-white/85 p-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-semibold text-slate-950">Website productivity</h3>
                <span className="text-xs text-slate-500">Selected range</span>
              </div>
              {employeeWebsiteUsage.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">No website usage found for this employee.</p>
              ) : (
                <div className="mt-4 space-y-3">
                  {employeeWebsiteUsage.slice(0, 6).map((item: any) => (
                    <div key={`${item.website}-${item.classification}`} className="rounded-[20px] border border-slate-200 bg-slate-50/70 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-slate-950">{item.website}</p>
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold capitalize ${productivityTone(item.classification)}`}>
                          {item.classification}
                        </span>
                      </div>
                      <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                        <span>{formatDuration(item.duration || 0)}</span>
                        <span>{item.events} events</span>
                      </div>
                      <p className="mt-1 text-[11px] text-slate-500">Last used: {formatDateTime(item.lastUsedAt)}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </SurfaceCard>
        ) : null}

        <SurfaceCard className="lg:col-span-3 p-4">
          {punchFeedback ? (
            <div className="mb-4">
              <FeedbackBanner tone={punchFeedback.tone} message={punchFeedback.message} />
            </div>
          ) : null}
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-gray-900">Today</p>
              <p className="text-xs text-gray-500">
                {todayRecord?.attendance_date || formatLocalDate(new Date())}
                {lateLabel ? <span className="ml-2 text-red-600 font-medium">({lateLabel})</span> : null}
              </p>
              {hasApprovedLeaveToday ? (
                <p className="text-xs text-red-600 mt-1">Approved leave for today. Punch-in is disabled.</p>
              ) : null}
              {hasHalfDayLeaveToday ? (
                <p className="text-xs text-amber-700 mt-1">
                  Half day leave applied for today. Your shift target is reduced to {formatDuration(todayRecord?.shift_target_seconds || 4 * 3600)}.
                </p>
              ) : null}
              {leaveToday && !hasApprovedLeaveToday && !hasHalfDayLeaveToday ? (
                <p className="text-xs text-slate-600 mt-1">{leaveToday.label}</p>
              ) : null}
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div className="rounded-lg border border-gray-200 px-3 py-2">
                  <p className="text-[11px] text-gray-500">First Punch In</p>
                  <p className="text-sm font-semibold text-gray-900">{todayRecord?.check_in_at ? new Date(todayRecord.check_in_at).toLocaleTimeString() : '--'}</p>
                </div>
                <div className="rounded-lg border border-gray-200 px-3 py-2">
                  <p className="text-[11px] text-gray-500">Last Punch Out</p>
                  <p className="text-sm font-semibold text-gray-900">{todayRecord?.check_out_at ? new Date(todayRecord.check_out_at).toLocaleTimeString() : '--'}</p>
                </div>
                <div className="rounded-lg border border-gray-200 px-3 py-2">
                  <p className="text-[11px] text-gray-500">Working Hours</p>
                  <p className="text-sm font-semibold text-gray-900">{formatDuration(todayRecord?.worked_seconds || 0)}</p>
                </div>
                <div className="rounded-lg border border-gray-200 px-3 py-2">
                  <p className="text-[11px] text-gray-500">Approved Extra Time</p>
                  <p className="text-sm font-semibold text-gray-900">{formatDuration(todayRecord?.manual_adjustment_seconds || 0)}</p>
                </div>
                <div className="rounded-lg border border-gray-200 px-3 py-2">
                  <p className="text-[11px] text-gray-500">Break Time</p>
                  <p className="text-sm font-semibold text-gray-900">{formatDuration(todayRecord?.total_break_seconds || 0)}</p>
                </div>
                <div className="rounded-lg border border-gray-200 px-3 py-2">
                  <p className="text-[11px] text-gray-500">Remaining Shift</p>
                  <p className="text-sm font-semibold text-gray-900">{formatDuration(todayRecord?.remaining_shift_seconds || 0)}</p>
                </div>
                <div className="rounded-lg border border-gray-200 px-3 py-2">
                  <p className="text-[11px] text-gray-500">Shift Target</p>
                  <p className="text-sm font-semibold text-gray-900">{formatDuration(todayRecord?.shift_target_seconds || 8 * 3600)}</p>
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <Button onClick={doCheckIn} disabled={isPunchLoading || !!todayRecord?.is_checked_in || hasApprovedLeaveToday} variant="secondary">
                Punch In
              </Button>
              <Button onClick={doCheckOut} disabled={isPunchLoading || !todayRecord?.is_checked_in}>
                Punch Out
              </Button>
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-3">
            Late threshold: {lateAfter}
          </p>
          {todayRecord?.punches?.length ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {todayRecord.punches.map((punch) => (
                <span key={punch.id} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-700">
                  {new Date(punch.punch_in_at).toLocaleTimeString()} - {punch.punch_out_at ? new Date(punch.punch_out_at).toLocaleTimeString() : 'Active'}
                </span>
              ))}
            </div>
          ) : null}
        </SurfaceCard>
      </div>

      <SurfaceCard className="overflow-hidden">
        <div className="max-h-[26rem] overflow-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50/80">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Employee</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Present Days</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Leave Days</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Attendance %</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Worked</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Status</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td className="px-4 py-6" colSpan={6}><PageLoadingState label="Loading attendance records..." /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td className="px-4 py-6" colSpan={6}><PageEmptyState title="No attendance records" description="Attendance data will appear here for the selected date range." /></td></tr>
            ) : rows.map((row) => (
              <tr
                key={row.user.id}
                className={`cursor-pointer border-b border-slate-100 transition hover:bg-slate-50/70 ${selectedRow?.user?.id === row.user.id ? 'bg-sky-50/80' : ''}`}
                onClick={() => setSelectedUserId(row.user.id)}
              >
                <td className="px-4 py-3">
                  <p className="font-medium text-gray-900">{row.user.name}</p>
                  <p className="text-xs text-gray-500">{row.user.email}</p>
                </td>
                <td className="px-4 py-3 text-gray-700">{row.days_present} / {row.calendar_days_in_range || row.working_days_in_range}</td>
                <td className="px-4 py-3 text-gray-700">{row.leave_days}</td>
                <td className="px-4 py-3 text-gray-700">{row.attendance_rate}%</td>
                <td className="px-4 py-3 text-gray-700">{formatDuration(row.worked_seconds)}</td>
                <td className="px-4 py-3">
                  <StatusBadge tone={row.is_working ? 'success' : 'neutral'}>{row.is_working ? 'Working' : 'Not Working'}</StatusBadge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </SurfaceCard>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <SurfaceCard className="lg:col-span-2 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-gray-900">Attendance Calendar</h2>
              {isAdmin ? (
                <p className="text-xs text-slate-500 mt-1">
                  {calendarScope === 'overall'
                    ? `Overall view (${formatCountryLabel(countryFilter)})`
                    : `Selected employee${selectedRow?.user?.name ? `: ${selectedRow.user.name}` : ''}`}
                </p>
              ) : null}
            </div>

            <div className="flex items-center gap-2">
              <Button
                onClick={() => {
                  const [y, m] = calendarMonth.split('-').map((v) => Number(v));
                  const d = new Date(y, (m || 1) - 2, 1);
                  setCalendarMonth(formatMonth(d));
                }}
                variant="secondary"
                size="sm"
              >
                Prev
              </Button>
              <TextInput
                type="month"
                value={calendarMonth}
                onChange={(e) => setCalendarMonth(e.target.value)}
                className="max-w-[10rem]"
              />
              <Button
                onClick={() => {
                  const [y, m] = calendarMonth.split('-').map((v) => Number(v));
                  const d = new Date(y, (m || 1), 1);
                  setCalendarMonth(formatMonth(d));
                }}
                variant="secondary"
                size="sm"
              >
                Next
              </Button>
            </div>
          </div>

          {isCalendarLoading ? (
            <div className="py-10 text-sm text-gray-500">Loading calendar...</div>
          ) : (
            <div className="mt-3">
              <div className="grid grid-cols-7 text-xs text-gray-500">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
                  <div key={d} className="px-2 py-2 font-medium">{d}</div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-2">
                {monthGrid.weeks.flat().map((d) => {
                  const ds = formatLocalDate(d);
                  const inMonth = ds.startsWith(calendarMonth);
                  const item = calendarMap.get(ds);
                  const status = item?.status || 'none';
                  const statusLabel =
                    status === 'leave'
                      ? 'take a leave'
                      : status === 'half_leave'
                        ? 'half day'
                      : status === 'holiday'
                        ? item?.holiday?.title || 'holiday'
                      : status === 'none'
                        ? ''
                        : String(status).replace('_', ' ');

                  const color =
                    status === 'present'
                      ? 'bg-green-50 border-green-200 text-green-900'
                      : status === 'checked_in'
                        ? 'bg-blue-50 border-blue-200 text-blue-900'
                        : status === 'leave'
                          ? 'bg-red-50 border-red-200 text-red-900'
                          : status === 'half_leave'
                            ? 'bg-orange-50 border-orange-200 text-orange-900'
                          : status === 'holiday'
                            ? 'bg-amber-50 border-amber-200 text-amber-900'
                          : 'bg-gray-50 border-gray-200 text-gray-600';
                  const canEditHolidayCell = isAdmin && inMonth;
                  const tooltip = item
                    ? [
                        item.date,
                        `status ${status}`,
                        item?.leave_units ? `leave units ${item.leave_units}` : null,
                        item?.holiday?.title ? `holiday ${item.holiday.title}` : null,
                        item?.holiday?.country ? `country ${formatCountryLabel(item.holiday.country)}` : null,
                        `worked ${formatDuration(item.worked_seconds || 0)}`,
                        `late ${item.late_minutes || 0}m`,
                      ]
                        .filter(Boolean)
                        .join(' - ')
                    : ds;

                  return (
                    <div
                      key={ds}
                      className={`min-h-[68px] rounded-lg border px-2 py-2 ${color} ${inMonth ? '' : 'opacity-40'} ${canEditHolidayCell ? 'cursor-pointer transition hover:ring-1 hover:ring-sky-300' : ''}`}
                      title={tooltip}
                      onClick={() => {
                        if (!canEditHolidayCell) return;
                        setHolidayFeedback();
                        setHolidayDate(ds);

                        const matchingHoliday = holidayMapByDateAndCountry.get(`${ds}|${normalizeCountryValue(holidayCountry)}`);
                        if (matchingHoliday) {
                          setSelectedHolidayId(matchingHoliday.id);
                          setHolidayTitle(matchingHoliday.title || '');
                          setHolidayDetails(matchingHoliday.details || '');
                          return;
                        }

                        if (item?.holiday?.country) {
                          setHolidayCountry(normalizeCountryValue(item.holiday.country));
                        } else {
                          setSelectedHolidayId(null);
                          setHolidayTitle('');
                          setHolidayDetails('');
                        }
                      }}
                    >
                      <div className="flex items-start justify-between">
                        <div className="text-xs font-semibold">{d.getDate()}</div>
                        {item?.late_minutes > 0 ? <div className="text-[10px] font-semibold text-red-700">Late</div> : null}
                      </div>
                      {statusLabel ? (
                        <div className={`mt-1 text-[10px] ${status === 'holiday' ? 'font-semibold leading-4' : 'uppercase tracking-wide'}`}>{statusLabel}</div>
                      ) : null}
                      {status === 'holiday' && item?.holiday?.country ? (
                        <div className="mt-1 text-[10px] font-medium">{formatCountryLabel(item.holiday.country)}</div>
                      ) : null}
                      {item?.worked_seconds ? (
                        <div className="mt-1 text-[11px] font-medium">{formatDuration(item.worked_seconds)}</div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </SurfaceCard>

        <SurfaceCard className="p-4">
          <h2 className="font-semibold text-gray-900 mb-3">Monthly Summary</h2>
          {calendarSummary ? (
            <div className="space-y-3 text-sm">
              {isAdmin && calendarScope === 'overall' ? (
                <div className="flex items-center justify-between">
                  <span className="text-gray-600">Employees Covered</span>
                  <span className="font-semibold text-gray-900">{calendarSummary.overall_employee_count || 0}</span>
                </div>
              ) : null}
              <div className="flex items-center justify-between">
                <span className="text-gray-600">Present Days</span>
                <span className="font-semibold text-gray-900">{calendarSummary.present_days}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-600">Absent Days</span>
                <span className="font-semibold text-gray-900">{calendarSummary.absent_days}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-600">Weekend Days</span>
                <span className="font-semibold text-gray-900">{calendarSummary.weekend_days}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-600">Holiday Days</span>
                <span className="font-semibold text-gray-900">{calendarSummary.holiday_days || 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-600">Late Days</span>
                <span className="font-semibold text-gray-900">{calendarSummary.late_days}</span>
              </div>
              <div className="pt-2 border-t border-gray-200 flex items-center justify-between">
                <span className="text-gray-600">Total Worked</span>
                <span className="font-semibold text-gray-900">{formatDuration(calendarSummary.total_worked_seconds)}</span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-500">No summary available.</p>
          )}

          {isAdmin ? (
            <div className="mt-6 border-t border-slate-200 pt-4">
              <div className="mb-3">
                <h3 className="text-sm font-semibold text-gray-900">Holiday Editor</h3>
                <p className="mt-1 text-xs text-gray-500">
                  Holidays are visible only to employees in the selected country.
                </p>
              </div>

              {holidayFeedback ? (
                <div className="mb-3">
                  <FeedbackBanner tone={holidayFeedback.tone} message={holidayFeedback.message} />
                </div>
              ) : null}

              <div className="space-y-3">
                <div>
                  <FieldLabel>Date</FieldLabel>
                  <TextInput type="date" value={holidayDate} onChange={(e) => setHolidayDate(e.target.value)} />
                </div>

                <div>
                  <FieldLabel>Country</FieldLabel>
                  <SelectInput value={holidayCountry} onChange={(e) => setHolidayCountry(normalizeCountryValue(e.target.value))}>
                    {HOLIDAY_COUNTRIES.map((country) => (
                      <option key={country.value} value={country.value}>{country.label}</option>
                    ))}
                  </SelectInput>
                </div>

                <div>
                  <FieldLabel>Holiday Name</FieldLabel>
                  <TextInput
                    value={holidayTitle}
                    onChange={(e) => setHolidayTitle(e.target.value)}
                    placeholder="Example: Republic Day"
                  />
                </div>

                <div>
                  <FieldLabel>Details (Optional)</FieldLabel>
                  <TextareaInput
                    value={holidayDetails}
                    onChange={(e) => setHolidayDetails(e.target.value)}
                    rows={3}
                    placeholder="Holiday details visible in attendance calendar."
                  />
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button onClick={saveHoliday} disabled={isHolidaySubmitting}>
                    {isHolidaySubmitting ? 'Saving...' : selectedHolidayId ? 'Update Holiday' : 'Save Holiday'}
                  </Button>
                  <Button onClick={deleteHoliday} variant="danger" disabled={isHolidayDeleting || !selectedHolidayId}>
                    {isHolidayDeleting ? 'Deleting...' : 'Delete Holiday'}
                  </Button>
                </div>
              </div>

              <div className="mt-4">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">This Month Holidays</p>
                  <Button onClick={fetchHolidays} variant="ghost" size="sm" disabled={isHolidayLoading}>
                    {isHolidayLoading ? 'Refreshing...' : 'Refresh'}
                  </Button>
                </div>

                {isHolidayLoading ? (
                  <p className="text-xs text-slate-500">Loading holidays...</p>
                ) : holidayItems.length === 0 ? (
                  <p className="text-xs text-slate-500">No holidays added for this month.</p>
                ) : (
                  <div className="max-h-44 space-y-2 overflow-auto pr-1">
                    {holidayItems.map((holiday) => (
                      <button
                        key={holiday.id}
                        type="button"
                        onClick={() => {
                          setHolidayDate(holiday.holiday_date);
                          setHolidayCountry(normalizeCountryValue(holiday.country));
                          setHolidayTitle(holiday.title || '');
                          setHolidayDetails(holiday.details || '');
                          setSelectedHolidayId(holiday.id);
                          setHolidayFeedback();
                        }}
                        className={`w-full rounded-lg border px-2.5 py-2 text-left text-xs transition ${selectedHolidayId === holiday.id ? 'border-sky-300 bg-sky-50' : 'border-slate-200 hover:border-sky-200'}`}
                      >
                        <p className="font-semibold text-slate-900">{holiday.holiday_date} - {holiday.title}</p>
                        <p className="mt-0.5 text-slate-500">{formatCountryLabel(holiday.country)}</p>
                        {holiday.details ? <p className="mt-1 text-slate-500">{holiday.details}</p> : null}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </SurfaceCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {leaveFeedback ? (
          <div className="lg:col-span-2">
            <FeedbackBanner tone={leaveFeedback.tone} message={leaveFeedback.message} />
          </div>
        ) : null}
        <SurfaceCard className="p-4">
          <h2 className="font-semibold text-gray-900 mb-3">Request Leave</h2>
          <div className="mb-3">
            <FieldLabel>Leave Type</FieldLabel>
            <SelectInput
              value={leaveType}
              onChange={(e) => {
                const nextType = e.target.value === 'half_day' ? 'half_day' : 'full_day';
                setLeaveType(nextType);
                if (nextType === 'half_day') {
                  setLeaveEndDate(leaveStartDate);
                }
              }}
            >
              <option value="full_day">Full Day</option>
              <option value="half_day">Half Day</option>
            </SelectInput>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <FieldLabel>Start Date</FieldLabel>
              <TextInput
                type="date"
                value={leaveStartDate}
                onChange={(e) => {
                  setLeaveStartDate(e.target.value);
                  if (leaveType === 'half_day') {
                    setLeaveEndDate(e.target.value);
                  }
                }}
              />
            </div>
            <div>
              <FieldLabel>End Date</FieldLabel>
              <TextInput
                type="date"
                value={leaveEndDate}
                onChange={(e) => setLeaveEndDate(e.target.value)}
                disabled={leaveType === 'half_day'}
              />
            </div>
          </div>
          {leaveType === 'half_day' ? (
            <p className="mt-2 text-xs text-amber-700">
              Half day leave reduces the day target to half of normal working hours.
            </p>
          ) : null}
          <div className="mt-3">
            <FieldLabel>Reason (Optional)</FieldLabel>
            <TextareaInput
              value={leaveReason}
              onChange={(e) => setLeaveReason(e.target.value)}
              rows={3}
              placeholder="Leave reason..."
            />
          </div>
          <div className="mt-3">
            <Button onClick={submitLeaveRequest} disabled={isLeaveSubmitting}>
              {isLeaveSubmitting ? 'Submitting...' : 'Submit Leave Request'}
            </Button>
          </div>
        </SurfaceCard>

        <SurfaceCard className="p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">Leave Requests</h2>
            <Button onClick={fetchLeaveRequests} variant="ghost" size="sm">Refresh</Button>
          </div>
          {isLeaveLoading ? (
            <PageLoadingState label="Loading leave requests..." />
          ) : leaveRequests.length === 0 ? (
            <PageEmptyState title="No leave requests found" description="Submitted leave requests will appear here." />
          ) : (
            <div className="mt-3 space-y-2 max-h-72 overflow-auto">
              {leaveRequests.map((item) => (
                <div key={item.id} className="rounded-[22px] border border-slate-200 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-gray-900">
                      {item.user?.name || 'You'}: {item.start_date} to {item.end_date}
                    </p>
                    <StatusBadge tone={item.status === 'approved' ? 'success' : item.status === 'rejected' ? 'danger' : item.status === 'revoked' ? 'neutral' : 'warning'}>{item.status}</StatusBadge>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {item.leave_type === 'half_day' ? 'Half day leave' : 'Full day leave'}
                  </p>
                  {item.approval_destination ? (
                    <p className="mt-1 text-xs font-medium text-sky-700">{item.approval_destination}</p>
                  ) : null}
                  {item.reason ? <p className="text-xs text-gray-600 mt-1">{item.reason}</p> : null}
                  {item.revoke_status ? (
                    <p className="text-xs mt-1 text-gray-600">
                      Revoke Request: <span className={`font-medium ${item.revoke_status === 'pending' ? 'text-amber-700' : item.revoke_status === 'approved' ? 'text-green-700' : 'text-red-700'}`}>{item.revoke_status}</span>
                    </p>
                  ) : null}
                  {canReviewLeaveRequest(item) && item.status === 'pending' ? (
                    <div className="mt-2 flex gap-2">
                      <Button onClick={() => approveLeave(item.id)} size="sm" className="bg-emerald-600 shadow-[0_18px_40px_-24px_rgba(5,150,105,0.6)] hover:bg-emerald-700">Approve</Button>
                      <Button onClick={() => rejectLeave(item.id)} variant="danger" size="sm">Reject</Button>
                    </div>
                  ) : null}
                  {!isAdmin && canRequestRevoke(item) ? (
                    <div className="mt-2">
                      <Button onClick={() => requestLeaveRevoke(item.id)} variant="danger" size="sm">Request Revoke</Button>
                    </div>
                  ) : null}
                  {canReviewLeaveRequest(item) && item.status === 'approved' && item.revoke_status === 'pending' ? (
                    <div className="mt-2 flex gap-2">
                      <Button onClick={() => approveLeaveRevoke(item.id)} size="sm" className="bg-emerald-600 shadow-[0_18px_40px_-24px_rgba(5,150,105,0.6)] hover:bg-emerald-700">Approve Revoke</Button>
                      <Button onClick={() => rejectLeaveRevoke(item.id)} variant="danger" size="sm">Reject Revoke</Button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
          {pendingLeaveRequests.length > 0 ? (
            <p className="text-xs text-gray-500 mt-2">Pending approvals: {pendingLeaveRequests.length}</p>
          ) : null}
        </SurfaceCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {timeEditFeedback && canRequestTimeEdit ? (
          <div className="lg:col-span-2">
            <FeedbackBanner tone={timeEditFeedback.tone} message={timeEditFeedback.message} />
          </div>
        ) : null}
        {canRequestTimeEdit ? (
          <SurfaceCard className="p-4">
            <h2 className="font-semibold text-gray-900 mb-3">Request Time Edit / Overtime</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <FieldLabel>Attendance Date</FieldLabel>
                <TextInput type="date" value={timeEditDate} onChange={(e) => setTimeEditDate(e.target.value)} />
              </div>
              <div>
                <FieldLabel>Extra Minutes</FieldLabel>
                <TextInput
                  type="number"
                  min={1}
                  max={600}
                  value={extraMinutes}
                  onChange={(e) => setExtraMinutes(Number(e.target.value))}
                />
              </div>
            </div>
            <div className="mt-3">
              <FieldLabel>Message to Admin</FieldLabel>
              <TextareaInput
                value={timeEditMessage}
                onChange={(e) => setTimeEditMessage(e.target.value)}
                rows={3}
                placeholder="Example: I worked 1 hour extra after shift due to release deployment."
              />
            </div>
            <div className="mt-3">
              <Button onClick={submitTimeEditRequest} disabled={isTimeEditSubmitting}>
                {isTimeEditSubmitting ? 'Submitting...' : 'Submit Time Edit Request'}
              </Button>
            </div>
          </SurfaceCard>
        ) : null}

        <SurfaceCard className={`p-4 ${!canRequestTimeEdit ? 'lg:col-span-2' : ''}`}>
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">Time Edit Requests</h2>
            <Button onClick={fetchTimeEditRequests} variant="ghost" size="sm">Refresh</Button>
          </div>
          {isTimeEditLoading ? (
            <PageLoadingState label="Loading time edit requests..." />
          ) : timeEditRequests.length === 0 ? (
            <PageEmptyState title="No time edit requests found" description="Attendance adjustment requests will appear here." />
          ) : (
            <div className="mt-3 space-y-2 max-h-72 overflow-auto">
              {timeEditRequests.map((item) => (
                <div key={item.id} className="rounded-[22px] border border-slate-200 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-gray-900">
                      {item.user?.name || 'You'}: {item.attendance_date} (+{formatDuration(item.extra_seconds)})
                    </p>
                    <StatusBadge tone={item.status === 'approved' ? 'success' : item.status === 'rejected' ? 'danger' : 'warning'}>{item.status}</StatusBadge>
                  </div>
                  {item.approval_destination ? (
                    <p className="mt-1 text-xs font-medium text-sky-700">{item.approval_destination}</p>
                  ) : null}
                  {item.message ? <p className="text-xs text-gray-600 mt-1">{item.message}</p> : null}
                  {canReviewTimeEditRequest(item) && item.status === 'pending' ? (
                    <div className="mt-2 flex gap-2">
                      <Button onClick={() => approveTimeEdit(item.id)} size="sm" className="bg-emerald-600 shadow-[0_18px_40px_-24px_rgba(5,150,105,0.6)] hover:bg-emerald-700">Approve</Button>
                      <Button onClick={() => rejectTimeEdit(item.id)} variant="danger" size="sm">Reject</Button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
          {pendingTimeEditRequests.length > 0 ? (
            <p className="text-xs text-gray-500 mt-2">Pending approvals: {pendingTimeEditRequests.length}</p>
          ) : null}
        </SurfaceCard>
      </div>

      {selectedRow && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <SurfaceCard className="p-4">
            <h2 className="font-semibold text-gray-900 mb-3">
              {selectedRow.user.name} - Leave Dates (Weekend Excluded)
            </h2>
            <div className="max-h-72 overflow-auto flex flex-wrap gap-2">
              {(selectedRow.leave_dates || []).length === 0 ? (
                <p className="text-sm text-gray-500">No leave dates in selected range.</p>
              ) : (
                selectedRow.leave_dates.map((date: string) => (
                  <span key={date} className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs text-rose-700">
                    {date}
                  </span>
                ))
              )}
            </div>
          </SurfaceCard>
          <SurfaceCard className="p-4">
            <h2 className="font-semibold text-gray-900 mb-3">
              {selectedRow.user.name} - Present Dates
            </h2>
            <div className="max-h-72 overflow-auto flex flex-wrap gap-2">
              {(selectedRow.present_dates || []).length === 0 ? (
                <p className="text-sm text-gray-500">No present dates in selected range.</p>
              ) : (
                selectedRow.present_dates.map((date: string) => (
                  <span key={date} className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs text-emerald-700">
                    {date}
                  </span>
                ))
              )}
            </div>
          </SurfaceCard>
        </div>
      )}
    </div>
  );
}
