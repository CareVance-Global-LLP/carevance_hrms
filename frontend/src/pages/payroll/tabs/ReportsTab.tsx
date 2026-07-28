import { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart3,
  Landmark,
  Building2,
  FileText,
  Download,
  Loader2,
  AlertCircle,
  FileSpreadsheet,
  Printer,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { hasStrictAdminAccess } from '@/lib/permissions';
import { cn } from '@/utils/cn';
import { payrollApi } from '@/services/api';
import Button from '@/components/ui/Button';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import { useToast } from '@/components/ui/Toast';

import FilingsDashboard from '@/components/payroll/FilingsDashboard';
import BankPayoutDashboard from '@/components/payroll/BankPayoutDashboard';
import ProofDocumentsCenter from '@/components/payroll/ProofDocumentsCenter';

type PanelId = 'register' | 'filings' | 'bank-payout' | 'proof-documents';
type RegisterSubTab = 'summary' | 'pf-esi' | 'tds' | 'bank-recon';

interface PanelDef {
  id: PanelId;
  label: string;
  icon: typeof BarChart3;
}

const PANELS: PanelDef[] = [
  { id: 'register', label: 'Payroll Register', icon: BarChart3 },
  { id: 'filings', label: 'Filings', icon: Landmark },
  { id: 'bank-payout', label: 'Bank Payout', icon: Building2 },
  { id: 'proof-documents', label: 'Proof Documents', icon: FileText },
];

const REGISTER_SUB_TABS: { key: RegisterSubTab; label: string }[] = [
  { key: 'summary', label: 'Summary' },
  { key: 'pf-esi', label: 'PF/ESI' },
  { key: 'tds', label: 'TDS' },
  { key: 'bank-recon', label: 'Bank Recon' },
];

const SUMMARY_COLUMNS = [
  { key: 'employee_name', label: 'Employee' },
  { key: 'department', label: 'Dept' },
  { key: 'gross_salary', label: 'Gross' },
  { key: 'pf_employee', label: 'PF (Emp)' },
  { key: 'pf_employer', label: 'PF (Er)' },
  { key: 'tds', label: 'TDS' },
  { key: 'pt', label: 'PT' },
  { key: 'other_deductions', label: 'Other Ded.' },
  { key: 'net_pay', label: 'Net Pay' },
];

const PF_ESI_COLUMNS = [
  { key: 'employee_name', label: 'Employee' },
  { key: 'department', label: 'Dept' },
  { key: 'pf_wages', label: 'PF Wages' },
  { key: 'pf_employee', label: 'PF (Emp)' },
  { key: 'pf_employer', label: 'PF (Er)' },
  { key: 'esi_wages', label: 'ESI Wages' },
  { key: 'esi_employee', label: 'ESI (Emp)' },
  { key: 'esi_employer', label: 'ESI (Er)' },
  { key: 'total_contribution', label: 'Total' },
];

const TDS_COLUMNS = [
  { key: 'employee_name', label: 'Employee' },
  { key: 'department', label: 'Dept' },
  { key: 'gross_salary', label: 'Gross' },
  { key: 'tds', label: 'TDS' },
  { key: 'pt', label: 'PT' },
  { key: 'net_pay', label: 'Net Pay' },
];

const BANK_RECON_COLUMNS = [
  { key: 'employee_name', label: 'Employee' },
  { key: 'account_number', label: 'Account No.' },
  { key: 'ifsc', label: 'IFSC' },
  { key: 'bank_name', label: 'Bank' },
  { key: 'net_pay', label: 'Amount' },
  { key: 'payment_status', label: 'Status' },
];

export default function ReportsTab() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isStrictAdmin = hasStrictAdminAccess(user);

  const handleBackToPayroll = () => navigate('/payroll');

  const requested = searchParams.get('panel') as PanelId | null;
  const active: PanelId =
    requested && PANELS.some((p) => p.id === requested) ? requested : 'register';

  const selectPanel = (id: PanelId) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('panel', id);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {PANELS.map((p) => {
          const isActive = p.id === active;
          const Icon = p.icon;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => selectPanel(p.id)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                isActive
                  ? 'border-[#5D969D] bg-[rgba(93,150,157,0.1)] text-[#5D969D]'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {p.label}
            </button>
          );
        })}
      </div>

      <div>
        {active === 'register' && <PayrollRegisterPanel />}
        {active === 'filings' && isStrictAdmin &&           <FilingsDashboard onBack={handleBackToPayroll} />}
        {active === 'filings' && !isStrictAdmin && <div className="text-center py-16 text-slate-500 text-sm">Admin access required for Statutory Filings.</div>}
        {active === 'bank-payout' && isStrictAdmin && <BankPayoutDashboard />}
        {active === 'bank-payout' && !isStrictAdmin && <div className="text-center py-16 text-slate-500 text-sm">Admin access required for Bank Payout.</div>}
        {active === 'proof-documents' && isStrictAdmin && <ProofDocumentsCenter />}
        {active === 'proof-documents' && !isStrictAdmin && <div className="text-center py-16 text-slate-500 text-sm">Admin access required for Proof Documents.</div>}
      </div>
    </div>
  );
}

