import { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Search, PieChart, Loader2, RotateCcw } from 'lucide-react';
import { payrollApi, getApiErrorMessage } from '@/services/api';
import { cn } from '@/utils/cn';
import Button from '@/components/ui/Button';
import { TextInput, SelectInput, FieldLabel } from '@/components/ui/FormField';
import { formatPayrollAmount } from '@/components/ui/PayrollAmount';
import { PageLoadingState, PageErrorState, PageEmptyState } from '@/components/ui/PageState';
import HowItWorksCard from '@/components/payroll/HowItWorksCard';
import ModuleHeader from '@/components/payroll/ModuleHeader';
import SalaryBreakdownView from '@/components/payroll/SalaryBreakdownView';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';

const INDIAN_STATES = [
  { value: '', label: '— Not set (no PT) —' },
  { value: 'andhra_pradesh', label: 'Andhra Pradesh' },
  { value: 'bihar', label: 'Bihar' },
  { value: 'delhi', label: 'Delhi' },
  { value: 'gujarat', label: 'Gujarat' },
  { value: 'karnataka', label: 'Karnataka' },
  { value: 'kerala', label: 'Kerala' },
  { value: 'madhya_pradesh', label: 'Madhya Pradesh' },
  { value: 'maharashtra', label: 'Maharashtra' },
  { value: 'punjab', label: 'Punjab' },
  { value: 'rajasthan', label: 'Rajasthan' },
  { value: 'tamil_nadu', label: 'Tamil Nadu' },
  { value: 'telangana', label: 'Telangana' },
  { value: 'uttar_pradesh', label: 'Uttar Pradesh' },
  { value: 'west_bengal', label: 'West Bengal' },
];

/** The bucket for employees who belong to no department. */
const UNASSIGNED = -1;

interface WhatIfState {
  annual_ctc: number | null;
  salary_template_id: number | null;
  pt_state: string;
}

const defaultWhatIf: WhatIfState = {
  annual_ctc: null,
  salary_template_id: null,
  pt_state: '',
};

/**
 * Custom mode's editable heads.
 *
 * Held as strings so a half-typed "4" on the way to "40" does not snap the
 * field to 0 and redraw the whole breakdown underneath the cursor.
 */
type CustomUnit = 'pct' | 'amt';

interface CustomState {
  basic_percentage: string;
  /** Basic and HRA can be stated either way. Everything else is percent-only. */
  basic_unit: CustomUnit;
  hra_percentage: string;
  hra_unit: CustomUnit;
  da_percentage: string;
  conveyance_amount: string;
  nps_percentage: string;
  vpf_percentage: string;
}

/** The four that have no unit choice — they mean one thing each. */
const CUSTOM_FIELDS: Array<{ key: keyof CustomState; label: string; hint: string }> = [
  { key: 'da_percentage', label: 'DA', hint: '% of CTC' },
  { key: 'conveyance_amount', label: 'Conveyance', hint: '₹ / month' },
  { key: 'nps_percentage', label: 'NPS', hint: '% of Basic' },
  { key: 'vpf_percentage', label: 'VPF', hint: '% of Basic' },
];

const emptyCustom: CustomState = {
  basic_percentage: '40',
  basic_unit: 'pct',
  hra_percentage: '50',
  hra_unit: 'pct',
  da_percentage: '0',
  conveyance_amount: '1600',
  nps_percentage: '0',
  vpf_percentage: '0',
};

