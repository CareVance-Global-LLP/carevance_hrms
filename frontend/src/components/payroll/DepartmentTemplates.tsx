import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Building2, Save, AlertCircle, Loader2, User, X } from 'lucide-react';
import { payrollApi } from '@/services/api';
import Button from '@/components/ui/Button';
import { TextInput, SelectInput, FieldLabel } from '@/components/ui/FormField';
import SurfaceCard from '@/components/dashboard/SurfaceCard';

const INDIAN_STATES = [
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

interface DepartmentTemplatesProps {
  onBack: () => void;
}

const emptyEmployeeForm = {
  annual_ctc: 0,
  basic_percentage: 40,
  hra_percentage: 50,
  da_percentage: 0,
  conveyance_allowance: 1600,
  pf_enabled: true,
  esi_enabled: true,
  pt_enabled: true,
  tds_enabled: true,
  lwf_enabled: false,
  pf_employee_percentage: 12,
  pf_employer_percentage: 12,
  pf_wage_cap: 15000,
  esi_employee_percentage: 0.75,
  esi_employer_percentage: 3.25,
  esi_threshold: 21000,
  pt_state: 'maharashtra',
  tax_regime: 'new',
  is_metro_city: true,
  is_active: true,
};

export default function DepartmentTemplates({ onBack }: DepartmentTemplatesProps) {
  const [selectedDeptId, setSelectedDeptId] = useState<number | null>(null);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | null>(null);

  const [empForm, setEmpForm] = useState({ ...emptyEmployeeForm });

  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const queryClient = useQueryClient();

  // List departments for the org
  const { data: deptData, isLoading: deptsLoading } = useQuery({
    queryKey: ['payroll', 'department-templates'],
    queryFn: () => payrollApi.listDepartmentTemplates().then(r => r.data),
  });

  const existingTemplates = (deptData?.templates || []) as Array<any>;
  const departmentsList = useMemo(() => {
    const covered = existingTemplates.map(t => ({
      id: t.department_id,
      name: t.department?.name || `Dept #${t.department_id}`,
      has_seed: true,
    }));
    const missing = (deptData?.departments_without_template || []).map((d: any) => ({
      id: d.id,
      name: d.name,
      has_seed: false,
    }));
    const all = [...covered, ...missing];
    const seen = new Set<number>();
    return all.filter(d => {
      if (seen.has(d.id)) return false;
      seen.add(d.id);
      return true;
    }).sort((a, b) => a.name.localeCompare(b.name));
  }, [deptData]);

  // Auto-select first dept
  useEffect(() => {
    if (selectedDeptId == null && departmentsList.length > 0) {
      setSelectedDeptId(departmentsList[0].id);
    }
  }, [departmentsList, selectedDeptId]);

  // List employees in the selected department
  const { data: empData, isLoading: empsLoading } = useQuery({
    queryKey: ['payroll', 'dept-employees', selectedDeptId],
    queryFn: () => {
      if (selectedDeptId == null) return null;
      return payrollApi.getDepartmentEmployees(selectedDeptId, {}).then(r => r.data);
    },
    enabled: selectedDeptId != null,
  });

  const employees = (empData?.employees || []) as Array<any>;

  // Filter by search
  const filteredEmployees = useMemo(() => {
    if (!searchQuery) return employees;
    const q = searchQuery.toLowerCase();
    return employees.filter(e =>
      (e.name || '').toLowerCase().includes(q) ||
      (e.email || '').toLowerCase().includes(q) ||
      (e.employee_code || '').toLowerCase().includes(q),
    );
  }, [employees, searchQuery]);

  // Reset employee selection when dept changes
  useEffect(() => {
    setSelectedEmployeeId(null);
    setSavedMessage(null);
    setErrorMessage(null);
  }, [selectedDeptId]);

  // Load employee form when an employee is selected
  useEffect(() => {
    if (selectedEmployeeId == null) return;
    const e = employees.find(emp => emp.id === selectedEmployeeId);
    if (!e) return;
    setEmpForm({
      annual_ctc: Number(e.annual_ctc ?? 0),
      basic_percentage: Number(e.basic_percentage ?? 40),
      hra_percentage: Number(e.hra_percentage ?? 50),
      da_percentage: Number(e.da_percentage ?? 0),
      conveyance_allowance: Number(e.conveyance_allowance ?? 1600),
      pf_enabled: e.pf_enabled !== false,
      esi_enabled: e.esi_enabled !== false,
      pt_enabled: e.pt_enabled !== false,
      tds_enabled: e.tds_enabled !== false,
      lwf_enabled: !!e.lwf_enabled,
      pf_employee_percentage: Number(e.pf_employee_percentage ?? 12),
      pf_employer_percentage: Number(e.pf_employer_percentage ?? 12),
      pf_wage_cap: Number(e.pf_wage_cap ?? 15000),
      esi_employee_percentage: Number(e.esi_employee_percentage ?? 0.75),
      esi_employer_percentage: Number(e.esi_employer_percentage ?? 3.25),
      esi_threshold: Number(e.esi_threshold ?? 21000),
      pt_state: e.pt_state ?? 'maharashtra',
      tax_regime: e.tax_regime ?? 'new',
      is_metro_city: e.is_metro_city !== false,
      is_active: e.is_active !== false,
    });
    setSavedMessage(null);
    setErrorMessage(null);
  }, [selectedEmployeeId, employees]);

  // Save employee template
  const saveEmployeeMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      payrollApi.updateEmployeeTemplate(selectedEmployeeId!, data).then(r => r.data),
    onSuccess: () => {
      // Refresh the department list so the saved `pt_state` is
      // reflected in subsequent reads (the API now returns it on
      // the employee list, so the next mount of the wizard will
      // hydrate the right dropdown value).
      queryClient.invalidateQueries({ queryKey: ['payroll', 'dept-employees', selectedDeptId] });
      queryClient.invalidateQueries({ queryKey: ['payroll', 'department-employees', selectedDeptId] });
      setSavedMessage('Employee template saved.');
      setErrorMessage(null);
    },
    onError: (err: any) => {
      setErrorMessage(err?.message || 'Failed to save template.');
      setSavedMessage(null);
    },
  });

  const selectedEmployee = employees.find(e => e.id === selectedEmployeeId) || null;
  const selectedDept = departmentsList.find(d => d.id === selectedDeptId) || null;

  const formatCtc = (n: number) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            iconLeft={<ArrowLeft className="h-4 w-4" />}
          >
            Back to Payroll
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Salary Templates</h1>
        </div>
        <p className="mt-1 max-w-3xl text-xs text-slate-500">
          Pick a department, then an employee, to edit their salary structure. Department-level templates only seed defaults for new hires.
        </p>
      </div>

      {deptsLoading ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
        </div>
      ) : departmentsList.length === 0 ? (
        <SurfaceCard className="p-6 text-center text-slate-500">
          <Building2 className="h-8 w-8 mx-auto mb-2 text-slate-300" />
          <p>No departments found. Create departments first to manage employee templates.</p>
        </SurfaceCard>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Left rail: departments */}
          <SurfaceCard className="p-4">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Departments</h3>
            <div className="space-y-1 max-h-[600px] overflow-y-auto">
              {departmentsList.map(d => {
                const empCount = d.id === selectedDeptId ? employees.length : null;
                return (
                  <button
                    key={d.id}
                    onClick={() => setSelectedDeptId(d.id)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
                      selectedDeptId === d.id
                        ? 'bg-blue-50 text-blue-900 border border-blue-200'
                        : 'hover:bg-slate-50 text-slate-700 border border-transparent'
                    }`}
                  >
                    <span className="truncate flex items-center gap-2">
                      <Building2 className="h-3.5 w-3.5 flex-shrink-0" />
                      {d.name}
                    </span>
                    {empCount != null && (
                      <span className="text-[10px] text-slate-400 flex-shrink-0">{empCount}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </SurfaceCard>

          {/* Middle column: employees in the selected department */}
          <SurfaceCard className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-700">
                {selectedDept ? `${selectedDept.name} — Employees` : 'Employees'}
              </h3>
            </div>

            {selectedDept && (
              <div className="relative mb-3">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search employees…"
                  className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            )}

            <div className="space-y-1 max-h-[540px] overflow-y-auto">
              {!selectedDept ? (
                <p className="text-sm text-slate-400 text-center py-6">Select a department to view employees.</p>
              ) : empsLoading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                </div>
              ) : filteredEmployees.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-6">No employees in this department.</p>
              ) : (
                filteredEmployees.map((e: any) => {
                  const hasCtc = e.annual_ctc && e.annual_ctc > 0;
                  return (
                    <button
                      key={e.id}
                      onClick={() => setSelectedEmployeeId(e.id)}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-left transition-colors ${
                        selectedEmployeeId === e.id
                          ? 'bg-blue-50 text-blue-900 border border-blue-200'
                          : 'hover:bg-slate-50 text-slate-700 border border-transparent'
                      }`}
                    >
                      <div className="h-8 w-8 rounded-full bg-gradient-to-br from-blue-100 to-violet-100 flex items-center justify-center flex-shrink-0">
                        {e.avatar ? (
                          <img src={e.avatar} alt={e.name} className="h-8 w-8 rounded-full" />
                        ) : (
                          <span className="text-xs font-semibold text-blue-600">
                            {(e.name || '?').charAt(0)}
                          </span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{e.name}</div>
                        <div className="text-xs text-slate-500 truncate">
                          {e.designation || e.email}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        {hasCtc ? (
                          <>
                            <div className="text-xs font-semibold text-slate-900">{formatCtc(e.annual_ctc)}</div>
                            <div className="text-[10px] text-emerald-600">CTC set</div>
                          </>
                        ) : (
                          <div className="text-[10px] text-amber-600">No CTC</div>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </SurfaceCard>

          {/* Right column: selected employee template editor */}
          <SurfaceCard className="p-6 lg:col-span-2 space-y-4">
            {!selectedEmployee ? (
              <div className="flex flex-col items-center justify-center py-16 text-center text-slate-500">
                <User className="h-10 w-10 mb-3 text-slate-300" />
                <p className="font-medium">Select an employee</p>
                <p className="text-sm text-slate-400 mt-1">
                  {selectedDept
                    ? 'Pick someone from the employees list to edit their salary structure.'
                    : 'Pick a department first, then choose an employee.'}
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900">{selectedEmployee.name}</h3>
                    <p className="text-sm text-slate-500">
                      {selectedEmployee.designation || selectedEmployee.email}
                      {selectedEmployee.employee_code ? ` · ${selectedEmployee.employee_code}` : ''}
                    </p>
                  </div>
                  <button
                    onClick={() => setSelectedEmployeeId(null)}
                    className="p-1 text-slate-400 hover:text-slate-600"
                    title="Close editor"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {!selectedEmployee.annual_ctc || selectedEmployee.annual_ctc <= 0 ? (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                    <div className="text-sm text-amber-800">
                      This employee doesn't have a CTC set yet. Saving the form below will create their template and apply the values.
                    </div>
                  </div>
                ) : null}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <FieldLabel>Annual CTC (₹)</FieldLabel>
                    <TextInput
                      type="number"
                      value={String(empForm.annual_ctc)}
                      onChange={e => setEmpForm({ ...empForm, annual_ctc: parseFloat(e.target.value) || 0 })}
                    />
                  </div>
                  <div>
                    <FieldLabel>Basic Salary (% of CTC)</FieldLabel>
                    <TextInput
                      type="number"
                      value={String(empForm.basic_percentage)}
                      onChange={e => setEmpForm({ ...empForm, basic_percentage: parseFloat(e.target.value) || 0 })}
                    />
                  </div>
                  <div>
                    <FieldLabel>HRA (% of Basic)</FieldLabel>
                    <TextInput
                      type="number"
                      value={String(empForm.hra_percentage)}
                      onChange={e => setEmpForm({ ...empForm, hra_percentage: parseFloat(e.target.value) || 0 })}
                    />
                  </div>
                  <div>
                    <FieldLabel>Conveyance Allowance (₹)</FieldLabel>
                    <TextInput
                      type="number"
                      value={String(empForm.conveyance_allowance)}
                      onChange={e => setEmpForm({ ...empForm, conveyance_allowance: parseFloat(e.target.value) || 0 })}
                    />
                  </div>
                  <div>
                    <FieldLabel>DA (% of CTC)</FieldLabel>
                    <TextInput
                      type="number"
                      value={String(empForm.da_percentage)}
                      onChange={e => setEmpForm({ ...empForm, da_percentage: parseFloat(e.target.value) || 0 })}
                    />
                  </div>
                  <div>
                    <FieldLabel>State (Professional Tax)</FieldLabel>
                    <SelectInput
                      value={empForm.pt_state}
                      onChange={e => setEmpForm({ ...empForm, pt_state: e.target.value })}
                    >
                      {INDIAN_STATES.map(s => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </SelectInput>
                  </div>
                  <div>
                    <FieldLabel>Tax Regime</FieldLabel>
                    <SelectInput
                      value={empForm.tax_regime}
                      onChange={e => setEmpForm({ ...empForm, tax_regime: e.target.value })}
                    >
                      <option value="new">New Regime</option>
                      <option value="old">Old Regime</option>
                    </SelectInput>
                  </div>
                  <div>
                    <FieldLabel>ESI Threshold (₹/mo)</FieldLabel>
                    <TextInput
                      type="number"
                      value={String(empForm.esi_threshold)}
                      onChange={e => setEmpForm({ ...empForm, esi_threshold: parseFloat(e.target.value) || 0 })}
                    />
                  </div>
                </div>

                <div className="border-t border-slate-200 pt-4">
                  <h4 className="text-sm font-medium text-slate-700 mb-3">Statutory Toggles</h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {([
                      ['pf_enabled', 'Provident Fund'],
                      ['esi_enabled', 'ESI'],
                      ['pt_enabled', 'Professional Tax'],
                      ['tds_enabled', 'TDS'],
                      ['lwf_enabled', 'LWF'],
                      ['is_metro_city', 'Metro City'],
                      ['is_active', 'Active'],
                    ] as const).map(([key, label]) => (
                      <label key={key} className="flex items-center gap-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={!!empForm[key]}
                          onChange={e => setEmpForm({ ...empForm, [key]: e.target.checked })}
                          className="rounded border-slate-300"
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>

                {savedMessage && (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm text-emerald-800">
                    {savedMessage}
                  </div>
                )}
                {errorMessage && (
                  <div className="bg-rose-50 border border-rose-200 rounded-lg p-3 text-sm text-rose-800">
                    {errorMessage}
                  </div>
                )}

                <div className="flex items-center justify-end gap-3 pt-2">
                  <Button
                    variant="primary"
                    onClick={() => saveEmployeeMutation.mutate(empForm as unknown as Record<string, unknown>)}
                    disabled={saveEmployeeMutation.isPending}
                    iconLeft={saveEmployeeMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  >
                    {saveEmployeeMutation.isPending ? 'Saving…' : 'Save employee template'}
                  </Button>
                </div>
              </>
            )}
          </SurfaceCard>
        </div>
      )}

    </div>
  );
}