function formatCurrency(value: number | string | null | undefined): string {
  const num = Number(value ?? 0);
  if (!isFinite(num)) return '₹0';
  return `₹${num.toLocaleString('en-IN')}`;
}

function PayrollRegisterPanel() {
  const { show } = useToast();
  const [monthYear, setMonthYear] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [activeSubTab, setActiveSubTab] = useState<RegisterSubTab>('summary');

  const { data: payrollRegister, isLoading: loadingPayroll } = useQuery({
    queryKey: ['payroll-register', monthYear],
    queryFn: () => payrollApi.getPayrollRegister({ month_year: monthYear }).then(r => r.data),
    enabled: activeSubTab === 'summary',
  });

  const { data: statutoryRegister, isLoading: loadingStatutory } = useQuery({
    queryKey: ['statutory-register', monthYear, activeSubTab],
    queryFn: () =>
      payrollApi.getStatutoryRegister({
        month_year: monthYear,
        type: activeSubTab === 'pf-esi' ? 'pf' : activeSubTab,
      }).then(r => r.data),
    enabled: activeSubTab === 'pf-esi' || activeSubTab === 'tds',
  });

  const { data: bankRecon, isLoading: loadingBank } = useQuery({
    queryKey: ['bank-reconciliation', monthYear],
    queryFn: () => payrollApi.getBankReconciliation(monthYear).then(r => r.data),
    enabled: activeSubTab === 'bank-recon',
  });

  const batchList: any[] = [];

  const registerData = payrollRegister as any;
  const statRegData = statutoryRegister as any;
  const bankData = bankRecon as any;
  const isLoading = loadingPayroll || loadingStatutory || loadingBank;

  const getRows = (): any[] => {
    if (activeSubTab === 'summary') return registerData?.register ?? registerData?.data?.register ?? [];
    if (activeSubTab === 'pf-esi' || activeSubTab === 'tds') return statRegData?.entries ?? statRegData?.data?.entries ?? [];
    if (activeSubTab === 'bank-recon') return bankData?.entries ?? bankData?.data?.entries ?? [];
    return [];
  };

  const getColumns = (): { key: string; label: string }[] => {
    if (activeSubTab === 'summary') return SUMMARY_COLUMNS;
    if (activeSubTab === 'pf-esi') return PF_ESI_COLUMNS;
    if (activeSubTab === 'tds') return TDS_COLUMNS;
    if (activeSubTab === 'bank-recon') return BANK_RECON_COLUMNS;
    return SUMMARY_COLUMNS;
  };

  const rows = getRows();
  const columns = getColumns();

  const totalRow = rows.reduce(
    (acc: Record<string, number>, row: any) => {
      columns.forEach(({ key }) => {
        if (key === 'employee_name' || key === 'department' || key === 'account_number' || key === 'ifsc' || key === 'bank_name' || key === 'payment_status') return;
        acc[key] = (acc[key] ?? 0) + Number(row[key] ?? 0);
      });
      return acc;
    },
    {} as Record<string, number>,
  );

  const handleExportCsv = () => {
    if (rows.length === 0) return;
    const headers = columns.map((c) => c.label);
    const csvRows = rows.map((row: any) =>
      columns.map((c) => {
        const val = row[c.key];
        if (val === null || val === undefined) return '';
        const str = String(val);
        return str.includes(',') || str.includes('"') ? `"${str.replace(/"/g, '""')}"` : str;
      }),
    );
    const csv = [headers.join(','), ...csvRows.map((r) => r.join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payroll-register-${monthYear}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportPdf = () => {
    show({ kind: 'info', message: 'PDF export will be available soon.' });
  };

  const totalEmployees = rows.length;
  const totalNetPay = Number(totalRow.net_pay ?? 0);
  const pendingBatch = batchList.find((b: any) => b.status === 'pending' || b.status === 'processing');

  const bankBreakdown = batchList.reduce(
    (acc: Record<string, { count: number; amount: number }>, batch: any) => {
      const bank = batch.bank_name || 'Other';
      if (!acc[bank]) acc[bank] = { count: 0, amount: 0 };
      acc[bank].count += batch.employee_count ?? 0;
      acc[bank].amount += Number(batch.total_amount ?? 0);
      return acc;
    },
    {} as Record<string, { count: number; amount: number }>,
  );

  const bankEntries = Object.entries(bankBreakdown);
  if (bankEntries.length === 0 && batchList.length > 0) {
    bankEntries.push(['HDFC', { count: 0, amount: 0 }]);
    bankEntries.push(['SBI', { count: 0, amount: 0 }]);
    bankEntries.push(['Other', { count: 0, amount: 0 }]);
  }

  return (
    <div className="space-y-6">
      <SurfaceCard className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex gap-1">
            {REGISTER_SUB_TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveSubTab(tab.key)}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium rounded-full transition-colors',
                  activeSubTab === tab.key
                    ? 'bg-[rgba(93,150,157,0.1)] text-[#5D969D]'
                    : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50',
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="month"
              value={monthYear}
              onChange={(e) => setMonthYear(e.target.value)}
              className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#5D969D]"
            />
            <Button
              variant="secondary"
              size="sm"
              iconLeft={<Download className="h-3.5 w-3.5" />}
              onClick={handleExportCsv}
            >
              CSV
            </Button>
            <Button
              variant="secondary"
              size="sm"
              iconLeft={<Printer className="h-3.5 w-3.5" />}
              onClick={handleExportPdf}
            >
              PDF
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-12">
            <FileSpreadsheet className="h-12 w-12 text-slate-300 mx-auto mb-3" />
            <p className="text-sm text-slate-500">No data for this period</p>
          </div>
        ) : (
          <div className="overflow-x-auto -mx-5">
            <table className="w-full text-sm" style={{ minWidth: '800px' }}>
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  {columns.map((col) => (
                    <th
                      key={col.key}
                      className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap"
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row: any, idx: number) => (
                  <tr key={row.employee_id ?? row.id ?? idx} className="hover:bg-slate-50 transition-colors">
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={cn(
                          'px-4 py-3 whitespace-nowrap',
                          col.key === 'employee_name' || col.key === 'net_pay'
                            ? 'font-medium text-slate-900'
                            : 'text-slate-700',
                        )}
                      >
                        {typeof row[col.key] === 'number'
                          ? formatCurrency(row[col.key])
                          : (row[col.key] ?? '-')}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr className="bg-slate-50 font-bold border-t-2 border-slate-200">
                  {columns.map((col, idx) => (
                    <td key={col.key} className="px-4 py-3 whitespace-nowrap text-slate-900">
                      {idx === 0
                        ? `Total (${rows.length} employees)`
                        : typeof totalRow[col.key] === 'number'
                          ? formatCurrency(totalRow[col.key])
                          : ''}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </SurfaceCard>

      {activeSubTab === 'summary' && (
        <SurfaceCard className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-slate-900">Bank Payout</h3>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" iconLeft={<Download className="h-3.5 w-3.5" />}>
                Bank File
              </Button>
              <Button variant="primary" size="sm" className="bg-amber-500 hover:bg-amber-600 text-white">
                Disburse
              </Button>
            </div>
          </div>

          {pendingBatch && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 text-blue-800 text-xs mb-4">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>
                {totalEmployees} employees · {formatCurrency(totalNetPay)} total ·{' '}
                {pendingBatch.bank_name ?? 'Bank'} batch pending approval
              </span>
            </div>
          )}

          {bankEntries.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {bankEntries.map(([bank, info]: [string, { count: number; amount: number }]) => (
                <div
                  key={bank}
                  className="p-3 border border-slate-200 rounded-lg"
                >
                  <div className="text-xs text-slate-500">{bank} employees</div>
                  <div className="text-sm font-bold text-slate-900 mt-1">
                    {info.count} · {formatCurrency(info.amount)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-6 text-xs text-slate-400">
              No bank batches found for this period
            </div>
          )}
        </SurfaceCard>
      )}
    </div>
  );
}
