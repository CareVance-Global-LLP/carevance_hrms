import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { attendanceApi, attendanceTimeEditApi, dashboardApi } from '@/services/api';
import PageHeader from '@/components/dashboard/PageHeader';
import MetricCard from '@/components/dashboard/MetricCard';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import Button from '@/components/ui/Button';
import { PageLoadingState } from '@/components/ui/PageState';
import {
  Activity,
  Briefcase,
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  FolderKanban,
  Hourglass,
  LogIn,
  LogOut,
  TimerReset,
  TrendingUp,
} from 'lucide-react';
import { getTimeEntrySubtitle, getTimeEntryTitle } from '@/lib/timeEntryDisplay';
import type { TimeEntry } from '@/types';

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
  const completedShift = workedSeconds >= shiftTargetSeconds;
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

  const formatTime = (seconds: number) => {
    const safeSeconds = Number.isFinite(Number(seconds)) ? Number(seconds) : 0;
    const hours = Math.floor(safeSeconds / 3600);
    const minutes = Math.floor((safeSeconds % 3600) / 60);
    const secs = Math.floor(safeSeconds % 60);
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
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
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        eyebrow="Personal overview"
        title={`Welcome back, ${user?.name?.split(' ')[0]}!`}
        description="Track your shift, attendance, active work, and today's task progress from one clear place."
        actions={
          <div className="inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/80 px-4 py-2 text-sm font-medium text-slate-600 shadow-sm">
            <Calendar className="h-4 w-4 text-sky-700" />
            {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </div>
        }
      />

      <SurfaceCard className="overflow-hidden border-0 bg-[linear-gradient(135deg,#082f49_0%,#0f172a_42%,#155e75_100%)] p-6 text-white shadow-[0_28px_80px_-52px_rgba(2,6,23,0.9)]">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-sm font-medium text-cyan-100/80">Today's shift</p>
            <div className="mt-3 flex flex-wrap items-end gap-x-8 gap-y-3">
              <div>
                <p className="text-xs uppercase tracking-[0.28em] text-cyan-100/60">Worked today</p>
                <p className="mt-2 text-4xl font-semibold tracking-[-0.05em] sm:text-5xl">{formatDuration(workedSeconds)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.28em] text-cyan-100/60">Remaining</p>
                <p className="mt-2 text-2xl font-semibold text-cyan-50">{formatDuration(remainingShiftSeconds)}</p>
              </div>
            </div>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-cyan-50/85">
              {completedShift
                ? `You have completed today's target and logged ${formatDuration(overtimeSeconds)} of overtime.`
                : `You are ${completionPercent}% through today's shift target. Keep going to close the remaining ${formatDuration(remainingShiftSeconds)}.`}
            </p>
            <div className="mt-4 flex flex-wrap gap-2 text-xs font-medium text-cyan-50">
              <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1">Status: {attendanceLabel}</span>
              <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1">Check-in: {formatClockTime(checkInAt)}</span>
              <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1">Check-out: {isCheckedIn ? 'Still checked in' : formatClockTime(checkOutAt)}</span>
            </div>
            {hasHalfDayLeaveToday ? (
              <p className="mt-3 inline-flex rounded-full border border-amber-200/40 bg-amber-300/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-amber-100">
                Half day leave applied today
              </p>
            ) : null}
          </div>

          <div className="grid min-w-[280px] grid-cols-2 gap-3">
            <div className="rounded-2xl border border-white/15 bg-white/10 p-4">
              <p className="text-xs text-cyan-100/70">Shift target</p>
              <p className="mt-2 text-xl font-semibold">{formatDuration(shiftTargetSeconds)}</p>
            </div>
            <div className="rounded-2xl border border-white/15 bg-white/10 p-4">
              <p className="text-xs text-cyan-100/70">Attendance</p>
              <p className="mt-2 text-xl font-semibold">{attendanceLabel}</p>
            </div>
            <div className="rounded-2xl border border-white/15 bg-white/10 p-4">
              <p className="text-xs text-cyan-100/70">Progress</p>
              <p className="mt-2 text-xl font-semibold">{completionPercent}%</p>
            </div>
            <div className="rounded-2xl border border-white/15 bg-white/10 p-4">
              <p className="text-xs text-cyan-100/70">Overtime</p>
              <p className="mt-2 text-xl font-semibold">{formatDuration(overtimeSeconds)}</p>
            </div>
          </div>
        </div>

        <div className="mt-6">
          <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-[0.24em] text-cyan-100/70">
            <span>Daily completion</span>
            <span>{completionPercent}%</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-white/10">
            <div
              className={`h-full rounded-full ${completedShift ? 'bg-emerald-400' : 'bg-cyan-300'}`}
              style={{ width: `${Math.max(completionPercent, completedShift ? 100 : 6)}%` }}
            />
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm text-cyan-50">
            <CheckCircle2 className="h-4 w-4" />
            {completedSessions} completed session{completedSessions === 1 ? '' : 's'}
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm text-cyan-50">
            <Hourglass className="h-4 w-4" />
            Avg session {formatDuration(averageEntrySeconds)}
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm text-cyan-50">
            <Clock className="h-4 w-4" />
            Attendance worked {formatDuration(trackedTodaySeconds)}
          </div>
          {overtimeSeconds > 0 ? (
            <Button
              onClick={submitOvertimeProof}
              disabled={isSubmittingOvertime}
              variant="secondary"
              size="sm"
              className="bg-white text-primary-700 hover:bg-sky-50"
            >
              {isSubmittingOvertime ? 'Sending...' : 'Send overtime proof'}
            </Button>
          ) : null}
          {notice ? <span className="text-sm text-cyan-50">{notice}</span> : null}
        </div>
      </SurfaceCard>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Worked Today" value={formatDuration(workedSeconds)} hint={todayDeltaLabel} icon={Clock} accent="sky" />
        <MetricCard
          label="Time Left Today"
          value={formatDuration(remainingShiftSeconds)}
          hint={`${hasHalfDayLeaveToday ? 'Half-day target' : 'Target'} ${formatDuration(shiftTargetSeconds)}`}
          icon={Hourglass}
          accent="violet"
        />
        <MetricCard label="Productivity" value={`${productivityScore}%`} hint="Based on this week's working ratio" icon={TrendingUp} accent="amber" />
        <MetricCard
          label={hasHalfDayLeaveToday ? 'Leave Today' : 'Active Tasks'}
          value={hasHalfDayLeaveToday ? 'Half Day' : activeTasksCount}
          hint={hasHalfDayLeaveToday ? 'Attendance target reduced for today' : `${totalTasksCount} total tasks`}
          icon={FolderKanban}
          accent="emerald"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.25fr_0.95fr]">
        <SurfaceCard className="overflow-hidden">
          <div className="border-b border-slate-200/80 p-5">
            <h2 className="text-lg font-semibold tracking-[-0.04em] text-slate-950">My Work Log</h2>
            <p className="mt-1 text-sm text-slate-500">Your sessions for today with project, task, duration, and start time.</p>
          </div>
          <div className="divide-y divide-slate-200/80">
            {todayEntries.length === 0 ? (
              <div className="p-8 text-center text-slate-500">
                <Clock className="mx-auto mb-3 h-12 w-12 text-slate-300" />
                <p>No work entries yet today</p>
                <p className="text-sm">Your completed work sessions will appear here once they are logged.</p>
              </div>
            ) : (
              todayEntries.map((entry) => (
                <div key={entry.id} className="flex items-center justify-between gap-4 p-4 transition hover:bg-slate-50/80">
                  <div className="flex min-w-0 items-center gap-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-100">
                      <Clock className="h-5 w-5 text-slate-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-950">{getTimeEntryTitle(entry)}</p>
                      <p className="truncate text-sm text-slate-500">{getTimeEntrySubtitle(entry)}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-medium text-slate-950">{formatDuration(entry.duration)}</p>
                    <p className="text-sm text-slate-500">
                      {new Date(entry.start_time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </SurfaceCard>

        <div className="space-y-6">
          <SurfaceCard className="p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold tracking-[-0.04em] text-slate-950">Attendance & Shift</h2>
                <p className="mt-1 text-sm text-slate-500">Your check-in status and shift timing for today.</p>
              </div>
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-100 text-sky-700">
                <ClipboardCheck className="h-5 w-5" />
              </div>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-slate-600">
                  <LogIn className="h-4 w-4 text-emerald-600" />
                  Last check-in
                </div>
                <p className="mt-2 text-lg font-semibold text-slate-950">{formatClockTime(checkInAt)}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-slate-600">
                  <LogOut className="h-4 w-4 text-amber-600" />
                  Last check-out
                </div>
                <p className="mt-2 text-lg font-semibold text-slate-950">{isCheckedIn ? 'Still checked in' : formatClockTime(checkOutAt)}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-medium text-slate-600">Late time</p>
                <p className={`mt-2 text-lg font-semibold ${lateMinutes > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                  {lateMinutes > 0 ? `${lateMinutes}m late` : 'On time'}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-medium text-slate-600">Overtime</p>
                <p className="mt-2 text-lg font-semibold text-slate-950">{formatDuration(overtimeSeconds)}</p>
              </div>
            </div>
          </SurfaceCard>

          <SurfaceCard className="p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold tracking-[-0.04em] text-slate-950">My Focus</h2>
                <p className="mt-1 text-sm text-slate-500">Only the work details you need for your day.</p>
              </div>
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
                <Activity className="h-5 w-5" />
              </div>
            </div>

            <div className="mt-5 space-y-3">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Current work</p>
                <p className="mt-2 truncate text-lg font-semibold text-slate-950">{activeWorkTitle}</p>
                <p className="mt-1 truncate text-sm text-slate-600">{activeWorkSubtitle}</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-sm text-slate-500">Tasks</p>
                  <p className="mt-2 text-2xl font-semibold text-slate-950">{activeTasksCount}</p>
                  <p className="text-xs text-slate-500">{totalTasksCount} total</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-sm text-slate-500">Productivity</p>
                  <p className="mt-2 text-2xl font-semibold text-slate-950">{productivityScore}%</p>
                  <p className="text-xs text-slate-500">weekly ratio</p>
                </div>
              </div>
            </div>
          </SurfaceCard>

          <SurfaceCard className="p-6">
            <h2 className="text-lg font-semibold tracking-[-0.04em] text-slate-950">Quick Actions</h2>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Link to="/time-tracker" className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700">
                <TimerReset className="h-4 w-4" />
                Time Tracker
              </Link>
              <Link to="/tasks" className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700">
                <FolderKanban className="h-4 w-4" />
                My Tasks
              </Link>
              <Link to="/attendance" className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700">
                <ClipboardCheck className="h-4 w-4" />
                Attendance
              </Link>
              <Link to="/projects" className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700">
                <Briefcase className="h-4 w-4" />
                Projects
              </Link>
            </div>
          </SurfaceCard>
        </div>
      </div>
    </div>
  );
}
