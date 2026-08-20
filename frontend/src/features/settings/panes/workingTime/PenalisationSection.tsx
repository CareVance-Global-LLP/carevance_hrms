import { useState } from 'react';
import { Calculator, Plus, Trash2 } from 'lucide-react';
import Button from '@/components/ui/Button';
import SettingsCard from '../../components/SettingsCard';
import SegmentedControl from '../../components/SegmentedControl';
import { usePolicyCrud } from '../../workingTime/usePolicyCrud';
import {
  CYCLE_OPTIONS,
  HOURS_BASIS_OPTIONS,
  LATE_RULE_OPTIONS,
  createEmptyPenalisationDraft,
  createHalfDayRung,
  describePenalisationPolicy,
  penalisationDraftToPayload,
  previewPenalisation,
  sortLadder,
  validatePenalisationDraft,
  type PenalisationCycle,
  type PenalisationDraft,
  type HoursBasis,
  type LateRuleType,
} from '../../workingTime/penalisation';
import { penalisationPolicyApi, type PenalisationPolicySummary } from '@/services/workingTimeApi';
import { EmptyPolicies, PolicyEditor, PolicyIdentityFields, PolicyRow, PreviewStrip } from './PolicyShell';

const draftFromPolicy = (policy: PenalisationPolicySummary): PenalisationDraft => ({
  name: policy.name ?? '',
  description: policy.description ?? '',
  grace_period_minutes: String(policy.grace_period_minutes ?? 0),
  late_rule_type: policy.late_rule_type ?? 'incident',
  late_threshold: String(policy.late_threshold ?? '0'),
  exemptions_per_cycle: String(policy.exemptions_per_cycle ?? 0),
  cycle: policy.cycle ?? 'monthly',
  ignore_late_when_hours_met: Boolean(policy.ignore_late_when_hours_met),
  hours_basis: policy.hours_basis ?? 'effective',
  // Null means no no-show rule at all. Turning it into '0' here would switch a
  // rule on that the organization never configured.
  no_show_below_hours: policy.no_show_below_hours === null ? '' : String(policy.no_show_below_hours),
  treat_penalties_as_lop: Boolean(policy.treat_penalties_as_lop),
  half_day_rules: (policy.half_day_rules ?? []).map((rung) => ({
    percent: String(rung.percent_of_shift_hours ?? ''),
    leaves: String(rung.leaves_deducted ?? ''),
  })),
  is_default: Boolean(policy.is_default),
  is_active: policy.is_active ?? true,
});

const numberField = (
  label: string,
  value: string,
  onChange: (value: string) => void,
  options: { hint?: string; error?: string; min?: number; max?: number; step?: string } = {}
) => (
  <div>
    <label className="mb-1 block text-xs font-medium text-slate-700">
      {label}
      {options.hint ? <span className="ml-1 font-normal text-slate-500">{options.hint}</span> : null}
    </label>
    <input
      type="number"
      min={options.min ?? 0}
      max={options.max}
      step={options.step}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="w-full rounded-lg border border-slate-300 bg-surface-card px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
    />
    {options.error ? <p className="mt-1 text-xs text-red-600">{options.error}</p> : null}
  </div>
);

/**
 * Grace, late rules, and the half-day ladder.
 *
 * The ladder is the part no form field expresses: half-day is not a threshold
 * but an ordered set of bands, and the first band a day falls BELOW is the one
 * that applies. Two things follow, and both are enforced as you type — two
 * rungs at the same percent means the second can never fire, and leaves that
 * rise with the percent mean working more costs more.
 *
 * The worked example beside it is not decoration. Every number in a
 * penalisation policy interacts: grace decides whether the day is late, the
 * hours-met switch can waive that, the no-show bar outranks the ladder, and
 * the loss-of-pay switch decides whether the result comes off leave or off
 * pay. Typing four fields and seeing one sentence is the only way to know
 * which of them just changed the answer.
 */
