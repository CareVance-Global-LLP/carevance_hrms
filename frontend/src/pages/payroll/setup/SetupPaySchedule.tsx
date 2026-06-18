import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Save, CheckCircle2, AlertCircle, Loader2, Calendar } from 'lucide-react';
import SetupLayout, { StepHeader } from './SetupLayout';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import { TextInput, SelectInput, FieldLabel } from '@/components/ui/FormField';
import Button from '@/components/ui/Button';
import InfoTooltip from '@/components/ui/InfoTooltip';
import { payrollApi } from '@/services/api';
import { usePayrollOnboarding } from '@/hooks/usePayrollOnboarding';

const FREQUENCIES = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'biweekly', label: 'Bi-weekly (every 2 weeks)' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'daily', label: 'Daily-wage' },
];

export default function SetupPaySchedule() {
  const queryClient = useQueryClient();
  const { status, markSetupStep } = usePayrollOnboarding();
  const isComplete = status?.steps.pay_schedule ?? false;
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [frequency, setFrequency] = useState('monthly');
  const [payDay, setPayDay] = useState('last_working_day');
  const [customPayDay, setCustomPayDay] = useState('1');
  const [cutoffDay, setCutoffDay] = useState('25');
  const [processingBuffer, setProcessingBuffer] = useState('3');
  const [workingDays, setWorkingDays] = useState('26');

  // Pre-fill from existing org settings
  const { data: settingsData } = useQuery({
    queryKey: ['payroll', 'settings-existing'],
    queryFn: () => payrollApi.getPayrollSettings().then(res => res.data?.settings ?? {}),
  });

  useEffect(() => {
    const s = ((settingsData as any)?.paySchedule ?? {}) as Record<string, any>;
    if (s.frequency) setFrequency(s.frequency);
    if (s.payDay) setPayDay(s.payDay);
    if (s.customPayDay !== undefined) setCustomPayDay(String(s.customPayDay));
    if (s.cutoffDay !== undefined) setCutoffDay(String(s.cutoffDay));
    if (s.processingBuffer !== undefined) setProcessingBuffer(String(s.processingBuffer));
    if ((settingsData as any)?.workingDaysPerMonth !== undefined) {
      setWorkingDays(String((settingsData as any).workingDaysPerMonth));
    }
  }, [settingsData]);

  const handleSave = async () => {
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      await payrollApi.updatePayrollSettings({
        paySchedule: {
          frequency,
          payDay,
          customPayDay: parseInt(customPayDay) || 1,
          cutoffDay: parseInt(cutoffDay) || 25,
          processingBuffer: parseInt(processingBuffer) || 3,
        },
        workingDaysPerMonth: parseInt(workingDays) || 26,
      } as any);
      await markSetupStep('pay_schedule');
      queryClient.invalidateQueries({ queryKey: ['payroll'] });
      queryClient.invalidateQueries({ queryKey: ['payroll', 'onboarding-status'] });
      setSuccess('Pay schedule saved. Will be used for all payroll runs.');
    } catch (e: any) {
      console.error('Pay schedule save error:', e);
      setError(e?.response?.data?.message || e?.message || 'Failed to save');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SetupLayout currentStep="pay_schedule">
      <StepHeader
        stepNumber={7}
        title="Pay Schedule"
        description="When and how often your employees get paid."
        isComplete={isComplete}
      />

      {error && (
        <div className="mb-4 p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-rose-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-rose-700 break-words flex-1">{error}</p>
          <button onClick={() => setError(null)} className="text-rose-400 hover:text-rose-600">×</button>
        </div>
      )}
      {success && (
        <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-start gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-emerald-700 break-words flex-1">{success}</p>
        </div>
      )}

      <SurfaceCard className="p-6 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <Calendar className="h-5 w-5 text-blue-600" />
          <h3 className="text-sm font-semibold text-slate-900">Pay Frequency & Date</h3>
          <InfoTooltip content="Pick how often and when employees get paid. Monthly is the Indian norm. The pay day must be at least [cut-off day + processing buffer] days after the 1st of the month." title="Pay schedule" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <FieldLabel>Pay Frequency</FieldLabel>
              <InfoTooltip content="Monthly is standard in India. Biweekly/weekly are rare. Daily-wage is for contract/casual workers." title="Pay frequency" typical="Monthly" />
            </div>
            <SelectInput value={frequency} onChange={(e) => setFrequency(e.target.value)}>
              {FREQUENCIES.map(f => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </SelectInput>
          </div>
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <FieldLabel>Pay Day</FieldLabel>
              <InfoTooltip content="When salary credits to employee bank accounts. Last working day is most common. Must be ≥ cut-off day + buffer." title="Pay day" typical="Last working day of month" />
            </div>
            <SelectInput value={payDay} onChange={(e) => setPayDay(e.target.value)}>
              <option value="last_working_day">Last working day of month</option>
              <option value="last_day">Last day of month</option>
              <option value="specific">Specific day of month</option>
            </SelectInput>
            {payDay === 'specific' && (
              <TextInput
                type="number"
                value={customPayDay}
                onChange={(e) => setCustomPayDay(e.target.value)}
                placeholder="Day (1-31)"
                min="1"
                max="31"
                className="mt-2"
              />
            )}
          </div>
        </div>
      </SurfaceCard>

      <SurfaceCard className="p-6 mb-6">
        <h3 className="text-sm font-semibold text-slate-900 mb-4">Attendance & Working Days</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <FieldLabel>Working Days per Month</FieldLabel>
              <InfoTooltip content="Expected work days per month. Used to calculate per-day salary for LOP, overtime, and partial-month salary for new joiners / exits." title="Working days" typical="26 days/month" />
            </div>
            <TextInput
              type="number"
              value={workingDays}
              onChange={(e) => setWorkingDays(e.target.value)}
              min="1"
              max="31"
            />
            <p className="text-xs text-slate-400 mt-1">Usually 26 (Mon–Sat)</p>
          </div>
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <FieldLabel>Cut-off Day of Month</FieldLabel>
              <InfoTooltip content="Day of month after which attendance rolls into next month\'s payroll. E.g. cut-off 25th means attendance from 26th onwards counts in next month." title="Attendance cut-off" typical="25th of month" />
            </div>
            <TextInput
              type="number"
              value={cutoffDay}
              onChange={(e) => setCutoffDay(e.target.value)}
              min="1"
              max="31"
            />
            <p className="text-xs text-slate-400 mt-1">Attendance after this day → next month</p>
          </div>
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <FieldLabel>Processing Buffer (days)</FieldLabel>
              <InfoTooltip content="Days between attendance cut-off and pay day for processing: finalizing attendance, calculating, getting approvals, generating bank file. 3–5 days is typical." title="Processing buffer" typical="3 – 5 days" />
            </div>
            <TextInput
              type="number"
              value={processingBuffer}
              onChange={(e) => setProcessingBuffer(e.target.value)}
              min="1"
              max="10"
            />
            <p className="text-xs text-slate-400 mt-1">Buffer between cut-off and pay day</p>
          </div>
        </div>
      </SurfaceCard>

      <SurfaceCard className="p-6 mb-6">
        <h3 className="text-sm font-semibold text-slate-900 mb-4">Attendance & Working Days</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <FieldLabel>Working Days per Month</FieldLabel>
            <TextInput
              type="number"
              value={workingDays}
              onChange={(e) => setWorkingDays(e.target.value)}
              min="1"
              max="31"
            />
            <p className="text-xs text-slate-400 mt-1">Usually 26 (Mon-Sat)</p>
          </div>
          <div>
            <FieldLabel>Cut-off Day of Month</FieldLabel>
            <TextInput
              type="number"
              value={cutoffDay}
              onChange={(e) => setCutoffDay(e.target.value)}
              min="1"
              max="31"
            />
            <p className="text-xs text-slate-400 mt-1">Attendance after this day goes to next month's payroll</p>
          </div>
          <div>
            <FieldLabel>Processing Buffer (days)</FieldLabel>
            <TextInput
              type="number"
              value={processingBuffer}
              onChange={(e) => setProcessingBuffer(e.target.value)}
              min="1"
              max="10"
            />
            <p className="text-xs text-slate-400 mt-1">Days between cut-off and pay day for processing</p>
          </div>
        </div>
      </SurfaceCard>

      <div className="flex justify-end">
        <Button
          variant="primary"
          iconLeft={submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : isComplete ? <CheckCircle2 className="h-4 w-4" /> : <Save className="h-4 w-4" />}
          onClick={handleSave}
          disabled={submitting}
        >
          {submitting ? 'Saving...' : isComplete ? 'Update Schedule' : 'Save & Continue'}
        </Button>
      </div>
    </SetupLayout>
  );
}
