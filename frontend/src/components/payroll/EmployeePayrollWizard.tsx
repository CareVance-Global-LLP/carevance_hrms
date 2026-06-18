import { useState, useEffect, useMemo } from 'react';
import {
  ArrowLeft,
  Save,
  Calculator,
  User,
  Clock,
  CheckCircle2,
  AlertCircle,
  MapPin,
  Building2,
  ToggleLeft,
  ToggleRight,
  ChevronRight,
  DollarSign,
  Wallet,
  Play,
  Loader2,
  Activity,
  ListChecks,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { payrollApi, getApiErrorMessage } from '@/services/api';
import Button from '@/components/ui/Button';
import { TextInput, SelectInput, FieldLabel } from '@/components/ui/FormField';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import ProgressSteps from './ProgressSteps';
import SalaryBreakdown from './SalaryBreakdown';
import InfoTooltip from '@/components/ui/InfoTooltip';
import { useToast } from '@/components/ui/Toast';
import type { EmployeePayrollDetails, EmployeePayrollTemplate, PayrollCalculation } from '@/types';

interface EmployeePayrollWizardProps {
  employeeId: number;
  monthYear: string;
  onBack: () => void;
  onComplete?: () => void;
  onViewRun?: (runId: number) => void;
}

const CTC_PRESETS = [
  { value: 300000, label: '₹3L' },
  { value: 500000, label: '₹5L' },
  { value: 800000, label: '₹8L' },
  { value: 1000000, label: '₹10L' },
  { value: 1200000, label: '₹12L' },
  { value: 1500000, label: '₹15L' },
  { value: 2000000, label: '₹20L' },
];

const WIZARD_STEPS = [
  { id: 'attendance', label: 'Attendance', description: 'Verify working days' },
  { id: 'salary', label: 'Salary Structure', description: 'Configure CTC & deductions' },
  { id: 'review', label: 'Review & Process', description: 'Confirm and save' },
];

export default function EmployeePayrollWizard({
  employeeId,
  monthYear,
  onBack,
  onComplete,
  onViewRun,
}: EmployeePayrollWizardProps) {
  const queryClient = useQueryClient();
  const [currentStep, setCurrentStep] = useState(0);
  const [annualCtc, setAnnualCtc] = useState('');
  const [workingDays, setWorkingDays] = useState('26');
  const [daysPresent, setDaysPresent] = useState('26');
  const [lOPDays, setLOPDays] = useState('0');
  const [overtimeHours, setOvertimeHours] = useState('0');
  const [isEditingAttendance, setIsEditingAttendance] = useState(false);
  const [template, setTemplate] = useState<EmployeePayrollTemplate | null>(null);
  const [calculation, setCalculation] = useState<PayrollCalculation | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [calcError, setCalcError] = useState<string | null>(null);
  const [processedRunId, setProcessedRunId] = useState<number | null>(null);

  // Fetch employee data
  const { data, isLoading } = useQuery({
    queryKey: ['payroll', 'employee', employeeId, monthYear],
    queryFn: () => payrollApi.getEmployeePayrollDetails(employeeId, { month_year: monthYear }).then(res => res.data),
  });

  // Fetch PT states (slabs/slabs are server-side; we only need the dropdown options here)
  const { data: ptStatesData } = useQuery({
    queryKey: ['payroll', 'pt-states'],
    queryFn: () => payrollApi.getPTStates().then(r => r.data),
    staleTime: 1000 * 60 * 60 * 24, // PT state list is static — cache for a day
  });

  // Build the dropdown options from the API; fall back to a static list if the
  // API call fails (e.g. offline) so the wizard still works.
  const INDIAN_STATES = useMemo(() => {
    const apiStates = (ptStatesData?.all_states ?? []) as Array<{ code: string; name: string }>;
    if (apiStates.length > 0) {
      return apiStates.map(s => ({ value: s.code, label: s.name }));
    }
    return [
      { value: 'andhra_pradesh', label: 'Andhra Pradesh' },
      { value: 'assam', label: 'Assam' },
      { value: 'bihar', label: 'Bihar' },
      { value: 'delhi', label: 'Delhi' },
      { value: 'gujarat', label: 'Gujarat' },
      { value: 'haryana', label: 'Haryana' },
      { value: 'jharkhand', label: 'Jharkhand' },
      { value: 'karnataka', label: 'Karnataka' },
      { value: 'kerala', label: 'Kerala' },
      { value: 'madhya_pradesh', label: 'Madhya Pradesh' },
      { value: 'maharashtra', label: 'Maharashtra' },
      { value: 'odisha', label: 'Odisha' },
      { value: 'punjab', label: 'Punjab' },
      { value: 'rajasthan', label: 'Rajasthan' },
      { value: 'tamil_nadu', label: 'Tamil Nadu' },
      { value: 'telangana', label: 'Telangana' },
      { value: 'uttar_pradesh', label: 'Uttar Pradesh' },
      { value: 'west_bengal', label: 'West Bengal' },
    ];
  }, [ptStatesData]);

  // Update template mutation
  const updateTemplateMutation = useMutation({
    mutationFn: (templateData: Partial<EmployeePayrollTemplate>) => 
      payrollApi.updateEmployeeTemplate(employeeId, templateData),
    onSuccess: (res) => {
      setTemplate(res.data.template);
    },
  });

  // Process payroll mutation
  const { show } = useToast();

  const processPayrollMutation = useMutation({
    mutationFn: () => payrollApi.processEmployeePayroll(employeeId, {
      user_id: employeeId,
      month_year: monthYear,
      annual_ctc: parseFloat(annualCtc) || 0,
      working_days: parseInt(workingDays) || 26,
      days_present: parseInt(daysPresent) || 0,
      lOP_days: parseFloat(lOPDays) || 0,
      overtime_hours: parseFloat(overtimeHours) || 0,
    }),
    onSuccess: (data) => {
      // Refresh dependent views so the next screen shows fresh data
      queryClient.invalidateQueries({ queryKey: ['payroll', 'department'] });
      queryClient.invalidateQueries({ queryKey: ['payroll', 'stats'] });
      queryClient.invalidateQueries({ queryKey: ['payroll', 'runs'] });
      queryClient.invalidateQueries({ queryKey: ['payroll', 'run-detail'] });
      queryClient.invalidateQueries({ queryKey: ['payroll', 'employee', employeeId, monthYear] });
      // Capture the run id so the success view can offer to open the lifecycle stepper
      setProcessedRunId((data as any)?.payroll_item?.payroll_run_id ?? null);
      // Note: don't auto-navigate. Let the success view render so the user
      // can act (view lifecycle / go back manually).
    },
    onError: (err: any) => {
      show({
        kind: 'error',
        message: getApiErrorMessage(err, 'Failed to process payroll. Please check the run status and try again.'),
      });
    },
  });

  // Initialize from data and auto-calculate
  useEffect(() => {
    if (data && !template) {
      setTemplate(data.template);
      const savedCtc = data.template.annual_ctc;
      if (savedCtc) {
        setAnnualCtc(String(savedCtc));
        if (data.payroll_preview) {
          setCalculation(data.payroll_preview);
        } else {
          // Auto-trigger calculation if backend didn't return a preview
          setTimeout(calculatePreview, 200);
        }
      }
    }
  }, [data, template]);

  // Auto-populate attendance from the new monthly attendance summary
  // (single source of truth — AttendanceRecord / AttendancePunch /
  // LeaveRequest / AttendanceHoliday). Falls back to the legacy
  // /8-hours-from-tracked-hours heuristic only when the summary is
  // missing (e.g., older backend).
  useEffect(() => {
    const summary = data?.attendance_summary;
    if (summary) {
      setWorkingDays(String(Math.round(summary.working_days)));
      setDaysPresent(String(Math.round(summary.present_days)));
      setLOPDays(String(Math.round(summary.lop_days)));
      const otHours = Number(summary.hours?.overtime_hours ?? 0);
      setOvertimeHours(otHours > 0 ? otHours.toFixed(2) : '0');
      return;
    }

    if (data?.time_tracking) {
      const tt = data.time_tracking;
      const trackedHours = tt.payroll_tracked_hours || tt.total_worked_hours || 0;
      const calculatedWorkingDays = Math.max(1, Math.ceil(trackedHours / 8));
      const calculatedDaysPresent = tt.payroll_attendance_days ||
        Math.min(calculatedWorkingDays, Math.floor(trackedHours / 8));
      const calculatedLwp = Math.max(0, calculatedWorkingDays - calculatedDaysPresent);
      const standardHours = calculatedDaysPresent * 8;
      const calculatedOvertime = Math.max(0, trackedHours - standardHours);

      setWorkingDays(String(calculatedWorkingDays));
      setDaysPresent(String(calculatedDaysPresent));
      setLOPDays(String(calculatedLwp));
      setOvertimeHours(calculatedOvertime > 0 ? calculatedOvertime.toFixed(1) : '0');
    }
  }, [data?.attendance_summary, data?.time_tracking]);

  // Auto-trigger calculation when CTC becomes a positive number (after template loads).
  // The 500ms debounce lets the user finish typing before we hit the API.
  // Intentionally not depending on `template` to avoid refire loops when template toggles change.
  useEffect(() => {
    if (!template) return;
    const ctc = parseFloat(annualCtc);
    if (!Number.isFinite(ctc) || ctc <= 0) return;
    const t = setTimeout(() => {
      calculatePreview();
    }, 500);
    return () => clearTimeout(t);
  }, [annualCtc]); // eslint-disable-line react-hooks/exhaustive-deps

  // Calculate preview
  const calculatePreview = async () => {
    if (!annualCtc || !template) return;

    setIsCalculating(true);
    setCalcError(null);
    try {
      const res = await payrollApi.calculate({
        user_id: employeeId,
        annual_ctc: parseFloat(annualCtc),
        state: template.pt_state ?? 'maharashtra',
        tax_regime: template.tax_regime ?? 'new',
        is_metro_city: template.is_metro_city ?? true,
      });

      // Apply template toggles
      const calc = res.data.calculation;
      const updatedCalculation: PayrollCalculation = {
        ...calc,
        components: {
          ...calc.components,
          deductions: {
            ...calc.components.deductions,
            pf_employee: template.pf_enabled ? calc.components.deductions.pf_employee : 0,
            esi_employee: template.esi_enabled ? calc.components.deductions.esi_employee : 0,
            pt: template.pt_enabled ? calc.components.deductions.pt : 0,
            tds: template.tds_enabled ? calc.components.deductions.tds : 0,
          },
          employer_contributions: {
            ...calc.components.employer_contributions,
            pf_employer: template.pf_enabled ? calc.components.employer_contributions.pf_employer : 0,
            esi_employer: template.esi_enabled ? calc.components.employer_contributions.esi_employer : 0,
          },
        },
      };

      // Recalculate total deductions and net
      const totalDeductions =
        (template.pf_enabled ? updatedCalculation.components.deductions.pf_employee : 0) +
        (template.esi_enabled ? updatedCalculation.components.deductions.esi_employee : 0) +
        (template.pt_enabled ? updatedCalculation.components.deductions.pt : 0) +
        (template.tds_enabled ? updatedCalculation.components.deductions.tds : 0);

      updatedCalculation.monthly.total_deductions = totalDeductions;
      updatedCalculation.monthly.net = updatedCalculation.monthly.gross - totalDeductions;

      setCalculation(updatedCalculation);
    } catch (error: any) {
      const message = getApiErrorMessage(error, 'Failed to calculate payroll. Please check your inputs.');
      setCalcError(message);
      console.error('Calculation failed:', error);
    } finally {
      setIsCalculating(false);
    }
  };

  // Template handlers
  const handleUpdateTemplate = (field: keyof EmployeePayrollTemplate, value: any) => {
    if (!template) return;
    const newTemplate = { ...template, [field]: value };
    setTemplate(newTemplate);
    updateTemplateMutation.mutate({ [field]: value });
  };

  const handleToggleDeduction = (key: keyof EmployeePayrollTemplate, value: boolean) => {
    handleUpdateTemplate(key, value);
    // Recalculate if we have calculation
    if (calculation && annualCtc) {
      setTimeout(calculatePreview, 100);
    }
  };

  const handleCTCChange = (value: string) => {
    setAnnualCtc(value);
    if (value && parseFloat(value) > 0 && template) {
      // Auto-calculate after a brief delay
      clearTimeout((window as any).calcTimeout);
      (window as any).calcTimeout = setTimeout(calculatePreview, 500);
    }
  };

  // Get employee data safely
  const employee = data?.employee;
  const time_tracking = data?.time_tracking;

  // Loading state - must be after all hooks
  if (isLoading || !data || !template || !employee) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  // Step 1: Attendance Verification
  const renderStep1 = () => (
    <div className="space-y-6">
      <SurfaceCard className="p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <Clock className="h-5 w-5 text-blue-600" />
            Attendance Details
          </h3>
          <div className="flex items-center gap-2">
            <span className="text-xs text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" />
              Auto-calculated
            </span>
          </div>
        </div>
        
        {/* Auto-calculation Info Banner */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <div className="flex items-start gap-3">
            <Activity className="h-5 w-5 text-blue-600 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-blue-900">Auto-calculated from Timesheets</p>
              <p className="text-xs text-blue-700 mt-1">
                Working days, present days, and overtime are automatically calculated based on the employee's tracked hours.
                You can manually adjust the values if needed.
              </p>
            </div>
          </div>
        </div>

        {/* Stale-timer warning: surfaced only when the controller actually
            auto-closed one or more running timers in this month. We show
            this so the operator knows the snapshot is honest (and that
            the user has a forgotten timer to chase up). */}
        {data && (data.auto_closed_timers ?? 0) > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-900">
                  Auto-closed {data.auto_closed_timers} stale running timer
                  {data.auto_closed_timers === 1 ? '' : 's'} for {monthYear}
                </p>
                <p className="text-xs text-amber-700 mt-1">
                  The user had a timer that was never stopped. The hours below are capped at
                  the start of today. Ask the employee to start/stop their timer cleanly going forward.
                </p>
              </div>
            </div>
          </div>
        )}
        
        {/* Timesheet Summary Cards — prefer the new attendance_summary
            (the single source of truth for payroll), fall back to the
            time_tracking payload for older backend responses. The source
            label below each value tells the user exactly where the
            number came from, so "0.0h" no longer looks like a bug. */}
        {(() => {
          const summary = data?.attendance_summary;

          // Resolve tracked hours, recording which source provided it.
          let trackedHours = 0;
          let trackedSource: 'attendance_summary' | 'payroll_tracked_hours' | 'total_worked_hours' | 'none' = 'none';
          if (summary?.hours?.worked_hours && summary.hours.worked_hours > 0) {
            trackedHours = summary.hours.worked_hours;
            trackedSource = 'attendance_summary';
          } else if (time_tracking.payroll_tracked_hours && time_tracking.payroll_tracked_hours > 0) {
            trackedHours = time_tracking.payroll_tracked_hours;
            trackedSource = 'payroll_tracked_hours';
          } else if (time_tracking.total_worked_hours && time_tracking.total_worked_hours > 0) {
            trackedHours = time_tracking.total_worked_hours;
            trackedSource = 'total_worked_hours';
          }

          // Resolve productive hours, recording source.
          let productiveHours = 0;
          let productiveSource: 'attendance_summary' | 'productivity_logs' | 'none' = 'none';
          if (summary && summary.total_worked_seconds > 0) {
            productiveHours = Math.round(
              (summary.total_worked_seconds - (summary.lop_days * 8 * 3600)) / 3600 * 10,
            ) / 10;
            productiveSource = 'attendance_summary';
          } else if (time_tracking.total_productive_hours && time_tracking.total_productive_hours > 0) {
            productiveHours = time_tracking.total_productive_hours;
            productiveSource = 'productivity_logs';
          }

          // Resolve overtime hours.
          const overtimeHours = summary?.hours?.overtime_hours ?? 0;
          const overtimeSource: 'attendance_summary' | 'none' =
            summary?.hours?.overtime_hours ? 'attendance_summary' : 'none';

          // Resolve attendance days.
          let attendanceDays = 0;
          let attendanceSource: 'attendance_summary' | 'payroll_attendance_days' | 'derived' | 'none' = 'none';
          if (summary && summary.working_days > 0) {
            attendanceDays = Math.round(summary.present_days);
            attendanceSource = 'attendance_summary';
          } else if (time_tracking.payroll_attendance_days) {
            attendanceDays = time_tracking.payroll_attendance_days;
            attendanceSource = 'payroll_attendance_days';
          } else if (trackedHours > 0) {
            attendanceDays = Math.floor(trackedHours / 8);
            attendanceSource = 'derived';
          }

          const hasData = trackedHours > 0 || (summary && summary.total_worked_seconds > 0);

          // Anomaly detection: warn the user when the average hours per
          // working day looks implausible, OR when a timer is still
          // running (in which case the headline number is ticking up).
          const attendanceDaysForWarn = summary && summary.working_days > 0
            ? summary.present_days
            : attendanceDays;
          const hoursPerDay = attendanceDaysForWarn > 0
            ? trackedHours / attendanceDaysForWarn
            : 0;
          const suspiciousHours = hoursPerDay > 16;
          const hasRunningTimer = time_tracking.has_running_timer === true;

          // Human-readable source labels.
          const SOURCE_LABELS: Record<string, string> = {
            attendance_summary: 'Source: Attendance summary',
            payroll_tracked_hours: 'Source: Check-in / check-out (PayrollTimeEntry)',
            total_worked_hours: 'Source: Timer / stopwatch (TimeEntry)',
            payroll_attendance_days: 'Source: Check-in / check-out',
            derived: 'Source: derived from tracked hours (÷ 8)',
            productivity_logs: 'Source: Activity logs',
            none: 'No source for this month',
          };

          return (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div className="text-center p-4 bg-slate-50 rounded-lg border border-slate-200">
                <p className="text-xs text-slate-500 mb-1">Total Tracked Hours</p>
                {hasData ? (
                  <>
                    <p className="text-2xl font-bold text-slate-900">{trackedHours.toFixed(1)}h</p>
                    <p className="text-xs text-slate-400 mt-1" title={trackedSource}>
                      {SOURCE_LABELS[trackedSource]}
                    </p>
                    {(suspiciousHours || hasRunningTimer) && (
                      <p
                        className="text-[10px] text-amber-700 mt-1"
                        title={
                          hasRunningTimer
                            ? 'A TimeEntry timer is still running. The hours below are ticking up until it is stopped.'
                            : `Average ${hoursPerDay.toFixed(1)} h/day is well above 16 h — likely a runaway timer.`
                        }
                      >
                        {hasRunningTimer
                          ? 'Timer still running — hours will keep climbing'
                          : 'Unusually high — check for running timers'}
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <p className="text-2xl font-bold text-slate-400">0.0h</p>
                    <p className="text-xs text-amber-600 mt-1">
                      No time tracked in {monthYear} — try a different month
                    </p>
                  </>
                )}
              </div>
              <div className="text-center p-4 bg-slate-50 rounded-lg border border-slate-200">
                <p className="text-xs text-slate-500 mb-1">Productive Hours</p>
                {productiveHours > 0 ? (
                  <>
                    <p className="text-2xl font-bold text-emerald-600">{productiveHours.toFixed(1)}h</p>
                    <p className="text-xs text-slate-400 mt-1" title={productiveSource}>
                      {SOURCE_LABELS[productiveSource]}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-2xl font-bold text-slate-400">0.0h</p>
                    <p className="text-xs text-amber-500 mt-1">No activity recorded</p>
                  </>
                )}
              </div>
              <div className="text-center p-4 bg-slate-50 rounded-lg border border-slate-200">
                <p className="text-xs text-slate-500 mb-1">Overtime Hours</p>
                {overtimeHours > 0 ? (
                  <>
                    <p className="text-2xl font-bold text-orange-600">{overtimeHours.toFixed(1)}h</p>
                    <p className="text-xs text-slate-400 mt-1" title={overtimeSource}>
                      {SOURCE_LABELS[overtimeSource]}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-2xl font-bold text-slate-400">0.0h</p>
                    <p className="text-xs text-slate-400 mt-1">Within standard shift</p>
                  </>
                )}
              </div>
              <div className="text-center p-4 bg-slate-50 rounded-lg border border-slate-200">
                <p className="text-xs text-slate-500 mb-1">Attendance Days</p>
                {hasData ? (
                  <>
                    <p className="text-2xl font-bold text-violet-600">{attendanceDays}</p>
                    <p className="text-xs text-slate-400 mt-1" title={attendanceSource}>
                      {SOURCE_LABELS[attendanceSource]}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-2xl font-bold text-slate-400">0</p>
                    <p className="text-xs text-amber-500 mt-1">No attendance data</p>
                  </>
                )}
              </div>
            </div>
          );
        })()}

        {/* Activity rate — informational only, doesn't affect net pay (per
            master guide §1: productivity data is display-only). */}
        <div className="grid grid-cols-1 gap-4 mb-6">
          <div className="text-center p-3 bg-slate-50 rounded-lg border border-slate-200">
            <p className="text-xs text-slate-500 mb-1">
              Activity Rate <span className="italic text-slate-400">(informational only — does not affect net pay)</span>
            </p>
            <p className={`text-2xl font-bold ${time_tracking.activity_percentage > 0 ? 'text-blue-600' : 'text-slate-400'}`}>
              {(time_tracking.activity_percentage ?? 0).toFixed(0)}%
            </p>
          </div>
        </div>

        {/* Calculated Fields - Auto-fetched from Timesheet */}
        <div className="border-t border-slate-200 pt-6">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-sm font-medium text-slate-900 flex items-center gap-2">
              <Calculator className="h-4 w-4 text-slate-400" />
              Auto-fetched Attendance Data
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
                {monthYear}
              </span>
            </h4>
            <button
              onClick={() => setIsEditingAttendance(!isEditingAttendance)}
              className="text-xs text-blue-600 hover:text-blue-700 font-medium px-2 py-1 rounded hover:bg-blue-50 transition-colors"
            >
              {isEditingAttendance ? 'Done Editing' : 'Edit Values'}
            </button>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className={`p-4 rounded-lg border ${isEditingAttendance ? 'bg-white border-slate-300' : 'bg-emerald-50 border-emerald-200'}`}>
              <div className="flex items-center justify-between mb-1">
                <FieldLabel className="mb-0">Working Days in Month</FieldLabel>
                {!isEditingAttendance && (
                  <span className="text-xs text-emerald-600 font-medium flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" />
                    Auto
                  </span>
                )}
              </div>
              <TextInput
                type="number"
                value={workingDays}
                onChange={(e) => setWorkingDays(e.target.value)}
                min="1"
                max="31"
                placeholder="26"
                disabled={!isEditingAttendance}
                className={!isEditingAttendance ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : ''}
              />
              <p className="text-xs text-slate-400 mt-1">Auto-calculated from tracked hours (8h/day)</p>
            </div>
            <div className={`p-4 rounded-lg border ${isEditingAttendance ? 'bg-white border-slate-300' : 'bg-emerald-50 border-emerald-200'}`}>
              <div className="flex items-center justify-between mb-1">
                <FieldLabel className="mb-0">Days Present</FieldLabel>
                {!isEditingAttendance && (
                  <span className="text-xs text-emerald-600 font-medium flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" />
                    Auto
                  </span>
                )}
              </div>
              <TextInput
                type="number"
                value={daysPresent}
                onChange={(e) => setDaysPresent(e.target.value)}
                min="0"
                max={workingDays}
                placeholder="26"
                disabled={!isEditingAttendance}
                className={!isEditingAttendance ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : ''}
              />
              <p className="text-xs text-slate-400 mt-1">Auto-fetched from attendance tracking</p>
            </div>
            <div className={`p-4 rounded-lg border ${isEditingAttendance ? 'bg-white border-slate-300' : 'bg-emerald-50 border-emerald-200'}`}>
              <div className="flex items-center justify-between mb-1">
                <FieldLabel className="mb-0">Leave Without Pay (LWP)</FieldLabel>
                {!isEditingAttendance && (
                  <span className="text-xs text-emerald-600 font-medium flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" />
                    Auto
                  </span>
                )}
              </div>
              <TextInput
                type="number"
                value={lOPDays}
                onChange={(e) => setLOPDays(e.target.value)}
                min="0"
                step="0.5"
                placeholder="0"
                disabled={!isEditingAttendance}
                className={!isEditingAttendance ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : ''}
              />
              <p className="text-xs text-slate-400 mt-1">Auto-calculated from attendance gaps</p>
            </div>
            <div className={`p-4 rounded-lg border ${isEditingAttendance ? 'bg-white border-slate-300' : 'bg-emerald-50 border-emerald-200'}`}>
              <div className="flex items-center justify-between mb-1">
                <FieldLabel className="mb-0">Overtime Hours</FieldLabel>
                {!isEditingAttendance && (
                  <span className="text-xs text-emerald-600 font-medium flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" />
                    Auto
                  </span>
                )}
              </div>
              <TextInput
                type="number"
                value={overtimeHours}
                onChange={(e) => setOvertimeHours(e.target.value)}
                min="0"
                step="0.5"
                placeholder="0"
                disabled={!isEditingAttendance}
                className={!isEditingAttendance ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : ''}
              />
              <p className="text-xs text-slate-400 mt-1">Auto-calculated hours beyond 8h/day</p>
            </div>
          </div>
        </div>
      </SurfaceCard>

      <div className="flex justify-end">
        <Button 
          variant="primary" 
          onClick={() => setCurrentStep(1)}
          iconRight={<ChevronRight className="h-4 w-4" />}
        >
          Continue to Salary Structure
        </Button>
      </div>
    </div>
  );

  // Step 2: Salary Configuration
  const renderStep2 = () => (
    <div className="space-y-6">
      <SurfaceCard className="p-6">
        <h3 className="text-lg font-semibold text-slate-900 mb-6 flex items-center gap-2">
          <DollarSign className="h-5 w-5 text-blue-600" />
          Salary Structure
        </h3>

        {/* CTC Input with Presets */}
        <div className="mb-6">
          <div className="flex items-center gap-1.5 mb-1">
            <FieldLabel className="mb-0">Annual CTC (Cost to Company)</FieldLabel>
            <InfoTooltip content="Total annual package — Basic + HRA + allowances + employer PF/ESI/gratuity. The headline number in offer letters. Not what hits the bank account." title="CTC" />
          </div>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-medium">₹</span>
            <TextInput
              type="number"
              value={annualCtc}
              onChange={(e) => handleCTCChange(e.target.value)}
              className="pl-8"
              placeholder="Enter annual CTC (e.g., 1200000)"
            />
          </div>

          {/* Quick Presets */}
          <div className="flex flex-wrap gap-2 mt-3">
            <span className="text-xs text-slate-500 py-1">Quick select:</span>
            {CTC_PRESETS.map((preset) => (
              <button
                key={preset.value}
                onClick={() => handleCTCChange(String(preset.value))}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  annualCtc === String(preset.value)
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {/* Structure Configuration */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <FieldLabel className="mb-0">Basic Salary (% of CTC)</FieldLabel>
              <InfoTooltip content="Foundation of salary. Drives PF, gratuity, HRA exemption. Typical 40–50% of CTC." title="Basic Salary" />
            </div>
            <TextInput
              type="number"
              value={template.basic_percentage}
              onChange={(e) => handleUpdateTemplate('basic_percentage', parseFloat(e.target.value) || 0)}
              min="0"
              max="100"
            />
          </div>
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <FieldLabel className="mb-0">HRA (% of Basic)</FieldLabel>
              <InfoTooltip content="Tax-exempt allowance. Exempt = min(actual HRA, rent−10% Basic, 50% Basic metro / 40% non-metro)." title="HRA" />
            </div>
            <TextInput
              type="number"
              value={template.hra_percentage}
              onChange={(e) => handleUpdateTemplate('hra_percentage', parseFloat(e.target.value) || 0)}
              min="0"
              max="100"
            />
          </div>
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <FieldLabel className="mb-0">Conveyance Allowance (₹)</FieldLabel>
              <InfoTooltip content="Tax-exempt up to ₹1,600/month under Old Regime. Fully taxable under New Regime." title="Conveyance" />
            </div>
            <TextInput
              type="number"
              value={template.conveyance_allowance}
              onChange={(e) => handleUpdateTemplate('conveyance_allowance', parseFloat(e.target.value) || 0)}
            />
          </div>
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <MapPin className="h-3 w-3 text-slate-400" />
              <FieldLabel className="mb-0">State (Professional Tax)</FieldLabel>
              <InfoTooltip content="PT is a state subject — rates vary by state (₹0–₹200/mo). Pick the state where your office is registered." title="PT State" />
            </div>
            <SelectInput
              value={template.pt_state}
              onChange={(e) => handleUpdateTemplate('pt_state', e.target.value)}
            >
              {INDIAN_STATES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </SelectInput>
          </div>
        </div>

        {/* Tax Regime & Metro */}
        <div className="flex flex-wrap items-center gap-6 mb-6 p-4 bg-slate-50 rounded-lg">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-slate-400" />
            <span className="text-sm text-slate-700">Tax Regime:</span>
            <InfoTooltip content="New: lower rates, fewer exemptions. Old: higher rates, full 80C/80D/HRA deductions." title="Tax regime" />
            <SelectInput
              value={template.tax_regime}
              onChange={(e) => handleUpdateTemplate('tax_regime', e.target.value)}
              className="w-32"
            >
              <option value="new">New Regime</option>
              <option value="old">Old Regime</option>
            </SelectInput>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-700">Metro City:</span>
            <InfoTooltip content="Affects HRA exemption cap: 50% of Basic in metros (Delhi, Mumbai, Kolkata, Chennai) vs 40% elsewhere." title="Metro City" />
            <button
              onClick={() => handleUpdateTemplate('is_metro_city', !template.is_metro_city)}
              className="text-blue-600"
            >
              {template.is_metro_city ? <ToggleRight className="h-6 w-6" /> : <ToggleLeft className="h-6 w-6" />}
            </button>
          </div>
        </div>

        {/* Deduction Toggles */}
        <div className="space-y-4">
          <h4 className="font-medium text-slate-900">Deductions</h4>

          {[
            { key: 'pf_enabled', label: 'Provident Fund (PF)', desc: '12% of basic salary', tooltip: 'Employee + employer each contribute 12% of Basic. Tax-deductible under Section 80C (employee share).' },
            { key: 'esi_enabled', label: 'Employee State Insurance (ESI)', desc: '0.75% employee, 3.25% employer', tooltip: 'Health insurance for employees earning ≤ ₹21,000/month gross. 0.75% + 3.25%.' },
            { key: 'pt_enabled', label: 'Professional Tax', desc: 'State-specific amount', tooltip: 'State-level tax. Varies by state (₹0–₹200/mo). Some states (Delhi, Haryana) have no PT.' },
            { key: 'tds_enabled', label: 'Income Tax (TDS)', desc: 'Based on tax regime', tooltip: 'Monthly income tax deducted based on annual projection. Adjusted at year-end via Form 16/ITR.' },
          ].map((item) => (
            <div key={item.key} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
              <div>
                <span className="text-sm text-slate-700 inline-flex items-center gap-1">
                  {item.label}
                  <InfoTooltip content={item.tooltip} title={item.label} size="sm" />
                </span>
                <p className="text-xs text-slate-400">{item.desc}</p>
              </div>
              <button
                onClick={() => handleToggleDeduction(item.key as keyof EmployeePayrollTemplate, !template[item.key as keyof EmployeePayrollTemplate])}
                className={template[item.key as keyof EmployeePayrollTemplate] ? 'text-blue-600' : 'text-slate-400'}
              >
                {template[item.key as keyof EmployeePayrollTemplate] ? <ToggleRight className="h-6 w-6" /> : <ToggleLeft className="h-6 w-6" />}
              </button>
            </div>
          ))}
        </div>
      </SurfaceCard>

      <div className="flex flex-col gap-2">
        {calcError && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-start gap-2 text-sm">
            <AlertCircle className="h-4 w-4 text-rose-600 flex-shrink-0 mt-0.5" />
            <p className="text-rose-700 flex-1 break-words">{calcError}</p>
            <button onClick={() => setCalcError(null)} className="text-rose-400 hover:text-rose-600">×</button>
          </div>
        )}
        <div className="flex justify-between">
          <Button variant="secondary" onClick={() => setCurrentStep(0)}>
            Back
          </Button>
          <Button
            variant="primary"
            onClick={async () => {
              if (!calculation && parseFloat(annualCtc) > 0 && template) {
                // No preview yet — try to calculate, then advance if it worked.
                await calculatePreview();
              }
              setCurrentStep(2);
            }}
            disabled={isCalculating || !annualCtc || parseFloat(annualCtc) <= 0}
            iconLeft={isCalculating ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}
            iconRight={!isCalculating ? <ChevronRight className="h-4 w-4" /> : undefined}
          >
            {isCalculating
              ? 'Calculating…'
              : calculation
                ? 'Review & Process'
                : parseFloat(annualCtc) > 0
                  ? 'Calculate & Continue'
                  : 'Enter CTC to continue'}
          </Button>
        </div>
      </div>
    </div>
  );

  // Step 3: Review & Process
  const renderStep3 = () => (
    <div className="space-y-6">
      {!calculation ? (
        <SurfaceCard className="p-8 text-center">
          <AlertCircle className="h-12 w-12 mx-auto mb-3 text-amber-500" />
          <h3 className="font-semibold text-slate-900 mb-2">Calculation Required</h3>
          <p className="text-slate-500 mb-4">Please enter CTC and configure salary structure first</p>
          <Button variant="primary" onClick={() => setCurrentStep(1)}>
            Go to Salary Structure
          </Button>
        </SurfaceCard>
      ) : (
        <>
          <SurfaceCard className="p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                <Wallet className="h-5 w-5 text-blue-600" />
                Salary Breakdown Preview
              </h3>
              <Button variant="secondary" size="sm" onClick={() => setCurrentStep(1)}>
                Edit
              </Button>
            </div>
            
            <SalaryBreakdown calculation={calculation} template={template} />
          </SurfaceCard>

          {/* Confirmation */}
          <SurfaceCard className={`p-6 ${processPayrollMutation.isSuccess ? 'bg-emerald-50 border-emerald-200' : ''}`}>
            {processPayrollMutation.isSuccess ? (
              <div className="text-center py-2">
                <CheckCircle2 className="h-12 w-12 mx-auto mb-3 text-emerald-600" />
                <h3 className="text-lg font-semibold text-emerald-900 mb-2">Payroll Processed Successfully!</h3>
                <p className="text-emerald-700 mb-5">Employee payroll has been calculated and saved.</p>

                <div className="bg-white border border-blue-200 rounded-lg p-4 mb-5 text-left max-w-md mx-auto">
                  <div className="flex items-center gap-2 mb-3">
                    <ListChecks className="h-4 w-4 text-blue-600" />
                    <p className="text-sm font-semibold text-blue-900">What's next?</p>
                  </div>
                  <ol className="text-sm text-slate-700 space-y-1.5">
                    <li className="flex gap-2"><span className="font-semibold text-blue-600">1.</span> <span><strong>Lock</strong> the run to finalize calculations.</span></li>
                    <li className="flex gap-2"><span className="font-semibold text-blue-600">2.</span> <span><strong>Approve</strong> as admin / manager.</span></li>
                    <li className="flex gap-2"><span className="font-semibold text-blue-600">3.</span> <span><strong>Release</strong> to generate the bank file.</span></li>
                    <li className="flex gap-2"><span className="font-semibold text-blue-600">4.</span> <span><strong>Disburse</strong> via your banking portal.</span></li>
                  </ol>
                </div>

                <div className="flex justify-center gap-3 flex-wrap">
                  <Button variant="secondary" onClick={onBack}>
                    Back to Department
                  </Button>
                  {processedRunId && onViewRun && (
                    <Button
                      variant="primary"
                      iconLeft={<Activity className="h-4 w-4" />}
                      onClick={() => onViewRun(processedRunId)}
                    >
                      View Run Lifecycle
                    </Button>
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-4">
                  Tip: you can always re-open this run from <strong>Recent Payroll Runs</strong> on the dashboard.
                </p>
              </div>
            ) : (
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h3 className="font-semibold text-slate-900">Ready to Process</h3>
                  <p className="text-sm text-slate-500">
                    Review the breakdown above and click Process to save the payroll
                  </p>
                </div>
                <div className="flex gap-3">
                  <Button variant="secondary" onClick={() => setCurrentStep(1)}>
                    Back
                  </Button>
                  <Button 
                    variant="primary" 
                    onClick={() => processPayrollMutation.mutate()}
                    disabled={processPayrollMutation.isPending}
                    iconLeft={processPayrollMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  >
                    {processPayrollMutation.isPending ? 'Processing...' : 'Process Payroll'}
                  </Button>
                </div>
              </div>
            )}
          </SurfaceCard>
        </>
      )}
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" onClick={onBack} iconLeft={<ArrowLeft className="h-4 w-4" />}>
          Back
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{employee.name}</h1>
          <p className="text-sm text-slate-500">
            {employee.designation || employee.role} • {employee.department || 'No Department'}
          </p>
        </div>
      </div>

      {/* Progress Steps */}
      <ProgressSteps steps={WIZARD_STEPS} currentStep={currentStep} />

      {/* Step Content */}
      <div className="mt-8">
        {currentStep === 0 && renderStep1()}
        {currentStep === 1 && renderStep2()}
        {currentStep === 2 && renderStep3()}
      </div>
    </div>
  );
}
