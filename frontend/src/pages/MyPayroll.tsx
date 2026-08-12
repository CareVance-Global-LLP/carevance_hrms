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
  BarChart3,
} from 'lucide-react';
import { payrollApi } from '@/services/api';
import Button from '@/components/ui/Button';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import PageHeader from '@/components/dashboard/PageHeader';
import MetricCard from '@/components/dashboard/MetricCard';
import StatusBadge from '@/components/ui/StatusBadge';
import { useToast } from '@/components/ui/Toast';
import { currentFinancialYear } from '@/lib/payroll/financialYear';

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
  tax_declaration?: {
    declared_amount: number;
    approved_amount: number;
    status: 'draft' | 'submitted' | 'approved' | 'rejected';
  };
  reimbursements?: Array<{
    id: number;
    title: string;
    amount: number;
    status: 'pending' | 'approved' | 'paid' | 'rejected';
  }>;
}

function formatCurrency(amount: number | null | undefined): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '\u20B90';
  return '\u20B9' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

function formatCurrencyShort(amount: number | null | undefined): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '\u20B90';
  if (n >= 10000000) return '\u20B9' + (n / 10000000).toFixed(1) + 'L';
  if (n >= 100000) return '\u20B9' + (n / 100000).toFixed(1) + 'L';
  if (n >= 1000) return '\u20B9' + (n / 1000).toFixed(1) + 'K';
  return '\u20B9' + n.toLocaleString('en-IN');
}

function maskPan(pan: string | undefined): string {
  if (!pan || pan.length < 8) return pan || '';
  return pan.slice(0, 5) + '\u2022\u2022\u2022\u2022' + pan.slice(-1);
}

function maskAccount(acc: string | undefined): string {
  if (!acc || acc.length < 4) return acc || '';
  return '\u2022\u2022\u2022\u2022' + acc.slice(-4);
}

function maskUan(uan: string | undefined): string {
  if (!uan || uan.length < 4) return uan || '';
  return '\u2022\u2022\u2022\u2022\u2022\u2022' + uan.slice(-4);
}

function getLatestPayslip(payslips: MyPayslip[]): MyPayslip | null {
  if (!payslips?.length) return null;
  const sorted = [...payslips].sort((a, b) => b.month_year.localeCompare(a.month_year));
  return sorted[0] || null;
}

