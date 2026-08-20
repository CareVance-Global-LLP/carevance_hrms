import { useState } from 'react';
import { Calculator, Plus, Trash2 } from 'lucide-react';
import Button from '@/components/ui/Button';
import SettingsCard from '../../components/SettingsCard';
import SegmentedControl from '../../components/SegmentedControl';
import { usePolicyCrud } from '../../workingTime/usePolicyCrud';
import {
  OVERTIME_BASIS_OPTIONS,
  OVERTIME_SCOPES,
  ROUNDING_OPTIONS,
  TREATMENT_OPTIONS,
  createEmptyOvertimeDraft,
  createOvertimeScopeRow,
  describeOvertimePolicy,
  formatMultiplier,
  overtimeDraftToPayload,
  previewOvertime,
  scopeRowsFor,
  validateOvertimeDraft,
  type OvertimeBasis,
  type OvertimeDraft,
  type OvertimeRounding,
  type OvertimeScope,
  type OvertimeScopeDraft,
  type OvertimeTreatment,
} from '../../workingTime/overtime';
import { overtimePolicyApi, type OvertimePolicySummary } from '@/services/workingTimeApi';
import { EmptyPolicies, PolicyEditor, PolicyIdentityFields, PolicyRow, PreviewStrip } from './PolicyShell';

const draftFromPolicy = (policy: OvertimePolicySummary): OvertimeDraft => ({
  name: policy.name ?? '',
  description: policy.description ?? '',
  hours_basis: policy.hours_basis ?? 'gross',
  minimum_minutes_before_accrual: String(policy.minimum_minutes_before_accrual ?? 0),
  rounding: policy.rounding ?? 'nearest',
  rounding_increment_minutes: String(policy.rounding_increment_minutes ?? 15),
  requires_approval: policy.requires_approval ?? true,
  pay_code: policy.pay_code ?? '',
  scopes: (policy.scopes ?? []).map((row) => ({
    scope: row.scope,
    treatment: row.treatment,
    multiplier: String(row.multiplier ?? '1.00'),
    applies_after_minutes: String(row.applies_after_minutes ?? 0),
    effective_from: row.effective_from ?? '',
    effective_to: row.effective_to ?? '',
  })),
  is_default: Boolean(policy.is_default),
  is_active: policy.is_active ?? true,
});

/**
 * Overtime: a basis, a threshold, a rounding rule, an approval gate, and three
 * independent scopes.
 *
 * The scopes are laid out as three cards rather than three rows of a table,
 * because they are three separate decisions — a workplace can pay time and a
 * half on a working day, bank comp-off on a weekly off, and pay double on a
 * holiday, and none of those follows from the others. A scope with no rate is
 * shown as exactly that, not as an implied 1x: the engine falls through to the
 * shift's own multiplier there, and pretending otherwise would hide the
 * fallback this policy layer exists to replace.
 *
 * Extra rates inside one scope are how an extended tier and a festive rate are
 * expressed — a second row with a higher "after" figure, or with a validity
 * window.
 */
