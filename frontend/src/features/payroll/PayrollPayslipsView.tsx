import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/components/dashboard/PageHeader';
import MetricCard from '@/components/dashboard/MetricCard';
import FilterPanel from '@/components/dashboard/FilterPanel';
import EmptyStateCard from '@/components/dashboard/EmptyStateCard';
import Button from '@/components/ui/Button';
import EmployeeSelect from '@/components/ui/EmployeeSelect';
import { FieldLabel, TextInput } from '@/components/ui/FormField';
import { FeedbackBanner, PageErrorState, PageLoadingState } from '@/components/ui/PageState';
import { payrollApi } from '@/services/api';
import type { Payslip } from '@/types';
import { Download, FileText, Receipt, Wallet } from 'lucide-react';
import PayrollSectionCard from '@/features/payroll/components/PayrollSectionCard';
import PayrollStatusBadge from '@/features/payroll/components/PayrollStatusBadge';
import { defaultPayrollMonth, formatPayrollCurrency, formatPayrollMonth } from '@/features/payroll/utils';
import { coercePositiveNumber, readSessionStorageJson, writeSessionStorageJson } from '@/lib/filterPersistence';
import { hasAdminAccess } from '@/lib/permissions';

type PersistedPayrollPayslipFilters = {
  selectedUserId: number | '';
  periodMonth: string;
};

const PAYROLL_PAYSLIP_FILTER_STORAGE_KEY = 'payroll-payslips-filters';

const readPersistedPayrollPayslipFilters = (fallbackUserId: number | ''): PersistedPayrollPayslipFilters => {
  const parsed = readSessionStorageJson<PersistedPayrollPayslipFilters>(PAYROLL_PAYSLIP_FILTER_STORAGE_KEY);
  const canRestoreSelection = fallbackUserId === '';

  if (!parsed) {
    return {
      selectedUserId: fallbackUserId,
      periodMonth: defaultPayrollMonth(),
    };
  }

  return {
    selectedUserId:
      canRestoreSelection && coercePositiveNumber(parsed.selectedUserId)
        ? coercePositiveNumber(parsed.selectedUserId)!
        : fallbackUserId,
    periodMonth: typeof parsed.periodMonth === 'string' && parsed.periodMonth ? parsed.periodMonth : defaultPayrollMonth(),
  };
};