export default function MyPayrollPage() {
  const { show } = useToast();
  const [downloading, setDownloading] = useState<string | null>(null);
  const [yearFilter, setYearFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<MyPayrollResponse>({
    queryKey: ['my-payroll', 'payslips'],
    queryFn: async () => {
      const [payslipsRes, taxDeclRes, reimbRes] = await Promise.all([
        payrollApi.getMyPayslips(),
        // The financial year, not the calendar year. This sent "2026", which
        // the server matches exactly against 'YYYY-YY' — so an employee's own
        // declaration never loaded on their own page.
        payrollApi.getMyTaxDeclaration({ financial_year: currentFinancialYear() }).catch(() => null),
        payrollApi.myReimbursements({ month_year: new Date().toISOString().slice(0, 7).replace('-', '') }).catch(() => ({ data: { reimbursements: [] } })),
      ]);
      return {
        ...payslipsRes.data,
        tax_declaration: taxDeclRes?.data?.declaration,
        reimbursements: reimbRes?.data?.reimbursements || [],
      };
    },
  });

  const payslips = data?.payslips || [];
  const ytd = data?.ytd || { gross: 0, deductions: 0, net_pay: 0, months_count: 0 };
  const employee = data?.employee;

  const availableYears = useMemo(() => {
    const years = new Set<string>();
    payslips.forEach((p) => {
      const y = (p.month_year || '').split('-')[0];
      if (y) years.add(y);
    });
    return Array.from(years).sort((a, b) => b.localeCompare(a));
  }, [payslips]);

  const filteredPayslips = useMemo(() => {
    let result = payslips;
    if (yearFilter !== 'all') {
      result = result.filter((p) => (p.month_year || '').startsWith(`${yearFilter}-`));
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter((p) => (p.month_year || '').toLowerCase().includes(q));
    }
    return result;
  }, [payslips, yearFilter, searchQuery]);

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

  const latestPayslip = getLatestPayslip(payslips);

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
        {employee && (
          <SurfaceCard className="p-5">
            <div className="flex items-center gap-5">
              <div className="h-14 w-14 rounded-full bg-amber-500 flex items-center justify-center flex-shrink-0">
                <span className="text-white font-bold text-xl">
                  {employee.name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || 'NA'}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-bold text-slate-900 truncate">{employee.name}</h2>
                <div className="text-sm text-slate-500 mt-0.5">
                  {employee.designation || 'Employee'}{employee.department ? ` \u00B7 ${employee.department}` : ''}{employee.employee_code ? ` \u00B7 ${employee.employee_code}` : ''}
                </div>
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-500 mt-2">
                  {employee.pan_number && (
                    <span className="font-mono text-xs">PAN: {maskPan(employee.pan_number)}</span>
                  )}
                  {employee.uan_number && (
                    <span className="font-mono text-xs">UAN: {maskUan(employee.uan_number)}</span>
                  )}
                  {employee.bank_account && (
                    <span className="font-mono text-xs">Bank: {maskAccount(employee.bank_account)}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button className="px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-lg text-slate-600 hover:border-blue-400 hover:text-blue-600 transition-colors">
                  Update Bank
                </button>
                <button className="px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-lg text-slate-600 hover:border-blue-400 hover:text-blue-600 transition-colors">
                  Tax Declaration
                </button>
              </div>
            </div>
          </SurfaceCard>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            label="YTD Gross"
            value={formatCurrency(ytd.gross)}
            icon={Wallet}
            accent="sky"
            // No year-on-year comparison is computed, and the figure that stood
            // here was a fixed "8% vs last year" printed against every balance
            // including \u20b90 on a joiner's first day. A count of the periods the
            // total covers is something the payload actually knows.
            hint={ytd.months_count ? `Across ${ytd.months_count} paid month${ytd.months_count === 1 ? '' : 's'}` : 'No payslips yet'}
          />
          <MetricCard
            label="YTD Deductions"
            value={formatCurrency(ytd.deductions)}
            icon={TrendingDown}
            accent="rose"
          />
          <SurfaceCard className="p-4 bg-gradient-to-br from-teal-700 to-teal-900 text-white">
            <p className="text-[11px] font-medium uppercase tracking-wider text-teal-200">
              YTD Net Pay
            </p>
            <p className="mt-2 text-2xl font-bold text-white">{formatCurrency(ytd.net_pay)}</p>
            {/* Was hardcoded to "7 months paid", which contradicted the
                "Months Paid (FY)" tile beside it on every account. */}
            <p className="mt-1 text-xs font-medium text-teal-200">
              {ytd.months_count
                ? `${ytd.months_count} month${ytd.months_count === 1 ? '' : 's'} paid`
                : 'Nothing paid yet this financial year'}
            </p>
          </SurfaceCard>
          <MetricCard
            label="Months Paid (FY)"
            value={`${ytd.months_count || 0} / 12`}
            icon={Calendar}
            accent="violet"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {latestPayslip && (
            <SurfaceCard className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                  <FileText className="h-4 w-4 text-blue-600" />
                  {latestPayslip.month_year} Payslip
                </h3>
                <StatusBadge tone={latestPayslip.payment_status === 'paid' ? 'success' : 'warning'}>
                  {latestPayslip.payment_status === 'paid' ? 'Disbursed' : 'Pending'}
                </StatusBadge>
              </div>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <div className="text-xs text-slate-400 mb-1">Gross Pay</div>
                  <div className="text-xl font-bold text-slate-900">{formatCurrency(latestPayslip.gross_salary)}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-400 mb-1">Deductions</div>
                  <div className="text-xl font-bold text-rose-600">\u2212{formatCurrency(latestPayslip.total_deductions)}</div>
                </div>
              </div>
              <div className="border-t border-slate-100 pt-3 flex items-center justify-between">
                <div>
                  <div className="text-xs text-slate-400 mb-1">Net Pay</div>
                  <div className="text-2xl font-extrabold text-emerald-700">{formatCurrency(latestPayslip.net_pay)}</div>
                </div>
                <button
                  onClick={() => latestPayslip.month_year && handleDownload(latestPayslip.month_year)}
                  disabled={!employee?.id}
                  className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-2"
                >
                  <Download className="h-4 w-4" />
                  Download PDF
                </button>
              </div>
            </SurfaceCard>
          )}

          <SurfaceCard className="p-5">
            <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-blue-600" />
              6-Month Net Pay Trend
            </h3>
            <p className="text-sm text-slate-400">Trend chart is unavailable.</p>
          </SurfaceCard>
        </div>

        <SurfaceCard className="overflow-hidden">
          <div className="p-5 border-b border-slate-200 flex items-center justify-between">
            <h3 className="font-semibold text-slate-900 flex items-center gap-2">
              <FileText className="h-4 w-4 text-blue-600" />
              All Payslips
            </h3>
            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder={"Search month\u2026"}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 max-w-[180px]"
              />
              {isFetching && !isLoading && (
                <Loader2 className="h-4 w-4 animate-spin text-slate-400" aria-label="Refreshing" />
              )}
            </div>
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
                      Gross Pay
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
                            : 'No payslips match your search'}
                        </p>
                        <p className="text-sm text-slate-500 mt-1">
                          {payslips.length === 0
                            ? "Once HR processes payroll, your payslips will show up here."
                            : 'Try a different search term.'}
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
                          <button
                            onClick={() => handleDownload(ps.month_year)}
                            disabled={downloading === ps.month_year || !employee?.id}
                            title="Download PDF"
                            aria-label={`Download payslip for ${ps.month_year}`}
                            className="px-3 py-1.5 text-xs font-medium text-blue-600 hover:text-blue-700 disabled:opacity-50 transition-colors inline-flex items-center gap-1"
                          >
                            {downloading === ps.month_year ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Download className="h-3 w-3" />
                            )}
                            PDF
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </SurfaceCard>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SurfaceCard className="p-5">
            <h3 className="font-semibold text-slate-900 mb-3">Tax Declaration</h3>
            <div className="flex justify-between items-center mb-3">
              <span className="text-sm text-slate-600">Old Regime selected</span>
              <span className="px-2 py-0.5 text-xs font-medium bg-teal-100 text-teal-700 rounded-full">Locked Oct</span>
            </div>
            {/* JSX text is not a JS string literal, so a \u escape here renders
                as the literal characters rather than the separator. */}
            <p className="text-xs text-slate-400 mb-3">{'HRA · 80C · 80D · NPS · LTA'}</p>
            <div className="h-2 bg-slate-100 rounded-full overflow-hidden mb-2">
              <div
                className="h-full bg-blue-600 rounded-full transition-all"
                style={{ width: `${Math.min(100, ((data?.tax_declaration?.declared_amount || 0) / 165000) * 100)}%` }}
              />
            </div>
            <p className="text-xs text-slate-500 mb-4">
              {formatCurrencyShort(data?.tax_declaration?.declared_amount)} declared of {formatCurrencyShort(165000)} limit
            </p>
            <div className="flex gap-2">
              <button className="px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-lg text-slate-600 hover:border-blue-400 hover:text-blue-600 transition-colors">
                View Declarations
              </button>
              <button className="px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-lg text-slate-600 hover:border-blue-400 hover:text-blue-600 transition-colors">
                Tax Simulator
              </button>
            </div>
          </SurfaceCard>

          <SurfaceCard className="p-5">
            <h3 className="font-semibold text-slate-900 mb-3">Reimbursements & Loans</h3>
            <div className="space-y-0">
              {data?.reimbursements && data.reimbursements.length > 0 ? (
                data.reimbursements.map((r) => (
                  <div key={r.id} className="flex justify-between items-center py-2 border-b border-slate-100 last:border-0">
                    <span className="text-sm text-slate-600">{r.title}</span>
                    <StatusBadge tone={r.status === 'paid' ? 'success' : r.status === 'approved' ? 'info' : 'warning'}>
                      {r.status}
                    </StatusBadge>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-500">No reimbursements or loans for this period.</p>
              )}
            </div>
            <button className="mt-4 px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-lg text-slate-600 hover:border-blue-400 hover:text-blue-600 transition-colors">
              + New Claim
            </button>
          </SurfaceCard>
        </div>
      </div>
    </div>
  );
}