export default function OvertimeSection() {
  const crud = usePolicyCrud<OvertimePolicySummary, OvertimeDraft>({
    endpoints: overtimePolicyApi,
    emptyDraft: createEmptyOvertimeDraft,
    draftFrom: draftFromPolicy,
    toPayload: overtimeDraftToPayload,
    validate: validateOvertimeDraft,
    label: 'Overtime policy',
  });

  const { draft, setDraft } = crud;

  const [example, setExample] = useState({
    scope: 'working_day' as OvertimeScope,
    workedMinutes: '578',
    expectedMinutes: '480',
    approved: true,
  });

  const preview = previewOvertime(draft, {
    scope: example.scope,
    workedMinutes: Number(example.workedMinutes || 0),
    expectedMinutes: Number(example.expectedMinutes || 0),
    approved: example.approved,
  });

  const patchScope = (index: number, patch: Partial<OvertimeScopeDraft>) => {
    const next = [...draft.scopes];
    next[index] = { ...next[index], ...patch };
    setDraft({ ...draft, scopes: next });
  };

  if (crud.isLoading) {
    return <div className="h-24 animate-pulse rounded-xl bg-surface-sunken" />;
  }

  return (
    <SettingsCard
      title="Overtime"
      description="What counts as overtime, and what it is worth. Working day, weekly off and holiday are separate decisions, and each can be paid or banked as comp-off."
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
          title={crud.editingId === 'new' ? 'New overtime policy' : 'Edit overtime policy'}
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

            <div>
              <p className="mb-1 text-xs font-medium text-slate-700">Measured on</p>
              <SegmentedControl
                size="sm"
                ariaLabel="Which clock overtime is measured on"
                value={draft.hours_basis}
                onChange={(value) => setDraft({ ...draft, hours_basis: value as OvertimeBasis })}
                options={OVERTIME_BASIS_OPTIONS.map((option) => ({ ...option }))}
              />
              <p className="mt-1 text-xs text-slate-500">
                Gross is clock-in to clock-out; effective takes the unpaid break out.
              </p>
            </div>

            <div>
              <label
                className="mb-1 block text-xs font-medium text-slate-700"
                htmlFor="ot-minimum"
              >
                Nothing accrues under
                <span className="ml-1 font-normal text-slate-500">minutes</span>
              </label>
              <input
                id="ot-minimum"
                type="number"
                min={0}
                max={1440}
                value={draft.minimum_minutes_before_accrual}
                onChange={(event) =>
                  setDraft({ ...draft, minimum_minutes_before_accrual: event.target.value })
                }
                className="w-full rounded-lg border border-slate-300 bg-surface-card px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
              />
              {crud.errors.minimum_minutes_before_accrual ? (
                <p className="mt-1 text-xs text-red-600">
                  {crud.errors.minimum_minutes_before_accrual}
                </p>
              ) : null}
            </div>

            <div>
              <p className="mb-1 text-xs font-medium text-slate-700">Rounding</p>
              <SegmentedControl
                size="sm"
                ariaLabel="How overtime minutes are rounded"
                value={draft.rounding}
                onChange={(value) => setDraft({ ...draft, rounding: value as OvertimeRounding })}
                options={ROUNDING_OPTIONS.map((option) => ({ ...option }))}
              />
            </div>

            <div>
              <label
                className="mb-1 block text-xs font-medium text-slate-700"
                htmlFor="ot-increment"
              >
                Rounded to
                <span className="ml-1 font-normal text-slate-500">minutes</span>
              </label>
              <input
                id="ot-increment"
                type="number"
                min={1}
                max={240}
                value={draft.rounding_increment_minutes}
                onChange={(event) =>
                  setDraft({ ...draft, rounding_increment_minutes: event.target.value })
                }
                className="w-full rounded-lg border border-slate-300 bg-surface-card px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
              />
              {crud.errors.rounding_increment_minutes ? (
                <p className="mt-1 text-xs text-red-600">{crud.errors.rounding_increment_minutes}</p>
              ) : null}
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700" htmlFor="ot-pay-code">
                Pay code
                <span className="ml-1 font-normal text-slate-500">optional</span>
              </label>
              <input
                id="ot-pay-code"
                value={draft.pay_code}
                onChange={(event) => setDraft({ ...draft, pay_code: event.target.value })}
                placeholder="The payroll component overtime is paid through"
                className="w-full rounded-lg border border-slate-300 bg-surface-card px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
              />
              {crud.errors.pay_code ? (
                <p className="mt-1 text-xs text-red-600">{crud.errors.pay_code}</p>
              ) : null}
            </div>

            <label className="flex items-center gap-2 text-xs text-slate-700 sm:col-span-2">
              <input
                type="checkbox"
                checked={draft.requires_approval}
                onChange={(event) => setDraft({ ...draft, requires_approval: event.target.checked })}
                className="h-4 w-4 rounded border-slate-300"
              />
              Only approved hours count
            </label>
          </div>

          <div className="mt-4 space-y-3">
            {OVERTIME_SCOPES.map((scope) => {
              const rows = draft.scopes
                .map((row, index) => ({ row, index }))
                .filter((entry) => entry.row.scope === scope.value);

              return (
                <div key={scope.value} className="rounded-lg border border-slate-200 bg-surface-card p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{scope.label}</p>
                      <p className="mt-0.5 text-xs text-slate-600">{scope.hint}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      iconLeft={<Plus className="h-4 w-4" />}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          scopes: [...draft.scopes, createOvertimeScopeRow(scope.value)],
                        })
                      }
                    >
                      Add rate
                    </Button>
                  </div>

                  {rows.length === 0 ? (
                    <p className="mt-2 text-xs text-slate-500">
                      No rate. Overtime on this kind of day falls back to the shift&apos;s own
                      multiplier, or 1x when it has none.
                    </p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {rows.map(({ row, index }) => (
                        <div
                          key={index}
                          className="grid items-end gap-2 rounded-lg border border-slate-200 p-2 sm:grid-cols-5"
                        >
                          <div>
                            <label className="mb-1 block text-xs font-medium text-slate-700">
                              Treated as
                            </label>
                            <SegmentedControl
                              size="sm"
                              ariaLabel={`How ${scope.label} overtime is treated`}
                              value={row.treatment}
                              onChange={(value) =>
                                patchScope(index, { treatment: value as OvertimeTreatment })
                              }
                              options={TREATMENT_OPTIONS.map((option) => ({ ...option }))}
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-medium text-slate-700">
                              Multiplier
                            </label>
                            <input
                              type="number"
                              min={0}
                              step="0.25"
                              value={row.multiplier}
                              onChange={(event) => patchScope(index, { multiplier: event.target.value })}
                              className="w-full rounded-lg border border-slate-300 bg-surface-card px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-medium text-slate-700">
                              Applies after
                              <span className="ml-1 font-normal text-slate-500">min</span>
                            </label>
                            <input
                              type="number"
                              min={0}
                              max={1440}
                              value={row.applies_after_minutes}
                              onChange={(event) =>
                                patchScope(index, { applies_after_minutes: event.target.value })
                              }
                              className="w-full rounded-lg border border-slate-300 bg-surface-card px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-medium text-slate-700">
                              In force from
                            </label>
                            <input
                              type="date"
                              value={row.effective_from}
                              onChange={(event) =>
                                patchScope(index, { effective_from: event.target.value })
                              }
                              className="w-full rounded-lg border border-slate-300 bg-surface-card px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                            />
                          </div>
                          <div className="flex items-end gap-2">
                            <div className="flex-1">
                              <label className="mb-1 block text-xs font-medium text-slate-700">
                                until
                              </label>
                              <input
                                type="date"
                                value={row.effective_to}
                                onChange={(event) =>
                                  patchScope(index, { effective_to: event.target.value })
                                }
                                className="w-full rounded-lg border border-slate-300 bg-surface-card px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                              />
                            </div>
                            <button
                              type="button"
                              aria-label={`Remove this ${scope.label} rate`}
                              onClick={() =>
                                setDraft({
                                  ...draft,
                                  scopes: draft.scopes.filter((_, at) => at !== index),
                                })
                              }
                              className="mb-1 rounded-md p-2 text-slate-500 transition hover:text-red-600"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                      {rows.length > 1 ? (
                        <p className="text-xs text-slate-500">
                          The highest rate the overtime has actually reached wins, so a second rate
                          with a higher &quot;applies after&quot; is an extended tier.
                        </p>
                      ) : null}
                    </div>
                  )}
                </div>
              );
            })}

            {crud.errors.scopes ? (
              <p className="text-xs text-red-600">{crud.errors.scopes}</p>
            ) : null}
          </div>

          <PreviewStrip>
            <div className="flex flex-wrap items-end gap-2">
              <span className="inline-flex items-center gap-1.5 font-medium text-slate-700">
                <Calculator className="h-4 w-4" />
                If somebody worked
              </span>
              <label className="flex items-center gap-1">
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
                against
                <input
                  type="number"
                  min={0}
                  aria-label="Minutes rostered in the example"
                  value={example.expectedMinutes}
                  onChange={(event) =>
                    setExample({ ...example, expectedMinutes: event.target.value })
                  }
                  className="w-20 rounded-md border border-slate-300 bg-surface-card px-2 py-1 text-xs text-slate-900"
                />
                min rostered on a
              </label>
              <select
                aria-label="Which kind of day the example is"
                value={example.scope}
                onChange={(event) =>
                  setExample({ ...example, scope: event.target.value as OvertimeScope })
                }
                className="rounded-md border border-slate-300 bg-surface-card px-2 py-1 text-xs text-slate-900"
              >
                {OVERTIME_SCOPES.map((scope) => (
                  <option key={scope.value} value={scope.value}>
                    {scope.label.toLowerCase()}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={example.approved}
                  onChange={(event) => setExample({ ...example, approved: event.target.checked })}
                  className="h-3.5 w-3.5 rounded border-slate-300"
                />
                approved
              </label>
            </div>

            <ul className="mt-1 space-y-1">
              {preview.lines.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>

            <p className="pt-1 font-medium text-slate-900">
              {preview.roundedMinutes === 0
                ? 'No overtime.'
                : `${preview.roundedMinutes} minutes at ${formatMultiplier(preview.multiplier)}`
                  + `${preview.treatment === 'comp_off' ? ' as comp-off' : ''}`
                  + `${preview.isPayable ? '.' : ', once approved.'}`}
            </p>
          </PreviewStrip>
        </PolicyEditor>
      ) : null}

      {crud.policies.length === 0 ? (
        <EmptyPolicies>
          No overtime policy yet. Until one exists, overtime is whatever the shift&apos;s own
          multiplier says, with no threshold, no rounding and no approval gate.
        </EmptyPolicies>
      ) : (
        <div className="space-y-2">
          {crud.policies.map((policy) => {
            const rates = OVERTIME_SCOPES.map((scope) => {
              const rows = scopeRowsFor(
                (policy.scopes ?? []).map((row) => ({
                  scope: row.scope,
                  treatment: row.treatment,
                  multiplier: String(row.multiplier),
                  applies_after_minutes: String(row.applies_after_minutes),
                  effective_from: row.effective_from ?? '',
                  effective_to: row.effective_to ?? '',
                })),
                scope.value
              );
              if (rows.length === 0) {
                return null;
              }
              return `${scope.label.toLowerCase()} ${rows
                .map((row) => formatMultiplier(row.multiplier) + (row.treatment === 'comp_off' ? ' comp-off' : ''))
                .join('/')}`;
            }).filter(Boolean);

            return (
              <PolicyRow
                key={policy.id}
                name={policy.name}
                summary={
                  <>
                    {describeOvertimePolicy(policy)}
                    {rates.length > 0 ? ` · ${rates.join(', ')}` : ' · no rates set'}
                  </>
                }
                isDefault={Boolean(policy.is_default)}
                isActive={policy.is_active}
                assignedCount={policy.assigned_count}
                onEdit={() => crud.openEditor(policy)}
                onDelete={() => crud.remove(policy)}
              />
            );
          })}
        </div>
      )}
    </SettingsCard>
  );
}
