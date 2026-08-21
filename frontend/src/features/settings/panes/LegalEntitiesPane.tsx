import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Plus, Star, Trash2 } from 'lucide-react';
import { legalEntityApi } from '@/services/api';
import type { LegalEntity } from '@/types';
import Button from '@/components/ui/Button';
import { FieldLabel, TextInput } from '@/components/ui/FormField';
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
          <div key={entity.id} className="rounded-lg border border-slate-200 bg-white p-3">
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
              <FieldLabel>Entity name</FieldLabel>
              <TextInput
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
                <FieldLabel>{label}</FieldLabel>
                <TextInput
                  value={(draft[field] as string) ?? ''}
                  placeholder={placeholder}
                  onChange={(event) => setDraft({ ...draft, [field]: event.target.value })}
                />
              </div>
            ))}
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
