import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { attendanceApi, attendanceTimeEditApi, leaveApi, userApi, resignationApi } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/components/dashboard/PageHeader';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import MetricCard from '@/components/dashboard/MetricCard';
import Button from '@/components/ui/Button';
import { FeedbackBanner, PageEmptyState, PageLoadingState } from '@/components/ui/PageState';
import { formatDuration } from '@/lib/formatters';
import { BarChart3, Building2, CheckCircle2, Clock3, History, Inbox, TrendingUp, UserMinus, UserRound, Users, XCircle } from 'lucide-react';

const DAY_MS = 24 * 60 * 60 * 1000;
const LEAVE_COLORS = ['#2563eb', '#0ea5e9', '#14b8a6', '#f59e0b', '#f97316', '#8b5cf6', '#ef4444'];

type ApprovalSection = 'leave' | 'time-edit' | 'resignation';
type ApprovalView = 'pending' | 'history';
type AnalyticsPreset = 'today' | '2d' | '5d' | '7d' | 'custom';
type AnalyticsSource = 'approved' | 'approved_pending';

type ApprovalCardItem = {
  id: number;
  kind: ApprovalSection;
  submittedAt: string;
  title: string;
  description: string;
  employeeName: string;
  employeeEmail: string;
  status: string;
  reviewerName?: string;
  reviewedAt?: string | null;
  onApprove?: () => Promise<void>;
  onReject?: () => Promise<void>;
};

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

const hasActiveAttendance = (row: any) =>
  Boolean(row?.is_checked_in || row?.check_in_at || row?.open_punch_in_at || row?.last_check_in_at);

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

