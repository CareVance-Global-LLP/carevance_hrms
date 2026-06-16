import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  FileText,
  Download,
  Calendar,
  DollarSign,
  TrendingDown,
  User,
  Building2,
  CreditCard,
  CheckCircle2,
  Loader2,
  Wallet,
  Hash,
  FileDown,
  AlertCircle,
} from 'lucide-react';
import { payrollApi } from '@/services/api';
import Button from '@/components/ui/Button';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import PageHeader from '@/components/dashboard/PageHeader';
import MetricCard from '@/components/dashboard/MetricCard';
import StatusBadge from '@/components/ui/StatusBadge';
import { useToast } from '@/components/ui/Toast';

// Minimal row shape returned by the My Payroll endpoint.
// Kept local because this contract isn't shared with the rest of the app.
interface MyPayslip {
  id?: number;
  month_year: string;
  gross_salary: number | null;
  total_deductions: number | null;
  net_pay: number | null;
  payment_status?: 'paid' | 'pending' | 'processing' | 'failed' | string;
}

interface MyPayrollResponse {
  payslips: MyPayslip[];
  ytd: { gross: number; deductions: number; net_pay: number; months_count: number };
  employee?: {
    id: number;
    name: string;
    employee_code?: string;
    designation?: string;
    department?: string;
    pan_number?: string;
    uan_number?: string;
    bank_account?: string;
  } | null;
}

// --- Money helper -----------------------------------------------------------
// Defensive: handles null/undefined/NaN — payslips can come back with missing
// fields when the backend skipped a calculation.
function formatCurrency(amount: number | null | undefined): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return 'Rs 0.00';
  return 'Rs ' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// --- MyPayroll ---------------------------------------------------------------
