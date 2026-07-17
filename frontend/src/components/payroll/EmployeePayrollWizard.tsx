import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Save,
  Calculator,
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
  Loader2,
  Activity,
  ListChecks,
  Trash2,
  Receipt,
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
import type { EmployeePayrollTemplate, PayrollCalculation } from '@/types';

interface EmployeePayrollWizardProps {
  employeeId: number;
  monthYear: string;
  hideStepIndicator?: boolean;
  /**
   * Controlled step (0-indexed). When provided, the wizard uses this
   * value as the current step instead of the URL-driven
   * `?step=N` query param. The BulkPayrollMatrix sets this so the
   * outer step tabs (1..6 in the matrix) and the inner wizard
   * content (0..5) stay in lockstep.
   *
   * The wizard's "Continue" / "Back" buttons will call `onStepChange`
   * (instead of `setCurrentStep`) so the parent can drive the next
   * step.
   */
  controlledStep?: number;
  /**
   * Called by the wizard's Continue / Back buttons when
   * `controlledStep` is provided. Receives the new 0-indexed step.
   * The parent is expected to update its own state and re-render
   * the wizard with a new `controlledStep`.
   */
  onStepChange?: (step: number) => void;
  /**
   * Optional step override coming from the URL (?step=N). The wizard reads
   * its own URL search params, so this prop is only used as a fallback for
   * callers that bypass the URL (e.g. tests). When the URL has no step
   * param, the wizard defaults to step 0 (Attendance).
   */
  initialStep?: number;
  onBack: () => void;
  /**
   * Label for the post-processing "back" button shown after a payroll
   * run has been processed. Defaults to "Back to Dashboard".
   * Set to "Back to Pay Group" when the user came from a pay group.
   */
   backLabel?: string;
  /**
   * Fired on every step transition. The `step` argument is the
   * 1-indexed user-facing step number (1..6). Used by the
   * BulkPayrollMatrix to mark the per-employee per-step completion
   * flag in the backend.
   *
   * Callers that want to react to "payroll has been fully
   * processed" should check for `step === 6` (the Preview &
   * Process step). The wizard fires this for steps 1..5 when the
   * Continue button is clicked and for step 6 after the process
   * mutation succeeds.
   */
  onComplete?: (step: number) => void;
  onViewRun?: (runId: number) => void;
  /** When true, all employees have completed this step - hide Continue buttons */
  isStepCompleteForAll?: boolean;
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
  { id: 'attendance', label: 'Leave & Attendance', description: 'Verify working days & leave' },
  { id: 'salary', label: 'Salary Structure', description: 'Configure CTC & deductions' },
  { id: 'statutory', label: 'Statutory Compliances', description: 'PF, ESI, PT, TDS, LWF' },
  { id: 'benefits', label: 'Reimbursements & FBP', description: 'Approved reimbursements and flexible benefits' },
  { id: 'loans', label: 'Loans & Advances', description: 'Active loans and EMI deductions' },
  { id: 'review', label: 'Preview & Process', description: 'Confirm and save' },
];

