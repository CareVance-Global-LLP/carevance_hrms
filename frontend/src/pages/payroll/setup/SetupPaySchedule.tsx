import { useState } from 'react';
import { Save, CheckCircle2, AlertCircle, Loader2, Calendar } from 'lucide-react';
import SetupLayout, { StepHeader } from './SetupLayout';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import { TextInput, SelectInput, FieldLabel } from '@/components/ui/FormField';
import Button from '@/components/ui/Button';
import { usePayrollOnboarding } from '@/hooks/usePayrollOnboarding';

const FREQUENCIES = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'biweekly', label: 'Bi-weekly (every 2 weeks)' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'daily', label: 'Daily-wage' },
];

export default function SetupPaySchedule() {
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

  const handleSave = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await markSetupStep('pay_schedule');
      setSuccess('Pay schedule saved.');
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Failed to save');
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
          <p className="text-sm text-emerald-700 flex-1">{success}</p>
        </div>
      )}

      <SurfaceCard className="p-6 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <Calendar className="h-5 w-5 text-blue-600" />
          <h3 className="text-sm font-semibold text-slate-900">Pay Frequency & Date</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <FieldLabel>Pay Frequency</FieldLabel>
            <SelectInput value={frequency} onChange={(e) => setFrequency(e.target.value)}>
              {FREQUENCIES.map(f => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </SelectInput>
          </div>
          <div>
            <FieldLabel>Pay Day</FieldLabel>
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
        <h3 className="text-sm font-semibold text-slate-900 mb-4">Attendance Cut-off</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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