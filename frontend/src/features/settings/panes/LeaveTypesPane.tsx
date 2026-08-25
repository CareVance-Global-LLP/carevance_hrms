import { useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarRange, Plus } from 'lucide-react';
import { leaveTypeApi } from '@/services/api';
import type { LeaveAccrualTiming, LeaveType, LeaveYearEndAction } from '@/types';
import Button from '@/components/ui/Button';
import { FieldLabel, SelectInput, TextInput } from '@/components/ui/FormField';
import { PageLoadingState } from '@/components/ui/PageState';

/**
 * How each kind of leave is earned.
 *
 * Leave used to be a single annual number granted whole on day one, so somebody
 * joining in November received a full year of entitlement and somebody leaving
 * in February had none to encash. These are the settings that replace it.
 *
 * The screen states what each choice DOES rather than only naming it: an
 * accrual rate decides how much leave every employee earns, and leave encashes
 * into pay, so an admin changing one of these should not have to infer the
 * consequence from the label.
 */

const TIMING_LABEL: Record<LeaveAccrualTiming, string> = {
  period_start: 'At the start of each period',
  period_end: 'At the end of each period',
};

/**
 * What happens to what is left when the leave year closes.
 *
 * Encashment is the one that creates a payroll liability, so it is named as
 * paying rather than as a tidy-up.
 */
const YEAR_END_LABEL: Record<LeaveYearEndAction, string> = {
  carry_forward: 'Carry forward, up to the limit below',
  reset: 'Expire — the balance resets to zero',
  encash: 'Pay it out',
};

const FREQUENCY_LABEL: Record<LeaveType['accrual_frequency'], string> = {
  annual: 'All at once, at the start of the year',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  half_yearly: 'Twice a year',
};

