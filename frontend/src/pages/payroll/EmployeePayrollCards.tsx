import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, Loader2 } from 'lucide-react';
import { payrollApi } from '@/services/api';
import Button from '@/components/ui/Button';
import { TextInput, SelectInput, FieldLabel } from '@/components/ui/FormField';
import { formatPayrollAmount } from '@/components/ui/PayrollAmount';
import ModuleHeader from '@/components/payroll/ModuleHeader';
import ThreePanePicker, { type PickerItemLite } from '@/components/payroll/ThreePanePicker';
import {
  INDIAN_STATES,
  PT_STATE_NOT_SET_VALUE,
  PT_STATE_NOT_SET_LABEL,
} from '@/utils/indianStates';

interface EmpFormState {
  annual_ctc: number | null;
  salary_template_id: number | null;
  /*
   * Nullable, and it starts null. This was `string` defaulting to
   * 'maharashtra', and this form writes straight to the employee's payroll
   * template — so an admin who opened the card to set a CTC and never looked
   * at the PT field committed Maharashtra's slab to that employee, and every
   * payslip after it deducted ₹200 a month from somebody who may work in
   * Delhi and owe nothing. Professional tax is state-levied; null means
   * nobody has said which state, which PTStateService prices at ₹0.
   */
  pt_state: string | null;
}

const defaultEmpForm: EmpFormState = {
  annual_ctc: null,
  salary_template_id: null,
  pt_state: null,
};

