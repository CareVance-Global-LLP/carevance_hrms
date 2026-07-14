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
};

// Statutory readiness items. Metadata mirrors FilingsDashboard's FILING_TYPES
// and adds Form 16 (annual, per-employee). Filing `type` keys must match the
// backend filing types so history lookups resolve.
const STATUTORY_ITEMS: StatutoryItem[] = [
  { key: 'pf_ecr', label: 'PF ECR', period: 'monthly', due: 'Due 15th of next month', tooltip: 'Electronic Challan cum Return — monthly PF contribution filing with EPFO.', inlineGenerate: true },
  { key: 'esi_challan', label: 'ESI Challan', period: 'monthly', due: 'Due 15th of next month', tooltip: 'Monthly ESI contribution filing with ESIC.', inlineGenerate: true },
  { key: 'pt_return', label: 'PT Return', period: 'monthly', due: 'Varies by state', tooltip: 'State-level Professional Tax return. Requires selecting a state — open Filings to generate.', deferToFilings: true },
  { key: 'form_24q', label: 'Form 24Q', period: 'quarterly', due: '15 days after quarter end', tooltip: 'Quarterly TDS return on salary payments.', inlineGenerate: true },
  { key: 'lwf_return', label: 'LWF Return', period: 'annual', due: 'State-dependent (annual)', tooltip: 'Annual Labour Welfare Fund contribution. Required only in some states.', inlineGenerate: true },
  { key: 'form_12ba', label: 'Form 12BA', period: 'annual', due: 'By 15 June (annual)', tooltip: 'Annual statement of perquisites paid to employees.', inlineGenerate: true },
  { key: 'form_16', label: 'Form 16', period: 'annual', due: 'By 15 June (annual)', tooltip: 'Annual TDS certificate — generated per employee. Open Filings to generate.', deferToFilings: true },
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

  const [yearStr, monthStr] = monthYear.split('-');
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filingsList, monthRun, month, year]);

  const generateSingle = useMutation({
    mutationFn: ({ type, runId }: { type: string; runId: number }) => {
      switch (type) {
        case 'pf_ecr': return payrollApi.generatePfEcr(runId);
        case 'esi_challan': return payrollApi.generateEsiChallan(runId);
        case 'form_24q': return payrollApi.generateForm24Q(runId);
        case 'form_12ba': return payrollApi.generateForm12BA(runId);
        case 'lwf_return': return payrollApi.generateLwfReturn(runId);
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
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[rgba(93,150,157,0.1)] text-[#5D969D]">
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
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">{item.due}</p>
                </div>

                <StatusBadge tone={tone}>{statusLabel}</StatusBadge>

                <div className="flex w-[132px] shrink-0 justify-end">
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