export default function PayrollPayslipsView() {
  const { user } = useAuth();
  const canManage = hasAdminAccess(user);
  const defaultSelectedUserId = canManage ? '' : Number(user?.id || 0);
  const [employees, setEmployees] = useState<Array<{ id: number; name: string; email: string; role: string }>>([]);
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [selectedPayslipId, setSelectedPayslipId] = useState<number | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<number | ''>(() => readPersistedPayrollPayslipFilters(defaultSelectedUserId).selectedUserId);
  const [periodMonth, setPeriodMonth] = useState(() => readPersistedPayrollPayslipFilters(defaultSelectedUserId).periodMonth);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const persisted = readPersistedPayrollPayslipFilters(defaultSelectedUserId);
    setSelectedUserId(persisted.selectedUserId);
    setPeriodMonth(persisted.periodMonth);
  }, [defaultSelectedUserId]);

  useEffect(() => {
    writeSessionStorageJson(PAYROLL_PAYSLIP_FILTER_STORAGE_KEY, {
      selectedUserId,
      periodMonth,
    } satisfies PersistedPayrollPayslipFilters);
  }, [periodMonth, selectedUserId]);

  const selectedPayslip = useMemo(
    () => payslips.find((item) => item.id === selectedPayslipId) || payslips[0] || null,
    [payslips, selectedPayslipId]
  );

  useEffect(() => {
    if (!selectedPayslipId && payslips.length > 0) {
      setSelectedPayslipId(payslips[0].id);
    }
  }, [payslips, selectedPayslipId]);

  const load = async () => {
    setIsLoading(true);
    try {
      if (canManage) {
        const employeesResponse = await payrollApi.getEmployees();
        setEmployees(employeesResponse.data.data || []);
      }

      const payslipsResponse = await payrollApi.getPayslips({
        user_id: selectedUserId || undefined,
        period_month: periodMonth || undefined,
      });
      setPayslips(payslipsResponse.data.data || []);
    } catch (error: any) {
      setFeedback({ tone: 'error', message: error?.response?.data?.message || 'Failed to load payslips.' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [selectedUserId, periodMonth]);

  const generatePayslip = async () => {
    if (!selectedUserId) return;
    setFeedback(null);
    try {
      const response = await payrollApi.generatePayslip({ user_id: Number(selectedUserId), period_month: periodMonth });
      setFeedback({ tone: 'success', message: `Payslip generated for ${response.data.user?.name || 'employee'}.` });
      await load();
    } catch (error: any) {
      setFeedback({ tone: 'error', message: error?.response?.data?.message || 'Failed to generate payslip.' });
    }
  };

  const markPaid = async () => {
    if (!selectedPayslip) return;
    setFeedback(null);
    try {
      const response = await payrollApi.payNow({ payslip_ids: [selectedPayslip.id] });
      setFeedback({ tone: 'success', message: response.data.message || 'Payslip marked paid.' });
      await load();
    } catch (error: any) {
      setFeedback({ tone: 'error', message: error?.response?.data?.message || 'Failed to update payslip payment status.' });
    }
  };

  const downloadPayslip = async (payslipId: number) => {
    try {
      const response = await payrollApi.downloadPayslipPdf(payslipId);
      const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `payslip-${payslipId}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error: any) {
      setFeedback({ tone: 'error', message: error?.response?.data?.message || 'Failed to download payslip.' });
    }
  };

  if (isLoading) {
    return <PageLoadingState label="Loading payslips..." />;
  }

  if (feedback?.tone === 'error' && payslips.length === 0) {
    return <PageErrorState message={feedback.message} onRetry={() => void load()} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Payroll output"
        title="Payslips"
        description={canManage ? 'Generate, review, and download employee payslips by cycle.' : 'View and download your payroll payslips for each processed month.'}
      />

      {feedback ? <FeedbackBanner tone={feedback.tone} message={feedback.message} /> : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Payslips" value={payslips.length} hint="Payslips in the current filter." icon={FileText} accent="sky" />
        <MetricCard label="Paid" value={payslips.filter((item) => item.payment_status === 'paid').length} hint="Marked paid." icon={Wallet} accent="emerald" />
        <MetricCard label="Pending" value={payslips.filter((item) => item.payment_status !== 'paid').length} hint="Still awaiting payment." icon={Receipt} accent="amber" />
        <MetricCard label="Net Total" value={formatPayrollCurrency(payslips.reduce((sum, item) => sum + Number(item.net_salary || 0), 0))} hint="Combined net salary total." icon={Wallet} accent="violet" />
      </div>

      <FilterPanel className="grid grid-cols-1 gap-3 md:grid-cols-4">
        {canManage ? (
          <div>
            <FieldLabel>Employee</FieldLabel>
            <EmployeeSelect employees={employees} value={selectedUserId} onChange={setSelectedUserId} includeAllOption />
          </div>
        ) : null}
        <div>
          <FieldLabel>Period Month</FieldLabel>
          <TextInput type="month" value={periodMonth} onChange={(event) => setPeriodMonth(event.target.value)} />
        </div>
        {canManage ? (
          <div className="flex items-end">
            <Button variant="secondary" className="w-full" onClick={generatePayslip} disabled={!selectedUserId}>
              Generate Payslip
            </Button>
          </div>
        ) : null}
        <div className="flex items-end">
          <Button variant="secondary" className="w-full" onClick={() => void load()}>
            Refresh
          </Button>
        </div>
      </FilterPanel>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_0.85fr]">
        <PayrollSectionCard title="Payslip List" description="Employee-wise payslips for the selected month and filter.">
          {payslips.length === 0 ? (
            <EmptyStateCard title="No payslips found" description="No payslips are available for the current filter yet." icon={FileText} />
          ) : (
            <div className="space-y-3">
              {payslips.map((payslip) => (
                <button
                  key={payslip.id}
                  type="button"
                  onClick={() => setSelectedPayslipId(payslip.id)}
                  className={`w-full rounded-[22px] border px-4 py-4 text-left transition ${selectedPayslip?.id === payslip.id ? 'border-sky-300 bg-sky-50/70' : 'border-slate-200/80 bg-slate-50/70 hover:bg-white'}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-slate-950">{payslip.user?.name || `User #${payslip.user_id}`}</p>
                      <p className="mt-1 text-sm text-slate-500">{formatPayrollMonth(payslip.period_month)}</p>
                    </div>
                    <PayrollStatusBadge status={payslip.payment_status || 'pending'} />
                  </div>
                  <p className="mt-3 text-lg font-semibold text-slate-950">{formatPayrollCurrency(payslip.net_salary, payslip.currency)}</p>
                </button>
              ))}
            </div>
          )}
        </PayrollSectionCard>

        <PayrollSectionCard title="Payslip Detail" description="Detailed review and PDF export for the selected payslip.">
          {!selectedPayslip ? (
            <p className="text-sm text-slate-500">Select a payslip to review breakdown details and download the printable PDF.</p>
          ) : (
            <div className="space-y-4">
              <div className="rounded-[24px] border border-slate-200/80 bg-slate-50/70 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-slate-950">{selectedPayslip.user?.name || `User #${selectedPayslip.user_id}`}</p>
                    <p className="mt-1 text-sm text-slate-500">{formatPayrollMonth(selectedPayslip.period_month)}</p>
                  </div>
                  <PayrollStatusBadge status={selectedPayslip.payment_status || 'pending'} />
                </div>
                <div className="mt-4 space-y-2 text-sm">
                  <div className="flex items-center justify-between"><span className="text-slate-500">Basic salary</span><span className="font-semibold text-slate-950">{formatPayrollCurrency(selectedPayslip.basic_salary, selectedPayslip.currency)}</span></div>
                  <div className="flex items-center justify-between"><span className="text-slate-500">Allowances</span><span className="font-semibold text-slate-950">{formatPayrollCurrency(selectedPayslip.total_allowances, selectedPayslip.currency)}</span></div>
                  <div className="flex items-center justify-between"><span className="text-slate-500">Deductions</span><span className="font-semibold text-slate-950">{formatPayrollCurrency(selectedPayslip.total_deductions, selectedPayslip.currency)}</span></div>
                  <div className="flex items-center justify-between"><span className="text-slate-500">Net salary</span><span className="font-semibold text-slate-950">{formatPayrollCurrency(selectedPayslip.net_salary, selectedPayslip.currency)}</span></div>
                </div>
              </div>

              <div className="rounded-[22px] border border-dashed border-slate-300 bg-slate-50/70 px-4 py-3 text-sm text-slate-500">
                Publish and unpublish controls are not modeled in the current backend. Generated payslips are treated as immediately available, and payment state is tracked separately.
              </div>

              <div className="flex flex-wrap gap-3">
                <Button onClick={() => void downloadPayslip(selectedPayslip.id)}>
                  <Download className="h-4 w-4" />
                  Download PDF
                </Button>
                {canManage ? (
                  <>
                    <Link to={`/payroll/employees/${selectedPayslip.user_id}`}>
                      <Button variant="secondary">Open Employee</Button>
                    </Link>
                    <Button variant="secondary" onClick={markPaid} disabled={selectedPayslip.payment_status === 'paid'}>
                      Mark Paid
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
          )}
        </PayrollSectionCard>
      </div>
    </div>
  );
}
