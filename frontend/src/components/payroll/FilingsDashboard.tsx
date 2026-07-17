import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, Download, Plus, History, Loader2, ArrowLeft, AlertCircle, CheckCircle2, Upload, Send, ClipboardCheck, CalendarClock } from 'lucide-react';
import { payrollApi } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import Button from '@/components/ui/Button';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import InfoTooltip from '@/components/ui/InfoTooltip';
import HowItWorksCard from './HowItWorksCard';
import { useToast } from '@/components/ui/Toast';
import type { PayGroupFilingDetail } from '@/types';

import UploadForm16Modal from './UploadForm16Modal';

type ComplianceStatus = 'ready' | 'reference_only' | 'not_configured' | 'source_data_only';

const COMPLIANCE_BADGE: Record<ComplianceStatus, { label: string; className: string }> = {
  ready: { label: 'Filing-ready', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  reference_only: { label: 'Reference only — manual portal entry required', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  source_data_only: { label: 'Source data only — needs NSDL RPU', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  not_configured: { label: 'Not configured for your state', className: 'bg-rose-50 text-rose-700 border-rose-200' },
};

// Which filing type keys map to each compliance_due_dates key for the calendar.
const DUE_DATE_KEYS: Record<string, string> = {
  pf_ecr: 'pf_ecr',
  esi_challan: 'esi',
  form_24q: 'tds',
  pt_return: 'pt',
  lwf_return: 'lwf',
};

const FILING_TYPES: Array<{
  key: string;
  label: string;
  desc: string;
  needsRun?: boolean;
  needsState?: boolean;
  needsBonusPercent?: boolean;
  complianceStatus: ComplianceStatus;
  tooltip: string;
}> = [
  {
    key: 'pf_ecr', label: 'PF ECR', desc: 'EPFO monthly return', needsRun: true,
    complianceStatus: 'ready',
    tooltip: 'Electronic Challan cum Return — monthly PF contribution filing with EPFO. Generated in EPFO\'s actual ECR text format (UAN, wages, PF/EPS splits, 11-column ||-delimited). Upload-ready. Due by the 15th of the next month.',
  },
  {
    key: 'esi_challan', label: 'ESI Contribution Summary', desc: 'ESI monthly summary (reference)', needsRun: true,
    complianceStatus: 'reference_only',
    tooltip: 'A portal-aligned CSV of ESIC-eligible employees for this month (Employer Code, IP Number, Name, Days, Wages, EE/ER contribution). Use it to pre-fill the ESIC employer portal monthly contribution; the actual challan is generated there. Due by the 15th of the next month.',
  },
  {
    key: 'form_24q', label: 'Form 24Q (TDS data export)', desc: 'Quarterly TDS source data', needsRun: true,
    complianceStatus: 'source_data_only',
    tooltip: 'Exports the underlying TDS data for this quarter. The actual e-TDS return must still be prepared using NSDL-approved return preparation software (RPU) or a TIN-FC, which validates it through the File Validation Utility (FVU) before filing with TDS-CPC. Due 15 days after quarter end.',
  },
  {
    key: 'form_16', label: 'Form 16 Part B', desc: 'Salary statement (annual)', needsRun: false,
    complianceStatus: 'ready',
    tooltip: 'Form 16 Part B (Salary Statement) — generated as a real PDF from the employee\'s aggregated FY payroll. Part A (with the TRACES certificate number) must be downloaded from TRACES after quarterly TDS filing and attached separately; this system cannot mint that number.',
  },
  {
    key: 'form_12ba', label: 'Form 12BA', desc: 'Perquisites statement (annual)', needsRun: true,
    complianceStatus: 'ready',
    tooltip: 'Annual statement of perquisites paid to employees, rendered as a PDF paired with Form 16 Part B. Issued to each employee alongside Form 16.',
  },
  {
    key: 'pt_return', label: 'PT Contribution Summary', desc: 'Professional Tax summary (reference)', needsRun: true, needsState: true,
    complianceStatus: 'reference_only',
    tooltip: 'State-level Professional Tax contribution summary for manual entry / reference. The actual PT payment/return is made on the state commercial tax department portal. Due dates vary by state.',
  },
  {
    key: 'lwf_return', label: 'LWF Return', desc: 'Labour Welfare Fund', needsRun: true, needsState: true,
    complianceStatus: 'not_configured',
    tooltip: 'Labour Welfare Fund is a state subject with no universal formula. Pick your state to generate; if your state\'s rate is not configured, you\'ll see a clear "Not configured" message instead of a wrong number. Periodicity varies (monthly / bi-annual) by state.',
  },
  {
    key: 'bonus_form_c', label: 'Bonus Form C', desc: 'Payment of Bonus Act annual return', needsRun: true, needsBonusPercent: true,
    complianceStatus: 'ready',
    tooltip: 'Annual Return under the Payment of Bonus Act. The bonus percentage (8.33%–20%) is set by finance each year based on allocable surplus — it is not a fixed 8.33%. Computed on annual capped wages, not a single month.',
  },
];

// Reusable list of states shared with the PT/LWF selects.
const STATES = [
  'maharashtra', 'karnataka', 'tamil_nadu', 'gujarat', 'west_bengal', 'delhi', 'haryana',
  'uttar_pradesh', 'telangana', 'andhra_pradesh', 'rajasthan', 'madhya_pradesh', 'punjab',
  'odisha', 'kerala', 'bihar', 'jharkhand', 'assam', 'goa',
];

const fmtState = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

interface FilingButtonProps {
  label: string;
  desc: string;
  tooltip: string;
  complianceStatus: ComplianceStatus;
  onClick: () => void;
  disabled?: boolean;
  needsState?: boolean;
  state?: string;
  onStateChange?: (state: string) => void;
}

function FilingButton({ label, desc, tooltip, complianceStatus, onClick, disabled, needsState, state, onStateChange }: FilingButtonProps) {
  const badge = COMPLIANCE_BADGE[complianceStatus];
  return (
    <SurfaceCard
      className={`p-4 cursor-pointer hover:shadow-md hover:border-blue-300 transition-all ${
        disabled ? 'opacity-50 pointer-events-none' : ''
      }`}
      onClick={needsState || complianceStatus === 'not_configured' ? undefined : onClick}
    >
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
          <FileText className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-1">
            <h3 className="font-semibold text-slate-900 text-sm">{label}</h3>
            <InfoTooltip content={tooltip} title={label} size="sm" />
          </div>
          <p className="text-xs text-slate-500 mt-0.5">{desc}</p>
          <span className={`mt-2 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${badge.className}`}>
            {badge.label}
          </span>
          {needsState && (
            <div className="mt-2">
              <select
                value={state || ''}
                onChange={(e) => onStateChange?.(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                disabled={disabled}
                className="text-xs border border-slate-200 rounded px-2 py-1 bg-white w-full max-w-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select state...</option>
                {STATES.map((s) => (
                  <option key={s} value={s}>{fmtState(s)}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>
    </SurfaceCard>
  );
}

type FilingStatus = 'draft' | 'generated' | 'submitted' | 'approved' | 'filed' | 'acknowledged' | 'error';

const STATUS_BADGE: Record<FilingStatus, string> = {
  draft: 'bg-slate-100 text-slate-700',
  generated: 'bg-sky-50 text-sky-700',
  submitted: 'bg-amber-50 text-amber-700',
  approved: 'bg-violet-50 text-violet-700',
  filed: 'bg-blue-50 text-blue-700',
  acknowledged: 'bg-emerald-50 text-emerald-700',
  error: 'bg-rose-50 text-rose-700',
};

export default function FilingsDashboard({ onBack }: { onBack?: () => void }) {
  const queryClient = useQueryClient();
  const { show } = useToast();
  const { organization } = useAuth();
  const organizationName = organization?.name || '';
  const [selectedRun, setSelectedRun] = useState<number | null>(null);
  const [ptState, setPtState] = useState<string>('');
  const [lwfState, setLwfState] = useState<string>('');
  const [bonusPercent, setBonusPercent] = useState<string>('8.33');
  const [form16EmployeeId, setForm16EmployeeId] = useState<number | null>(null);
  const [form16FinancialYear, setForm16FinancialYear] = useState<string>('2026-2027');
  const [activeTab, setActiveTab] = useState<'generate' | 'history' | 'form16' | 'upload-form16' | 'review'>('generate');
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [markFiledFor, setMarkFiledFor] = useState<number | null>(null);
  const [ackInput, setAckInput] = useState<string>('');

  // Fetch payroll runs for the generate tab
  const { data: runs, isLoading: runsLoading } = useQuery({
    queryKey: ['payroll-runs'],
    queryFn: () => payrollApi.getPayrollRuns(),
  });

  // Fetch employees for the Form 16 tab
  const { data: employees, isLoading: employeesLoading } = useQuery({
    queryKey: ['payroll-filing-employees'],
    queryFn: () => payrollApi.getEmployees(),
  });

  // Fetch org settings for the compliance calendar + due dates
  const { data: settings } = useQuery({
    queryKey: ['payroll-settings'],
    queryFn: () => payrollApi.getPayrollSettings(),
  });

  // Fetch filings history
  const { data: filingsData, isLoading: filingsLoading } = useQuery({
    queryKey: ['payroll-filings'],
    queryFn: () => payrollApi.listFilings().then((r) => r.data),
    enabled: activeTab === 'history' || activeTab === 'review',
  });

  // Reviewer queue
  const { data: reviewData, isLoading: reviewLoading } = useQuery({
    queryKey: ['payroll-filing-review-queue'],
    queryFn: () => payrollApi.getReviewQueue().then((r) => r.data),
    enabled: activeTab === 'review',
  });

  // Pre-flight run-state validation (gates the Generate tab)
  const { data: runValidationRaw } = useQuery({
    queryKey: ['payroll-filing-run-validate', selectedRun],
    queryFn: () => payrollApi.validateRun(selectedRun as number),
    enabled: !!selectedRun,
  });
  const runValidation = (runValidationRaw as any)?.data ?? runValidationRaw;

  // Download a filing
  const downloadMutation = useMutation({
    mutationFn: async (filing: { id: number; original_filename: string; type: string }) => {
      const response = await payrollApi.downloadFiling(filing.id);
      const isPdf = (filing.original_filename || '').toLowerCase().endsWith('.pdf');
      const blob = new Blob([response.data], { type: isPdf ? 'application/pdf' : 'text/plain' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filing.original_filename || `${filing.type}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      return filing;
    },
    onSuccess: (filing) => {
      show({ kind: 'success', message: `Downloaded ${filing.original_filename}`, durationMs: 3000 });
    },
    onError: (e: any) => {
      show({ kind: 'error', message: e?.message || 'Failed to download filing', durationMs: 4000 });
    },
  });

  // Generate a single filing
  const generateSingleMutation = useMutation({
    mutationFn: async ({ type, runId }: { type: string; runId: number }) => {
      const resp = (() => {
        switch (type) {
          case 'pf_ecr': return payrollApi.generatePfEcr(runId);
          case 'esi_challan': return payrollApi.generateEsiChallan(runId);
          case 'form_24q': return payrollApi.generateForm24Q(runId);
          case 'form_12ba': return payrollApi.generateForm12BA(runId);
          case 'lwf_return': return payrollApi.generateLwfReturn(runId, lwfState);
          case 'bonus_form_c': return payrollApi.generateBonusFormC(runId, parseFloat(bonusPercent));
          case 'pt_return': return payrollApi.generatePtReturn(runId, ptState);
          default: throw new Error('Unknown filing type');
        }
      })();
      return (await resp).data;
    },
    onSuccess: (data: any, vars) => {
      queryClient.invalidateQueries({ queryKey: ['payroll-filings'] });
      // Safeguard: if the generator did not actually produce a file, surface it
      // as an error rather than a success — prevents silent "broken" filings.
      if (!data?.file_path) {
        show({ kind: 'error', message: `${vars.type.replace(/_/g, ' ').toUpperCase()} was generated but produced no downloadable file. Please report this.`, durationMs: 6000 });
        return;
      }
      show({ kind: 'success', message: `${vars.type.replace(/_/g, ' ').toUpperCase()} generated successfully`, durationMs: 4000 });
    },
    onError: (e: any) => {
      show({ kind: 'error', message: e?.response?.data?.message || e?.message || 'Failed to generate filing', durationMs: 5000 });
    },
  });

  // Generate all filings at once (auto-routes to reviewer)
  const generateAllMutation = useMutation({
    mutationFn: (runId: number) => payrollApi.generateAllFilings(runId),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['payroll-filings'] });
      const reviewerMsg = data?.reviewer_ids?.length ? ' Routed to your reviewer for internal approval.' : '';
      show({ kind: 'success', message: `All filings generated.${reviewerMsg}`, durationMs: 4000 });
    },
    onError: (e: any) => {
      show({ kind: 'error', message: e?.response?.data?.message || e?.message || 'Failed to generate filings', durationMs: 5000 });
    },
  });

  // Generate Form 16
  const generateForm16Mutation = useMutation({
    mutationFn: ({ userId, financialYear }: { userId: number; financialYear: string }) =>
      payrollApi.generateForm16(userId, financialYear).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll-filings'] });
      show({ kind: 'success', message: `Form 16 generated successfully`, durationMs: 4000 });
    },
    onError: (e: any) => {
      const msg = e?.response?.data?.message || e?.message || 'Failed to generate Form 16';
      show({ kind: 'error', message: msg, durationMs: 6000 });
    },
  });

  // Approve / reject (reviewer)
  const approveMutation = useMutation({
    mutationFn: (id: number) => payrollApi.approveFiling(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll-filing-review-queue'] });
      queryClient.invalidateQueries({ queryKey: ['payroll-filings'] });
      show({ kind: 'success', message: 'Approved. Ready for the human to file on the portal.', durationMs: 4000 });
    },
    onError: (e: any) => show({ kind: 'error', message: e?.response?.data?.message || 'Failed to approve', durationMs: 4000 }),
  });
  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => payrollApi.rejectFiling(id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll-filing-review-queue'] });
      show({ kind: 'success', message: 'Rejected and returned to generated.', durationMs: 4000 });
    },
    onError: (e: any) => show({ kind: 'error', message: e?.response?.data?.message || 'Failed to reject', durationMs: 4000 }),
  });

  // Mark filed (record ack number)
  const markFiledMutation = useMutation({
    mutationFn: ({ id, ack }: { id: number; ack: string }) => payrollApi.markFilingFiled(id, ack, 'paid'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll-filings'] });
      setMarkFiledFor(null);
      setAckInput('');
      show({ kind: 'success', message: 'Recorded as filed.', durationMs: 4000 });
    },
    onError: (e: any) => show({ kind: 'error', message: e?.response?.data?.message || 'Failed to mark filed', durationMs: 4000 }),
  });

  // Open portal adapter info
  const portalInfoMutation = useMutation({
    mutationFn: (id: number) => payrollApi.getPortalInfo(id),
    onSuccess: (resp: any) => {
      const info = resp?.data ?? resp;
      if (info?.url) {
        window.open(info.url, '_blank', 'noopener,noreferrer');
        show({ kind: 'info', message: `${info.portal}: open the portal, then upload/download the exact file from History.`, durationMs: 6000 });
      } else {
        show({ kind: 'info', message: info?.instructions || 'No portal upload required for this filing.', durationMs: 6000 });
      }
    },
    onError: (e: any) => show({ kind: 'error', message: e?.response?.data?.message || 'Failed to load portal info', durationMs: 4000 }),
  });

  // Fetch pay group settings to get configured state for LWF/PT defaults
  const { data: payGroupSettingsData } = useQuery({
    queryKey: ['pay-group-settings'],
    queryFn: () => payrollApi.getPayGroupSettings().then((r) => r.data),
    enabled: !!selectedRun,
  });

  // Auto-select state from pay group filing details when run changes
  const runsList = Array.isArray(runs) ? runs : (runs as any)?.runs ?? [];
  const filingsList = filingsData?.data ?? filingsData ?? [];
  const reviewList = reviewData?.data ?? reviewData ?? [];
  const employeesList = Array.isArray(employees) ? employees : (employees as any)?.data ?? [];

  const payGroups = (payGroupSettingsData as any)?.pay_groups ?? [];

  // When a run is selected, find its pay group and populate state defaults from filing_details
  const selectedRunData = runsList.find((r: any) => r.id === selectedRun);
  const runPayGroupId = selectedRunData?.pay_group_id as number | undefined;
  const payGroup = runPayGroupId
    ? payGroups.find((pg: { id: number; filing_details: PayGroupFilingDetail[] }) => pg.id === runPayGroupId)
    : undefined;

  useEffect(() => {
    if (payGroup?.filing_details && ptState === '' && lwfState === '') {
      const firstPtEnabled = payGroup.filing_details.find((d: PayGroupFilingDetail) => d.pt_enabled);
      const firstLwfEnabled = payGroup.filing_details.find((d: PayGroupFilingDetail) => d.lwf_enabled);
      if (firstPtEnabled && !ptState) setPtState(firstPtEnabled.state_code);
      if (firstLwfEnabled && !lwfState) setLwfState(firstLwfEnabled.state_code);
    }
  }, [payGroup, ptState, lwfState, setPtState, setLwfState]);

  const dueDates = (settings as any)?.settings?.compliance_due_dates ?? (settings as any)?.compliance_due_dates ?? {};

  // Compliance calendar strip
  const calendarItems = FILING_TYPES
    .map((ft) => {
      const key = DUE_DATE_KEYS[ft.key];
      const due = key ? dueDates[key] : null;
      return due ? { label: ft.label, due } : null;
    })
    .filter(Boolean) as Array<{ label: string; due: string }>;

  const today = new Date();
  const isOverdue = (due: string) => {
    const d = new Date(due);
    return !isNaN(d.getTime()) && d < today;
  };

  return (
    <div className="space-y-6">
      {onBack && (
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
      )}
      <HowItWorksCard
        intro="Generate statutory returns locally, then you (the human) file them on the relevant portal. Different filing types have very different real workflows — the badge on each card tells you which."
        whatIsThis={
          'Statutory returns required by Indian law — PF, ESI, PT, TDS, LWF, Form 16. But they are NOT all filed the same way:' +
          '\n\n• PF ECR is generated in EPFO\'s exact ECR text format and is ready to upload.' +
          '\n• ESI & PT here are reference summaries / portal-aligned CSVs for manual portal entry — the real challan/return is generated on the ESIC / state tax portal.' +
          '\n• Form 24Q is source data; the actual e-TDS return must be built in NSDL-approved RPU software (FVU format) before filing with TDS-CPC.' +
          '\n• Form 16 Part B and Form 12BA are employer-computable PDFs; Form 16 Part A requires a TRACES step this system cannot replace.' +
          '\n• LWF is state-specific and must be configured for your state first.'
        }
        whenToUse={[
          'Monthly: PF ECR (upload-ready, due 15th of next month)',
          'Monthly: ESI & PT — use these summaries to key into the ESIC / state portals',
          'Quarterly: Form 24Q source data → build the real return in NSDL RPU → file with TDS-CPC',
          'Annually: Form 16 Part B + Form 12BA (PDFs) + attach TRACES Part A',
          'Annually: Bonus Form C (Payment of Bonus Act)',
          'LWF: when due for your configured state(s)',
        ]}
        howItFlows={[
          { step: 1, label: 'Pick a run', desc: 'Select the approved/locked payroll run you want to file' },
          { step: 2, label: 'Pick filing type', desc: 'Each card shows its real compliance status — filing-ready, reference-only, or not configured' },
          { step: 3, label: 'Generate', desc: 'System pulls data and formats it per what that return actually is' },
          { step: 4, label: 'Submit & review', desc: 'Generated filings route to your internal reviewer (maker-checker) before filing' },
          { step: 5, label: 'File it yourself', desc: 'Use "Upload to portal" to open the right portal + exact file; then "Mark Filed" with the challan/ack number' },
        ]}
        commonMistakes={[
          'Treating the ESI/PT summary or Form 24Q export as a ready-to-upload file (they are not)',
          'Believing a self-assigned Form 16 certificate number is valid (only TRACES issues it)',
          'Generating filings from a draft run — always lock + approve before filing',
          'Missing statutory deadlines (penalties apply)',
        ]}
      />

      {/* Compliance calendar strip */}
      {calendarItems.length > 0 && (
        <SurfaceCard className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <CalendarClock className="h-4 w-4 text-slate-500" />
            <h3 className="text-sm font-semibold text-slate-700">Compliance calendar</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {calendarItems.map((c) => {
              const overdue = isOverdue(c.due);
              return (
                <span
                  key={c.label}
                  className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium ${
                    overdue ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-slate-50 text-slate-600 border-slate-200'
                  }`}
                >
                  {c.label} — due {new Date(c.due).toLocaleDateString()}
                  {overdue && <AlertCircle className="h-3 w-3" />}
                </span>
              );
            })}
          </div>
        </SurfaceCard>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <Button
          variant={activeTab === 'generate' ? 'primary' : 'secondary'}
          size="sm"
          iconLeft={<Plus className="h-4 w-4" />}
          onClick={() => setActiveTab('generate')}
        >
          Generate
        </Button>
        <Button
          variant={activeTab === 'form16' ? 'primary' : 'secondary'}
          size="sm"
          iconLeft={<FileText className="h-4 w-4" />}
          onClick={() => setActiveTab('form16')}
        >
          Form 16
        </Button>
        <Button
          variant={activeTab === 'upload-form16' ? 'primary' : 'secondary'}
          size="sm"
          iconLeft={<Upload className="h-4 w-4" />}
          onClick={() => setActiveTab('upload-form16')}
        >
          Upload Form 16
        </Button>
        <Button
          variant={activeTab === 'history' ? 'primary' : 'secondary'}
          size="sm"
          iconLeft={<History className="h-4 w-4" />}
          onClick={() => setActiveTab('history')}
        >
          Filing History
        </Button>
        <Button
          variant={activeTab === 'review' ? 'primary' : 'secondary'}
          size="sm"
          iconLeft={<ClipboardCheck className="h-4 w-4" />}
          onClick={() => setActiveTab('review')}
        >
          Reviewer Queue{reviewList.length ? ` (${reviewList.length})` : ''}
        </Button>
      </div>

      {activeTab === 'generate' ? (
        <>
          <SurfaceCard className="p-5">
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Select Payroll Run
            </label>
            {runsLoading ? (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading runs...
              </div>
            ) : (
              <select
                value={selectedRun ?? ''}
                onChange={(e) => setSelectedRun(Number(e.target.value) || null)}
                className="w-full max-w-md border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">Choose a payroll run...</option>
                {runsList.map((run: any) => (
                  <option key={run.id} value={run.id}>
                    {run.month_year} — {run.status} ({run.total_employees || run.employee_count || 0} employees)
                  </option>
                ))}
              </select>
            )}
            {runsList.length === 0 && !runsLoading && (
              <p className="mt-2 text-xs text-amber-600 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" /> No processed payroll runs found. Process and lock a run first.
              </p>
            )}
            {selectedRun && runValidation && !runValidation.ready && (
              <p className="mt-2 text-xs text-rose-600 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                Run is not approved/locked ({runValidation.run_status}). {runValidation.errors?.[0]?.message}
              </p>
            )}
            {selectedRun && runValidation?.ready && (
              <p className="mt-2 text-xs text-emerald-600 flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" /> Run {runValidation.run_status} — ready to generate from.
              </p>
            )}
          </SurfaceCard>

          {selectedRun && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {FILING_TYPES.map((ft) => {
                  const runBlocked = runValidation && !runValidation.ready;
                  const disabled = generateSingleMutation.isPending || !!runBlocked;
                  return (
                    <div key={ft.key} className="flex flex-col gap-2">
                      <FilingButton
                        label={ft.label}
                        desc={ft.desc}
                        tooltip={ft.tooltip}
                        complianceStatus={ft.complianceStatus}
                        onClick={() => generateSingleMutation.mutate({ type: ft.key, runId: selectedRun })}
                        disabled={disabled}
                        needsState={ft.needsState}
                        state={ft.needsState ? (ft.key === 'lwf_return' ? lwfState : ptState) : undefined}
                        onStateChange={ft.key === 'lwf_return' ? setLwfState : setPtState}
                      />
                      {ft.needsState && ft.key === 'lwf_return' && !lwfState && (
                        <p className="text-[10px] text-rose-600 px-1">Select your state to enable (some states unsupported).</p>
                      )}
                      {ft.needsBonusPercent && (
                        <div className="flex items-center gap-2 px-1">
                          <label className="text-xs text-slate-600 whitespace-nowrap">Bonus %</label>
                          <input
                            type="number"
                            min={8.33}
                            max={20}
                            step={0.01}
                            value={bonusPercent}
                            onChange={(e) => setBonusPercent(e.target.value)}
                            className="w-20 text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="flex justify-center pt-2">
                <Button
                  variant="primary"
                  size="md"
                  onClick={() => generateAllMutation.mutate(selectedRun)}
                  disabled={generateAllMutation.isPending || !!runValidation && !runValidation.ready}
                  iconLeft={generateAllMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}
                >
                  {generateAllMutation.isPending ? 'Generating All...' : 'Generate All Filings'}
                </Button>
              </div>
            </>
          )}
        </>
      ) : activeTab === 'form16' ? (
        <SurfaceCard className="p-5">
          <h3 className="text-lg font-semibold text-slate-900 mb-4">Generate Form 16 Part B (Salary Statement)</h3>
          <p className="text-sm text-slate-500 mb-4">
            Form 16 Part B is generated per employee per financial year as a PDF. Select an employee and financial year to generate.
            It aggregates all monthly payroll data for the selected FY (Apr–Mar). Note: Part A — the TDS certificate bearing the
            number issued by TRACES — must be downloaded from TRACES after quarterly TDS filing and attached separately; this
            system cannot mint that certificate number.
          </p>
          {employeesLoading ? (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading employees...
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Employee</label>
                <select
                  value={form16EmployeeId ?? ''}
                  onChange={(e) => setForm16EmployeeId(Number(e.target.value) || null)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select employee...</option>
                  {employeesList.map((emp: any) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name} ({emp.email})
                    </option>
                  ))}
                </select>
                {employeesList.length === 0 && (
                  <p className="mt-1 text-xs text-amber-600">No employees found in your organization.</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Financial Year</label>
<select
                  value={form16FinancialYear}
                  onChange={(e) => setForm16FinancialYear(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select financial year...</option>
                  <option value="2026-2027">2026-2027</option>
                  <option value="2025-2026">2025-2026</option>
                  <option value="2024-2025">2024-2025</option>
                  <option value="2023-2024">2023-2024</option>
                  <option value="2022-2023">2022-2023</option>
                </select>
              </div>
            </div>
          )}
          <div className="flex items-center gap-3">
            <Button
              variant="primary"
              onClick={() => {
                if (form16EmployeeId && form16FinancialYear) {
                  generateForm16Mutation.mutate({ userId: form16EmployeeId, financialYear: form16FinancialYear });
                }
              }}
              disabled={generateForm16Mutation.isPending || !form16EmployeeId || !form16FinancialYear}
              iconLeft={generateForm16Mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}
            >
              {generateForm16Mutation.isPending ? 'Generating...' : 'Generate Form 16'}
            </Button>
          </div>
{generateForm16Mutation.isError && (
              <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                <strong>Error:</strong>{' '}
                {(generateForm16Mutation.error as any)?.response?.data?.errors
                  ? Object.entries((generateForm16Mutation.error as any)?.response?.data?.errors).map(([_field, msgs]: [string, any]) =>
                      Array.isArray(msgs) ? msgs.join(', ') : msgs).join(' | ')
                  : (generateForm16Mutation.error as any)?.response?.data?.message || generateForm16Mutation.error?.message || 'Something went wrong'}
              </div>
            )}
        </SurfaceCard>
      ) : activeTab === 'upload-form16' ? (
        <div className="flex items-center justify-center py-12">
          <Button
            variant="primary"
            size="lg"
            iconLeft={<Upload className="h-5 w-5" />}
            onClick={() => setShowUploadModal(true)}
          >
            Upload Form 16 Files
          </Button>
        </div>
      ) : activeTab === 'review' ? (
        <SurfaceCard className="overflow-hidden">
          {reviewLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : reviewList.length === 0 ? (
            <div className="text-center py-12">
              <ClipboardCheck className="h-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="text-sm text-slate-500">No filings awaiting your review.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Type</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Period</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Submitted</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {reviewList.map((f: any) => (
                  <tr key={f.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">{f.type?.replace(/_/g, ' ')?.toUpperCase()}</td>
                    <td className="px-4 py-3 text-slate-600">{f.period_month ? `${f.period_month}/${f.period_year}` : `FY ${f.period_year}`}</td>
                    <td className="px-4 py-3 text-slate-600">{f.submitted_at ? new Date(f.submitted_at).toLocaleDateString() : '-'}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <Button variant="ghost" size="sm" className="text-emerald-600" onClick={() => approveMutation.mutate(f.id)} disabled={approveMutation.isPending}>Approve</Button>
                      <Button variant="ghost" size="sm" className="text-rose-600" onClick={() => { const r = window.prompt('Rejection reason'); if (r) rejectMutation.mutate({ id: f.id, reason: r }); }}>Reject</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SurfaceCard>
      ) : (
        <SurfaceCard className="overflow-hidden">
          {filingsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : !Array.isArray(filingsList) || filingsList.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="h-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="text-sm text-slate-500">No filings generated yet</p>
              <p className="text-xs text-slate-400 mt-1">Use the Generate tab to create PF, ESI, TDS, PT or LWF returns.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50">
                <span className="text-sm font-medium text-slate-700">{filingsList.length} filing(s)</span>
                <Button
                  variant="secondary"
                  size="sm"
                  iconLeft={<Download className="h-4 w-4" />}
                  onClick={() => {
                    const headers = ['Type', 'Period', 'Status', 'Generated At'];
                    const rows = filingsList.map((f: any) => [
                      f.type?.replace(/_/g, ' ')?.toUpperCase() ?? f.type,
                      f.period_type === 'annual'
                        ? `FY ${f.period_year}-${(f.period_year || 0) + 1}`
                        : f.period_month
                          ? `${f.period_month}/${f.period_year}`
                          : `Q${f.period_quarter}/${f.period_year}`,
                      f.status,
                      f.generated_at ? new Date(f.generated_at).toLocaleDateString() : '',
                    ]);
                    const escapeCsv = (val: any) => {
                      const str = String(val ?? '');
                      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                        return '"' + str.replace(/"/g, '""') + '"';
                      }
                      return str;
                    };
                    const bom = '\uFEFF';
                    const csv = bom + [headers.join(','), ...rows.map(r => r.map(escapeCsv).join(','))].join('\n');
                    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `filings-history.csv`;
                    a.click();
                  }}
                >
                  Export CSV
                </Button>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Type</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Period</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Ack</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filingsList.map((filing: any) => (
                    <tr key={filing.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-slate-900">{filing.type?.replace(/_/g, ' ')?.toUpperCase() ?? filing.type}</td>
                      <td className="px-4 py-3 text-slate-600">
                        {filing.period_type === 'annual'
                          ? `FY ${filing.period_year}-${(filing.period_year || 0) + 1}`
                          : filing.period_month
                            ? `${filing.period_month}/${filing.period_year}`
                            : `Q${filing.period_quarter}/${filing.period_year}`
                        }
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[filing.status as FilingStatus] ?? 'bg-slate-100 text-slate-700'}`}>
                          {filing.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600 max-w-[160px] truncate" title={filing.acknowledgment_number}>
                        {filing.acknowledgment_number || (filing.status === 'filed' || filing.status === 'acknowledged' ? '—' : '')}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {filing.file_path && (
                          <Button
                            variant="ghost"
                            size="sm"
                            iconLeft={<Download className="h-4 w-4" />}
                            onClick={() => downloadMutation.mutate(filing)}
                            disabled={downloadMutation.isPending}
                          >
                            Download
                          </Button>
                        )}
                        {filing.status !== 'filed' && filing.status !== 'acknowledged' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-blue-600"
                            iconLeft={<Upload className="h-4 w-4" />}
                            onClick={() => portalInfoMutation.mutate(filing.id)}
                            disabled={portalInfoMutation.isPending}
                            title="Open the government portal to upload/pre-fill"
                          >
                            Upload to portal
                          </Button>
                        )}
                        {(filing.status === 'approved' || filing.status === 'submitted' || filing.status === 'generated') && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-emerald-600"
                            iconLeft={<Send className="h-4 w-4" />}
                            onClick={() => setMarkFiledFor(filing.id)}
                          >
                            Mark Filed
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </SurfaceCard>
      )}

      {/* Mark Filed modal */}
      {markFiledFor !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setMarkFiledFor(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-slate-900 mb-2">Record as Filed</h3>
            <p className="text-sm text-slate-500 mb-4">
              After you (the human) log in and pay on the government portal, paste the acknowledgement / challan number below. It is recorded in the filing history.
            </p>
            <label className="block text-sm font-medium text-slate-700 mb-1">Acknowledgement / Challan Number</label>
            <input
              autoFocus
              value={ackInput}
              onChange={(e) => setAckInput(e.target.value)}
              placeholder="e.g. ACK1234567890"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex justify-end gap-2 mt-5">
              <Button variant="secondary" size="sm" onClick={() => setMarkFiledFor(null)}>Cancel</Button>
              <Button
                variant="primary"
                size="sm"
                disabled={!ackInput.trim() || markFiledMutation.isPending}
                onClick={() => markFiledMutation.mutate({ id: markFiledFor, ack: ackInput.trim() })}
              >
                {markFiledMutation.isPending ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Upload Form 16 Modal */}
      <UploadForm16Modal
        isOpen={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        financialYear={form16FinancialYear}
        organizationName={organizationName}
      />
    </div>
  );
}
