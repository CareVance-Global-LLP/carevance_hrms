import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, Download, Plus, History, Loader2, ArrowLeft, AlertCircle, CheckCircle2 } from 'lucide-react';
import { payrollApi } from '@/services/api';
import Button from '@/components/ui/Button';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import InfoTooltip from '@/components/ui/InfoTooltip';
import HowItWorksCard from './HowItWorksCard';
import { useToast } from '@/components/ui/Toast';

const FILING_TYPES = [
  { key: 'pf_ecr', label: 'PF ECR', desc: 'EPFO monthly return', needsRun: true, tooltip: 'Electronic Challan cum Return — monthly PF contribution filing with EPFO. Due by the 15th of the next month.' },
  { key: 'esi_challan', label: 'ESI Challan', desc: 'ESI monthly challan', needsRun: true, tooltip: 'Monthly ESI contribution filing with ESIC. Due by the 15th of the next month.' },
  { key: 'form_24q', label: 'Form 24Q', desc: 'Quarterly TDS return', needsRun: true, tooltip: 'Quarterly TDS return on salary payments. Due 15 days after quarter end (15 Jul, 15 Oct, 15 Jan, 31 May).' },
  { key: 'form_12ba', label: 'Form 12BA', desc: 'Perquisites statement', needsRun: true, tooltip: 'Annual statement of perquisites paid to employees. Issued to each employee by 15 June.' },
  { key: 'pt_return', label: 'PT Return', desc: 'Professional Tax return', needsRun: true, needsState: true, tooltip: 'State-level Professional Tax return. Due dates vary by state (usually 15th–30th of next month).' },
  { key: 'lwf_return', label: 'LWF Return', desc: 'Labour Welfare Fund', needsRun: true, tooltip: 'Annual Labour Welfare Fund contribution. Required only in some states (Maharashtra, Karnataka, Kerala, etc.).' },
];

interface FilingButtonProps {
  label: string;
  desc: string;
  onClick: () => void;
  disabled?: boolean;
  needsState?: boolean;
  state?: string;
  onStateChange?: (state: string) => void;
}

function FilingButton({ label, desc, onClick, disabled, needsState, state, onStateChange }: FilingButtonProps) {
  return (
    <SurfaceCard
      className={`p-4 cursor-pointer hover:shadow-md hover:border-blue-300 transition-all ${
        disabled ? 'opacity-50 pointer-events-none' : ''
      }`}
      onClick={needsState ? undefined : onClick}
    >
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
          <FileText className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-1">
            <h3 className="font-semibold text-slate-900 text-sm">{label}</h3>
            <InfoTooltip content={desc} title={label} size="sm" />
          </div>
          <p className="text-xs text-slate-500 mt-0.5">{desc}</p>
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
                <option value="maharashtra">Maharashtra</option>
                <option value="karnataka">Karnataka</option>
                <option value="tamil_nadu">Tamil Nadu</option>
                <option value="gujarat">Gujarat</option>
                <option value="west_bengal">West Bengal</option>
                <option value="delhi">Delhi</option>
                <option value="haryana">Haryana</option>
                <option value="uttar_pradesh">Uttar Pradesh</option>
                <option value="telangana">Telangana</option>
                <option value="andhra_pradesh">Andhra Pradesh</option>
                <option value="rajasthan">Rajasthan</option>
                <option value="madhya_pradesh">Madhya Pradesh</option>
                <option value="punjab">Punjab</option>
                <option value="odisha">Odisha</option>
                <option value="kerala">Kerala</option>
                <option value="bihar">Bihar</option>
                <option value="jharkhand">Jharkhand</option>
                <option value="assam">Assam</option>
              </select>
            </div>
          )}
        </div>
      </div>
    </SurfaceCard>
  );
}

