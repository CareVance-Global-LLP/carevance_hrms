import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { payrollApi, getApiErrorMessage } from '@/services/api';
import Button from '@/components/ui/Button';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import { FieldLabel, SelectInput, TextInput } from '@/components/ui/FormField';
import { useToast } from '@/components/ui/Toast';

/**
 * State a statutory figure for one employee, for one month onward.
 *
 * This is the opposite of a component override and the form says so. A
 * component override cascades — move basic and HRA follows, PF recomputes, the
 * residual absorbs it. A statutory override is TERMINAL: the amount entered
 * here is what is deducted, and nothing downstream re-derives from it.
 * Recomputing the wage base from a corrected PF figure would just re-derive the
 * number being corrected, which is how a correction becomes a loop.
 *
 * Amounts are MONTHLY, because that is the unit the engine produces these in —
 * unlike Basic and HRA on the grid, which are annual. Saying so on the field is
 * the whole defence against a twelve-fold error.
 */

/** The heads both payroll engines actually compute. Mirrors STATUTORY_TARGETS. */
const STATUTORY_HEADS: Array<{ value: string; label: string; hint: string }> = [
  { value: 'pf', label: 'Provident Fund (employee)', hint: 'Transfer-in reconciliation, international workers, an EPFO direction' },
  { value: 'esi', label: 'ESI (employee)', hint: 'A contribution-period edge the ceiling test gets wrong' },
  { value: 'pt', label: 'Professional Tax', hint: 'Worked out of a different state for the month' },
  { value: 'tds', label: 'TDS', hint: 'Previous-employer income, or proofs that arrived late' },
];

interface StatutoryOverrideFormProps {
  employees: Array<{ id: number; name: string }>;
  defaultMonth?: string;
}

export default function StatutoryOverrideForm({ employees, defaultMonth }: StatutoryOverrideFormProps) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [isOpen, setIsOpen] = useState(false);
  const [userId, setUserId] = useState<number | ''>('');
  const [target, setTarget] = useState('pf');
  const [value, setValue] = useState('');
  const [month, setMonth] = useState(defaultMonth ?? '');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const head = useMemo(() => STATUTORY_HEADS.find((h) => h.value === target), [target]);

  const complete = userId !== '' && value !== '' && month !== '' && reason.trim().length >= 5;

  const reset = () => {
    setUserId('');
    setTarget('pf');
    setValue('');
    setReason('');
    setError(null);
    setIsOpen(false);
  };

  const save = useMutation({
    mutationFn: () =>
      payrollApi.overrides.create({
        user_id: Number(userId),
        scope: 'statutory',
        target,
        // Monthly, matching what the engine produces for these heads. The
        // grid's component values are annual; these are not, and the field
        // label is the only thing standing between the two.
        value: Number(value),
        effective_from: `${month}-01`,
        effective_to: null,
        reason: reason.trim(),
      }),
    onSuccess: async (response) => {
      toast.show({ kind: 'success', message: response.data.message });
      reset();
      await queryClient.invalidateQueries({ queryKey: ['payroll', 'overrides'] });
    },
    onError: (err) => setError(getApiErrorMessage(err)),
  });

  if (!isOpen) {
    return (
      <div className="flex justify-end">
        <Button iconLeft={<ShieldCheck className="h-4 w-4" />} onClick={() => setIsOpen(true)}>
          State a statutory figure
        </Button>
      </div>
    );
  }

  return (
    <SurfaceCard className="p-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-blue-600" />
        <p className="text-sm font-medium text-slate-900">State a statutory figure</p>
      </div>
      <p className="mt-1 text-sm text-slate-500">
        The amount you enter is what will be deducted. Nothing recomputes from it — that is what
        makes this different from a Basic or HRA override.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <FieldLabel>Employee</FieldLabel>
          <SelectInput
            value={userId}
            onChange={(event) => setUserId(event.target.value === '' ? '' : Number(event.target.value))}
          >
            <option value="">Select an employee…</option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>{employee.name}</option>
            ))}
          </SelectInput>
        </div>

        <div>
          <FieldLabel>Statutory head</FieldLabel>
          <SelectInput value={target} onChange={(event) => setTarget(event.target.value)}>
            {STATUTORY_HEADS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </SelectInput>
          {head && <p className="mt-1 text-[11px] text-slate-400">{head.hint}</p>}
        </div>

        <div>
          <FieldLabel hint="Per month, not per year">Amount (₹ / month)</FieldLabel>
          <TextInput
            inputMode="numeric"
            value={value}
            placeholder="e.g. 1800"
            onChange={(event) => setValue(event.target.value.replace(/[^\d.]/g, ''))}
          />
        </div>

        <div>
          <FieldLabel hint="Applies from this month onward">Effective from</FieldLabel>
          <TextInput type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
        </div>

        <div className="sm:col-span-2">
          <FieldLabel>Reason</FieldLabel>
          <TextInput
            value={reason}
            placeholder="e.g. PF reconciled against previous employer's ECR"
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={reset}>Cancel</Button>
        <Button disabled={!complete} loading={save.isPending} onClick={() => save.mutate()}>
          Save statutory override
        </Button>
      </div>
    </SurfaceCard>
  );
}
