import { useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import Button from '@/components/ui/Button';
import SettingsCard from '../../components/SettingsCard';
import SegmentedControl from '../../components/SegmentedControl';
import { usePolicyCrud } from '../../workingTime/usePolicyCrud';
import {
  ORDINAL_CHOICES,
  WEEKDAYS,
  createEmptyWeeklyOffDraft,
  describeWeeklyOffPolicy,
  describeWeeklyOffRule,
  normalizeDayRules,
  ordinalLabel,
  setDayRule,
  toggleOrdinal,
  validateWeeklyOffDraft,
  weekdayOccurrencesInMonth,
  weeklyOffDraftToPayload,
  type IsoDay,
  type WeeklyOffDraft,
  type WeeklyOffRule,
  type WeeklyOffRuleMode,
} from '../../workingTime/weeklyOff';
import { weeklyOffPolicyApi, type WeeklyOffPolicySummary } from '@/services/workingTimeApi';
import { EmptyPolicies, PolicyEditor, PolicyIdentityFields, PolicyRow, PreviewStrip } from './PolicyShell';

const MODE_OPTIONS: Array<{ value: WeeklyOffRuleMode; label: string }> = [
  { value: 'every', label: 'Every week' },
  { value: 'ordinals', label: 'Picked weeks' },
  { value: 'alternate', label: 'Alternate' },
];

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const ruleForMode = (mode: WeeklyOffRuleMode, previous: WeeklyOffRule | undefined): WeeklyOffRule => {
  if (mode === 'every') {
    return { mode: 'every' };
  }
  if (mode === 'ordinals') {
    return {
      mode: 'ordinals',
      ordinals: previous?.mode === 'ordinals' ? previous.ordinals : [],
    };
  }
  return {
    mode: 'alternate',
    interval_weeks: previous?.mode === 'alternate' ? previous.interval_weeks : 2,
    anchor_date: previous?.mode === 'alternate' ? previous.anchor_date : null,
  };
};

const draftFromPolicy = (policy: WeeklyOffPolicySummary): WeeklyOffDraft => ({
  name: policy.name ?? '',
  description: policy.description ?? '',
  day_rules: normalizeDayRules(policy.day_rules),
  is_default: Boolean(policy.is_default),
  is_active: policy.is_active ?? true,
});

/**
 * Which days are off, including the alternate-Saturday patterns that seven
 * checkboxes cannot say.
 *
 * The editor's whole job is to make "2nd and 4th Saturday" unambiguous, so the
 * preview is a CALENDAR, not a sentence: every Saturday in the month it is
 * showing, with its ordinal, marked off or working. A sentence can be read two
 * ways; "Sat 8 Aug — off" cannot.
 *
 * The two patterns look alike and are not. Picked weeks counts inside the
 * calendar month and resets every month; Alternate counts continuously from an
 * anchor date and drifts past the month boundary. The preview shows two months
 * side by side for exactly that reason — the difference only becomes visible
 * in the second one.
 */
export default function WeeklyOffSection() {
  const crud = usePolicyCrud<WeeklyOffPolicySummary, WeeklyOffDraft>({
    endpoints: weeklyOffPolicyApi,
    emptyDraft: createEmptyWeeklyOffDraft,
    draftFrom: draftFromPolicy,
    toPayload: weeklyOffDraftToPayload,
    validate: validateWeeklyOffDraft,
    label: 'Weekly off policy',
  });

  const today = new Date();
  const [cursor, setCursor] = useState({
    year: today.getFullYear(),
    month: today.getMonth() + 1,
  });

  const { draft, setDraft } = crud;
  const configuredDays = useMemo(
    () => WEEKDAYS.filter((day) => draft.day_rules[day.iso]),
    [draft.day_rules]
  );

  const shiftMonth = (delta: number) => {
    setCursor((current) => {
      const index = current.year * 12 + (current.month - 1) + delta;
      return { year: Math.floor(index / 12), month: (index % 12) + 1 };
    });
  };

  const nextMonth = (() => {
    const index = cursor.year * 12 + (cursor.month - 1) + 1;
    return { year: Math.floor(index / 12), month: (index % 12) + 1 };
  })();

  if (crud.isLoading) {
    return <div className="h-24 animate-pulse rounded-xl bg-surface-sunken" />;
  }

  return (
    <SettingsCard
      title="Weekly off"
      description="Which days are off, and how often. A weekly off is what makes overtime count as weekly-off overtime and what a weekend premium is paid against, so it is not only a calendar decoration."
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
          title={crud.editingId === 'new' ? 'New weekly off policy' : 'Edit weekly off policy'}
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
          </div>

          <div className="mt-4">
            <p className="mb-1.5 text-xs font-medium text-slate-700">Days off</p>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map((day) => {
                const isOn = Boolean(draft.day_rules[day.iso]);
                return (
                  <button
                    key={day.iso}
                    type="button"
                    aria-pressed={isOn}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        day_rules: setDayRule(
                          draft.day_rules,
                          day.iso,
                          isOn ? null : { mode: 'every' }
                        ),
                      })
                    }
                    className={
                      isOn
                        ? 'rounded-lg border border-blue-500 bg-blue-600 px-3 py-1.5 text-xs font-semibold text-on-brand'
                        : 'rounded-lg border border-slate-300 bg-surface-card px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-blue-400'
                    }
                  >
                    {day.short}
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-xs text-slate-500">
              A day not picked here is a working day. Nothing is off by default.
            </p>
          </div>

          {configuredDays.map((day) => {
            const rule = draft.day_rules[day.iso] as WeeklyOffRule;
            return (
              <div
                key={day.iso}
                className="mt-3 rounded-lg border border-slate-200 bg-surface-card p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-900">{day.label}</p>
                  <SegmentedControl
                    size="sm"
                    ariaLabel={`How often ${day.label} is off`}
                    value={rule.mode}
                    onChange={(mode) =>
                      setDraft({
                        ...draft,
                        day_rules: setDayRule(
                          draft.day_rules,
                          day.iso,
                          ruleForMode(mode as WeeklyOffRuleMode, rule)
                        ),
                      })
                    }
                    options={MODE_OPTIONS}
                  />
                </div>

                {rule.mode === 'ordinals' ? (
                  <div className="mt-2.5">
                    <div className="flex flex-wrap gap-1.5">
                      {ORDINAL_CHOICES.map((ordinal) => {
                        const isOn = rule.ordinals.some((value) => value === ordinal);
                        return (
                          <button
                            key={String(ordinal)}
                            type="button"
                            aria-pressed={isOn}
                            onClick={() =>
                              setDraft({
                                ...draft,
                                day_rules: setDayRule(draft.day_rules, day.iso, {
                                  mode: 'ordinals',
                                  ordinals: toggleOrdinal(rule.ordinals, ordinal),
                                }),
                              })
                            }
                            className={
                              isOn
                                ? 'rounded-lg border border-blue-500 bg-blue-600 px-2.5 py-1 text-xs font-semibold text-on-brand'
                                : 'rounded-lg border border-slate-300 bg-surface-card px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:border-blue-400'
                            }
                          >
                            {ordinalLabel(ordinal)}
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-1.5 text-xs text-slate-500">
                      Counted inside the calendar month, and it starts again each month. The last
                      option means the final {day.label} of the month, which is not the same as the
                      5th — some months have no 5th at all.
                    </p>
                  </div>
                ) : null}

                {rule.mode === 'alternate' ? (
                  <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
                    <div>
                      <label
                        className="mb-1 block text-xs font-medium text-slate-700"
                        htmlFor={`interval-${day.iso}`}
                      >
                        Every
                      </label>
                      <select
                        id={`interval-${day.iso}`}
                        value={String(rule.interval_weeks)}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            day_rules: setDayRule(draft.day_rules, day.iso, {
                              ...rule,
                              interval_weeks: Number(event.target.value),
                            }),
                          })
                        }
                        className="w-full rounded-lg border border-slate-300 bg-surface-card px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                      >
                        <option value="2">2nd {day.label}</option>
                        <option value="3">3rd {day.label}</option>
                        <option value="4">4th {day.label}</option>
                      </select>
                    </div>
                    <div>
                      <label
                        className="mb-1 block text-xs font-medium text-slate-700"
                        htmlFor={`anchor-${day.iso}`}
                      >
                        First one that is off
                      </label>
                      <input
                        id={`anchor-${day.iso}`}
                        type="date"
                        value={rule.anchor_date ?? ''}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            day_rules: setDayRule(draft.day_rules, day.iso, {
                              ...rule,
                              anchor_date: event.target.value || null,
                            }),
                          })
                        }
                        className="w-full rounded-lg border border-slate-300 bg-surface-card px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                      />
                    </div>
                    <p className="text-xs text-slate-500 sm:col-span-2">
                      Counted continuously from that date, so it does not reset at the end of the
                      month. Without it the count has nothing to start from and this day is never
                      off.
                    </p>
                  </div>
                ) : null}

                <p className="mt-2 text-xs font-medium text-slate-700">
                  {describeWeeklyOffRule(day.iso, rule)}
                </p>
              </div>
            );
          })}

          {crud.errors.day_rules ? (
            <p className="mt-2 text-xs text-red-600">{crud.errors.day_rules}</p>
          ) : null}

          {/*
            The preview is the point of this editor. Two months, because the
            difference between a month-ordinal rule and an alternate one is
            invisible in the first one and obvious in the second.
          */}
          <PreviewStrip>
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 font-medium text-slate-700">
                <CalendarDays className="h-4 w-4" />
                Which days are actually off
              </span>
              <span className="inline-flex items-center gap-1">
                <button
                  type="button"
                  aria-label="Previous month"
                  onClick={() => shiftMonth(-1)}
                  className="rounded-md p-1 text-slate-500 transition hover:text-slate-900"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label="Next month"
                  onClick={() => shiftMonth(1)}
                  className="rounded-md p-1 text-slate-500 transition hover:text-slate-900"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </span>
            </div>

            {configuredDays.length === 0 ? (
              <p>Nothing is off yet, so every day is a working day.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {[cursor, nextMonth].map((month) => (
                  <div key={`${month.year}-${month.month}`}>
                    <p className="mb-1 font-medium text-slate-700">
                      {MONTH_NAMES[month.month - 1]} {month.year}
                    </p>
                    {configuredDays.map((day) => (
                      <div key={day.iso} className="mb-1.5">
                        <p className="text-slate-500">{day.label}</p>
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          {weekdayOccurrencesInMonth(
                            draft.day_rules,
                            day.iso as IsoDay,
                            month.year,
                            month.month
                          ).map((occurrence) => (
                            <span
                              key={occurrence.date}
                              title={`${occurrence.date} — the ${ordinalLabel(occurrence.ordinal)} ${day.label}${occurrence.isLast ? ', and the last' : ''}`}
                              className={
                                occurrence.isOff
                                  ? 'rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700'
                                  : 'rounded border border-slate-200 px-1.5 py-0.5 text-[11px] text-slate-500'
                              }
                            >
                              {Number(occurrence.date.slice(8, 10))}
                              {occurrence.isOff ? ' off' : ''}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </PreviewStrip>
        </PolicyEditor>
      ) : null}

      {crud.policies.length === 0 ? (
        <EmptyPolicies>
          No weekly off policy yet. Until one exists, Saturday and Sunday are assumed off wherever
          a weekend premium or weekly-off overtime has to be decided.
        </EmptyPolicies>
      ) : (
        <div className="space-y-2">
          {crud.policies.map((policy) => (
            <PolicyRow
              key={policy.id}
              name={policy.name}
              summary={describeWeeklyOffPolicy(normalizeDayRules(policy.day_rules))}
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
