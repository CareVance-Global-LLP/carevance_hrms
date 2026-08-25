import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { activityApi, attendanceApi, attendanceHolidayApi, attendanceTimeEditApi, leaveApi, organizationApi, reportApi, userApi } from '@/services/api';
import { checkInOfflineAware, checkOutOfflineAware } from '@/services/offlineApiWrapper';
import { useAuth } from '@/contexts/AuthContext';
import { usePlan } from '@/hooks/usePlan';
import { canReviewApprovalRequest, hasAdminAccess, resolveUserHierarchyLevel, resolveUserRoleLabel } from '@/lib/permissions';
import { DEFAULT_SHIFT_TARGET_SECONDS, resolveShiftTargetSeconds } from '@/lib/shiftTarget';
import DateRangeFields from '@/components/dashboard/DateRangeFields';
import PageHeader from '@/components/dashboard/PageHeader';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import FilterPanel from '@/components/dashboard/FilterPanel';
import AttendanceRoster from '@/features/attendance/AttendanceRoster';
import TeamPresenceBoard from '@/features/attendance/TeamPresenceBoard';
import OvertimeWorkspace from '@/features/attendance/OvertimeWorkspace';
import DayOutcomeLedger, { OutcomeChips, OUTCOME_TONE_CLASS } from '@/features/attendance/DayOutcomeLedger';
import SlideOver from '@/features/employees/SlideOver';
import LeaveBalanceCards from '@/features/leave/LeaveBalanceCards';
import LeaveLedgerDrawer from '@/features/leave/LeaveLedgerDrawer';
import WhosOffStrip from '@/features/leave/WhosOffStrip';
import LeaveRequestDrawer from '@/features/leave/LeaveRequestDrawer';
import LeaveRequestsPanel from '@/features/leave/LeaveRequestsPanel';
import TeamLeaveBalances from '@/features/leave/TeamLeaveBalances';
import { makeCategoryColorOf } from '@/features/leave/leaveUtils';
import { useResolvedThemeSafe } from '@/contexts/ThemeContext';
import { useComposeAction } from '@/hooks/useComposeAction';
import { COMPOSE_KEYS } from '@/lib/commandRegistry';
import Button from '@/components/ui/Button';
import EmployeeSelect from '@/components/ui/EmployeeSelect';
import { FeedbackBanner, PageEmptyState, PageLoadingState } from '@/components/ui/PageState';
import { FieldLabel, SelectInput, TextInput, TextareaInput } from '@/components/ui/FormField';
import { classifyActivityProductivity as classifyProductivity, normalizeActivityToolLabel as normalizeToolLabel } from '@/lib/activityProductivity';
import { deriveDateRangeFromPreset, detectDateRangePreset, resolvePersistedDateRange, type DateRangePreset } from '@/lib/dateRange';
import { coercePositiveNumber, readSessionStorageJson, writeSessionStorageJson } from '@/lib/filterPersistence';
import { formatDateTime as formatDateTimeForTimezone, formatTime as formatTimeForTimezone } from '@/lib/dateTime';
import { DEFAULT_APP_TIMEZONE, resolveTimeZone } from '@/lib/timezones';
import { formatDuration } from '@/lib/formatters';
import { describeDayOutcome, type DayOutcomePayload } from '@/lib/attendanceDayOutcome';
import StatusBadge from '@/components/ui/StatusBadge';
import { RequestEscalateControl } from '@/components/requests/RequestEscalateControl';
import { Briefcase, Download, FolderKanban, Layers3, Users } from 'lucide-react';
import type { UserProfile360 } from '@/types';

const formatDateTime = (value?: string | null, timezone = DEFAULT_APP_TIMEZONE) =>
  formatDateTimeForTimezone(value, timezone, 'en-US', 'Not available');
const resolveLiveToolLabel = (liveRow?: any | null) => {
  const resolved = [
    liveRow?.current_tool,
    liveRow?.tool_label,
    liveRow?.normalized_label,
    liveRow?.name,
  ].map((candidate) => String(candidate || '').trim()).find(Boolean);

  return resolved || 'No active tool detected';
};
const resolveLiveActivityLabel = (liveRow?: any | null) => {
  const activityAt = liveRow?.last_activity_at || liveRow?.recorded_at || liveRow?.last_seen_at;
  return activityAt ? formatDateTime(activityAt) : 'Not available';
};
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

