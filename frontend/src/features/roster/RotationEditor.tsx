import { useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Repeat } from 'lucide-react';
import { rosterApi, userApi } from '@/services/api';
import { shiftsApi } from '@/services/shiftsApi';
import Button from '@/components/ui/Button';
import { FieldLabel, TextInput } from '@/components/ui/FormField';

/**
 * Rotation patterns, and who is on them.
 *
 * A ROTATION IS A SEQUENCE, AND ITS MEANING IS POSITIONAL. The editor shows
 * every day of the cycle at once rather than letting somebody edit day three in
 * isolation — that is how a rota ends up with two rest days in a row nobody
 * asked for.
 *
 * A REST DAY IS AN EXPLICIT CHOICE, not an empty select. "Off" is one of the
 * things you can be doing on a given day, and a blank that happens to mean rest
 * is a blank somebody will read as unfinished.
 *
 * THE OFFSET IS EXPLAINED WHERE IT IS SET. Two people on the same
 * five-on-two-off rota need staggering or the site is uncovered at the weekend,
 * and nobody guesses that from a field called "start offset".
 */
export default function RotationEditor() {
  const queryClient = useQueryClient();
  const fieldId = useId();

  const [draft, setDraft] = useState<{ id?: number; name: string; cycle: number; steps: (number | null)[] } | null>(null);
  const [assigning, setAssigning] = useState<number | null>(null);
  const [error, setError] = useState('');

  const rotationsQuery = useQuery({
    queryKey: ['roster-rotations'],
    queryFn: async () => (await rosterApi.rotations()).data.data,
  });

  const shiftsQuery = useQuery({
    queryKey: ['roster-shift-options'],
    queryFn: async () => (await shiftsApi.list()).data,
  });

  const peopleQuery = useQuery({
    queryKey: ['roster-people-options'],
    queryFn: async () => (await userApi.getAll({ simple: 1 })).data,
    enabled: assigning !== null,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['roster-rotations'] });

  const save = useMutation({
    mutationFn: () =>
      rosterApi.saveRotation({
        id: draft!.id,
        name: draft!.name,
        cycle_length_days: draft!.cycle,
        steps: draft!.steps.map((shiftId) => ({ shift_id: shiftId })),
      }),
    onSuccess: () => {
      setDraft(null);
      setError('');
      invalidate();
    },
    onError: (err: any) => setError(err?.response?.data?.message || 'Could not save that pattern.'),
  });

  const assign = useMutation({
    mutationFn: (payload: { id: number; assignments: Array<{ user_id: number; start_offset: number }>; from: string }) =>
      rosterApi.assignRotation(payload.id, {
        assignments: payload.assignments,
        effective_from: payload.from,
      }),
    onSuccess: () => {
      setAssigning(null);
      setError('');
      invalidate();
    },
    onError: (err: any) => setError(err?.response?.data?.message || 'Could not assign that pattern.'),
  });

  const shifts = (shiftsQuery.data as any)?.data ?? shiftsQuery.data ?? [];
  const rotations = rotationsQuery.data ?? [];

  const setCycle = (cycle: number) =>
    setDraft((current) => {
      if (!current) return current;
      const steps = Array.from({ length: cycle }, (_, index) => current.steps[index] ?? null);
      return { ...current, cycle, steps };
    });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">
          <Repeat className="h-3.5 w-3.5" /> Rotation patterns
        </h2>
        <Button
          className="ml-auto"
          variant="secondary"
          size="sm"
          iconLeft={<Plus className="h-3.5 w-3.5" />}
          onClick={() => setDraft({ name: '', cycle: 7, steps: Array.from({ length: 7 }, () => null) })}
        >
          New pattern
        </Button>
      </div>

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
      ) : null}

      {draft ? (
        <form
          className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <FieldLabel htmlFor={`${fieldId}-name`}>Name</FieldLabel>
              <TextInput
                id={`${fieldId}-name`}
                value={draft.name}
                placeholder="Five on, two off"
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                required
              />
            </div>
            <div>
              <FieldLabel htmlFor={`${fieldId}-cycle`}>Days in the cycle</FieldLabel>
              <TextInput
                id={`${fieldId}-cycle`}
                type="number"
                min="1"
                max="60"
                value={String(draft.cycle)}
                onChange={(event) => setCycle(Math.max(1, Math.min(60, Number(event.target.value) || 1)))}
              />
              <p className="mt-1 text-[10px] text-slate-500">
                {/* Days, not weeks — a four-on-four-off runs on eight. */}
                Not necessarily seven. A four-on-four-off runs on eight.
              </p>
            </div>
          </div>

          <div>
            <FieldLabel>Each day of the cycle</FieldLabel>
            <div className="flex flex-wrap gap-2">
              {draft.steps.map((shiftId, index) => (
                <label key={index} className="w-32">
                  <span className="mb-0.5 block text-[10px] font-medium text-slate-500">Day {index + 1}</span>
                  <select
                    value={shiftId === null ? '' : String(shiftId)}
                    onChange={(event) => {
                      const steps = [...draft.steps];
                      steps[index] = event.target.value === '' ? null : Number(event.target.value);
                      setDraft({ ...draft, steps });
                    }}
                    className="w-full rounded border border-slate-300 px-1.5 py-1 text-[11px]"
                  >
                    {/* An explicit choice, not a blank that happens to mean
                        rest. */}
                    <option value="">Off</option>
                    {shifts.map((shift: any) => (
                      <option key={shift.id} value={shift.id}>
                        {shift.name}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save pattern'}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      {rotations.length === 0 ? (
        <p className="rounded border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-500">
          No patterns yet. A rota is generated from one of these.
        </p>
      ) : (
        <ul className="space-y-2">
          {rotations.map((rotation) => (
            <li key={rotation.id} className="rounded border border-slate-200 bg-white p-2">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-medium text-slate-950">{rotation.name}</span>
                <span className="text-slate-500">{rotation.cycle_length_days}-day cycle</span>
                <span className="text-slate-600">
                  {(rotation.steps ?? [])
                    .map((step) => step.shift?.name ?? 'Off')
                    .join(' · ')}
                </span>
                <span className="ml-auto flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setDraft({
                        id: rotation.id,
                        name: rotation.name,
                        cycle: rotation.cycle_length_days,
                        steps: Array.from(
                          { length: rotation.cycle_length_days },
                          (_, index) => (rotation.steps ?? []).find((s) => s.position === index)?.shift_id ?? null,
                        ),
                      })
                    }
                  >
                    Edit
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setAssigning(rotation.id)}>
                    Assign people
                  </Button>
                </span>
              </div>

              {assigning === rotation.id ? (
                <form
                  className="mt-2 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    const ids = form.getAll('user_ids').map(Number).filter(Boolean);
                    const stagger = form.get('stagger') === 'on';

                    assign.mutate({
                      id: rotation.id,
                      from: String(form.get('effective_from')),
                      /*
                       * Staggering by index is the sane default: everybody at
                       * offset zero rests on the same days, which leaves the
                       * site uncovered at exactly the moment a rota exists to
                       * cover.
                       */
                      assignments: ids.map((userId, index) => ({
                        user_id: userId,
                        start_offset: stagger ? index % rotation.cycle_length_days : 0,
                      })),
                    });
                  }}
                >
                  <div>
                    <FieldLabel htmlFor={`${fieldId}-people-${rotation.id}`}>People</FieldLabel>
                    <select
                      id={`${fieldId}-people-${rotation.id}`}
                      name="user_ids"
                      multiple
                      size={4}
                      className="rounded border border-slate-300 p-1 text-[11px]"
                    >
                      {(peopleQuery.data ?? []).map((person: any) => (
                        <option key={person.id} value={person.id}>
                          {person.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <FieldLabel htmlFor={`${fieldId}-from-${rotation.id}`}>From</FieldLabel>
                    <TextInput
                      id={`${fieldId}-from-${rotation.id}`}
                      name="effective_from"
                      type="date"
                      required
                    />
                  </div>

                  <label className="flex items-center gap-1.5 pb-2 text-[11px] text-slate-700">
                    <input type="checkbox" name="stagger" defaultChecked />
                    Stagger them
                    <span className="block text-[10px] text-slate-500">
                      {/* Nobody guesses this from a field called offset. */}
                      so they do not all rest on the same days
                    </span>
                  </label>

                  <Button type="submit" size="sm" disabled={assign.isPending}>
                    {assign.isPending ? 'Assigning…' : 'Assign'}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setAssigning(null)}>
                    Cancel
                  </Button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
