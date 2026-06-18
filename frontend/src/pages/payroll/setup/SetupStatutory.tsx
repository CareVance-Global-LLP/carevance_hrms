import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Save, CheckCircle2, AlertCircle, Loader2, ScrollText } from 'lucide-react';
import SetupLayout, { StepHeader } from './SetupLayout';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import { TextInput, FieldLabel } from '@/components/ui/FormField';
import Button from '@/components/ui/Button';
import InfoTooltip from '@/components/ui/InfoTooltip';
import { payrollApi } from '@/services/api';
import { usePayrollOnboarding } from '@/hooks/usePayrollOnboarding';

export default function SetupStatutory() {
  const queryClient = useQueryClient();
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

  // Pre-fill from existing org settings
  const { data: settingsData } = useQuery({
    queryKey: ['payroll', 'settings-existing'],
    queryFn: () => payrollApi.getPayrollSettings().then(res => res.data?.settings ?? {}),
  });

  useEffect(() => {
    const s = ((settingsData as any)?.statutory ?? {}) as Record<string, string>;
    if (s.tan) setTan(s.tan);
    if (s.pan) setPan(s.pan);
    if (s.establishmentCode) setEstablishmentCode(s.establishmentCode);
    if (s.esiCode) setEsiCode(s.esiCode);
    if (s.ptRegNumber) setPtRegNumber(s.ptRegNumber);
    if (s.lwfRegNumber) setLwfRegNumber(s.lwfRegNumber);
  }, [settingsData]);

  const handleSave = async () => {
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      await payrollApi.updatePayrollSettings({
        statutory: {
          tan: tan || null,
          pan: pan || null,
          establishmentCode: establishmentCode || null,
          esiCode: esiCode || null,
          ptRegNumber: ptRegNumber || null,
          lwfRegNumber: lwfRegNumber || null,
        },
      } as any);
      await markSetupStep('statutory');
      queryClient.invalidateQueries({ queryKey: ['payroll'] });
      queryClient.invalidateQueries({ queryKey: ['payroll', 'onboarding-status'] });
      setSuccess('Statutory details saved. These will appear on all your filings.');
    } catch (e: any) {
      console.error('Statutory save error:', e);
      setError(e?.response?.data?.message || e?.message || 'Failed to save');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SetupLayout currentStep="statutory">
      <StepHeader
        stepNumber={6}
        title="Statutory Details"
        description="Government-issued identifiers used on all your filings. These appear on payslips and PF/ESI/TDS returns."
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
          <ScrollText className="h-5 w-5 text-blue-600" />
          <h3 className="text-sm font-semibold text-slate-900">Organization Identifiers</h3>
          <InfoTooltip content="These codes are issued by government bodies (Income Tax, EPFO, ESIC, state commercial tax, state labour welfare board). They appear on all your statutory filings. Hover each field for what it\'s used for." title="Statutory identifiers" />
        </div>
        <p className="text-xs text-slate-500 mb-4">Where to get these: TAN via NSDL TIN website, PF/ESI codes from EPFO/ESIC portals, PT/LWF numbers from your state\'s commercial tax department.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <FieldLabel>TAN (Tax Deduction Account Number)</FieldLabel>
              <InfoTooltip content="10-digit ID issued by Income Tax Dept. Required for all TDS challans and quarterly returns (Form 24Q, 26Q)." title="TAN" typical="Format: ABCD12345E" />
            </div>
            <TextInput
              value={tan}
              onChange={(e) => setTan(e.target.value.toUpperCase())}
              placeholder="e.g. ABCD12345E"
              maxLength={10}
            />
            <p className="text-xs text-slate-400 mt-1">Required for TDS filings (Form 24Q, 26Q)</p>
          </div>
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <FieldLabel>PAN (Organization)</FieldLabel>
              <InfoTooltip content="10-digit ID for your organization. Required on payslips, Form 16, TDS returns, and bank correspondence." title="PAN" typical="Format: ABCDE1234F" />
            </div>
            <TextInput
              value={pan}
              onChange={(e) => setPan(e.target.value.toUpperCase())}
              placeholder="e.g. ABCDE1234F"
              maxLength={10}
            />
            <p className="text-xs text-slate-400 mt-1">Used on payslips and filings</p>
          </div>
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <FieldLabel>PF Establishment Code</FieldLabel>
              <InfoTooltip content="17-digit code issued by EPFO when you register for PF. Required on monthly ECR (Electronic Challan cum Return)." title="PF Establishment Code" typical="17 digits" />
            </div>
            <TextInput
              value={establishmentCode}
              onChange={(e) => setEstablishmentCode(e.target.value.toUpperCase())}
              placeholder="e.g. ABCDE1234567000"
            />
            <p className="text-xs text-slate-400 mt-1">Provided by EPFO</p>
          </div>
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <FieldLabel>ESI Code</FieldLabel>
              <InfoTooltip content="17-digit code from ESIC. Required on monthly ESI challan. Only needed if you have employees earning ≤ ₹21,000/month." title="ESI Code" typical="17 digits" />
            </div>
            <TextInput
              value={esiCode}
              onChange={(e) => setEsiCode(e.target.value.toUpperCase())}
              placeholder="e.g. 12345678901234567"
            />
            <p className="text-xs text-slate-400 mt-1">17-digit code from ESIC</p>
          </div>
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <FieldLabel>PT Registration Number</FieldLabel>
              <InfoTooltip content="Issued by your state\'s commercial tax department. Required for monthly/annual PT returns. Format varies by state." title="PT Registration" />
            </div>
            <TextInput
              value={ptRegNumber}
              onChange={(e) => setPtRegNumber(e.target.value)}
              placeholder="e.g. PT/MH/12345"
            />
            <p className="text-xs text-slate-400 mt-1">Issued by your state\'s commercial tax dept</p>
          </div>
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <FieldLabel>LWF Registration Number (optional)</FieldLabel>
              <InfoTooltip content="Issued by state Labour Welfare Board. Required only if your state mandates LWF (Maharashtra, Karnataka, Kerala, etc.)." title="LWF Registration" />
            </div>
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
