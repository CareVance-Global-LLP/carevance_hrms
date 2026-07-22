import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, Save, Users, Loader2, ArrowLeft } from 'lucide-react';
import { payrollApi } from '@/services/api';
import Button from '@/components/ui/Button';
import { TextInput, SelectInput } from '@/components/ui/FormField';

const INDIAN_STATES = [
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

interface EmpFormState {
  annual_ctc: number | null;
  salary_template_id: number | null;
  pt_state: string;
}

const defaultEmpForm: EmpFormState = {
  annual_ctc: null,
  salary_template_id: null,
  pt_state: 'maharashtra',
};

interface EmployeePayrollCardsProps {
  onBack: () => void;
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export default function EmployeePayrollCards({ onBack }: EmployeePayrollCardsProps) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedPayGroupId, setSelectedPayGroupId] = useState<number | null>(null);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | null>(null);
  const [empForm, setEmpForm] = useState<EmpFormState>(defaultEmpForm);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { data: payGroupsData, isLoading: payGroupsLoading } = useQuery({
    queryKey: ['payroll', 'pay-groups-payroll-cards'],
    queryFn: () => payrollApi.listPayGroups().then(r => r.data),
  });

  const { data: structuresData } = useQuery({
    queryKey: ['salary-structures'],
    queryFn: () => payrollApi.getSalaryStructures().then(r => r.data),
  });

  const salaryStructures = structuresData?.templates || [];

  const payGroupsList = useMemo(
    () => (payGroupsData?.pay_groups || []) as Array<{ id: number; name: string; employee_count: number }>,
    [payGroupsData],
  );

  useEffect(() => {
    if (selectedPayGroupId == null && payGroupsList.length > 0) {
      setSelectedPayGroupId(payGroupsList[0].id);
    }
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
      payrollApi.updateEmployeePayrollCard(userId, data as unknown as Record<string, unknown>).then(r => r.data),
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
  const selectedPayGroup = payGroupsList.find(g => g.id === selectedPayGroupId) || null;

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
        pt_state: payrollConfig.pt_state ?? 'maharashtra',
      });
    } else {
      setEmpForm(defaultEmpForm);
    }
    setSavedMessage(null);
    setErrorMessage(null);
  }, [selectedEmployeeId, payrollConfig]);

  const handleSave = () => {
    if (!selectedEmployeeId) return;
    saveMutation.mutate({ userId: selectedEmployeeId, data: empForm });
  };

  if (loadingEmployees && payGroupsList.length === 0) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="h-64 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          iconLeft={<ArrowLeft className="h-4 w-4" />}
        >
          Back to Payroll
        </Button>
      </div>

      <div className="grid grid-cols-[180px_240px_1fr] gap-0 border border-gray-200 rounded-lg overflow-hidden h-[520px]">
        <div className="border-r border-gray-200 overflow-y-auto">
          <div className="p-3 border-b border-gray-200 text-xs font-semibold text-gray-400">
            PAY GROUPS
          </div>
          {payGroupsLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-4 w-4 animate-spin text-teal-700" />
            </div>
          ) : payGroupsList.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-6 px-2">No pay groups found.</p>
          ) : (
            payGroupsList.map((g) => (
              <button
                key={g.id}
                onClick={() => setSelectedPayGroupId(g.id)}
                className={`w-full text-left px-3 py-2.5 text-sm cursor-pointer transition-colors ${
                  selectedPayGroupId === g.id
                    ? 'bg-teal-50 border-l-[3px] border-l-teal-700 font-semibold text-gray-900'
                    : 'border-l-[3px] border-l-transparent hover:bg-gray-50 text-gray-500'
                }`}
              >
                {g.name}
              </button>
            ))
          )}
        </div>

        <div className="border-r border-gray-200 overflow-y-auto">
          <div className="p-2.5 border-b border-gray-200">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
                className="w-full pl-7 pr-2.5 py-1.5 border border-gray-200 rounded-md text-xs focus:ring-1 focus:ring-teal-500 focus:border-teal-500 outline-none"
              />
            </div>
          </div>

          {!selectedPayGroup ? (
            <p className="text-xs text-gray-400 text-center py-6">Select a pay group to view employees.</p>
          ) : loadingEmployees ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-4 w-4 animate-spin text-teal-700" />
            </div>
          ) : filteredEmployees.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-6">No employees in this pay group.</p>
          ) : (
            filteredEmployees.map((emp) => (
              <div
                key={emp.id}
                onClick={() => { setSelectedEmployeeId(emp.id); setSavedMessage(null); setErrorMessage(null); }}
                className={`px-2.5 py-2.5 cursor-pointer transition-colors ${
                  selectedEmployeeId === emp.id
                    ? 'bg-teal-50 border-l-[3px] border-l-teal-700'
                    : 'border-l-[3px] border-l-transparent hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className="w-[26px] h-[26px] rounded-full bg-teal-700 text-white flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                    {getInitials(emp.name)}
                  </div>
                  <div className="min-w-0">
                    <div className={`text-[13px] truncate ${selectedEmployeeId === emp.id ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
                      {emp.name}
                    </div>
                    <div className="text-[11px] text-gray-500 truncate">
                      {Number(emp.annual_ctc) > 0 ? `₹${(Number(emp.annual_ctc) / 100000).toFixed(1)}L CTC` : 'CTC not set'}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="overflow-y-auto p-4">
          {loadingDetail ? (
            <div className="flex-1 flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-teal-700" />
            </div>
          ) : detailError ? (
            <div className="flex-1 flex items-center justify-center py-12">
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
          ) : selectedEmployee ? (
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-bold text-gray-900">{selectedEmployee.name} — Payroll Card</div>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleSave}
                  disabled={saveMutation.isPending}
                  iconLeft={saveMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                >
                  {saveMutation.isPending ? 'Saving…' : 'Save Changes'}
                </Button>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Annual CTC (₹)</label>
                  <TextInput
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={empForm.annual_ctc != null ? String(empForm.annual_ctc) : ''}
                    onChange={e => {
                      const raw = e.target.value.replace(/[^0-9]/g, '');
                      setEmpForm({ ...empForm, annual_ctc: raw ? Number(raw) : null });
                    }}
                    placeholder="e.g., 600000"
                    className="[&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [-moz-appearance:textfield]"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Salary Template</label>
                  <SelectInput
                    value={empForm.salary_template_id ?? ''}
                    onChange={e => setEmpForm({ ...empForm, salary_template_id: e.target.value ? Number(e.target.value) : null })}
                  >
                    <option value="">— None —</option>
                    {salaryStructures.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </SelectInput>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">PT State</label>
                  <SelectInput
                    value={empForm.pt_state}
                    onChange={e => setEmpForm({ ...empForm, pt_state: e.target.value })}
                  >
                    {INDIAN_STATES.map(s => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </SelectInput>
                </div>
              </div>

              <div className="h-px bg-gray-200 my-4"></div>

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
          ) : (
            <div className="flex-1 flex items-center justify-center py-12">
              <div className="text-center text-gray-500">
                <Users className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                <p className="text-sm">Select an employee to view their payroll card</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
