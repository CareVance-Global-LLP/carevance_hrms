import { useState, useEffect, useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  FileSpreadsheet,
  Download,
  Loader2,
  Building2,
  Users,
  IndianRupee,
  CheckCircle,
  AlertCircle,
  Clock,
  RefreshCw,
  History,
} from 'lucide-react';
import { payrollApi, getApiErrorMessage } from '@/services/api';
import Button from '@/components/ui/Button';
import { FieldLabel } from '@/components/ui/FormField';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import PageHeader from '@/components/dashboard/PageHeader';
import { formatPayrollAmount } from '@/components/ui/PayrollAmount';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/contexts/AuthContext';

// ─── Constants ────────────────────────────────────────────────────────
const REPORT_TYPES = [
  { key: 'payroll-register', label: 'Payroll Register', desc: 'Complete payroll register for the month', icon: FileSpreadsheet },
  { key: 'pf', label: 'PF Register', desc: 'PF contributions for the month', icon: Building2 },
  { key: 'esi', label: 'ESI Register', desc: 'ESI contributions for the month', icon: Users },
  { key: 'pt', label: 'PT Register', desc: 'Professional Tax deductions', icon: IndianRupee },
  { key: 'tds', label: 'TDS Register', desc: 'Tax deducted at source', icon: IndianRupee },
  { key: 'bank-reconciliation', label: 'Bank Reconciliation', desc: 'Bank transfer reconciliation', icon: CheckCircle },
] as const;

type ReportKey = typeof REPORT_TYPES[number]['key'];
type ExportFormat = 'csv' | 'json';

const HISTORY_STORAGE_KEY = 'report-generation-history';

interface GenerationHistoryEntry {
  reportKey: ReportKey;
  reportLabel: string;
  period: string;
  format: ExportFormat;
  generatedBy: string;
  timestamp: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────
function getReportStatus(reportKey: ReportKey, monthYear: string): { label: string; tone: 'ready' | 'stale' | 'never'; timestamp?: number } {
  try {
    const raw = localStorage.getItem(`${HISTORY_STORAGE_KEY}-${reportKey}-${monthYear}`);
    if (!raw) return { label: 'Never generated', tone: 'never' };
    const entry: GenerationHistoryEntry = JSON.parse(raw);
    const diffMs = Date.now() - entry.timestamp;
    const diffMin = Math.floor(diffMs / 60000);
    const diffHr = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHr / 24);
    if (diffMin < 1) return { label: 'Generated just now', tone: 'ready', timestamp: entry.timestamp };
    if (diffMin < 60) return { label: `Generated ${diffMin}m ago`, tone: 'ready', timestamp: entry.timestamp };
    if (diffHr < 24) return { label: `Generated ${diffHr}h ago`, tone: 'ready', timestamp: entry.timestamp };
    if (diffDay < 30) return { label: `Generated ${diffDay}d ago`, tone: 'stale', timestamp: entry.timestamp };
    return { label: `Last: ${diffDay} days ago`, tone: 'stale', timestamp: entry.timestamp };
  } catch {
    return { label: 'Never generated', tone: 'never' };
  }
}

function recordGeneration(reportKey: ReportKey, reportLabel: string, period: string, format: ExportFormat, userName: string) {
  const entry: GenerationHistoryEntry = {
    reportKey,
    reportLabel,
    period,
    format,
    generatedBy: userName,
    timestamp: Date.now(),
  };
  localStorage.setItem(`${HISTORY_STORAGE_KEY}-${reportKey}-${period}`, JSON.stringify(entry));
  // Also append to global history list
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    const list: GenerationHistoryEntry[] = raw ? JSON.parse(raw) : [];
    list.unshift(entry);
    if (list.length > 50) list.length = 50;
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(list));
  } catch { /* ignore */ }
}

function getHistoryList(): GenerationHistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function exportData(data: any, reportKey: string, monthYear: string, format: ExportFormat) {
  const rows = Array.isArray(data) ? data : (data.records || data.data || []);
  if (rows.length === 0) return;

  if (format === 'json') {
    const json = JSON.stringify(rows, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${reportKey}-${monthYear}.json`;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }

  // CSV export
  const headers = Object.keys(rows[0]);
  const escapeCsv = (val: any) => {
    if (val === null || val === undefined) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  };
  const bom = '\uFEFF';
  const csv = bom + [
    headers.map(h => h.replace(/_/g, ' ')).join(','),
    ...rows.map((r: any) => headers.map(h => escapeCsv(r[h])).join(','))
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${reportKey}-${monthYear}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Status Badge Component ──────────────────────────────────────────
function StatusBadge({ status }: { status: { label: string; tone: 'ready' | 'stale' | 'never' } }) {
  const toneStyles = {
    ready: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    stale: 'bg-amber-50 text-amber-700 border-amber-200',
    never: 'bg-slate-100 text-slate-500 border-slate-200',
  };
  const icons = {
    ready: CheckCircle,
    stale: Clock,
    never: AlertCircle,
  };
  const Icon = icons[status.tone];
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border ${toneStyles[status.tone]}`}>
      <Icon className="h-3 w-3" />
      {status.label}
    </span>
  );
}

