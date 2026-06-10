import { useState, useEffect } from 'react';
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
  Activity
} from 'lucide-react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { payrollApi } from '@/services/api';
import Button from '@/components/ui/Button';
import { TextInput, SelectInput, FieldLabel } from '@/components/ui/FormField';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import ProgressSteps from './ProgressSteps';
import SalaryBreakdown from './SalaryBreakdown';
import type { EmployeePayrollDetails, EmployeePayrollTemplate, PayrollCalculation } from '@/types';

interface EmployeePayrollWizardProps {
  employeeId: number;
  monthYear: string;
  onBack: () => void;
  onComplete?: () => void;
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
  onComplete 
}: EmployeePayrollWizardProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [annualCtc, setAnnualCtc] = useState('');
  const [workingDays, setWorkingDays] = useState('26');
  const [daysPresent, setDaysPresent] = useState('26');
  const [lOPDays, setLOPDays] = useState('0');
  const [overtimeHours, setOvertimeHours] = useState('0');
  const [isEditingAttendance, setIsEditingAttendance] = useState(false);
  const [template, setTemplate] = useState<EmployeePayrollTemplate | null>(null);
  const [calculation, setCalculation] = useState<PayrollCalculation | null>(null);

  // Fetch employee data
  const { data, isLoading } = useQuery({
    queryKey: ['payroll', 'employee', employeeId, monthYear],
    queryFn: () => payrollApi.getEmployeePayrollDetails(employeeId, { month_year: monthYear }).then(res => res.data),
  });

  // Update template mutation
  const updateTemplateMutation = useMutation({
    mutationFn: (templateData: Partial<EmployeePayrollTemplate>) => 
      payrollApi.updateEmployeeTemplate(employeeId, templateData),
    onSuccess: (res) => {
      setTemplate(res.data.template);
    },
  });

  // Process payroll mutation
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
    onSuccess: () => {
      onComplete?.();
    },
  });

  // Initialize from data
  useEffect(() => {
    if (data && !template) {
      setTemplate(data.template);
      const savedCtc = data.template.annual_ctc;
      if (savedCtc) {
        setAnnualCtc(String(savedCtc));
      }
      if (data.payroll_preview) {
        setCalculation(data.payroll_preview);
      }
    }
  }, [data, template]);

  // Auto-populate attendance from timesheet data
  useEffect(() => {
    if (data?.time_tracking) {
      const tt = data.time_tracking;
      
      // Calculate working days from tracked hours (assuming 8 hours per day)
      const trackedHours = tt.payroll_tracked_hours || tt.total_worked_hours || 0;
      const calculatedWorkingDays = Math.max(1, Math.ceil(trackedHours / 8));
      
      // Days present from payroll data or calculate from hours
      const calculatedDaysPresent = tt.payroll_attendance_days || 
        Math.min(calculatedWorkingDays, Math.floor(trackedHours / 8));
      
      // LWP days = working days - days present
      const calculatedLwp = Math.max(0, calculatedWorkingDays - calculatedDaysPresent);
      
      // Overtime = hours beyond standard 8 hours per day
      const standardHours = calculatedDaysPresent * 8;
      const calculatedOvertime = Math.max(0, trackedHours - standardHours);
      
      // Only update if values haven't been manually edited
      setWorkingDays(String(calculatedWorkingDays));
      setDaysPresent(String(calculatedDaysPresent));
      setLOPDays(String(calculatedLwp));
      setOvertimeHours(calculatedOvertime > 0 ? calculatedOvertime.toFixed(1) : '0');
    }
  }, [data?.time_tracking]);

  // Calculate preview
  const calculatePreview = async () => {
    if (!annualCtc || !template) return;
    
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
    } catch (error) {
      console.error('Calculation failed:', error);
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
        
        {/* Timesheet Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="text-center p-4 bg-slate-50 rounded-lg border border-slate-200">
            <p className="text-xs text-slate-500 mb-1">Total Tracked Hours</p>
            <p className="text-2xl font-bold text-slate-900">{time_tracking.payroll_tracked_hours?.toFixed(1) || time_tracking.total_worked_hours.toFixed(1)}h</p>
            <p className="text-xs text-slate-400 mt-1">From timesheets</p>
          </div>
          <div className="text-center p-4 bg-slate-50 rounded-lg border border-slate-200">
            <p className="text-xs text-slate-500 mb-1">Productive Hours</p>
            <p className="text-2xl font-bold text-emerald-600">{time_tracking.total_productive_hours.toFixed(1)}h</p>
            <p className="text-xs text-slate-400 mt-1">Active work time</p>
          </div>
          <div className="text-center p-4 bg-slate-50 rounded-lg border border-slate-200">
            <p className="text-xs text-slate-500 mb-1">Activity Rate</p>
            <p className="text-2xl font-bold text-blue-600">{time_tracking.activity_percentage.toFixed(0)}%</p>
            <p className="text-xs text-slate-400 mt-1">Time active</p>
          </div>
          <div className="text-center p-4 bg-slate-50 rounded-lg border border-slate-200">
            <p className="text-xs text-slate-500 mb-1">Attendance Days</p>
            <p className="text-2xl font-bold text-violet-600">{time_tracking.payroll_attendance_days || Math.floor((time_tracking.payroll_tracked_hours || time_tracking.total_worked_hours) / 8)}</p>
            <p className="text-xs text-slate-400 mt-1">Days present</p>
          </div>
        </div>

        {/* Calculated Fields - Auto-fetched from Timesheet */}
        <div className="border-t border-slate-200 pt-6">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-sm font-medium text-slate-900 flex items-center gap-2">
              <Calculator className="h-4 w-4 text-slate-400" />
              Auto-fetched Attendance Data
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
          <FieldLabel>Annual CTC (Cost to Company)</FieldLabel>
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
            <FieldLabel>Basic Salary (% of CTC)</FieldLabel>
            <TextInput
              type="number"
              value={template.basic_percentage}
              onChange={(e) => handleUpdateTemplate('basic_percentage', parseFloat(e.target.value) || 0)}
              min="0"
              max="100"
            />
          </div>
          <div>
            <FieldLabel>HRA (% of Basic)</FieldLabel>
            <TextInput
              type="number"
              value={template.hra_percentage}
              onChange={(e) => handleUpdateTemplate('hra_percentage', parseFloat(e.target.value) || 0)}
              min="0"
              max="100"
            />
          </div>
          <div>
            <FieldLabel>Conveyance Allowance (₹)</FieldLabel>
            <TextInput
              type="number"
              value={template.conveyance_allowance}
              onChange={(e) => handleUpdateTemplate('conveyance_allowance', parseFloat(e.target.value) || 0)}
            />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <MapPin className="h-3 w-3 text-slate-400" />
              <FieldLabel className="mb-0">State (Professional Tax)</FieldLabel>
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
          <div className="flex items-center gap-3">
            <Building2 className="h-4 w-4 text-slate-400" />
            <span className="text-sm text-slate-700">Tax Regime:</span>
            <SelectInput
              value={template.tax_regime}
              onChange={(e) => handleUpdateTemplate('tax_regime', e.target.value)}
              className="w-32"
            >
              <option value="new">New Regime</option>
              <option value="old">Old Regime</option>
            </SelectInput>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-700">Metro City:</span>
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
            { key: 'pf_enabled', label: 'Provident Fund (PF)', desc: '12% of basic salary', default: true },
            { key: 'esi_enabled', label: 'Employee State Insurance (ESI)', desc: '0.75% employee, 3.25% employer', default: true },
            { key: 'pt_enabled', label: 'Professional Tax', desc: 'State-specific amount', default: true },
            { key: 'tds_enabled', label: 'Income Tax (TDS)', desc: 'Based on tax regime', default: true },
          ].map((item) => (
            <div key={item.key} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
              <div>
                <span className="text-sm text-slate-700">{item.label}</span>
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

      <div className="flex justify-between">
        <Button variant="secondary" onClick={() => setCurrentStep(0)}>
          Back
        </Button>
        <Button 
          variant="primary" 
          onClick={() => setCurrentStep(2)}
          disabled={!calculation}
          iconRight={<ChevronRight className="h-4 w-4" />}
        >
          Review & Process
        </Button>
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
              <div className="text-center">
                <CheckCircle2 className="h-12 w-12 mx-auto mb-3 text-emerald-600" />
                <h3 className="text-lg font-semibold text-emerald-900 mb-2">Payroll Processed Successfully!</h3>
                <p className="text-emerald-700 mb-4">Employee payroll has been calculated and saved.</p>
                <div className="flex justify-center gap-3">
                  <Button variant="secondary" onClick={onBack}>
                    Back to Department
                  </Button>
                  <Button variant="primary" iconLeft={<DollarSign className="h-4 w-4" />}>
                    Process Payment
                  </Button>
                </div>
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
