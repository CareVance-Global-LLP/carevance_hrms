import { useState } from 'react';
import { Moon, Plus } from 'lucide-react';
import Button from '@/components/ui/Button';
import SettingsCard from '../../components/SettingsCard';
import SegmentedControl from '../../components/SegmentedControl';
import { usePolicyCrud } from '../../workingTime/usePolicyCrud';
import {
  ALLOWANCE_TYPE_OPTIONS,
  createEmptyShiftAllowanceDraft,
  describeShiftAllowancePolicy,
  previewShiftAllowance,
  shiftAllowanceDraftToPayload,
  toHHMM,
  validateShiftAllowanceDraft,
  type AllowanceType,
  type ShiftAllowanceDraft,
} from '../../workingTime/shiftAllowance';
import { formatSpanMinutes } from '../../shiftForm';
import {
  shiftAllowancePolicyApi,
  type ShiftAllowancePolicySummary,
} from '@/services/workingTimeApi';
import { EmptyPolicies, PolicyEditor, PolicyIdentityFields, PolicyRow, PreviewStrip } from './PolicyShell';

const draftFromPolicy = (policy: ShiftAllowancePolicySummary): ShiftAllowanceDraft => ({
  name: policy.name ?? '',
  description: policy.description ?? '',
  night_allowance_type: policy.night_allowance_type ?? 'none',
  night_percentage: String(policy.night_percentage ?? '0'),
  night_fixed: String(policy.night_fixed ?? '0'),
  night_window_start: toHHMM(policy.night_window_start) ?? '',
  night_window_end: toHHMM(policy.night_window_end) ?? '',
  night_minimum_minutes_in_window: String(policy.night_minimum_minutes_in_window ?? 0),
  weekend_allowance_type: policy.weekend_allowance_type ?? 'none',
  weekend_percentage: String(policy.weekend_percentage ?? '0'),
  weekend_fixed: String(policy.weekend_fixed ?? '0'),
  is_default: Boolean(policy.is_default),
  is_active: policy.is_active ?? true,
});

/**
 * The night and weekend premium.
 *
 * The editor is built around one fact people get wrong: the premium is earned
 * by the OVERLAP between the shift and the night window, not by a shift being
 * called a night shift. So the preview takes an example shift and reports the
 * overlap in minutes, and says out loud when four hours of night falls under a
 * five-hour minimum — because "some night, not enough" and "no night" are
 * different answers with the same payout.
 *
 * A percentage premium with no salary to apply it to shows its rate and no
 * amount. Zero would be a lie in the other direction: the premium is earned,
 * and only whoever holds the salary structure can say what it bites on.
 */
