import { useEffect, useMemo, useState } from 'react';
import { attendanceApi, attendanceTimeEditApi, leaveApi, userApi } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import { canReviewApprovalRequest } from '@/lib/permissions';
import { useLocation } from 'react-router-dom';
import PageHeader from '@/components/dashboard/PageHeader';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import MetricCard from '@/components/dashboard/MetricCard';
import Button from '@/components/ui/Button';
import { FeedbackBanner, PageEmptyState, PageLoadingState } from '@/components/ui/PageState';
import { BarChart3, Building2, CheckCircle2, Clock3, Inbox, TrendingUp, UserRound, Users, XCircle } from 'lucide-react';

const formatDuration = (seconds: number) => {
  const safe = Number.isFinite(Number(seconds)) ? Number(seconds) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  return `${hours}h ${minutes}m`;
};

const hasActiveAttendance = (row: any) =>
  Boolean(row?.is_checked_in || row?.check_in_at || row?.open_punch_in_at || row?.last_check_in_at);

type InboxItem =
  | {
      kind: 'leave';
      id: number;
      submitted_at: string;
      title: string;
      description: string;
      employee_name: string;
      employee_email: string;
      status: string;
      onApprove: () => Promise<void>;
      onReject: () => Promise<void>;
    }
  | {
      kind: 'time_edit';
      id: number;
      submitted_at: string;
      title: string;
      description: string;
      employee_name: string;
      employee_email: string;
      status: string;
      onApprove: () => Promise<void>;
      onReject: () => Promise<void>;
    };

const DAY_MS = 24 * 60 * 60 * 1000;
const LEAVE_COLORS = ['#2563eb', '#0ea5e9', '#14b8a6', '#f59e0b', '#f97316', '#8b5cf6', '#ef4444'];
type AnalyticsPreset = 'today' | '2d' | '5d' | '7d' | 'custom';
type AnalyticsSource = 'approved' | 'approved_pending';

const startOfDay = (value = new Date()) => new Date(value.getFullYear(), value.getMonth(), value.getDate());
const toDateInputValue = (value: Date) =>
  `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;

const parseDateOnly = (value?: string | null) => {
  const normalized = String(value || '').slice(0, 10);
  if (!normalized) return null;
  const parsed = new Date(`${normalized}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatDateLabel = (value: Date) =>
  value.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });

const inclusiveDayDiff = (startDate: Date, endDate: Date) =>
  Math.floor((startOfDay(endDate).getTime() - startOfDay(startDate).getTime()) / DAY_MS) + 1;

const normalizeDepartment = (item: any) =>
  item?.employee_work_info?.department?.name
  || item?.department
  || item?.groups?.[0]?.name
  || 'Unassigned';

const getLeaveTypeUnits = (leave: any, overlapDays: number) =>
  String(leave?.leave_type || 'full_day') === 'half_day' ? 0.5 : overlapDays;

