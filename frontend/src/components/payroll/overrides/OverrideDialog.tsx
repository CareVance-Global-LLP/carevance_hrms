import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Check, Copy, Loader2, Settings2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  payrollApi,
  getApiErrorMessage,
  type PayrollOverrideBalanceMode,
  type PayrollOverridePreview,
  type SalaryComponentRow,
} from '@/services/api';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/dialog/Modal';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/utils/cn';

/**
 * Raising an override, in two steps: state it, then see what it does.
 *
 * The preview is the reason this dialog exists. Across Keka, greytHR, Zoho and
 * RazorpayX, not one shows the consequence of an override before it is saved —
 * every preview that exists is breakup-only and revision-only. That matters
 * more here than it would elsewhere, because this salary structure is residual
 * and the delta is amplified: raising basic by ₹10,000 costs the residual
 * ₹16,681, and an admin has no way to know that from an input box.
 *
 * EVERY NUMBER ON STEP 2 COMES OUT OF THE API RESPONSE. The amplification
 * factor, the residual either side and the permitted maximum are the balancer's
 * figures. Re-deriving any of them here would eventually disagree with the one
 * the engine enforces, and the disagreement would surface as a payslip.
 */

interface OverrideDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

interface EmployeeOption {
  id: number;
  name: string;
}

/** The engine keys the calculator computes under, by component code. */
const ENGINE_KEY_BY_CODE: Record<string, string> = {
  BASIC: 'basic',
  HRA: 'hra',
  CONV: 'conveyance',
  CONVEYANCE: 'conveyance',
  SPL: 'special_allowance',
  SPECIAL: 'special_allowance',
  SPECIAL_ALLOWANCE: 'special_allowance',
};

function engineKeyFor(component: SalaryComponentRow): string | null {
  const byCode = ENGINE_KEY_BY_CODE[(component.code ?? '').trim().toUpperCase()];
  if (byCode) return byCode;
  const byName = ENGINE_KEY_BY_CODE[(component.name ?? '').trim().toUpperCase().replace(/[\s-]/g, '_')];
  return byName ?? null;
}

const inputClass =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500';

const labelClass = 'block text-xs font-medium text-slate-600';