export default function FilingsDashboard({ onBack }: { onBack?: () => void }) {
  const queryClient = useQueryClient();
  const { show } = useToast();
  const [selectedRun, setSelectedRun] = useState<number | null>(null);
  const [ptState, setPtState] = useState<string>('');
  const [form16EmployeeId, setForm16EmployeeId] = useState<number | null>(null);
  const [form16FinancialYear, setForm16FinancialYear] = useState<string>('2025-2026');
  const [activeTab, setActiveTab] = useState<'generate' | 'history' | 'form16'>('generate');

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

  // Fetch filings history
  const { data: filingsData, isLoading: filingsLoading } = useQuery({
    queryKey: ['payroll-filings'],
    queryFn: () => payrollApi.listFilings().then((r) => r.data),
    enabled: activeTab === 'history',
  });

  // Download a filing
  const downloadMutation = useMutation({
    mutationFn: async (filing: { id: number; original_filename: string; type: string }) => {
      const response = await payrollApi.downloadFiling(filing.id);
      const blob = new Blob([response.data], { type: 'text/html' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filing.original_filename || `${filing.type}.html`;
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
    mutationFn: ({ type, runId }: { type: string; runId: number }) => {
      switch (type) {
        case 'pf_ecr': return payrollApi.generatePfEcr(runId);
        case 'esi_challan': return payrollApi.generateEsiChallan(runId);
        case 'form_24q': return payrollApi.generateForm24Q(runId);
        case 'form_12ba': return payrollApi.generateForm12BA(runId);
        case 'lwf_return': return payrollApi.generateLwfReturn(runId);
        case 'pt_return': return payrollApi.generatePtReturn(runId, ptState);
        default: throw new Error('Unknown filing type');
      }
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['payroll-filings'] });
      show({ kind: 'success', message: `${vars.type.replace(/_/g, ' ').toUpperCase()} generated successfully`, durationMs: 4000 });
    },
    onError: (e: any) => {
      show({ kind: 'error', message: e?.response?.data?.message || e?.message || 'Failed to generate filing', durationMs: 5000 });
    },
  });

  // Generate all filings at once
  const generateAllMutation = useMutation({
    mutationFn: (runId: number) => payrollApi.generateAllFilings(runId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll-filings'] });
      show({ kind: 'success', message: 'All filings generated successfully', durationMs: 4000 });
    },
    onError: (e: any) => {
      show({ kind: 'error', message: e?.response?.data?.message || e?.message || 'Failed to generate filings', durationMs: 5000 });
    },
  });

  // Generate Form 16
  const generateForm16Mutation = useMutation({
    mutationFn: ({ userId, financialYear }: { userId: number; financialYear: string }) =>
      payrollApi.generateForm16(userId, financialYear).then((r) => r.data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['payroll-filings'] });
      show({ kind: 'success', message: `Form 16 generated successfully for ${data.generated_at || 'employee'}`, durationMs: 4000 });
    },
    onError: (e: any) => {
      const msg = e?.response?.data?.message || e?.message || 'Failed to generate Form 16';
      show({ kind: 'error', message: msg, durationMs: 6000 });
    },
  });

  const runsList = Array.isArray(runs) ? runs : (runs as any)?.runs ?? [];
  const filingsList = filingsData?.data ?? filingsData ?? [];
  const employeesList = Array.isArray(employees) ? employees : (employees as any)?.data ?? [];

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
        intro="Generate statutory returns for any month and download them for upload to the respective portals."
        whatIsThis="Statutory returns required by Indian law — PF, ESI, PT, TDS, LWF, Form 16. Generate the file here, then upload to the appropriate government portal (EPFO, ESIC, TDS-CPC, state commercial tax dept)."
        whenToUse={[
          'Monthly: PF ECR + ESI Challan (both due by 15th of next month)',
          'Monthly: PT Return (varies by state)',
          'Quarterly: TDS Form 24Q (due 15 days after quarter end)',
          'Annually: Form 16 (15 June after FY ends)',
          'Annually: LWF (one or two payments per year, state-dependent)',
        ]}
        howItFlows={[
          { step: 1, label: 'Pick a run', desc: 'Select the processed payroll run you want to file' },
          { step: 2, label: 'Pick filing type', desc: 'Choose the specific return (PF ECR, ESI Challan, Form 24Q, etc.)' },
          { step: 3, label: 'Generate', desc: 'System pulls data from the run and formats per the portal spec' },
          { step: 4, label: 'Download & upload', desc: 'Save the file and upload to the respective government portal' },
        ]}
        commonMistakes={[
          'Generating Form 24Q before the run is Approved',
          'Missing the 15th-of-next-month deadline (penalty applies)',
          'Uploading a draft run — always lock + approve before filing',
        ]}
      />

      <div className="flex items-center gap-2">
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
          variant={activeTab === 'history' ? 'primary' : 'secondary'}
          size="sm"
          iconLeft={<History className="h-4 w-4" />}
          onClick={() => setActiveTab('history')}
        >
          Filing History
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
          </SurfaceCard>

          {selectedRun && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {FILING_TYPES.map((ft) => (
                  <FilingButton
                    key={ft.key}
                    label={ft.label}
                    desc={ft.tooltip ?? ft.desc}
                    onClick={() => generateSingleMutation.mutate({ type: ft.key, runId: selectedRun })}
                    disabled={generateSingleMutation.isPending}
                    needsState={ft.needsState}
                    state={ptState}
                    onStateChange={setPtState}
                  />
                ))}
              </div>

              <div className="flex justify-center pt-2">
                <Button
                  variant="primary"
                  size="md"
                  onClick={() => generateAllMutation.mutate(selectedRun)}
                  disabled={generateAllMutation.isPending}
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
          <h3 className="text-lg font-semibold text-slate-900 mb-4">Generate Form 16 (TDS Certificate)</h3>
          <p className="text-sm text-slate-500 mb-4">
            Form 16 is generated per employee per financial year. Select an employee and financial year to generate.
            The certificate aggregates all monthly payroll data for the selected FY (Apr–Mar).
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
            {generateForm16Mutation.isSuccess && (
              <span className="flex items-center gap-1 text-xs text-emerald-600">
                <CheckCircle2 className="h-3 w-3" /> Generated! Check Filing History tab.
              </span>
            )}
          </div>
          {generateForm16Mutation.isError && (
            <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
              <strong>Error:</strong> {generateForm16Mutation.error?.message || 'Something went wrong'}
            </div>
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
              <FileText className="h-12 w-12 text-slate-300 mx-auto mb-3" />
              <p className="text-sm text-slate-500">No filings generated yet</p>
              <p className="text-xs text-slate-400 mt-1">Use the Generate tab to create PF, ESI, TDS, PT or LWF returns.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Type</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Period</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Generated</th>
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
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        filing.status === 'generated' ? 'bg-emerald-50 text-emerald-700' :
                        filing.status === 'filed' ? 'bg-blue-50 text-blue-700' :
                        filing.status === 'acknowledged' ? 'bg-violet-50 text-violet-700' :
                        filing.status === 'error' ? 'bg-rose-50 text-rose-700' :
                        'bg-slate-100 text-slate-700'
                      }`}>
                        {filing.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {filing.generated_at ? new Date(filing.generated_at).toLocaleDateString() : '-'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {filing.file_path && (
                        <Button
                          variant="ghost"
                          size="sm"
                          iconLeft={<Download className="h-4 w-4" />}
                          onClick={() => downloadMutation.mutate(filing)}
                          disabled={downloadMutation.isPending}
                        >
                          {downloadMutation.isPending ? 'Downloading...' : 'Download'}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SurfaceCard>
      )}
    </div>
  );
}
