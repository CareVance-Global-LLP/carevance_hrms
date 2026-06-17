import { useState } from 'react';
import { Save, CheckCircle2, AlertCircle, Loader2, Landmark, Building2 } from 'lucide-react';
import SetupLayout, { StepHeader } from './SetupLayout';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import { TextInput, SelectInput, FieldLabel } from '@/components/ui/FormField';
import Button from '@/components/ui/Button';
import { usePayrollOnboarding } from '@/hooks/usePayrollOnboarding';

const FILE_FORMATS = [
  { value: 'csv', label: 'CSV (Generic)' },
  { value: 'sbi', label: 'SBI Corporate' },
  { value: 'hdfc', label: 'HDFC Bank' },
  { value: 'icici', label: 'ICICI Bank' },
  { value: 'axis', label: 'Axis Bank' },
  { value: 'neft', label: 'NEFT Standard' },
  { value: 'rtgs', label: 'RTGS Standard' },
];

export default function SetupBank() {
  const { status, markSetupStep } = usePayrollOnboarding();
  const isComplete = status?.steps.bank ?? false;
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [bankName, setBankName] = useState('');
  const [accountHolder, setAccountHolder] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [branch, setBranch] = useState('');
  const [fileFormat, setFileFormat] = useState('csv');
  const [payoutMode, setPayoutMode] = useState<'neft' | 'rtgs' | 'mixed'>('mixed');

  const handleSave = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await markSetupStep('bank');
      setSuccess('Bank & payout configuration saved.');
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Failed to save');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SetupLayout currentStep="bank">
      <StepHeader
        stepNumber={8}
        title="Bank & Payout"
        description="Where we send salary transfers and in what format."
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
          <Building2 className="h-5 w-5 text-blue-600" />
          <h3 className="text-sm font-semibold text-slate-900">Organization Bank Account</h3>
        </div>
        <p className="text-xs text-slate-500 mb-4">
          Salary transfers originate from this account. Make sure it's a corporate/current account.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <FieldLabel>Bank Name</FieldLabel>
            <TextInput value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="e.g. HDFC Bank" />
          </div>
          <div>
            <FieldLabel>Account Holder Name</FieldLabel>
            <TextInput value={accountHolder} onChange={(e) => setAccountHolder(e.target.value)} placeholder="As per bank records" />
          </div>
          <div>
            <FieldLabel>Account Number</FieldLabel>
            <TextInput value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} placeholder="e.g. 50100123456789" />
          </div>
          <div>
            <FieldLabel>IFSC Code</FieldLabel>
            <TextInput value={ifsc} onChange={(e) => setIfsc(e.target.value.toUpperCase())} placeholder="e.g. HDFC0001234" maxLength={11} />
          </div>
          <div className="sm:col-span-2">
            <FieldLabel>Branch</FieldLabel>
            <TextInput value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="e.g. MG Road, Bangalore" />
          </div>
        </div>
      </SurfaceCard>

      <SurfaceCard className="p-6 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <Landmark className="h-5 w-5 text-blue-600" />
          <h3 className="text-sm font-semibold text-slate-900">Payout Configuration</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <FieldLabel>Payout Mode</FieldLabel>
            <SelectInput value={payoutMode} onChange={(e) => setPayoutMode(e.target.value as any)}>
              <option value="mixed">Mixed (NEFT + RTGS based on amount)</option>
              <option value="neft">NEFT only</option>
              <option value="rtgs">RTGS only</option>
            </SelectInput>
            <p className="text-xs text-slate-400 mt-1">RTGS for amounts ≥ ₹2 lakh</p>
          </div>
          <div>
            <FieldLabel>Bank File Format</FieldLabel>
            <SelectInput value={fileFormat} onChange={(e) => setFileFormat(e.target.value)}>
              {FILE_FORMATS.map(f => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </SelectInput>
            <p className="text-xs text-slate-400 mt-1">Used when generating the disbursement file</p>
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
          {submitting ? 'Saving...' : isComplete ? 'Update Bank Details' : 'Save & Continue'}
        </Button>
      </div>
    </SetupLayout>
  );
}