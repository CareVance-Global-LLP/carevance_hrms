import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { 
  FileText, Download, Calendar, DollarSign, TrendingUp, 
  TrendingDown, User, Building2, MapPin, CreditCard, 
  CheckCircle2, Loader2, Wallet, Eye
} from 'lucide-react';
import { payrollApi } from '@/services/api';
import Button from '@/components/ui/Button';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import PageHeader from '@/components/dashboard/PageHeader';

function formatCurrency(amount: number): string {
  return 'Rs ' + amount.toLocaleString('en-IN', { minimumFractionDigits: 2 });
}

export default function MyPayrollPage() {
  const [selectedPayslip, setSelectedPayslip] = useState<any>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['my-payroll', 'payslips'],
    queryFn: () => payrollApi.getMyPayslips().then(res => res.data),
  });

  const payslips = data?.payslips || [];
  const ytd = data?.ytd || { gross: 0, deductions: 0, net_pay: 0, months_count: 0 };
  const employee = data?.employee;

  const handleDownload = async (monthYear: string) => {
    setDownloading(monthYear);
    try {
      const res = await payrollApi.downloadPayslipPdf(employee?.id || 0, monthYear, { responseType: 'blob' });
      const blob = new Blob([res.data], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `payslip_${monthYear}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Download failed:', e);
      alert('Failed to download payslip. Please try again.');
    }
    setDownloading(null);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHeader title="My Payroll" description="View your payslips and year-to-date earnings" />

      <div className="p-6 space-y-6">
        {/* Employee Info */}
        {employee && (
          <SurfaceCard className="p-5">
            <div className="flex items-start gap-4">
              <div className="h-14 w-14 rounded-full bg-blue-100 flex items-center justify-center">
                <User className="h-7 w-7 text-blue-600" />
              </div>
              <div className="flex-1">
                <h2 className="text-xl font-bold text-slate-900">{employee.name}</h2>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-500 mt-1">
                  {employee.employee_code && <span>Code: {employee.employee_code}</span>}
                  {employee.designation && <span>{employee.designation}</span>}
                  {employee.department && <span>{employee.department}</span>}
                </div>
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-500 mt-2">
                  {employee.pan_number && <span className="flex items-center gap-1"><Building2 className="h-3 w-3" />PAN: {employee.pan_number}</span>}
                  {employee.uan_number && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />UAN: {employee.uan_number}</span>}
                  {employee.bank_account && <span className="flex items-center gap-1"><CreditCard className="h-3 w-3" />A/c: {employee.bank_account}</span>}
                </div>
              </div>
            </div>
          </SurfaceCard>
        )}

        {/* YTD Summary */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <SurfaceCard className="p-5">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-50 rounded-lg"><Wallet className="h-5 w-5 text-blue-600" /></div>
              <div>
                <p className="text-xs text-slate-500">YTD Gross</p>
                <p className="text-lg font-bold text-slate-900">{formatCurrency(ytd.gross)}</p>
              </div>
            </div>
          </SurfaceCard>
          <SurfaceCard className="p-5">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-rose-50 rounded-lg"><TrendingDown className="h-5 w-5 text-rose-600" /></div>
              <div>
                <p className="text-xs text-slate-500">YTD Deductions</p>
                <p className="text-lg font-bold text-rose-700">{formatCurrency(ytd.deductions)}</p>
              </div>
            </div>
          </SurfaceCard>
          <SurfaceCard className="p-5">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-emerald-50 rounded-lg"><DollarSign className="h-5 w-5 text-emerald-600" /></div>
              <div>
                <p className="text-xs text-slate-500">YTD Net Pay</p>
                <p className="text-lg font-bold text-emerald-700">{formatCurrency(ytd.net_pay)}</p>
              </div>
            </div>
          </SurfaceCard>
          <SurfaceCard className="p-5">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-violet-50 rounded-lg"><Calendar className="h-5 w-5 text-violet-600" /></div>
              <div>
                <p className="text-xs text-slate-500">Months Paid</p>
                <p className="text-lg font-bold text-slate-900">{ytd.months_count}</p>
              </div>
            </div>
          </SurfaceCard>
        </div>

        {/* Payslips List */}
        <SurfaceCard className="overflow-hidden">
          <div className="p-5 border-b border-slate-200">
            <h3 className="font-semibold text-slate-900 flex items-center gap-2">
              <FileText className="h-4 w-4 text-blue-600" />
              Your Payslips
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Month</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase">Gross</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase">Deductions</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase">Net Pay</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase">Status</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {isLoading ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">Loading...</td></tr>
                ) : payslips.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">No payslips found yet.</td></tr>
                ) : (
                  payslips.map((ps: any) => (
                    <tr key={ps.id || ps.month_year} className="hover:bg-slate-50">
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                          <Calendar className="h-4 w-4 text-slate-400" />
                          <span className="font-medium text-slate-900">{ps.month_year}</span>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-right text-sm text-slate-700">{formatCurrency(ps.gross_salary)}</td>
                      <td className="px-4 py-4 text-right text-sm text-rose-600">{formatCurrency(ps.total_deductions)}</td>
                      <td className="px-4 py-4 text-right text-sm font-semibold text-emerald-700">{formatCurrency(ps.net_pay)}</td>
                      <td className="px-4 py-4 text-center">
                        {ps.payment_status === 'paid' ? (
                          <span className="inline-flex items-center gap-1 text-xs text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full">
                            <CheckCircle2 className="h-3 w-3" />Paid
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded-full">
                            Pending
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-4 text-center">
                        <Button
                          variant="ghost" size="sm"
                          onClick={() => handleDownload(ps.month_year)}
                          disabled={downloading === ps.month_year}
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
        </SurfaceCard>
      </div>
    </div>
  );
}