export default function EmployeePayrollCards() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedPayGroupId, setSelectedPayGroupId] = useState<number | null>(null);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | null>(null);
  const [empForm, setEmpForm] = useState<EmpFormState>(defaultEmpForm);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { data: payGroupsData, isLoading: payGroupsLoading } = useQuery({
    queryKey: ['payroll', 'pay-groups-payroll-cards'],
    queryFn: () => payrollApi.listPayGroups().then((r) => r.data),
  });

  const { data: structuresData } = useQuery({
    queryKey: ['salary-structures'],
    queryFn: () => payrollApi.getSalaryStructures().then((r) => r.data),
  });

  const salaryStructures = structuresData?.templates || [];

  const payGroupsList = useMemo(
    () => (payGroupsData?.pay_groups || []) as Array<{ id: number; name: string; employee_count: number }>,
    [payGroupsData],
  );

  /*
   * Open on the largest pay group, not the first one the API happens to
   * return.
   *
   * This took payGroupsList[0], which is whatever order the endpoint sends —
   * on production that is a one-employee group somebody named "j", so the
   * first thing anyone sees on Employee Cards is a group of one with a
   * placeholder name, while the real team of five sits below it unselected.
   *
   * Headcount is the honest proxy for "the group you meant": the biggest one
   * is where the work is. Ties fall back to the API order, so this is stable
   * rather than merely different.
   */
  useEffect(() => {
    if (selectedPayGroupId != null || payGroupsList.length === 0) return;

    const largest = payGroupsList.reduce(
      (best, group) => ((group.employee_count ?? 0) > (best.employee_count ?? 0) ? group : best),
      payGroupsList[0],
    );

    setSelectedPayGroupId(largest.id);
  }, [payGroupsList, selectedPayGroupId]);

  const { data: employeesData, isLoading: loadingEmployees } = useQuery({
    queryKey: ['employee-payroll-cards', selectedPayGroupId],
    queryFn: () => payrollApi.getEmployeePayrollCards({ pay_group_id: selectedPayGroupId || undefined }),
    enabled: !!selectedPayGroupId,
  });

  const { data: employeeDetail, isLoading: loadingDetail, isError: detailError, error: detailErrorMsg } = useQuery({
    queryKey: ['employee-payroll-card', selectedEmployeeId],
    queryFn: () => payrollApi.getEmployeePayrollCard(selectedEmployeeId!),
    enabled: !!selectedEmployeeId,
  });

  const saveMutation = useMutation({
    mutationFn: ({ userId, data }: { userId: number; data: EmpFormState }) =>
      payrollApi.updateEmployeePayrollCard(userId, data as unknown as Record<string, unknown>).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employee-payroll-cards'] });
      queryClient.invalidateQueries({ queryKey: ['employee-payroll-card', selectedEmployeeId] });
      setSavedMessage('Employee template saved.');
      setErrorMessage(null);
    },
    onError: (err: any) => {
      setErrorMessage(err?.message || 'Failed to save template.');
      setSavedMessage(null);
    },
  });

  const employees = employeesData?.data?.employees || [];

  const filteredEmployees = useMemo(() => {
    if (!search) return employees;
    const searchLower = search.toLowerCase();
    return employees.filter((emp) =>
      emp.name.toLowerCase().includes(searchLower) ||
      emp.email.toLowerCase().includes(searchLower)
    );
  }, [employees, search]);

  const selectedEmployee = employeeDetail?.data?.employee;
  const payrollConfig = employeeDetail?.data?.payroll_config;

  useEffect(() => {
    setSelectedEmployeeId(null);
    setSavedMessage(null);
    setErrorMessage(null);
  }, [selectedPayGroupId]);

  useEffect(() => {
    if (!selectedEmployeeId) return;
    if (payrollConfig) {
      setEmpForm({
        annual_ctc: payrollConfig.annual_ctc ? Number(payrollConfig.annual_ctc) : null,
        salary_template_id: payrollConfig.salary_template_id ?? null,
        pt_state: payrollConfig.pt_state ?? null,
      });
    } else {
      setEmpForm(defaultEmpForm);
    }
  }, [selectedEmployeeId, payrollConfig]);

  /*
   * Messages clear when you switch employee — deliberately not when
   * payrollConfig changes. Saving refetches the card, which handed the effect
   * above a new object and made it wipe the "saved" confirmation the mutation
   * had just set, so a successful save flashed and left no trace.
   */
  useEffect(() => {
    setSavedMessage(null);
    setErrorMessage(null);
  }, [selectedEmployeeId]);

  const handleSave = () => {
    if (!selectedEmployeeId) return;
    saveMutation.mutate({ userId: selectedEmployeeId, data: empForm });
  };

  if (loadingEmployees && payGroupsList.length === 0) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-slate-100 rounded w-1/4" />
        <div className="h-64 bg-slate-100 rounded" />
      </div>
    );
  }

  const groupItems: PickerItemLite[] = payGroupsList.map((g) => ({
    id: g.id,
    label: g.name,
    meta: g.employee_count > 0 ? `${g.employee_count} employees` : undefined,
  }));

  const employeeItems: PickerItemLite[] = filteredEmployees.map((emp) => ({
    id: emp.id,
    label: emp.name,
    sublabel: emp.email,
    meta: Number(emp.annual_ctc) > 0 ? `${formatPayrollAmount(emp.annual_ctc, { compact: true })} CTC` : 'CTC not set',
  }));

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Employee Cards"
        description="Each employee's payroll card — annual CTC, salary template and professional-tax state, set per pay group."
      />

      <ThreePanePicker
        groupLabel="Pay groups"
        employeeLabel="Employees"
        groups={groupItems}
        employees={employeeItems}
        selectedGroupId={selectedPayGroupId}
        selectedEmployeeId={selectedEmployeeId}
        onSelectGroup={(id) => setSelectedPayGroupId(id as number)}
        onSelectEmployee={(id) => {
          setSelectedEmployeeId(id as number);
          setSavedMessage(null);
          setErrorMessage(null);
        }}
        searchPlaceholder="Search name or email…"
        emptyGroupsLabel={payGroupsLoading ? 'Loading…' : 'No pay groups found.'}
        emptyEmployeesLabel={loadingEmployees ? 'Loading…' : 'No employees in this pay group.'}
        searchValue={search}
        onSearchChange={setSearch}
        ariaLabel="Employee Cards picker"
        renderDetail={() => {
          if (loadingDetail) {
            return (
              <div className="flex h-full items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
              </div>
            );
          }
          if (detailError) {
            return (
              <div className="flex h-full items-center justify-center py-12">
                <div className="text-center text-red-500">
                  <p className="font-medium text-sm">Failed to load employee details</p>
                  <p className="text-xs mt-1">{detailErrorMsg?.message || 'Unknown error'}</p>
                  <button
                    onClick={() => queryClient.invalidateQueries({ queryKey: ['employee-payroll-card', selectedEmployeeId] })}
                    className="mt-3 px-3 py-1.5 text-xs bg-red-50 text-red-700 rounded-md hover:bg-red-100"
                  >
                    Retry
                  </button>
                </div>
              </div>
            );
          }
          if (!selectedEmployee) {
            return (
              <div className="flex h-full items-center justify-center">
                <div className="text-center text-slate-500">
                  <p className="text-sm">Select an employee to view their payroll card.</p>
                </div>
              </div>
            );
          }
          return (
            <div className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-sm font-bold text-slate-900">{selectedEmployee.name} — Payroll Card</div>
                  {selectedEmployee.department && (
                    <div className="text-xs text-slate-500">{selectedEmployee.department}</div>
                  )}
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleSave}
                  disabled={saveMutation.isPending}
                  loading={saveMutation.isPending}
                  iconLeft={!saveMutation.isPending ? <Save className="h-3.5 w-3.5" /> : undefined}
                >
                  Save Changes
                </Button>
              </div>

              <div className="space-y-3">
                <div>
                  <FieldLabel>Annual CTC (₹)</FieldLabel>
                  <TextInput
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={empForm.annual_ctc != null ? String(empForm.annual_ctc) : ''}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/[^0-9]/g, '');
                      setEmpForm({ ...empForm, annual_ctc: raw ? Number(raw) : null });
                    }}
                    placeholder="e.g., 600000"
                  />
                </div>
                <div>
                  <FieldLabel>Salary Template</FieldLabel>
                  <SelectInput
                    value={empForm.salary_template_id ?? ''}
                    onChange={(e) => setEmpForm({ ...empForm, salary_template_id: e.target.value ? Number(e.target.value) : null })}
                  >
                    <option value="">— None —</option>
                    {salaryStructures.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </SelectInput>
                </div>
                <div>
                  <FieldLabel>PT State</FieldLabel>
                  <SelectInput
                    value={empForm.pt_state ?? ''}
                    onChange={(e) => setEmpForm({ ...empForm, pt_state: e.target.value || null })}
                  >
                    {/*
                      * SelectInput shows options[0] when the value matches
                      * nothing, so an unset state needs an option of its own
                      * or the field displays a state this employee was never
                      * assigned — and the next save makes it true.
                      */}
                    <option value="">{PT_STATE_NOT_SET_LABEL}</option>
                    {INDIAN_STATES.map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </SelectInput>
                </div>
              </div>

              <div className="h-px bg-slate-200 my-4" />

              {savedMessage && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-xs text-emerald-800 mb-3">
                  {savedMessage}
                </div>
              )}
              {errorMessage && (
                <div className="bg-rose-50 border border-rose-200 rounded-lg p-3 text-xs text-rose-800 mb-3">
                  {errorMessage}
                </div>
              )}
            </div>
          );
        }}
      />
    </div>
  );
}
