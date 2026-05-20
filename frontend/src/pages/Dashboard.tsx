import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { attendanceApi, attendanceTimeEditApi, dashboardApi, notificationApi } from '@/services/api';
import Button from '@/components/ui/Button';
import { PageLoadingState } from '@/components/ui/PageState';
import SearchSuggestInput from '@/components/ui/SearchSuggestInput';
import { formatDate as formatDateForTimezone, formatDateTime as formatDateTimeForTimezone, formatTime as formatTimeForTimezone, getStartTimeMs } from '@/lib/dateTime';
import {
  Activity,
  Bell,
  Briefcase,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  FileClock,
  FolderKanban,
  Hourglass,
  LogIn,
  LogOut,
  Search,
  Settings,
  TrendingUp,
} from 'lucide-react';
import { getTimeEntrySubtitle, getTimeEntryTitle } from '@/lib/timeEntryDisplay';
import { CHAT_NOTIFICATION_TYPES } from '@/lib/chatNotifications';
import { DEFAULT_APP_TIMEZONE, resolveTimeZone } from '@/lib/timezones';
import type { AppNotificationItem, TimeEntry } from '@/types';
import type { SearchSuggestionOption } from '@/lib/searchSuggestions';

const Card = ({ children, className = '', id }: { children: ReactNode; className?: string; id?: string }) => (
  <section id={id} className={`rounded-lg border border-slate-200 bg-white shadow-sm ${className}`}>{children}</section>
);

const SectionTitle = ({ title, action }: { title: string; action?: ReactNode }) => (
  <div className="mb-4 flex items-center justify-between gap-3">
    <h2 className="text-[15px] font-semibold text-slate-950">{title}</h2>
    {action ?? <span />}
  </div>
);

const KpiCard = ({ label, value, hint, icon: Icon, tint, to }: { label: string; value: string | number; hint: string; icon: any; tint: string; to?: string }) => {
  const content = (
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-xs text-slate-500">{label}</p>
        <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">{value}</p>
        <p className="mt-2 text-[11px] text-slate-500">{hint}</p>
      </div>
      <div className={`flex h-10 w-10 items-center justify-center rounded-full ${tint}`}>
        <Icon className="h-5 w-5" />
      </div>
    </div>
  );

  if (to) {
    return (
      <Link to={to} className="block rounded-lg transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2">
        <Card className="p-4">{content}</Card>
      </Link>
    );
  }

  return <Card className="p-4">{content}</Card>;
};

const EmptyInline = ({ children }: { children: ReactNode }) => (
  <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-xs text-slate-500">
    {children}
  </div>
);

type DashboardSearchPayload = {
  type: 'route' | 'section';
  to?: string;
  sectionId?: string;
};

const formatNotificationDate = (value?: string | null, timezone = DEFAULT_APP_TIMEZONE) =>
  formatDateTimeForTimezone(value, timezone, 'en-US', 'Just now');