export default function MyPayrollPage() {
  const { show } = useToast();
  const [downloading, setDownloading] = useState<string | null>(null);
  const [yearFilter, setYearFilter] = useState<string>('all');

  // Fetch the data
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<MyPayrollResponse>({
    queryKey: ['my-payroll', 'payslips'],
    queryFn: () => payrollApi.getMyPayslips().then((res) => res.data),
  });

  const payslips = data?.payslips || [];
  const ytd = data?.ytd || { gross: 0, deductions: 0, net_pay: 0, months_count: 0 };
  const employee = data?.employee;

  // Year filter (e.g. "2025") — pull available years from the data
  const availableYears = useMemo(() => {
    const years = new Set<string>();
    payslips.forEach((p) => {
      const y = (p.month_year || '').split('-')[0];
      if (y) years.add(y);
    });
    return Array.from(years).sort((a, b) => b.localeCompare(a));
  }, [payslips]);

  const filteredPayslips = useMemo(() => {
    if (yearFilter === 'all') return payslips;
    return payslips.filter((p) => (p.month_year || '').startsWith(`${yearFilter}-`));
  }, [payslips, yearFilter]);

  // PDF download — robust against non-PDF (JSON error) responses
  const handleDownload = async (monthYear: string) => {
    if (!employee?.id) {
      show({ kind: 'error', message: 'Cannot download — your employee profile is not loaded yet.' });
      return;
    }

    setDownloading(monthYear);
    try {
      const res = await payrollApi.downloadPayslipPdf(employee.id, monthYear, {
        responseType: 'blob',
      });
      const blob = new Blob([res.data], { type: 'application/pdf' });
      // Sanity check: a valid PDF always starts with "%PDF"
      const isValid = blob.size > 200 && blob.type === 'application/pdf';
      if (!isValid) {
        throw new Error('Server did not return a PDF');
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `payslip_${monthYear}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      show({ kind: 'success', message: `Payslip for ${monthYear} downloaded.` });
    } catch (e) {
      console.error('Download failed:', e);
      show({ kind: 'error', message: 'Failed to download payslip. Please try again.' });
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHeader
        title="My Payroll"
        description="View your payslips and year-to-date earnings"
        actions={
          availableYears.length > 1 ? (
            <select
              value={yearFilter}
              onChange={(e) => setYearFilter(e.target.value)}
              className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-label="Filter by year"
            >
              <option value="all">All years</option>
              {availableYears.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          ) : null
        }
      />

      <div className="p-6 space-y-6">
        {/* Employee Info */}
        {employee && (
          <SurfaceCard className="p-5">
            <div className="flex items-start gap-4">
              <div className="h-14 w-14 rounded-full bg-blue-100 flex items-center justify-center">
                <User className="h-7 w-7 text-blue-600" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-xl font-bold text-slate-900 truncate">{employee.name}</h2>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-500 mt-1">
                  {employee.employee_code && <span>Code: {employee.employee_code}</span>}
                  {employee.designation && <span>{employee.designation}</span>}
                  {employee.department && <span>{employee.department}</span>}
                </div>
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-500 mt-2">
                  {employee.pan_number && (
                    <span className="flex items-center gap-1">
                      <Building2 className="h-3 w-3" /> PAN: {employee.pan_number}
                    </span>
                  )}
                  {employee.uan_number && (
                    <span className="flex items-center gap-1">
                      <Hash className="h-3 w-3" /> UAN: {employee.uan_number}
                    </span>
                  )}
                  {employee.bank_account && (
                    <span className="flex items-center gap-1">
                      <CreditCard className="h-3 w-3" /> A/c: {employee.bank_account}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </SurfaceCard>
        )}

        {/* YTD Summary */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            label="YTD Gross"
            value={formatCurrency(ytd.gross)}
            icon={Wallet}
            accent="sky"
          />
          <MetricCard
            label="YTD Deductions"
            value={formatCurrency(ytd.deductions)}
            icon={TrendingDown}
            accent="rose"
          />
          <MetricCard
            label="YTD Net Pay"
            value={formatCurrency(ytd.net_pay)}
            icon={DollarSign}
            accent="emerald"
          />
          <MetricCard
            label="Months Paid"
            value={String(ytd.months_count || 0)}
            icon={Calendar}
            accent="violet"
          />
        </div>

        {/* Payslips List */}
        <SurfaceCard className="overflow-hidden">
          <div className="p-5 border-b border-slate-200 flex items-center justify-between">
            <h3 className="font-semibold text-slate-900 flex items-center gap-2">
              <FileText className="h-4 w-4 text-blue-600" />
              Your Payslips
              {!isLoading && (
                <span className="text-xs font-normal text-slate-500">
                  ({filteredPayslips.length}
                  {yearFilter !== 'all' ? ` of ${payslips.length}` : ''})
                </span>
              )}
            </h3>
            {isFetching && !isLoading && (
              <Loader2 className="h-4 w-4 animate-spin text-slate-400" aria-label="Refreshing" />
            )}
          </div>

          {isError ? (
            <div className="p-8 text-center">
              <AlertCircle className="h-10 w-10 mx-auto mb-3 text-rose-400" />
              <p className="font-medium text-slate-900">Couldn't load your payslips</p>
              <p className="text-sm text-slate-500 mt-1">
                {(error as Error)?.message || 'Something went wrong. Please try again.'}
              </p>
              <Button
                variant="secondary"
                size="sm"
                className="mt-4"
                onClick={() => refetch()}
                iconLeft={<Loader2 className="h-3 w-3" />}
              >
                Retry
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">
                      Month
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase">
                      Gross
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase">
                      Deductions
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase">
                      Net Pay
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase">
                      Status
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {isLoading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <tr key={i}>
                        {Array.from({ length: 6 }).map((__, j) => (
                          <td key={j} className="px-4 py-4">
                            <div className="h-4 bg-slate-100 rounded animate-pulse" />
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : filteredPayslips.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center">
                        <FileDown className="h-10 w-10 mx-auto mb-3 text-slate-300" />
                        <p className="font-medium text-slate-900">
                          {payslips.length === 0
                            ? 'No payslips yet'
                            : `No payslips for ${yearFilter}`}
                        </p>
                        <p className="text-sm text-slate-500 mt-1">
                          {payslips.length === 0
                            ? "Once HR processes payroll, your payslips will show up here."
                            : 'Try a different year filter.'}
                        </p>
                      </td>
                    </tr>
                  ) : (
                    filteredPayslips.map((ps) => (
                      <tr key={ps.id || ps.month_year} className="hover:bg-slate-50">
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-2">
                            <Calendar className="h-4 w-4 text-slate-400" />
                            <span className="font-medium text-slate-900">{ps.month_year}</span>
                          </div>
                        </td>
                        <td className="px-4 py-4 text-right text-sm text-slate-700">
                          {formatCurrency(ps.gross_salary)}
                        </td>
                        <td className="px-4 py-4 text-right text-sm text-rose-600">
                          {formatCurrency(ps.total_deductions)}
                        </td>
                        <td className="px-4 py-4 text-right text-sm font-semibold text-emerald-700">
                          {formatCurrency(ps.net_pay)}
                        </td>
                        <td className="px-4 py-4 text-center">
                          {ps.payment_status === 'paid' ? (
                            <StatusBadge tone="success">
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              Paid
                            </StatusBadge>
                          ) : (
                            <StatusBadge tone="warning">Pending</StatusBadge>
                          )}
                        </td>
                        <td className="px-4 py-4 text-center">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDownload(ps.month_year)}
                            disabled={downloading === ps.month_year || !employee?.id}
                            title="Download PDF"
                            aria-label={`Download payslip for ${ps.month_year}`}
                          >
                            {downloading === ps.month_year ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Download className="h-3 w-3" />
                            )}
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </SurfaceCard>
      </div>
    </div>
  );
}
