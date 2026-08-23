import { useId, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Plus, Star, Trash2 } from 'lucide-react';
import { legalEntityApi } from '@/services/api';
import type { EstablishmentType, LegalEntity } from '@/types';
import Button from '@/components/ui/Button';
import { FieldLabel, SelectInput, TextInput } from '@/components/ui/FormField';
import { PageLoadingState } from '@/components/ui/PageState';

/**
 * The companies inside this workspace.
 *
 * One organization used to mean one PAN, TAN and PF code, which cannot describe
 * a group running two to four entities. This is where those companies are
 * defined; whichever one an employee belongs to decides which statutory return
 * they appear on.
 *
 * The primary entity is load-bearing and is surfaced as such. Every employee
 * with no explicit entity files under it, which on day one is all of them — so
 * a screen that let somebody create entities without understanding that would
 * be actively dangerous.
 */
export default function LegalEntitiesPane() {
  const queryClient = useQueryClient();
  // One stable prefix per form, so every caption is tied to its control.
  // FieldLabel without htmlFor is decoration: a screen reader reaches the
  // field and announces "edit text, blank".
  const fieldId = useId();
  const [draft, setDraft] = useState<Partial<LegalEntity> | null>(null);
  const [error, setError] = useState('');

  const query = useQuery({
    queryKey: ['legal-entities'],
    queryFn: async () => (await legalEntityApi.list()).data,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['legal-entities'] });

  const save = useMutation({
    mutationFn: async (entity: Partial<LegalEntity>) =>
      entity.id ? legalEntityApi.update(entity.id, entity) : legalEntityApi.create(entity),
    onSuccess: () => {
      setDraft(null);
      setError('');
      invalidate();
    },
    onError: (err: any) => setError(err?.response?.data?.message || 'Could not save this entity.'),
  });

  const remove = useMutation({
    mutationFn: (id: number) => legalEntityApi.remove(id),
    onSuccess: () => {
      setError('');
      invalidate();
    },
    // The API refuses rather than orphaning employees onto a different PAN, and
    // its message names how many would have moved — so show it rather than a
    // generic failure.
    onError: (err: any) => setError(err?.response?.data?.message || 'Could not delete this entity.'),
  });

  const entities = query.data?.data ?? [];
  const unassigned = query.data?.unassigned_count ?? 0;
  const primary = useMemo(() => entities.find((entity) => entity.is_primary), [entities]);

  if (query.isLoading) {
    return <PageLoadingState label="Loading entities..." />;
  }

  return (
    <div className="space-y-4">
      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      {/*
        * Stated plainly rather than left to be discovered: everybody without an
        * explicit entity files under the primary, and on the day this ships
        * that is the entire company.
        */}
      {primary && unassigned > 0 ? (
        <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
          {unassigned} {unassigned === 1 ? 'person is' : 'people are'} not assigned to a specific entity, so they file
          under <span className="font-semibold">{primary.name}</span>.
        </p>
      ) : null}

      <div className="space-y-2">
        {entities.map((entity) => (
          <div key={entity.id} className="rounded-lg border border-slate-200 bg-surface-card p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Building2 className="h-4 w-4 shrink-0 text-slate-500" />
              <span className="font-medium text-slate-950">{entity.name}</span>
              {entity.is_primary ? (
                <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 ring-1 ring-amber-200">
                  <Star className="h-3 w-3" /> Primary
                </span>
              ) : null}
              <span className="ml-auto text-xs text-slate-500">
                {entity.users_count ?? 0} assigned
              </span>
            </div>

            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600 sm:grid-cols-4">
              {([
                ['PAN', entity.pan],
                ['TAN', entity.tan],
                ['PF code', entity.pf_establishment_code],
                ['ESI code', entity.esi_code],
              ] as const).map(([label, value]) => (
                <div key={label}>
                  <dt className="text-[10px] uppercase tracking-wide text-slate-400">{label}</dt>
                  {/* An absent identifier is called out, not left blank: a
                      filing generated without it reports "not configured"
                      rather than failing, so the gap is otherwise silent. */}
                  <dd className={value ? 'font-mono text-slate-800' : 'text-amber-700'}>
                    {value || 'Not set'}
                  </dd>
                </div>
              ))}
            </dl>

            <div className="mt-2 flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => setDraft(entity)}>
                Edit
              </Button>
              {!entity.is_primary ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => save.mutate({ id: entity.id, is_primary: true })}
                >
                  Make primary
                </Button>
              ) : null}
              {!entity.is_primary ? (
                <Button
                  variant="ghost"
                  size="sm"
                  iconLeft={<Trash2 className="h-4 w-4" />}
                  onClick={() => remove.mutate(entity.id)}
                  disabled={remove.isPending}
                >
                  Delete
                </Button>
              ) : null}
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
              <FieldLabel htmlFor={`${fieldId}-name`}>Entity name</FieldLabel>
              <TextInput
                id={`${fieldId}-name`}
                value={draft.name ?? ''}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                required
              />
            </div>
            {([
              ['pan', 'PAN', 'AAACT1234F'],
              ['tan', 'TAN', 'MUMT12345E'],
              ['pf_establishment_code', 'PF establishment code', 'MHBAN1234567000'],
              ['esi_code', 'ESI code', ''],
              ['state', 'State', 'Maharashtra'],
            ] as const).map(([field, label, placeholder]) => (
              <div key={field}>
                <FieldLabel htmlFor={`${fieldId}-${field}`}>{label}</FieldLabel>
                <TextInput
                  id={`${fieldId}-${field}`}
                  value={(draft[field] as string) ?? ''}
                  placeholder={placeholder}
                  onChange={(event) => setDraft({ ...draft, [field]: event.target.value })}
                />
              </div>
            ))}
          </div>


          {/*
            * Which statute the premises works under.
            *
            * Kept with the entity rather than with the overtime policy, because
            * these are not preferences — they are what the law requires of a
            * registered establishment, and the entity is what is registered.
            */}
          <div className="rounded-lg border border-slate-200 bg-surface-card p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Working hours and overtime</p>

            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <div>
                <FieldLabel htmlFor={`${fieldId}-esttype`}>This establishment is</FieldLabel>
                <SelectInput
                  id={`${fieldId}-esttype`}
                  value={draft.establishment_type ?? 'unregulated'}
                  onChange={(event) =>
                    setDraft({ ...draft, establishment_type: event.target.value as EstablishmentType })
                  }
                >
                  <option value="unregulated">Not set</option>
                  <option value="factory">A factory (Factories Act 1948)</option>
                  <option value="shops_establishment">Shops &amp; establishments</option>
                </SelectInput>
                {/*
                  * Only while it IS unset. Leaving the warning up after a type
                  * is chosen reads as though the choice did not take.
                  */}
                {!draft.establishment_type || draft.establishment_type === 'unregulated' ? (
                  <p className="mt-1 text-[11px] text-amber-700">
                    While this is unset, nobody here is checked against working-hour limits and they are left out of the
                    compliance report rather than passing it.
                  </p>
                ) : (
                  <p className="mt-1 text-[11px] text-slate-500">
                    Everyone filing under this entity is measured against these limits.
                  </p>
                )}
              </div>

              {draft.establishment_type && draft.establishment_type !== 'unregulated' ? (
                <>
                  <div>
                    <FieldLabel htmlFor={`${fieldId}-restexempt`}>Rest interval exemption</FieldLabel>
                    <SelectInput
                      id={`${fieldId}-restexempt`}
                      value={String(draft.rest_interval_exemption_minutes ?? '')}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          rest_interval_exemption_minutes: event.target.value === '' ? null : Number(event.target.value),
                        })
                      }
                    >
                      <option value="">None — 5 hours, as the Act requires</option>
                      <option value="360">6 hours, under a written order</option>
                    </SelectInput>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Section 55 lets the Chief Inspector permit six hours in writing. Only choose this if you hold the
                      order.
                    </p>
                  </div>

                  <div>
                    <FieldLabel htmlFor={`${fieldId}-qcap`}>Quarterly overtime cap</FieldLabel>
                    <TextInput
                      type="number"
                      min="1"
                      max="200"
                      placeholder="50 hours, as the Act requires"
                      id={`${fieldId}-qcap`}
                      value={draft.quarterly_overtime_cap_hours == null ? '' : String(draft.quarterly_overtime_cap_hours)}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          quarterly_overtime_cap_hours: event.target.value === '' ? null : Number(event.target.value),
                        })
                      }
                    />
                    <p className="mt-1 text-[11px] text-slate-500">
                      Leave blank for the statutory 50. Raise it only under a section 65(3) exemption.
                    </p>
                  </div>

                  <div className="sm:col-span-2">
                    <FieldLabel htmlFor={`${fieldId}-exemptref`}>Exemption order reference</FieldLabel>
                    <TextInput
                      id={`${fieldId}-exemptref`}
                      value={draft.exemption_reference ?? ''}
                      placeholder="The order number and date"
                      onChange={(event) => setDraft({ ...draft, exemption_reference: event.target.value })}
                    />
                  </div>

                  <label className="sm:col-span-2 flex items-start gap-2 rounded border border-slate-200 bg-slate-50 p-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={Boolean(draft.enforce_overtime_floor)}
                      onChange={(event) => setDraft({ ...draft, enforce_overtime_floor: event.target.checked })}
                    />
                    <span>
                      Pay the statutory overtime rate even where a policy is set lower
                      <span className="block text-[11px] text-slate-500">
                        {/* The consequence, next to the switch that causes it. */}
                        Overtime is owed at twice the ordinary rate. Leave this off and a lower configured rate is still
                        paid — the shortfall is reported but nothing changes. Turn it on and overtime pay goes up for
                        anyone on a rate below it.
                      </span>
                    </span>
                  </label>
                </>
              ) : null}
            </div>
          </div>

          <div className="flex gap-2">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'Saving...' : 'Save entity'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button variant="secondary" iconLeft={<Plus className="h-4 w-4" />} onClick={() => setDraft({ name: '' })}>
          Add entity
        </Button>
      )}
    </div>
  );
}