export default function ShiftAllowanceSection() {
  const crud = usePolicyCrud<ShiftAllowancePolicySummary, ShiftAllowanceDraft>({
    endpoints: shiftAllowancePolicyApi,
    emptyDraft: createEmptyShiftAllowanceDraft,
    draftFrom: draftFromPolicy,
    toPayload: shiftAllowanceDraftToPayload,
    validate: validateShiftAllowanceDraft,
    label: 'Shift allowance policy',
  });

  const { draft, setDraft } = crud;

  const [example, setExample] = useState({
    shiftStart: '18:00',
    shiftEnd: '02:00',
    isWeeklyOff: false,
    baseAmount: '',
  });

  const preview = previewShiftAllowance(draft, example);

  if (crud.isLoading) {
    return <div className="h-24 animate-pulse rounded-xl bg-surface-sunken" />;
  }

  const premiumFields = (
    kind: 'night' | 'weekend',
    type: AllowanceType,
    percentage: string,
    fixed: string
  ) => (
    <>
      <div>
        <p className="mb-1 text-xs font-medium text-slate-700">
          {kind === 'night' ? 'Night premium' : 'Weekend premium'}
        </p>
        <SegmentedControl
          size="sm"
          ariaLabel={`${kind === 'night' ? 'Night' : 'Weekend'} premium type`}
          value={type}
          onChange={(value) =>
            setDraft({ ...draft, [`${kind}_allowance_type`]: value as AllowanceType })
          }
          options={ALLOWANCE_TYPE_OPTIONS.map((option) => ({ ...option }))}
        />
      </div>

      {type === 'percentage' ? (
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700" htmlFor={`${kind}-percentage`}>
            Percentage
            <span className="ml-1 font-normal text-slate-500">of the base it is paid on</span>
          </label>
          <input
            id={`${kind}-percentage`}
            type="number"
            min={0}
            step="0.5"
            value={percentage}
            onChange={(event) => setDraft({ ...draft, [`${kind}_percentage`]: event.target.value })}
            className="w-full rounded-lg border border-slate-300 bg-surface-card px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
          />
          {crud.errors[`${kind}_percentage`] ? (
            <p className="mt-1 text-xs text-red-600">{crud.errors[`${kind}_percentage`]}</p>
          ) : null}
        </div>
      ) : null}

      {type === 'fixed' ? (
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700" htmlFor={`${kind}-fixed`}>
            Amount
            <span className="ml-1 font-normal text-slate-500">per qualifying day</span>
          </label>
          <input
            id={`${kind}-fixed`}
            type="number"
            min={0}
            step="0.01"
            value={fixed}
            onChange={(event) => setDraft({ ...draft, [`${kind}_fixed`]: event.target.value })}
            className="w-full rounded-lg border border-slate-300 bg-surface-card px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
          />
          {crud.errors[`${kind}_fixed`] ? (
            <p className="mt-1 text-xs text-red-600">{crud.errors[`${kind}_fixed`]}</p>
          ) : null}
        </div>
      ) : (
        <div />
      )}
    </>
  );

  return (
    <SettingsCard
      title="Shift allowance"
      description="The night and weekend premium. Night is a window of the clock, not a label on a shift — a shift earns the premium by overlapping it."
      aside={
        crud.editingId === null ? (
          <Button size="sm" iconLeft={<Plus className="h-4 w-4" />} onClick={() => crud.openEditor(null)}>
            New policy
          </Button>
        ) : null
      }
    >
      {crud.error ? <p className="mb-3 text-xs text-red-600">{crud.error}</p> : null}

      {crud.editingId !== null ? (
        <PolicyEditor
          title={crud.editingId === 'new' ? 'New shift allowance policy' : 'Edit shift allowance policy'}
          onClose={crud.closeEditor}
          onCancel={crud.closeEditor}
          onSave={crud.save}
          isSaving={crud.isSaving}
          saveLabel={crud.editingId === 'new' ? 'Create policy' : 'Save changes'}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <PolicyIdentityFields
              name={draft.name}
              description={draft.description}
              isDefault={draft.is_default}
              isActive={draft.is_active}
              nameError={crud.errors.name}
              defaultHint="Use for anyone without a policy of their own"
              onChange={(patch) => setDraft({ ...draft, ...patch })}
            />

            {premiumFields(
              'night',
              draft.night_allowance_type,
              draft.night_percentage,
              draft.night_fixed
            )}

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700" htmlFor="night-window-start">
                Night starts
              </label>
              <input
                id="night-window-start"
                type="time"
                value={draft.night_window_start}
                onChange={(event) => setDraft({ ...draft, night_window_start: event.target.value })}
                className="w-full rounded-lg border border-slate-300 bg-surface-card px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
              />
              {crud.errors.night_window_start ? (
                <p className="mt-1 text-xs text-red-600">{crud.errors.night_window_start}</p>
              ) : null}
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700" htmlFor="night-window-end">
                Night ends
              </label>
              <input
                id="night-window-end"
                type="time"
                value={draft.night_window_end}
                onChange={(event) => setDraft({ ...draft, night_window_end: event.target.value })}
                className="w-full rounded-lg border border-slate-300 bg-surface-card px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
              />
              {crud.errors.night_window_end ? (
                <p className="mt-1 text-xs text-red-600">{crud.errors.night_window_end}</p>
              ) : null}
            </div>

            <div className="sm:col-span-2">
              <label
                className="mb-1 block text-xs font-medium text-slate-700"
                htmlFor="night-minimum"
              >
                Minimum inside the window
                <span className="ml-1 font-normal text-slate-500">
                  minutes before the premium is earned
                </span>
              </label>
              <input
                id="night-minimum"
                type="number"
                min={0}
                max={1440}
                value={draft.night_minimum_minutes_in_window}
                onChange={(event) =>
                  setDraft({ ...draft, night_minimum_minutes_in_window: event.target.value })
                }
                className="w-full rounded-lg border border-slate-300 bg-surface-card px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
              />
              {crud.errors.night_minimum_minutes_in_window ? (
                <p className="mt-1 text-xs text-red-600">
                  {crud.errors.night_minimum_minutes_in_window}
                </p>
              ) : null}
              <p className="mt-1 text-xs text-slate-500">
                Zero still means at least one minute inside the window. Leaving both window times
                empty makes the whole shift count as night.
              </p>
            </div>

            {premiumFields(
              'weekend',
              draft.weekend_allowance_type,
              draft.weekend_percentage,
              draft.weekend_fixed
            )}

            <p className="text-xs text-slate-500 sm:col-span-2">
              Weekend means a day the employee&apos;s own weekly-off policy makes off — a
              Tuesday-off workplace pays this on a Tuesday. With no weekly-off policy it falls back
              to Saturday and Sunday.
            </p>
          </div>

          <PreviewStrip>
            <div className="flex flex-wrap items-end gap-2">
              <span className="inline-flex items-center gap-1.5 font-medium text-slate-700">
                <Moon className="h-4 w-4" />
                A shift from
              </span>
              <input
                type="time"
                aria-label="Example shift start"
                value={example.shiftStart}
                onChange={(event) => setExample({ ...example, shiftStart: event.target.value })}
                className="rounded-md border border-slate-300 bg-surface-card px-2 py-1 text-xs text-slate-900"
              />
              to
              <input
                type="time"
                aria-label="Example shift end"
                value={example.shiftEnd}
                onChange={(event) => setExample({ ...example, shiftEnd: event.target.value })}
                className="rounded-md border border-slate-300 bg-surface-card px-2 py-1 text-xs text-slate-900"
              />
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={example.isWeeklyOff}
                  onChange={(event) => setExample({ ...example, isWeeklyOff: event.target.checked })}
                  className="h-3.5 w-3.5 rounded border-slate-300"
                />
                on a weekly off
              </label>
              <label className="flex items-center gap-1">
                base
                <input
                  type="number"
                  min={0}
                  aria-label="Example base amount the percentage applies to"
                  value={example.baseAmount}
                  onChange={(event) => setExample({ ...example, baseAmount: event.target.value })}
                  placeholder="optional"
                  className="w-28 rounded-md border border-slate-300 bg-surface-card px-2 py-1 text-xs text-slate-900"
                />
              </label>
            </div>

            <p>
              {preview.nightMinutesInWindow === null
                ? 'Set both ends of the example shift.'
                : `${formatSpanMinutes(preview.nightMinutesInWindow)} of this shift falls inside the night window.`}
            </p>

            <ul className="space-y-1">
              {preview.lines.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>

            <p className="pt-1 font-medium text-slate-900">
              {preview.totalAmount === null
                ? `Pays ${preview.nightApplies ? `${preview.nightRate}%` : 'nothing'}`
                  + `${preview.weekendApplies ? ` plus the weekend premium` : ''}`
                  + ' — enter a base amount to see it in money.'
                : `Pays ${preview.totalAmount} for this day.`}
            </p>
          </PreviewStrip>
        </PolicyEditor>
      ) : null}

      {crud.policies.length === 0 ? (
        <EmptyPolicies>
          No shift allowance policy yet. Until one exists, the shift&apos;s own differential
          columns are what pay a night or weekend premium.
        </EmptyPolicies>
      ) : (
        <div className="space-y-2">
          {crud.policies.map((policy) => (
            <PolicyRow
              key={policy.id}
              name={policy.name}
              summary={describeShiftAllowancePolicy(policy)}
              isDefault={Boolean(policy.is_default)}
              isActive={policy.is_active}
              assignedCount={policy.assigned_count}
              onEdit={() => crud.openEditor(policy)}
              onDelete={() => crud.remove(policy)}
            />
          ))}
        </div>
      )}
    </SettingsCard>
  );
}