function LeaveTrendChart({ points }: { points: Array<{ label: string; value: number }> }) {
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

const statusTone = (status: string) => {
  switch (String(status || '').toLowerCase()) {
    case 'approved':
      return 'bg-emerald-100 text-emerald-700';
    case 'rejected':
      return 'bg-rose-100 text-rose-700';
    case 'auto_cancelled':
      return 'bg-slate-200 text-slate-700';
    default:
      return 'bg-amber-100 text-amber-700';
  }
};

export default function ApprovalInbox() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const [pendingLeaveRequests, setPendingLeaveRequests] = useState<any[]>([]);
  const [leaveHistory, setLeaveHistory] = useState<any[]>([]);
  const [todayAttendanceRows, setTodayAttendanceRows] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [pendingTimeEditRequests, setPendingTimeEditRequests] = useState<any[]>([]);
  const [timeEditHistory, setTimeEditHistory] = useState<any[]>([]);
  const [pendingResignations, setPendingResignations] = useState<any[]>([]);
  const [resignationHistory, setResignationHistory] = useState<any[]>([]);
  const [analyticsPreset, setAnalyticsPreset] = useState<AnalyticsPreset>('7d');
  const [analyticsSource, setAnalyticsSource] = useState<AnalyticsSource>('approved_pending');
  const [analyticsDepartment, setAnalyticsDepartment] = useState<string>('All');
  const [isLoading, setIsLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const historyDetailsRef = useRef<HTMLDivElement>(null);

  const today = useMemo(() => startOfDay(new Date()), []);
  const todayIso = useMemo(() => today.toISOString().slice(0, 10), [today]);
  const defaultCustomStart = useMemo(() => {
    const start = new Date(today);
    start.setDate(start.getDate() - 6);
    return toDateInputValue(start);
  }, [today]);
  const [customStartDate, setCustomStartDate] = useState(defaultCustomStart);
  const [customEndDate, setCustomEndDate] = useState(todayIso);

  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const activeSection = useMemo<ApprovalSection>(() => {
    const section = String(params.get('section') || '').trim().toLowerCase();
    if (section === 'time-edit' || section === 'time_edit') return 'time-edit';
    if (section === 'resignation') return 'resignation';
    return 'leave';
  }, [params]);
  const activeView = useMemo<ApprovalView>(() => {
    const view = String(params.get('view') || '').trim().toLowerCase();
    return view === 'history' ? 'history' : 'pending';
  }, [params]);

  const setRouteState = (next: Partial<{ section: ApprovalSection; view: ApprovalView; leaveWindow: string | null }>) => {
    const nextParams = new URLSearchParams(location.search);
    if (next.section) nextParams.set('section', next.section);
    if (next.view) nextParams.set('view', next.view);
    if (next.leaveWindow === null) {
      nextParams.delete('leave_window');
    } else if (typeof next.leaveWindow === 'string') {
      nextParams.set('leave_window', next.leaveWindow);
    }
    navigate(`/approval-inbox?${nextParams.toString()}`, { replace: true });
  };

  const isSuccessfulResponse = (response: any) => Number(response?.status || 0) >= 200 && Number(response?.status || 0) < 300;

  const toApprovalItems = (response: any) => {
    if (!isSuccessfulResponse(response)) {
      return [];
    }

    const payload = response?.data?.data;
    return Array.isArray(payload) ? payload : [];
  };

  const ensureSuccessfulAction = (response: any, fallbackMessage: string) => {
    if (!isSuccessfulResponse(response)) {
      const message = String(response?.data?.message || fallbackMessage);
      const error: any = new Error(message);
      error.response = { data: { message } };
      throw error;
    }
  };

  const load = async () => {
    setIsLoading(true);
    setFeedback(null);
    try {
      const [pendingLeaveResult, approvedLeaveResult, rejectedLeaveResult, autoCancelledLeaveResult, pendingTimeEditResult, approvedTimeEditResult, rejectedTimeEditResult, employeesResult, attendanceResult, pendingResignationResult, approvedResignationResult, rejectedResignationResult] = await Promise.allSettled([
        leaveApi.list({ status: 'pending', limit: 500 }),
        leaveApi.list({ status: 'approved', limit: 500 }),
        leaveApi.list({ status: 'rejected', limit: 500 }),
        leaveApi.list({ status: 'auto_cancelled', limit: 500 }),
        attendanceTimeEditApi.list({ status: 'pending' }),
        attendanceTimeEditApi.list({ status: 'approved' }),
        attendanceTimeEditApi.list({ status: 'rejected' }),
        userApi.getAll({ period: 'all' }),
        attendanceApi.summary({ start_date: todayIso, end_date: todayIso }),
        resignationApi.list({ status: 'pending' }),
        resignationApi.list({ status: 'approved' }),
        resignationApi.list({ status: 'rejected' }),
      ]);

      const pendingLeaveResponse = pendingLeaveResult.status === 'fulfilled' ? pendingLeaveResult.value : null;
      const approvedLeaveResponse = approvedLeaveResult.status === 'fulfilled' ? approvedLeaveResult.value : null;
      const rejectedLeaveResponse = rejectedLeaveResult.status === 'fulfilled' ? rejectedLeaveResult.value : null;
      const autoCancelledLeaveResponse = autoCancelledLeaveResult.status === 'fulfilled' ? autoCancelledLeaveResult.value : null;
      const pendingTimeEditResponse = pendingTimeEditResult.status === 'fulfilled' ? pendingTimeEditResult.value : null;
      const approvedTimeEditResponse = approvedTimeEditResult.status === 'fulfilled' ? approvedTimeEditResult.value : null;
      const rejectedTimeEditResponse = rejectedTimeEditResult.status === 'fulfilled' ? rejectedTimeEditResult.value : null;
      const employeesResponse = employeesResult.status === 'fulfilled' ? employeesResult.value : null;
      const attendanceResponse = attendanceResult.status === 'fulfilled' ? attendanceResult.value : null;
      const pendingResignationResponse = pendingResignationResult.status === 'fulfilled' ? pendingResignationResult.value : null;
      const approvedResignationResponse = approvedResignationResult.status === 'fulfilled' ? approvedResignationResult.value : null;
      const rejectedResignationResponse = rejectedResignationResult.status === 'fulfilled' ? rejectedResignationResult.value : null;

      setPendingLeaveRequests(toApprovalItems(pendingLeaveResponse));
      setLeaveHistory(
        [...toApprovalItems(approvedLeaveResponse), ...toApprovalItems(rejectedLeaveResponse), ...toApprovalItems(autoCancelledLeaveResponse)]
          .sort((left, right) => +new Date(right.reviewed_at || right.created_at) - +new Date(left.reviewed_at || left.created_at))
      );
      setPendingTimeEditRequests(toApprovalItems(pendingTimeEditResponse));
      setTimeEditHistory(
        [...toApprovalItems(approvedTimeEditResponse), ...toApprovalItems(rejectedTimeEditResponse)]
          .sort((left, right) => +new Date(right.reviewed_at || right.created_at) - +new Date(left.reviewed_at || left.created_at))
      );
      setPendingResignations(toApprovalItems(pendingResignationResponse));
      setResignationHistory(
        [...toApprovalItems(approvedResignationResponse), ...toApprovalItems(rejectedResignationResponse)]
          .sort((left, right) => +new Date(right.reviewed_at || right.created_at) - +new Date(left.reviewed_at || left.created_at))
      );
      setEmployees(Array.isArray(employeesResponse?.data) ? employeesResponse.data : []);
      setTodayAttendanceRows(Array.isArray(attendanceResponse?.data?.data) ? attendanceResponse.data.data : []);

      const endpointResults: Array<{ name: string; result: PromiseSettledResult<any> }> = [
        { name: 'leave pending', result: pendingLeaveResult },
        { name: 'leave approved', result: approvedLeaveResult },
        { name: 'leave rejected', result: rejectedLeaveResult },
        { name: 'leave auto-cancelled', result: autoCancelledLeaveResult },
        { name: 'time-edit pending', result: pendingTimeEditResult },
        { name: 'time-edit approved', result: approvedTimeEditResult },
        { name: 'time-edit rejected', result: rejectedTimeEditResult },
        { name: 'resignation pending', result: pendingResignationResult },
        { name: 'resignation approved', result: approvedResignationResult },
        { name: 'resignation rejected', result: rejectedResignationResult },
        { name: 'employees', result: employeesResult },
        { name: 'attendance summary', result: attendanceResult },
      ];

      const failedEndpoints = endpointResults.flatMap(({ name, result }) => {
        if (result.status === 'rejected') {
          return [name];
        }
        return isSuccessfulResponse(result.value)
          ? []
          : [`${name} (${result.value?.status || 'error'})`];
      });

      if (failedEndpoints.length > 0) {
        setFeedback({ tone: 'error', message: `Some approval inbox data failed: ${failedEndpoints.join(', ')}.` });
      }
    } catch {
      setFeedback({ tone: 'error', message: 'Failed to load approval inbox.' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    const leaveWindow = String(params.get('leave_window') || '').trim().toLowerCase();
    if (leaveWindow === 'today') {
      setAnalyticsPreset('today');
    }
  }, [params]);

  const scrollToHistoryDetails = () => {
    const target = historyDetailsRef.current;
    if (!target) {
      return;
    }

    const scrollWithFallback = () => {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });

      const targetTop = target.getBoundingClientRect().top;
      if (targetTop < 0 || targetTop > window.innerHeight * 0.75) {
        const absoluteTop = window.scrollY + targetTop - 88;
        window.scrollTo({ top: Math.max(0, absoluteTop), behavior: 'smooth' });
      }
    };

    requestAnimationFrame(() => {
      requestAnimationFrame(scrollWithFallback);
    });

    window.setTimeout(scrollWithFallback, 220);
  };

  useEffect(() => {
    if (activeView === 'history') {
      scrollToHistoryDetails();
    }
  }, [activeView]);

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

  const reviewablePendingLeaves = useMemo(
    () => pendingLeaveRequests,
    [pendingLeaveRequests]
  );
  const reviewableLeaveHistory = useMemo(
    () => leaveHistory,
    [leaveHistory]
  );
  const reviewablePendingTimeEdits = useMemo(
    () => pendingTimeEditRequests,
    [pendingTimeEditRequests]
  );
  const reviewableTimeEditHistory = useMemo(
    () => timeEditHistory,
    [timeEditHistory]
  );

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

    [...reviewablePendingLeaves, ...reviewableLeaveHistory].forEach((leave) => {
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
  }, [employees, reviewableLeaveHistory, reviewablePendingLeaves]);

  const departmentOptions = useMemo(() => {
    const values = Array.from(new Set(Array.from(employeeDirectory.values()).map((employee) => employee.department))).sort((a, b) => a.localeCompare(b));
    return ['All', ...values];
  }, [employeeDirectory]);

  const analyticsLeaves = useMemo(() => {
    if (analyticsSource === 'approved') {
      return reviewableLeaveHistory.filter((leave) => String(leave.status || '').toLowerCase() === 'approved');
    }

    const byId = new Map<number, any>();
    [...reviewableLeaveHistory.filter((leave) => String(leave.status || '').toLowerCase() === 'approved'), ...reviewablePendingLeaves].forEach((leave) => {
      const id = Number(leave?.id || 0);
      if (id && !byId.has(id)) {
        byId.set(id, leave);
      }
    });
    return Array.from(byId.values());
  }, [analyticsSource, reviewableLeaveHistory, reviewablePendingLeaves]);

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
      .map(([department, count], index) => ({
        department,
        count,
        color: LEAVE_COLORS[index % LEAVE_COLORS.length],
      }))
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

    scopedAnalyticsLeaves.forEach((leave) => {
      const start = parseDateOnly(leave?.start_date);
      const end = parseDateOnly(leave?.end_date);
      if (!start || !end || end < selectedWindowRange.start || start > selectedWindowRange.end) return;

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

    return {
      totalUnits,
      overlappingRequests,
      uniqueEmployees: employeeUnits.size,
      topDepartments: Array.from(departmentUnits.entries())
        .map(([department, units], index) => ({
          department,
          units,
          color: LEAVE_COLORS[index % LEAVE_COLORS.length],
        }))
        .sort((left, right) => right.units - left.units)
        .slice(0, 6),
      topEmployees: Array.from(employeeUnits.entries())
        .map(([id, units]) => ({
          id,
          units,
          name: employeeDirectory.get(id)?.name || 'Unknown employee',
          department: employeeDirectory.get(id)?.department || 'Unassigned',
        }))
        .sort((left, right) => right.units - left.units)
        .slice(0, 8),
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

      points.push({ label: formatDateLabel(day), value: activeEmployeeIds.size });
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

  const pendingLeaveCards = useMemo<ApprovalCardItem[]>(() => reviewablePendingLeaves.map((item) => ({
    id: item.id,
    kind: 'leave',
    submittedAt: item.created_at,
    title: `Leave request: ${String(item.start_date || '').slice(0, 10)} to ${String(item.end_date || '').slice(0, 10)}`,
    description: item.reason || 'No reason provided.',
    employeeName: item.user?.name || 'Unknown',
    employeeEmail: item.user?.email || '',
    status: item.status,
    onApprove: async () => {
      const response = await leaveApi.approve(item.id);
      ensureSuccessfulAction(response, 'Leave approval failed.');
    },
    onReject: async () => {
      const response = await leaveApi.reject(item.id);
      ensureSuccessfulAction(response, 'Leave rejection failed.');
    },
  })), [reviewablePendingLeaves]);

  const leaveHistoryCards = useMemo<ApprovalCardItem[]>(() => reviewableLeaveHistory.map((item) => ({
    id: item.id,
    kind: 'leave',
    submittedAt: item.created_at,
    title: `Leave request: ${String(item.start_date || '').slice(0, 10)} to ${String(item.end_date || '').slice(0, 10)}`,
    description: item.reason || 'No reason provided.',
    employeeName: item.user?.name || 'Unknown',
    employeeEmail: item.user?.email || '',
    status: item.status,
    reviewerName: item.reviewer?.name || undefined,
    reviewedAt: item.reviewed_at,
  })), [reviewableLeaveHistory]);

  const pendingTimeEditCards = useMemo<ApprovalCardItem[]>(() => reviewablePendingTimeEdits.map((item) => ({
    id: item.id,
    kind: 'time-edit',
    submittedAt: item.created_at,
    title: `Time edit request: ${item.attendance_date}`,
    description: `${formatDuration(Number(item.extra_seconds || 0))} requested${item.message ? ` | ${item.message}` : ''}`,
    employeeName: item.user?.name || 'Unknown',
    employeeEmail: item.user?.email || '',
    status: item.status,
    onApprove: async () => {
      const response = await attendanceTimeEditApi.approve(item.id);
      ensureSuccessfulAction(response, 'Time edit approval failed.');
    },
    onReject: async () => {
      const response = await attendanceTimeEditApi.reject(item.id);
      ensureSuccessfulAction(response, 'Time edit rejection failed.');
    },
  })), [reviewablePendingTimeEdits]);

  const timeEditHistoryCards = useMemo<ApprovalCardItem[]>(() => reviewableTimeEditHistory.map((item) => ({
    id: item.id,
    kind: 'time-edit',
    submittedAt: item.created_at,
    title: `Time edit request: ${item.attendance_date}`,
    description: `${formatDuration(Number(item.extra_seconds || 0))} requested${item.message ? ` | ${item.message}` : ''}`,
    employeeName: item.user?.name || 'Unknown',
    employeeEmail: item.user?.email || '',
    status: item.status,
    reviewerName: item.reviewer?.name || undefined,
    reviewedAt: item.reviewed_at,
  })), [reviewableTimeEditHistory]);

  // Resignation cards
  const pendingResignationCards = useMemo<ApprovalCardItem[]>(() => pendingResignations.map((item: any) => ({
    id: item.id,
    kind: 'resignation',
    submittedAt: item.created_at || item.submitted_at,
    title: `Resignation Request`,
    description: `Last working date: ${item.last_working_date}${item.reason ? ` | Reason: ${item.reason}` : ''}`,
    employeeName: item.user?.name || 'Unknown',
    employeeEmail: item.user?.email || '',
    status: item.status,
    onApprove: async () => {
      const response = await resignationApi.approve(item.id);
      ensureSuccessfulAction(response, 'Resignation approval failed.');
    },
    onReject: async () => {
      const response = await resignationApi.reject(item.id, { reason: 'Rejected by manager' });
      ensureSuccessfulAction(response, 'Resignation rejection failed.');
    },
  })), [pendingResignations]);

  const resignationHistoryCards = useMemo<ApprovalCardItem[]>(() => resignationHistory.map((item: any) => ({
    id: item.id,
    kind: 'resignation',
    submittedAt: item.created_at || item.submitted_at,
    title: `Resignation Request`,
    description: `Last working date: ${item.last_working_date}${item.reason ? ` | Reason: ${item.reason}` : ''}`,
    employeeName: item.user?.name || 'Unknown',
    employeeEmail: item.user?.email || '',
    status: item.status,
    reviewerName: item.approver?.name || undefined,
    reviewedAt: item.approved_at || item.rejected_at,
  })), [resignationHistory]);

  const currentCards = activeSection === 'leave'
    ? (activeView === 'pending' ? pendingLeaveCards : leaveHistoryCards)
    : activeSection === 'resignation'
    ? (activeView === 'pending' ? pendingResignationCards : resignationHistoryCards)
    : (activeView === 'pending' ? pendingTimeEditCards : timeEditHistoryCards);

  const sectionTitle = activeSection === 'leave' 
    ? 'Leave Approval' 
    : activeSection === 'resignation'
    ? 'Resignation Approval'
    : 'Edit Time Approval';
  const sectionDescription = activeSection === 'leave'
    ? (activeView === 'pending' ? 'Review pending leave requests for your organization.' : 'Track approved, rejected, and auto-cancelled leave decisions.')
    : activeSection === 'resignation'
    ? (activeView === 'pending' ? 'Review pending resignation requests from employees.' : 'Track approved and rejected resignation decisions.')
    : (activeView === 'pending' ? 'Review pending time edit and overtime correction requests.' : 'Track approved and rejected time edit decisions.');

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operations workflow"
        title="Approval Inbox"
        description="Review leave approvals, time edit approvals, and recent approval history from one place."
        actions={<Button onClick={() => void load()} variant="secondary">Refresh Inbox</Button>}
      />

      {feedback ? <FeedbackBanner tone={feedback.tone} message={feedback.message} /> : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <MetricCard label="Pending Total" value={pendingLeaveCards.length + pendingTimeEditCards.length + pendingResignations.length} icon={Inbox} accent="sky" />
        <MetricCard label="Leave Requests" value={pendingLeaveCards.length} icon={Clock3} accent="amber" />
        <MetricCard label="Time Edits" value={pendingTimeEditCards.length} icon={CheckCircle2} accent="emerald" />
        <MetricCard label="Resignations" value={pendingResignations.length} icon={UserMinus} accent="rose" />
      </div>

      <SurfaceCard className="p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Approval Sections</h2>
            <p className="mt-1 text-sm text-slate-500">Switch between leave approvals and time edit approvals without leaving the inbox.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              { id: 'leave', label: 'Leave Approval', count: pendingLeaveCards.length },
              { id: 'time-edit', label: 'Edit Time Approval', count: pendingTimeEditCards.length },
              { id: 'resignation', label: 'Resignation', count: pendingResignations.length },
            ].map((section) => (
              <button
                key={section.id}
                type="button"
                onClick={() => {
                  setRouteState({ section: section.id as ApprovalSection });
                  if (activeView === 'history') {
                    scrollToHistoryDetails();
                  }
                }}
                className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition ${
                  activeSection === section.id
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-600 hover:bg-blue-50 hover:text-blue-700'
                }`}
              >
                {section.label}
                <span className={`rounded-full px-2 py-0.5 text-xs ${activeSection === section.id ? 'bg-white/20 text-white' : 'bg-white text-slate-600'}`}>
                  {section.count}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <button
            type="button"
            onClick={() => setRouteState({ section: activeSection, view: 'pending' })}
            className={`rounded-xl border px-4 py-4 text-left transition ${
              activeView === 'pending' ? 'border-blue-200 bg-blue-50' : 'border-slate-200 bg-white hover:border-blue-100'
            }`}
          >
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Pending</p>
            <p className="mt-2 text-2xl font-semibold text-slate-950">
              {activeSection === 'leave' ? pendingLeaveCards.length : activeSection === 'resignation' ? pendingResignationCards.length : pendingTimeEditCards.length}
            </p>
            <p className="mt-1 text-sm text-slate-500">Requests waiting for approval</p>
          </button>
          <button
            type="button"
            onClick={() => {
              setRouteState({ section: activeSection, view: 'history' });
              scrollToHistoryDetails();
            }}
            className={`rounded-xl border px-4 py-4 text-left transition ${
              activeView === 'history' ? 'border-blue-200 bg-blue-50' : 'border-slate-200 bg-white hover:border-blue-100'
            }`}
          >
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">History</p>
            <p className="mt-2 text-2xl font-semibold text-slate-950">
              {activeSection === 'leave' ? leaveHistoryCards.length : activeSection === 'resignation' ? resignationHistoryCards.length : timeEditHistoryCards.length}
            </p>
            <p className="mt-1 text-sm text-slate-500">Approved and completed decisions</p>
          </button>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Section</p>
            <p className="mt-2 text-lg font-semibold text-slate-950">{sectionTitle}</p>
            <p className="mt-1 text-sm text-slate-500">{activeView === 'pending' ? 'Action queue' : 'Decision archive'}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Current view</p>
            <p className="mt-2 text-lg font-semibold text-slate-950">{activeView === 'pending' ? 'Pending approvals' : 'History'}</p>
            <p className="mt-1 text-sm text-slate-500">
              {activeSection === 'leave' ? 'Leave workflow' : activeSection === 'resignation' ? 'Resignation workflow' : 'Time edit workflow'}
            </p>
          </div>
        </div>
      </SurfaceCard>

      <SurfaceCard className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Leave Intelligence</h2>
            <p className="text-sm text-slate-500">Keep leave analytics in the same inbox so approval decisions have context.</p>
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
          <MetricCard label="Highest Leave Load" value={topEmployee ? topEmployee.name : 'N/A'} icon={UserRound} accent="emerald" />
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
              <LeaveDepartmentPie items={todayDepartmentRows.map((row) => ({ label: row.department, value: row.count, color: row.color }))} />
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

      <div ref={historyDetailsRef}>
        <SurfaceCard className="p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold text-slate-950">{sectionTitle}</h2>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${activeView === 'pending' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-700'}`}>
                  {activeView === 'pending' ? 'Pending' : 'History'}
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-500">{sectionDescription}</p>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <History className="h-4 w-4" />
              {activeView === 'pending'
                ? `${currentCards.length} requests need review`
                : `${currentCards.length} requests in history`}
            </div>
          </div>
        </SurfaceCard>
      </div>

      {isLoading ? (
        <PageLoadingState label="Loading approval inbox..." />
      ) : currentCards.length === 0 ? (
        <PageEmptyState
          title={activeView === 'pending' ? 'Inbox is clear' : 'No history yet'}
          description={activeView === 'pending'
            ? `No ${activeSection === 'leave' ? 'leave' : 'time edit'} approvals are waiting right now.`
            : `No ${activeSection === 'leave' ? 'leave' : 'time edit'} approval history matches this view.`}
        />
      ) : (
        <div className="space-y-3">
          {currentCards.map((item) => (
            <SurfaceCard key={`${item.kind}-${item.id}`} className="p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                      item.kind === 'leave' ? 'bg-amber-100 text-amber-700' :
                      item.kind === 'resignation' ? 'bg-rose-100 text-rose-700' :
                      'bg-emerald-100 text-emerald-700'
                    }`}>
                      {item.kind === 'leave' ? 'Leave' :
                       item.kind === 'resignation' ? 'Resignation' :
                       'Time Edit'}
                    </span>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone(item.status)}`}>
                      {String(item.status || '').replace(/_/g, ' ')}
                    </span>
                    <span className="text-xs text-slate-500">
                      Submitted {new Date(item.submittedAt).toLocaleString()}
                    </span>
                    {item.reviewedAt ? (
                      <span className="text-xs text-slate-500">
                        Reviewed {new Date(item.reviewedAt).toLocaleString()}
                      </span>
                    ) : null}
                  </div>
                  <h3 className="text-lg font-semibold text-slate-950">{item.title}</h3>
                  <p className="text-sm text-slate-600">Submitted by: {item.employeeName} {item.employeeEmail ? `| ${item.employeeEmail}` : ''}</p>
                  <p className="text-sm text-slate-600">{item.description}</p>
                  {item.reviewerName ? (
                    <p className="text-xs text-slate-500">Reviewed by {item.reviewerName}</p>
                  ) : null}
                </div>

                {activeView === 'pending' ? (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      className="bg-emerald-600 shadow-sm hover:bg-emerald-700"
                      onClick={() => item.onApprove && handleAction(item.onApprove, `${item.employeeName}'s request approved.`)}
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => item.onReject && handleAction(item.onReject, `${item.employeeName}'s request rejected.`)}
                    >
                      <XCircle className="h-4 w-4" />
                      Reject
                    </Button>
                  </div>
                ) : null}
              </div>
            </SurfaceCard>
          ))}
        </div>
      )}
    </div>
  );
}
