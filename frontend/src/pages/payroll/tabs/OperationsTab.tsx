import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Check, ShieldCheck, SlidersHorizontal, Table2, X } from 'lucide-react';
import {
  payrollApi,
  getApiErrorMessage,
  type PayrollOverrideRow,
  type PayrollOverrideStatus,
} from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/dialog/Modal';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import PanelChip from '@/components/payroll/PanelChip';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/utils/cn';
import ComponentOverrideGrid from '@/components/payroll/ComponentOverrideGrid';
import StatutoryOverrideForm from '@/components/payroll/StatutoryOverrideForm';

/**
 * The override register: what is in force, what is pending, and what each one
 * actually did.
 *
 * Both values are shown side by side because only the pair explains a payslip —
 * `value` is what was paid, `computed_value` is what the engine would have
 * paid. An override that has never run reports no engine value at all rather
 * than zero, because zero would read as "this changed nothing" instead of "this
 * has not happened yet".
 */

type OperationsSection = 'grid' | 'register' | 'statutory';

const SECTIONS: Array<{ id: OperationsSection; label: string; icon: typeof SlidersHorizontal }> = [
  // The grid is first because it is where the work happens: the register
  // records what was decided, the grid is where an officer decides it.
  { id: 'grid', label: 'Salary Component Override', icon: Table2 },
  { id: 'register', label: 'Override Register', icon: SlidersHorizontal },
  { id: 'statutory', label: 'Statutory Overrides', icon: ShieldCheck },
];

const STATUS_BADGE: Record<PayrollOverrideStatus, string> = {
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  rejected: 'bg-red-50 text-red-700 border-red-200',
  cancelled: 'bg-slate-100 text-slate-500 border-slate-200',
};

const inputClass =
  'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500';