const formatLeaveCategoryLabel = (value?: string | null) => {
  const normalized = String(value || '').trim();
  if (!normalized) return 'Paid Leave';
  return normalized
    .replace(/[_\-]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
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
  mode?: 'full' | 'time-edit' | 'leave';
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
  const selectedFilterUserId = coercePositiveNumber(parsed.selectedFilterUserId) ?? '';

  return {
    selectedFilterUserId,
    countryFilter: typeof parsed.countryFilter === 'string' && parsed.countryFilter ? parsed.countryFilter : fallback.countryFilter,
    calendarScope: selectedFilterUserId ? 'selected' : parsed.calendarScope === 'overall' ? 'overall' : fallback.calendarScope,
    datePreset,
    startDate: resolvedRange.startDate,
    endDate: resolvedRange.endDate,
  };
};
export default function Attendance({ mode = 'full' }: AttendanceProps) {
  const { user, organization } = useAuth();
  // Leave category chips are inline-styled, so their colours are picked in JS
  // rather than by the CSS token layer — they need the active theme.
  const resolvedTheme = useResolvedThemeSafe();
  const { hasFeature } = usePlan();
  const canAccessLeave = hasFeature('leave_management');
  const location = useLocation();
  const displayTimezone = resolveTimeZone(user?.settings?.timezone || DEFAULT_APP_TIMEZONE);
  const [selectedFilterUserId, setSelectedFilterUserId] = useState<number | ''>(() => readPersistedAttendanceFilters().selectedFilterUserId);
  const [countryFilter, setCountryFilter] = useState(() => readPersistedAttendanceFilters().countryFilter);
  const [calendarScope, setCalendarScope] = useState<'selected' | 'overall'>(() => readPersistedAttendanceFilters().calendarScope);
  const [datePreset, setDatePreset] = useState<DateRangePreset>(() => readPersistedAttendanceFilters().datePreset);
  const [startDate, setStartDate] = useState(() => readPersistedAttendanceFilters().startDate);
  const [endDate, setEndDate] = useState(() => readPersistedAttendanceFilters().endDate);
  const [rows, setRows] = useState<any[]>([]);
  /*
   * The page used to stack ten full-width bands — records, calendar, monthly
   * summary, holidays, time edits, leave — one after another. Grouping them
   * into views keeps each screen about one job instead of scrolling past four
   * unrelated ones to reach the fifth.
   */
  const [attendanceView, setAttendanceView] = useState<'overview' | 'calendar' | 'requests'>('overview');
  /*
   * The person drawer replaces the panels that used to load below the table —
   * clicking row 30 pushed detail in underneath and left you scrolling to find
   * what you just asked for.
   */
  const [personDrawerOpen, setPersonDrawerOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
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
    work_time_breakdown?: {
      track_time?: number;
      work_time?: number;
      idle_time?: number;
      break_time?: number;
    } | null;
    punches: Array<{
      id: number;
      punch_in_at: string;
      punch_out_at?: string | null;
      worked_seconds: number;
    }>;
  }>(null);
  const [hasApprovedLeaveToday, setHasApprovedLeaveToday] = useState(false);
  /*
   * The shift length the server resolved for this person and this date.
   *
   * Held separately from the record because it arrives on the payload, not in
   * it, and the record is null until the first punch of the day. Reading it off
   * the record alone meant that before anyone clocked in — exactly when the
   * target matters most — the tile fell back to eight hours regardless of the
   * shift they are actually on.
   */
  const [payloadShiftTargetSeconds, setPayloadShiftTargetSeconds] = useState<number | null>(null);
  const [lateAfter, setLateAfter] = useState('10:30:00');
  const [officeStart, setOfficeStart] = useState('09:00:00');
  const [userTimezone, setUserTimezone] = useState('');
  const [isPunchLoading, setIsPunchLoading] = useState(false);

  const [calendarMonth, setCalendarMonth] = useState(formatMonth(new Date()));
  const [calendarDays, setCalendarDays] = useState<any[]>([]);
  const [calendarSummary, setCalendarSummary] = useState<any | null>(null);
  const [isCalendarLoading, setIsCalendarLoading] = useState(false);
  /**
   * What each day COST, from the penalisation and overtime engines.
   *
   * Fetched apart from the calendar and never awaited with it: the
   * penalisation engine walks a whole exemption cycle per day, so the grid
   * would sit blank behind it. The calendar paints, and the outcomes land on
   * top when they arrive. An empty map degrades to the old, plainer cell
   * rather than to a wrong verdict.
   */
  const [dayOutcomes, setDayOutcomes] = useState<DayOutcomePayload[]>([]);
  const [isDayOutcomesLoading, setIsDayOutcomesLoading] = useState(false);
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
  // What the server holds, which is not always what it returned. Rendering a
  // truncated list as though it were the whole set is the failure this page
  // already had once.
  const [leaveTotal, setLeaveTotal] = useState(0);
  const [isLeaveLoading, setIsLeaveLoading] = useState(false);
  const [isLeaveSubmitting, setIsLeaveSubmitting] = useState(false);
  const [leaveDrawerOpen, setLeaveDrawerOpen] = useState(false);
  // Which balance card was opened for its breakdown, if any.
  const [ledgerCode, setLedgerCode] = useState<string | null>(null);
  // "Apply for leave" in the command bar lands here with the drawer already open.
  useComposeAction(COMPOSE_KEYS.leaveRequest, () => setLeaveDrawerOpen(true));
  // Holidays for the request-cost preview and the who's-off strip; kept apart
  // from the admin holiday editor's month-scoped fetch.
  const [leaveHolidays, setLeaveHolidays] = useState<any[]>([]);
  const [leaveFilterUserId, setLeaveFilterUserId] = useState<number | ''>('');
  const [leaveFilterDepartment, setLeaveFilterDepartment] = useState('ALL');
  const [leaveBalances, setLeaveBalances] = useState<any | null>(null);
  const [isLeaveBalanceLoading, setIsLeaveBalanceLoading] = useState(false);
  const [timeEditRequests, setTimeEditRequests] = useState<any[]>([]);
  const [isTimeEditLoading, setIsTimeEditLoading] = useState(false);
  const [isTimeEditSubmitting, setIsTimeEditSubmitting] = useState(false);
  const [punchFeedback, setPunchFeedbackState] = useState<SectionFeedback>(null);
  const [holidayFeedback, setHolidayFeedbackState] = useState<SectionFeedback>(null);
  const [leaveFeedback, setLeaveFeedbackState] = useState<SectionFeedback>(null);
  const [timeEditFeedback, setTimeEditFeedbackState] = useState<SectionFeedback>(null);
  const [employeeProfile, setEmployeeProfile] = useState<UserProfile360 | null>(null);
  const [employeeMonitoring, setEmployeeMonitoring] = useState<any | null>(null);
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
  const [isExporting, setIsExporting] = useState(false);
  const [leaveToday, setLeaveToday] = useState<{ leave_type: 'full_day' | 'half_day'; units: number; label: string } | null>(null);

  const isAdmin = hasAdminAccess(user);
  const canSeeAttendanceMonitoring = isAdmin;
  const canAccessAttendance = isAdmin || user?.settings?.attendance_monitoring !== false;
  const canRequestTimeEdit = user?.settings?.can_edit_time !== false;

  useEffect(() => {
    if (!location.search || !isAdmin) return;

    const params = new URLSearchParams(location.search);
    const nextStartDate = params.get('start');
    const nextEndDate = params.get('end');
    const nextUserId = params.get('user') || params.get('user_id');

    if (nextStartDate && nextEndDate) {
      setStartDate(nextStartDate);
      setEndDate(nextEndDate);
      setDatePreset(detectDateRangePreset(nextStartDate, nextEndDate));
    } else if (nextStartDate || nextEndDate) {
      if (nextStartDate) {
        setStartDate(nextStartDate);
      }
      if (nextEndDate) {
        setEndDate(nextEndDate);
      }
      setDatePreset('custom');
    }

    if (nextUserId !== null) {
      const parsedUserId = Number(nextUserId);
      const resolvedUserId = Number.isFinite(parsedUserId) && parsedUserId > 0 ? parsedUserId : '';
      setSelectedFilterUserId(resolvedUserId);
      setSelectedUserId(resolvedUserId === '' ? null : Number(resolvedUserId));
      setCalendarScope(resolvedUserId === '' ? 'overall' : 'selected');
    }
  }, [isAdmin, location.search]);
  const adminUsersQuery = useQuery({
    queryKey: ['attendance-admin-users'],
    queryFn: async () => {
      const response = await userApi.getAll({ period: 'all' });
      return response.data || [];
    },
    enabled: isAdmin,
  });
  // Ordinary employees get a presence board of their own department instead of
  // the HR roster. Only they fetch it, so an admin pays nothing for it.
  const teamPresenceQuery = useQuery({
    queryKey: ['attendance-team-presence'],
    queryFn: async () => (await attendanceApi.teamPresence()).data,
    enabled: !isAdmin,
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

  const handleEmployeeFilterChange = (nextUserId: number | '') => {
    setSelectedFilterUserId(nextUserId);
    if (nextUserId) {
      setSelectedUserId(Number(nextUserId));
      setCalendarScope('selected');
      return;
    }

    setCalendarScope('overall');
  };

  const handleExportAttendance = () => {
    if (isExporting || rows.length === 0) return;

    setIsExporting(true);
    try {
      const formatDuration = (seconds: number): string => {
        if (!seconds || seconds <= 0) return '0m';
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        if (h > 0 && m > 0) return `${h}h ${m}m`;
        if (h > 0) return `${h}h`;
        return `${m}m`;
      };

      const csvRows = [[
        'Employee Name',
        'Email',
        'Department',
        'Date Range',
        'Present Days',
        'Leave Days',
        'Absent Days',
        'Total Working Days',
        'Attendance Rate (%)',
        'Track Time',
        'Work Time',
        'Idle Time',
        'Break Time',
        'First Check-In',
        'Last Check-Out',
        'Status',
      ]];
      let totalPresent = 0;
      let totalAbsent = 0;
      let totalAll = 0;
      let totalWorkedSeconds = 0;
      let totalBreakSeconds = 0;

      for (const row of rows) {
        const present = Number(row.days_present) || 0;
        const leaveDays = Number(row.leave_days) || 0;
        const absent = Number(row.absent_days ?? (row.working_days_in_range - present - leaveDays));
        const total = present + Math.max(0, absent);
        const name = row.user?.name || 'Unknown';
        const email = row.user?.email || '';
        const department = row.department || row.user?.employee_work_info?.department?.name || '';
        const workingDays = Number(row.working_days_in_range) || 0;
        const attendanceRate = workingDays > 0 ? ((present / workingDays) * 100).toFixed(1) : '0';
        const workedSeconds = Number(row.worked_seconds) || 0;
        const breakSeconds = Number(row.total_break_seconds) || 0;
        const trackSeconds = Number(row.work_time_breakdown?.track_time ?? 0) || 0;
        const idleSeconds = Number(row.work_time_breakdown?.idle_time ?? 0) || 0;
        const firstCheckIn = row.check_in_at || '';
        const lastCheckOut = row.check_out_at || '';

        let status = 'Absent';
        if (present > 0) {
          status = Number(row.late_minutes || 0) > 0 ? 'Late' : 'Present';
        } else if (leaveDays > 0) {
          status = 'On Leave';
        }

        csvRows.push([
          `"${name}"`,
          `"${email}"`,
          `"${department}"`,
          `"${startDate} to ${endDate}"`,
          String(present),
          String(leaveDays),
          String(Math.max(0, absent)),
          String(workingDays),
          attendanceRate,
          formatDuration(trackSeconds),
          formatDuration(workedSeconds),
          formatDuration(idleSeconds),
          formatDuration(breakSeconds),
          `"${firstCheckIn}"`,
          `"${lastCheckOut}"`,
          `"${status}"`,
        ]);
        totalPresent += present;
        totalAbsent += Math.max(0, absent);
        totalAll += total;
        totalWorkedSeconds += workedSeconds;
        totalBreakSeconds += breakSeconds;
      }

      const overallRate = totalAll > 0 ? ((totalPresent / totalAll) * 100).toFixed(1) : '0';
      csvRows.push([
        '"TOTAL"',
        '',
        '',
        '',
        String(totalPresent),
        '',
        String(totalAbsent),
        String(totalAll),
        overallRate,
        formatDuration(totalWorkedSeconds),
        formatDuration(totalBreakSeconds),
        '',
        '',
        '',
      ]);

      const bom = '\uFEFF';
      const csv = bom + csvRows.map(r => r.join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=UTF-8' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      const filename = `attendance-report-${startDate}-to-${endDate}.csv`;

      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      setPunchFeedback('Attendance report downloaded successfully');
    } catch (error) {
      console.error('Export failed:', error);
      setPunchFeedback('', 'Failed to download attendance report.');
    } finally {
      setIsExporting(false);
    }
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
      const res = await attendanceApi.today({
        user_id: isAdmin && selectedUserId ? Number(selectedUserId) : undefined,
      });
      setTodayRecord(res.data.record);
      setLateAfter(res.data.late_after || '10:30:00');
      setOfficeStart(res.data.office_start || '09:00:00');
      setUserTimezone(res.data.timezone || '');
      setPayloadShiftTargetSeconds(
        typeof (res.data as any).shift_target_seconds === 'number'
          ? (res.data as any).shift_target_seconds
          : null
      );
      setHasApprovedLeaveToday(Boolean((res.data as any).has_approved_leave_today));
      setHasHalfDayLeaveToday(Boolean((res.data as any).has_half_day_leave_today));
      setLeaveToday((res.data as any).leave_today || null);
    } catch (e) {
      console.error('Attendance today fetch failed:', e);
    }
  };

  /*
   * Punches go through the offline-aware wrappers on the desktop shell.
   *
   * A punch is the one action an employee cannot simply retry later — the time
   * it happened IS the record. Calling the API directly meant a disconnected
   * tracker just failed the punch, even though the desktop already carries a
   * durable local queue that replays on reconnect. On the web these wrappers
   * are a straight pass-through: they only fall back when `isDesktopApp()`.
   *
   * A queued punch has no server record to render yet, so the refetches are
   * skipped and the feedback says so rather than claiming a clean check-in.
   */
  const doCheckIn = async () => {
    setIsPunchLoading(true);
    setPunchFeedback();
    try {
      const result = await checkInOfflineAware();
      if (!result.success) {
        setPunchFeedback('', result.error || 'Check-in failed');
        return;
      }
      if (result.offline) {
        setPunchFeedback('Checked in offline — it will sync when you reconnect');
        return;
      }
      const payload = result.data as any;
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
      const result = await checkOutOfflineAware();
      if (!result.success) {
        setPunchFeedback('', result.error || 'Check-out failed');
        return;
      }
      if (result.offline) {
        setPunchFeedback('Checked out offline — it will sync when you reconnect');
        return;
      }
      const payload = result.data as any;
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

  /**
   * A penalty is always somebody's, so this is per-person only — there is no
   * "overall" month of outcomes to ask for, and the overall scope simply keeps
   * the plainer calendar it has always had.
   */
  const fetchDayOutcomes = async () => {
    setIsDayOutcomesLoading(true);
    try {
      const res = await attendanceApi.dayOutcomes({
        month: calendarMonth,
        user_id: isAdmin ? selectedUserId || undefined : undefined,
      });

      setDayOutcomes(res.data.days || []);
    } catch (e) {
      // Outcomes decorate a calendar that renders without them, so a failure
      // here must not blank the page — it is reported and the cells stay plain.
      console.error('Attendance day outcomes fetch failed:', e);
      setDayOutcomes([]);
    } finally {
      setIsDayOutcomesLoading(false);
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
      // An explicit limit, because the endpoint defaults to a page rather than
      // everything. Sending none left an employee with 44 requests seeing only
      // their 10 most recent: a request showed while it was new, then slid out
      // of the window as others arrived and disappeared from their history.
      const res = await leaveApi.list({ limit: 500 });
      setLeaveRequests((res.data as any).data || []);
      setLeaveTotal(Number((res.data as any).total ?? 0));
    } catch (e) {
      console.error('Leave requests fetch failed:', e);
    } finally {
      setIsLeaveLoading(false);
    }
  };

  const fetchLeaveBalances = async () => {
    setIsLeaveBalanceLoading(true);
    try {
      const response = await leaveApi.balances();
      setLeaveBalances(response.data || null);
    } catch (error) {
      console.error('Leave balances fetch failed:', error);
      setLeaveBalances(null);
    } finally {
      setIsLeaveBalanceLoading(false);
    }
  };

  /**
   * Submit a leave request from the drawer. The drawer already priced the
   * request and blocked overdrafts client-side; this keeps the server-facing
   * guards and the refresh fan-out, and reports success so the drawer can close.
   */
  const submitLeave = async (payload: {
    start_date: string;
    end_date: string;
    leave_type: 'full_day' | 'half_day';
    leave_category: string;
    reason?: string;
  }): Promise<boolean> => {
    if (!payload.start_date || !payload.end_date) {
      setLeaveFeedback('', 'Please select start and end date');
      return false;
    }

    if (payload.leave_type === 'half_day' && payload.start_date !== payload.end_date) {
      setLeaveFeedback('', 'Half day leave can only be requested for one date.');
      return false;
    }

    if (payload.leave_category !== 'birthday' && !String(payload.reason || '').trim()) {
      setLeaveFeedback('', 'Reason is required. Please provide a reason for your leave.');
      return false;
    }

    if (payload.leave_category !== 'unpaid') {
      const category = selfLeaveCategories.find(
        (c: any) => String(c.code || '').toLowerCase() === payload.leave_category
      );
      if (category && Number(category.remaining || 0) <= 0) {
        setLeaveFeedback('', `You have already used your ${category.name} for this year.`);
        return false;
      }
    }

    setIsLeaveSubmitting(true);
    setLeaveFeedback();
    try {
      await leaveApi.create({
        start_date: payload.start_date,
        end_date: payload.end_date,
        leave_type: payload.leave_type,
        leave_category: payload.leave_category,
        reason: payload.reason,
      });
      await Promise.all([fetchLeaveRequests(), fetchLeaveBalances()]);
      await Promise.all([fetchCalendar(), fetchToday(), fetchAttendance()]);
      setLeaveFeedback('Leave request submitted');
      return true;
    } catch (e) {
      console.error('Leave request submit failed:', e);
      setLeaveFeedback('', (e as any)?.response?.data?.message || 'Failed to submit leave request');
      return false;
    } finally {
      setIsLeaveSubmitting(false);
    }
  };

  const approveLeave = async (id: number) => {
    setLeaveFeedback();
    try {
      await leaveApi.approve(id);
      await Promise.all([fetchLeaveRequests(), fetchLeaveBalances(), fetchAttendance(), fetchCalendar(), fetchToday()]);
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
      await Promise.all([fetchLeaveRequests(), fetchLeaveBalances()]);
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
      await Promise.all([fetchLeaveRequests(), fetchLeaveBalances()]);
      setLeaveFeedback('Leave revoke request submitted');
    } catch (e) {
      console.error('Leave revoke request failed:', e);
      setLeaveFeedback('', (e as any)?.response?.data?.message || 'Failed to request leave revoke');
    }
  };

  const transferLeave = async (id: number, note?: string, toUserId?: number) => {
    setLeaveFeedback();
    try {
      await leaveApi.transfer(id, note, toUserId);
      await Promise.all([fetchLeaveRequests(), fetchLeaveBalances()]);
      setLeaveFeedback(toUserId ? 'Leave request forwarded to the selected manager.' : 'Leave request transferred to the next hierarchy level.');
    } catch (e) {
      console.error('Transfer leave failed:', e);
      setLeaveFeedback('', (e as any)?.response?.data?.message || 'Failed to transfer leave request');
    }
  };


  const approveLeaveRevoke = async (id: number) => {
    setLeaveFeedback();
    try {
      await leaveApi.approveRevoke(id);
      await Promise.all([fetchLeaveRequests(), fetchLeaveBalances(), fetchCalendar(), fetchAttendance(), fetchToday()]);
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
      await Promise.all([fetchLeaveRequests(), fetchLeaveBalances()]);
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

  const submitTimeEditRequest = async (payload: { date: string; extraMinutes: number; message: string }): Promise<boolean> => {
    if (!canRequestTimeEdit) {
      setTimeEditFeedback('', 'Time edit requests are disabled for your account.');
      return false;
    }

    if (!payload.date || !payload.extraMinutes || payload.extraMinutes <= 0) {
      setTimeEditFeedback('', 'Please enter a valid date and extra minutes');
      return false;
    }

    // The workspace disables submit on holidays it can see; this guard covers
    // dates whose month is not loaded yet, where the server has the final say.
    const requestedDay = calendarDays.find((day) => day?.date === payload.date);
    if (requestedDay?.status === 'holiday' || requestedDay?.is_holiday) {
      setTimeEditFeedback('', 'Time edit request is not allowed on holidays.');
      return false;
    }

    setIsTimeEditSubmitting(true);
    setTimeEditFeedback();
    try {
      const response = await attendanceTimeEditApi.create({
        attendance_date: payload.date,
        extra_minutes: payload.extraMinutes,
        message: payload.message || undefined,
      });
      await fetchTimeEditRequests();
      setTimeEditFeedback((response.data as any)?.message || 'Time edit request submitted and sent to your group manager.');
      return true;
    } catch (e) {
      console.error('Time edit request submit failed:', e);
      setTimeEditFeedback('', (e as any)?.response?.data?.message || 'Failed to submit time edit request');
      return false;
    } finally {
      setIsTimeEditSubmitting(false);
    }
  };

  /*
   * Day context for someone else's request: one calendar call per (person,
   * month), cached for the session. Pending overtime is a handful of rows, so
   * this stays cheap — and a failed fetch degrades to "no day data", never an
   * error state.
   */
  const dayContextCacheRef = useRef<Map<string, any[]>>(new Map());
  const fetchDayContextFor = async (userId: number, dateISO: string) => {
    const month = dateISO.slice(0, 7);
    const cacheKey = `${userId}:${month}`;
    let days = dayContextCacheRef.current.get(cacheKey);
    if (!days) {
      const response = await attendanceApi.calendar({ user_id: userId, month, scope: 'selected' });
      days = (response.data as any)?.days || [];
      dayContextCacheRef.current.set(cacheKey, days ?? []);
    }
    return (days ?? []).find((day: any) => day?.date === dateISO) ?? null;
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

  const transferTimeEdit = async (id: number, note?: string, toUserId?: number) => {
    setTimeEditFeedback();
    try {
      await attendanceTimeEditApi.transfer(id, note, toUserId);
      await fetchTimeEditRequests();
      setTimeEditFeedback(toUserId ? 'Time edit request forwarded to the selected manager.' : 'Time edit request transferred to the next hierarchy level.');
    } catch (e) {
      console.error('Transfer time edit failed:', e);
      setTimeEditFeedback('', (e as any)?.response?.data?.message || 'Failed to transfer time edit request');
    }
  };


  useEffect(() => {
    if (mode !== 'full') return;
    fetchAttendance();
  }, [countryFilter, endDate, isAdmin, mode, selectedFilterUserId, startDate]);

  useEffect(() => {
    if (mode === 'full' || mode === 'time-edit') {
      fetchTimeEditRequests();
    }
    if (mode === 'full') {
      fetchToday();
    }
    if ((mode === 'full' || mode === 'leave') && canAccessLeave) {
      fetchLeaveRequests();
      fetchLeaveBalances();
    }
  }, [mode, canAccessLeave]);

  useEffect(() => {
    if (mode !== 'full') return;
    void fetchToday();
  }, [isAdmin, mode, selectedUserId]);

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
    if (mode !== 'full') return;
    if (calendarScope === 'overall') {
      setDayOutcomes([]);
      return;
    }
    if (isAdmin && !selectedUserId) return;

    void fetchDayOutcomes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendarMonth, calendarScope, isAdmin, mode, selectedUserId]);

  useEffect(() => {
    if (mode !== 'full' || !isAdmin) return;
    fetchHolidays();
  }, [calendarMonth, isAdmin, mode]);

  useEffect(() => {
    if (mode !== 'leave') return;
    // The holidays endpoint is month-scoped and readable by everyone, so pull
    // this month and the next two — enough for the strip and any realistic
    // request range. Ranges beyond that fall back to weekend-only estimates.
    let cancelled = false;
    (async () => {
      const now = new Date();
      const months = [0, 1, 2].map((offset) => {
        const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      });
      try {
        const results = await Promise.all(months.map((month) => attendanceHolidayApi.list({ month })));
        if (!cancelled) {
          setLeaveHolidays(results.flatMap((res) => ((res.data as any)?.data || [])));
        }
      } catch (error) {
        console.error('Leave holidays fetch failed:', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode]);

  useEffect(() => {
    if (mode !== 'full' && mode !== 'leave') return;

    const interval = window.setInterval(() => {
      if (document.visibilityState !== 'visible') {
        return;
      }

      if (mode === 'full') {
        void fetchAttendance();
        void fetchCalendar();
        void fetchToday();
      }
      if (canAccessLeave) {
        void fetchLeaveRequests();
        void fetchLeaveBalances();
      }
    }, 30000);

    return () => window.clearInterval(interval);
  }, [calendarMonth, calendarScope, countryFilter, endDate, isAdmin, mode, selectedFilterUserId, selectedUserId, startDate, canAccessLeave]);

  useEffect(() => {
    if (!isAdmin) return;
    if (selectedFilterUserId) {
      setSelectedUserId(Number(selectedFilterUserId));
      setCalendarScope('selected');
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
  }, [isAdmin, rows, selectedFilterUserId, selectedUserId]);

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
      setEmployeeWebsiteUsage([]);
      return;
    }

    const monitoringUserId = selectedUserId;
    if (!monitoringUserId) return;

    let active = true;

    const fetchMonitoringPanel = async () => {
      try {
        const [insightsResponse, websiteResponse] = await Promise.all([
          reportApi.employeeInsights({ start_date: startDate, end_date: endDate, user_id: monitoringUserId }),
          activityApi.getAll({ user_id: monitoringUserId, type: 'url', start_date: startDate, end_date: endDate, page: 1, per_page: 10 }),
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
        setEmployeeWebsiteUsage(websiteRows);
      } catch (monitoringError) {
        console.error('Attendance monitoring panel fetch failed:', monitoringError);
        if (active) {
          setEmployeeMonitoring(null);
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
  const employeePanelRoleLabel = employeePanelUser ? resolveUserRoleLabel(employeePanelUser) : '';
  const attendancePanelUser = isAdmin ? selectedRow?.user : employeePanelUser;
  const monitoringUserId = canSeeAttendanceMonitoring ? selectedUserId : null;
  const canReviewLeaveRequest = (item: any) => canReviewApprovalRequest(user, item?.user);
  const canReviewTimeEditRequest = (item: any) => canReviewApprovalRequest(user, item?.user);
  const pendingLeaveRequests = useMemo(
    () => leaveRequests.filter((item) => item.status === 'pending' && canReviewApprovalRequest(user, item?.user)),
    [leaveRequests, user]
  );
  const leavePolicyCategories = useMemo(
    () => ((leaveBalances?.policy?.categories || []) as any[]),
    [leaveBalances?.policy?.categories]
  );
  const selfLeaveCategories = useMemo(
    () => ((leaveBalances?.self?.categories || []) as any[]),
    [leaveBalances?.self?.categories]
  );
  const leaveTeamBalances = useMemo(
    () => ((leaveBalances?.team || []) as any[]),
    [leaveBalances?.team]
  );
  const leaveTeamRows = useMemo(
    () => leaveTeamBalances
      .filter((row: any) => {
        const level = resolveUserHierarchyLevel(row?.user);
        return level !== null && level >= 50;
      })
      .sort((left: any, right: any) => String(left?.user?.name || '').localeCompare(String(right?.user?.name || ''))),
    [leaveTeamBalances]
  );
  const leaveFilterEmployeeOptions = useMemo(
    () => leaveTeamRows
      .map((row: any) => row?.user)
      .filter((employee: any) => Number(employee?.id || 0) > 0)
      .sort((left: any, right: any) => String(left?.name || '').localeCompare(String(right?.name || ''))),
    [leaveTeamRows]
  );
  const leaveFilterDepartmentOptions = useMemo(() => {
    const values = new Set<string>();
    leaveTeamRows.forEach((row: any) => {
      const department = String(row?.user?.department || '').trim();
      if (department) {
        values.add(department);
      }
    });
    return Array.from(values).sort((left, right) => left.localeCompare(right));
  }, [leaveTeamRows]);
  const leaveDepartmentByUserId = useMemo(() => {
    const lookup = new Map<number, string>();
    leaveTeamRows.forEach((row: any) => {
      const userId = Number(row?.user?.id || 0);
      if (!userId) return;
      const department = String(row?.user?.department || '').trim();
      if (department) {
        lookup.set(userId, department);
      }
    });
    return lookup;
  }, [leaveTeamRows]);
  const filteredLeaveTeamRows = useMemo(
    () => leaveTeamRows.filter((row: any) => {
      const userId = Number(row?.user?.id || 0);
      const department = String(row?.user?.department || '').trim();
      const matchesEmployee = !leaveFilterUserId || userId === Number(leaveFilterUserId);
      const matchesDepartment = leaveFilterDepartment === 'ALL' || department === leaveFilterDepartment;
      return matchesEmployee && matchesDepartment;
    }),
    [leaveFilterDepartment, leaveFilterUserId, leaveTeamRows]
  );
  const filteredLeaveRequests = useMemo(
    () => leaveRequests.filter((item: any) => {
      const userId = Number(item?.user?.id || item?.user_id || 0);
      const requestDepartment = String(item?.user?.department || leaveDepartmentByUserId.get(userId) || '').trim();
      const matchesEmployee = !leaveFilterUserId || userId === Number(leaveFilterUserId);
      const matchesDepartment = leaveFilterDepartment === 'ALL' || requestDepartment === leaveFilterDepartment;
      return matchesEmployee && matchesDepartment;
    }),
    [leaveDepartmentByUserId, leaveFilterDepartment, leaveFilterUserId, leaveRequests]
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
  const outcomeMap = useMemo(() => {
    const map = new Map<string, DayOutcomePayload>();
    for (const day of dayOutcomes) {
      if (day?.date) map.set(String(day.date), day);
    }
    return map;
  }, [dayOutcomes]);
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
    ? formatDateTime(employeeProfile.status.last_seen_at, displayTimezone)
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
  const employeeLiveToolLabel = resolveLiveToolLabel(employeeLiveMonitoring);
  const employeeLiveToolType = employeeLiveMonitoring?.tool_type || employeeLiveMonitoring?.activity_type || 'No tool type';
  const employeeLiveActivityLabel = resolveLiveActivityLabel(employeeLiveMonitoring);

  if (!canAccessAttendance && mode === 'full') {
    return (
      <PageEmptyState
        title="Attendance monitoring disabled"
        description="Attendance monitoring is not enabled for your account."
      />
    );
  }

  if (mode === 'leave') {
    const leaveHolidayMap = new Map<string, string>(
      leaveHolidays.map((h: any) => [String(h.holiday_date), String(h.title || 'Holiday')])
    );
    const leaveHolidayDates = new Set<string>(leaveHolidayMap.keys());
    const leaveColorOf = makeCategoryColorOf(selfLeaveCategories, resolvedTheme);
    const canManageLeave = Boolean(leaveBalances?.approval_scope?.can_manage);

    return (
      <div className="space-y-5 animate-fade-in">
        <PageHeader
          eyebrow="Leave operations"
          title="Leave"
          description="Balances, who is off, and approvals in one place."
          actions={
            canAccessLeave ? (
              <Button onClick={() => setLeaveDrawerOpen(true)}>+ Request leave</Button>
            ) : undefined
          }
        />

        {leaveFeedback ? <FeedbackBanner tone={leaveFeedback.tone} message={leaveFeedback.message} /> : null}

        <LeaveBalanceCards
          categories={selfLeaveCategories}
          unpaidUsed={Number(leaveBalances?.self?.unpaid?.used || 0)}
          isLoading={isLeaveBalanceLoading}
          onRefresh={fetchLeaveBalances}
          colorOf={leaveColorOf}
          onExplain={user?.id ? (code) => setLedgerCode(code) : undefined}
        />

        {user?.id ? (
          <LeaveLedgerDrawer
            open={ledgerCode !== null}
            userId={user.id}
            focusCode={ledgerCode}
            onClose={() => setLedgerCode(null)}
          />
        ) : null}

        <WhosOffStrip requests={filteredLeaveRequests} holidays={leaveHolidayMap} colorOf={leaveColorOf} />

        {canManageLeave ? (
          <SurfaceCard className="p-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <FieldLabel>Specific Employee</FieldLabel>
                <EmployeeSelect
                  employees={leaveFilterEmployeeOptions}
                  value={leaveFilterUserId}
                  onChange={(nextValue) => setLeaveFilterUserId(nextValue)}
                  includeAllOption
                  allOptionLabel="All employees"
                  placeholder="Choose employee"
                  searchPlaceholder="Search employee"
                  emptyMessage="No employee matched the current search."
                  ariaLabel="Filter leave by employee"
                />
              </div>
              <div>
                <FieldLabel>Department</FieldLabel>
                <SelectInput
                  value={leaveFilterDepartment}
                  onChange={(event) => setLeaveFilterDepartment(String(event.target.value || 'ALL'))}
                >
                  <option value="ALL">All departments</option>
                  {leaveFilterDepartmentOptions.map((department) => (
                    <option key={department} value={department}>
                      {department}
                    </option>
                  ))}
                </SelectInput>
              </div>
            </div>
          </SurfaceCard>
        ) : null}

        {canManageLeave ? (
          <TeamLeaveBalances
            rows={filteredLeaveTeamRows}
            isLoading={isLeaveBalanceLoading}
            onRefresh={fetchLeaveBalances}
            colorOf={leaveColorOf}
          />
        ) : null}

        {canAccessLeave ? (
          <LeaveRequestsPanel
            requests={filteredLeaveRequests}
            totalOnServer={leaveTotal}
            currentUserId={Number(user?.id || 0)}
            hasApprovalPowers={canManageLeave || isAdmin}
            isLoading={isLeaveLoading}
            canReview={canReviewLeaveRequest}
            canRequestRevoke={canRequestRevoke}
            isAdmin={isAdmin}
            onApprove={approveLeave}
            onReject={rejectLeave}
            onRequestRevoke={requestLeaveRevoke}
            onApproveRevoke={approveLeaveRevoke}
            onRejectRevoke={rejectLeaveRevoke}
            formatCategoryLabel={formatLeaveCategoryLabel}
            colorOf={leaveColorOf}
            renderEscalate={(item) =>
              (item.current_reviewer_ids?.some((id: number) => Number(id) === Number(user?.id)) || isAdmin) && item.status === 'pending' ? (
                <RequestEscalateControl
                  item={item}
                  onTransfer={(note, toUserId) => transferLeave(item.id, note, toUserId)}
                  forwardTargetLoader={() => leaveApi.forwardTargets(item.id).then((r) => r.data.data)}
                />
              ) : null
            }
          />
        ) : null}

        <LeaveRequestDrawer
          open={leaveDrawerOpen}
          onClose={() => setLeaveDrawerOpen(false)}
          categories={selfLeaveCategories}
          holidayDates={leaveHolidayDates}
          submitting={isLeaveSubmitting}
          onSubmit={submitLeave}
        />
      </div>
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
      <div className="space-y-5 animate-fade-in">
        <PageHeader
          eyebrow="Time operations"
          title="Overtime & time edits"
          description="Request extra time against a specific day, and review requests with that day attached."
        />
        {timeEditFeedback ? <FeedbackBanner tone={timeEditFeedback.tone} message={timeEditFeedback.message} /> : null}
        <OvertimeWorkspace
          requests={timeEditRequests}
          currentUserId={Number(user?.id)}
          canRequest={canRequestTimeEdit}
          canReview={canReviewTimeEditRequest}
          isLoading={isTimeEditLoading}
          submitting={isTimeEditSubmitting}
          dayLookup={(dateISO) => calendarDays.find((day: any) => day?.date === dateISO)}
          onMonthNeeded={(month) => setCalendarMonth(month)}
          fetchDayFor={fetchDayContextFor}
          onSubmit={submitTimeEditRequest}
          onApprove={approveTimeEdit}
          onReject={rejectTimeEdit}
          renderEscalate={(item) =>
            (item.current_reviewer_ids?.some((id: number) => Number(id) === Number(user?.id)) || isAdmin) ? (
              <RequestEscalateControl
                item={item}
                onTransfer={(note, toUserId) => transferTimeEdit(item.id, note, toUserId)}
                forwardTargetLoader={() => attendanceTimeEditApi.forwardTargets(item.id).then((r) => r.data.data)}
              />
            ) : null
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader eyebrow="Attendance operations" title="Attendance" description={isAdmin ? 'Track attendance, punches, and overtime requests across the team.' : 'Review your attendance, punches, and overtime history.'} />

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
              onChange={handleEmployeeFilterChange}
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
        <div className="flex items-end">
          <button
            type="button"
            onClick={handleExportAttendance}
            disabled={isExporting || isLoading}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isExporting ? (
              <>
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
                Exporting...
              </>
            ) : (
              <>
                <Download className="h-4 w-4" />
                Export CSV
              </>
            )}
          </button>
        </div>
      </FilterPanel>

      {/* One row of views instead of ten stacked sections. */}
      <div className="flex gap-0.5 rounded-lg bg-slate-100 p-0.5" role="group" aria-label="Attendance view">
        {([
          { key: 'overview', label: 'Overview' },
          { key: 'calendar', label: 'Calendar' },
          { key: 'requests', label: 'Requests' },
        ] as const).map((view) => (
          <button
            key={view.key}
            type="button"
            aria-pressed={attendanceView === view.key}
            onClick={() => setAttendanceView(view.key)}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition sm:flex-none ${
              attendanceView === view.key
                ? 'bg-white text-slate-950 shadow-card'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            {view.label}
          </button>
        ))}
      </div>

      <div className={`grid grid-cols-1 lg:grid-cols-3 gap-4 ${attendanceView === 'overview' ? '' : 'hidden'}`}>
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
                  {employeePanelRoleLabel ? <span className="ml-2 capitalize">• {employeePanelRoleLabel}</span> : null}
                </p>
                <p className="mt-2 text-sm text-slate-600">
                  {organization?.name || 'Organization workspace'}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
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
                <div key={item.label} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
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
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Current tool</p>
              <p className="mt-2 whitespace-normal break-words text-sm font-semibold text-slate-950">{employeeLiveToolLabel}</p>
              <p className="mt-1 text-xs capitalize text-slate-500">{employeeLiveToolType}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Work status</p>
              <p className="mt-2 text-sm font-semibold capitalize text-slate-950">{employeeLiveMonitoring?.work_status?.replace('_', ' ') || 'inactive'}</p>
              <p className="mt-1 text-xs text-slate-500">{employeeLiveMonitoring?.is_working ? 'Timer active now' : 'No active timer right now'}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Last activity</p>
              <p className="mt-2 whitespace-normal break-words text-sm font-semibold text-slate-950">{employeeLiveActivityLabel}</p>
              <p className="mt-1 text-xs text-slate-500">{employeeMonitoring?.stats?.activity_events || 0} activity events in selected range</p>
            </div>
          </div>

        </SurfaceCard>
        ) : null}

        {canSeeAttendanceMonitoring ? (
          <SurfaceCard className="lg:col-span-3 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-sky-700">Website Panel</p>
                <h3 className="mt-2 text-lg font-semibold text-slate-950">Website productivity</h3>
              </div>
              <span className="text-xs text-slate-500">Selected range</span>
            </div>
            {employeeWebsiteUsage.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">No website usage found for this employee.</p>
            ) : (
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {employeeWebsiteUsage.slice(0, 6).map((item: any) => (
                  <div key={`${item.website}-${item.classification}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
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
              {canAccessLeave && hasApprovedLeaveToday ? (
                <p className="text-xs text-red-600 mt-1">Approved leave for today. Punch-in is disabled.</p>
              ) : null}
              {canAccessLeave && hasHalfDayLeaveToday ? (
                <p className="text-xs text-amber-700 mt-1">
                  Half day leave applied for today. Your shift target is reduced to{' '}
                  {formatDuration(resolveShiftTargetSeconds(
                    todayRecord?.shift_target_seconds,
                    payloadShiftTargetSeconds,
                    // The server has already halved the resolved shift; half of
                    // the eight-hour default is only reached when no shift is
                    // configured at all.
                    { fallbackSeconds: DEFAULT_SHIFT_TARGET_SECONDS / 2 }
                  ))}.
                </p>
              ) : null}
              {canAccessLeave && leaveToday && !hasApprovedLeaveToday && !hasHalfDayLeaveToday ? (
                <p className="text-xs text-slate-600 mt-1">{leaveToday.label}</p>
              ) : null}
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div className="rounded-lg border border-gray-200 px-3 py-2">
                  <p className="text-[11px] text-gray-500">First Punch In</p>
                  <p className="text-sm font-semibold text-gray-900">{todayRecord?.check_in_at ? formatTimeForTimezone(todayRecord.check_in_at, displayTimezone) : '--'}</p>
                </div>
                <div className="rounded-lg border border-gray-200 px-3 py-2">
                  <p className="text-[11px] text-gray-500">Last Punch Out</p>
                  <p className="text-sm font-semibold text-gray-900">{todayRecord?.check_out_at ? formatTimeForTimezone(todayRecord.check_out_at, displayTimezone) : '--'}</p>
                </div>
                <div className="rounded-lg border border-gray-200 px-3 py-2">
                  <p className="text-[11px] text-gray-500">Track Time</p>
                  <p className="text-sm font-semibold text-gray-900">{formatDuration(todayRecord?.work_time_breakdown?.track_time || 0)}</p>
                </div>
                <div className="rounded-lg border border-gray-200 px-3 py-2">
                  <p className="text-[11px] text-gray-500">Work Time</p>
                  <p className="text-sm font-semibold text-gray-900">{formatDuration(todayRecord?.work_time_breakdown?.work_time || todayRecord?.worked_seconds || 0)}</p>
                </div>
                <div className="rounded-lg border border-gray-200 px-3 py-2">
                  <p className="text-[11px] text-gray-500">Idle Time</p>
                  <p className="text-sm font-semibold text-gray-900">{formatDuration(todayRecord?.work_time_breakdown?.idle_time || 0)}</p>
                </div>
                <div className="rounded-lg border border-gray-200 px-3 py-2">
                  <p className="text-[11px] text-gray-500">Presence (punches)</p>
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
                  <p className="text-sm font-semibold text-gray-900">{formatDuration(resolveShiftTargetSeconds(todayRecord?.shift_target_seconds, payloadShiftTargetSeconds))}</p>
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <Button onClick={doCheckIn} disabled={isPunchLoading || !!todayRecord?.is_checked_in || (canAccessLeave && hasApprovedLeaveToday)} variant="secondary">
                Punch In
              </Button>
              <Button onClick={doCheckOut} disabled={isPunchLoading || !todayRecord?.is_checked_in}>
                Punch Out
              </Button>
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-3">
            Office start: {officeStart} | Late threshold: {lateAfter} {userTimezone && `(${userTimezone})`}
          </p>
          {todayRecord?.punches?.length ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {todayRecord.punches.map((punch) => (
                <span key={punch.id} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-700">
                  {formatTimeForTimezone(punch.punch_in_at, displayTimezone)} - {punch.punch_out_at ? formatTimeForTimezone(punch.punch_out_at, displayTimezone) : 'Active'}
                </span>
              ))}
            </div>
          ) : null}
        </SurfaceCard>
      </div>

      {attendanceView === 'overview' ? (
        isAdmin ? (
          <AttendanceRoster
            rows={rows}
            isLoading={isLoading}
            selectedUserId={selectedRow?.user?.id ?? null}
            onOpenPerson={(userId) => {
              setSelectedUserId(userId);
              setCalendarScope('selected');
              setPersonDrawerOpen(true);
            }}
          />
        ) : (
          <TeamPresenceBoard
            people={teamPresenceQuery.data?.people ?? []}
            offSoon={teamPresenceQuery.data?.off_soon ?? []}
            departmentName={teamPresenceQuery.data?.department ?? null}
            isLoading={teamPresenceQuery.isLoading}
            timeZone={displayTimezone}
          />
        )
      ) : null}

      <div className={`grid grid-cols-1 lg:grid-cols-3 gap-4 ${attendanceView === 'calendar' ? '' : 'hidden'}`}>
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
                  // What the day COST, when the engines have answered for it.
                  // The old status/colour stay as the fallback, so a month whose
                  // outcomes have not loaded (or an org with no policies) looks
                  // exactly as it did before rather than looking wrong.
                  const outcome = describeDayOutcome(outcomeMap.get(ds));
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

                  const statusColor =
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
                  // A weekly off and a missed day used to share this grey cell.
                  // The outcome tone is what finally tells them apart.
                  const color = outcome.headline ? OUTCOME_TONE_CLASS[outcome.tone] : statusColor;
                  const canEditHolidayCell = isAdmin && inMonth;
                  const tooltip = item
                    ? [
                        item.date,
                        `status ${status}`,
                        (canAccessLeave && item?.leave_units) ? `leave units ${item.leave_units}` : null,
                        item?.holiday?.title ? `holiday ${item.holiday.title}` : null,
                        item?.holiday?.country ? `country ${formatCountryLabel(item.holiday.country)}` : null,
                        `worked ${formatDuration(item.worked_seconds || 0)}`,
                        `late ${item.late_minutes || 0}m`,
                        // The reason is the point: "half day" with no working
                        // behind it is unusable the moment it is disputed.
                        outcome.reason,
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
                      {outcome.headline ? (
                        <div className="mt-1 text-[10px] font-semibold leading-4">{outcome.headline}</div>
                      ) : statusLabel ? (
                        <div className={`mt-1 text-[10px] ${status === 'holiday' ? 'font-semibold leading-4' : 'uppercase tracking-wide'}`}>{statusLabel}</div>
                      ) : null}
                      {outcome.chips.length > 0 ? (
                        <OutcomeChips chips={outcome.chips.slice(0, 2)} className="mt-1" />
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

        {calendarScope === 'selected' ? (
          <DayOutcomeLedger days={dayOutcomes} isLoading={isDayOutcomesLoading} />
        ) : null}

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
                <span className="text-gray-600">Presence (punches)</span>
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

      {/* Same workspace as /edit-time — one implementation of the request
          form and the review list, not two drifting copies. */}
      <div className={attendanceView === 'requests' ? '' : 'hidden'}>
        {timeEditFeedback ? <FeedbackBanner tone={timeEditFeedback.tone} message={timeEditFeedback.message} /> : null}
        <div className="mt-3">
          <OvertimeWorkspace
            requests={timeEditRequests}
            currentUserId={Number(user?.id)}
            canRequest={canRequestTimeEdit}
            canReview={canReviewTimeEditRequest}
            isLoading={isTimeEditLoading}
            submitting={isTimeEditSubmitting}
            dayLookup={(dateISO) => calendarDays.find((day: any) => day?.date === dateISO)}
            onMonthNeeded={(month) => setCalendarMonth(month)}
            fetchDayFor={fetchDayContextFor}
            onSubmit={submitTimeEditRequest}
            onApprove={approveTimeEdit}
            onReject={rejectTimeEdit}
            renderEscalate={(item) =>
              (item.current_reviewer_ids?.some((id: number) => Number(id) === Number(user?.id)) || isAdmin) ? (
                <RequestEscalateControl
                  item={item}
                  onTransfer={(note, toUserId) => transferTimeEdit(item.id, note, toUserId)}
                  forwardTargetLoader={() => attendanceTimeEditApi.forwardTargets(item.id).then((r) => r.data.data)}
                />
              ) : null
            }
          />
        </div>
      </div>

      {/* Person detail: a drawer over the list instead of panels under it. */}
      <SlideOver
        open={personDrawerOpen && Boolean(selectedRow)}
        title={selectedRow?.user?.name ?? ''}
        subtitle={selectedRow?.user?.email ?? undefined}
        onClose={() => setPersonDrawerOpen(false)}
        footer={(
          <button
            type="button"
            onClick={() => {
              setPersonDrawerOpen(false);
              setAttendanceView('calendar');
            }}
            className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-blue-700"
          >
            Open month calendar
          </button>
        )}
      >
        {selectedRow ? (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              {[
                {
                  label: 'Present',
                  value: `${selectedRow.days_present}/${selectedRow.calendar_days_in_range || selectedRow.working_days_in_range || 0}`,
                },
                {
                  label: 'Attendance',
                  value: `${Math.round(selectedRow.attendance_rate)}%`,
                  warn: selectedRow.attendance_rate < 75,
                },
                { label: 'Leave days', value: selectedRow.leave_days || 0 },
                { label: 'Worked', value: formatDuration(selectedRow.work_time_breakdown?.work_time ?? selectedRow.worked_seconds ?? 0) },
                {
                  label: 'Idle',
                  value: formatDuration(selectedRow.work_time_breakdown?.idle_time ?? 0),
                  warn: (selectedRow.work_time_breakdown?.idle_time ?? 0) > 0.25 * Math.max(1, selectedRow.work_time_breakdown?.track_time ?? 0),
                },
                { label: 'Break', value: formatDuration(selectedRow.total_break_seconds || 0) },
              ].map((stat) => (
                <div key={stat.label} className="rounded-lg border border-slate-200 px-3 py-2">
                  <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">{stat.label}</p>
                  <p className={`mt-0.5 text-sm font-bold tabular-nums ${stat.warn ? 'text-warning-800' : 'text-slate-900'}`}>
                    {stat.value}
                  </p>
                </div>
              ))}
            </div>

            <div>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Present dates</p>
              <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
                {(selectedRow.present_dates || []).length === 0 ? (
                  <p className="text-xs text-slate-500">None in the selected range.</p>
                ) : (
                  (selectedRow.present_dates || []).map((date: string) => (
                    <span key={date} className="rounded-full border border-success-100 bg-success-50 px-2 py-0.5 text-[11px] tabular-nums text-success-800">
                      {date}
                    </span>
                  ))
                )}
              </div>
            </div>

            {canAccessLeave ? (
              <div>
                <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Leave dates</p>
                <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
                  {(selectedRow.leave_dates || []).length === 0 ? (
                    <p className="text-xs text-slate-500">None in the selected range.</p>
                  ) : (
                    (selectedRow.leave_dates || []).map((date: string) => (
                      <span key={date} className="rounded-full border border-accent-200 bg-accent-50 px-2 py-0.5 text-[11px] tabular-nums text-warning-800">
                        {date}
                      </span>
                    ))
                  )}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </SlideOver>
    </div>
  );
}
