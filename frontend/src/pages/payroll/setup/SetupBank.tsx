import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Save, CheckCircle2, AlertCircle, Loader2, Landmark, Building2 } from 'lucide-react';
import SetupLayout, { StepHeader } from './SetupLayout';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import { TextInput, SelectInput, FieldLabel } from '@/components/ui/FormField';
import Button from '@/components/ui/Button';
import InfoTooltip from '@/components/ui/InfoTooltip';
import { payrollApi } from '@/services/api';
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
  const queryClient = useQueryClient();
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

  // Pre-fill from existing org settings
  const { data: settingsData } = useQuery({
    queryKey: ['payroll', 'settings-existing'],
    queryFn: () => payrollApi.getPayrollSettings().then(res => res.data?.settings ?? {}),
  });

  useEffect(() => {
    const b = ((settingsData as any)?.bank ?? {}) as Record<string, any>;
    if (b.bankName) setBankName(b.bankName);
    if (b.accountHolder) setAccountHolder(b.accountHolder);
    if (b.accountNumber) setAccountNumber(b.accountNumber);
    if (b.ifsc) setIfsc(b.ifsc);
    if (b.branch) setBranch(b.branch);
    if (b.fileFormat) setFileFormat(b.fileFormat);
    if (b.payoutMode) setPayoutMode(b.payoutMode);
  }, [settingsData]);

  const handleSave = async () => {
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      await payrollApi.updatePayrollSettings({
        bank: {
          bankName: bankName || null,
          accountHolder: accountHolder || null,
          accountNumber: accountNumber || null,
          ifsc: ifsc || null,
          branch: branch || null,
          fileFormat,
          payoutMode,
        },
      } as any);
      await markSetupStep('bank');
      queryClient.invalidateQueries({ queryKey: ['payroll'] });
      queryClient.invalidateQueries({ queryKey: ['payroll', 'onboarding-status'] });
      setSuccess('Bank details saved. Used for NEFT/RTGS file generation.');
    } catch (e: any) {
      console.error('Bank save error:', e);
      setError(e?.response?.data?.message || e?.message || 'Failed to save');
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
          <p className="text-sm text-emerald-700 break-words flex-1">{success}</p>
        </div>
      )}

      <SurfaceCard className="p-6 mb-6">
        <div className="flex items-center gap-3 mb-2">
          <Building2 className="h-5 w-5 text-blue-600" />
          <h3 className="text-sm font-semibold text-slate-900">Organization Bank Account</h3>
          <InfoTooltip content="Salary transfers originate from this account. Use a corporate/current account in your org\'s name (not a personal account)." title="Source bank account" />
        </div>
        <p className="text-xs text-slate-500 mb-4">
          Salary transfers originate from this account. Make sure it\'s a corporate/current account.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <FieldLabel>Bank Name</FieldLabel>
              <InfoTooltip content="Name of the bank holding your corporate salary account." title="Bank name" />
            </div>
            <TextInput value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="e.g. HDFC Bank" />
          </div>
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <FieldLabel>Account Holder Name</FieldLabel>
              <InfoTooltip content="Name on the bank account exactly as registered with the bank. Must match your organization name." title="Account holder" />
            </div>
            <TextInput value={accountHolder} onChange={(e) => setAccountHolder(e.target.value)} placeholder="As per bank records" />
          </div>
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <FieldLabel>Account Number</FieldLabel>
              <InfoTooltip content="Bank account number used for salary debits. Verify twice — wrong number will fail all transfers." title="Account number" />
            </div>
            <TextInput value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} placeholder="e.g. 50100123456789" />
          </div>
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <FieldLabel>IFSC Code</FieldLabel>
              <InfoTooltip content="11-character branch identifier. Format: 4 letters (bank) + 0 + 6 alphanumeric (branch). Required for all NEFT/RTGS." title="IFSC" typical="HDFC0001234" />
            </div>
            <TextInput value={ifsc} onChange={(e) => setIfsc(e.target.value.toUpperCase())} placeholder="e.g. HDFC0001234" maxLength={11} />
          </div>
          <div className="sm:col-span-2">
            <div className="flex items-center gap-1.5 mb-1">
              <FieldLabel>Branch</FieldLabel>
              <InfoTooltip content="Bank branch where this account is held. Optional but useful for reconciliation." title="Branch" />
            </div>
            <TextInput value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="e.g. MG Road, Bangalore" />
          </div>
        </div>
      </SurfaceCard>

      <SurfaceCard className="p-6 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <Landmark className="h-5 w-5 text-blue-600" />
          <h3 className="text-sm font-semibold text-slate-900">Payout Configuration</h3>
          <InfoTooltip content="Choose how salary transfers are routed and what file format your bank accepts." title="Payout config" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <FieldLabel>Payout Mode</FieldLabel>
              <InfoTooltip content="NEFT: batches settled every 30 min, free. RTGS: real-time, for amounts ≥ ₹2 lakh. Mixed picks automatically per employee." title="Payout mode" typical="Mixed (recommended)" />
            </div>
            <SelectInput value={payoutMode} onChange={(e) => setPayoutMode(e.target.value as any)}>
              <option value="mixed">Mixed (NEFT + RTGS based on amount)</option>
              <option value="neft">NEFT only</option>
              <option value="rtgs">RTGS only</option>
            </SelectInput>
            <p className="text-xs text-slate-400 mt-1">RTGS for amounts ≥ ₹2 lakh</p>
          </div>
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <FieldLabel>Bank File Format</FieldLabel>
              <InfoTooltip content="Pick the format your corporate banking portal accepts. If unsure, ask your bank or start with CSV — most banks accept it." title="File format" />
            </div>
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
