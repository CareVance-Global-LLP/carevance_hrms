import { useState } from 'react';
import { Calculator, MapPin, Building } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { payrollApi } from '@/services/api';
import Button from '@/components/ui/Button';
import { TextInput, SelectInput, FieldLabel } from '@/components/ui/FormField';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import SalaryBreakdown from './SalaryBreakdown';
import type { PayrollCalculation } from '@/types';

interface EmployeePayrollFormProps {
  onCalculationComplete?: (calculation: PayrollCalculation) => void;
}

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

export default function EmployeePayrollForm({ onCalculationComplete }: EmployeePayrollFormProps) {
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [annualCtc, setAnnualCtc] = useState('');
  const [state, setState] = useState('maharashtra');
  const [isMetroCity, setIsMetroCity] = useState(true);
  const [calculation, setCalculation] = useState<PayrollCalculation | null>(null);

  const { data: employees, isLoading: employeesLoading } = useQuery({
    queryKey: ['payroll', 'employees'],
    queryFn: () => payrollApi.getEmployees().then(res => res.data),
  });

  const handleCalculate = async () => {
    if (!selectedEmployeeId || !annualCtc) return;

    try {
      const response = await payrollApi.calculate({
        user_id: parseInt(selectedEmployeeId),
        annual_ctc: parseFloat(annualCtc),
        state,
        tax_regime: 'new',
        is_metro_city: isMetroCity,
      });

      setCalculation(response.data.calculation);
      onCalculationComplete?.(response.data.calculation);
    } catch (error) {
      console.error('Failed to calculate payroll:', error);
    }
  };

  const employeeOptions = employees?.map(emp => ({
    value: String(emp.id),
    label: emp.name,
  })) || [];

  return (
    <div className="space-y-6">
      <SurfaceCard className="p-6">
        <div className="flex items-center gap-2 mb-6">
          <Calculator className="h-5 w-5 text-blue-600" />
          <h3 className="text-lg font-semibold text-slate-900">Calculate Payroll</h3>
        </div>

        <div className="space-y-4">
          <div>
            <FieldLabel>Select Employee</FieldLabel>
            <SelectInput
              value={selectedEmployeeId}
              onChange={(e) => setSelectedEmployeeId(e.target.value)}
              disabled={employeesLoading}
            >
              <option value="">Choose an employee</option>
              {employeeOptions.map((emp) => (
                <option key={emp.value} value={emp.value}>
                  {emp.label}
                </option>
              ))}
            </SelectInput>
          </div>

          <div>
            <FieldLabel>Annual CTC (Rs)</FieldLabel>
            <TextInput
              type="number"
              placeholder="e.g., 1200000"
              value={annualCtc}
              onChange={(e) => setAnnualCtc(e.target.value)}
              min="0"
              step="1000"
            />
          </div>

          <div>
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-slate-400" />
              <FieldLabel>State (for PT calculation)</FieldLabel>
            </div>
            <SelectInput
              value={state}
              onChange={(e) => setState(e.target.value)}
            >
              {INDIAN_STATES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </SelectInput>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Building className="h-4 w-4 text-slate-400" />
              <FieldLabel className="mb-0">Metro City (50% HRA)</FieldLabel>
            </div>
            <label className="relative inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                checked={isMetroCity}
                onChange={(e) => setIsMetroCity(e.target.checked)}
                className="sr-only peer"
              />
              <div className="h-6 w-11 rounded-full bg-slate-200 peer-checked:bg-blue-600 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-slate-300 after:bg-white after:transition-all peer-checked:after:translate-x-full" />
            </label>
          </div>

          <Button
            onClick={handleCalculate}
            disabled={!selectedEmployeeId || !annualCtc}
            className="w-full"
            iconLeft={<Calculator className="h-4 w-4" />}
          >
            Calculate Payroll
          </Button>
        </div>
      </SurfaceCard>

      <SalaryBreakdown calculation={calculation} />
    </div>
  );
}