const buildArcPath = (cx: number, cy: number, radius: number, startAngle: number, endAngle: number) => {
  const startRadians = (Math.PI / 180) * startAngle;
  const endRadians = (Math.PI / 180) * endAngle;
  const startX = cx + radius * Math.cos(startRadians);
  const startY = cy + radius * Math.sin(startRadians);
  const endX = cx + radius * Math.cos(endRadians);
  const endY = cy + radius * Math.sin(endRadians);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${startX} ${startY} A ${radius} ${radius} 0 ${largeArc} 1 ${endX} ${endY} Z`;
};

function LeaveDepartmentPie({
  items,
}: {
  items: Array<{ label: string; value: number; color: string }>;
}) {
  const total = items.reduce((sum, item) => sum + item.value, 0);

  if (total <= 0) {
    return <p className="text-sm text-slate-500">No department leave distribution available in this window.</p>;
  }

  let angle = -90;

  return (
    <div className="grid gap-4 md:grid-cols-[180px_minmax(0,1fr)] md:items-center">
      <div className="flex justify-center">
        <svg viewBox="0 0 220 220" className="h-44 w-44" aria-label="Department leave distribution pie chart">
          {items.map((item) => {
            const sliceAngle = (item.value / total) * 360;
            const path = buildArcPath(110, 110, 88, angle, angle + sliceAngle);
            angle += sliceAngle;
            return <path key={item.label} d={path} fill={item.color} stroke="#fff" strokeWidth="2" />;
          })}
          <circle cx="110" cy="110" r="40" fill="#ffffff" />
          <text x="110" y="106" textAnchor="middle" className="fill-slate-500" fontSize="12">Leave</text>
          <text x="110" y="125" textAnchor="middle" className="fill-slate-900" fontSize="18" fontWeight="700">{total.toFixed(1)}</text>
        </svg>
      </div>
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.label} className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
            <div className="flex items-center gap-2 text-sm text-slate-700">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
              {item.label}
            </div>
            <span className="text-sm font-semibold text-slate-900">{item.value.toFixed(1)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LeaveTrendChart({
  points,
}: {
  points: Array<{ label: string; value: number }>;
}) {
  if (!points.length) {
    return <p className="text-sm text-slate-500">No trend data in this window.</p>;
  }

  const max = Math.max(1, ...points.map((point) => point.value));
  const plotted = points.map((point, index) => {
    const x = 18 + index * (264 / Math.max(1, points.length - 1));
    const y = 138 - (point.value / max) * 108;
    return { x, y, ...point };
  });

  return (
    <svg viewBox="0 0 300 172" className="h-44 w-full">
      {[0, 1, 2, 3].map((line) => {
        const y = 30 + line * 36;
        return <line key={line} x1="18" x2="282" y1={y} y2={y} stroke="#e2e8f0" strokeDasharray="2 3" />;
      })}
      <polyline
        points={plotted.map((point) => `${point.x},${point.y}`).join(' ')}
        fill="none"
        stroke="#2563eb"
        strokeWidth="2.5"
      />
      {plotted.map((point) => (
        <g key={`${point.label}-${point.x}`}>
          <circle cx={point.x} cy={point.y} r="3.5" fill="#2563eb" />
          <title>{`${point.label}: ${point.value} employees`}</title>
        </g>
      ))}
      {plotted.map((point) => (
        <text key={`${point.label}-label`} x={point.x} y="164" textAnchor="middle" fill="#64748b" fontSize="9">
          {point.label}
        </text>
      ))}
    </svg>
  );
}

export default function ApprovalInbox() {
  const { user } = useAuth();
  const location = useLocation();
  const [leaveRequests, setLeaveRequests] = useState<any[]>([]);
  const [approvedLeaves, setApprovedLeaves] = useState<any[]>([]);
  const [todayAttendanceRows, setTodayAttendanceRows] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [timeEditRequests, setTimeEditRequests] = useState<any[]>([]);
  const [activeFilter, setActiveFilter] = useState<'all' | 'leave' | 'time_edit'>('all');
  const [analyticsPreset, setAnalyticsPreset] = useState<AnalyticsPreset>('7d');
  const [analyticsSource, setAnalyticsSource] = useState<AnalyticsSource>('approved_pending');
  const [analyticsDepartment, setAnalyticsDepartment] = useState<string>('All');
  const [isLoading, setIsLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);

  const load = async () => {
    setIsLoading(true);
    try {
      const todayDate = new Date().toISOString().slice(0, 10);
      const [leaveResponse, approvedLeaveResponse, timeEditResponse, employeesResponse, attendanceResponse] = await Promise.all([
        leaveApi.list({ status: 'pending', limit: 500 }),
        leaveApi.list({ status: 'approved', limit: 500 }),
        attendanceTimeEditApi.list({ status: 'pending' }),
        userApi.getAll(),
        attendanceApi.summary({ start_date: todayDate, end_date: todayDate }),
      ]);

      setLeaveRequests(leaveResponse.data?.data || []);
      setApprovedLeaves(approvedLeaveResponse.data?.data || []);
      setTimeEditRequests(timeEditResponse.data?.data || []);
      setEmployees(Array.isArray(employeesResponse.data) ? employeesResponse.data : []);
      setTodayAttendanceRows(Array.isArray(attendanceResponse.data?.data) ? attendanceResponse.data.data : []);
    } catch (error: any) {
      setFeedback({ tone: 'error', message: error?.response?.data?.message || 'Failed to load approval inbox.' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleAction = async (action: () => Promise<void>, successMessage: string) => {
    setFeedback(null);
    try {
      await action();
      setFeedback({ tone: 'success', message: successMessage });
      await load();
    } catch (error: any) {
      setFeedback({ tone: 'error', message: error?.response?.data?.message || 'Approval action failed.' });
    }
  };

  const items = useMemo<InboxItem[]>(() => {
    const reviewableLeaveRequests = leaveRequests.filter((item) => canReviewApprovalRequest(user, item.user));
    const reviewableTimeEditRequests = timeEditRequests.filter((item) => canReviewApprovalRequest(user, item.user));

    const leaveItems = reviewableLeaveRequests.map((item) => ({
      kind: 'leave' as const,
      id: item.id,
      submitted_at: item.created_at,
      title: `Leave request: ${item.start_date} to ${item.end_date}`,
      description: item.reason || 'No reason provided.',
      employee_name: item.user?.name || 'Unknown',
      employee_email: item.user?.email || '',
      status: item.status,
      onApprove: async () => {
        await leaveApi.approve(item.id);
      },
      onReject: async () => {
        await leaveApi.reject(item.id);
      },
    }));

    const timeEditItems = reviewableTimeEditRequests.map((item) => ({
      kind: 'time_edit' as const,
      id: item.id,
      submitted_at: item.created_at,
      title: `Time edit request: ${item.attendance_date}`,
      description: `${formatDuration(Number(item.extra_seconds || 0))} requested${item.message ? ` - ${item.message}` : ''}`,
      employee_name: item.user?.name || 'Unknown',
      employee_email: item.user?.email || '',
      status: item.status,
      onApprove: async () => {
        await attendanceTimeEditApi.approve(item.id);
      },
      onReject: async () => {
        await attendanceTimeEditApi.reject(item.id);
      },
    }));

    return [...leaveItems, ...timeEditItems].sort((a, b) => +new Date(b.submitted_at) - +new Date(a.submitted_at));
  }, [leaveRequests, timeEditRequests, user]);

  const reviewableLeaveCount = useMemo(
    () => leaveRequests.filter((item) => canReviewApprovalRequest(user, item.user)).length,
    [leaveRequests, user]
  );
  const reviewableTimeEditCount = useMemo(
    () => timeEditRequests.filter((item) => canReviewApprovalRequest(user, item.user)).length,
    [timeEditRequests, user]
  );

  const filteredItems = items.filter((item) => activeFilter === 'all' || item.kind === activeFilter);

  const employeeDirectory = useMemo(() => {
    const directory = new Map<number, { id: number; name: string; email: string; department: string }>();

    employees.forEach((employee) => {
      const id = Number(employee?.id || 0);
      if (!id) return;
      directory.set(id, {
        id,
        name: String(employee?.name || 'Unknown employee'),
        email: String(employee?.email || ''),
        department: normalizeDepartment(employee),
      });
    });

    approvedLeaves.forEach((leave) => {
      const id = Number(leave?.user_id || leave?.user?.id || 0);
      if (!id || directory.has(id)) return;
      directory.set(id, {
        id,
        name: String(leave?.user?.name || 'Unknown employee'),
        email: String(leave?.user?.email || ''),
        department: normalizeDepartment(leave?.user),
      });
    });

    return directory;
  }, [approvedLeaves, employees]);

  const departmentOptions = useMemo(() => {
    const values = Array.from(new Set(Array.from(employeeDirectory.values()).map((employee) => employee.department))).sort((a, b) => a.localeCompare(b));
    return ['All', ...values];
  }, [employeeDirectory]);

  const reviewableApprovedLeaves = useMemo(
    () => approvedLeaves.filter((leave) => canReviewApprovalRequest(user, leave?.user)),
    [approvedLeaves, user]
  );

  const today = useMemo(() => startOfDay(new Date()), []);
  const todayIso = useMemo(() => today.toISOString().slice(0, 10), [today]);
  const defaultCustomStart = useMemo(() => {
    const start = new Date(today);
    start.setDate(start.getDate() - 6);
    return toDateInputValue(start);
  }, [today]);
  const [customStartDate, setCustomStartDate] = useState(defaultCustomStart);
  const [customEndDate, setCustomEndDate] = useState(todayIso);

  const reviewablePendingLeaves = useMemo(
    () => leaveRequests.filter((leave) => canReviewApprovalRequest(user, leave?.user)),
    [leaveRequests, user]
  );

  const analyticsLeaves = useMemo(() => {
    if (analyticsSource === 'approved') {
      return reviewableApprovedLeaves;
    }

    const byId = new Map<number, any>();
    [...reviewableApprovedLeaves, ...reviewablePendingLeaves].forEach((leave) => {
      const id = Number(leave?.id || 0);
      if (!id) return;
      if (!byId.has(id)) {
        byId.set(id, leave);
      }
    });
    return Array.from(byId.values());
  }, [analyticsSource, reviewableApprovedLeaves, reviewablePendingLeaves]);

  const scopedAnalyticsLeaves = useMemo(() => {
    if (analyticsDepartment === 'All') {
      return analyticsLeaves;
    }

    return analyticsLeaves.filter((leave) => {
      const userId = Number(leave?.user_id || leave?.user?.id || 0);
      const department = employeeDirectory.get(userId)?.department || normalizeDepartment(leave?.user);
      return department === analyticsDepartment;
    });
  }, [analyticsDepartment, analyticsLeaves, employeeDirectory]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const leaveWindow = String(params.get('leave_window') || '').trim().toLowerCase();
    if (leaveWindow === 'today') {
      setAnalyticsPreset('today');
    }
  }, [location.search]);

  const selectedWindowRange = useMemo(() => {
    if (analyticsPreset === 'today') {
      return {
        start: new Date(today),
        end: new Date(today),
        days: 1,
        label: 'Today',
        startLabel: formatDateLabel(today),
        endLabel: formatDateLabel(today),
      };
    }

    if (analyticsPreset === 'custom') {
      const parsedStart = parseDateOnly(customStartDate);
      const parsedEnd = parseDateOnly(customEndDate);

      if (!parsedStart && !parsedEnd) {
        return {
          start: new Date(today),
          end: new Date(today),
          days: 1,
          label: 'Today',
          startLabel: formatDateLabel(today),
          endLabel: formatDateLabel(today),
        };
      }

      const safeStart = parsedStart || parsedEnd || new Date(today);
      const safeEnd = parsedEnd || parsedStart || new Date(today);
      const start = safeStart <= safeEnd ? safeStart : safeEnd;
      const end = safeStart <= safeEnd ? safeEnd : safeStart;
      return {
        start: startOfDay(start),
        end: startOfDay(end),
        days: Math.max(1, inclusiveDayDiff(start, end)),
        label: 'Custom range',
        startLabel: formatDateLabel(start),
        endLabel: formatDateLabel(end),
      };
    }

    const days = analyticsPreset === '2d' ? 2 : analyticsPreset === '5d' ? 5 : 7;
    const start = new Date(today);
    start.setDate(start.getDate() - (days - 1));
    return {
      start: startOfDay(start),
      end: new Date(today),
      days,
      label: `Last ${days} days`,
      startLabel: formatDateLabel(start),
      endLabel: formatDateLabel(today),
    };
  }, [analyticsPreset, customEndDate, customStartDate, today]);

  const todayOnLeaveEmployees = useMemo(() => {
    const employeesOnLeave = new Map<number, { id: number; name: string; email: string; department: string; leaveType: string }>();

    scopedAnalyticsLeaves.forEach((leave) => {
      const start = parseDateOnly(leave?.start_date);
      const end = parseDateOnly(leave?.end_date);
      if (!start || !end || start > today || end < today) return;

      const userId = Number(leave?.user_id || leave?.user?.id || 0);
      if (!userId) return;

      const employee = employeeDirectory.get(userId) || {
        id: userId,
        name: String(leave?.user?.name || 'Unknown employee'),
        email: String(leave?.user?.email || ''),
        department: 'Unassigned',
      };

      employeesOnLeave.set(userId, {
        ...employee,
        leaveType: String(leave?.leave_type || 'full_day'),
      });
    });

    return Array.from(employeesOnLeave.values())
      .sort((left, right) => left.department.localeCompare(right.department) || left.name.localeCompare(right.name));
  }, [employeeDirectory, scopedAnalyticsLeaves, today]);

  const todayDepartmentRows = useMemo(() => {
    const counts = new Map<string, number>();
    todayOnLeaveEmployees.forEach((employee) => {
      counts.set(employee.department, (counts.get(employee.department) || 0) + 1);
    });

    return Array.from(counts.entries())
      .map(([department, count]) => ({ department, count }))
      .sort((left, right) => right.count - left.count || left.department.localeCompare(right.department));
  }, [todayOnLeaveEmployees]);

  const scopedEmployeeIds = useMemo(
    () => Array.from(employeeDirectory.values())
      .filter((employee) => analyticsDepartment === 'All' || employee.department === analyticsDepartment)
      .map((employee) => employee.id),
    [analyticsDepartment, employeeDirectory]
  );

  const scopedEmployeeIdSet = useMemo(() => new Set(scopedEmployeeIds), [scopedEmployeeIds]);

  const scopedTodayAttendanceRows = useMemo(
    () => todayAttendanceRows.filter((row) => {
      const userId = Number(row?.user?.id || row?.user_id || row?.employee_id || 0);
      return userId > 0 && scopedEmployeeIdSet.has(userId);
    }),
    [scopedEmployeeIdSet, todayAttendanceRows]
  );

  const presentTodayCount = useMemo(
    () => scopedTodayAttendanceRows.filter((row) => {
      const isLate = Number(row?.late_days || row?.late_minutes || 0) > 0;
      return !isLate && (Number(row?.present_days || 0) > 0 || hasActiveAttendance(row));
    }).length,
    [scopedTodayAttendanceRows]
  );

  const lateTodayCount = useMemo(
    () => scopedTodayAttendanceRows.filter((row) => Number(row?.late_days || row?.late_minutes || 0) > 0).length,
    [scopedTodayAttendanceRows]
  );

  const absentTodayCount = useMemo(
    () => Math.max(0, scopedEmployeeIds.length - presentTodayCount - lateTodayCount - todayOnLeaveEmployees.length),
    [lateTodayCount, presentTodayCount, scopedEmployeeIds.length, todayOnLeaveEmployees.length]
  );

  const windowLeaveStats = useMemo(() => {
    const employeeUnits = new Map<number, number>();
    const departmentUnits = new Map<string, number>();
    let totalUnits = 0;
    let overlappingRequests = 0;

    analyticsLeaves.forEach((leave) => {
      const start = parseDateOnly(leave?.start_date);
      const end = parseDateOnly(leave?.end_date);
      if (!start || !end) return;

      const overlapStart = start > selectedWindowRange.start ? start : selectedWindowRange.start;
      const overlapEnd = end < selectedWindowRange.end ? end : selectedWindowRange.end;
      if (overlapStart > overlapEnd) return;

      const overlapDays = Math.max(1, inclusiveDayDiff(overlapStart, overlapEnd));
      const units = getLeaveTypeUnits(leave, overlapDays);
      const userId = Number(leave?.user_id || leave?.user?.id || 0);
      const department = employeeDirectory.get(userId)?.department || normalizeDepartment(leave?.user);

      totalUnits += units;
      overlappingRequests += 1;
      departmentUnits.set(department, (departmentUnits.get(department) || 0) + units);
      if (userId) {
        employeeUnits.set(userId, (employeeUnits.get(userId) || 0) + units);
      }
    });

    const topDepartments = Array.from(departmentUnits.entries())
      .map(([department, units], index) => ({
        department,
        units,
        color: LEAVE_COLORS[index % LEAVE_COLORS.length],
      }))
      .sort((left, right) => right.units - left.units)
      .slice(0, 6);

    const topEmployees = Array.from(employeeUnits.entries())
      .map(([id, units]) => ({
        id,
        units,
        name: employeeDirectory.get(id)?.name || 'Unknown employee',
        department: employeeDirectory.get(id)?.department || 'Unassigned',
      }))
      .sort((left, right) => right.units - left.units)
      .slice(0, 8);

    return {
      totalUnits,
      overlappingRequests,
      uniqueEmployees: employeeUnits.size,
      topDepartments,
      topEmployees,
    };
  }, [employeeDirectory, scopedAnalyticsLeaves, selectedWindowRange.end, selectedWindowRange.start]);

  const leaveTrendPoints = useMemo(() => {
    const points: Array<{ label: string; value: number }> = [];

    for (let offset = 0; offset < selectedWindowRange.days; offset += 1) {
      const day = new Date(selectedWindowRange.start);
      day.setDate(selectedWindowRange.start.getDate() + offset);
      const activeEmployeeIds = new Set<number>();

      scopedAnalyticsLeaves.forEach((leave) => {
        const start = parseDateOnly(leave?.start_date);
        const end = parseDateOnly(leave?.end_date);
        if (!start || !end || start > day || end < day) return;
        const userId = Number(leave?.user_id || leave?.user?.id || 0);
        if (userId) activeEmployeeIds.add(userId);
      });

      points.push({
        label: formatDateLabel(day),
        value: activeEmployeeIds.size,
      });
    }

    return points;
  }, [scopedAnalyticsLeaves, selectedWindowRange.days, selectedWindowRange.start]);

  const topDepartment = windowLeaveStats.topDepartments[0];
  const topEmployee = windowLeaveStats.topEmployees[0];
  const windowCoverageRate = windowLeaveStats.uniqueEmployees > 0
    ? Math.min(100, (windowLeaveStats.totalUnits / windowLeaveStats.uniqueEmployees) * 100)
    : 0;
  const leavePressureNotes = [
    {
      label: 'Coverage pressure',
      value: `${windowCoverageRate.toFixed(1)}%`,
      description: 'Leave units relative to unique employees in the current window.',
    },
    {
      label: 'Busiest department',
      value: topDepartment ? topDepartment.department : 'No hotspot',
      description: topDepartment ? `${topDepartment.units.toFixed(1)} leave units tracked.` : 'No department pressure in the selected scope.',
    },
    {
      label: 'Highest leave load',
      value: topEmployee ? topEmployee.name : 'No employee hotspot',
      description: topEmployee ? `${topEmployee.units.toFixed(1)} leave units in this window.` : 'No employee leave concentration right now.',
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operations workflow"
        title="Approval Inbox"
        description="Review pending approvals and use leave intelligence to spot staffing pressure early."
        actions={<Button onClick={load} variant="secondary">Refresh Inbox</Button>}
      />

      {feedback ? <FeedbackBanner tone={feedback.tone} message={feedback.message} /> : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <MetricCard label="Pending Total" value={items.length} icon={Inbox} accent="sky" />
        <MetricCard label="Leave Requests" value={reviewableLeaveCount} icon={Clock3} accent="amber" />
        <MetricCard label="Time Edits" value={reviewableTimeEditCount} icon={CheckCircle2} accent="emerald" />
      </div>

      <SurfaceCard className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Leave Intelligence</h2>
            <p className="text-sm text-slate-500">Simple leave planning with the same filters, analytics, and approval workflow.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              { id: 'today', label: 'Today' },
              { id: '2d', label: 'Last 2 days' },
              { id: '5d', label: 'Last 5 days' },
              { id: '7d', label: 'Last 7 days' },
              { id: 'custom', label: 'Custom' },
            ].map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => setAnalyticsPreset(preset.id as AnalyticsPreset)}
                className={`h-9 rounded-lg border px-3 text-xs font-medium transition ${
                  analyticsPreset === preset.id
                    ? 'border-blue-600 bg-blue-600 text-white shadow-sm'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:items-end">
          <div className="grid gap-3 sm:grid-cols-2">
            {analyticsPreset === 'custom' ? (
              <>
                <label className="text-xs font-medium text-slate-600">
                  Start date
                  <input
                    type="date"
                    value={customStartDate}
                    onChange={(event) => {
                      setAnalyticsPreset('custom');
                      setCustomStartDate(event.target.value);
                    }}
                    className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-blue-400"
                  />
                </label>
                <label className="text-xs font-medium text-slate-600">
                  End date
                  <input
                    type="date"
                    value={customEndDate}
                    onChange={(event) => {
                      setAnalyticsPreset('custom');
                      setCustomEndDate(event.target.value);
                    }}
                    className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-blue-400"
                  />
                </label>
              </>
            ) : (
              <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 sm:col-span-2">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Window</p>
                <p className="mt-2 text-sm font-semibold text-slate-900">{selectedWindowRange.label}</p>
                <p className="mt-1 text-xs text-slate-500">{selectedWindowRange.startLabel} to {selectedWindowRange.endLabel}</p>
              </div>
            )}
          </div>

          <label className="text-xs font-medium text-slate-600">
            Department
            <select
              value={analyticsDepartment}
              onChange={(event) => setAnalyticsDepartment(event.target.value)}
              className="mt-1 h-10 min-w-[220px] rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-blue-400"
            >
              {departmentOptions.map((department) => (
                <option key={department} value={department}>{department}</option>
              ))}
            </select>
          </label>

          <div>
            <p className="text-xs font-medium text-slate-600">Source</p>
            <div className="mt-1 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setAnalyticsSource('approved_pending')}
                className={`h-10 rounded-lg border px-3 text-xs font-medium transition ${
                  analyticsSource === 'approved_pending'
                    ? 'border-blue-600 bg-blue-600 text-white shadow-sm'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700'
                }`}
              >
                Approved + Pending
              </button>
              <button
                type="button"
                onClick={() => setAnalyticsSource('approved')}
                className={`h-10 rounded-lg border px-3 text-xs font-medium transition ${
                  analyticsSource === 'approved'
                    ? 'border-blue-600 bg-blue-600 text-white shadow-sm'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700'
                }`}
              >
                Approved only
              </button>
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Employees On Leave Today" value={todayOnLeaveEmployees.length} icon={Users} accent="amber" />
          <MetricCard label="Absent Today" value={absentTodayCount} icon={XCircle} accent="rose" />
          <MetricCard label={`Leave Units (${selectedWindowRange.days}d)`} value={windowLeaveStats.totalUnits.toFixed(1)} icon={BarChart3} accent="sky" />
          <MetricCard
            label="Highest Leave Load"
            value={topEmployee ? topEmployee.name : 'N/A'}
            icon={UserRound}
            accent="emerald"
          />
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">Daily Leave Trend</h3>
              <span className="text-xs text-slate-500">{selectedWindowRange.days}-day employee count</span>
            </div>
            <LeaveTrendChart points={leaveTrendPoints} />
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">Quick Summary</h3>
              <span className="text-xs text-slate-500">Current filter scope</span>
            </div>
            <div className="space-y-3">
              {leavePressureNotes.map((note) => (
                <div key={note.label} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{note.label}</p>
                  <p className="mt-1 text-sm font-semibold text-slate-950">{note.value}</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">{note.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">Departments on Leave Today ({todayIso})</h3>
              <span className="text-xs text-slate-500">Employees currently on leave</span>
            </div>
            {todayDepartmentRows.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-2 py-2">Department</th>
                      <th className="px-2 py-2 text-right">Employees</th>
                    </tr>
                  </thead>
                  <tbody>
                    {todayDepartmentRows.map((row) => (
                      <tr key={row.department} className="border-b border-slate-50">
                        <td className="px-2 py-2.5 text-slate-700">{row.department}</td>
                        <td className="px-2 py-2.5 text-right font-semibold text-slate-900">{row.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-slate-500">No employees are on leave today.</p>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">Top Employees on Leave ({selectedWindowRange.days}d)</h3>
              <span className="text-xs text-slate-500">By leave units in selected window</span>
            </div>
            {windowLeaveStats.topEmployees.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-2 py-2">Employee</th>
                      <th className="px-2 py-2">Department</th>
                      <th className="px-2 py-2 text-right">Units</th>
                    </tr>
                  </thead>
                  <tbody>
                    {windowLeaveStats.topEmployees.map((employee) => (
                      <tr key={employee.id} className="border-b border-slate-50">
                        <td className="px-2 py-2.5 font-medium text-slate-900">{employee.name}</td>
                        <td className="px-2 py-2.5 text-slate-600">{employee.department}</td>
                        <td className="px-2 py-2.5 text-right font-semibold text-slate-900">{employee.units.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-slate-500">No leave records found for the selected source and date range.</p>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1">
            <TrendingUp className="h-3.5 w-3.5 text-sky-600" />
            Leave requests analyzed: <strong>{windowLeaveStats.overlappingRequests}</strong>
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1">
            <Users className="h-3.5 w-3.5 text-amber-600" />
            Unique employees in window: <strong>{windowLeaveStats.uniqueEmployees}</strong>
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1">
            <Clock3 className="h-3.5 w-3.5 text-indigo-600" />
            Source: <strong>{analyticsSource === 'approved' ? 'Approved only' : 'Approved + Pending'}</strong>
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1">
            <Building2 className="h-3.5 w-3.5 text-emerald-600" />
            Department: <strong>{analyticsDepartment}</strong>
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1">
            <UserRound className="h-3.5 w-3.5 text-rose-500" />
            Busiest department: <strong>{topDepartment ? topDepartment.department : 'No hotspot'}</strong>
          </span>
        </div>
      </SurfaceCard>

      <SurfaceCard className="p-4">
        <div className="flex flex-wrap gap-2">
          {[
            { id: 'all', label: 'All requests' },
            { id: 'leave', label: 'Leave only' },
            { id: 'time_edit', label: 'Time edits only' },
          ].map((filter) => (
            <button
              key={filter.id}
              onClick={() => setActiveFilter(filter.id as 'all' | 'leave' | 'time_edit')}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium ${
                activeFilter === filter.id ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-600'
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </SurfaceCard>

      {isLoading ? (
        <PageLoadingState label="Loading approval inbox..." />
      ) : filteredItems.length === 0 ? (
        <PageEmptyState
          title="Inbox is clear"
          description="No pending approvals match the current filter."
        />
      ) : (
        <div className="space-y-3">
          {filteredItems.map((item) => (
            <SurfaceCard key={`${item.kind}-${item.id}`} className="p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                      item.kind === 'leave' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
                    }`}>
                      {item.kind === 'leave' ? 'Leave' : 'Time Edit'}
                    </span>
                    <span className="text-xs text-slate-500">
                      Submitted {new Date(item.submitted_at).toLocaleString()}
                    </span>
                  </div>
                  <h2 className="text-lg font-semibold text-slate-950">{item.title}</h2>
                  <p className="text-sm text-slate-600">{item.employee_name} - {item.employee_email}</p>
                  <p className="text-sm text-slate-600">{item.description}</p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    className="bg-emerald-600 shadow-sm hover:bg-emerald-700"
                    onClick={() => handleAction(item.onApprove, `${item.employee_name}'s request approved.`)}
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => handleAction(item.onReject, `${item.employee_name}'s request rejected.`)}
                  >
                    <XCircle className="h-4 w-4" />
                    Reject
                  </Button>
                </div>
              </div>
            </SurfaceCard>
          ))}
        </div>
      )}
    </div>
  );
}
