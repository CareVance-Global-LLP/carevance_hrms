import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileSpreadsheet, Loader2 } from 'lucide-react';
import { payrollApi } from '@/services/api';
import Button from '@/components/ui/Button';
import SurfaceCard from '@/components/dashboard/SurfaceCard';

const REGISTER_TABS = [
  { key: 'payroll', label: 'Payroll Register' },
  { key: 'pf', label: 'PF Register' },
  { key: 'esi', label: 'ESI Register' },
  { key: 'pt', label: 'PT Register' },
  { key: 'tds', label: 'TDS Register' },
  { key: 'bank', label: 'Bank Reconciliation' },
] as const;

export default function PayrollRegisterReport() {
  const [monthYear, setMonthYear] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [activeTab, setActiveTab] = useState<string>('payroll');

  const { data: payrollRegister, isLoading: loadingPayroll } = useQuery({
    queryKey: ['payroll-register', monthYear],
    queryFn: () => payrollApi.getPayrollRegister({ month_year: monthYear }),
    enabled: activeTab === 'payroll',
  });

  const { data: statutoryRegister, isLoading: loadingStatutory } = useQuery({
    queryKey: ['statutory-register', monthYear, activeTab],
    queryFn: () => payrollApi.getStatutoryRegister({ month_year: monthYear, type: activeTab }),
    enabled: ['pf', 'esi', 'pt', 'tds'].includes(activeTab),
  });

  const { data: bankRecon, isLoading: loadingBank } = useQuery({
    queryKey: ['bank-reconciliation', monthYear],
    queryFn: () => payrollApi.getBankReconciliation(monthYear),
    enabled: activeTab === 'bank',
  });

  const registerData = payrollRegister as any;
  const statRegData = statutoryRegister as any;
  const bankData = bankRecon as any;
  const isLoading = loadingPayroll || loadingStatutory || loadingBank;

  const renderSummaryCards = (summary: any) => {
    if (!summary) return null;
    const entries = Object.entries(summary).filter(([_, v]) => typeof v === 'number');
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-6">
        {entries.map(([key, value]) => (
          <div key={key} className="p-3 bg-slate-50 rounded-lg">
            <div className="text-xs text-slate-500 uppercase tracking-wider">{key.replace(/_/g, ' ')}</div>
            <div className="text-lg font-bold text-slate-900 mt-0.5">
              ₹{Number(value).toLocaleString()}
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderTable = (columns: string[], data: any[]) => {
    if (!data || data.length === 0) {
      return (
        <div className="text-center py-12">
          <FileSpreadsheet className="h-12 w-12 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-500">No data for this period</p>
        </div>
      );
    }
    return (
      <div className="overflow-x-auto -mx-5">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              {columns.map((col) => (
                <th key={col} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">
                  {col.replace(/_/g, ' ')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.map((row: any, idx: number) => (
              <tr key={idx} className="hover:bg-slate-50 transition-colors">
                {columns.map((col) => (
                  <td key={col} className="px-4 py-3 text-slate-700 whitespace-nowrap">
                    {typeof row[col] === 'number' ? `₹${Number(row[col]).toLocaleString()}` : (row[col] ?? '-')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {REGISTER_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                activeTab === tab.key
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <input
          type="month"
          value={monthYear}
          onChange={(e) => setMonthYear(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <SurfaceCard className="p-5">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : activeTab === 'payroll' ? (
          <>
            {renderSummaryCards(registerData?.summary)}
            {renderTable(
              ['employee_name', 'basic', 'hra', 'gross_salary', 'total_deductions', 'net_pay', 'payment_status'],
              registerData?.register ?? [],
            )}
          </>
        ) : ['pf', 'esi', 'pt', 'tds'].includes(activeTab) ? (
          <>
            {renderSummaryCards(statRegData?.summary)}
            {renderTable(
              Object.keys(statRegData?.entries?.[0] ?? { employee_code: '', name: '', amount: '' }),
              statRegData?.entries ?? [],
            )}
          </>
        ) : activeTab === 'bank' ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              <div className="p-3 bg-blue-50 rounded-lg">
                <div className="text-xs text-blue-700 uppercase tracking-wider">Total Employees</div>
                <div className="text-lg font-bold text-slate-900 mt-0.5">{bankData?.total_employees ?? 0}</div>
              </div>
              <div className="p-3 bg-emerald-50 rounded-lg">
                <div className="text-xs text-emerald-700 uppercase tracking-wider">Total Payable</div>
                <div className="text-lg font-bold text-slate-900 mt-0.5">₹{Number(bankData?.total_payslip ?? 0).toLocaleString()}</div>
              </div>
              <div className="p-3 bg-indigo-50 rounded-lg">
                <div className="text-xs text-indigo-700 uppercase tracking-wider">Paid</div>
                <div className="text-lg font-bold text-slate-900 mt-0.5">₹{Number(bankData?.total_paid ?? 0).toLocaleString()}</div>
              </div>
              <div className="p-3 bg-amber-50 rounded-lg">
                <div className="text-xs text-amber-700 uppercase tracking-wider">Pending</div>
                <div className="text-lg font-bold text-slate-900 mt-0.5">₹{Number(bankData?.total_pending ?? 0).toLocaleString()}</div>
              </div>
            </div>
            {renderTable(
              ['employee_name', 'account_number', 'ifsc', 'payslip_amount', 'payment_status'],
              bankData?.entries ?? [],
            )}
          </>
        ) : null}
      </SurfaceCard>
    </div>
  );
}
