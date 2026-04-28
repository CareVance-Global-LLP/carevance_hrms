import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { attendanceApi, attendanceTimeEditApi, dashboardApi } from '@/services/api';
import Button from '@/components/ui/Button';
import { PageLoadingState } from '@/components/ui/PageState';
import {
  Activity,
  Bell,
  Briefcase,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  FolderKanban,
  Hourglass,
  LogIn,
  LogOut,
  Search,
  Settings,
  TimerReset,
  TrendingUp,
} from 'lucide-react';
import { getTimeEntrySubtitle, getTimeEntryTitle } from '@/lib/timeEntryDisplay';
import type { TimeEntry } from '@/types';

const Card = ({ children, className = '' }: { children: ReactNode; className?: string }) => (
  <section className={`rounded-lg border border-slate-200 bg-white shadow-sm ${className}`}>{children}</section>
);

const SectionTitle = ({ title, action }: { title: string; action?: ReactNode }) => (
  <div className="mb-4 flex items-center justify-between gap-3">
    <h2 className="text-[15px] font-semibold text-slate-950">{title}</h2>
    {action ?? <span />}
  </div>
);

const KpiCard = ({ label, value, hint, icon: Icon, tint }: { label: string; value: string | number; hint: string; icon: any; tint: string }) => (
  <Card className="p-4">
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
  </Card>
);

const EmptyInline = ({ children }: { children: ReactNode }) => (
  <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-xs text-slate-500">
    {children}
  </div>
);

export default function Dashboard() {
  const { user } = useAuth();
  const [activeTimer, setActiveTimer] = useState<TimeEntry | null>(null);
  const [todayEntries, setTodayEntries] = useState<TimeEntry[]>([]);
  const [todayTotal, setTodayTotal] = useState(0);
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

  const remainingShiftSeconds = Math.max(0, shiftTargetSeconds - workedSeconds);
  const overtimeSeconds = Math.max(0, workedSeconds - shiftTargetSeconds);
  const isCheckedIn = Boolean(attendanceToday?.is_checked_in || activeTimer);
  const completionPercent = shiftTargetSeconds > 0
    ? Math.min(100, Math.round((workedSeconds / shiftTargetSeconds) * 100))
    : 0;
  const hasHalfDayLeaveToday = leaveToday?.leave_type === 'half_day';
  const completedSessions = todayEntries.filter((entry) => Boolean(entry.end_time)).length;
  const averageEntrySeconds = todayEntries.length > 0 ? Math.round(todayTotal / todayEntries.length) : 0;
  const trackedTodaySeconds = Math.max(todayTotal, workedSeconds);

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
        worked_seconds: workedSeconds,
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

  const formatClockTime = (value?: string | null) => {
    if (!value) return 'Not recorded';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return 'Not recorded';
    return parsed.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
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
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex h-10 min-w-64 flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-400 xl:w-80 xl:flex-none">
            <Search className="h-4 w-4" />
            <input className="w-full bg-transparent outline-none placeholder:text-slate-400" placeholder="Search dashboard..." />
          </label>
          <button className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700">
            {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </button>
          <Link aria-label="Notifications" to="/notifications" className="relative rounded-lg border border-slate-200 bg-white p-2 text-slate-600">
            <Bell className="h-4 w-4" />
          </Link>
          <Link aria-label="Settings" to="/settings" className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600">
            <Settings className="h-4 w-4" />
          </Link>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiCard label="Worked Today" value={formatDuration(workedSeconds)} hint={todayDeltaLabel} icon={Clock} tint="bg-blue-50 text-blue-600" />
        <KpiCard label="Time Left Today" value={formatDuration(remainingShiftSeconds)} hint={`Target ${formatDuration(shiftTargetSeconds)}`} icon={Hourglass} tint="bg-violet-50 text-violet-600" />
        <KpiCard label="Productivity" value={`${productivityScore}%`} hint="Based on this week's working ratio" icon={TrendingUp} tint="bg-amber-50 text-amber-600" />
        <KpiCard
          label={hasHalfDayLeaveToday ? 'Leave Today' : 'Active Tasks'}
          value={hasHalfDayLeaveToday ? 'Half Day' : activeTasksCount}
          hint={hasHalfDayLeaveToday ? 'Attendance target reduced' : `${totalTasksCount} total tasks`}
          icon={FolderKanban}
          tint="bg-emerald-50 text-emerald-600"
        />
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.9fr)_minmax(0,0.9fr)]">
        <Card className="p-4">
          <SectionTitle title="Today's shift" action={<span className="text-xs text-slate-500">{completionPercent}% done</span>} />
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-slate-500">Worked today</p>
              <p className="mt-2 text-3xl font-semibold text-slate-950">{formatDuration(workedSeconds)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Remaining</p>
              <p className="mt-2 text-3xl font-semibold text-slate-950">{formatDuration(remainingShiftSeconds)}</p>
            </div>
          </div>
          <div className="mt-5 h-2 rounded-full bg-slate-100">
            <span className="block h-2 rounded-full bg-blue-600" style={{ width: `${Math.max(completionPercent, workedSeconds ? 8 : 0)}%` }} />
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

        <Card className="p-4">
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
                <p className={`mt-2 font-semibold ${lateMinutes > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{lateMinutes > 0 ? `${lateMinutes}m` : 'On time'}</p>
              </div>
              <div className="rounded-lg border border-slate-100 p-3">
                <p className="text-slate-500">Overtime</p>
                <p className="mt-2 font-semibold text-slate-900">{formatDuration(overtimeSeconds)}</p>
              </div>
            </div>
          </div>
        </Card>

        <Card className="p-4">
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
        <Card className="p-4">
          <SectionTitle title="My Work Log" action={<Link to="/time-tracker" className="text-xs font-medium text-blue-600">Open Time Tracker</Link>} />
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
                      <td className="px-4 py-3 text-slate-600">{new Date(entry.start_time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</td>
                      <td className="px-4 py-3 font-semibold text-slate-900">{formatDuration(entry.duration)}</td>
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

        <Card className="p-4">
          <SectionTitle title="Quick Actions" />
          <div className="grid grid-cols-1 gap-3 text-xs">
            <Link to="/time-tracker" className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 font-semibold text-slate-700 hover:bg-slate-50">
              <TimerReset className="h-4 w-4 text-blue-600" />
              Time Tracker
            </Link>
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