function rupees(value: number): string {
  return `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

export default function OperationsTab() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();

  const [section, setSection] = useState<OperationsSection>('grid');
  const [month, setMonth] = useState('');
  const [search, setSearch] = useState('');
  const [rejecting, setRejecting] = useState<PayrollOverrideRow | null>(null);
  const [rejectNote, setRejectNote] = useState('');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['payroll', 'overrides', month],
    queryFn: () =>
      payrollApi.overrides.list(month ? { month } : undefined).then((r) => r.data),
  });

  const { data: employeesData } = useQuery({
    queryKey: ['payroll', 'employees'],
    queryFn: () => payrollApi.getEmployees().then((r) => r.data),
  });

  const employeeNames = useMemo(() => {
    const rows = (employeesData ?? []) as unknown as Array<Record<string, unknown>>;
    const map = new Map<number, string>();
    rows.forEach((row) => {
      const id = Number(row.id ?? row.user_id);
      if (Number.isFinite(id)) {
        map.set(id, String(row.name ?? row.employee_name ?? `Employee #${id}`));
      }
    });
    return map;
  }, [employeesData]);

  const nameFor = (userId: number) => employeeNames.get(userId) ?? `Employee #${userId}`;

  const rows = useMemo(() => {
    const all = data?.data ?? [];
    const scoped =
      section === 'statutory' ? all.filter((row) => row.scope === 'statutory') : all;
    const q = search.trim().toLowerCase();
    return q ? scoped.filter((row) => nameFor(row.user_id).toLowerCase().includes(q)) : scoped;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, section, search, employeeNames]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['payroll', 'overrides'] });

  const decide = useMutation({
    mutationFn: ({ row, action, note }: { row: PayrollOverrideRow; action: 'approve' | 'reject' | 'cancel'; note?: string }) => {
      if (action === 'approve') return payrollApi.overrides.approve(row.id);
      if (action === 'cancel') return payrollApi.overrides.cancel(row.id);
      return payrollApi.overrides.reject(row.id, note ?? '');
    },
    onSuccess: (response) => {
      toast.show({ kind: 'success', message: response.data.message });
      setRejecting(null);
      setRejectNote('');
      void refresh();
    },
    onError: (err) => {
      toast.show({ kind: 'error', message: getApiErrorMessage(err) });
    },
  });

  /*
   * The server decides who may decide.
   *
   * This used to re-derive the rule from created_by, which was correct until
   * the sole-admin exception was added server-side — after which the only
   * payroll admin in an organisation could approve through the API and was
   * shown no button to do it with. One rule, one owner, and it is the side
   * that enforces it.
   */
  const canDecide = (row: PayrollOverrideRow) => row.can_approve === true;

  const canCancel = (row: PayrollOverrideRow) =>
    row.status === 'pending' || row.status === 'approved';

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        Dated, per-employee exceptions to the salary structure — governed, previewed before they
        are saved, and applied only when payroll is next processed.
      </p>

      <div className="flex flex-wrap gap-1.5">
        {SECTIONS.map((s) => (
          <PanelChip
            key={s.id}
            label={s.label}
            icon={s.icon}
            isActive={s.id === section}
            onClick={() => setSection(s.id)}
          />
        ))}
      </div>

      {section === 'grid' ? (
        <ComponentOverrideGrid />
      ) : (
      <>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="month"
          aria-label="Filter by month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className={inputClass}
        />
        <input
          type="search"
          aria-label="Search employees"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search employee"
          className={cn(inputClass, 'min-w-56 flex-1 sm:flex-none')}
        />
        {month && (
          <Button variant="ghost" size="sm" onClick={() => setMonth('')}>
            Clear month
          </Button>
        )}
        {/*
          No "New Override" here. Component overrides are raised on the Salary
          Component Override grid, where the residual, the ceiling and the HRA
          move are all visible as you type. A second entry point that showed
          none of that was a worse way to do the same thing.

          Statutory overrides have no such screen — they cascade into nothing,
          so there is nothing to preview — and get their own form below.
        */}
      </div>

      {section === 'statutory' && (
        <StatutoryOverrideForm
          employees={Array.from(employeeNames, ([id, name]) => ({ id, name }))}
          defaultMonth={month || undefined}
        />
      )}

      <SurfaceCard className="overflow-hidden">
        {isLoading ? (
          <p className="p-8 text-center text-sm text-slate-500">Loading overrides…</p>
        ) : isError ? (
          <p className="p-8 text-center text-sm text-red-600">{getApiErrorMessage(error)}</p>
        ) : rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-500">
            No overrides in force. An override is a dated, per-employee exception to the salary
            structure — it applies at the next payroll process and never edits the structure.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-medium">Employee</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Target</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">Value</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">Engine value</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">Δ</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Effective</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Status</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Reason</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50/70" data-testid="override-row">
                    <td className="px-4 py-2.5 text-slate-900">{nameFor(row.user_id)}</td>
                    <td className="px-4 py-2.5 text-slate-700">{row.target}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-900">
                      {rupees(row.value)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                      {row.computed_value === null ? (
                        <span title="known after next payroll process" className="text-slate-500">
                          —
                        </span>
                      ) : (
                        rupees(row.computed_value)
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                      {row.delta === null ? (
                        <span className="text-slate-500">—</span>
                      ) : (
                        rupees(row.delta)
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-slate-700">
                      {row.effective_from}
                      {row.open_ended ? (
                        <span className="ml-1.5 inline-flex rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                          open-ended
                        </span>
                      ) : (
                        <> → {row.effective_to}</>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={cn(
                          'inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize',
                          STATUS_BADGE[row.status],
                        )}
                      >
                        {row.status}
                      </span>
                    </td>
                    <td className="max-w-48 truncate px-4 py-2.5 text-slate-600" title={row.reason}>
                      {row.reason}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1">
                        {/*
                          A pending row an officer may not decide says so,
                          rather than showing an empty Actions cell. The silent
                          version left the only admin in an organisation unable
                          to tell a missing permission from a broken button.
                        */}
                        {row.status === 'pending' && !canDecide(row) && (
                          <span className="text-[11px] leading-snug text-slate-500">
                            {row.decision_blocked_reason ?? 'Another admin has to decide this.'}
                          </span>
                        )}
                        {canDecide(row) && (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              // The sole-admin case is allowed but recorded as a
                              // self-approval; the title says so before the click.
                              title={row.decision_blocked_reason ?? undefined}
                              onClick={() => decide.mutate({ row, action: 'approve' })}
                              iconLeft={<Check className="h-3.5 w-3.5" />}
                            >
                              Approve
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setRejecting(row);
                                setRejectNote('');
                              }}
                              iconLeft={<X className="h-3.5 w-3.5" />}
                            >
                              Reject
                            </Button>
                          </>
                        )}
                        {canCancel(row) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => decide.mutate({ row, action: 'cancel' })}
                            iconLeft={<Ban className="h-3.5 w-3.5" />}
                          >
                            Cancel
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SurfaceCard>

      </>
      )}

      <Modal
        open={rejecting !== null}
        onClose={() => setRejecting(null)}
        title="Reject override"
        size="md"
      >
        <div className="space-y-3">
          <p className="text-sm text-slate-500">
            A rejection without a reason leaves the register with a decision no one can explain.
          </p>
          <textarea
            rows={3}
            aria-label="Rejection note"
            value={rejectNote}
            onChange={(e) => setRejectNote(e.target.value)}
            placeholder="Why this override is being refused (at least 5 characters)"
            className={cn(inputClass, 'w-full')}
          />
          <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
            <Button variant="secondary" onClick={() => setRejecting(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={rejectNote.trim().length < 5}
              loading={decide.isPending}
              onClick={() =>
                rejecting && decide.mutate({ row: rejecting, action: 'reject', note: rejectNote.trim() })
              }
            >
              Reject
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