/** ₹ figures use the Indian grouping the rest of payroll uses. */
function rupees(value: number): string {
  return `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

/** A month input gives YYYY-MM; the API takes a calendar date. */
function firstOfMonth(month: string): string {
  return `${month}-01`;
}

function lastOfMonth(month: string): string {
  const [year, m] = month.split('-').map(Number);
  return new Date(year, m, 0).toISOString().slice(0, 10);
}

export default function OverrideDialog({ isOpen, onClose }: OverrideDialogProps) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [step, setStep] = useState<'form' | 'preview'>('form');
  const [employeeQuery, setEmployeeQuery] = useState('');
  const [userId, setUserId] = useState<number | ''>('');
  const [target, setTarget] = useState('');
  const [value, setValue] = useState('');
  const [balanceMode, setBalanceMode] = useState<PayrollOverrideBalanceMode>('preserve_ctc');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [effectiveTo, setEffectiveTo] = useState('');
  const [reason, setReason] = useState('');

  const [preview, setPreview] = useState<PayrollOverridePreview | null>(null);
  const [explanation, setExplanation] = useState('');
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: employeesData } = useQuery({
    queryKey: ['payroll', 'employees'],
    queryFn: () => payrollApi.getEmployees().then((r) => r.data),
    enabled: isOpen,
  });

  const { data: componentsData, isLoading: componentsLoading } = useQuery({
    queryKey: ['payroll', 'salary-components'],
    queryFn: () => payrollApi.getSalaryComponents().then((r) => r.data),
    enabled: isOpen,
  });

  const employees: EmployeeOption[] = useMemo(() => {
    const rows = (employeesData ?? []) as unknown as Array<Record<string, unknown>>;
    return rows
      .map((row) => ({
        id: Number(row.id ?? row.user_id),
        name: String(row.name ?? row.employee_name ?? `Employee #${row.id ?? row.user_id}`),
      }))
      .filter((row) => Number.isFinite(row.id));
  }, [employeesData]);

  const matchingEmployees = useMemo(() => {
    const q = employeeQuery.trim().toLowerCase();
    const pool = q ? employees.filter((e) => e.name.toLowerCase().includes(q)) : employees;
    return pool.slice(0, 50);
  }, [employees, employeeQuery]);

  /*
   * Only gated components are offered. Validating the attempt afterwards would
   * be a worse control: the admin has already decided by the time they are told
   * the component was never eligible.
   */
  const gatedComponents = useMemo(
    () =>
      (componentsData?.components ?? [])
        .filter((c) => c.allow_employee_override && c.is_active)
        .map((c) => ({ component: c, engineKey: engineKeyFor(c) }))
        .filter((entry): entry is { component: SalaryComponentRow; engineKey: string } => entry.engineKey !== null),
    [componentsData],
  );

  const resetAndClose = () => {
    setStep('form');
    setEmployeeQuery('');
    setUserId('');
    setTarget('');
    setValue('');
    setBalanceMode('preserve_ctc');
    setEffectiveFrom('');
    setEffectiveTo('');
    setReason('');
    setPreview(null);
    setExplanation('');
    setFormError(null);
    setCopied(false);
    onClose();
  };

  const formComplete =
    userId !== '' && target !== '' && value !== '' && effectiveFrom !== '' && reason.trim().length >= 5;

  const runPreview = async () => {
    if (!formComplete) return;
    setIsPreviewing(true);
    setFormError(null);

    try {
      const response = await payrollApi.overrides.preview({
        user_id: Number(userId),
        target,
        value: Number(value),
        balance_mode: balanceMode,
      });

      // Preview answers "what would happen", so a refusal arrives as a 200 with
      // permitted: false. It is a successful answer, not an error.
      setPreview(response.data.preview);
      setExplanation(response.data.employee_explanation);
      setStep('preview');
    } catch (error) {
      setFormError(getApiErrorMessage(error));
    } finally {
      setIsPreviewing(false);
    }
  };

  const save = async () => {
    if (!preview?.permitted) return;
    setIsSaving(true);
    setFormError(null);

    try {
      await payrollApi.overrides.create({
        user_id: Number(userId),
        scope: 'component',
        target,
        value: Number(value),
        balance_mode: balanceMode,
        effective_from: firstOfMonth(effectiveFrom),
        effective_to: effectiveTo ? lastOfMonth(effectiveTo) : null,
        reason: reason.trim(),
      });

      await queryClient.invalidateQueries({ queryKey: ['payroll', 'overrides'] });
      toast.show({
        kind: 'success',
        message: 'Override raised. It applies at the next payroll process, once approved.',
      });
      resetAndClose();
    } catch (error) {
      setFormError(getApiErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  const useMaximum = () => {
    if (!preview) return;
    setValue(String(preview.max_permitted));
    setStep('form');
    setPreview(null);
  };

  const copyExplanation = async () => {
    try {
      await navigator.clipboard.writeText(explanation);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      toast.show({ kind: 'error', message: getApiErrorMessage(error) });
    }
  };

  return (
    <Modal
      open={isOpen}
      onClose={resetAndClose}
      title={step === 'form' ? 'New override' : 'What this override does'}
      size="2xl"
    >
      <div className="space-y-4">
        {step === 'form' ? (
          <>
            <p className="text-sm text-slate-500">
              An override is a dated, per-employee exception to the salary structure. It never edits
              the structure, and it applies at the next payroll process — not when it is saved.
            </p>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className={labelClass} htmlFor="override-employee-search">
                  Employee
                </label>
                <input
                  id="override-employee-search"
                  type="search"
                  value={employeeQuery}
                  onChange={(e) => setEmployeeQuery(e.target.value)}
                  placeholder="Search by name"
                  className={cn(inputClass, 'mt-1')}
                />
                <select
                  aria-label="Employee"
                  value={userId}
                  onChange={(e) => setUserId(e.target.value === '' ? '' : Number(e.target.value))}
                  className={cn(inputClass, 'mt-2')}
                >
                  <option value="">Select an employee…</option>
                  {matchingEmployees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-2">
                <label className={labelClass} htmlFor="override-component">
                  Component
                </label>
                {componentsLoading ? (
                  <p className="mt-2 text-sm text-slate-400">Loading components…</p>
                ) : gatedComponents.length === 0 ? (
                  <div className="mt-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    <p className="font-medium">No component is open to employee-level override.</p>
                    <p className="mt-1">
                      Tick “Allow this component to be overridden at employee level” on a component
                      in{' '}
                      <Link
                        to="/payroll/pay-group-settings"
                        className="font-medium underline underline-offset-2"
                      >
                        Pay Group Settings
                      </Link>
                      .
                    </p>
                  </div>
                ) : (
                  <select
                    id="override-component"
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                    className={cn(inputClass, 'mt-1')}
                  >
                    <option value="">Select a component…</option>
                    {gatedComponents.map(({ component, engineKey }) => (
                      <option key={component.id} value={engineKey}>
                        {component.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="sm:col-span-2">
                <label className={labelClass} htmlFor="override-value">
                  Annual value (₹/year)
                </label>
                <input
                  id="override-value"
                  type="number"
                  min={0}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  className={cn(inputClass, 'mt-1')}
                />
              </div>

              <fieldset className="sm:col-span-2">
                <legend className={labelClass}>What funds this change</legend>
                <div className="mt-2 space-y-2">
                  <label className="flex items-start gap-2 text-sm text-slate-700">
                    <input
                      type="radio"
                      name="balance-mode"
                      value="preserve_ctc"
                      checked={balanceMode === 'preserve_ctc'}
                      onChange={() => setBalanceMode('preserve_ctc')}
                      className="mt-0.5"
                    />
                    <span>
                      Hold CTC (residual absorbs)
                      <span className="block text-xs text-slate-500">
                        The number in the employee&apos;s offer letter does not move.
                      </span>
                    </span>
                  </label>
                  <label className="flex items-start gap-2 text-sm text-slate-700">
                    <input
                      type="radio"
                      name="balance-mode"
                      value="increase_gross"
                      checked={balanceMode === 'increase_gross'}
                      onChange={() => setBalanceMode('increase_gross')}
                      className="mt-0.5"
                    />
                    <span>
                      Increase gross (CTC rises — needs approval)
                      <span className="block text-xs text-slate-500">
                        The envelope is enlarged to fund the change; the residual is untouched.
                      </span>
                    </span>
                  </label>
                </div>
              </fieldset>

              <div>
                <label className={labelClass} htmlFor="override-from">
                  Effective from
                </label>
                <input
                  id="override-from"
                  type="month"
                  value={effectiveFrom}
                  onChange={(e) => setEffectiveFrom(e.target.value)}
                  className={cn(inputClass, 'mt-1')}
                />
              </div>

              <div>
                <label className={labelClass} htmlFor="override-to">
                  Effective to
                </label>
                <input
                  id="override-to"
                  type="month"
                  value={effectiveTo}
                  onChange={(e) => setEffectiveTo(e.target.value)}
                  className={cn(inputClass, 'mt-1')}
                />
                <p className="mt-1 text-xs text-slate-500">Leave empty = stays until cancelled</p>
              </div>

              <div className="sm:col-span-2">
                <label className={labelClass} htmlFor="override-reason">
                  Reason
                </label>
                <textarea
                  id="override-reason"
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Why this exception is being made (at least 5 characters)"
                  className={cn(inputClass, 'mt-1')}
                />
              </div>
            </div>

            {formError && (
              <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {formError}
              </p>
            )}

            <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
              <Button variant="secondary" onClick={resetAndClose}>
                Cancel
              </Button>
              <Button onClick={runPreview} disabled={!formComplete} loading={isPreviewing}>
                Preview
              </Button>
            </div>
          </>
        ) : preview ? (
          <>
            {/*
              Every figure below is rendered straight from the response. The
              amplification factor in particular is the number that explains why
              an override "cost more than I asked for", and no product in this
              market surfaces it.
            */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-slate-100">
                  <tr>
                    <th scope="row" className="py-2 text-left font-medium text-slate-600">
                      Current
                    </th>
                    <td className="py-2 text-right tabular-nums text-slate-900" data-testid="preview-current">
                      {rupees(preview.current)}
                    </td>
                  </tr>
                  <tr>
                    <th scope="row" className="py-2 text-left font-medium text-slate-600">
                      Requested
                    </th>
                    <td className="py-2 text-right tabular-nums text-slate-900" data-testid="preview-requested">
                      {rupees(preview.requested)}
                    </td>
                  </tr>
                  <tr>
                    <th scope="row" className="py-2 text-left font-medium text-slate-600">
                      Amplification
                    </th>
                    <td className="py-2 text-right text-slate-900" data-testid="preview-amplification">
                      each ₹1 of basic moves ₹{preview.amplification} of allowance
                    </td>
                  </tr>
                  <tr>
                    <th scope="row" className="py-2 text-left font-medium text-slate-600">
                      Residual before → after
                    </th>
                    <td className="py-2 text-right tabular-nums text-slate-900" data-testid="preview-residual">
                      {rupees(preview.residual_before)} → {rupees(preview.residual_after)}
                    </td>
                  </tr>
                  <tr>
                    <th scope="row" className="py-2 text-left font-medium text-slate-600">
                      Max permitted
                    </th>
                    <td className="py-2 text-right tabular-nums text-slate-900" data-testid="preview-max">
                      {Number.isFinite(preview.max_permitted) ? rupees(preview.max_permitted) : 'No ceiling'}
                    </td>
                  </tr>
                  {preview.balancing_target && (
                    <tr>
                      <th scope="row" className="py-2 text-left font-medium text-slate-600">
                        Absorbed by
                      </th>
                      <td className="py-2 text-right text-slate-900">{preview.balancing_target}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {!preview.permitted && (
              <div
                className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
                data-testid="preview-refusal"
              >
                <p className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{preview.message}</span>
                </p>
                {Number.isFinite(preview.max_permitted) && (
                  <Button variant="secondary" size="sm" className="mt-3" onClick={useMaximum}>
                    Use max {rupees(preview.max_permitted)}
                  </Button>
                )}
              </div>
            )}

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-start justify-between gap-3">
                <blockquote className="text-sm italic text-slate-700">{explanation}</blockquote>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={copyExplanation}
                  iconLeft={copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                >
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                <Settings2 className="mr-1 inline h-3 w-3" />
                Send this to the employee. &ldquo;My CTC did not change but my take-home went
                down&rdquo; is the ticket this feature generates.
              </p>
            </div>

            {formError && (
              <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {formError}
              </p>
            )}

            <div className="flex justify-between gap-2 border-t border-slate-200 pt-4">
              <Button
                variant="ghost"
                onClick={() => setStep('form')}
                iconLeft={<ArrowLeft className="h-4 w-4" />}
              >
                Back
              </Button>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={resetAndClose}>
                  Cancel
                </Button>
                <Button onClick={save} disabled={!preview.permitted} loading={isSaving}>
                  Save override
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center py-8 text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}
      </div>
    </Modal>
  );
}
