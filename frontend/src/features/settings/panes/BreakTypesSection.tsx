import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Coffee, Trash2 } from 'lucide-react';
import { breakTrackingApi } from '@/services/breakTrackingApi';
import Button from '@/components/ui/Button';
import { FieldLabel, TextInput } from '@/components/ui/FormField';
import SettingsCard from '../components/SettingsCard';
import SegmentedControl from '../components/SegmentedControl';

/**
 * Organization break types.
 *
 * is_paid is the consequential field: it decides whether the break counts as
 * payable worked time. Before break types existed, every break was excluded
 * from pay implicitly, because the code filtered is_break — a policy nobody had
 * chosen. This makes it a deliberate, per-type decision.
 *
 * Deactivation is soft on the server so historical entries keep their type for
 * reporting; the type simply stops being offered.
 */
export default function BreakTypesSection({ disabled }: { disabled?: boolean }) {
  const queryClient = useQueryClient();
  const [draftName, setDraftName] = useState('');
  const [draftPaid, setDraftPaid] = useState(false);
  const [draftLimit, setDraftLimit] = useState('');
  const [error, setError] = useState('');

  const { data: types = [], isLoading } = useQuery({
    queryKey: ['break-types'],
    queryFn: () => breakTrackingApi.getTypes(),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['break-types'] });

  const createMutation = useMutation({
    mutationFn: () =>
      breakTrackingApi.createType({
        name: draftName.trim(),
        is_paid: draftPaid,
        max_minutes_per_day: draftLimit ? Number(draftLimit) : null,
      }),
    onSuccess: () => {
      setDraftName('');
      setDraftPaid(false);
      setDraftLimit('');
      setError('');
      void refresh();
    },
    onError: (e: any) => setError(e?.response?.data?.message || 'Could not create break type.'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Record<string, unknown> }) =>
      breakTrackingApi.updateType(id, payload),
    onSuccess: () => void refresh(),
    onError: (e: any) => setError(e?.response?.data?.message || 'Could not update break type.'),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: number) => breakTrackingApi.deactivateType(id),
    onSuccess: () => void refresh(),
    onError: (e: any) => setError(e?.response?.data?.message || 'Could not remove break type.'),
  });

  return (
    <SettingsCard
      title="Break types"
      description="Paid breaks count toward worked hours and payroll. Unpaid breaks do not. A daily limit is a soft allowance — going over is flagged in reports, never blocked."
    >
      {error ? <p className="mb-3 text-xs text-red-600">{error}</p> : null}

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1].map((index) => (
            <div key={index} className="h-16 animate-pulse rounded-lg bg-slate-100" />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {types.map((type) => (
            <div
              key={type.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-surface-sunken p-3"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-surface-card text-slate-600">
                <Coffee className="h-4 w-4" />
              </span>
              <span className="min-w-[8rem] flex-1 truncate text-sm font-medium text-slate-900">{type.name}</span>

              <SegmentedControl
                size="sm"
                ariaLabel={`${type.name} pay treatment`}
                disabled={disabled}
                value={type.is_paid ? 'paid' : 'unpaid'}
                onChange={(value) =>
                  updateMutation.mutate({ id: type.id, payload: { is_paid: value === 'paid' } })
                }
                options={[
                  { value: 'paid', label: 'Paid', tone: 'success' },
                  { value: 'unpaid', label: 'Unpaid', tone: 'neutral' },
                ]}
              />

              <label className="flex items-center gap-2 text-xs text-slate-600">
                <span className="whitespace-nowrap">Daily limit</span>
                <TextInput
                  type="number"
                  min={1}
                  max={1440}
                  placeholder="None"
                  disabled={disabled}
                  defaultValue={type.max_minutes_per_day ?? ''}
                  onBlur={(event) => {
                    const raw = event.target.value.trim();
                    const next = raw === '' ? null : Number(raw);
                    if (next !== (type.max_minutes_per_day ?? null)) {
                      updateMutation.mutate({ id: type.id, payload: { max_minutes_per_day: next } });
                    }
                  }}
                  className="w-24"
                />
                <span className="text-slate-500">min</span>
              </label>

              <button
                type="button"
                onClick={() => deactivateMutation.mutate(type.id)}
                disabled={disabled}
                className="rounded-md p-2 text-slate-500 transition hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label={`Remove ${type.name}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}

          <div className="flex flex-wrap items-end gap-3 rounded-lg border border-dashed border-slate-300 p-3">
            <div className="min-w-[12rem] flex-1">
              <FieldLabel>New break type</FieldLabel>
              <TextInput
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                placeholder="e.g. Prayer"
                disabled={disabled}
              />
            </div>
            <div>
              <FieldLabel>Pay</FieldLabel>
              <SegmentedControl
                size="sm"
                ariaLabel="New break type pay treatment"
                disabled={disabled}
                value={draftPaid ? 'paid' : 'unpaid'}
                onChange={(value) => setDraftPaid(value === 'paid')}
                options={[
                  { value: 'paid', label: 'Paid', tone: 'success' },
                  { value: 'unpaid', label: 'Unpaid', tone: 'neutral' },
                ]}
              />
            </div>
            <div className="w-28">
              <FieldLabel>Limit</FieldLabel>
              <TextInput
                type="number"
                min={1}
                max={1440}
                value={draftLimit}
                onChange={(event) => setDraftLimit(event.target.value)}
                placeholder="None"
                disabled={disabled}
              />
            </div>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={disabled || !draftName.trim() || createMutation.isPending}
              loading={createMutation.isPending}
            >
              Add
            </Button>
          </div>
        </div>
      )}
    </SettingsCard>
  );
}