export default function PenalisationSection() {
  const crud = usePolicyCrud<PenalisationPolicySummary, PenalisationDraft>({
    endpoints: penalisationPolicyApi,
    emptyDraft: createEmptyPenalisationDraft,
    draftFrom: draftFromPolicy,
    toPayload: penalisationDraftToPayload,
    validate: validatePenalisationDraft,
    label: 'Penalisation policy',
  });

  const { draft, setDraft } = crud;

  const [example, setExample] = useState({
    shiftMinutes: '480',
    workedMinutes: '210',
    lateMinutes: '25',
  });

  const preview = previewPenalisation(draft, {
    shiftMinutes: Number(example.shiftMinutes || 0),
    workedMinutes: Number(example.workedMinutes || 0),
    lateMinutes: Number(example.lateMinutes || 0),
  });

  if (crud.isLoading) {
    return <div className="h-24 animate-pulse rounded-xl bg-surface-sunken" />;
  }

  return (
    <SettingsCard
      title="Penalisation"
      description="What being late costs, and what a short day costs. Grace lives here rather than on the shift, so two teams on identical timings can run different rules without duplicating the shift."
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
          title={crud.editingId === 'new' ? 'New penalisation policy' : 'Edit penalisation policy'}
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

            {numberField(
              'Grace period',
              draft.grace_period_minutes,
              (value) => setDraft({ ...draft, grace_period_minutes: value }),
              {
                hint: 'minutes before a penalty starts',
                error: crud.errors.grace_period_minutes,
                max: 1440,
              }
            )}

            <div>
              <p className="mb-1 text-xs font-medium text-slate-700">Late rule counts</p>
              <SegmentedControl
                size="sm"
                ariaLabel="What the late rule counts"
                value={draft.late_rule_type}
                onChange={(value) => setDraft({ ...draft, late_rule_type: value as LateRuleType })}
                options={LATE_RULE_OPTIONS.map((option) => ({ ...option }))}
              />
            </div>

            {numberField(
              draft.late_rule_type === 'hours' ? 'Late hours a cycle' : 'Late arrivals a cycle',
              draft.late_threshold,
              (value) => setDraft({ ...draft, late_threshold: value }),
              { hint: 'before the penalty applies', error: crud.errors.late_threshold, step: '0.5' }
            )}

            {numberField(
              'Exemptions a cycle',
              draft.exemptions_per_cycle,
              (value) => setDraft({ ...draft, exemptions_per_cycle: value }),
              { hint: 'forgiven before counting', error: crud.errors.exemptions_per_cycle, max: 999 }
            )}

            <div>
              <p className="mb-1 text-xs font-medium text-slate-700">Cycle</p>
              <SegmentedControl
                size="sm"
                ariaLabel="Penalisation cycle"
                value={draft.cycle}
                onChange={(value) => setDraft({ ...draft, cycle: value as PenalisationCycle })}
                options={CYCLE_OPTIONS.map((option) => ({ ...option }))}
              />
            </div>

            <div>
              <p className="mb-1 text-xs font-medium text-slate-700">Hours read as</p>
              <SegmentedControl
                size="sm"
                ariaLabel="Which clock the hours rules read"
                value={draft.hours_basis}
                onChange={(value) => setDraft({ ...draft, hours_basis: value as HoursBasis })}
                options={HOURS_BASIS_OPTIONS.map((option) => ({ ...option }))}
              />
            </div>

            {numberField(
              'No-show below',
              draft.no_show_below_hours,
              (value) => setDraft({ ...draft, no_show_below_hours: value }),
              {
                hint: 'hours — leave blank to run no no-show rule',
                error: crud.errors.no_show_below_hours,
                max: 24,
                step: '0.5',
              }
            )}

            <div className="flex flex-col gap-2 sm:col-span-2">
              <label className="flex items-center gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={draft.ignore_late_when_hours_met}
                  onChange={(event) =>
                    setDraft({ ...draft, ignore_late_when_hours_met: event.target.checked })
                  }
                  className="h-4 w-4 rounded border-slate-300"
                />
                Ignore the late-arrival penalty when the day&apos;s hours are completed anyway
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={draft.treat_penalties_as_lop}
                  onChange={(event) =>
                    setDraft({ ...draft, treat_penalties_as_lop: event.target.checked })
                  }
                  className="h-4 w-4 rounded border-slate-300"
                />
                Treat penalties as loss of pay — deductions come off pay rather than the leave
                balance
              </label>
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-slate-200 bg-surface-card p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-slate-900">Half-day ladder</p>
                <p className="mt-0.5 text-xs text-slate-600">
                  Bands, read from the lowest up: the first band a day falls below is the one that
                  applies. Below 25% of the shift costs a full day, below 50% costs half.
                </p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                iconLeft={<Plus className="h-4 w-4" />}
                onClick={() =>
                  setDraft({ ...draft, half_day_rules: [...draft.half_day_rules, createHalfDayRung()] })
                }
              >
                Add band
              </Button>
            </div>

            {draft.half_day_rules.length === 0 ? (
              <p className="mt-2 text-xs text-slate-500">
                No bands, so a short day costs nothing on its own.
              </p>
            ) : (
              <div className="mt-3 space-y-2">
                {draft.half_day_rules.map((rung, index) => (
                  <div key={index} className="flex flex-wrap items-end gap-2">
                    <div className="w-32">
                      <label className="mb-1 block text-xs font-medium text-slate-700">
                        Worked under
                      </label>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={rung.percent}
                          onChange={(event) => {
                            const next = [...draft.half_day_rules];
                            next[index] = { ...rung, percent: event.target.value };
                            setDraft({ ...draft, half_day_rules: next });
                          }}
                          className="w-full rounded-lg border border-slate-300 bg-surface-card px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                        />
                        <span className="text-xs text-slate-600">%</span>
                      </div>
                    </div>
                    <div className="w-32">
                      <label className="mb-1 block text-xs font-medium text-slate-700">
                        Costs
                      </label>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min={0}
                          step="0.5"
                          value={rung.leaves}
                          onChange={(event) => {
                            const next = [...draft.half_day_rules];
                            next[index] = { ...rung, leaves: event.target.value };
                            setDraft({ ...draft, half_day_rules: next });
                          }}
                          className="w-full rounded-lg border border-slate-300 bg-surface-card px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                        />
                        <span className="text-xs text-slate-600">days</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      aria-label={`Remove band ${index + 1}`}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          half_day_rules: draft.half_day_rules.filter((_, at) => at !== index),
                        })
                      }
                      className="mb-1 rounded-md p-2 text-slate-500 transition hover:text-red-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <p className="text-xs text-slate-500">
                  Saved in ascending order whatever order they are typed in:{' '}
                  {sortLadder(draft.half_day_rules)
                    .map((rung) => `under ${rung.percent || '?'}% costs ${rung.leaves || '?'}`)
                    .join(', ')}
                  .
                </p>
              </div>
            )}

            {crud.errors.half_day_rules ? (
              <p className="mt-2 text-xs text-red-600">{crud.errors.half_day_rules}</p>
            ) : null}
          </div>

          {/*
            The worked example. Every field above interacts with every other
            one, and one sentence saying what a real day costs is the only way
            to see which change moved the answer.
          */}
          <PreviewStrip>
            <div className="flex flex-wrap items-end gap-2">
              <span className="inline-flex items-center gap-1.5 font-medium text-slate-700">
                <Calculator className="h-4 w-4" />
                If somebody
              </span>
              <label className="flex items-center gap-1">
                worked
                <input
                  type="number"
                  min={0}
                  aria-label="Minutes worked in the example"
                  value={example.workedMinutes}
                  onChange={(event) => setExample({ ...example, workedMinutes: event.target.value })}
                  className="w-20 rounded-md border border-slate-300 bg-surface-card px-2 py-1 text-xs text-slate-900"
                />
                min
              </label>
              <label className="flex items-center gap-1">
                of a
                <input
                  type="number"
                  min={0}
                  aria-label="Minutes the shift expects in the example"
                  value={example.shiftMinutes}
                  onChange={(event) => setExample({ ...example, shiftMinutes: event.target.value })}
                  className="w-20 rounded-md border border-slate-300 bg-surface-card px-2 py-1 text-xs text-slate-900"
                />
                min shift
              </label>
              <label className="flex items-center gap-1">
                arriving
                <input
                  type="number"
                  min={0}
                  aria-label="Minutes late in the example"
                  value={example.lateMinutes}
                  onChange={(event) => setExample({ ...example, lateMinutes: event.target.value })}
                  className="w-20 rounded-md border border-slate-300 bg-surface-card px-2 py-1 text-xs text-slate-900"
                />
                min late
              </label>
            </div>

            <ul className="mt-1 space-y-1">
              {preview.lines.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>

            <p className="pt-1 font-medium text-slate-900">
              Costs {preview.leavesDeducted} day
              {preview.deductedFrom === 'nothing' ? '' : ` from ${preview.deductedFrom}`}.
            </p>
          </PreviewStrip>
        </PolicyEditor>
      ) : null}

      {crud.policies.length === 0 ? (
        <EmptyPolicies>
          No penalisation policy yet. Until one exists, the shift&apos;s own grace period is what
          decides whether an arrival is late, and nothing deducts a half day.
        </EmptyPolicies>
      ) : (
        <div className="space-y-2">
          {crud.policies.map((policy) => (
            <PolicyRow
              key={policy.id}
              name={policy.name}
              summary={
                <>
                  {describePenalisationPolicy(policy)}
                  {policy.half_day_rules && policy.half_day_rules.length > 0
                    ? ` · ${policy.half_day_rules.length} half-day band${policy.half_day_rules.length === 1 ? '' : 's'}`
                    : ''}
                  {policy.treat_penalties_as_lop ? ' · penalties are loss of pay' : ''}
                </>
              }
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
