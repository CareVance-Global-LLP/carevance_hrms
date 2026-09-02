import { useState, useEffect, useMemo } from 'react';
import {
  ArrowLeft,
  Loader2,
  Clock,
  DollarSign,
  Calculator,
  Receipt,
  Wallet,
  FileText,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { TableVirtuoso } from 'react-virtuoso';
import { payrollApi } from '@/services/api';
import Button from '@/components/ui/Button';
import { cn } from '@/utils/cn';
import { useToast } from '@/components/ui/Toast';
import { getApiErrorMessage } from '@/services/api';

interface BulkPayrollMatrixProps {
  payGroupId: number;
  monthYear: string;
  onBack: () => void;
  selectedEmployeeIds?: number[];
  onProcessComplete?: () => void;
}

const WIZARD_STEPS = [
  { num: 1, label: 'Leave & Attendance', icon: Clock },
  { num: 2, label: 'Salary Structure', icon: DollarSign },
  { num: 3, label: 'Statutory Compliances', icon: Calculator },
  { num: 4, label: 'Reimbursements & FBP', icon: Receipt },
  { num: 5, label: 'Loans & Advances', icon: Wallet },
  { num: 6, label: 'Preview & Process', icon: FileText },
] as const;

interface MatrixRowData {
  working_days: number;
  present_days: number;
  lop_days: number;
  paid_leave_days: number;
  overtime_hours: number;
  annual_ctc: number;
  basic: number;
  hra: number;
  special_allowance: number;
  conveyance: number;
  other_earnings: number;
  overtime_pay_amount: number;
  other_deduction: number;
  pf_employee: number;
  pf_employer: number;
  esi_employee: number;
  esi_employer: number;
  pt: number;
  tds: number;
  /*
   * The attendance cells a HUMAN has typed into. Nothing else is ever
   * submitted.
   *
   * This used to be a single flag set true whenever the API returned an
   * attendance object, and the whole grid was then echoed back to the server as
   * a per-person statement of the month. But getPayGroupEmployees answers a
   * failed monthlyAttendanceSummary with a hardcoded 26 working / 26 present /
   * 0 LOP, so on that path the wizard took a number the server had invented and
   * re-asserted it — and processEmployeePayroll reads a stated working_days as
   * "the caller is describing this month", pricing 26 full days for somebody
   * whose real August had 22. It also meant every row arrived stated, so the
   * "leave it to the employee's own summary" path could never be taken in
   * production at all.
   *
   * The frontend cannot tell an invented 26 from a real one. What it can vouch
   * for is a keystroke, so that is the only thing it asserts: an untouched row
   * sends no attendance and the server reads that employee's own calendar,
   * which is where a real summary came from in the first place.
   */
  stated: ReadonlySet<AttendanceField>;
  /*
   * Whether the LOP figure on screen is the operator's own or ours.
   *
   * Editing Working Days or Days Present re-derives LOP so the cell that gets
   * submitted is the cell being read; typing into LOP itself stops that, since
   * an operator who states 0 LOP against 5 absent days is describing five paid
   * absences and must not have it overwritten.
   */
  lop_manual: boolean;
}

// The only four cells in the wizard the process endpoint can carry per person.
// Everything else on the salary and statutory steps is computed server-side
// from the employee's template, which is why those columns are read-only.
type AttendanceField = 'working_days' | 'present_days' | 'lop_days' | 'overtime_hours';

function formatMonthLabel(monthYear: string): string {
  const [y, m] = monthYear.split('-').map(Number);
  if (!y || !m) return monthYear;
  return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

function getInitials(name: string): string {
  return name.split(' ').map((n) => n.charAt(0).toUpperCase()).join('').substring(0, 2);
}

function fmt(n: number): string {
  return n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

// Day counts are halves at worst; binary floats turn 26 - 21.5 - 0 into
// 4.499999999999998, which reaches the request body verbatim.
function days(n: number): number {
  return Math.round(n * 100) / 100;
}

function calendarDaysIn(monthYear: string): number {
  const [y, m] = monthYear.split('-').map(Number);
  if (!y || !m) return 30;
  return new Date(y, m, 0).getDate();
}

/*
 * The divisor a month's salary is spread across to value one day of loss of
 * pay — PayrollDayBasisResolver's answer, restated here because the preview
 * has to arrive at the number the run will actually produce.
 *
 * It is NOT the working-day count. Payment of Wages Act s.9(2) caps a
 * deduction for absence at the proportion the absent period bears to the wage
 * period, so a day costs at most 1/30 of wages and never 1/22; EPFO counts NCP
 * days on the calendar too. Anything unrecognised falls back to the calendar
 * exactly as the resolver does, so a stale setting cannot drag the preview onto
 * a divisor payroll will not use.
 */
function resolveDayBasis(basis: string | undefined, monthYear: string): { divisorDays: number; label: string } {
  if (basis === 'fixed_30') return { divisorDays: 30, label: 'a fixed 30-day month' };
  if (basis === 'fixed_26') return { divisorDays: 26, label: 'a fixed 26-day month' };
  const d = calendarDaysIn(monthYear);
  return { divisorDays: d, label: `${d} calendar days` };
}

/*
 * What payroll will deduct for this row's loss of pay.
 *
 * This was `(basic + hra) / working_days * lop_days`, and both halves of it
 * were wrong: the engine prices LOP against the whole monthly gross, not
 * basic+HRA, and divides by the wage period rather than the 26 working days.
 * On the 6,00,000 CTC probed here — a 40/20/35 split plus ₹1,600 conveyance,
 * so ₹49,100 monthly gross across August's 31 days — the run charges ₹1,583.87
 * a day and this screen quoted ₹1,153.85: it understated every absence by 27%,
 * on the one screen whose job is to be agreed with before the money moves.
 *
 * Reimbursements and overtime are outside the base on purpose: the engine
 * takes LOP off the structure gross and adds those afterwards.
 */
function lopDeductionFor(row: MatrixRowData, divisorDays: number): number {
  const structureGross = row.basic + row.hra + row.special_allowance + row.conveyance;
  if (row.lop_days <= 0 || structureGross <= 0 || divisorDays <= 0) return 0;
  return Math.min((structureGross / divisorDays) * row.lop_days, structureGross);
}

export default function BulkPayrollMatrix({
  payGroupId,
  monthYear,
  onBack,
  selectedEmployeeIds,
  onProcessComplete,
}: BulkPayrollMatrixProps) {
  const [currentStep, setCurrentStep] = useState(1);
  const [matrixData, setMatrixData] = useState<Map<number, MatrixRowData>>(new Map());
  const queryClient = useQueryClient();
  const { show } = useToast();

  const { data: employeesData, isLoading: isEmployeesLoading } = useQuery({
    queryKey: ['payroll', 'pay-group', payGroupId, 'employees', monthYear],
    queryFn: () =>
      payrollApi.getPayGroupEmployees(payGroupId, { month_year: monthYear }).then((r) => r.data),
    enabled: payGroupId > 0,
  });

  const allEmployees = employeesData?.employees ?? [];

  const employees = useMemo(() => {
    if (!selectedEmployeeIds || selectedEmployeeIds.length === 0) return allEmployees;
    const idSet = new Set(selectedEmployeeIds);
    return allEmployees.filter((e) => idSet.has(e.id));
  }, [allEmployees, selectedEmployeeIds]);

  const tableMinHeight = useMemo(() => {
    const count = employees.length;
    return Math.max(400, Math.min(count * 25, 1000));
  }, [employees.length]);

  const employeeMap = useMemo(() => {
    const map = new Map<number, any>();
    employees.forEach((e) => map.set(e.id, e));
    return map;
  }, [employees]);

  /*
   * The organisation's loss-of-pay divisor, read from the same setting the
   * engine reads. A preview that picks its own divisor is not a preview of
   * anything; `isError` is kept because a failed read has to be said out loud
   * rather than quietly defaulted (see the note above the review table).
   */
  const { data: dayBasisSetting, isError: dayBasisUnavailable } = useQuery({
    queryKey: ['payroll', 'settings', 'dayBasis'],
    queryFn: async () => {
      const res = await payrollApi.getPayrollSettings();
      const settings = res.data?.settings as unknown as { dayBasis?: string } | undefined;
      return typeof settings?.dayBasis === 'string' ? settings.dayBasis : undefined;
    },
    staleTime: 5 * 60 * 1000,
  });

  const dayBasis = useMemo(
    () => resolveDayBasis(dayBasisSetting, monthYear),
    [dayBasisSetting, monthYear],
  );

  const { data: reimbData } = useQuery({
    queryKey: ['payroll', 'reimbursements', 'bulk', payGroupId, monthYear],
    queryFn: async () => {
      const results: Record<number, { reimbursements: number; fbp_allocated: number; fbp_utilized: number }> = {};
      await Promise.all(
        employees.map(async (emp) => {
          try {
            const [rRes, fbpRes] = await Promise.all([
              payrollApi.getEmployeeReimbursements(emp.id, 'approved', monthYear).catch(() => ({ data: [] })),
              payrollApi.getFbpAllocations(emp.id).catch(() => ({ data: [] })),
            ]);
            const reimb = Array.isArray(rRes.data) ? rRes.data.reduce((s: number, r: any) => s + (Number(r.amount) || 0), 0) : 0;
            const allocs = Array.isArray(fbpRes.data) ? fbpRes.data : [];
            const allocated = allocs.reduce((s: number, a: any) => s + (Number(a.allocated_amount) || 0), 0);
            const utilized = allocs.reduce((s: number, a: any) => s + (Number(a.utilized_amount) || 0), 0);
            results[emp.id] = { reimbursements: reimb, fbp_allocated: allocated, fbp_utilized: utilized };
          } catch {
            results[emp.id] = { reimbursements: 0, fbp_allocated: 0, fbp_utilized: 0 };
          }
        })
      );
      return results;
    },
    enabled: employees.length > 0 && currentStep >= 4,
  });

  const { data: loansData } = useQuery({
    queryKey: ['payroll', 'loans', 'bulk', payGroupId],
    queryFn: async () => {
      const results: Record<number, { name: string; emi: number; outstanding: number }[]> = {};
      await Promise.all(
        employees.map(async (emp) => {
          try {
            const res = await payrollApi.listLoans({ user_id: emp.id, status: 'approved' });
            const loans = (res.data?.loans ?? []).map((l: any) => ({
              name: l.title || l.loan_type || 'Loan',
              emi: Number(l.emi_amount || l.monthly_deduction || 0),
              outstanding: Number(l.outstanding_balance || l.remaining_amount || 0),
            }));
            results[emp.id] = loans;
          } catch {
            results[emp.id] = [];
          }
        })
      );
      return results;
    },
    enabled: employees.length > 0 && currentStep >= 5,
  });

  // Initialize matrix rows ONLY for new employees. Existing rows are
  // left untouched so manual edits to Present / LOP / Paid Leave /
  // Overtime / Salary components survive query refetches (e.g. the
  // completeStepMutation onSuccess invalidates the employees list).
  useEffect(() => {
    if (employees.length === 0) return;
    setMatrixData((prev) => {
      const next = new Map(prev);
      employees.forEach((emp) => {
        if (next.has(emp.id)) return; // preserve existing rows (manual edits)
        const att = emp.attendance;
        const ctc = emp.annual_ctc ?? 0;
        const basic = Math.round(ctc * 0.4 / 12);
        const hra = Math.round(ctc * 0.2 / 12);
        const special = Math.round(ctc * 0.25 / 12);
        const conveyance = 1600;
        const gross = basic + hra + special + conveyance;
        const pf = Math.min(Math.round(basic * 0.12), 1800);
        next.set(emp.id, {
          // Displayed, never asserted. These four are the server's own reading
          // of the month — including, on a failed summary, a fabricated 26/26 —
          // so they seed the grid and go back over the wire only where a human
          // has typed. See `stated`.
          working_days: att?.working_days ?? 0,
          present_days: att?.present_days ?? 0,
          lop_days: att?.lop_days ?? 0,
          paid_leave_days: att?.paid_leave_days ?? 0,
          overtime_hours: att?.overtime_hours ?? 0,
          stated: new Set<AttendanceField>(),
          lop_manual: false,
          annual_ctc: ctc,
          basic,
          hra,
          special_allowance: special,
          conveyance,
          other_earnings: 0,
          overtime_pay_amount: 0,
          other_deduction: 0,
          pf_employee: pf,
          pf_employer: pf,
          esi_employee: gross <= 21000 ? Math.round(gross * 0.0075) : 0,
          esi_employer: gross <= 21000 ? Math.round(gross * 0.0325) : 0,
          pt: 0,
          tds: 0,
        });
      });
      return next;
    });
  }, [employees]);

  useEffect(() => {
    if (employees.length === 0) return;
    payrollApi.listDepartmentTemplates().then(({ data }) => {
      const tmpl = data?.templates?.[0];
      if (!tmpl) return;
      const bPct = (tmpl.basic_pct ?? 40) / 100;
      const hPct = (tmpl.hra_pct ?? 20) / 100;
      const sPct = (tmpl.special_pct ?? 35) / 100;
      setMatrixData((prev) => {
        const next = new Map(prev);
        employees.forEach((emp) => {
          const row = next.get(emp.id);
          if (!row) return;
          const ctc = row.annual_ctc;
          const monthly = ctc / 12;
          const basic = Math.round(monthly * bPct);
          const hra = Math.round(monthly * hPct);
          const special = Math.round(monthly * sPct);
          const gross = basic + hra + special + row.conveyance;
          const pf = Math.round(basic * 0.12);
          next.set(emp.id, {
            ...row,
            basic,
            hra,
            special_allowance: special,
            pf_employee: pf,
            pf_employer: pf,
            esi_employee: gross <= 21000 ? Math.round(gross * 0.0075) : 0,
            esi_employer: gross <= 21000 ? Math.round(gross * 0.0325) : 0,
          });
        });
        return next;
      });
    }).catch(() => {});
  }, [employees]);

  /*
   * Only the four attendance fields are editable, because only those four have
   * somewhere to go. This used to accept any key on the row, including CTC,
   * basic, HRA, PF, ESI, PT and TDS — none of which the process endpoint
   * carries, so every one of those keystrokes was thrown away on submit while
   * the grid went on displaying the operator's figure as though it had been
   * accepted. Narrowing the type is what stops a column being made editable
   * again without a field on the request to put it in.
   */
  const updateCell = (empId: number, field: AttendanceField, value: string) => {
    const num = days(parseFloat(value) || 0);
    setMatrixData((prev) => {
      const row = prev.get(empId);
      if (!row) return prev;
      const stated = new Set(row.stated);
      stated.add(field);
      const updated: MatrixRowData = {
        ...row,
        [field]: num,
        stated,
        lop_manual: row.lop_manual || field === 'lop_days',
      };
      /*
       * A typed Days Present has to move the LOP cell, or it moves nothing at
       * all. The grid submitted lOP_days on every row including a zero, and an
       * explicit zero beats the server's own days_present → LOP derivation — so
       * 21 present out of 26 paid a FULL month while Days Absent on the same
       * row read 5. An operator who has overridden LOP by hand keeps it: 5
       * absences with 0 LOP is a real statement about paid absence.
       */
      if (!updated.lop_manual && (field === 'working_days' || field === 'present_days')) {
        updated.lop_days = days(
          Math.max(0, updated.working_days - updated.present_days - updated.paid_leave_days),
        );
      }
      const next = new Map(prev);
      next.set(empId, updated);
      return next;
    });
  };

  /*
   * Which fields of a row are the operator's statement of the month.
   *
   * Working Days, Days Present and LOP are one statement and are submitted
   * together: LOP is derived from the pair above, and sending it beside a
   * days_present the server took from somewhere else is the contradiction that
   * deducted ₹81,464 from a ₹96,275 gross and paid the employee ₹3,762. LOP on
   * its own is complete — it is priced against the wage period, not against
   * working days — and overtime answers to nothing else.
   */
  const statedFieldsFor = (row: MatrixRowData): ReadonlySet<AttendanceField> => {
    if (!row.stated.has('working_days') && !row.stated.has('present_days')) return row.stated;
    const all = new Set(row.stated);
    all.add('working_days');
    all.add('present_days');
    all.add('lop_days');
    return all;
  };

  const completeStepMutation = useMutation({
    mutationFn: (step: number) => {
      const userIds = employees.map((e) => e.id);
      return payrollApi.completeStep(payGroupId, { step, user_ids: userIds, month_year: monthYear });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll', 'pay-group', payGroupId, 'employees', monthYear] });
    },
    onError: (err: unknown) => {
      show({ kind: 'error', message: getApiErrorMessage(err, 'Failed to save step.') });
    },
  });

  const [processResult, setProcessResult] = useState<{
    succeeded: Array<{ user_id: number; payroll_item_id: number | null }>;
    failed: Array<{ user_id: number; reason: string }>;
  } | null>(null);

  /*
   * Each row an operator has stated is submitted as that person's own month,
   * and nothing is submitted for the rest.
   *
   * This used to send the FIRST row's working days and the group MEAN loss of
   * pay as two flat numbers, which the endpoint then wrote to everybody
   * identically. In a 20-person group where one person took 5 unpaid days,
   * every one of the 20 payroll items was written with lOP_days 0.25: on a
   * 6,00,000 CTC (50,000 monthly gross, 30-day divisor) that is 416.67 deducted
   * from each of the 19 people who were present and 7,916.67 handed to the
   * absentee, whose 5 real days were worth 8,333.33. Every row returned
   * success and nothing was logged, so the only way to find it was two
   * employees comparing payslips.
   *
   * Three rules keep the payload honest:
   *
   *  - Built from `employees`, never from matrixData's keys. Rows survive a
   *    narrowing of the selection (the init effect only ever adds), and the
   *    endpoint refuses — 422, whole batch — an employees[] entry naming
   *    somebody outside user_ids.
   *  - Only cells a human typed are submitted, and a row nobody touched is
   *    OMITTED. The server then reads that employee's own summary — which is
   *    where the figures in the grid came from anyway, except on the path where
   *    the summary threw and getPayGroupEmployees answered with a hardcoded
   *    26/26. Echoing the whole grid back re-asserted that invention as the
   *    operator's own, and left the omit path unreachable in production.
   *  - A field nobody stated is left off the row entirely rather than sent as
   *    zero. A zero days_present is a claim that somebody worked no days.
   */
  const processMutation = useMutation({
    mutationFn: () => {
      const userIds = employees.map((e) => e.id);
      const perEmployee = userIds.flatMap((userId) => {
        const row = matrixData.get(userId);
        if (!row) return [];
        const stated = statedFieldsFor(row);
        if (stated.size === 0) return [];
        return [{
          user_id: userId,
          // min:1 server-side, so an unknown calendar goes unstated and the
          // employee's own summary answers for it.
          ...(stated.has('working_days') && row.working_days > 0 ? { working_days: row.working_days } : {}),
          ...(stated.has('present_days') ? { days_present: row.present_days } : {}),
          ...(stated.has('lop_days') ? { lOP_days: row.lop_days } : {}),
          ...(stated.has('overtime_hours') ? { overtime_hours: row.overtime_hours } : {}),
        }];
      });
      return payrollApi.processPayGroupSelectedEmployees(payGroupId, {
        month_year: monthYear,
        user_ids: userIds,
        // No flat working_days / lOP_days fallback. A group-wide default is
        // exactly what produced the averaged figures above, and anyone this
        // list leaves out is meant to fall through to their own attendance.
        ...(perEmployee.length > 0 ? { employees: perEmployee } : {}),
      });
    },
    onSuccess: (res) => {
      const data = res.data;
      setProcessResult({ succeeded: data.succeeded ?? [], failed: data.failed ?? [] });
      queryClient.invalidateQueries({ queryKey: ['payroll'] });
      show({
        kind: data.failed?.length > 0 ? 'warning' : 'success',
        message: `${data.succeeded?.length ?? 0} processed, ${data.failed?.length ?? 0} failed`,
      });
      if (data.succeeded?.length > 0) onProcessComplete?.();
    },
    onError: (err: any) => {
      show({ kind: 'error', message: getApiErrorMessage(err, 'Failed to process payroll.') });
    },
  });

  const handleSaveAndNext = async () => {
    if (currentStep === 6) {
      await completeStepMutation.mutateAsync(6);
      processMutation.mutate();
    } else {
      completeStepMutation.mutate(currentStep);
      if (currentStep < 6) setCurrentStep(currentStep + 1);
    }
  };

  // The ₹ prefix went with the money columns. It was on every cell, including
  // Working Days and Overtime Hrs, which read "₹26" and "₹0" for a day count.
  const renderDayInput = (empId: number, field: AttendanceField, value: number, label: string) => (
    <td key={`${empId}-${field}`} className="px-2 py-1.5">
      <input
        type="number"
        aria-label={label}
        value={value || ''}
        onChange={(e) => updateCell(empId, field, e.target.value)}
        className={cn(
          'w-full px-2 py-1.5 text-sm text-right border border-slate-200 rounded-md bg-white',
          'focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 outline-none transition-colors',
          '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none'
        )}
      />
    </td>
  );

  /*
   * A figure the wizard can show but cannot submit is rendered as text, not as
   * a disabled-looking input. Every one of these was an editable box whose
   * contents were dropped on submit — an operator who corrected a PF figure
   * believed the correction had been made, and the payslip disagreed with the
   * screen they approved it on. Read-only is the honest half of the fix; the
   * step note above each table says where the number actually comes from.
   */
  const renderDerived = (key: string, value: number, opts?: { currency?: boolean; tone?: string }) => (
    <td key={key} className={cn('px-2 py-2 text-right text-sm tabular-nums text-slate-600', opts?.tone)}>
      {opts?.currency ? `₹${fmt(value)}` : fmt(value)}
    </td>
  );

  // Sits above a step's table and names what on it is not the operator's to
  // set. A read-only column with no explanation reads as a broken input.
  const stepNote = (text: string) => (
    <p className="px-6 py-2 text-xs text-slate-500 bg-slate-50 border-b border-slate-200">{text}</p>
  );

  const renderEmployeeCell = (emp: any) => (
    <>
      <td className="px-3 py-2 text-sm text-slate-500 tabular-nums whitespace-nowrap">{emp.employee_code || `#${emp.id}`}</td>
      <td className="px-4 py-2">
        <div className="flex items-center gap-2.5">
          <div className="h-7 w-7 rounded-full bg-slate-200 flex items-center justify-center text-[10px] font-semibold text-slate-600 flex-shrink-0">
            {getInitials(emp.name)}
          </div>
          <span className="font-medium text-slate-900 text-sm truncate">{emp.name}</span>
        </div>
      </td>
      <td className="px-4 py-2 text-slate-500 text-sm truncate">{emp.department || emp.designation || ''}</td>
    </>
  );

  const rows = useMemo(() => Array.from(matrixData.values()), [matrixData]);
  const rowEntries = useMemo(() => Array.from(matrixData.entries()), [matrixData]);

  const renderAttendanceStep = () => {
    const totals = rows.reduce(
      (acc, r) => ({
        working: acc.working + r.working_days,
        present: acc.present + r.present_days,
        lop: acc.lop + r.lop_days,
        paidLeave: acc.paidLeave + r.paid_leave_days,
        overtime: acc.overtime + r.overtime_hours,
      }),
      { working: 0, present: 0, lop: 0, paidLeave: 0, overtime: 0 }
    );
    return (
      <TableVirtuoso
        style={{ height: '100%', minHeight: tableMinHeight }}
        totalCount={rowEntries.length}
        fixedHeaderContent={() => (
          <tr className="bg-slate-50 border-b border-slate-200">
            <th className="px-3 py-3 text-left font-semibold text-slate-700 min-w-[80px]">Emp ID</th>
            <th className="px-4 py-3 text-left font-semibold text-slate-700 min-w-[180px]">Employee</th>
            <th className="px-4 py-3 text-left font-semibold text-slate-700 min-w-[120px]">Dept</th>
            <th className="px-3 py-3 text-right font-semibold text-slate-700 min-w-[100px]">Working Days</th>
            <th className="px-3 py-3 text-right font-semibold text-slate-700 min-w-[100px]">Present</th>
            <th className="px-3 py-3 text-right font-semibold text-slate-700 min-w-[80px]">LOP</th>
            <th className="px-3 py-3 text-right font-semibold text-slate-700 min-w-[100px]">Paid Leave</th>
            <th className="px-3 py-3 text-right font-semibold text-slate-700 min-w-[100px]">Overtime Hrs</th>
            <th className="px-3 py-3 text-right font-semibold text-slate-700 min-w-[100px]">Days Absent</th>
          </tr>
        )}
        fixedFooterContent={() => (
          <tr className="bg-slate-50 border-t-2 border-slate-200 font-semibold">
            <td className="px-3 py-3 text-sm text-slate-700"></td>
            <td className="px-4 py-3 text-left text-sm text-slate-700">Total ({employees.length})</td>
            <td></td>
            <td className="px-3 py-3 text-right text-sm text-slate-700">{totals.working}</td>
            <td className="px-3 py-3 text-right text-sm text-slate-700">{totals.present}</td>
            <td className="px-3 py-3 text-right text-sm text-slate-700">{totals.lop}</td>
            <td className="px-3 py-3 text-right text-sm text-slate-700">{totals.paidLeave}</td>
            <td className="px-3 py-3 text-right text-sm text-slate-700">{totals.overtime}</td>
            <td className="px-3 py-3 text-right text-sm text-red-600">
              {Math.max(0, totals.working - totals.present - totals.paidLeave)}
            </td>
          </tr>
        )}
        itemContent={(index) => {
          const [empId, row] = rowEntries[index];
          const emp = employeeMap.get(empId);
          if (!emp) return null;
          const absent = Math.max(0, row.working_days - row.present_days - row.paid_leave_days);
          return (
            <>
              {renderEmployeeCell(emp)}
              {renderDayInput(empId, 'working_days', row.working_days, `Working days for ${emp.name}`)}
              {renderDayInput(empId, 'present_days', row.present_days, `Days present for ${emp.name}`)}
              {renderDayInput(empId, 'lop_days', row.lop_days, `Loss of pay days for ${emp.name}`)}
              {/* Paid leave is the leave ledger's answer and the process
                  endpoint has no field for it, so it is shown, not offered. */}
              {renderDerived(`${empId}-paid_leave_days`, row.paid_leave_days)}
              {renderDayInput(empId, 'overtime_hours', row.overtime_hours, `Overtime hours for ${emp.name}`)}
              <td className="px-3 py-2 text-right font-semibold text-red-600 text-sm tabular-nums">{absent}</td>
            </>
          );
        }}
      />
    );
  };

  const renderSalaryStep = () => {
    const totals = rows.reduce(
      (acc, r) => ({
        ctc: acc.ctc + r.annual_ctc,
        basic: acc.basic + r.basic,
        hra: acc.hra + r.hra,
        special: acc.special + r.special_allowance,
        conveyance: acc.conveyance + r.conveyance,
        other: acc.other + r.other_earnings,
        otPay: acc.otPay + r.overtime_pay_amount,
        otherDed: acc.otherDed + r.other_deduction,
      }),
      { ctc: 0, basic: 0, hra: 0, special: 0, conveyance: 0, other: 0, otPay: 0, otherDed: 0 }
    );
    return (
      <TableVirtuoso
        style={{ height: '100%', minHeight: tableMinHeight }}
        totalCount={rowEntries.length}
        fixedHeaderContent={() => (
          <tr className="bg-slate-50 border-b border-slate-200">
            <th className="px-3 py-3 text-left font-semibold text-slate-700 min-w-[80px]">Emp ID</th>
            <th className="px-4 py-3 text-left font-semibold text-slate-700 min-w-[180px]">Employee</th>
            <th className="px-4 py-3 text-left font-semibold text-slate-700 min-w-[120px]">Dept</th>
            <th className="px-3 py-3 text-right font-semibold text-slate-700 min-w-[110px]">Annual CTC</th>
            <th className="px-3 py-3 text-right font-semibold text-slate-700 min-w-[100px]">Basic</th>
            <th className="px-3 py-3 text-right font-semibold text-slate-700 min-w-[100px]">HRA</th>
            <th className="px-3 py-3 text-right font-semibold text-slate-700 min-w-[110px]">Special Allow.</th>
            <th className="px-3 py-3 text-right font-semibold text-slate-700 min-w-[100px]">Conveyance</th>
            <th className="px-3 py-3 text-right font-semibold text-slate-700 min-w-[100px]">Other Earnings</th>
            <th className="px-3 py-3 text-right font-semibold text-slate-700 min-w-[100px]">Overtime Pay</th>
            <th className="px-3 py-3 text-right font-semibold text-slate-700 min-w-[100px]">Other Deduction</th>
          </tr>
        )}
        fixedFooterContent={() => (
          <tr className="bg-slate-50 border-t-2 border-slate-200 font-semibold">
            <td className="px-3 py-3 text-sm text-slate-700"></td>
            <td className="px-4 py-3 text-left text-sm text-slate-700">Total ({employees.length})</td>
            <td></td>
            <td className="px-3 py-3 text-right text-sm text-slate-700">₹{fmt(totals.ctc)}</td>
            <td className="px-3 py-3 text-right text-sm text-slate-700">₹{fmt(totals.basic)}</td>
            <td className="px-3 py-3 text-right text-sm text-slate-700">₹{fmt(totals.hra)}</td>
            <td className="px-3 py-3 text-right text-sm text-slate-700">₹{fmt(totals.special)}</td>
            <td className="px-3 py-3 text-right text-sm text-slate-700">₹{fmt(totals.conveyance)}</td>
            <td className="px-3 py-3 text-right text-sm text-slate-700">₹{fmt(totals.other)}</td>
            <td className="px-3 py-3 text-right text-sm text-slate-700">₹{fmt(totals.otPay)}</td>
            <td className="px-3 py-3 text-right text-sm text-red-600">₹{fmt(totals.otherDed)}</td>
          </tr>
        )}
        itemContent={(index) => {
          const [empId, row] = rowEntries[index];
          const emp = employeeMap.get(empId);
          if (!emp) return null;
          return (
            <>
              {renderEmployeeCell(emp)}
              {renderDerived(`${empId}-annual_ctc`, row.annual_ctc, { currency: true })}
              {renderDerived(`${empId}-basic`, row.basic, { currency: true })}
              {renderDerived(`${empId}-hra`, row.hra, { currency: true })}
              {renderDerived(`${empId}-special_allowance`, row.special_allowance, { currency: true })}
              {renderDerived(`${empId}-conveyance`, row.conveyance, { currency: true })}
              {renderDerived(`${empId}-other_earnings`, row.other_earnings, { currency: true })}
              {renderDerived(`${empId}-overtime_pay_amount`, row.overtime_pay_amount, { currency: true })}
              {renderDerived(`${empId}-other_deduction`, row.other_deduction, { currency: true, tone: 'text-red-600' })}
            </>
          );
        }}
      />
    );
  };

  const renderStatutoryStep = () => {
    const totals = rows.reduce(
      (acc, r) => ({
        pfE: acc.pfE + r.pf_employee,
        pfEr: acc.pfEr + r.pf_employer,
        esiE: acc.esiE + r.esi_employee,
        esiEr: acc.esiEr + r.esi_employer,
        pt: acc.pt + r.pt,
        tds: acc.tds + r.tds,
      }),
      { pfE: 0, pfEr: 0, esiE: 0, esiEr: 0, pt: 0, tds: 0 }
    );
    return (
      <TableVirtuoso
        style={{ height: '100%', minHeight: tableMinHeight }}
        totalCount={rowEntries.length}
        fixedHeaderContent={() => (
          <tr className="bg-slate-50 border-b border-slate-200">
            <th className="px-3 py-3 text-left font-semibold text-slate-700 min-w-[80px]">Emp ID</th>
            <th className="px-4 py-3 text-left font-semibold text-slate-700 min-w-[180px]">Employee</th>
            <th className="px-4 py-3 text-left font-semibold text-slate-700 min-w-[120px]">Dept</th>
            <th className="px-3 py-3 text-right font-semibold text-slate-700 min-w-[100px]">PF (Emp)</th>
            <th className="px-3 py-3 text-right font-semibold text-slate-700 min-w-[100px]">PF (Er)</th>
            <th className="px-3 py-3 text-right font-semibold text-slate-700 min-w-[100px]">ESI (Emp)</th>
            <th className="px-3 py-3 text-right font-semibold text-slate-700 min-w-[100px]">ESI (Er)</th>
            <th className="px-3 py-3 text-right font-semibold text-slate-700 min-w-[80px]">PT</th>
            <th className="px-3 py-3 text-right font-semibold text-slate-700 min-w-[100px]">TDS</th>
          </tr>
        )}
        fixedFooterContent={() => (
          <tr className="bg-slate-50 border-t-2 border-slate-200 font-semibold">
            <td className="px-3 py-3 text-sm text-slate-700"></td>
            <td className="px-4 py-3 text-left text-sm text-slate-700">Total ({employees.length})</td>
            <td></td>
            <td className="px-3 py-3 text-right text-sm text-slate-700">₹{fmt(totals.pfE)}</td>
            <td className="px-3 py-3 text-right text-sm text-slate-700">₹{fmt(totals.pfEr)}</td>
            <td className="px-3 py-3 text-right text-sm text-slate-700">₹{fmt(totals.esiE)}</td>
            <td className="px-3 py-3 text-right text-sm text-slate-700">₹{fmt(totals.esiEr)}</td>
            <td className="px-3 py-3 text-right text-sm text-slate-700">₹{fmt(totals.pt)}</td>
            <td className="px-3 py-3 text-right text-sm text-slate-700">₹{fmt(totals.tds)}</td>
          </tr>
        )}
        itemContent={(index) => {
          const [empId, row] = rowEntries[index];
          const emp = employeeMap.get(empId);
          if (!emp) return null;
          return (
            <>
              {renderEmployeeCell(emp)}
              {renderDerived(`${empId}-pf_employee`, row.pf_employee, { currency: true })}
              {renderDerived(`${empId}-pf_employer`, row.pf_employer, { currency: true })}
              {renderDerived(`${empId}-esi_employee`, row.esi_employee, { currency: true })}
              {renderDerived(`${empId}-esi_employer`, row.esi_employer, { currency: true })}
              {renderDerived(`${empId}-pt`, row.pt, { currency: true })}
              {renderDerived(`${empId}-tds`, row.tds, { currency: true })}
            </>
          );
        }}
      />
    );
  };

  const renderBenefitsStep = () => {
    const reimbTotals = { reimb: 0, allocated: 0, utilized: 0 };
    rowEntries.forEach(([empId]) => {
      const d = reimbData?.[empId];
      if (d) {
        reimbTotals.reimb += d.reimbursements;
        reimbTotals.allocated += d.fbp_allocated;
        reimbTotals.utilized += d.fbp_utilized;
      }
    });
    return (
      <TableVirtuoso
        style={{ height: '100%', minHeight: tableMinHeight }}
        totalCount={rowEntries.length}
        fixedHeaderContent={() => (
          <tr className="bg-slate-50 border-b border-slate-200">
            <th className="px-3 py-3 text-left font-semibold text-slate-700 min-w-[80px]">Emp ID</th>
            <th className="px-4 py-3 text-left font-semibold text-slate-700 min-w-[180px]">Employee</th>
            <th className="px-4 py-3 text-left font-semibold text-slate-700 min-w-[120px]">Dept</th>
            <th className="px-3 py-3 text-right font-semibold text-slate-700 min-w-[130px]">Reimbursements</th>
            <th className="px-3 py-3 text-right font-semibold text-slate-700 min-w-[130px]">FBP Allocated</th>
            <th className="px-3 py-3 text-right font-semibold text-slate-700 min-w-[130px]">FBP Utilized</th>
          </tr>
        )}
        fixedFooterContent={() => (
          <tr className="bg-slate-50 border-t-2 border-slate-200 font-semibold">
            <td className="px-3 py-3 text-sm text-slate-700"></td>
            <td className="px-4 py-3 text-left text-sm text-slate-700">Total ({employees.length})</td>
            <td></td>
            <td className="px-3 py-3 text-right text-sm text-slate-700">₹{fmt(reimbTotals.reimb)}</td>
            <td className="px-3 py-3 text-right text-sm text-slate-700">₹{fmt(reimbTotals.allocated)}</td>
            <td className="px-3 py-3 text-right text-sm text-slate-700">₹{fmt(reimbTotals.utilized)}</td>
          </tr>
        )}
        itemContent={(index) => {
          const [empId] = rowEntries[index];
          const emp = employeeMap.get(empId);
          if (!emp) return null;
          const d = reimbData?.[emp.id];
          return (
            <>
              {renderEmployeeCell(emp)}
              <td className="px-3 py-2 text-right text-sm text-slate-700 tabular-nums">₹{fmt(d?.reimbursements ?? 0)}</td>
              <td className="px-3 py-2 text-right text-sm text-slate-700 tabular-nums">₹{fmt(d?.fbp_allocated ?? 0)}</td>
              <td className="px-3 py-2 text-right text-sm text-slate-700 tabular-nums">₹{fmt(d?.fbp_utilized ?? 0)}</td>
            </>
          );
        }}
      />
    );
  };

  const loanRowEntries = useMemo(() => {
    const entries: Array<{ empId: number; isFirst: boolean; loan: any }> = [];
    employees.forEach((emp) => {
      const loans = loansData?.[emp.id] ?? [];
      if (loans.length === 0) {
        entries.push({ empId: emp.id, isFirst: true, loan: null });
      } else {
        loans.forEach((loan: any, li: number) => {
          entries.push({ empId: emp.id, isFirst: li === 0, loan });
        });
      }
    });
    return entries;
  }, [employees, loansData]);

  const renderLoansStep = () => {
    let totalEmi = 0;
    let totalOutstanding = 0;
    loanRowEntries.forEach((e) => {
      if (e.loan) {
        totalEmi += e.loan.emi;
        totalOutstanding += e.loan.outstanding;
      }
    });
    return (
      <TableVirtuoso
        style={{ height: '100%', minHeight: tableMinHeight }}
        totalCount={loanRowEntries.length}
        fixedHeaderContent={() => (
          <tr className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
            <th className="px-3 py-3 text-left font-semibold text-slate-700 min-w-[80px]">Emp ID</th>
            <th className="px-4 py-3 text-left font-semibold text-slate-700 min-w-[180px]">Employee</th>
            <th className="px-4 py-3 text-left font-semibold text-slate-700 min-w-[120px]">Dept</th>
            <th className="px-3 py-3 text-left font-semibold text-slate-700 min-w-[150px]">Loan Name</th>
            <th className="px-3 py-3 text-right font-semibold text-slate-700 min-w-[100px]">EMI Amount</th>
            <th className="px-3 py-3 text-right font-semibold text-slate-700 min-w-[120px]">Outstanding</th>
          </tr>
        )}
        fixedFooterContent={() => (
          <tr className="bg-slate-50 border-t-2 border-slate-200 font-semibold sticky bottom-0">
            <td className="px-3 py-3 text-sm text-slate-700"></td>
            <td className="px-4 py-3 text-left text-sm text-slate-700">Total ({employees.length})</td>
            <td></td>
            <td></td>
            <td className="px-3 py-3 text-right text-sm text-slate-700">₹{fmt(totalEmi)}</td>
            <td className="px-3 py-3 text-right text-sm text-slate-700">₹{fmt(totalOutstanding)}</td>
          </tr>
        )}
        itemContent={(index) => {
          const { empId, isFirst, loan } = loanRowEntries[index];
          const emp = employeeMap.get(empId);
          if (!emp) return null;
          if (!loan) {
            return (
              <>
                {renderEmployeeCell(emp)}
                <td className="px-3 py-2 text-sm text-slate-500 italic">No active loans</td>
                <td className="px-3 py-2 text-right text-sm text-slate-500">—</td>
                <td className="px-3 py-2 text-right text-sm text-slate-500">—</td>
              </>
            );
          }
          return (
            <>
              {isFirst ? renderEmployeeCell(emp) : <td colSpan={3}></td>}
              <td className="px-3 py-2 text-sm text-slate-700">{loan.name}</td>
              <td className="px-3 py-2 text-right text-sm text-slate-700 tabular-nums">₹{fmt(loan.emi)}</td>
              <td className="px-3 py-2 text-right text-sm text-slate-700 tabular-nums">₹{fmt(loan.outstanding)}</td>
            </>
          );
        }}
      />
    );
  };

  const renderReviewStep = () => {
    let totalGross = 0;
    let totalDeductions = 0;
    let totalEmployer = 0;
    let totalReimb = 0;
    let totalLoans = 0;
    let totalNet = 0;
    let totalOtPay = 0;
    let totalLopDed = 0;
    let totalOtherDed = 0;

    const perEmp = rowEntries.map(([empId, row]) => {
      const emp = employees.find((e) => e.id === empId);
      const lopDeduction = lopDeductionFor(row, dayBasis.divisorDays);
      const reimb = reimbData?.[empId]?.reimbursements ?? 0;
      const loans = (loansData?.[empId] ?? []).reduce((s, l) => s + l.emi, 0);
      const gross = row.basic + row.hra + row.special_allowance + row.conveyance
        + row.other_earnings + row.overtime_pay_amount + reimb;
      const deductions = row.pf_employee + row.esi_employee + row.pt + row.tds
        + row.other_deduction + lopDeduction + loans;
      const employer = row.pf_employer + row.esi_employer;
      const netPay = gross - deductions;
      totalGross += gross;
      totalDeductions += deductions;
      totalEmployer += employer;
      totalReimb += reimb;
      totalLoans += loans;
      totalNet += netPay;
      totalOtPay += row.overtime_pay_amount;
      totalLopDed += lopDeduction;
      totalOtherDed += row.other_deduction;
      return { emp, row, gross, deductions, employer, reimb, loans, netPay, lopDeduction };
    });

    const summaryCards = [
      { label: 'Total Earnings', value: totalGross, color: 'text-slate-900', bg: 'bg-blue-50 border-blue-200' },
      { label: 'Total Deductions', value: totalDeductions, color: 'text-red-600', bg: 'bg-red-50 border-red-200' },
      { label: 'Employer Cost', value: totalEmployer, color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200' },
      { label: 'Reimbursements', value: totalReimb, color: 'text-purple-600', bg: 'bg-purple-50 border-purple-200' },
      { label: 'Net Pay', value: totalNet, color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200' },
    ];

    return (
      <div className="space-y-5">
        {/*
          The divisor is named because it is the figure people dispute, and
          because this screen previously priced a day at basic+HRA over working
          days while the run priced it at gross over the wage period. A failed
          settings read says so rather than passing the statutory default off as
          this organisation's answer.
        */}
        <p className="text-xs text-slate-500">
          {dayBasisUnavailable
            ? `Loss of pay is priced at monthly gross ÷ ${dayBasis.divisorDays} (${dayBasis.label}). This organisation's day basis could not be read, so the statutory default is shown — payroll may use a different one.`
            : `Loss of pay is priced at monthly gross ÷ ${dayBasis.divisorDays} (${dayBasis.label}), the divisor payroll runs on. Earnings and statutory figures are estimated from the organisation template; each employee's own salary structure decides them at run time.`}
        </p>

        {/* Summary Cards */}
        <div className="grid grid-cols-5 gap-3">
          {summaryCards.map((c) => (
            <div key={c.label} className={`rounded-lg border p-4 ${c.bg}`}>
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{c.label}</p>
              <p className={`text-xl font-bold mt-1 tabular-nums ${c.color}`}>₹{fmt(c.value)}</p>
              <p className="text-xs text-slate-500 mt-0.5">{employees.length} employees</p>
            </div>
          ))}
        </div>

        {/* Full Breakdown Table */}
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-200">
                  <th className="px-3 py-2 text-left font-semibold text-slate-600 text-xs uppercase tracking-wide" colSpan={3}>Employee</th>
                  <th className="px-2 py-2 text-center font-semibold text-slate-600 text-xs uppercase tracking-wide border-l border-slate-200" colSpan={3}>Attendance</th>
                  <th className="px-2 py-2 text-center font-semibold text-slate-600 text-xs uppercase tracking-wide border-l border-slate-200" colSpan={7}>Earnings</th>
                  <th className="px-2 py-2 text-center font-semibold text-slate-600 text-xs uppercase tracking-wide border-l border-slate-200" colSpan={7}>Deductions</th>
                  <th className="px-2 py-2 text-center font-semibold text-slate-600 text-xs uppercase tracking-wide border-l border-slate-200" colSpan={2}>Computed</th>
                </tr>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-3 py-2.5 text-left font-semibold text-slate-700 min-w-[80px]">Emp ID</th>
                  <th className="px-3 py-2.5 text-left font-semibold text-slate-700 min-w-[160px]">Name</th>
                  <th className="px-3 py-2.5 text-left font-semibold text-slate-700 min-w-[100px]">Dept</th>
                  <th className="px-2 py-2.5 text-right font-semibold text-slate-700 min-w-[70px] border-l border-slate-200">Work</th>
                  <th className="px-2 py-2.5 text-right font-semibold text-slate-700 min-w-[70px]">Present</th>
                  <th className="px-2 py-2.5 text-right font-semibold text-slate-700 min-w-[60px]">LOP</th>
                  <th className="px-2 py-2.5 text-right font-semibold text-slate-700 min-w-[80px] border-l border-slate-200">Basic</th>
                  <th className="px-2 py-2.5 text-right font-semibold text-slate-700 min-w-[80px]">HRA</th>
                  <th className="px-2 py-2.5 text-right font-semibold text-slate-700 min-w-[80px]">Special</th>
                  <th className="px-2 py-2.5 text-right font-semibold text-slate-700 min-w-[80px]">Conv.</th>
                  <th className="px-2 py-2.5 text-right font-semibold text-slate-700 min-w-[80px]">Other Earn.</th>
                  <th className="px-2 py-2.5 text-right font-semibold text-slate-700 min-w-[80px]">OT Pay</th>
                  <th className="px-2 py-2.5 text-right font-semibold text-slate-700 min-w-[80px]">Reimb.</th>
                  <th className="px-2 py-2.5 text-right font-semibold text-slate-700 min-w-[70px] border-l border-slate-200">PF(E)</th>
                  <th className="px-2 py-2.5 text-right font-semibold text-slate-700 min-w-[70px]">ESI(E)</th>
                  <th className="px-2 py-2.5 text-right font-semibold text-slate-700 min-w-[60px]">PT</th>
                  <th className="px-2 py-2.5 text-right font-semibold text-slate-700 min-w-[80px]">TDS</th>
                  <th className="px-2 py-2.5 text-right font-semibold text-slate-700 min-w-[80px]">Other Ded.</th>
                  <th className="px-2 py-2.5 text-right font-semibold text-slate-700 min-w-[80px]">LOP Ded.</th>
                  <th className="px-2 py-2.5 text-right font-semibold text-slate-700 min-w-[80px] border-l border-slate-200">Loan EMI</th>
                  <th className="px-2 py-2.5 text-right font-semibold text-slate-700 min-w-[100px] border-l border-slate-200">Gross</th>
                  <th className="px-2 py-2.5 text-right font-semibold text-slate-700 min-w-[100px]">Net Pay</th>
                </tr>
              </thead>
              <tbody>
                {perEmp.map(({ emp, row, gross, deductions, employer, reimb, loans, netPay, lopDeduction }) => {
                  if (!emp) return null;
                  return (
                    <tr key={emp.id} className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors">
                      <td className="px-3 py-2.5 text-sm text-slate-500 tabular-nums whitespace-nowrap">{emp.employee_code || `#${emp.id}`}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="h-7 w-7 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
                            {getInitials(emp.name)}
                          </div>
                          <span className="text-sm font-medium text-slate-900 truncate">{emp.name}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-sm text-slate-600">{emp.department || '—'}</td>
                      <td className="px-2 py-2.5 text-right text-sm tabular-nums border-l border-slate-200">{row.working_days}</td>
                      <td className="px-2 py-2.5 text-right text-sm tabular-nums">{row.present_days}</td>
                      <td className="px-2 py-2.5 text-right text-sm tabular-nums text-red-600">{row.lop_days}</td>
                      <td className="px-2 py-2.5 text-right text-sm tabular-nums border-l border-slate-200">₹{fmt(row.basic)}</td>
                      <td className="px-2 py-2.5 text-right text-sm tabular-nums">₹{fmt(row.hra)}</td>
                      <td className="px-2 py-2.5 text-right text-sm tabular-nums">₹{fmt(row.special_allowance)}</td>
                      <td className="px-2 py-2.5 text-right text-sm tabular-nums">₹{fmt(row.conveyance)}</td>
                      <td className="px-2 py-2.5 text-right text-sm tabular-nums">₹{fmt(row.other_earnings)}</td>
                      <td className="px-2 py-2.5 text-right text-sm tabular-nums text-emerald-600">₹{fmt(row.overtime_pay_amount)}</td>
                      <td className="px-2 py-2.5 text-right text-sm tabular-nums text-purple-600">₹{fmt(reimb)}</td>
                      <td className="px-2 py-2.5 text-right text-sm tabular-nums border-l border-slate-200">₹{fmt(row.pf_employee)}</td>
                      <td className="px-2 py-2.5 text-right text-sm tabular-nums">₹{fmt(row.esi_employee)}</td>
                      <td className="px-2 py-2.5 text-right text-sm tabular-nums">₹{fmt(row.pt)}</td>
                      <td className="px-2 py-2.5 text-right text-sm tabular-nums">₹{fmt(row.tds)}</td>
                      <td className="px-2 py-2.5 text-right text-sm tabular-nums text-red-600">₹{fmt(row.other_deduction)}</td>
                      <td className="px-2 py-2.5 text-right text-sm tabular-nums text-red-600">₹{fmt(lopDeduction)}</td>
                      <td className="px-2 py-2.5 text-right text-sm tabular-nums border-l border-slate-200">₹{fmt(loans)}</td>
                      <td className="px-2 py-2.5 text-right text-sm font-semibold tabular-nums border-l border-slate-200">₹{fmt(gross)}</td>
                      <td className="px-2 py-2.5 text-right text-sm font-bold text-emerald-700 tabular-nums">₹{fmt(netPay)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-slate-100 border-t-2 border-slate-300 font-bold">
                  <td className="px-3 py-3 text-sm text-slate-700"></td>
                  <td className="px-3 py-3 text-left text-sm text-slate-700" colSpan={2}>Total ({employees.length})</td>
                  <td className="px-2 py-3 text-right text-sm tabular-nums border-l border-slate-200">
                    {perEmp.reduce((s, e) => s + e.row.working_days, 0)}
                  </td>
                  <td className="px-2 py-3 text-right text-sm tabular-nums">
                    {perEmp.reduce((s, e) => s + e.row.present_days, 0)}
                  </td>
                  <td className="px-2 py-3 text-right text-sm tabular-nums text-red-600">
                    {perEmp.reduce((s, e) => s + e.row.lop_days, 0)}
                  </td>
                  <td className="px-2 py-3 text-right text-sm tabular-nums border-l border-slate-200">₹{fmt(perEmp.reduce((s, e) => s + e.row.basic, 0))}</td>
                  <td className="px-2 py-3 text-right text-sm tabular-nums">₹{fmt(perEmp.reduce((s, e) => s + e.row.hra, 0))}</td>
                  <td className="px-2 py-3 text-right text-sm tabular-nums">₹{fmt(perEmp.reduce((s, e) => s + e.row.special_allowance, 0))}</td>
                  <td className="px-2 py-3 text-right text-sm tabular-nums">₹{fmt(perEmp.reduce((s, e) => s + e.row.conveyance, 0))}</td>
                  <td className="px-2 py-3 text-right text-sm tabular-nums">₹{fmt(perEmp.reduce((s, e) => s + e.row.other_earnings, 0))}</td>
                  <td className="px-2 py-3 text-right text-sm tabular-nums text-emerald-600">₹{fmt(totalOtPay)}</td>
                  <td className="px-2 py-3 text-right text-sm tabular-nums text-purple-600">₹{fmt(totalReimb)}</td>
                  <td className="px-2 py-3 text-right text-sm tabular-nums border-l border-slate-200">₹{fmt(perEmp.reduce((s, e) => s + e.row.pf_employee, 0))}</td>
                  <td className="px-2 py-3 text-right text-sm tabular-nums">₹{fmt(perEmp.reduce((s, e) => s + e.row.esi_employee, 0))}</td>
                  <td className="px-2 py-3 text-right text-sm tabular-nums">₹{fmt(perEmp.reduce((s, e) => s + e.row.pt, 0))}</td>
                  <td className="px-2 py-3 text-right text-sm tabular-nums">₹{fmt(perEmp.reduce((s, e) => s + e.row.tds, 0))}</td>
                  <td className="px-2 py-3 text-right text-sm tabular-nums text-red-600">₹{fmt(totalOtherDed)}</td>
                  <td className="px-2 py-3 text-right text-sm tabular-nums text-red-600">₹{fmt(totalLopDed)}</td>
                  <td className="px-2 py-3 text-right text-sm tabular-nums border-l border-slate-200">₹{fmt(totalLoans)}</td>
                  <td className="px-2 py-3 text-right text-sm border-l border-slate-200">₹{fmt(totalGross)}</td>
                  <td className="px-2 py-3 text-right text-sm text-emerald-700">₹{fmt(totalNet)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>
    );
  };

  // A step is its note plus its table. The note is not decoration: steps 2 and
  // 3 look like editable grids and are not, and a reader has to be told where
  // those numbers are set instead of being left to discover it on a payslip.
  const withNote = (note: string, table: JSX.Element) => (
    <div className="flex flex-col h-full">
      {stepNote(note)}
      <div className="flex-1 min-h-0">{table}</div>
    </div>
  );

  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return withNote(
          'Only cells you edit are submitted, and editing Working Days or Present updates LOP to match. A row you do not touch is priced from that employee\'s own attendance record when payroll runs — the figures shown are that record, not an entry. Paid leave comes from the leave ledger and is not editable.',
          renderAttendanceStep(),
        );
      case 2:
        return withNote(
          'A preview. Salary components are computed from each employee\'s salary structure when payroll runs, and are not submitted from this grid — change them under the employee\'s payroll template.',
          renderSalaryStep(),
        );
      case 3:
        return withNote(
          'A preview. PF, ESI, PT and TDS are computed by the payroll engine from the employee\'s structure, state and tax regime, and are not submitted from this grid.',
          renderStatutoryStep(),
        );
      case 4: return renderBenefitsStep();
      case 5: return renderLoansStep();
      case 6: return renderReviewStep();
      default: return renderAttendanceStep();
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-slate-200 bg-white flex-shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" onClick={onBack} iconLeft={<ArrowLeft className="h-4 w-4" />}>
            Back to employees
          </Button>
          <div>
            <h1 className="text-base font-semibold text-slate-900">
              Run Payroll — {employeesData?.pay_group?.name || 'Pay Group'}
            </h1>
            <p className="text-xs text-slate-500">
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 mr-2">
                {formatMonthLabel(monthYear)}
              </span>
              {employees.length} employees · Step {currentStep} of 6
            </p>
          </div>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            const headers = ['Emp ID', 'Employee', 'Dept', 'Working Days', 'Present', 'LOP', 'Paid Leave', 'Overtime Hours',
              'Annual CTC', 'Basic', 'HRA', 'Special', 'Conveyance', 'Other Earnings', 'Overtime Pay', 'Other Deduction',
              'PF Emp', 'PF Er', 'ESI Emp', 'ESI Er', 'PT', 'TDS', 'Gross', 'Deductions', 'Net Pay'];
            const csvRows = [headers.join(',')];
            rowEntries.forEach(([empId, row]) => {
              const emp = employeeMap.get(empId);
              // Same divisor as the review screen and as the run. A CSV that
              // prices a day differently from the payslip is what a dispute
              // gets argued from.
              const lopDed = lopDeductionFor(row, dayBasis.divisorDays);
              const loans = (loansData?.[empId] ?? []).reduce((s, l) => s + l.emi, 0);
              const reimb = reimbData?.[empId]?.reimbursements ?? 0;
              const gross = row.basic + row.hra + row.special_allowance + row.conveyance
                + row.other_earnings + row.overtime_pay_amount + reimb;
              const deductions = row.pf_employee + row.esi_employee + row.pt + row.tds
                + row.other_deduction + lopDed + loans;
              const net = gross - deductions;
              csvRows.push(`"${emp?.employee_code || emp?.id || ''}","${emp?.name || ''}","${emp?.department || ''}",${row.working_days},${row.present_days},${row.lop_days},${row.paid_leave_days},${row.overtime_hours},${row.annual_ctc},${row.basic},${row.hra},${row.special_allowance},${row.conveyance},${row.other_earnings},${row.overtime_pay_amount},${row.other_deduction},${row.pf_employee},${row.pf_employer},${row.esi_employee},${row.esi_employer},${row.pt},${row.tds},${gross},${deductions},${net}`);
            });
            const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `payroll-${monthYear}.csv`;
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          Export CSV
        </Button>
      </div>

      <div className="flex-1 overflow-auto bg-white">
        {isEmployeesLoading ? (
          <div className="flex items-center justify-center h-full text-slate-500">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Loading employees...
          </div>
        ) : processResult ? (
          <div className="p-6 space-y-6">
            <div className="flex items-center gap-3">
              {processResult.failed.length === 0 ? (
                <CheckCircle2 className="h-8 w-8 text-emerald-500" />
              ) : (
                <AlertTriangle className="h-8 w-8 text-amber-500" />
              )}
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Payroll Processing Complete</h2>
                <p className="text-sm text-slate-500">
                  {formatMonthLabel(monthYear)} · {employees.length} employees
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                <p className="text-xs font-medium text-emerald-600 uppercase">Processed</p>
                <p className="text-2xl font-bold text-emerald-700 mt-1">{processResult.succeeded.length}</p>
              </div>
              <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                <p className="text-xs font-medium text-red-600 uppercase">Failed</p>
                <p className="text-2xl font-bold text-red-700 mt-1">{processResult.failed.length}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-medium text-slate-600 uppercase">Total</p>
                <p className="text-2xl font-bold text-slate-900 mt-1">{employees.length}</p>
              </div>
            </div>

            {processResult.succeeded.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-slate-700 mb-2">Successfully Processed</h3>
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="px-4 py-2.5 text-left font-semibold text-slate-700">Employee</th>
                        <th className="px-4 py-2.5 text-left font-semibold text-slate-700">Payroll Item ID</th>
                        <th className="px-4 py-2.5 text-center font-semibold text-slate-700">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {processResult.succeeded.map((s) => {
                        const emp = employeeMap.get(s.user_id);
                        return (
                          <tr key={s.user_id} className="border-b border-slate-100">
                            <td className="px-4 py-2.5 text-sm font-medium text-slate-900">{emp?.name || `User #${s.user_id}`}</td>
                            <td className="px-4 py-2.5 text-sm text-slate-600">#{s.payroll_item_id || '—'}</td>
                            <td className="px-4 py-2.5 text-center">
                              <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                                <CheckCircle2 className="h-3 w-3" /> Processed
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {processResult.failed.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-slate-700 mb-2">Failed</h3>
                <div className="border border-red-200 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-red-50 border-b border-red-200">
                        <th className="px-4 py-2.5 text-left font-semibold text-slate-700">Employee</th>
                        <th className="px-4 py-2.5 text-left font-semibold text-slate-700">Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {processResult.failed.map((f) => {
                        const emp = employeeMap.get(f.user_id);
                        return (
                          <tr key={f.user_id} className="border-b border-red-100">
                            <td className="px-4 py-2.5 text-sm font-medium text-slate-900">{emp?.name || `User #${f.user_id}`}</td>
                            <td className="px-4 py-2.5 text-sm text-red-600">{f.reason}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="flex items-center gap-3 pt-4 border-t border-slate-200">
              <Button variant="ghost" onClick={onBack} iconLeft={<ArrowLeft className="h-4 w-4" />}>
                Back to employees
              </Button>
              {onProcessComplete && (
                // Not back navigation — this finishes the run and returns to
                // the payroll overview. Labelled for what it does.
                <Button variant="primary" onClick={onProcessComplete}>
                  Done
                </Button>
              )}
            </div>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex items-center justify-center h-full text-slate-500">
            <p className="text-sm">No employees to display</p>
          </div>
        ) : (
          renderStep()
        )}
      </div>

      <div className="border-t border-slate-200 bg-white flex-shrink-0">
        <div className="flex items-center justify-center gap-2 px-6 py-3">
          {WIZARD_STEPS.map((step, i) => (
            <div key={step.num} className="flex items-center">
              <button
                onClick={() => setCurrentStep(step.num)}
                className={cn(
                  'px-4 py-1.5 rounded-full text-sm font-medium transition-all',
                  currentStep === step.num
                    ? 'bg-teal-700 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                )}
              >
                {step.label}
              </button>
              {i < WIZARD_STEPS.length - 1 && (
                <div className="w-4 h-px bg-slate-300 mx-0.5" />
              )}
            </div>
          ))}
        </div>

        <div className="flex items-center justify-end px-6 py-3 border-t border-slate-200">
          <Button
            size="sm"
            onClick={handleSaveAndNext}
            disabled={completeStepMutation.isPending || processMutation.isPending}
          >
            {(completeStepMutation.isPending || processMutation.isPending) && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
            {currentStep === 6
              ? (processResult ? 'Processed ✓' : processMutation.isPending ? 'Processing Payroll…' : 'Process All Employees')
              : 'Save & Next →'}
          </Button>
        </div>
      </div>
    </div>
  );
}
