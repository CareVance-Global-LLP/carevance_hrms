import { useState, useEffect } from 'react';
import { 
  ArrowLeft, 
  Save, 
  Calculator,
  User,
  Clock,
  Activity,
  TrendingUp,
  TrendingDown,
  Building2,
  MapPin,
  Wallet,
  CheckCircle2,
  ToggleLeft,
  ToggleRight,
  Settings,
  Info
} from 'lucide-react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { payrollApi } from '@/services/api';
import Button from '@/components/ui/Button';
import { TextInput, SelectInput, FieldLabel } from '@/components/ui/FormField';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import type { EmployeePayrollDetails, EmployeePayrollTemplate, PayrollCalculation } from '@/types';

interface EmployeePayrollDetailProps {
  employeeId: number;
  monthYear: string;
  onBack: () => void;
}

function formatCurrency(amount: number): string {
  return '₹' + amount.toLocaleString('en-IN', { minimumFractionDigits: 2 });
}

function formatNumber(value: number): string {
  // Remove unnecessary decimal places (40.00 becomes 40, but 40.50 stays 40.5)
  if (value === 0) return '0';
  return String(Number(value));
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

export default function EmployeePayrollDetail({ employeeId, monthYear, onBack }: EmployeePayrollDetailProps) {
  const [annualCtc, setAnnualCtc] = useState('');
  const [workingDays, setWorkingDays] = useState('26');
  const [daysPresent, setDaysPresent] = useState('26');
  const [lOPDays, setLOPDays] = useState('0');
  const [overtimeHours, setOvertimeHours] = useState('0');
  const [template, setTemplate] = useState<EmployeePayrollTemplate | null>(null);
  const [calculation, setCalculation] = useState<PayrollCalculation | null>(null);
  const [hasUserEditedCtc, setHasUserEditedCtc] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['payroll', 'employee', employeeId, monthYear],
    queryFn: () => payrollApi.getEmployeePayrollDetails(employeeId, { month_year: monthYear }).then(res => res.data),
  });

  const updateTemplateMutation = useMutation({
    mutationFn: (templateData: Partial<EmployeePayrollTemplate>) => 
      payrollApi.updateEmployeeTemplate(employeeId, templateData),
    onSuccess: (res) => {
      setTemplate(res.data.template);
    },
  });

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
  });

  useEffect(() => {
    if (data) {
      setTemplate(data.template);
      if (!hasUserEditedCtc) {
        // Try to load annual_ctc from template first, then from preview
        const savedCtc = data.template.annual_ctc;
        const previewCtc = data.payroll_preview?.annual?.ctc;
        const ctc = savedCtc || previewCtc || '';
        if (ctc) {
          setAnnualCtc(String(ctc));
        }
        if (data.payroll_preview) {
          setCalculation(data.payroll_preview);
        }
      }
    }
  }, [data, hasUserEditedCtc]);

  const handleCalculatePreview = async () => {
    if (!annualCtc || !template) return;
    // Save annual_ctc to template for future use
    if (parseFloat(annualCtc) !== template.annual_ctc) {
      updateTemplateMutation.mutate({ annual_ctc: parseFloat(annualCtc) });
    }
    await handleCalculatePreviewWithTemplate(template);
  };

  const handleCalculatePreviewWithTemplate = async (templateToUse: EmployeePayrollTemplate) => {
    if (!annualCtc) return;
    
    try {
      const res = await payrollApi.calculate({
        user_id: employeeId,
        annual_ctc: parseFloat(annualCtc),
        state: templateToUse.pt_state ?? 'maharashtra',
        tax_regime: templateToUse.tax_regime ?? 'new',
        is_metro_city: templateToUse.is_metro_city ?? true,
      });
      console.log('API Response:', res.data);
      // Update the calculation with the template settings applied
      const updatedCalculation = {
        ...res.data.calculation,
        // Apply deduction toggles
        components: {
          ...res.data.calculation.components,
          deductions: {
            ...res.data.calculation.components.deductions,
            pf_employee: templateToUse.pf_enabled ? res.data.calculation.components.deductions.pf_employee : 0,
            esi_employee: templateToUse.esi_enabled ? res.data.calculation.components.deductions.esi_employee : 0,
            pt: templateToUse.pt_enabled ? res.data.calculation.components.deductions.pt : 0,
            tds: templateToUse.tds_enabled ? res.data.calculation.components.deductions.tds : 0,
          },
          employer_contributions: {
            ...res.data.calculation.components.employer_contributions,
            pf_employer: templateToUse.pf_enabled ? res.data.calculation.components.employer_contributions.pf_employer : 0,
            eps: templateToUse.pf_enabled ? res.data.calculation.components.employer_contributions.eps : 0,
            epf: templateToUse.pf_enabled ? res.data.calculation.components.employer_contributions.epf : 0,
            esi_employer: templateToUse.esi_enabled ? res.data.calculation.components.employer_contributions.esi_employer : 0,
            gratuity: res.data.calculation.components.employer_contributions.gratuity,
          },
        },
      };
      
      // Recalculate total deductions and net pay based on toggles
      const totalDeductions = 
        (templateToUse.pf_enabled ? updatedCalculation.components.deductions.pf_employee : 0) +
        (templateToUse.esi_enabled ? updatedCalculation.components.deductions.esi_employee : 0) +
        (templateToUse.pt_enabled ? updatedCalculation.components.deductions.pt : 0) +
        (templateToUse.tds_enabled ? updatedCalculation.components.deductions.tds : 0);
      
      updatedCalculation.monthly.total_deductions = totalDeductions;
      updatedCalculation.monthly.net = updatedCalculation.monthly.gross - totalDeductions;
      
      setCalculation(updatedCalculation);
    } catch (error) {
      console.error('Calculation failed:', error);
    }
  };

  const handleToggleDeduction = (key: keyof EmployeePayrollTemplate, value: boolean) => {
    if (!template) return;
    updateTemplateMutation.mutate({ [key]: value });
    const newTemplate = { ...template, [key]: value };
    setTemplate(newTemplate);
    // Auto-recalculate if we already have a calculation
    if (calculation && annualCtc) {
      handleCalculatePreviewWithTemplate(newTemplate);
    }
  };

  const handleUpdateTemplateField = (field: keyof EmployeePayrollTemplate, value: any) => {
    if (!template) return;
    updateTemplateMutation.mutate({ [field]: value });
    const newTemplate = { ...template, [field]: value };
    setTemplate(newTemplate);
    // Auto-recalculate if we already have a calculation and the field affects salary
    const fieldsThatAffectSalary = ['basic_percentage', 'hra_percentage', 'conveyance_allowance', 'pt_state', 'tax_regime', 'is_metro_city'];
    if (calculation && annualCtc && fieldsThatAffectSalary.includes(field)) {
      handleCalculatePreviewWithTemplate(newTemplate);
    }
  };

  if (isLoading || !data || !template) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  const { employee, time_tracking } = data;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" onClick={onBack} iconLeft={<ArrowLeft className="h-4 w-4" />}>
          Back
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-slate-900">{employee.name}</h1>
          <div className="flex items-center gap-4 text-sm text-slate-500">
            <span>{employee.designation}</span>
            <span>•</span>
            <span>{employee.department || 'No Department'}</span>
            <span>•</span>
            <span>{employee.employee_code || 'No Code'}</span>
          </div>
        </div>
        <Button 
          variant="primary" 
          onClick={() => processPayrollMutation.mutate()}
          disabled={!calculation || processPayrollMutation.isPending}
          iconLeft={<Save className="h-4 w-4" />}
        >
          {processPayrollMutation.isPending ? 'Processing...' : 'Save Payroll'}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Employee Info & Time Tracking */}
        <div className="space-y-6">
          {/* Employee Info */}
          <SurfaceCard className="p-5">
            <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
              <User className="h-4 w-4 text-blue-600" />
              Employee Information
            </h3>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Email</span>
                <span>{employee.email}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">PAN</span>
                <span>{employee.pan_number || 'Not set'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">UAN</span>
                <span>{employee.uan_number || 'Not set'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Joining Date</span>
                <span>{employee.joining_date ? new Date(employee.joining_date).toLocaleDateString() : 'N/A'}</span>
              </div>
            </div>
          </SurfaceCard>

          {/* Time Tracking Summary */}
          <SurfaceCard className="p-5">
            <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
              <Clock className="h-4 w-4 text-blue-600" />
              Time Tracking Summary
            </h3>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-blue-50 rounded-lg p-3">
                  <p className="text-xs text-blue-600">Total Hours</p>
                  <p className="text-xl font-bold text-blue-900">{time_tracking.total_worked_hours.toFixed(1)}h</p>
                </div>
                <div className="bg-emerald-50 rounded-lg p-3">
                  <p className="text-xs text-emerald-600">Productive</p>
                  <p className="text-xl font-bold text-emerald-900">{time_tracking.total_productive_hours.toFixed(1)}h</p>
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500 flex items-center gap-2">
                    <Activity className="h-3 w-3" />
                    Activity Rate
                  </span>
                  <span className="font-medium">{time_tracking.activity_percentage.toFixed(0)}%</span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-blue-500 rounded-full"
                    style={{ width: `${Math.min(time_tracking.activity_percentage, 100)}%` }}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500">Productivity Score</span>
                  <span className="font-medium">{time_tracking.productivity_score.toFixed(0)}%</span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-emerald-500 rounded-full"
                    style={{ width: `${Math.min(time_tracking.productivity_score, 100)}%` }}
                  />
                </div>
              </div>
              <div className="pt-3 border-t border-slate-200 grid grid-cols-2 gap-4 text-center">
                <div>
                  <p className="text-xs text-rose-500">Idle Hours</p>
                  <p className="font-semibold">{time_tracking.total_idle_hours.toFixed(1)}h</p>
                </div>
                <div>
                  <p className="text-xs text-amber-500">Unproductive</p>
                  <p className="font-semibold">{time_tracking.total_unproductive_hours.toFixed(1)}h</p>
                </div>
              </div>
            </div>
          </SurfaceCard>

          {/* Attendance Inputs */}
          <SurfaceCard className="p-5">
            <h3 className="font-semibold text-slate-900 mb-4">Attendance Details</h3>
            <div className="space-y-4">
              <div>
                <FieldLabel>Working Days</FieldLabel>
                <TextInput
                  type="number"
                  value={workingDays}
                  onChange={(e) => setWorkingDays(e.target.value)}
                  min="1"
                  max="31"
                />
              </div>
              <div>
                <FieldLabel>Days Present</FieldLabel>
                <TextInput
                  type="number"
                  value={daysPresent}
                  onChange={(e) => setDaysPresent(e.target.value)}
                  min="0"
                  max={workingDays}
                />
              </div>
              <div>
                <FieldLabel>LOP Days</FieldLabel>
                <TextInput
                  type="number"
                  value={lOPDays}
                  onChange={(e) => setLOPDays(e.target.value)}
                  min="0"
                  step="0.5"
                />
              </div>
              <div>
                <FieldLabel>Overtime Hours</FieldLabel>
                <TextInput
                  type="number"
                  value={overtimeHours}
                  onChange={(e) => setOvertimeHours(e.target.value)}
                  min="0"
                  step="0.5"
                />
              </div>
            </div>
          </SurfaceCard>
        </div>

        {/* Middle Column - Template Configuration */}
        <div className="space-y-6">
          <SurfaceCard className="p-5">
            <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
              <Settings className="h-4 w-4 text-blue-600" />
              Payroll Template
            </h3>
            <div className="space-y-4">
              {/* CTC Input */}
              <div>
                <FieldLabel>Annual CTC (₹)</FieldLabel>
                <TextInput
                  type="number"
                  placeholder="e.g., 1200000"
                  value={annualCtc}
                  onChange={(e) => {
                    setHasUserEditedCtc(true);
                    setAnnualCtc(e.target.value);
                  }}
                />
              </div>

              {/* Basic & HRA */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <FieldLabel>Basic (% of CTC)</FieldLabel>
                  <TextInput
                    type="number"
                    value={formatNumber(template.basic_percentage)}
                    onChange={(e) => handleUpdateTemplateField('basic_percentage', parseFloat(e.target.value) || 0)}
                    min="0"
                    max="100"
                  />
                </div>
                <div>
                  <FieldLabel>HRA (% of Basic)</FieldLabel>
                  <TextInput
                    type="number"
                    value={formatNumber(template.hra_percentage)}
                    onChange={(e) => handleUpdateTemplateField('hra_percentage', parseFloat(e.target.value) || 0)}
                    min="0"
                    max="100"
                  />
                </div>
              </div>

              {/* Allowances */}
              <div>
                <FieldLabel>Conveyance Allowance (₹)</FieldLabel>
                <TextInput
                  type="number"
                  value={formatNumber(template.conveyance_allowance)}
                  onChange={(e) => handleUpdateTemplateField('conveyance_allowance', parseFloat(e.target.value) || 0)}
                />
              </div>

              {/* State & Tax */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <MapPin className="h-3 w-3 text-slate-400" />
                    <FieldLabel className="mb-0">State (PT)</FieldLabel>
                  </div>
                  <SelectInput
                    value={template.pt_state}
                    onChange={(e) => handleUpdateTemplateField('pt_state', e.target.value)}
                  >
                    {INDIAN_STATES.map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </SelectInput>
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Building2 className="h-3 w-3 text-slate-400" />
                    <FieldLabel className="mb-0">Tax Regime</FieldLabel>
                  </div>
                  <SelectInput
                    value={template.tax_regime}
                    onChange={(e) => handleUpdateTemplateField('tax_regime', e.target.value)}
                  >
                    <option value="new">New Regime</option>
                    <option value="old">Old Regime</option>
                  </SelectInput>
                </div>
              </div>

              {/* Metro Toggle */}
              <div className="flex items-center justify-between py-2 border-t border-slate-200">
                <span className="text-sm text-slate-700">Metro City (50% HRA)</span>
                <button
                  onClick={() => handleUpdateTemplateField('is_metro_city', !template.is_metro_city)}
                  className="text-blue-600"
                >
                  {template.is_metro_city ? <ToggleRight className="h-6 w-6" /> : <ToggleLeft className="h-6 w-6" />}
                </button>
              </div>

              {/* Deduction Toggles */}
              <div className="space-y-3 border-t border-slate-200 pt-4">
                <h4 className="text-sm font-medium text-slate-900">Deductions</h4>
                
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm text-slate-700">Provident Fund (PF)</span>
                    <p className="text-xs text-slate-500">12% of basic salary</p>
                  </div>
                  <button
                    onClick={() => handleToggleDeduction('pf_enabled', !template.pf_enabled)}
                    className={template.pf_enabled ? 'text-blue-600' : 'text-slate-400'}
                  >
                    {template.pf_enabled ? <ToggleRight className="h-6 w-6" /> : <ToggleLeft className="h-6 w-6" />}
                  </button>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm text-slate-700">ESI</span>
                    <p className="text-xs text-slate-500">0.75% employee, 3.25% employer</p>
                  </div>
                  <button
                    onClick={() => handleToggleDeduction('esi_enabled', !template.esi_enabled)}
                    className={template.esi_enabled ? 'text-blue-600' : 'text-slate-400'}
                  >
                    {template.esi_enabled ? <ToggleRight className="h-6 w-6" /> : <ToggleLeft className="h-6 w-6" />}
                  </button>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm text-slate-700">Professional Tax</span>
                    <p className="text-xs text-slate-500">State-specific amount</p>
                  </div>
                  <button
                    onClick={() => handleToggleDeduction('pt_enabled', !template.pt_enabled)}
                    className={template.pt_enabled ? 'text-blue-600' : 'text-slate-400'}
                  >
                    {template.pt_enabled ? <ToggleRight className="h-6 w-6" /> : <ToggleLeft className="h-6 w-6" />}
                  </button>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm text-slate-700">Income Tax (TDS)</span>
                    <p className="text-xs text-slate-500">Based on tax regime</p>
                  </div>
                  <button
                    onClick={() => handleToggleDeduction('tds_enabled', !template.tds_enabled)}
                    className={template.tds_enabled ? 'text-blue-600' : 'text-slate-400'}
                  >
                    {template.tds_enabled ? <ToggleRight className="h-6 w-6" /> : <ToggleLeft className="h-6 w-6" />}
                  </button>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm text-slate-700">Labour Welfare Fund (LWF)</span>
                    <p className="text-xs text-slate-500">State-specific contribution</p>
                  </div>
                  <button
                    onClick={() => handleToggleDeduction('lwf_enabled', !template.lwf_enabled)}
                    className={template.lwf_enabled ? 'text-blue-600' : 'text-slate-400'}
                  >
                    {template.lwf_enabled ? <ToggleRight className="h-6 w-6" /> : <ToggleLeft className="h-6 w-6" />}
                  </button>
                </div>
              </div>

              <Button 
                onClick={handleCalculatePreview}
                disabled={!annualCtc}
                className="w-full"
                iconLeft={<Calculator className="h-4 w-4" />}
              >
                Calculate Preview
              </Button>
            </div>
          </SurfaceCard>
        </div>

        {/* Right Column - Salary Breakdown */}
        <div>
          <SurfaceCard className="p-5 sticky top-6">
            <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
              <Wallet className="h-4 w-4 text-blue-600" />
              Salary Breakdown
            </h3>

            {!calculation ? (
              <div className="text-center py-8 text-slate-500">
                <Calculator className="h-12 w-12 mx-auto mb-3 text-slate-300" />
                <p>Enter CTC and click Calculate</p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Summary */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-slate-50 rounded-lg p-3">
                    <p className="text-xs text-slate-500">Monthly CTC</p>
                    <p className="font-bold text-slate-900">{formatCurrency(calculation.monthly.ctc)}</p>
                  </div>
                  <div className="bg-emerald-50 rounded-lg p-3">
                    <p className="text-xs text-emerald-600">Net Pay</p>
                    <p className="font-bold text-emerald-900">{formatCurrency(calculation.monthly.net)}</p>
                  </div>
                </div>

                {/* Earnings */}
                <div>
                  <h4 className="text-xs font-medium text-emerald-600 uppercase tracking-wide mb-2 flex items-center gap-1">
                    <TrendingUp className="h-3 w-3" />
                    Earnings
                  </h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-slate-600">Basic ({template.basic_percentage}%)</span>
                      <span>{formatCurrency(calculation.components.earnings.basic)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600">HRA ({template.hra_percentage}%)</span>
                      <span>{formatCurrency(calculation.components.earnings.hra)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600">Conveyance</span>
                      <span>{formatCurrency(calculation.components.earnings.conveyance)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600">Special Allowance</span>
                      <span>{formatCurrency(calculation.components.earnings.special_allowance)}</span>
                    </div>
                    <div className="flex justify-between pt-2 border-t border-slate-200 font-medium">
                      <span>Gross Salary</span>
                      <span>{formatCurrency(calculation.monthly.gross)}</span>
                    </div>
                  </div>
                </div>

                {/* Deductions */}
                <div>
                  <h4 className="text-xs font-medium text-rose-600 uppercase tracking-wide mb-2 flex items-center gap-1">
                    <TrendingDown className="h-3 w-3" />
                    Deductions
                  </h4>
                  <div className="space-y-2 text-sm">
                    {template.pf_enabled && (
                      <div className="flex justify-between">
                        <span className="text-slate-600">PF (12%)</span>
                        <span>{formatCurrency(calculation.components.deductions.pf_employee)}</span>
                      </div>
                    )}
                    {template.esi_enabled && calculation.components.deductions.esi_employee > 0 && (
                      <div className="flex justify-between">
                        <span className="text-slate-600">ESI (0.75%)</span>
                        <span>{formatCurrency(calculation.components.deductions.esi_employee)}</span>
                      </div>
                    )}
                    {template.pt_enabled && (
                      <div className="flex justify-between">
                        <span className="text-slate-600">Professional Tax</span>
                        <span>{formatCurrency(calculation.components.deductions.pt)}</span>
                      </div>
                    )}
                    {template.tds_enabled && (
                      <div className="flex justify-between">
                        <span className="text-slate-600">TDS (Income Tax)</span>
                        <span>{formatCurrency(calculation.components.deductions.tds)}</span>
                      </div>
                    )}
                    {template.lwf_enabled && (
                      <div className="flex justify-between">
                        <span className="text-slate-600">LWF</span>
                        <span>{formatCurrency(30)}</span>
                      </div>
                    )}
                    <div className="flex justify-between pt-2 border-t border-slate-200 font-medium text-rose-600">
                      <span>Total Deductions</span>
                      <span>{formatCurrency(calculation.monthly.total_deductions)}</span>
                    </div>
                  </div>
                </div>

                {/* Employer Contributions */}
                <div className="bg-blue-50 rounded-lg p-3">
                  <h4 className="text-xs font-medium text-blue-900 mb-2">Employer Contributions</h4>
                  <div className="space-y-1 text-sm">
                    {template.pf_enabled && (
                      <div className="flex justify-between text-blue-800">
                        <span>PF (12%)</span>
                        <span>{formatCurrency(calculation.components.employer_contributions.pf_employer)}</span>
                      </div>
                    )}
                    {template.esi_enabled && calculation.components.employer_contributions.esi_employer > 0 && (
                      <div className="flex justify-between text-blue-800">
                        <span>ESI (3.25%)</span>
                        <span>{formatCurrency(calculation.components.employer_contributions.esi_employer)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-blue-800">
                      <span>Gratuity (4.81%)</span>
                      <span>{formatCurrency(calculation.components.employer_contributions.gratuity)}</span>
                    </div>
                  </div>
                </div>

                {/* Info */}
                <div className="text-xs text-slate-500 space-y-1 pt-2 border-t border-slate-200">
                  <p>PF Wages: {formatCurrency(calculation.breakdown.pf_wages)} {calculation.breakdown.pf_cap_applied && '(Capped)'}</p>
                  <p>ESI: {calculation.breakdown.esi_applicable ? 'Applicable' : 'Not Applicable'}</p>
                  <p>Regime: {calculation.breakdown.tax_regime === 'new' ? 'New Tax Regime' : 'Old Tax Regime'}</p>
                </div>
              </div>
            )}
          </SurfaceCard>
        </div>
      </div>
    </div>
  );
}
