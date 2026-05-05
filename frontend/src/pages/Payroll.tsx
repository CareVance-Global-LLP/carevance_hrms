import { useEffect, useMemo, useState } from 'react';
import { payrollApi } from '@/services/api';
import type { PayrollRecord, PayrollTransaction } from '@/types';
import { RefreshCw, Wallet } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import PageHeader from '@/components/dashboard/PageHeader';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import FilterPanel from '@/components/dashboard/FilterPanel';
import Button from '@/components/ui/Button';
import { FeedbackBanner, PageEmptyState, PageLoadingState } from '@/components/ui/PageState';
import { FieldLabel, SelectInput, TextInput } from '@/components/ui/FormField';
import StatusBadge from '@/components/ui/StatusBadge';

type OrgEmployee = { id: number; name: string; email: string; role: string };

const statusBadgeTone = (status: string) => {
  switch (status) {
    case 'paid':
    case 'success':
      return 'success' as const;
    case 'processed':
    case 'pending':
      return 'warning' as const;
    case 'failed':
      return 'danger' as const;
    default:
      return 'neutral' as const;
  }
};

const money = (value: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value || 0));

const defaultMonth = () => new Date().toISOString().slice(0, 7);

export default function Payroll() {
  const location = useLocation();
  const navigate = useNavigate();
  const [employees, setEmployees] = useState<OrgEmployee[]>([]);
  const [records, setRecords] = useState<PayrollRecord[]>([]);
  const [selectedRecord, setSelectedRecord] = useState<PayrollRecord | null>(null);
  const [transactions, setTransactions] = useState<PayrollTransaction[]>([]);
  const [payrollMode, setPayrollMode] = useState<'mock' | 'stripe_test' | 'stripe_live'>('mock');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const [generateMonth, setGenerateMonth] = useState(defaultMonth());
  const [generateEmployeeId, setGenerateEmployeeId] = useState<number | ''>('');
  const [generatePayoutMethod, setGeneratePayoutMethod] = useState<'mock' | 'stripe'>('mock');
  const [allowOverwrite, setAllowOverwrite] = useState(false);

  const [filterEmployeeId, setFilterEmployeeId] = useState<number | ''>('');
  const [filterMonth, setFilterMonth] = useState('');
  const [filterPayrollStatus, setFilterPayrollStatus] = useState<'' | 'draft' | 'processed' | 'paid'>('');
  const [filterPayoutStatus, setFilterPayoutStatus] = useState<'' | 'pending' | 'success' | 'failed'>('');

  const selectedId = selectedRecord?.id ?? null;

  const filteredPayload = useMemo(
    () => ({
      user_id: filterEmployeeId || undefined,
      payroll_month: filterMonth || undefined,
      payroll_status: filterPayrollStatus || undefined,
      payout_status: filterPayoutStatus || undefined,
    }),
    [filterEmployeeId, filterMonth, filterPayrollStatus, filterPayoutStatus]
  );

  const load = async () => {
    setIsLoading(true);
    setError('');
    try {
      const [eRes, rRes] = await Promise.all([payrollApi.getEmployees(), payrollApi.getRecords(filteredPayload)]);
      setEmployees(eRes.data.data || []);
      setRecords(rRes.data.data || []);
      setPayrollMode(rRes.data.mode || 'mock');

      if (selectedId) {
        const nextSelected = (rRes.data.data || []).find((item) => item.id === selectedId) || null;
        setSelectedRecord(nextSelected);
      }
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Failed to load payroll records.');
    } finally {
      setIsLoading(false);
    }
  };

  const loadTransactions = async (id: number) => {
    try {
      const res = await payrollApi.getRecordTransactions(id);
      setTransactions(res.data.data || []);
    } catch {
      setTransactions([]);
    }
  };

  useEffect(() => {
    load();
  }, [filterEmployeeId, filterMonth, filterPayrollStatus, filterPayoutStatus]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const payment = params.get('payment');
    const payrollId = Number(params.get('payroll_id') || 0);
    const checkoutSessionId = params.get('checkout_session_id') || '';
    const clearPaymentQuery = () => navigate(location.pathname, { replace: true });

    const run = async () => {
      if (!payment) {
        return;
      }

      if (payment === 'success' && payrollId > 0 && checkoutSessionId) {
        try {
          await payrollApi.syncStripeCheckout(payrollId, checkoutSessionId);
          setMessage('Stripe payment completed and payroll status synchronized.');
          await load();
        } catch (e: any) {
          setError(e?.response?.data?.message || 'Stripe payment completed but status sync failed.');
        } finally {
          clearPaymentQuery();
        }
        return;
      }

      if (payment === 'success') {
        setMessage('Stripe payment completed. Payout status will update shortly.');
      } else if (payment === 'cancelled') {
        setError('Stripe payment was cancelled.');
      }

      clearPaymentQuery();
    };

    void run();
  }, [location.pathname, location.search, navigate]);

  const onSelectRecord = async (record: PayrollRecord) => {
    setSelectedRecord(record);
    await loadTransactions(record.id);
  };

  const updateSelectedField = (key: keyof PayrollRecord, value: any) => {
    if (!selectedRecord) return;
    const next = { ...selectedRecord, [key]: value };
    const basic = Number(next.basic_salary || 0);
    const allowances = Number(next.allowances || 0);
    const bonus = Number(next.bonus || 0);
    const deductions = Number(next.deductions || 0);
    const tax = Number(next.tax || 0);
    next.net_salary = basic + allowances + bonus - deductions - tax;
    setSelectedRecord(next);
  };

  const persistSelectedDraft = async (showSuccessMessage = true) => {
    if (!selectedRecord) return;
    const res = await payrollApi.updateRecord(selectedRecord.id, {
      basic_salary: Number(selectedRecord.basic_salary || 0),
      allowances: Number(selectedRecord.allowances || 0),
      deductions: Number(selectedRecord.deductions || 0),
      bonus: Number(selectedRecord.bonus || 0),
      tax: Number(selectedRecord.tax || 0),
      payout_method: selectedRecord.payout_method,
    });
    setSelectedRecord(res.data);
    if (showSuccessMessage) {
      setMessage('Payroll record updated.');
    }
  };

  const saveSelected = async () => {
    if (!selectedRecord) return;
    setIsSaving(true);
    setMessage('');
    setError('');
    try {
      await persistSelectedDraft(true);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Failed to update payroll.');
    } finally {
      setIsSaving(false);
    }
  };

  const updateStatus = async (status: 'draft' | 'processed' | 'paid') => {
    if (!selectedRecord) return;
    setIsSaving(true);
    setMessage('');
    setError('');
    try {
      const res = await payrollApi.updateRecordStatus(selectedRecord.id, status);
      setSelectedRecord(res.data);
      setMessage(`Payroll marked as ${status}.`);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Failed to update payroll status.');
    } finally {
      setIsSaving(false);
    }
  };

  const payout = async (simulateStatus?: 'success' | 'failed' | 'pending') => {
    if (!selectedRecord) return;
    setIsSaving(true);
    setMessage('');
    setError('');
    try {
      // Save current salary edits before attempting payout so values do not reset.
      await persistSelectedDraft(false);

      const res = await payrollApi.payoutRecord(selectedRecord.id, {
        payout_method: selectedRecord.payout_method,
        simulate_status: simulateStatus,
      });
      setPayrollMode(res.data.mode);
      setSelectedRecord(res.data.payroll);
      setTransactions((prev) => [res.data.transaction, ...prev]);
      if (res.data.checkout_url) {
        window.location.href = res.data.checkout_url;
        return;
      }
      setMessage('Payout action completed.');
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Failed to process payout.');
    } finally {
      setIsSaving(false);
    }
  };

  const generate = async () => {
    setIsGenerating(true);
    setMessage('');
    setError('');
    try {
      const res = await payrollApi.generateRecords({
        payroll_month: generateMonth,
        user_id: generateEmployeeId || undefined,
        payout_method: generatePayoutMethod,
        allow_overwrite: allowOverwrite,
      });
      const skippedReasons = Array.isArray(res.data.skipped) && res.data.skipped.length > 0
        ? ` Reasons: ${res.data.skipped.map((item: any) => item.reason).join(', ')}.`
        : '';
      setMessage(`Generated: ${res.data.generated_count}, skipped: ${res.data.skipped_count}.${skippedReasons}`);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Failed to generate payroll.');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        eyebrow="Finance operations"
        title="Payroll Management"
        description="Generate payroll, review salary breakdowns, and complete payouts in mock or Stripe mode."
      />

      {message ? <FeedbackBanner tone="success" message={message} /> : null}
      {error ? <FeedbackBanner tone="error" message={error} /> : null}

      <FilterPanel className="grid grid-cols-1 gap-3 md:grid-cols-6">
        <div>
          <FieldLabel>Month</FieldLabel>
          <TextInput type="month" value={generateMonth} onChange={(e) => setGenerateMonth(e.target.value)} />
        </div>
        <div>
          <FieldLabel>Employee</FieldLabel>
          <SelectInput value={generateEmployeeId} onChange={(e) => setGenerateEmployeeId(e.target.value ? Number(e.target.value) : '')}>
            <option value="">All Employees</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </SelectInput>
        </div>
        <div>
          <FieldLabel>Payout Method</FieldLabel>
          <SelectInput value={generatePayoutMethod} onChange={(e) => setGeneratePayoutMethod(e.target.value as 'mock' | 'stripe')}>
            <option value="mock">Mock</option>
            <option value="stripe">Stripe</option>
          </SelectInput>
        </div>
        <div className="flex items-end">
          <label className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 text-sm text-slate-700 shadow-sm">
            <input type="checkbox" checked={allowOverwrite} onChange={(e) => setAllowOverwrite(e.target.checked)} />
            Allow overwrite
          </label>
        </div>
        <div className="flex items-end md:col-span-2">
          <Button onClick={generate} disabled={isGenerating} className="w-full">
            {isGenerating ? 'Generating...' : 'Generate Payroll'}
          </Button>
        </div>
      </FilterPanel>

      <FilterPanel className="grid grid-cols-1 gap-3 md:grid-cols-6">
        <div>
          <FieldLabel>Filter Employee</FieldLabel>
          <SelectInput value={filterEmployeeId} onChange={(e) => setFilterEmployeeId(e.target.value ? Number(e.target.value) : '')}>
            <option value="">All</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </SelectInput>
        </div>
        <div>
          <FieldLabel>Filter Month</FieldLabel>
          <TextInput type="month" value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)} />
        </div>
        <div>
          <FieldLabel>Payroll Status</FieldLabel>
          <SelectInput value={filterPayrollStatus} onChange={(e) => setFilterPayrollStatus(e.target.value as any)}>
            <option value="">All</option>
            <option value="draft">Draft</option>
            <option value="processed">Processed</option>
            <option value="paid">Paid</option>
          </SelectInput>
        </div>
        <div>
          <FieldLabel>Payout Status</FieldLabel>
          <SelectInput value={filterPayoutStatus} onChange={(e) => setFilterPayoutStatus(e.target.value as any)}>
            <option value="">All</option>
            <option value="pending">Pending</option>
            <option value="success">Success</option>
            <option value="failed">Failed</option>
          </SelectInput>
        </div>
        <div className="flex items-end">
          <Button onClick={() => { setFilterEmployeeId(''); setFilterMonth(''); setFilterPayrollStatus(''); setFilterPayoutStatus(''); }} variant="secondary" className="w-full">
            Clear Filters
          </Button>
        </div>
        <div className="flex items-end">
          <Button onClick={load} variant="secondary" className="w-full" iconLeft={<RefreshCw className="h-4 w-4" />}>
            Refresh
          </Button>
        </div>
      </FilterPanel>

      {isLoading ? (
        <PageLoadingState label="Loading payroll records..." />
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <SurfaceCard className="xl:col-span-2 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Employee</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Month</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Net Salary</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Payroll</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Payout</th>
                </tr>
              </thead>
              <tbody>
                {records.length === 0 ? (
                  <tr><td className="px-4 py-6" colSpan={5}><PageEmptyState title="No payroll records found" description="Generate payroll or adjust the filters to view records." /></td></tr>
                ) : records.map((record) => (
                  <tr
                    key={record.id}
                    className={`cursor-pointer border-b border-slate-100 transition hover:bg-slate-50 ${selectedRecord?.id === record.id ? 'bg-sky-50' : ''}`}
                    onClick={() => onSelectRecord(record)}
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{record.user?.name || `#${record.user_id}`}</p>
                      <p className="text-xs text-gray-500">{record.user?.email}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{record.payroll_month}</td>
                    <td className="px-4 py-3 text-gray-700">{money(record.net_salary)}</td>
                    <td className="px-4 py-3">
                      <StatusBadge tone={statusBadgeTone(record.payroll_status)}>{record.payroll_status}</StatusBadge>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge tone={statusBadgeTone(record.payout_status)}>{record.payout_status}</StatusBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </SurfaceCard>

          <SurfaceCard className="p-4 space-y-3">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              <Wallet className="h-4 w-4" />
              Payroll Detail
            </h2>
            {!selectedRecord ? (
              <p className="text-sm text-gray-500">Select a payroll record from the list.</p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Basic Salary" value={selectedRecord.basic_salary} onChange={(v) => updateSelectedField('basic_salary', v)} />
                  <Field label="Allowances" value={selectedRecord.allowances} onChange={(v) => updateSelectedField('allowances', v)} />
                  <Field label="Bonus" value={selectedRecord.bonus} onChange={(v) => updateSelectedField('bonus', v)} />
                  <Field label="Deductions" value={selectedRecord.deductions} onChange={(v) => updateSelectedField('deductions', v)} />
                  <Field label="Tax" value={selectedRecord.tax} onChange={(v) => updateSelectedField('tax', v)} />
                  <div>
                    <FieldLabel>Payout Method</FieldLabel>
                    <SelectInput value={selectedRecord.payout_method} onChange={(e) => updateSelectedField('payout_method', e.target.value)}>
                      <option value="mock">Mock</option>
                      <option value="stripe">Stripe</option>
                    </SelectInput>
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs text-gray-600">Gross Salary</p>
                  <p className="text-sm font-medium text-gray-900">{money(Number(selectedRecord.basic_salary || 0) + Number(selectedRecord.allowances || 0) + Number(selectedRecord.bonus || 0))}</p>
                  <p className="text-xs text-gray-600 mt-2">Total Deductions</p>
                  <p className="text-sm font-medium text-gray-900">{money(Number(selectedRecord.deductions || 0) + Number(selectedRecord.tax || 0))}</p>
                  <p className="text-xs text-gray-600 mt-2">Net Salary</p>
                  <p className="text-sm font-semibold text-gray-900">{money(selectedRecord.net_salary || 0)}</p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button onClick={saveSelected} disabled={isSaving} variant="secondary" size="sm">Save Draft</Button>
                  <Button onClick={() => updateStatus('processed')} disabled={isSaving} size="sm" className="bg-amber-600 shadow-sm hover:bg-amber-700">Mark Processed</Button>
                  <Button onClick={() => payout()} disabled={isSaving} size="sm">Run Payout</Button>
                </div>

                {payrollMode === 'mock' ? (
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => payout('success')} disabled={isSaving} size="sm" className="bg-emerald-600 shadow-sm hover:bg-emerald-700">Simulate Success</Button>
                    <Button onClick={() => payout('failed')} disabled={isSaving} variant="danger" size="sm">Simulate Failure</Button>
                    <Button onClick={() => payout('pending')} disabled={isSaving} size="sm" className="bg-amber-600 shadow-sm hover:bg-amber-700">Simulate Pending</Button>
                  </div>
                ) : null}

                <div>
                  <p className="text-xs font-medium text-gray-600 mb-1">Transaction History</p>
                  <div className="space-y-2 max-h-48 overflow-auto">
                    {transactions.length === 0 ? (
                      <p className="text-xs text-gray-500">No transactions yet.</p>
                    ) : transactions.map((tx) => (
                      <div key={tx.id} className="rounded-lg border border-gray-100 p-2">
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-gray-700">{tx.provider} {tx.transaction_id ? `(${tx.transaction_id})` : ''}</p>
                          <StatusBadge tone={statusBadgeTone(tx.status)}>{tx.status}</StatusBadge>
                        </div>
                        <p className="text-[11px] text-gray-600 mt-1">{money(tx.amount)} - {new Date(tx.created_at).toLocaleString()}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </SurfaceCard>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <TextInput
        type="number"
        min={0}
        value={Number(value || 0)}
        onChange={(e) => onChange(Number(e.target.value || 0))}
      />
    </div>
  );
}