// ─── Format Toggle Component ─────────────────────────────────────────
function FormatToggle({ value, onChange }: { value: ExportFormat; onChange: (f: ExportFormat) => void }) {
  return (
    <div className="flex gap-0.5 bg-slate-100 rounded-md p-0.5">
      {(['csv', 'json'] as ExportFormat[]).map((fmt) => (
        <button
          key={fmt}
          onClick={(e) => { e.stopPropagation(); onChange(fmt); }}
          className={`px-2.5 py-1 text-[10px] font-medium rounded transition-colors ${
            value === fmt
              ? 'bg-white text-slate-700 shadow-sm'
              : 'text-slate-400 hover:text-slate-600'
          }`}
        >
          {fmt.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────
export default function PayrollReportsPage() {
  const { show } = useToast();
  const { user } = useAuth();
  const [monthYear, setMonthYear] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [selectedReport, setSelectedReport] = useState<typeof REPORT_TYPES[number] | null>(null);
  const [reportData, setReportData] = useState<any>(null);
  const [reportFormats, setReportFormats] = useState<Record<string, ExportFormat>>({});
  const [filters, setFilters] = useState({ department: '' });
  const [showHistory, setShowHistory] = useState(false);
  const [statuses, setStatuses] = useState<Record<string, { label: string; tone: 'ready' | 'stale' | 'never'; timestamp?: number }>>({});

  // Refresh statuses when month changes
  useEffect(() => {
    const next: Record<string, { label: string; tone: 'ready' | 'stale' | 'never'; timestamp?: number }> = {};
    REPORT_TYPES.forEach((r) => { next[r.key] = getReportStatus(r.key, monthYear); });
    setStatuses(next);
  }, [monthYear]);

  const generateMutation = useMutation({
    mutationFn: ({ type, month }: { type: string; month: string }) => {
      if (type === 'bank-reconciliation') {
        return payrollApi.getBankReconciliation(month).then(res => res.data);
      }
      if (type === 'payroll-register') {
        return payrollApi.getPayrollRegister({ month_year: month, filters }).then(res => res.data);
      }
      if (['pf', 'esi', 'pt', 'tds'].includes(type)) {
        return payrollApi.getStatutoryRegister({ month_year: month, type }).then(res => res.data);
      }
      return Promise.reject(new Error('Unknown report type'));
    },
    onSuccess: (data) => {
      setReportData(data);
      if (selectedReport) {
        const fmt = reportFormats[selectedReport.key] || 'csv';
        recordGeneration(selectedReport.key, selectedReport.label, monthYear, fmt, user?.name || 'Unknown');
        setStatuses(prev => ({ ...prev, [selectedReport.key]: getReportStatus(selectedReport.key, monthYear) }));
      }
      show({ kind: 'success', message: 'Report generated.' });
    },
    onError: (e: any) => show({ kind: 'error', message: getApiErrorMessage(e, 'Failed to generate report.') }),
  });

  const handleGenerate = (report: typeof REPORT_TYPES[number]) => {
    setSelectedReport(report);
    setReportData(null);
    generateMutation.mutate({ type: report.key, month: monthYear });
  };

  const handleExport = (reportKey: ReportKey, data: any) => {
    const fmt = reportFormats[reportKey] || 'csv';
    exportData(data, reportKey, monthYear, fmt);
    const report = REPORT_TYPES.find(r => r.key === reportKey);
    if (report) {
      recordGeneration(reportKey, report.label, monthYear, fmt, user?.name || 'Unknown');
      setStatuses(prev => ({ ...prev, [reportKey]: getReportStatus(reportKey, monthYear) }));
    }
  };

  const historyList = useMemo(() => getHistoryList(), [showHistory, statuses]);

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHeader title="Payroll Reports" description="Generate and view detailed payroll reports" />

      <div className="p-6 max-w-7xl mx-auto space-y-6">
        {/* Filters */}
        <SurfaceCard className="p-5">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <FieldLabel>Select Month</FieldLabel>
              <input
                type="month"
                value={monthYear}
                onChange={(e) => setMonthYear(e.target.value)}
                className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#5D969D]"
              />
            </div>
            <div>
              <FieldLabel>Department (Optional)</FieldLabel>
              <input
                type="text"
                value={filters.department}
                onChange={(e) => setFilters({ ...filters, department: e.target.value })}
                placeholder="Filter by department"
                className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#5D969D]"
              />
            </div>
          </div>
        </SurfaceCard>

        {/* Report Cards Grid */}
        {!showHistory && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {REPORT_TYPES.map((report) => {
              const Icon = report.icon;
              const isActive = selectedReport?.key === report.key;
              const status = statuses[report.key] || { label: 'Never generated', tone: 'never' as const };
              const format = reportFormats[report.key] || 'csv';

              return (
                <SurfaceCard
                  key={report.key}
                  className={`p-5 transition-all ${
                    isActive ? 'ring-2 ring-[#5D969D] border-[#5D969D]' : 'hover:shadow-md hover:border-[rgba(93,150,157,0.4)]'
                  }`}
                >
                  {/* Header: Icon + Status */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="h-10 w-10 rounded-lg flex items-center justify-center bg-[rgba(93,150,157,0.1)] text-[#5D969D] shrink-0">
                      <Icon className="h-5 w-5" />
                    </div>
                    <StatusBadge status={status} />
                  </div>

                  {/* Title + Description */}
                  <div className="mb-3">
                    <h3 className="font-semibold text-slate-900 text-sm">{report.label}</h3>
                    <p className="text-xs text-slate-500 mt-0.5">{report.desc}</p>
                  </div>

                  {/* Format Toggle */}
                  <div className="mb-3">
                    <FormatToggle value={format} onChange={(f) => setReportFormats(prev => ({ ...prev, [report.key]: f }))} />
                  </div>

                  {/* Generate Button */}
                  <Button
                    variant="primary"
                    size="sm"
                    className="w-full"
                    iconLeft={generateMutation.isPending && isActive ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                    onClick={() => handleGenerate(report)}
                    disabled={generateMutation.isPending}
                  >
                    {generateMutation.isPending && isActive ? 'Generating...' : 'Generate'}
                  </Button>
                </SurfaceCard>
              );
            })}
          </div>
        )}

        {/* Generation History */}
        {showHistory && (
          <SurfaceCard className="overflow-hidden">
            <div className="p-5 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">Report Generation History</h3>
              <Button variant="ghost" size="sm" onClick={() => setShowHistory(false)}>
                Back to Reports
              </Button>
            </div>
            {historyList.length === 0 ? (
              <div className="text-center py-12">
                <History className="h-10 w-10 text-slate-300 mx-auto mb-3" />
                <p className="text-sm text-slate-500">No reports generated yet.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50">
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Report</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Period</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Format</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Generated By</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">When</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {historyList.map((entry, idx) => (
                      <tr key={idx} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-medium text-slate-900">{entry.reportLabel}</td>
                        <td className="px-4 py-3 text-slate-600">{entry.period}</td>
                        <td className="px-4 py-3 text-slate-600 uppercase">{entry.format}</td>
                        <td className="px-4 py-3 text-slate-600">{entry.generatedBy}</td>
                        <td className="px-4 py-3 text-slate-500">{new Date(entry.timestamp).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SurfaceCard>
        )}

        {/* Toggle History Button */}
        {!showHistory && (
          <Button variant="ghost" size="sm" iconLeft={<History className="h-4 w-4" />} onClick={() => setShowHistory(true)}>
            View Generation History
          </Button>
        )}

        {/* Report Results */}
        {selectedReport && !showHistory && (
          <SurfaceCard className="overflow-hidden">
            <div className="p-5 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">
                {selectedReport.label} - {monthYear}
              </h3>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  iconLeft={<Download className="h-4 w-4" />}
                  onClick={() => handleExport(selectedReport.key, reportData)}
                >
                  Export {reportFormats[selectedReport.key]?.toUpperCase() || 'CSV'}
                </Button>
              </div>
            </div>
            {generateMutation.isPending ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
              </div>
            ) : reportData ? (
              <div className="p-5">
                <ReportDisplay data={reportData} />
              </div>
            ) : (
              <div className="text-center py-12">
                <AlertCircle className="h-12 w-12 text-slate-300 mx-auto mb-3" />
                <p className="text-sm text-slate-500">Click Generate to view report</p>
              </div>
            )}
          </SurfaceCard>
        )}
      </div>
    </div>
  );
}

// ─── Report Display Table ────────────────────────────────────────────
function ReportDisplay({ data }: { data: any }) {
  const records = Array.isArray(data) ? data : (data.records || data.data || []);
  if (records.length === 0) {
    return <p className="text-center text-slate-500 py-8">No records found for this report</p>;
  }
  const headers = Object.keys(records[0]);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50">
            {headers.map(h => (
              <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                {h.replace(/_/g, ' ')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {records.slice(0, 100).map((row: any, idx: number) => (
            <tr key={idx} className="hover:bg-slate-50">
              {headers.map(h => (
                <td key={h} className="px-4 py-3 text-slate-700">
                  {typeof row[h] === 'number' ? formatPayrollAmount(row[h], { showSymbol: false }) : String(row[h] ?? '-')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {records.length > 100 && (
        <p className="text-xs text-slate-500 text-center mt-3">Showing first 100 of {records.length} records. Use Export to download all.</p>
      )}
    </div>
  );
}
