import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ShieldCheck,
  Loader2,
  Download,
  Sparkles,
  ArrowUpRight,
} from 'lucide-react';
import { payrollApi } from '@/services/api';
import Button from '@/components/ui/Button';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import StatusBadge from '@/components/ui/StatusBadge';
import InfoTooltip from '@/components/ui/InfoTooltip';
import { useToast } from '@/components/ui/Toast';

interface ComplianceStatusBoardProps {
  monthYear: string; // YYYY-MM
  onOpenFilings?: () => void;
}

type StatutoryItem = {
  key: string;
  label: string;
  period: 'monthly' | 'quarterly' | 'annual';
  due: string;
  tooltip: string;
  // Can be generated inline from a run (no extra input needed).
  inlineGenerate?: boolean;
  // Requires extra input (state / employee / FY) — defer to full Filings view.
  deferToFilings?: boolean;
  pattern: 'A' | 'B' | 'C';
};

const PATTERN_BADGE: Record<'A' | 'B' | 'C', { label: string; className: string }> = {
  A: { label: 'A', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  B: { label: 'B', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  C: { label: 'C', className: 'bg-orange-50 text-orange-700 border-orange-200' },
};

// Statutory readiness items. Metadata mirrors FilingsDashboard's FILING_TYPES
// and adds Form 16 (annual, per-employee). Filing `type` keys must match the
// backend filing types so history lookups resolve.
const STATUTORY_ITEMS: StatutoryItem[] = [
  { key: 'pf_ecr', label: 'PF ECR', period: 'monthly', due: 'Due 15th of next month', tooltip: 'Electronic Challan cum Return — monthly PF contribution filing with EPFO.', inlineGenerate: true, pattern: 'A' },
  { key: 'esi_challan', label: 'ESI Challan', period: 'monthly', due: 'Due 15th of next month', tooltip: 'Monthly ESI contribution filing with ESIC. Generated as an Excel (.xls) template matching the portal upload format.', inlineGenerate: true, pattern: 'A' },
  { key: 'pt_return', label: 'PT Return', period: 'monthly', due: 'Varies by state', tooltip: 'State-level Professional Tax return. Requires selecting a state — open Filings to generate.', deferToFilings: true, pattern: 'A' },
  { key: 'form_24q', label: 'Form 24Q', period: 'quarterly', due: '15 days after quarter end', tooltip: 'Quarterly TDS return generated in NSDL FVU format — a ^-delimited ASCII .txt file ready for TDS-CPC upload.', inlineGenerate: true, pattern: 'B' },
  { key: 'lwf_return', label: 'LWF Return', period: 'annual', due: 'State-dependent (annual)', tooltip: 'Annual Labour Welfare Fund contribution. Required only in some states.', inlineGenerate: true, pattern: 'A' },
  { key: 'form_12ba', label: 'Form 12BA', period: 'annual', due: 'By 15 June (annual)', tooltip: 'Annual statement of perquisites paid to employees.', inlineGenerate: true, pattern: 'B' },
  { key: 'bonus_form_c', label: 'Bonus — Form C', period: 'annual', due: 'By 15 June (annual)', tooltip: 'Annual Return under the Payment of Bonus Act — Form C. Requires a bonus percentage (8.33%–20%) configured in Payroll Settings.', inlineGenerate: true, pattern: 'B' },
  { key: 'bonus_form_d', label: 'Bonus — Form D', period: 'annual', due: 'By 15 June (annual)', tooltip: 'Register of Bonus Paid/Claimable under the Payment of Bonus Act — Form D. A statutory record maintained by the employer.', inlineGenerate: true, pattern: 'B' },
  { key: 'form_16', label: 'Form 16', period: 'annual', due: 'By 15 June (annual)', tooltip: 'Annual TDS certificate — generated per employee. Open Filings to generate.', deferToFilings: true, pattern: 'C' },
  { key: 'form_19', label: 'Form 19', period: 'monthly', due: 'On termination', tooltip: 'Final Settlement statement for exiting employees. Open Filings to generate.', deferToFilings: true, pattern: 'A' },
  { key: 'form_31', label: 'Form 31', period: 'monthly', due: 'On transfer', tooltip: 'Transfer Application form for employees changing departments. Open Filings to generate.', deferToFilings: true, pattern: 'A' },
  { key: 'form_1', label: 'Form 1', period: 'monthly', due: 'On joining', tooltip: 'Employer Registration form with organization details. Open Filings to generate.', deferToFilings: true, pattern: 'A' },
  { key: 'form_2', label: 'Form 2', period: 'monthly', due: 'Monthly', tooltip: 'Employee Registration form listing all active employees. Open Filings to generate.', deferToFilings: true, pattern: 'A' },
  { key: 'form_6', label: 'Form 6', period: 'monthly', due: 'Monthly', tooltip: 'Monthly Return summarizing employee contributions (PF, ESI, TDS). Open Filings to generate.', deferToFilings: true, pattern: 'A' },
  { key: 'eshram_registration', label: 'e-SHRAM', period: 'monthly', due: 'On joining', tooltip: 'e-SHRAM registration details for employees. Open Filings to generate.', deferToFilings: true, pattern: 'A' },
  { key: 'uan_activation', label: 'UAN Activation', period: 'monthly', due: 'On joining', tooltip: 'UAN activation status for employees. Open Filings to generate.', deferToFilings: true, pattern: 'A' },
  { key: 'se_registration', label: 'S&E Registration', period: 'annual', due: 'Annual', tooltip: 'State & Employer registration details. Open Filings to generate.', deferToFilings: true, pattern: 'A' },
  { key: 'shram_card_registration', label: 'Shram Card', period: 'monthly', due: 'On joining', tooltip: 'Shram Card registration details for employees. Open Filings to generate.', deferToFilings: true, pattern: 'A' },
  { key: 'form_124', label: 'Form 124', period: 'monthly', due: 'Monthly', tooltip: 'Monthly statutory return with employee salary and TDS details. Open Filings to generate.', deferToFilings: true, pattern: 'A' },
  { key: 'full_ecr', label: 'Full ECR', period: 'monthly', due: 'Due 15th of next month', tooltip: 'Full Electronic Challan cum Return with extended employee details. Open Filings to generate.', deferToFilings: true, pattern: 'A' },
];

type FilingRecord = {
  id: number;
  type: string;
  status: string;
  period_type?: string;
  period_month?: number | string | null;
  period_quarter?: number | string | null;
  period_year?: number | string | null;
  file_path?: string | null;
  original_filename?: string | null;
};

const DONE_STATUSES = new Set(['generated', 'filed', 'acknowledged']);

export default function ComplianceStatusBoard({ monthYear, onOpenFilings }: ComplianceStatusBoardProps) {
  const queryClient = useQueryClient();
  const { show } = useToast();

  const [yearStr, monthStr] = (monthYear || '').split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);

  const { data: runsData } = useQuery({
    queryKey: ['payroll', 'runs'],
    queryFn: () => payrollApi.getPayrollRuns().then((r) => r.data),
  });

  const { data: filingsData, isLoading: filingsLoading } = useQuery({
    queryKey: ['payroll-filings'],
    queryFn: () => payrollApi.listFilings().then((r) => r.data),
  });

  const runs = useMemo(
    () => (Array.isArray(runsData) ? runsData : (runsData as any)?.runs ?? []) as Array<any>,
    [runsData],
  );

  // The run that backs the selected month's statutory filings.
  const monthRun = useMemo(
    () => runs.find((r) => (r.month_year ?? r.run_month) === monthYear) ?? null,
    [runs, monthYear],
  );

  const filingsList = useMemo<FilingRecord[]>(() => {
    const list = (filingsData as any)?.data ?? filingsData ?? [];
    return Array.isArray(list) ? (list as FilingRecord[]) : [];
  }, [filingsData]);

  // Find the most relevant filing for a given statutory item + selected month.
  const findFiling = (item: StatutoryItem): FilingRecord | undefined => {
    return filingsList.find((f) => {
      if (f.type !== item.key) return false;
      const fYear = Number(f.period_year);
      if (item.period === 'monthly') {
        return Number(f.period_month) === month && fYear === year;
      }
      // Quarterly / annual: match on the calendar year (best-effort, since the
      // board is a readiness snapshot rather than an authoritative ledger).
      return fYear === year;
    });
  };

  const rows = useMemo(() => {
    return STATUTORY_ITEMS.map((item) => {
      const filing = findFiling(item);
      let tone: 'success' | 'warning' | 'danger' | 'neutral' = 'neutral';
      let statusLabel = 'Upcoming';

      if (filing) {
        if (filing.status === 'error') {
          tone = 'danger';
          statusLabel = 'Error';
        } else if (DONE_STATUSES.has(filing.status)) {
          tone = 'success';
          statusLabel = filing.status === 'generated' ? 'Generated' : filing.status.charAt(0).toUpperCase() + filing.status.slice(1);
        } else {
          tone = 'warning';
          statusLabel = filing.status || 'Pending';
        }
      } else if (monthRun) {
        tone = 'warning';
        statusLabel = 'Pending';
      } else {
        tone = 'neutral';
        statusLabel = 'No run';
      }

      return { item, filing, tone, statusLabel };
    });
     
  }, [filingsList, monthRun, month, year]);

    const generateSingle = useMutation({
      mutationFn: ({ type, runId }: { type: string; runId: number }) => {
        switch (type) {
          case 'pf_ecr': return payrollApi.generatePfEcr(runId);
          case 'esi_challan': return payrollApi.generateEsiChallan(runId);
          case 'form_24q': return payrollApi.generateForm24Q(runId);
          case 'form_12ba': return payrollApi.generateForm12BA(runId);
          case 'lwf_return': return payrollApi.generateLwfReturn(runId, '');
          case 'bonus_form_c': return payrollApi.generateBonusFormC(runId, 8.33);
          case 'bonus_form_d': return payrollApi.generateBonusFormD(runId, 8.33);
          default: throw new Error('Unknown filing type');
        }
      },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['payroll-filings'] });
      show({ kind: 'success', message: `${vars.type.replace(/_/g, ' ').toUpperCase()} generated`, durationMs: 4000 });
    },
    onError: (e: any) => {
      show({ kind: 'error', message: e?.response?.data?.message || e?.message || 'Failed to generate filing', durationMs: 5000 });
    },
  });

  const generateAll = useMutation({
    mutationFn: (runId: number) => payrollApi.generateAllFilings(runId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll-filings'] });
      show({ kind: 'success', message: 'All filings generated', durationMs: 4000 });
    },
    onError: (e: any) => {
      show({ kind: 'error', message: e?.response?.data?.message || e?.message || 'Failed to generate filings', durationMs: 5000 });
    },
  });

  const downloadMutation = useMutation({
    mutationFn: async (filing: FilingRecord) => {
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
    onError: (e: any) => {
      show({ kind: 'error', message: e?.message || 'Failed to download filing', durationMs: 4000 });
    },
  });

  const readyCount = rows.filter((r) => r.tone === 'success').length;

  return (
    <SurfaceCard className="p-5">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Compliance Status</h2>
            <p className="text-sm text-slate-500">
              {monthRun
                ? `${readyCount} of ${rows.length} statutory items generated for ${monthYear}`
                : `No payroll run for ${monthYear} yet — process a run to enable filings`}
            </p>
          </div>
        </div>
        {monthRun && (
          <Button
            variant="primary"
            size="sm"
            iconLeft={generateAll.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            onClick={() => generateAll.mutate(monthRun.id)}
            disabled={generateAll.isPending}
          >
            {generateAll.isPending ? 'Generating...' : 'Generate All'}
          </Button>
        )}
      </div>

      {filingsLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-slate-100" />
          ))}
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {rows.map(({ item, filing, tone, statusLabel }) => {
            const canInlineGenerate = item.inlineGenerate && monthRun && tone !== 'success';
            const canDownload = filing?.file_path && tone === 'success';
            return (
              <div key={item.key} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                     <p className="truncate font-medium text-slate-900">{item.label}</p>
                     <InfoTooltip content={item.tooltip} title={item.label} size="sm" />
                     <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                       {item.period}
                     </span>
                     <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium border ${PATTERN_BADGE[item.pattern].className}`}>
                       P{item.pattern}
                     </span>
                   </div>
                  <p className="mt-0.5 text-xs text-slate-500">{item.due}</p>
                </div>

                <StatusBadge tone={tone}>{statusLabel}</StatusBadge>

                <div className="flex justify-end whitespace-nowrap">
                  {canDownload ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      iconLeft={<Download className="h-4 w-4" />}
                      onClick={() => filing && downloadMutation.mutate(filing)}
                      disabled={downloadMutation.isPending}
                    >
                      Download
                    </Button>
                  ) : item.deferToFilings ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      iconRight={<ArrowUpRight className="h-4 w-4" />}
                      onClick={onOpenFilings}
                    >
                      Open Filings
                    </Button>
                  ) : canInlineGenerate ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => monthRun && generateSingle.mutate({ type: item.key, runId: monthRun.id })}
                      disabled={generateSingle.isPending}
                    >
                      Generate
                    </Button>
                  ) : (
                    <span className="text-xs text-slate-400">
                      {monthRun ? '—' : 'Needs run'}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </SurfaceCard>
  );
}