export default function Dashboard() {
  const { user } = useAuth();
  const displayTimezone = resolveTimeZone(user?.settings?.timezone || DEFAULT_APP_TIMEZONE);
  const navigate = useNavigate();
  const [activeTimer, setActiveTimer] = useState<TimeEntry | null>(null);
  const [clockTick, setClockTick] = useState(() => Date.now());
  const [searchQuery, setSearchQuery] = useState('');
  const [todayEntries, setTodayEntries] = useState<TimeEntry[]>([]);
  const [todayTotal, setTodayTotal] = useState(0);
  const [weeklyTotal, setWeeklyTotal] = useState(0);
  const [productivityScore, setProductivityScore] = useState(0);
  const [activeTasksCount, setActiveTasksCount] = useState(0);
  const [totalTasksCount, setTotalTasksCount] = useState(0);
  const [todayDeltaLabel, setTodayDeltaLabel] = useState('No change from yesterday');
  const [isLoading, setIsLoading] = useState(true);
  const [attendanceToday, setAttendanceToday] = useState<any | null>(null);
  const [shiftTargetSeconds, setShiftTargetSeconds] = useState(8 * 3600);
  const [workedSeconds, setWorkedSeconds] = useState(0);
  const [isSubmittingOvertime, setIsSubmittingOvertime] = useState(false);
  const [notice, setNotice] = useState('');
  const [leaveToday, setLeaveToday] = useState<any | null>(null);
  const [notifications, setNotifications] = useState<AppNotificationItem[]>([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const notificationsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [dashboardResponse, attendanceResponse] = await Promise.all([
          dashboardApi.summary(),
          attendanceApi.today(),
        ]);

        const data = dashboardResponse.data as any;
        const attendancePayload = attendanceResponse.data as any;
        const attendanceRecord = attendancePayload?.record || null;

        setActiveTimer(data?.active_timer || null);
        setTodayEntries(data?.today_entries || []);
        setTodayTotal(Number(data?.today_total_elapsed_duration ?? data?.today_total_duration ?? 0) || 0);
        setWeeklyTotal(Number(data?.weekly_total_elapsed_duration ?? data?.weekly_total_duration ?? 0) || 0);
        setProductivityScore(Number(data?.productivity_score) || 0);
        setActiveTasksCount(Number(data?.active_tasks_count ?? data?.active_projects_count) || 0);
        setTotalTasksCount(Number(data?.total_tasks_count ?? data?.total_projects_count) || 0);
        setAttendanceToday(attendanceRecord);
        setLeaveToday(attendancePayload?.leave_today || null);
        setShiftTargetSeconds(Number(attendancePayload?.shift_target_seconds || attendanceRecord?.shift_target_seconds || 8 * 3600));
        setWorkedSeconds(Number(attendanceRecord?.worked_seconds || data?.today_total_elapsed_duration || data?.today_total_duration || 0) || 0);

        const pct = data?.today_change_percent;
        if (typeof pct === 'number') {
          setTodayDeltaLabel(`${pct >= 0 ? '+' : ''}${pct}% from yesterday`);
        } else {
          const elapsed = Number(data?.today_total_elapsed_duration ?? data?.today_total_duration ?? 0) || 0;
          setTodayDeltaLabel(elapsed > 0 ? 'You have started today well' : 'No time logged yet today');
        }
      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, []);

  useEffect(() => {
    const fetchNotifications = async () => {
      try {
        const response = await notificationApi.list({ limit: 5 });
        setNotifications(response.data?.data || []);
        setUnreadNotifications(Number(response.data?.unread_count || 0));
      } catch (error) {
        console.error('Error fetching notifications:', error);
      }
    };

    fetchNotifications();
  }, []);

  useEffect(() => {
    if (!isNotificationsOpen) return;

    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && !notificationsRef.current?.contains(target)) {
        setIsNotificationsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [isNotificationsOpen]);

  useEffect(() => {
    if (!isNotificationsOpen || unreadNotifications <= 0) {
      return;
    }

    let active = true;

    setUnreadNotifications(0);
    setNotifications((prev) => prev.map((item) => ({ ...item, is_read: true })));

    notificationApi.markAllRead({ exclude_types: CHAT_NOTIFICATION_TYPES }).catch(() => {
      if (active) {
        setUnreadNotifications(notifications.filter((item) => !item.is_read).length);
        setNotifications(notifications);
      }
    });

    return () => {
      active = false;
    };
  }, [isNotificationsOpen, unreadNotifications, notifications]);

  useEffect(() => {
    if (!activeTimer) {
      return;
    }

    setClockTick(Date.now());
    const interval = window.setInterval(() => {
      setClockTick(Date.now());
    }, 1000);

    return () => window.clearInterval(interval);
  }, [activeTimer?.duration, activeTimer?.id, activeTimer?.start_time]);

  const activeTimerBaseSeconds = Number.isFinite(Number(activeTimer?.duration)) ? Number(activeTimer?.duration) : 0;
  const activeTimerStartMs = getStartTimeMs(activeTimer?.start_time);
  const activeTimerElapsedSeconds = activeTimer && Number.isFinite(activeTimerStartMs)
    ? Math.max(0, Math.floor((clockTick - activeTimerStartMs) / 1000))
    : 0;
  const activeTimerSeconds = activeTimer ? Math.max(activeTimerBaseSeconds, activeTimerElapsedSeconds) : 0;
  const liveActiveDeltaSeconds = activeTimer ? Math.max(0, activeTimerSeconds - activeTimerBaseSeconds) : 0;
  const effectiveWorkedSeconds = workedSeconds + liveActiveDeltaSeconds;
  const effectiveTodayTotal = todayTotal + liveActiveDeltaSeconds;
  const remainingShiftSeconds = Math.max(0, shiftTargetSeconds - effectiveWorkedSeconds);
  const overtimeSeconds = Math.max(0, effectiveWorkedSeconds - shiftTargetSeconds);
  const isCheckedIn = Boolean(attendanceToday?.is_checked_in || activeTimer);
  const completionPercent = shiftTargetSeconds > 0
    ? Math.min(100, Math.round((effectiveWorkedSeconds / shiftTargetSeconds) * 100))
    : 0;
  const hasHalfDayLeaveToday = leaveToday?.leave_type === 'half_day';
  const completedSessions = todayEntries.filter((entry) => Boolean(entry.end_time)).length;
  const averageEntrySeconds = todayEntries.length > 0 ? Math.round(effectiveTodayTotal / todayEntries.length) : 0;
  const trackedTodaySeconds = Math.max(effectiveTodayTotal, effectiveWorkedSeconds);

  const submitOvertimeProof = async () => {
    if (overtimeSeconds <= 0) {
      setNotice('Overtime has not started yet.');
      return;
    }

    setIsSubmittingOvertime(true);
    setNotice('');
    try {
      const todayDate = attendanceToday?.attendance_date || new Date().toISOString().split('T')[0];
      await attendanceTimeEditApi.create({
        attendance_date: todayDate,
        extra_minutes: Math.ceil(overtimeSeconds / 60),
        worked_seconds: effectiveWorkedSeconds,
        overtime_seconds: overtimeSeconds,
        message: `Dashboard overtime summary submitted. Overtime: ${formatDuration(overtimeSeconds)}.`,
      });
      setNotice(`Overtime proof sent. Extra time: ${formatDuration(overtimeSeconds)}.`);
    } catch (error: any) {
      setNotice(error?.response?.data?.message || 'Failed to submit overtime proof.');
    } finally {
      setIsSubmittingOvertime(false);
    }
  };

  const formatDuration = (seconds: number) => {
    const safeSeconds = Number.isFinite(Number(seconds)) ? Number(seconds) : 0;
    const hours = Math.floor(safeSeconds / 3600);
    const minutes = Math.floor((safeSeconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  };

  const formatTimerClock = (seconds: number) => {
    const safeSeconds = Number.isFinite(Number(seconds)) ? Math.max(0, Number(seconds)) : 0;
    const hours = Math.floor(safeSeconds / 3600);
    const minutes = Math.floor((safeSeconds % 3600) / 60);
    const secs = Math.floor(safeSeconds % 60);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const formatClockTime = (value?: string | null) => {
    return formatTimeForTimezone(value, displayTimezone);
  };

  const punches = Array.isArray(attendanceToday?.punches) ? attendanceToday.punches : [];
  const latestPunch = punches[punches.length - 1];
  const checkInAt = attendanceToday?.check_in_at || punches[0]?.punch_in_at || null;
  const checkOutAt = attendanceToday?.check_out_at || latestPunch?.punch_out_at || null;
  const lateMinutes = Number(attendanceToday?.late_minutes || 0);
  const attendanceLabel = hasHalfDayLeaveToday
    ? 'Half day leave'
    : isCheckedIn
      ? 'Checked in'
      : checkOutAt
        ? 'Checked out'
        : 'Not checked in';
  const activeWorkTitle = activeTimer ? getTimeEntryTitle(activeTimer) : 'No active timer';
  const activeWorkSubtitle = activeTimer
    ? getTimeEntrySubtitle(activeTimer)
    : 'Start your timer when you begin a project or task.';
  const timerProject = activeTimer?.project?.name || activeTimer?.task?.project?.name || 'Not assigned';
  const timerTask = activeTimer?.task?.title || 'Not assigned';
  const dashboardSearchSuggestions = useMemo<SearchSuggestionOption<DashboardSearchPayload>[]>(() => {
    const routeSuggestions: SearchSuggestionOption<DashboardSearchPayload>[] = [
      { id: 'route-dashboard', label: 'Dashboard', description: 'Open the main employee dashboard', keywords: ['home', 'summary'], payload: { type: 'route', to: '/dashboard' } },
      { id: 'route-attendance', label: 'Attendance', description: 'Open attendance and shift records', keywords: ['check in', 'check out', 'shift'], payload: { type: 'route', to: '/attendance' } },
      { id: 'route-overtime', label: 'Overtime', description: 'Open overtime requests and proofs', keywords: ['extra time', 'proof'], payload: { type: 'route', to: '/overtime' } },
      { id: 'route-projects', label: 'Projects', description: 'Open assigned projects', keywords: ['work', 'client'], payload: { type: 'route', to: '/projects' } },
      { id: 'route-tasks', label: 'Tasks', description: 'Open your task list', keywords: ['todo', 'assigned work'], payload: { type: 'route', to: '/tasks' } },
      { id: 'route-chat', label: 'Chat', description: 'Open team messages', keywords: ['messages', 'conversation'], payload: { type: 'route', to: '/chat' } },
      { id: 'route-notifications', label: 'Notifications', description: 'Open the notifications center', keywords: ['alerts', 'announcements'], payload: { type: 'route', to: '/notifications' } },
      { id: 'route-settings', label: 'Settings', description: 'Open profile and preferences', keywords: ['profile', 'preferences'], payload: { type: 'route', to: '/settings' } },
    ];

    const sectionSuggestions: SearchSuggestionOption<DashboardSearchPayload>[] = [
      { id: 'section-shift', label: "Today's shift", description: 'Worked time, remaining time, status, and overtime', keywords: ['worked today', 'remaining'], payload: { type: 'section', sectionId: 'todays-shift' } },
      { id: 'section-attendance-shift', label: 'Attendance & Shift', description: 'Last check in, check out, late, and overtime', keywords: ['attendance', 'check in', 'check out'], payload: { type: 'section', sectionId: 'attendance-shift' } },
      { id: 'section-focus', label: 'My Focus', description: 'Current work, tasks, and tracked time', keywords: ['current work', 'task'], payload: { type: 'section', sectionId: 'my-focus' } },
      { id: 'section-work-log', label: 'My Work Log', description: "Today's time entries and running session", keywords: ['time entries', 'running'], payload: { type: 'section', sectionId: 'work-log' } },
      { id: 'section-time-tracker', label: 'Time Tracker', description: 'Active timer, project, task, and totals', keywords: ['timer', 'tracked'], payload: { type: 'section', sectionId: 'time-tracker-card' } },
      { id: 'section-quick-actions', label: 'Quick Actions', description: 'Shortcuts to common employee pages', keywords: ['shortcuts'], payload: { type: 'section', sectionId: 'quick-actions' } },
    ];

    const entrySuggestions = todayEntries.slice(0, 6).map((entry) => ({
      id: `entry-${entry.id}`,
      label: getTimeEntryTitle(entry),
      description: getTimeEntrySubtitle(entry),
      keywords: ['work log', 'time entry', entry.project?.name || '', entry.task?.title || ''],
      payload: { type: 'section' as const, sectionId: 'work-log' },
    }));

    return [...routeSuggestions, ...sectionSuggestions, ...entrySuggestions];
  }, [todayEntries]);

  const handleSearchSuggestionSelect = (suggestion: SearchSuggestionOption<DashboardSearchPayload>) => {
    const payload = suggestion.payload;
    setSearchQuery('');

    if (payload?.type === 'route' && payload.to) {
      navigate(payload.to);
      return;
    }

    if (payload?.type === 'section' && payload.sectionId) {
      document.getElementById(payload.sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  if (isLoading) {
    return <PageLoadingState label="Loading dashboard..." />;
  }

  return (
    <div className="w-full space-y-5 bg-[#f5f7fb] pb-8 text-slate-900 animate-fade-in">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Dashboard</h1>
          <p className="mt-3 text-sm font-medium text-slate-900">Good morning, {user?.name?.split(' ')[0] || 'there'}!</p>
          <p className="mt-1 text-xs text-slate-500">Here&apos;s your work summary, attendance, and task progress for today.</p>
        </div>
        <div className="flex items-center gap-3">
          <button className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700">
            {formatDateForTimezone(new Date(), displayTimezone)}
          </button>
          <Link
            to="/settings"
            className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 transition hover:bg-slate-50"
          >
            <Settings className="h-4 w-4" />
          </Link>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiCard to="/attendance" label="Worked Today" value={formatDuration(effectiveWorkedSeconds)} hint={todayDeltaLabel} icon={Clock} tint="bg-blue-50 text-blue-600" />
        <KpiCard to="/attendance" label="Time Left Today" value={formatDuration(remainingShiftSeconds)} hint={`Target ${formatDuration(shiftTargetSeconds)}`} icon={Hourglass} tint="bg-violet-50 text-violet-600" />
        <KpiCard to="/time-tracker" label="Productivity" value={`${productivityScore}%`} hint="Based on this week's working ratio" icon={TrendingUp} tint="bg-amber-50 text-amber-600" />
        <KpiCard
          to={hasHalfDayLeaveToday ? '/attendance' : '/tasks'}
          label={hasHalfDayLeaveToday ? 'Leave Today' : 'Active Tasks'}
          value={hasHalfDayLeaveToday ? 'Half Day' : activeTasksCount}
          hint={hasHalfDayLeaveToday ? 'Attendance target reduced' : `${totalTasksCount} total tasks`}
          icon={FolderKanban}
          tint="bg-emerald-50 text-emerald-600"
        />
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.9fr)_minmax(0,0.9fr)]">
        <Card id="todays-shift" className="scroll-mt-24 p-4">
          <SectionTitle title="Today's shift" action={<span className="text-xs text-slate-500">{completionPercent}% done</span>} />
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-slate-500">Worked today</p>
              <p className="mt-2 text-3xl font-semibold text-slate-950">{formatDuration(effectiveWorkedSeconds)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Remaining</p>
              <p className="mt-2 text-3xl font-semibold text-slate-950">{formatDuration(remainingShiftSeconds)}</p>
            </div>
          </div>
          <div className="mt-5 h-2 rounded-full bg-slate-100">
            <span className="block h-2 rounded-full bg-blue-600" style={{ width: `${Math.max(completionPercent, effectiveWorkedSeconds ? 8 : 0)}%` }} />
          </div>
          <div className="mt-4 flex flex-wrap gap-2 text-[11px]">
            <span className="rounded-md bg-blue-50 px-2 py-1 font-medium text-blue-700">Status: {attendanceLabel}</span>
            <span className="rounded-md bg-slate-100 px-2 py-1 text-slate-600">{completedSessions} completed session{completedSessions === 1 ? '' : 's'}</span>
            <span className="rounded-md bg-slate-100 px-2 py-1 text-slate-600">Avg session {formatDuration(averageEntrySeconds)}</span>
          </div>
          {overtimeSeconds > 0 ? (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button onClick={submitOvertimeProof} disabled={isSubmittingOvertime} size="sm">
                {isSubmittingOvertime ? 'Sending...' : 'Send overtime proof'}
              </Button>
              {notice ? <span className="text-xs text-slate-500">{notice}</span> : null}
            </div>
          ) : notice ? <p className="mt-3 text-xs text-slate-500">{notice}</p> : null}
        </Card>

        <Card id="attendance-shift" className="scroll-mt-24 p-4">
          <SectionTitle title="Attendance & Shift" action={<ClipboardCheck className="h-4 w-4 text-blue-600" />} />
          <div className="space-y-3 text-xs">
            <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50 p-3">
              <span className="flex items-center gap-2 text-slate-500"><LogIn className="h-4 w-4 text-emerald-600" />Last check in</span>
              <span className="font-semibold text-slate-900">{formatClockTime(checkInAt)}</span>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50 p-3">
              <span className="flex items-center gap-2 text-slate-500"><LogOut className="h-4 w-4 text-amber-600" />Last check out</span>
              <span className="font-semibold text-slate-900">{isCheckedIn ? 'Still checked in' : formatClockTime(checkOutAt)}</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-slate-100 p-3">
                <p className="text-slate-500">Late</p>
                <p className={`mt-2 font-semibold ${lateMinutes > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                  {lateMinutes > 0
                    ? (() => {
                        const hrs = Math.floor(lateMinutes / 60);
                        const mins = lateMinutes % 60;
                        if (hrs > 0) {
                          return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
                        }
                        return `${lateMinutes}m`;
                      })()
                    : 'On time'}
                </p>
              </div>
              <div className="rounded-lg border border-slate-100 p-3">
                <p className="text-slate-500">Overtime</p>
                <p className="mt-2 font-semibold text-slate-900">{formatDuration(overtimeSeconds)}</p>
              </div>
            </div>
          </div>
        </Card>

        <Card id="my-focus" className="scroll-mt-24 p-4">
          <SectionTitle title="My Focus" action={<Activity className="h-4 w-4 text-emerald-600" />} />
          <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Current work</p>
            <p className="mt-2 truncate text-sm font-semibold text-slate-950">{activeWorkTitle}</p>
            <p className="mt-1 truncate text-xs text-slate-500">{activeWorkSubtitle}</p>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-slate-100 p-3">
              <p className="text-xs text-slate-500">Tasks</p>
              <p className="mt-2 text-lg font-semibold text-slate-950">{activeTasksCount}</p>
            </div>
            <div className="rounded-lg border border-slate-100 p-3">
              <p className="text-xs text-slate-500">Tracked</p>
              <p className="mt-2 text-lg font-semibold text-slate-950">{formatDuration(trackedTodaySeconds)}</p>
            </div>
          </div>
        </Card>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card id="work-log" className="scroll-mt-24 p-4">
          <SectionTitle title="My Work Log" />
          <div className="overflow-x-auto rounded-lg border border-slate-100">
            {todayEntries.length === 0 ? (
              <EmptyInline>No work entries yet today</EmptyInline>
            ) : (
              <table className="min-w-[620px] w-full text-left text-xs">
                <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Project / Task</th>
                    <th className="px-4 py-3 font-medium">Started</th>
                    <th className="px-4 py-3 font-medium">Duration</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {todayEntries.map((entry) => (
                    <tr key={entry.id}>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-slate-900">{getTimeEntryTitle(entry)}</p>
                        <p className="mt-1 text-[11px] text-slate-500">{getTimeEntrySubtitle(entry)}</p>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{formatTimeForTimezone(entry.start_time, displayTimezone)}</td>
                      <td className="px-4 py-3 font-semibold text-slate-900">{formatDuration(entry.id === activeTimer?.id ? activeTimerSeconds : entry.duration)}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-md px-2 py-1 text-[11px] font-medium ${entry.end_time ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'}`}>
                          {entry.end_time ? 'Completed' : 'Running'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>

        <Card id="time-tracker-card" className="scroll-mt-24 p-4">
          <SectionTitle title="Time Tracker" action={<Link to="/time-tracker" className="text-xs font-medium text-blue-600">Open</Link>} />
          <div className="rounded-lg border border-slate-100 bg-slate-50 p-5 text-center">
            <p className="text-xs text-slate-500">{activeTimer ? 'Active timer' : 'No active timer'}</p>
            <p className="mt-2 text-3xl font-semibold tracking-tight text-blue-600">{formatTimerClock(activeTimerSeconds)}</p>
          </div>
          <div className="mt-4 space-y-3 rounded-lg border border-slate-100 p-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-slate-500"><Briefcase className="h-4 w-4" />Project</span>
              <span className="truncate font-semibold text-slate-900">{timerProject}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-slate-500"><FileClock className="h-4 w-4" />Task</span>
              <span className="truncate font-semibold text-slate-900">{timerTask}</span>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-slate-100 p-3">
              <p className="text-xs text-slate-500">Today</p>
              <p className="mt-2 text-lg font-semibold text-slate-950">{formatDuration(trackedTodaySeconds)}</p>
            </div>
            <div className="rounded-lg border border-slate-100 p-3">
              <p className="text-xs text-slate-500">This Week</p>
              <p className="mt-2 text-lg font-semibold text-slate-950">{formatDuration(weeklyTotal)}</p>
            </div>
          </div>
        </Card>

        <Card id="quick-actions" className="scroll-mt-24 p-4">
          <SectionTitle title="Quick Actions" />
          <div className="grid grid-cols-1 gap-3 text-xs">
            <Link to="/tasks" className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 font-semibold text-slate-700 hover:bg-slate-50">
              <FolderKanban className="h-4 w-4 text-emerald-600" />
              My Tasks
            </Link>
            <Link to="/attendance" className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 font-semibold text-slate-700 hover:bg-slate-50">
              <ClipboardCheck className="h-4 w-4 text-violet-600" />
              Attendance
            </Link>
            <Link to="/projects" className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 font-semibold text-slate-700 hover:bg-slate-50">
              <Briefcase className="h-4 w-4 text-amber-600" />
              Projects
            </Link>
          </div>
          <div className="mt-4 rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs text-slate-500">
            <div className="flex items-center gap-2 font-semibold text-slate-700">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              Attendance worked {formatDuration(trackedTodaySeconds)}
            </div>
            <p className="mt-2">Use these shortcuts for the items you can manage from your employee account.</p>
          </div>
        </Card>
      </section>
    </div>
  );
}
