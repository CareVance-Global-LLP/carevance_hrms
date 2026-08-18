import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SlidersHorizontal } from 'lucide-react';
import { payrollApi, getApiErrorMessage, type SalaryComponentRow } from '@/services/api';
import { useToast } from '@/components/ui/Toast';

/**
 * Which salary components may be overridden at the employee level.
 *
 * This is the gate, and it is deliberately a per-component permission rather
 * than a role: an ungated component never appears in the override dialog at
 * all, which is a far better control than accepting the attempt and refusing it
 * afterwards. Keka words the same setting as "Allow this component to be
 * customized and overridden at the employee level".
 *
 * Recurring earning heads only. A reimbursement, a penalty or a tax line is not
 * a structural component, so overriding one is not the exception this module
 * governs — those already have their own routes.
 */
const RECURRING_CATEGORIES = ['basic', 'allowance', 'bonus', 'other'];

export default function ComponentOverrideGates() {
  const queryClient = useQueryClient();
  const toast = useToast();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['payroll', 'salary-components'],
    queryFn: () => payrollApi.getSalaryComponents().then((r) => r.data),
  });

  const setGate = useMutation({
    mutationFn: ({ id, allow }: { id: number; allow: boolean }) =>
      payrollApi.updateSalaryComponent(id, { allow_employee_override: allow }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['payroll', 'salary-components'] });
    },
    onError: (err) => {
      toast.show({ kind: 'error', message: getApiErrorMessage(err) });
    },
  });

  const components: SalaryComponentRow[] = (data?.components ?? []).filter(
    (component) => RECURRING_CATEGORIES.includes(component.category) && component.is_active,
  );

  return (
    <div className="mb-4 space-y-4 rounded-lg border border-gray-200 bg-white p-4">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-medium text-gray-900">
          <SlidersHorizontal className="h-4 w-4 text-gray-400" />
          Employee-level overrides
        </h3>
        <p className="mt-1 text-xs text-gray-500">
          A component ticked here can carry a dated, per-employee exception. Unticked components
          are never offered in the override dialog.
        </p>
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-400">Loading components…</p>
      ) : isError ? (
        <p className="text-sm text-red-600">{getApiErrorMessage(error)}</p>
      ) : components.length === 0 ? (
        <p className="text-sm text-gray-500">
          This organisation has no recurring salary components configured yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {components.map((component) => (
            <li key={component.id} className="flex items-start gap-2">
              <input
                id={`override-gate-${component.id}`}
                type="checkbox"
                className="mt-0.5"
                checked={Boolean(component.allow_employee_override)}
                disabled={setGate.isPending}
                onChange={(e) => setGate.mutate({ id: component.id, allow: e.target.checked })}
              />
              <label htmlFor={`override-gate-${component.id}`} className="text-sm text-gray-700">
                Allow this component to be overridden at employee level
                <span className="block text-xs text-gray-500">
                  {component.name} ({component.code})
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