export default function LeaveTypesPane() {
  const queryClient = useQueryClient();
  // One stable prefix per form, so every caption is tied to its control.
  // FieldLabel without htmlFor is decoration: a screen reader reaches the
  // field and announces "edit text, blank".
  const fieldId = useId();
  const [draft, setDraft] = useState<Partial<LeaveType> | null>(null);
  const [error, setError] = useState('');

  const query = useQuery({
    queryKey: ['leave-types'],
    queryFn: async () => (await leaveTypeApi.list()).data.data,
  });

  const save = useMutation({
    mutationFn: async (type: Partial<LeaveType>) =>
      type.id ? leaveTypeApi.update(type.id, type) : leaveTypeApi.create(type),
    onSuccess: () => {
      setDraft(null);
      setError('');
      queryClient.invalidateQueries({ queryKey: ['leave-types'] });
    },
    onError: (err: any) => setError(err?.response?.data?.message || 'Could not save this leave type.'),
  });

  const types = query.data ?? [];

  if (query.isLoading) {
    return <PageLoadingState label="Loading leave types..." />;
  }

  return (
    <div className="space-y-4">
      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      <div className="space-y-2">
        {types.map((type) => (
          <div key={type.id} className="rounded-lg border border-slate-200 bg-surface-card p-3">
            <div className="flex flex-wrap items-center gap-2">
              <CalendarRange className="h-4 w-4 shrink-0 text-slate-500" />
              <span className="font-medium text-slate-950">{type.name}</span>
              <span className="font-mono text-[11px] text-slate-500">{type.code}</span>
              {!type.is_active ? (
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                  Inactive
                </span>
              ) : null}
              <span className="ml-auto text-sm font-medium tabular-nums text-slate-900">
                {Number(type.annual_quota)} {Number(type.annual_quota) === 1 ? 'day' : 'days'}/year
              </span>
            </div>

            <p className="mt-1.5 text-xs text-slate-600">
              {FREQUENCY_LABEL[type.accrual_frequency]}
              {type.accrual_frequency !== 'annual' ? (
                <>
                  {' · '}
                  {/* Spelled out because it is the rule people get wrong: it
                      applies to the joining period only, not every period. */}
                  {type.pro_rate_on_join
                    ? `joins on or before the ${type.joining_cutoff_day}${ordinal(type.joining_cutoff_day)} earn that period`
                    : 'the joining period always accrues in full'}
                </>
              ) : null}
              {' · '}
              {type.year_end_action === 'encash'
                ? 'paid out at year end'
                : type.year_end_action === 'reset'
                  ? 'expires at year end'
                  : Number(type.carry_forward_cap) > 0
                    ? `carries up to ${Number(type.carry_forward_cap)} days`
                    : 'no carry-forward'}
              {type.notice_period_annual_quota != null
                ? ` · ${Number(type.notice_period_annual_quota)}/year on notice`
                : ''}
            </p>

            <div className="mt-2">
              <Button variant="secondary" size="sm" onClick={() => setDraft(type)}>
                Edit
              </Button>
            </div>
          </div>
        ))}
      </div>

      {draft ? (
        <form
          className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate(draft);
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <FieldLabel htmlFor={`${fieldId}-name`}>Name</FieldLabel>
              <TextInput
                id={`${fieldId}-name`}
                value={draft.name ?? ''}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                required
              />
            </div>

            <div>
              <FieldLabel htmlFor={`${fieldId}-code`}>Code</FieldLabel>
              <TextInput
                id={`${fieldId}-code`}
                value={draft.code ?? ''}
                placeholder="paid"
                // Immutable once created: existing leave requests and every
                // ledger row reference it, so renaming would orphan them.
                disabled={Boolean(draft.id)}
                onChange={(event) => setDraft({ ...draft, code: event.target.value.toLowerCase() })}
                required
              />
            </div>

            <div>
              <FieldLabel htmlFor={`${fieldId}-quota`}>Days per year</FieldLabel>
              <TextInput
                type="number"
                min="0"
                step="0.5"
                id={`${fieldId}-quota`}
                value={String(draft.annual_quota ?? '')}
                onChange={(event) => setDraft({ ...draft, annual_quota: event.target.value })}
              />
            </div>

            <div>
              <FieldLabel htmlFor={`${fieldId}-freq`}>Earned</FieldLabel>
              <SelectInput
                id={`${fieldId}-freq`}
                value={draft.accrual_frequency ?? 'annual'}
                onChange={(event) =>
                  setDraft({ ...draft, accrual_frequency: event.target.value as LeaveType['accrual_frequency'] })
                }
              >
                {(Object.keys(FREQUENCY_LABEL) as LeaveType['accrual_frequency'][]).map((value) => (
                  <option key={value} value={value}>
                    {FREQUENCY_LABEL[value]}
                  </option>
                ))}
              </SelectInput>
            </div>

            {draft.accrual_frequency && draft.accrual_frequency !== 'annual' ? (
              <div>
                <FieldLabel htmlFor={`${fieldId}-cutoff`}>Joining cut-off day</FieldLabel>
                <TextInput
                  type="number"
                  min="1"
                  max="28"
                  id={`${fieldId}-cutoff`}
                value={String(draft.joining_cutoff_day ?? 15)}
                  onChange={(event) => setDraft({ ...draft, joining_cutoff_day: Number(event.target.value) })}
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  Someone joining on or before this day earns that period in full; after it, nothing for that period.
                  {/* Capped at 28 server-side: a later day cannot occur in
                      February, so the policy would behave differently in one
                      month of the year. */}
                </p>
              </div>
            ) : null}


            {draft.accrual_frequency && draft.accrual_frequency !== 'annual' ? (
              <div>
                <FieldLabel htmlFor={`${fieldId}-timing`}>Credited</FieldLabel>
                <SelectInput
                  id={`${fieldId}-timing`}
                  value={draft.accrual_timing ?? 'period_start'}
                  onChange={(event) =>
                    setDraft({ ...draft, accrual_timing: event.target.value as LeaveType['accrual_timing'] })
                  }
                >
                  {(Object.keys(TIMING_LABEL) as LeaveAccrualTiming[]).map((value) => (
                    <option key={value} value={value}>
                      {TIMING_LABEL[value]}
                    </option>
                  ))}
                </SelectInput>
                <p className="mt-1 text-[11px] text-slate-500">
                  {/* The consequence, because the label alone does not carry it. */}
                  {draft.accrual_timing === 'period_end'
                    ? 'Somebody joining at the start of a period cannot take this leave until the period closes.'
                    : 'The days are available from the first day of each period.'}
                </p>
              </div>
            ) : null}

            <div>
              <FieldLabel htmlFor={`${fieldId}-yearend`}>At the end of the year</FieldLabel>
              <SelectInput
                id={`${fieldId}-yearend`}
                value={draft.year_end_action ?? 'carry_forward'}
                onChange={(event) =>
                  setDraft({ ...draft, year_end_action: event.target.value as LeaveType['year_end_action'] })
                }
              >
                {(Object.keys(YEAR_END_LABEL) as LeaveYearEndAction[]).map((value) => (
                  <option key={value} value={value}>
                    {YEAR_END_LABEL[value]}
                  </option>
                ))}
              </SelectInput>
              {draft.year_end_action === 'encash' && draft.is_encashable === false ? (
                <p className="mt-1 text-[11px] text-amber-700">
                  {/* A contradiction the server also refuses to honour — it
                      expires the balance rather than quietly creating a
                      payroll liability nobody agreed to. */}
                  This type is marked as not encashable, so the balance will expire instead. Tick “Can be encashed”
                  below to pay it out.
                </p>
              ) : null}
            </div>

            <div>
              <FieldLabel htmlFor={`${fieldId}-notice`}>Days per year while serving notice</FieldLabel>
              <TextInput
                id={`${fieldId}-notice`}
                type="number"
                min="0"
                step="0.5"
                placeholder="Same as everyone else"
                value={draft.notice_period_annual_quota == null ? '' : String(draft.notice_period_annual_quota)}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    notice_period_annual_quota: event.target.value === '' ? null : event.target.value,
                  })
                }
              />
              <p className="mt-1 text-[11px] text-slate-500">
                Leave blank to keep accruing normally. Set 0 to stop accrual once somebody resigns.
              </p>
            </div>

            <div>
              <FieldLabel htmlFor={`${fieldId}-carry`}>Carry forward limit</FieldLabel>
              <TextInput
                type="number"
                min="0"
                step="0.5"
                id={`${fieldId}-carry`}
                value={String(draft.carry_forward_cap ?? 0)}
                onChange={(event) => setDraft({ ...draft, carry_forward_cap: event.target.value })}
              />
              <p className="mt-1 text-[11px] text-slate-500">
                0 means unused days expire at the end of the leave year.
              </p>
            </div>

            <div>
              <FieldLabel htmlFor={`${fieldId}-probation`}>Days per year on probation</FieldLabel>
              <TextInput
                type="number"
                min="0"
                step="0.5"
                placeholder="Same as everyone else"
                id={`${fieldId}-probation`}
                value={draft.probation_annual_quota == null ? '' : String(draft.probation_annual_quota)}
                onChange={(event) =>
                  setDraft({ ...draft, probation_annual_quota: event.target.value === '' ? null : event.target.value })
                }
              />
              <p className="mt-1 text-[11px] text-slate-500">Leave blank to use the normal rate.</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-4">
            {([
              ['is_encashable', 'Can be encashed'],
              ['is_paid', 'Paid leave'],
              ['is_active', 'Active'],
            ] as const).map(([field, label]) => (
              <label key={field} className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={Boolean(draft[field] ?? (field !== 'is_encashable'))}
                  onChange={(event) => setDraft({ ...draft, [field]: event.target.checked })}
                />
                {label}
              </label>
            ))}
          </div>

          <div className="flex gap-2">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'Saving...' : 'Save leave type'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button
          variant="secondary"
          iconLeft={<Plus className="h-4 w-4" />}
          onClick={() => setDraft({ name: '', code: '', annual_quota: 0, accrual_frequency: 'annual', joining_cutoff_day: 15, is_active: true, is_paid: true })}
        >
          Add leave type
        </Button>
      )}
    </div>
  );
}

function ordinal(day: number): string {
  if (day > 3 && day < 21) return 'th';
  return ['th', 'st', 'nd', 'rd'][day % 10] ?? 'th';
}
