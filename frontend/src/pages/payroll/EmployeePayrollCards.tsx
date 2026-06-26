import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, Save, Users, Loader2, ArrowLeft } from 'lucide-react';
import { payrollApi } from '@/services/api';
import Button from '@/components/ui/Button';
import { TextInput, SelectInput, FieldLabel } from '@/components/ui/FormField';

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
  annual_ctc: number;
  salary_template_id: number | null;
  pt_state: string;
}

const defaultEmpForm: EmpFormState = {
  annual_ctc: 0,
  salary_template_id: null,
  pt_state: 'maharashtra',
};

interface EmployeePayrollCardsProps {
  onBack: () => void;
}

export default function EmployeePayrollCards({ onBack }: EmployeePayrollCardsProps) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | null>(null);
  const [empForm, setEmpForm] = useState<EmpFormState>(defaultEmpForm);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { data: structuresData } = useQuery({
    queryKey: ['salary-structures'],
    queryFn: () => payrollApi.getSalaryStructures().then(r => r.data),
  });

  const salaryStructures = structuresData?.templates || [];

  const { data: employeesData, isLoading: loadingEmployees } = useQuery({
    queryKey: ['employee-payroll-cards'],
    queryFn: () => payrollApi.getEmployeePayrollCards(),
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

  useEffect(() => {
    setSelectedEmployeeId(null);
    setSavedMessage(null);
    setErrorMessage(null);
  }, []);

  useEffect(() => {
    if (!selectedEmployeeId) return;
    if (payrollConfig) {
      setEmpForm({
        annual_ctc: Number(payrollConfig.annual_ctc ?? 0),
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

  if (loadingEmployees) {
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
      <div className="flex h-[calc(100vh-12rem)]">
      {/* Employee list */}
      <div className="w-1/3 border-r border-gray-200 flex flex-col">
        <div className="p-3 border-b border-gray-200">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">
            Employees
          </h3>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search employees..."
              className="w-full pl-8 pr-3 py-1.5 border border-gray-300 rounded-md text-sm focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filteredEmployees.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">No employees found.</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {filteredEmployees.map((emp) => (
                <div
                  key={emp.id}
                  onClick={() => { setSelectedEmployeeId(emp.id); setSavedMessage(null); setErrorMessage(null); }}
                  className={`p-3 cursor-pointer hover:bg-gray-50 transition-colors ${
                    selectedEmployeeId === emp.id ? 'bg-indigo-50 border-l-4 border-indigo-600' : ''
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="min-w-0">
                      <div className="font-medium text-gray-900 truncate">{emp.name}</div>
                      <div className="text-xs text-gray-500 truncate">{emp.email}</div>
                    </div>
                    <div className="text-right flex-shrink-0 ml-2">
                      {emp.annual_ctc ? (
                        <div className="text-xs font-medium text-gray-900">
                          ₹{(emp.annual_ctc / 100000).toFixed(2)}L
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Payroll detail form */}
      <div className="flex-1 flex flex-col">
        {loadingDetail ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-indigo-600" />
          </div>
        ) : detailError ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-red-500">
              <p className="font-medium">Failed to load employee details</p>
              <p className="text-sm mt-1">{detailErrorMsg?.message || 'Unknown error'}</p>
              <button
                onClick={() => queryClient.invalidateQueries({ queryKey: ['employee-payroll-card', selectedEmployeeId] })}
                className="mt-3 px-3 py-1.5 text-sm bg-red-50 text-red-700 rounded-md hover:bg-red-100"
              >
                Retry
              </button>
            </div>
          </div>
        ) : selectedEmployee ? (
          <>
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h3 className="font-medium text-gray-900">{selectedEmployee.name}</h3>
                <p className="text-sm text-gray-500">{selectedEmployee.email}</p>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="grid grid-cols-1 gap-4 max-w-md">
                <div>
                  <FieldLabel>Annual CTC (₹)</FieldLabel>
                  <TextInput
                    type="number"
                    value={String(empForm.annual_ctc)}
                    onChange={e => setEmpForm({ ...empForm, annual_ctc: parseFloat(e.target.value) || 0 })}
                  />
                </div>
                <div>
                  <FieldLabel>Salary Template</FieldLabel>
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
            </div>

            <div className="p-4 border-t border-gray-200 flex justify-end gap-3">
              <Button
                variant="primary"
                onClick={handleSave}
                disabled={saveMutation.isPending}
                iconLeft={saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              >
                {saveMutation.isPending ? 'Saving…' : 'Save employee template'}
              </Button>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-gray-500">
              <Users className="w-8 h-8 mx-auto mb-2 text-gray-300" />
              <p>Select an employee to view their payroll card</p>
            </div>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
