import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { attendanceApi, attendanceTimeEditApi, dashboardApi } from '@/services/api';
import PageHeader from '@/components/dashboard/PageHeader';
import MetricCard from '@/components/dashboard/MetricCard';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import Button from '@/components/ui/Button';
import { PageLoadingState } from '@/components/ui/PageState';
import {
  Calendar,
  CheckCircle2,
  Clock,
  FolderKanban,
  Hourglass,
  TrendingUp,
  Users,
} from 'lucide-react';
import { getTimeEntrySubtitle, getTimeEntryTitle } from '@/lib/timeEntryDisplay';
import type { TimeEntry } from '@/types';

export default function Dashboard() {
  const { user } = useAuth();
  const [activeTimer, setActiveTimer] = useState<TimeEntry | null>(null);
  const [todayEntries, setTodayEntries] = useState<TimeEntry[]>([]);
  const [todayTotal, setTodayTotal] = useState(0);
  const [teamMembersCount, setTeamMembersCount] = useState(0);
  const [newMembersThisWeek, setNewMembersThisWeek] = useState(0);
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
        setTeamMembersCount(Number(data?.team_members_count) || 0);
        setNewMembersThisWeek(Number(data?.new_members_this_week) || 0);
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

  if (isLoading) {
    return <PageLoadingState label="Loading dashboard..." />;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        eyebrow="Personal overview"
        title={`Welcome back, ${user?.name?.split(' ')[0]}!`}
        description="Review today's worked hours, shift progress, remaining time, and your recent work summary from one place."
        actions={
          <div className="inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/80 px-4 py-2 text-sm font-medium text-slate-600 shadow-sm">
            <Calendar className="h-4 w-4 text-sky-700" />
            {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </div>
        }
      />

      <SurfaceCard className="overflow-hidden border-0 bg-[linear-gradient(135deg,#082f49_0%,#0f172a_38%,#155e75_100%)] p-6 text-white shadow-[0_38px_100px_-48px_rgba(2,6,23,0.92)]">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-sm font-medium text-cyan-100/80">Today's work progress</p>
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
              <p className="mt-2 text-xl font-semibold">{isCheckedIn ? 'Checked in' : completedShift ? 'Completed' : 'Not checked in'}</p>
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

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.35fr_0.95fr]">
        <SurfaceCard className="overflow-hidden">
          <div className="border-b border-slate-200/80 p-5">
            <h2 className="text-lg font-semibold tracking-[-0.04em] text-slate-950">Today's Work Log</h2>
            <p className="mt-1 text-sm text-slate-500">A summary of the sessions you have already completed today.</p>
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

        <SurfaceCard className="p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold tracking-[-0.04em] text-slate-950">Today at a glance</h2>
              <p className="mt-1 text-sm text-slate-500">Quick checkpoints for your working day.</p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-100 text-sky-700">
              <Users className="h-5 w-5" />
            </div>
          </div>

          <div className="mt-6 space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Attendance status</p>
              <p className="mt-2 text-lg font-semibold text-slate-950">
                {isCheckedIn ? 'You are currently checked in' : completedShift ? 'Shift target reached' : 'Waiting for more logged work'}
              </p>
              <p className="mt-1 text-sm text-slate-600">
                Worked {formatDuration(workedSeconds)} out of {formatDuration(shiftTargetSeconds)} today.
              </p>
              {hasHalfDayLeaveToday ? (
                <p className="mt-2 text-sm font-medium text-amber-700">Half day leave is active for today.</p>
              ) : null}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Remaining focus block</p>
              <p className="mt-2 text-lg font-semibold text-slate-950">{formatTime(remainingShiftSeconds)}</p>
              <p className="mt-1 text-sm text-slate-600">
                {remainingShiftSeconds > 0
                  ? 'This is the time left to complete your standard workday.'
                  : 'Your standard workday target is complete.'}
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Workspace context</p>
              <p className="mt-2 text-lg font-semibold text-slate-950">{teamMembersCount} people in your organization</p>
              <p className="mt-1 text-sm text-slate-600">
                {newMembersThisWeek} joined this week and {activeTasksCount} active tasks are open right now.
              </p>
            </div>
          </div>
        </SurfaceCard>
      </div>
    </div>
  );
}