const toNumber = (value: string): number => {
  const parsed = Number(value.replace(/[^0-9.]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

/**
 * Salary Breakdown — what an employee's CTC actually pays them.
 *
 * Employee Cards answers "what is this person configured as", by pay group.
 * This answers "what does that configuration pay", by department.
 *
 * Deliberately read-only: there is no save path here and the endpoint behind it
 * writes nothing. Every control is a what-if, so an admin can try a different
 * structure — or type their own percentages in Custom mode — and see the effect
 * on take-home without any risk of altering what payroll will actually pay.
 * Employee Cards remains the one place a configuration is changed.
 */
export default function SalaryBreakdownCards() {
  const [searchParams] = useSearchParams();

  /*
   * `?employee=<id>` opens straight onto one person — Add User step 3 links
   * here rather than embedding its own breakdown. Read once into state: after
   * mount the panel is driven by clicks, so a stale param must not keep
   * re-pinning the selection.
   */
  const deepLinkEmployeeId = useMemo(() => {
    const raw = Number(searchParams.get('employee'));
    return Number.isFinite(raw) && raw > 0 ? raw : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const deepLinkResolved = useRef(deepLinkEmployeeId === null);

  const [search, setSearch] = useState('');
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<number | null>(null);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | null>(deepLinkEmployeeId);
  const [whatIf, setWhatIf] = useState<WhatIfState>(defaultWhatIf);
  const [mode, setMode] = useState<'structure' | 'custom'>('structure');
  const [custom, setCustom] = useState<CustomState>(emptyCustom);

  const { data: departmentsData, isLoading: departmentsLoading } = useQuery({
    queryKey: ['payroll', 'departments'],
    queryFn: () => payrollApi.getDepartments().then((r) => r.data),
  });

  const { data: structuresData } = useQuery({
    queryKey: ['salary-structures'],
    queryFn: () => payrollApi.getSalaryStructures().then((r) => r.data),
  });

  const salaryStructures = structuresData?.templates || [];

  const departmentsList = useMemo(
    () => (departmentsData?.departments || []) as Array<{ id: number; name: string; employee_count: number }>,
    [departmentsData],
  );
  const unassignedCount = departmentsData?.unassigned_count ?? 0;

  useEffect(() => {
    // Held back while a deep-linked employee is still resolving, so the middle
    // pane does not load the wrong department's list first and flicker.
    if (!deepLinkResolved.current) return;
    if (selectedDepartmentId == null && departmentsList.length > 0) {
      setSelectedDepartmentId(departmentsList[0].id);
    }
  }, [departmentsList, selectedDepartmentId]);

  /*
   * The employee-cards index has no "no department" filter, so the Unassigned
   * bucket fetches unfiltered and keeps the rows with no department. Every
   * other bucket filters server-side.
   */
  const isUnassigned = selectedDepartmentId === UNASSIGNED;

  const { data: employeesData, isLoading: loadingEmployees } = useQuery({
    queryKey: ['employee-payroll-cards', 'department', selectedDepartmentId],
    queryFn: () =>
      payrollApi.getEmployeePayrollCards(
        isUnassigned ? undefined : { department_id: selectedDepartmentId! },
      ),
    enabled: selectedDepartmentId != null,
  });

  const employees = useMemo(() => {
    const rows = employeesData?.data?.employees || [];
    return isUnassigned ? rows.filter((e) => e.department_id == null) : rows;
  }, [employeesData, isUnassigned]);

  const filteredEmployees = useMemo(() => {
    if (!search) return employees;
    const needle = search.toLowerCase();
    return employees.filter(
      (emp) => emp.name.toLowerCase().includes(needle) || emp.email.toLowerCase().includes(needle),
    );
  }, [employees, search]);

  const { data: employeeDetail } = useQuery({
    queryKey: ['employee-payroll-card', selectedEmployeeId],
    queryFn: () => payrollApi.getEmployeePayrollCard(selectedEmployeeId!),
    enabled: !!selectedEmployeeId,
  });

  const payrollConfig = employeeDetail?.data?.payroll_config;
  const detailEmployee = employeeDetail?.data?.employee;

  /*
   * A deep link carries only an employee id, so the department comes from the
   * card once it loads — that is what highlights the left and middle panes.
   * Latched: applied once, so a later manual choice is not overridden.
   */
  useEffect(() => {
    if (deepLinkResolved.current || !detailEmployee) return;
    deepLinkResolved.current = true;
    setSelectedDepartmentId(detailEmployee.department_id ?? UNASSIGNED);
  }, [detailEmployee]);

  /** Reset the what-if inputs to whatever the employee is actually configured as. */
  const resetToStored = () => {
    if (payrollConfig) {
      setWhatIf({
        annual_ctc: payrollConfig.annual_ctc ? Number(payrollConfig.annual_ctc) : null,
        salary_template_id: payrollConfig.salary_template_id ?? null,
        pt_state: payrollConfig.pt_state ?? '',
      });
      setCustom({
        ...emptyCustom,
        basic_percentage: String(payrollConfig.basic_percentage ?? 40),
        hra_percentage: String(payrollConfig.hra_percentage ?? 50),
        da_percentage: String(payrollConfig.da_percentage ?? 0),
        conveyance_amount: String(payrollConfig.conveyance_allowance ?? 1600),
      });
    } else {
      setWhatIf(defaultWhatIf);
      setCustom(emptyCustom);
    }
    setMode('structure');
  };

  useEffect(() => {
    if (!selectedEmployeeId) return;
    resetToStored();
    // Re-seeds whenever a different employee's stored config arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEmployeeId, payrollConfig]);

  /*
   * Clearing the employee lives in the department click handler, not in an
   * effect on selectedDepartmentId.
   *
   * As an effect it also ran on mount and on every *programmatic* department
   * change, which wiped the employee a `?employee=` deep link had just
   * selected. A click is a user action; handling it in the handler is both
   * correct and one less thing to fight.
   */

  /*
   * The typed fields are debounced; picking a structure or a state is a single
   * deliberate act and redraws at once. Custom mode's percentages are typed, so
   * they trail too — otherwise every keystroke of "45" fires a request.
   */
  const debouncedCtc = useDebouncedValue(whatIf.annual_ctc, 400);
  const debouncedCustom = useDebouncedValue(custom, 400);

  /*
   * A rupee amount is sent as an amount and converted server-side, rather than
   * turned into a percentage here. Two reasons: the server already owns that
   * arithmetic, and a percentage computed from a rounded rupee figure and sent
   * as the authority would quietly disagree with the amount the admin typed.
   */
  const customParams = useMemo(
    () =>
      mode === 'custom'
        ? {
            ...(debouncedCustom.basic_unit === 'amt'
              ? { basic_amount: toNumber(debouncedCustom.basic_percentage) }
              : { basic_percentage: toNumber(debouncedCustom.basic_percentage) }),
            ...(debouncedCustom.hra_unit === 'amt'
              ? { hra_amount: toNumber(debouncedCustom.hra_percentage) }
              : { hra_percentage: toNumber(debouncedCustom.hra_percentage) }),
            da_percentage: toNumber(debouncedCustom.da_percentage),
            conveyance_amount: toNumber(debouncedCustom.conveyance_amount),
            nps_percentage: toNumber(debouncedCustom.nps_percentage),
            vpf_percentage: toNumber(debouncedCustom.vpf_percentage),
          }
        : undefined,
    [mode, debouncedCustom],
  );

  const {
    data: breakdown,
    isLoading: breakdownLoading,
    isFetching: breakdownFetching,
    isError: breakdownIsError,
    error: breakdownError,
    refetch: refetchBreakdown,
  } = useQuery({
    queryKey: [
      'employee-salary-breakdown',
      selectedEmployeeId,
      whatIf.salary_template_id,
      debouncedCtc,
      whatIf.pt_state,
      customParams,
    ],
    queryFn: () =>
      payrollApi
        .getEmployeeSalaryBreakdown(selectedEmployeeId!, {
          salary_template_id: whatIf.salary_template_id,
          annual_ctc: debouncedCtc,
          pt_state: whatIf.pt_state,
          custom: customParams,
        })
        .then((r) => r.data),
    enabled: !!selectedEmployeeId && !!debouncedCtc && debouncedCtc > 0,
    /*
     * Keep the last breakdown on screen while the next one is computed. Every
     * keystroke in Custom mode is a new query key, and swapping to a spinner
     * each time made the numbers strobe.
     */
    placeholderData: keepPreviousData,
  });

  /*
   * Falls back to the card's own employee. Arriving by deep link, the person is
   * selected before their department's list has loaded — without the fallback
   * the detail header renders blank for that moment.
   */
  const selectedListRow = employees.find((e) => e.id === selectedEmployeeId) || null;
  const selectedEmployee = selectedListRow || detailEmployee || null;
  const isPreview = breakdown?.source?.is_preview ?? false;

  const departmentRows = [
    ...departmentsList,
    ...(unassignedCount > 0
      ? [{ id: UNASSIGNED, name: 'Unassigned', employee_count: unassignedCount }]
      : []),
  ];

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Salary Breakdown"
        description="What each employee's CTC actually pays them — component by component, by department. A read-only what-if: try another structure or your own percentages without changing anything."
      />

      <HowItWorksCard
        whatIsThis="An employee's annual CTC split into the earnings they receive and the deductions taken from them. Gross is CTC less the employer's own costs (employer PF and the gratuity provision), because those are not the employee's wages. Nothing on this screen is saved — it exists to answer questions, not to configure payroll."
        whenToUse={[
          'Answering "why is my take-home this much?" without opening a payslip',
          'Comparing what two salary structures would pay the same person',
          'Testing a split before you build it — raise Basic and watch PF, gratuity and take-home move',
        ]}
        howItFlows={[
          { step: 1, label: 'Pick a department', desc: 'Then the employee within it' },
          { step: 2, label: 'Read the split', desc: 'Earnings, deductions and employer contributions, monthly and annual' },
          { step: 3, label: 'Try a structure', desc: 'Or switch to Custom and set Basic, HRA and DA by percentage yourself' },
          { step: 4, label: 'Apply it for real', desc: 'Nothing here saves — make the change on Employee Cards once you know what you want' },
        ]}
        commonMistakes={[
          'Expecting this screen to save — it never does; Employee Cards is where a configuration changes',
          'Setting Basic low to raise take-home: it also shrinks PF, gratuity and the HRA exemption',
          'Expecting professional tax without a PT state set; several states levy none and an unset state is ₹0',
          'Treating the TDS line as final — it is an estimate until investment proofs are verified',
        ]}
      />

      <div className="grid grid-cols-1 lg:grid-cols-[180px_240px_1fr] gap-0 border border-slate-200 rounded-lg overflow-hidden lg:h-[600px]">
        {/* Departments */}
        <div className="border-b lg:border-b-0 lg:border-r border-slate-200 overflow-y-auto">
          <div className="p-3 border-b border-slate-200 text-xs font-semibold text-slate-500">DEPARTMENTS</div>
          {departmentsLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
            </div>
          ) : departmentRows.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-6 px-2">No departments found.</p>
          ) : (
            departmentRows.map((dept) => (
              <button
                key={dept.id}
                onClick={() => {
                  setSelectedDepartmentId(dept.id);
                  // Picking a department drops the current employee — see the
                  // note above on why this is not an effect.
                  setSelectedEmployeeId(null);
                }}
                className={`w-full text-left px-3 py-2.5 text-sm cursor-pointer transition-colors ${
                  selectedDepartmentId === dept.id
                    ? 'bg-blue-50 border-l-[3px] border-l-blue-600 font-semibold text-slate-900'
                    : 'border-l-[3px] border-l-transparent hover:bg-slate-50 text-slate-500'
                }`}
              >
                <span className="block truncate">{dept.name}</span>
                <span className="block text-[11px] text-slate-500">{dept.employee_count} employees</span>
              </button>
            ))
          )}
        </div>

        {/* Employees */}
        <div className="border-b lg:border-b-0 lg:border-r border-slate-200 overflow-y-auto">
          <div className="p-2.5 border-b border-slate-200">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 z-10" />
              <TextInput
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
                className="pl-7"
              />
            </div>
          </div>

          {selectedDepartmentId == null ? (
            <p className="text-xs text-slate-500 text-center py-6">Select a department to view employees.</p>
          ) : loadingEmployees ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
            </div>
          ) : filteredEmployees.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-6">No employees in this department.</p>
          ) : (
            filteredEmployees.map((emp) => (
              <div
                key={emp.id}
                onClick={() => setSelectedEmployeeId(emp.id)}
                className={`px-2.5 py-2.5 cursor-pointer transition-colors ${
                  selectedEmployeeId === emp.id
                    ? 'bg-blue-50 border-l-[3px] border-l-blue-600'
                    : 'border-l-[3px] border-l-transparent hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className="w-[26px] h-[26px] rounded-full bg-blue-600 text-white flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                    {getInitials(emp.name)}
                  </div>
                  <div className="min-w-0">
                    <div
                      className={`text-[13px] truncate ${
                        selectedEmployeeId === emp.id ? 'font-semibold text-slate-900' : 'text-slate-700'
                      }`}
                    >
                      {emp.name}
                    </div>
                    <div className="text-[11px] text-slate-500 truncate">
                      {Number(emp.annual_ctc) > 0
                        ? `${formatPayrollAmount(emp.annual_ctc, { compact: true })} CTC`
                        : 'CTC not set'}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Detail */}
        <div className="overflow-y-auto p-4">
          {!selectedEmployeeId ? (
            <div className="flex h-full items-center justify-center">
              <div className="text-center text-slate-500">
                <PieChart className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                <p className="text-sm">Select an employee to see their salary breakdown.</p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-bold text-slate-900">
                    {selectedEmployee?.name} — Salary Breakdown
                  </div>
                  <div className="text-xs text-slate-500">
                    {[
                      selectedEmployee?.designation,
                      selectedEmployee?.department,
                      // Only the list row carries the pay group; the card
                      // fallback used on a deep link does not.
                      selectedListRow?.pay_group && `Pay group: ${selectedListRow.pay_group}`,
                      selectedEmployee?.email,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </div>
                {isPreview && (
                  <Button
                    variant="secondary"
                    size="sm"
                    iconLeft={<RotateCcw className="h-3.5 w-3.5" />}
                    onClick={resetToStored}
                  >
                    Reset to actual
                  </Button>
                )}
              </div>

              {/* Every control below is a what-if. Nothing here is written back. */}
              <div className="rounded-lg border border-slate-200 p-3 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    What-if inputs
                  </span>
                  <div className="flex gap-1.5">
                    {(['structure', 'custom'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setMode(m)}
                        className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                          mode === m
                            ? 'border-blue-600 bg-blue-500/10 text-blue-600'
                            : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        {m === 'structure' ? 'Salary structure' : 'Custom components'}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <FieldLabel>Annual CTC (₹)</FieldLabel>
                    <TextInput
                      type="text"
                      inputMode="numeric"
                      value={whatIf.annual_ctc != null ? String(whatIf.annual_ctc) : ''}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/[^0-9]/g, '');
                        setWhatIf({ ...whatIf, annual_ctc: raw ? Number(raw) : null });
                      }}
                      placeholder="e.g., 600000"
                    />
                  </div>
                  <div>
                    <FieldLabel>Salary Structure</FieldLabel>
                    <SelectInput
                      value={whatIf.salary_template_id ?? ''}
                      disabled={mode === 'custom'}
                      onChange={(e) =>
                        setWhatIf({
                          ...whatIf,
                          salary_template_id: e.target.value ? Number(e.target.value) : null,
                        })
                      }
                    >
                      <option value="">— None —</option>
                      {salaryStructures.map((s: { id: number; name: string }) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </SelectInput>
                    {mode === 'custom' && (
                      <p className="mt-1 text-[11px] text-slate-500">Overridden by your custom components.</p>
                    )}
                  </div>
                  <div>
                    <FieldLabel>PT State</FieldLabel>
                    <SelectInput
                      value={whatIf.pt_state}
                      onChange={(e) => setWhatIf({ ...whatIf, pt_state: e.target.value })}
                    >
                      {INDIAN_STATES.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </SelectInput>
                  </div>
                </div>

                {mode === 'custom' && (
                  <div className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-3 sm:grid-cols-3 lg:grid-cols-6">
                    {(['basic', 'hra'] as const).map((which) => {
                      const valueKey = which === 'basic' ? 'basic_percentage' : 'hra_percentage';
                      const unitKey = which === 'basic' ? 'basic_unit' : 'hra_unit';
                      const unit = custom[unitKey] as CustomUnit;
                      const raw = toNumber(custom[valueKey]);

                      // The base this component is a share of. Basic is a share
                      // of monthly CTC; HRA is a share of monthly basic.
                      const monthlyCtc = (whatIf.annual_ctc ?? 0) / 12;
                      const basicMonthly =
                        custom.basic_unit === 'amt'
                          ? toNumber(custom.basic_percentage)
                          : (monthlyCtc * toNumber(custom.basic_percentage)) / 100;
                      const base = which === 'basic' ? monthlyCtc : basicMonthly;

                      // The same value expressed the other way, shown live so
                      // the officer always sees both.
                      const converted =
                        unit === 'pct'
                          ? (base * raw) / 100
                          : base > 0
                            ? (raw / base) * 100
                            : 0;

                      return (
                        <div key={which}>
                          <div className="flex items-center justify-between gap-1">
                            <FieldLabel>{which === 'basic' ? 'Basic' : 'HRA'}</FieldLabel>
                            <div className="flex overflow-hidden rounded border border-slate-200">
                              {(['pct', 'amt'] as const).map((option) => (
                                <button
                                  key={option}
                                  type="button"
                                  aria-pressed={unit === option}
                                  className={cn(
                                    'px-1.5 py-0.5 text-[10px] font-semibold transition-colors',
                                    unit === option
                                      ? 'bg-blue-600 text-white'
                                      : 'bg-white text-slate-500 hover:bg-slate-50',
                                  )}
                                  onClick={() => {
                                    if (unit === option) return;

                                    /*
                                     * Convert, never reset. Switching the unit
                                     * on a field the admin has already filled
                                     * must preserve what they meant — blanking
                                     * it would lose the figure they were part
                                     * way through reasoning about.
                                     *
                                     * The base > 0 guard is the crash: a zero
                                     * basic is reachable simply by clearing the
                                     * Basic field.
                                     */
                                    const next =
                                      option === 'amt'
                                        ? (base * raw) / 100
                                        : base > 0
                                          ? (raw / base) * 100
                                          : 0;

                                    setCustom({
                                      ...custom,
                                      [unitKey]: option,
                                      [valueKey]: String(Math.round(next * 100) / 100),
                                    });
                                  }}
                                >
                                  {option === 'pct' ? '%' : '₹'}
                                </button>
                              ))}
                            </div>
                          </div>
                          <TextInput
                            type="text"
                            inputMode="decimal"
                            aria-label={which === 'basic' ? 'Basic' : 'HRA'}
                            value={custom[valueKey]}
                            onChange={(e) =>
                              setCustom({ ...custom, [valueKey]: e.target.value.replace(/[^0-9.]/g, '') })
                            }
                          />
                          <p className="mt-1 text-[11px] text-slate-500">
                            {unit === 'pct'
                              ? `% of ${which === 'basic' ? 'CTC' : 'Basic'} · ₹${Math.round(converted).toLocaleString('en-IN')}/mo`
                              : `₹ / month · ${converted.toFixed(2)}% of ${which === 'basic' ? 'CTC' : 'Basic'}`}
                          </p>
                        </div>
                      );
                    })}

                    {CUSTOM_FIELDS.map((field) => (
                      <div key={field.key}>
                        <FieldLabel>{field.label}</FieldLabel>
                        <TextInput
                          type="text"
                          inputMode="decimal"
                          value={custom[field.key]}
                          onChange={(e) =>
                            setCustom({ ...custom, [field.key]: e.target.value.replace(/[^0-9.]/g, '') })
                          }
                        />
                        <p className="mt-1 text-[11px] text-slate-500">{field.hint}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {isPreview && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  This is a what-if, not {selectedEmployee?.name ?? 'this employee'}&apos;s saved configuration.
                  Nothing on this screen is saved — change it on Employee Cards to make it real.
                </div>
              )}

              {!whatIf.annual_ctc || whatIf.annual_ctc <= 0 ? (
                <PageEmptyState
                  title="No annual CTC set"
                  description="Enter an annual CTC above to see how it splits into components."
                />
              ) : breakdownLoading ? (
                <PageLoadingState label="Calculating breakdown…" />
              ) : breakdownIsError ? (
                <PageErrorState
                  message={getApiErrorMessage(breakdownError, "Couldn't calculate the breakdown.")}
                  onRetry={() => refetchBreakdown()}
                />
              ) : breakdown ? (
                <div className={`space-y-4 transition-opacity ${breakdownFetching ? 'opacity-60' : ''}`}>
                  {breakdownFetching && (
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Recalculating…
                    </div>
                  )}
                  <SalaryBreakdownView breakdown={breakdown} />
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
