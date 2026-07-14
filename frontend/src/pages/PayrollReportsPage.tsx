import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { FileSpreadsheet, Download, Loader2, Building2, Users, IndianRupee, CheckCircle, AlertCircle } from 'lucide-react';
import { payrollApi, getApiErrorMessage } from '@/services/api';
import Button from '@/components/ui/Button';
import { FieldLabel } from '@/components/ui/FormField';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import PageHeader from '@/components/dashboard/PageHeader';
import { formatPayrollAmount } from '@/components/ui/PayrollAmount';
import { useToast } from '@/components/ui/Toast';

const REPORT_TYPES = [
  { key: 'payroll-register', label: 'Payroll Register', desc: 'Complete payroll register for the month', icon: FileSpreadsheet },
  { key: 'pf', label: 'PF Register', desc: 'PF contributions for the month', icon: Building2 },
  { key: 'esi', label: 'ESI Register', desc: 'ESI contributions for the month', icon: Users },
  { key: 'pt', label: 'PT Register', desc: 'Professional Tax deductions', icon: IndianRupee },
  { key: 'tds', label: 'TDS Register', desc: 'Tax deducted at source', icon: IndianRupee },
  { key: 'bank-reconciliation', label: 'Bank Reconciliation', desc: 'Bank transfer reconciliation', icon: CheckCircle },
];

export default function PayrollReportsPage() {
  const { show } = useToast();
  const [monthYear, setMonthYear] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [selectedReport, setSelectedReport] = useState<typeof REPORT_TYPES[number] | null>(null);
  const [reportData, setReportData] = useState<any>(null);
  const [filters, setFilters] = useState({
    department: '',
    employee: '',
  });

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
      show({ kind: 'success', message: 'Report generated.' });
    },
    onError: (e: any) => show({ kind: 'error', message: getApiErrorMessage(e, 'Failed to generate report.') }),
  });

  const handleGenerate = (type: typeof REPORT_TYPES[number]) => {
    setSelectedReport(type);
    setReportData(null);
    generateMutation.mutate({ type: type.key, month: monthYear });
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHeader title="Payroll Reports" description="Generate and view detailed payroll reports" />

      <div className="p-6 max-w-7xl mx-auto space-y-6">
        {/* Month Selector */}
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

        {/* Report Types */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {REPORT_TYPES.map((report) => {
            const Icon = report.icon;
            const isActive = selectedReport?.key === report.key;
            return (
              <SurfaceCard
                key={report.key}
                className={`p-5 cursor-pointer transition-all ${
                  isActive ? 'ring-2 ring-[#5D969D] border-[#5D969D]' : 'hover:shadow-md hover:border-[rgba(93,150,157,0.4)]'
                }`}
                onClick={() => handleGenerate(report)}
              >
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 rounded-lg flex items-center justify-center bg-[rgba(93,150,157,0.1)] text-[#5D969D] shrink-0">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-slate-900 text-sm">{report.label}</h3>
                    <p className="text-xs text-slate-500 mt-1">{report.desc}</p>
                  </div>
                </div>
                <div className="mt-3">
                  <Button
                    variant="primary"
                    size="sm"
                    className="w-full"
                    iconLeft={generateMutation.isPending && isActive ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                    onClick={(e) => { e.stopPropagation(); handleGenerate(report); }}
                    disabled={generateMutation.isPending}
                  >
                    {generateMutation.isPending && isActive ? 'Generating...' : 'Generate'}
                  </Button>
                </div>
              </SurfaceCard>
            );
          })}
        </div>

        {/* Report Results */}
        {selectedReport && (
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
                  onClick={() => {
                    const data = JSON.stringify(reportData, null, 2);
                    const blob = new Blob([data], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${selectedReport.key}-${monthYear}.json`;
                    a.click();
                  }}
                >
                  Export JSON
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  iconLeft={<Download className="h-4 w-4" />}
                  onClick={() => {
                    if (!reportData) return;
                    const rows = Array.isArray(reportData) ? reportData : (reportData.records || reportData.data || []);
                    if (rows.length === 0) return;
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
                    const csv = bom + [headers.map(h => h.replace(/_/g, ' ')).join(','), ...rows.map((r: any) => headers.map(h => escapeCsv(r[h])).join(','))].join('\n');
                    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${selectedReport.key}-${monthYear}.csv`;
                    a.click();
                  }}
                >
                  Export CSV
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