export default function EmployeePayrollWizard({
  employeeId,
  monthYear,
  hideStepIndicator = false,
  initialStep,
  controlledStep,
  onStepChange,
  onBack,
  backLabel = 'Back to Dashboard',
  onComplete,
  onViewRun,
  isStepCompleteForAll = false,
}: EmployeePayrollWizardProps) {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  // Step resolution:
  //   - When `controlledStep` is provided, the wizard is fully
  //     controlled by the parent. The URL ?step=N is ignored and
  //     internal `setCurrentStep` is a no-op for navigation (only
  //     `onStepChange` notifies the parent).
  //   - Otherwise the wizard reads/writes ?step=N directly so a
  //     browser refresh / deep link lands the user on the same step.
  // `initialStep` is used as a fallback when neither is set.
  // Clamped to [0, 5] to defend against malformed URLs.
  const parseStep = (raw: string | null): number => {
    if (raw === null) {
      return initialStep !== undefined ? Math.max(0, Math.min(5, initialStep)) : 0;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(5, Math.trunc(n)));
  };
  const internalStep = parseStep(searchParams.get('step'));
  // When controlledStep is provided we clamp it too (defensive
  // against an out-of-range value from the parent). The parent is
  // still the source of truth.
  const currentStep =
    controlledStep !== undefined
      ? Math.max(0, Math.min(5, Math.trunc(controlledStep)))
      : internalStep;
  const isControlled = controlledStep !== undefined;

  // `setCurrentStep` is a no-op for navigation when controlled. It
  // still updates the URL ?step= (so deep-linking keeps working)
  // but the parent renders based on its own state, not the URL.
  const setCurrentStep = useCallback(
    (next: number) => {
      if (isControlled) {
        // The parent drives step changes via onStepChange; we still
        // fire it so a stray programmatic call doesn't get lost.
        onStepChange?.(Math.max(0, Math.min(5, Math.trunc(next))));
        return;
      }
      const clamped = Math.max(0, Math.min(5, Math.trunc(next)));
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (clamped === 0) {
            p.delete('step');
          } else {
            p.set('step', String(clamped));
          }
          return p;
        },
        { replace: false },
      );
    },
    [setSearchParams, isControlled, onStepChange],
  );

  /**
   * Helper for the Continue buttons. In controlled mode (BulkPayrollMatrix)
   * the wizard's Continue button must NOT advance the step — only the
   * matrix's outer tabs and the footer's "Continue to Step N" button
   * advance steps. Otherwise, when the user finishes step N for an
   * employee, two things happen at once: onComplete marks step N done
   * (auto-advancing to the next employee) AND setCurrentStep fires
   * onStepChange (advancing the step). The next employee would see
   * step N+1's content — wrong.
   *
   * In standalone mode (no `controlledStep` prop), this helper is
   * equivalent to calling setCurrentStep directly.
   */
  const handleContinue = useCallback(
    (nextStep: number, stepNum?: number) => {
      if (stepNum !== undefined) {
        onComplete?.(stepNum);
      }
      // In controlled mode, advance only when the matrix has *already*
      // marked all employees done for the current step and is calling
      // its own "Continue to Step N" button. The wizard's own Continue
      // button must not advance the step.
      if (!isControlled) {
        setCurrentStep(nextStep);
      }
    },
    [isControlled, onComplete, setCurrentStep],
  );

  const [annualCtc, setAnnualCtc] = useState('');
  const [workingDays, setWorkingDays] = useState('26');
  const [daysPresent, setDaysPresent] = useState('26');
  const [lOPDays, setLOPDays] = useState('0');
  const [paidLeaveDays, setPaidLeaveDays] = useState('0');
  const [overtimeHours, setOvertimeHours] = useState('0');
  const [isEditingAttendance, setIsEditingAttendance] = useState(false);

  const [template, setTemplate] = useState<EmployeePayrollTemplate | null>(null);
  const [calculation, setCalculation] = useState<PayrollCalculation | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [calcError, setCalcError] = useState<string | null>(null);
  const [processedRunId, setProcessedRunId] = useState<number | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);

  // Days Absent is purely derived — Working − Present − Paid Leave.
  // We don't keep it in state; it recalculates as the inputs change.
  const absentDays = useMemo(() => {
    const working = parseInt(workingDays, 10) || 0;
    const present = parseInt(daysPresent, 10) || 0;
    const leave = parseFloat(paidLeaveDays) || 0;
    return Math.max(0, working - present - leave);
  }, [workingDays, daysPresent, paidLeaveDays]);

  // Fetch employee data
  const { data, isLoading } = useQuery({
    queryKey: ['payroll', 'employee', employeeId, monthYear],
    queryFn: () => payrollApi.getEmployeePayrollDetails(employeeId, { month_year: monthYear }).then(res => res.data),
  });

  // Approved reimbursements for this employee. Surfaced in Step 2
  // (Salary Structure) so the admin can see what's been pre-approved
  // and pull any item out via the trash icon. The query only runs
  // when the wizard is on a step that needs it (Step 1+, `enabled`
  // gate below), but the trash-icon removal still works from any
  // step because the mutation updates this query's cache directly.
  const approvedReimbursementsQuery = useQuery({
    queryKey: ['reimbursements', 'employee', employeeId, 'approved', monthYear],
    queryFn: () => payrollApi.getEmployeeReimbursements(employeeId, 'approved', monthYear).then(res => res.data),
    enabled: Boolean(employeeId),
  });
  const approvedReimbursements = Array.isArray(approvedReimbursementsQuery.data) ? approvedReimbursementsQuery.data : [];
  const approvedReimbursementsTotal = approvedReimbursements.reduce(
    (sum, r) => sum + (Number(r.amount) || 0),
    0,
  );

  const removeReimbursementMutation = useMutation({
    mutationFn: (id: number) => payrollApi.removeReimbursement(id),
    onSuccess: () => {
      // Drop the row from this query's cache so the panel refreshes
      // immediately without an extra round-trip.
      queryClient.invalidateQueries({ queryKey: ['reimbursements', 'employee', employeeId] });
      show({ kind: 'success', message: 'Reimbursement removed from salary structure.' });
    },
    onError: (err: unknown) => {
      show({ kind: 'error', message: getApiErrorMessage(err, 'Failed to remove reimbursement.') });
    },
  });

  const handleRemoveReimbursement = (id: number, title: string) => {
    // Native confirm() keeps this lightweight and avoids pulling in a
    // modal library for a single destructive action. The button is
    // disabled while the request is in flight.
    const ok = window.confirm(
      `Remove "${title}" from the salary structure?\n\n` +
      `This will stop it from being added to the next payroll run. ` +
      `If it was already paid out, this does NOT claw back the money — ` +
      `use a payroll reversal for that.`
    );
    if (ok) {
      removeReimbursementMutation.mutate(id);
    }
  };

  // Step 3 (Reimbursements & FBP): fetch FBP allocations for this
  // employee. We use the same useQuery lifecycle as approved
  // reimbursements so the trash-icon mutations on the reimbursements
  // list also invalidate this query.
  const fbpAllocationsQuery = useQuery({
    queryKey: ['payroll', 'fbp', 'allocations', employeeId],
    queryFn: () => payrollApi.getFbpAllocations(employeeId).then((r) => r.data),
    enabled: Boolean(employeeId),
  });
  const fbpAllocations = Array.isArray(fbpAllocationsQuery.data) ? fbpAllocationsQuery.data : [];

  // Step 4 (Loans & Advances): fetch active loans for this employee.
  // The backend's listLoans now supports ?user_id=X (Phase 7a) so we
  // pass it explicitly instead of filtering client-side.
  const loansQuery = useQuery({
    queryKey: ['payroll', 'loans', 'user', employeeId],
    queryFn: () => payrollApi.listLoans({ user_id: employeeId, status: 'approved' }).then((r) => r.data?.loans ?? []),
    enabled: Boolean(employeeId),
  });
  const activeLoans = Array.isArray(loansQuery.data) ? loansQuery.data : [];

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
    onSuccess: (res) => {
      // Mark step 6 (Preview & Process) done — this is the final
      // step in the BulkPayrollMatrix. Step 5 was marked by the
      // Process button onClick handler before the mutation fired.
      onComplete?.(6);
      
      // Refresh dependent views so the next screen shows fresh data
      queryClient.invalidateQueries({ queryKey: ['payroll', 'stats'] });
      queryClient.invalidateQueries({ queryKey: ['payroll', 'runs'] });
      queryClient.invalidateQueries({ queryKey: ['payroll', 'run-detail'] });
      queryClient.invalidateQueries({ queryKey: ['payroll', 'employee', employeeId, monthYear] });
      // Capture the run id so the success view can offer to open the lifecycle stepper
      const payload = (res as any)?.data ?? res;
      setProcessedRunId(payload?.payroll_item?.payroll_run_id ?? null);
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

  

  

  // Initialize from data and auto-calculate.
  useEffect(() => {
    if (data && !template) {
      setTemplate(data.template);
      const savedCtc = data.template.annual_ctc;
      if (savedCtc) {
        setAnnualCtc(String(savedCtc));
        if (data.payroll_preview) {
          setCalculation(data.payroll_preview);
          setIsInitializing(false);
        } else {
          // Auto-trigger calculation if backend didn't return a preview
          setIsCalculating(true);
          setTimeout(() => {
            calculatePreview().finally(() => {
              setIsInitializing(false);
            });
          }, 200);
        }
      } else {
        // No CTC configured, initialization complete
        setIsInitializing(false);
      }
    }
  }, [data, template, annualCtc]);

  // Auto-populate attendance from the monthly attendance summary
  // (single source of truth). Working days, present days, LOP, and
  // paid leave are pulled verbatim from the backend.
  useEffect(() => {
    const summary = data?.attendance_summary;
    if (!summary) return;
    setWorkingDays(String(Math.round(summary.working_days)));
    setDaysPresent(String(Math.round(summary.present_days)));
      setLOPDays(String(Math.round(summary.total_lop_days ?? summary.legacy_lop_days ?? 0)));
    setPaidLeaveDays(String(Math.round(summary.paid_leave_days ?? 0)));
  }, [data?.attendance_summary]);

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
  }, [annualCtc]);  

  // Persist annual_ctc to the template so the bulk "Process All Employees"
  // handler can read it from EmployeePayrollTemplate.annual_ctc. Without
  // this, the bulk handler sees 0 and skips every employee.
  useEffect(() => {
    if (!template) return;
    const ctc = parseFloat(annualCtc);
    if (!Number.isFinite(ctc) || ctc <= 0) return;
    // Avoid an infinite loop: only save if the value differs from what
    // the template currently has.
    if (Number(template.annual_ctc) === ctc) return;
    const t = setTimeout(() => {
      updateTemplateMutation.mutate({ annual_ctc: ctc });
    }, 600);
    return () => clearTimeout(t);
  }, [annualCtc, template?.annual_ctc]);

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
    // Some fields affect the payroll breakdown (PT, tax regime,
    // metro-city HRA exemption). Recalculate after the local state
    // has been updated so the calculate call sees the new value.
    // Note: PF/ESI/PT/TDS *toggles* are handled in
    // handleToggleDeduction below — we only re-calc for value
    // changes here.
    if (['pt_state', 'tax_regime', 'is_metro_city'].includes(field)) {
      if (calculation && annualCtc) {
        setTimeout(calculatePreview, 100);
      }
    }
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
  const existingPayroll = data?.existing_payroll;
  const isAlreadyProcessed = Boolean(existingPayroll && existingPayroll.id);

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
          {/* No status pill — per-field hints below explain each value. */}
        </div>
        
        <p className="text-sm text-slate-600 mb-6">
          Attendance data is auto-fetched from the attendance system. Use Edit Values to adjust if needed.
          Overtime hours are entered manually.
        </p>

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
        
        {/* Day-based summary cards. Overtime is intentionally NOT shown
            here — it's manual-only and lives in the Edit Values panel. */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="text-center p-4 bg-slate-50 rounded-lg border border-slate-200">
            <p className="text-xs text-slate-500 mb-1">Working Days</p>
            <p className="text-2xl font-bold text-slate-800">{workingDays || '0'}</p>
            <p className="text-xs text-emerald-600 mt-1">Auto</p>
          </div>
          <div className="text-center p-4 bg-slate-50 rounded-lg border border-slate-200">
            <p className="text-xs text-slate-500 mb-1">Days Present</p>
            <p className="text-2xl font-bold text-slate-800">{daysPresent || '0'}</p>
            <p className="text-xs text-emerald-600 mt-1">Auto</p>
          </div>
          <div className="text-center p-4 bg-slate-50 rounded-lg border border-slate-200">
            <p className="text-xs text-slate-500 mb-1">Days on Leave</p>
            <p className="text-2xl font-bold text-slate-800">{paidLeaveDays || '0'}</p>
            <p className="text-xs text-emerald-600 mt-1">Auto</p>
          </div>
          <div className="text-center p-4 bg-slate-50 rounded-lg border border-slate-200">
            <p className="text-xs text-slate-500 mb-1">Days Absent</p>
            <p className="text-2xl font-bold text-red-600">{absentDays}</p>
            <p className="text-xs text-emerald-600 mt-1">Auto</p>
          </div>
        </div>

        {/* Leave Summary + Daily Wages — informational, read-only.
            Daily wage is derived from the actual worked hours divided by
            days present (a more honest rate than monthly/working-days
            which would imply 8h of pay for every working day). */}
        <div className="grid grid-cols-1 gap-4 mb-6">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-500">Approved Leave (this month)</p>
                <p className="text-base font-semibold text-slate-900 mt-0.5">
                  {paidLeaveDays || '0'} paid leave day{paidLeaveDays === '1' ? '' : 's'}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  LOP: {lOPDays || '0'} day{(lOPDays === '0' || lOPDays === '1') ? '' : 's'}
                </p>
              </div>
              <Receipt className="h-7 w-7 text-emerald-300" />
            </div>
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
                   <span className="text-xs text-blue-600 font-medium flex items-center gap-1">
                     Manual Entry
                   </span>
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
                 <p className="text-xs text-slate-400 mt-1">Enter overtime hours manually</p>
               </div>
          </div>
        </div>
      </SurfaceCard>

        {!isStepCompleteForAll && (
        <div className="flex justify-end">
          <Button 
            variant="primary" 
            onClick={() => handleContinue(1, 1)}
            iconRight={<ChevronRight className="h-4 w-4" />}
          >
            Continue
          </Button>
        </div>
      )}
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
          {!isStepCompleteForAll && (
            <Button
              variant="primary"
              onClick={async () => {
                if (!calculation && parseFloat(annualCtc) > 0 && template) {
                  // No preview yet — try to calculate, then advance if it worked.
                  await calculatePreview();
                }
                // Mark step 2 complete before advancing (BulkPayrollMatrix
                // uses this to track per-employee per-step progress).
                // handleContinue(2, 2) advances the step ONLY in
                // standalone mode — in matrix mode it just marks step
                // 2 done and lets the matrix drive the next step.
                handleContinue(2, 2);
              }}
              disabled={isCalculating || !annualCtc || parseFloat(annualCtc) <= 0}
              iconLeft={isCalculating ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}
              iconRight={!isCalculating ? <ChevronRight className="h-4 w-4" /> : undefined}
            >
              {isCalculating
                ? 'Calculating…'
                : calculation
                  ? 'Continue'
                  : parseFloat(annualCtc) > 0
                    ? 'Calculate & Continue'
                    : 'Enter CTC to continue'}
            </Button>
          )}
        </div>
      </div>

    </div>
  );

  // Step 2: Statutory Compliances (NEW in 6-step flow)
  // Read-only review of PF/ESI/PT/TDS contributions computed by
  // the calculate endpoint. We display what the calculator already
  // returns so the operator can verify before advancing.
  const renderStep2Statutory = () => {
    const c = calculation;
    const pfE = Number(c?.components?.deductions?.pf_employee ?? 0);
    const pfER = Number(c?.components?.employer_contributions?.pf_employer ?? 0);
    const pfEps = Number(c?.components?.employer_contributions?.eps ?? 0);
    const pfEpf = Number(c?.components?.employer_contributions?.epf ?? 0);
    const pfEdi = pfEps + pfEpf; // EDLI-like split (EPS + EPF)
    const esiE = Number(c?.components?.deductions?.esi_employee ?? 0);
    const esiER = Number(c?.components?.employer_contributions?.esi_employer ?? 0);
    const pt = Number(c?.components?.deductions?.pt ?? 0);
    const tds = Number(c?.components?.deductions?.tds ?? 0);
    const gross = Number(c?.monthly?.gross ?? 0);
    const pfWageBase = Math.min(gross, 15000);
    const esiApplies = template?.esi_enabled && gross > 0 && gross <= 21000;
    const lwfEnabled = Boolean(template?.lwf_enabled);

    return (
      <div className="space-y-6">
        <SurfaceCard className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
              <Calculator className="h-5 w-5 text-blue-600" />
              Statutory Compliances
            </h3>
            <span className="text-xs text-slate-500">
              Auto-calculated · read-only
            </span>
          </div>

          <p className="text-sm text-slate-600 mb-6">
            These values are computed by the calculator from your CTC and template settings.
            They are <strong>read-only</strong> here — adjust them in the previous Salary Structure step.
          </p>

          {/* PF row */}
          <div className="rounded-lg border border-slate-200 bg-white p-4 mb-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-900">Provident Fund (PF)</span>
                <InfoTooltip content={`Employee contributes 12% of PF wage base (capped at ₹15,000) = ₹${pfWageBase.toFixed(0)}. Employer matches.`} title="PF" />
              </div>
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
                {template?.pf_enabled ? 'Applicable' : 'Disabled'}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-4 mt-3">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-slate-500">Employee</p>
                <p className="text-base font-semibold text-slate-900">₹ {pfE.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wider text-slate-500">Employer</p>
                <p className="text-base font-semibold text-slate-900">₹ {pfER.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wider text-slate-500">EDLI / EPS-EPF</p>
                <p className="text-base font-semibold text-slate-900">₹ {pfEdi.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
              </div>
            </div>
          </div>

          {/* ESI row */}
          <div className="rounded-lg border border-slate-200 bg-white p-4 mb-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-900">Employee State Insurance (ESI)</span>
                <InfoTooltip content={`ESI applies when gross ≤ ₹21,000/month. Employee 0.75%, employer 3.25%.`} title="ESI" />
              </div>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${esiApplies ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                {esiApplies ? 'Applicable' : 'Not applicable'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-4 mt-3">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-slate-500">Employee</p>
                <p className="text-base font-semibold text-slate-900">₹ {esiE.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wider text-slate-500">Employer</p>
                <p className="text-base font-semibold text-slate-900">₹ {esiER.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
              </div>
            </div>
          </div>

          {/* PT row */}
          <div className="rounded-lg border border-slate-200 bg-white p-4 mb-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-900">Professional Tax (PT)</span>
                <InfoTooltip content={`State-specific slab. ${template?.pt_state ?? 'Maharashtra'} slab applied automatically.`} title="PT" />
              </div>
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
                {template?.pt_enabled ? 'Applicable' : 'Disabled'}
              </span>
            </div>
            <p className="text-base font-semibold text-slate-900">
              ₹ {pt.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </div>

          {/* TDS row */}
          <div className="rounded-lg border border-slate-200 bg-white p-4 mb-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-900">Income Tax (TDS)</span>
                <InfoTooltip content={`Annualized and divided by 12. ${template?.tax_regime === 'old' ? 'Old regime' : 'New regime'} with approved exemptions.`} title="TDS" />
              </div>
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
                {template?.tds_enabled ? 'Applicable' : 'Disabled'}
              </span>
            </div>
            <p className="text-base font-semibold text-slate-900">
              ₹ {tds.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </div>

          {/* LWF row (if applicable) */}
          {lwfEnabled && (
            <div className="rounded-lg border border-slate-200 bg-white p-4 mb-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-slate-900">Labour Welfare Fund (LWF)</span>
                  <InfoTooltip content="State-specific. Usually a small annual amount split monthly. The exact value is finalized when the payroll run is processed and the PayrollItem is written." title="LWF" />
                </div>
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
                  Configured
                </span>
              </div>
              <p className="text-xs text-slate-500">
                LWF amount is computed at payroll-run time (see PayrollItem.total_lwf).
              </p>
            </div>
          )}

          {!c && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
              <InfoTooltip content="Calculations run when you click Calculate on the previous step. If you see this, go back and re-trigger." title="No calculation yet" />
              <span className="ml-2">No calculation available yet — return to Salary Structure and click Calculate.</span>
            </div>
          )}
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
            <Button variant="secondary" onClick={() => setCurrentStep(1)}>
              Back
            </Button>
            {!isStepCompleteForAll && (
              <Button
                variant="primary"
                onClick={async () => {
                  if (!calculation && parseFloat(annualCtc) > 0 && template) {
                    await calculatePreview();
                  }
                  // In matrix mode: mark step 3 done only; matrix drives
                  // the step change.
                  handleContinue(3, 3);
                }}
                disabled={!calculation && (parseFloat(annualCtc) <= 0 || !template)}
                iconRight={<ChevronRight className="h-4 w-4" />}
              >
                Continue
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  };

  // Step 3: Reimbursements & FBP (NEW in 6-step flow)
  // Shows the approved reimbursements and active FBP allocations that
  // will be folded into the salary. Reimbursements keep the trash-icon
  // removal (soft-state: sets status='removed' on the backend).
  const renderStep3Benefits = () => {
    const reimbursementsTotal = approvedReimbursements.reduce(
      (sum, r) => sum + (Number(r.amount) || 0),
      0,
    );
    const fbpTotal = (fbpAllocations as any[]).reduce(
      (sum, a) => sum + (Number(a.allocated_amount) || Number(a.amount) || 0),
      0,
    );
    const fbpUtilized = (fbpAllocations as any[]).reduce(
      (sum, a) => sum + (Number(a.utilized_amount) || 0),
      0,
    );

    return (
      <div className="space-y-6">
        {/* Reimbursements */}
        <SurfaceCard className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
              <Receipt className="h-5 w-5 text-blue-600" />
              Approved Reimbursements
            </h3>
            <span className="text-xs text-slate-500">
              {approvedReimbursementsQuery.isLoading
                ? 'Loading…'
                : `${approvedReimbursements.length} item${approvedReimbursements.length === 1 ? '' : 's'}`}
            </span>
          </div>

          {approvedReimbursementsQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-slate-500 py-3">
              <Loader2 className="h-4 w-4 animate-spin" />
              Fetching approved reimbursements…
            </div>
          ) : approvedReimbursements.length === 0 ? (
            <p className="text-sm text-slate-500 py-3">
              No approved reimbursements for this employee. Approve one from the
              <span className="font-medium"> Reimbursements </span>
              page and it will show up here.
            </p>
          ) : (
            <>
              <ul className="divide-y divide-slate-100">
                {approvedReimbursements.map((r: any) => {
                  const isRemoving =
                    removeReimbursementMutation.isPending &&
                    removeReimbursementMutation.variables === r.id;
                  const label = r.title || r.description || `Reimbursement #${r.id}`;
                  const currency = r.currency || 'INR';
                  return (
                    <li
                      key={r.id}
                      className="flex items-center justify-between py-3 gap-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-900 truncate">
                          {label}
                        </p>
                        <p className="text-xs text-slate-500">
                          {r.expense_date ? `Expense date: ${r.expense_date} · ` : ''}
                          Approved {r.approved_at ? `on ${String(r.approved_at).slice(0, 10)}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-sm font-semibold text-slate-900 tabular-nums">
                          {currency} {Number(r.amount).toLocaleString('en-IN', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRemoveReimbursement(r.id, label)}
                          disabled={isRemoving || removeReimbursementMutation.isPending}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          aria-label={`Remove ${label} from salary structure`}
                          title="Remove from salary structure"
                        >
                          {isRemoving ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-4 flex items-center justify-between border-t border-slate-200 pt-3">
                <span className="text-sm font-medium text-slate-600">Total Reimbursements</span>
                <span className="text-base font-bold text-slate-900 tabular-nums">
                  ₹ {reimbursementsTotal.toLocaleString('en-IN', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
              </div>
            </>
          )}
        </SurfaceCard>

        {/* FBP allocations */}
        <SurfaceCard className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
              <Wallet className="h-5 w-5 text-blue-600" />
              Flexible Benefit Plan (FBP) Allocations
            </h3>
            <span className="text-xs text-slate-500">
              {fbpAllocationsQuery.isLoading
                ? 'Loading…'
                : `${(fbpAllocations as any[]).length} component${(fbpAllocations as any[]).length === 1 ? '' : 's'}`}
            </span>
          </div>

          {fbpAllocationsQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-slate-500 py-3">
              <Loader2 className="h-4 w-4 animate-spin" />
              Fetching FBP allocations…
            </div>
          ) : (fbpAllocations as any[]).length === 0 ? (
            <p className="text-sm text-slate-500 py-3">
              No FBP allocations configured. Manage FBP components from the
              <span className="font-medium"> Salary Templates </span>
              page.
            </p>
          ) : (
            <>
              <ul className="divide-y divide-slate-100">
                {(fbpAllocations as any[]).map((alloc: any) => {
                  const allocated = Number(alloc.allocated_amount ?? alloc.amount ?? 0);
                  const utilized = Number(alloc.utilized_amount ?? 0);
                  const available = Math.max(0, allocated - utilized);
                  const currency = alloc.currency || 'INR';
                  return (
                    <li
                      key={alloc.id}
                      className="flex items-center justify-between py-3 gap-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-900 truncate">
                          {alloc.component?.name || alloc.name || `FBP #${alloc.id}`}
                        </p>
                        <p className="text-xs text-slate-500">
                          Allocated {currency} {allocated.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ·
                          {' '}Utilized {currency} {utilized.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-semibold text-emerald-600 tabular-nums">
                          {currency} {available.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </p>
                        <p className="text-[10px] text-slate-400">Available</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-4 grid grid-cols-2 gap-4 border-t border-slate-200 pt-3">
                <div>
                  <p className="text-xs text-slate-500">Total Allocated</p>
                  <p className="text-base font-bold text-slate-900 tabular-nums">
                    ₹ {fbpTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Total Utilized</p>
                  <p className="text-base font-bold text-slate-900 tabular-nums">
                    ₹ {fbpUtilized.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </div>
              </div>
            </>
          )}
        </SurfaceCard>

        <div className="flex flex-col gap-2">
          <div className="flex justify-between">
            <Button variant="secondary" onClick={() => setCurrentStep(2)}>
              Back
            </Button>
            {!isStepCompleteForAll && (
              <Button
                variant="primary"
                onClick={() => handleContinue(4, 4)}
                iconRight={<ChevronRight className="h-4 w-4" />}
              >
                Continue
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  };

  // Step 4: Loans & Advances (NEW in 6-step flow)
  // Read-only list of active loans and pending requests. Each row
  // shows the EMI deduction that will be auto-applied during process.
  const renderStep4Loans = () => {
    const totalEmi = activeLoans.reduce(
      (sum, l) => sum + (Number((l as any).emi_amount) || 0),
      0,
    );
    return (
      <div className="space-y-6">
        <SurfaceCard className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
              <ListChecks className="h-5 w-5 text-blue-600" />
              Loans & Advances
            </h3>
            <span className="text-xs text-slate-500">
              {loansQuery.isLoading
                ? 'Loading…'
                : `${activeLoans.length} active loan${activeLoans.length === 1 ? '' : 's'}`}
            </span>
          </div>

          {loansQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-slate-500 py-3">
              <Loader2 className="h-4 w-4 animate-spin" />
              Fetching loans…
            </div>
          ) : activeLoans.length === 0 ? (
            <p className="text-sm text-slate-500 py-3">
              No active loans for this employee. New loan requests can be submitted from
              the <span className="font-medium"> My Loans </span> page.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {activeLoans.map((loan: any) => {
                const original = Number(loan.amount) || 0;
                const emi = Number(loan.emi_amount) || 0;
                const total = Number(loan.total_installments) || 0;
                const remaining = Number(loan.remaining_amount) || 0;
                const paid = Math.max(0, original - remaining);
                const pct = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;
                return (
                  <li
                    key={loan.id}
                    className="py-4"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <p className="text-sm font-medium text-slate-900 capitalize">
                          {loan.loan_type === 'advance' ? 'Salary Advance' : 'Loan'}
                        </p>
                        <p className="text-xs text-slate-500">
                          {loan.purpose || 'No purpose specified'}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-rose-600 tabular-nums">
                          ₹ {emi.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / mo
                        </p>
                        <p className="text-[10px] text-slate-400">EMI deduction</p>
                      </div>
                    </div>
                    {/* Progress bar */}
                    <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500"
                        style={{ width: `${pct}%` }}
                        role="progressbar"
                        aria-valuenow={pct}
                        aria-valuemin={0}
                        aria-valuemax={100}
                      />
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1">
                      {paid} / {total} installments paid ({pct}%) · Remaining ₹ {remaining.toLocaleString('en-IN')}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </SurfaceCard>

        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-rose-900">Total Monthly EMI</p>
              <p className="text-xs text-rose-700">Auto-deducted from salary on process</p>
            </div>
            <p className="text-xl font-bold text-rose-700 tabular-nums">
              ₹ {totalEmi.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex justify-between">
            <Button variant="secondary" onClick={() => setCurrentStep(3)}>
              Back
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                // In matrix mode: mark step 5 done only.
                handleContinue(5, 5);
              }}
              iconRight={<ChevronRight className="h-4 w-4" />}
            >
              Continue
            </Button>
          </div>
        </div>
      </div>
    );
  };

  // Step 3: Review & Process
  const renderStep3 = () => (
    <div className="space-y-6">
      {isLoading || isInitializing || !template || (!calculation && isCalculating) ? (
        <SurfaceCard className="p-8 text-center">
          <Loader2 className="h-8 w-8 mx-auto mb-3 text-blue-500 animate-spin" />
          <p className="text-slate-500">Loading payroll details...</p>
        </SurfaceCard>
      ) : !calculation ? (
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

          {/* New in 6-step flow: side-by-side totals for reimbursements,
              FBP allocations, and active loan EMIs. These are pulled
              from the same data sources that drive Steps 3 and 4, so the
              preview is always in sync with what the admin saw there. */}
          <SurfaceCard className="p-6">
            <h3 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
              <ListChecks className="h-5 w-5 text-blue-600" />
              Earnings & Deductions Summary
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                <p className="text-xs text-emerald-700 font-medium">Reimbursements</p>
                <p className="text-xl font-bold text-emerald-900 tabular-nums mt-1">
                  ₹ {approvedReimbursementsTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
                <p className="text-[11px] text-emerald-700 mt-0.5">
                  {approvedReimbursements.length} item{approvedReimbursements.length === 1 ? '' : 's'} · added to gross
                </p>
              </div>
              <div className="rounded-lg border border-sky-200 bg-sky-50 p-4">
                <p className="text-xs text-sky-700 font-medium">FBP Allocations</p>
                <p className="text-xl font-bold text-sky-900 tabular-nums mt-1">
                  ₹ {(fbpAllocations as any[]).reduce(
                    (sum, a) => sum + (Number(a.allocated_amount ?? a.amount) || 0),
                    0,
                  ).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
                <p className="text-[11px] text-sky-700 mt-0.5">
                  {(fbpAllocations as any[]).length} component{(fbpAllocations as any[]).length === 1 ? '' : 's'} · added to gross
                </p>
              </div>
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-4">
                <p className="text-xs text-rose-700 font-medium">Loan EMI</p>
                <p className="text-xl font-bold text-rose-900 tabular-nums mt-1">
                  ₹ {activeLoans.reduce(
                    (sum, l) => sum + (Number((l as any).emi_amount) || 0),
                    0,
                  ).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
                <p className="text-[11px] text-rose-700 mt-0.5">
                  {activeLoans.length} active loan{activeLoans.length === 1 ? '' : 's'} · deducted from net
                </p>
              </div>
            </div>
          </SurfaceCard>

          {/* Confirmation */}
          <SurfaceCard className={`p-6 ${processPayrollMutation.isSuccess || isAlreadyProcessed ? 'bg-emerald-50 border-emerald-200' : ''}`}>
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
                    {backLabel}
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
            ) : isAlreadyProcessed ? (
              <div className="text-center py-2">
                <CheckCircle2 className="h-12 w-12 mx-auto mb-3 text-emerald-600" />
                <h3 className="text-lg font-semibold text-emerald-900 mb-2">Payroll Already Processed</h3>
                <p className="text-emerald-700 mb-5">
                  Payroll for {monthYear} has already been processed.
                  Net Pay: ₹{Number(existingPayroll?.net_pay ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>

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
                    {backLabel}
                  </Button>
                </div>
                <p className="text-xs text-slate-500 mt-4">
                  View this run from <strong>Recent Payroll Runs</strong> on the dashboard.
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
                  <Button variant="secondary" onClick={() => setCurrentStep(4)}>
                    Back
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => {
                      // Mark step 5 (Loans & Advances) done before
                      // processing. Step 6 (Preview & Process) is
                      // marked done in the mutation onSuccess hook
                      // below since it's the last step. We pass the
                      // next-step index (6) so handleContinue's gated
                      // logic still applies — in standalone mode it
                      // would advance; in matrix mode it stays put
                      // and the matrix drives the next step.
                      handleContinue(6, 6);
                      processPayrollMutation.mutate();
                    }}
                    disabled={processPayrollMutation.isPending || !annualCtc || parseFloat(annualCtc) <= 0}
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
        <Button
          variant="ghost"
          onClick={() => {
            if (currentStep === 0) {
              // Step 1 (Attendance) → exit wizard back
              onBack();
            } else {
              // Any later step → navigate to the previous step within
              // the wizard (steps 1..5 → step - 1)
              setCurrentStep(currentStep - 1);
            }
          }}
          iconLeft={<ArrowLeft className="h-4 w-4" />}
        >
          Back
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{employee.name}</h1>
          <p className="text-sm text-slate-500">
            {employee.designation || employee.role}
          </p>
        </div>
      </div>

      {/* Progress Steps */}
      {!hideStepIndicator && <ProgressSteps steps={WIZARD_STEPS} currentStep={currentStep} />}

      {/* Step Content */}
      <div className="mt-8">
        {currentStep === 0 && renderStep1()}
        {currentStep === 1 && renderStep2()}
        {currentStep === 2 && renderStep2Statutory()}
        {currentStep === 3 && renderStep3Benefits()}
        {currentStep === 4 && renderStep4Loans()}
        {currentStep === 5 && renderStep3()}
      </div>
    </div>
  );
}
