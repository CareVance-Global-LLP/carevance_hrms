import { useState } from 'react';
import { Save, CheckCircle2, AlertCircle, Loader2, ScrollText } from 'lucide-react';
import SetupLayout, { StepHeader } from './SetupLayout';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import { TextInput, FieldLabel } from '@/components/ui/FormField';
import Button from '@/components/ui/Button';
import { usePayrollOnboarding } from '@/hooks/usePayrollOnboarding';

export default function SetupStatutory() {
  const { status, markSetupStep } = usePayrollOnboarding();
  const isComplete = status?.steps.statutory ?? false;
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [tan, setTan] = useState('');
  const [pan, setPan] = useState('');
  const [establishmentCode, setEstablishmentCode] = useState('');
  const [esiCode, setEsiCode] = useState('');
  const [ptRegNumber, setPtRegNumber] = useState('');
  const [lwfRegNumber, setLwfRegNumber] = useState('');

  const handleSave = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await markSetupStep('statutory');
      setSuccess('Statutory details saved.');
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Failed to save');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SetupLayout currentStep="statutory">
      <StepHeader
        stepNumber={6}
        title="Statutory Details"
        description="Government-issued identifiers used on all your filings."
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
          <ScrollText className="h-5 w-5 text-blue-600" />
          <h3 className="text-sm font-semibold text-slate-900">Organization Identifiers</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <FieldLabel>TAN (Tax Deduction Account Number)</FieldLabel>
            <TextInput
              value={tan}
              onChange={(e) => setTan(e.target.value.toUpperCase())}
              placeholder="e.g. ABCD12345E"
              maxLength={10}
            />
            <p className="text-xs text-slate-400 mt-1">Required for TDS filings (Form 24Q, 26Q)</p>
          </div>
          <div>
            <FieldLabel>PAN (Organization)</FieldLabel>
            <TextInput
              value={pan}
              onChange={(e) => setPan(e.target.value.toUpperCase())}
              placeholder="e.g. ABCDE1234F"
              maxLength={10}
            />
            <p className="text-xs text-slate-400 mt-1">Used on payslips and filings</p>
          </div>
          <div>
            <FieldLabel>PF Establishment Code</FieldLabel>
            <TextInput
              value={establishmentCode}
              onChange={(e) => setEstablishmentCode(e.target.value.toUpperCase())}
              placeholder="e.g. ABCDE1234567000"
            />
            <p className="text-xs text-slate-400 mt-1">Provided by EPFO</p>
          </div>
          <div>
            <FieldLabel>ESI Code</FieldLabel>
            <TextInput
              value={esiCode}
              onChange={(e) => setEsiCode(e.target.value.toUpperCase())}
              placeholder="e.g. 12345678901234567"
            />
            <p className="text-xs text-slate-400 mt-1">17-digit code from ESIC</p>
          </div>
          <div>
            <FieldLabel>PT Registration Number</FieldLabel>
            <TextInput
              value={ptRegNumber}
              onChange={(e) => setPtRegNumber(e.target.value)}
              placeholder="e.g. PT/MH/12345"
            />
            <p className="text-xs text-slate-400 mt-1">Issued by your state's commercial tax dept</p>
          </div>
          <div>
            <FieldLabel>LWF Registration Number (optional)</FieldLabel>
            <TextInput
              value={lwfRegNumber}
              onChange={(e) => setLwfRegNumber(e.target.value)}
              placeholder="e.g. LWF/MH/12345"
            />
            <p className="text-xs text-slate-400 mt-1">Issued by state labour welfare board</p>
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
          {submitting ? 'Saving...' : isComplete ? 'Update Details' : 'Save & Continue'}
        </Button>
      </div>
    </SetupLayout>
  );
}