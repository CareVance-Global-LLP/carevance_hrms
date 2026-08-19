import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, Moon, Pencil, Plus, Trash2, X } from 'lucide-react';
import Button from '@/components/ui/Button';
import { FieldLabel, SelectInput, TextInput, TextareaInput } from '@/components/ui/FormField';
import { useToast } from '@/components/ui/Toast';
import { userApi } from '@/services/api';
import { shiftsApi, type ShiftAssignment, type ShiftSummary } from '@/services/shiftsApi';
import SettingsCard from '../components/SettingsCard';
import SegmentedControl from '../components/SegmentedControl';
import {
  SHIFT_DAY_OPTIONS,
  SHIFT_TYPE_OPTIONS,
  createEmptyShiftDraft,
  describeShiftWindow,
  formatSpanMinutes,
  shiftDraftToPayload,
  shiftExpectedWorkSeconds,
  shiftSpanMinutes,
  toggleShiftDay,
  validateShiftDraft,
  type ShiftDay,
  type ShiftDraft,
  type ShiftDraftErrors,
} from '../shiftForm';

type ShiftSection = 'patterns' | 'roster';

const SECTIONS: Array<{ value: ShiftSection; label: string }> = [
  { value: 'patterns', label: 'Shift patterns' },
  { value: 'roster', label: 'Who works which' },
];

const formatHours = (seconds: number | null): string =>
  seconds === null ? '--' : formatSpanMinutes(Math.round(seconds / 60));

const todayIso = (): string => new Date().toISOString().slice(0, 10);

/** An existing shift, turned back into the form's own string shape. */
const draftFromShift = (shift: ShiftSummary): ShiftDraft => ({
  name: shift.name ?? '',
  code: shift.code ?? '',
  type: shift.type ?? 'general',
  description: shift.description ?? '',
  start_time: (shift.start_time ?? '09:00').slice(0, 5),
  end_time: (shift.end_time ?? '18:00').slice(0, 5),
  break_minutes: String(shift.break_duration_minutes ?? 0),
  grace_minutes: String(shift.grace_period_minutes ?? 0),
  early_exit_grace_minutes: String(shift.early_exit_grace_minutes ?? 0),
  applicable_days: (shift.applicable_days ?? []) as ShiftDay[],
  is_active: shift.is_active ?? true,
});

/**
 * Shift patterns, and who is on them.
 *
 * The pane exists because shift length is no longer a constant: attendance,
 * the countdown and the overtime threshold all read the resolved shift, and
 * until a shift is configured they fall back to eight hours for everybody.
 * This is where that gets configured.
 *
 * Two deliberate shapes:
 *
 *  - The editor previews the span and the working hours WHILE you type, from
 *    the same arithmetic the server uses. A 22:00-06:00 shift reads "22:00 to
 *    06:00 the next day", because which day the end falls on is the fact a
 *    night shift turns on and no pair of time inputs says it by itself.
 *  - Assignment is per person and effective-dated. Department and location are
 *    how you decide whom to roster; they are never the key, or one person
 *    changing team would silently re-roster them.
 */
export default function ShiftsPane() {
  const toast = useToast();

  const [section, setSection] = useState<ShiftSection>('patterns');
  const [shifts, setShifts] = useState<ShiftSummary[]>([]);
  const [assignments, setAssignments] = useState<ShiftAssignment[]>([]);
  const [people, setPeople] = useState<Array<{ id: number; name: string }>>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const [editingId, setEditingId] = useState<number | 'new' | null>(null);
  const [draft, setDraft] = useState<ShiftDraft>(createEmptyShiftDraft);
  const [draftErrors, setDraftErrors] = useState<ShiftDraftErrors>({});
  const [isSaving, setIsSaving] = useState(false);

  const [assignUserId, setAssignUserId] = useState('');
  const [assignShiftId, setAssignShiftId] = useState('');
  const [assignFrom, setAssignFrom] = useState(todayIso);
  const [assignTo, setAssignTo] = useState('');
  const [isAssigning, setIsAssigning] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const [shiftResponse, assignmentResponse, peopleResponse] = await Promise.all([
        shiftsApi.list(),
        shiftsApi.assignments(),
        userApi.getAll({ simple: true }),
      ]);
      setShifts(shiftResponse.data.data || []);
      setAssignments(assignmentResponse.data.data || []);
      setPeople(
        (peopleResponse.data || []).map((person: { id: number; name?: string | null }) => ({
          id: person.id,
          name: person.name || `Employee #${person.id}`,
        }))
      );
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Could not load shifts.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const peopleById = useMemo(
    () => new Map(people.map((person) => [person.id, person.name])),
    [people]
  );
  const shiftsById = useMemo(() => new Map(shifts.map((shift) => [shift.id, shift])), [shifts]);

  const draftSpan = shiftSpanMinutes(draft.start_time, draft.end_time);
  const draftWorkSeconds = shiftExpectedWorkSeconds(
    draft.start_time,
    draft.end_time,
    Number(draft.break_minutes || 0)
  );

  const openEditor = (shift: ShiftSummary | null) => {
    setDraft(shift ? draftFromShift(shift) : createEmptyShiftDraft());
    setDraftErrors({});
    setEditingId(shift ? shift.id : 'new');
  };

  const closeEditor = () => {
    setEditingId(null);
    setDraftErrors({});
  };

  const saveDraft = async () => {
    const errors = validateShiftDraft(draft);
    setDraftErrors(errors);
    if (Object.keys(errors).length > 0) {
      return;
    }

    setIsSaving(true);
    try {
      const payload = shiftDraftToPayload(draft);
      if (editingId === 'new') {
        await shiftsApi.create(payload);
        toast.show({ kind: 'success', message: 'Shift created.' });
      } else if (typeof editingId === 'number') {
        await shiftsApi.update(editingId, payload);
        toast.show({ kind: 'success', message: 'Shift updated.' });
      }
      closeEditor();
      await load();
    } catch (e: any) {
      // The server owns the rules this form cannot check — a code already used
      // in this workspace, most of all. Surface its field errors rather than a
      // generic failure, so the person can fix the field it names.
      const fieldErrors = e?.response?.data?.errors as Record<string, string[]> | undefined;
      if (fieldErrors) {
        setDraftErrors(
          Object.fromEntries(
            Object.entries(fieldErrors).map(([field, messages]) => [field, messages[0]])
          ) as ShiftDraftErrors
        );
      }
      toast.show({ kind: 'error', message: e?.response?.data?.message || 'Could not save the shift.' });
    } finally {
      setIsSaving(false);
    }
  };

  const removeShift = async (shift: ShiftSummary) => {
    try {
      await shiftsApi.remove(shift.id);
      toast.show({ kind: 'success', message: `${shift.name} deleted.` });
      await load();
    } catch (e: any) {
      // 409 is the deliberate refusal to cascade a delete through the roster
      // history; its message names how many assignments are in the way.
      toast.show({ kind: 'error', message: e?.response?.data?.message || 'Could not delete the shift.' });
    }
  };

  const assign = async () => {
    if (!assignUserId || !assignShiftId || !assignFrom) {
      toast.show({ kind: 'error', message: 'Pick a person, a shift and a start date.' });
      return;
    }

    setIsAssigning(true);
    try {
      await shiftsApi.assign({
        user_id: Number(assignUserId),
        shift_id: Number(assignShiftId),
        effective_from: assignFrom,
        effective_to: assignTo || null,
      });
      toast.show({ kind: 'success', message: 'Shift assigned.' });
      setAssignTo('');
      await load();
    } catch (e: any) {
      const fieldErrors = e?.response?.data?.errors as Record<string, string[]> | undefined;
      const firstFieldError = fieldErrors ? Object.values(fieldErrors)[0]?.[0] : null;
      toast.show({ kind: 'error', message: firstFieldError || e?.response?.data?.message || 'Could not assign the shift.' });
    } finally {
      setIsAssigning(false);
    }
  };

  const unassign = async (assignment: ShiftAssignment) => {
    try {
      await shiftsApi.unassign(assignment.id);
      toast.show({ kind: 'success', message: 'Assignment removed.' });
      await load();
    } catch (e: any) {
      toast.show({ kind: 'error', message: e?.response?.data?.message || 'Could not remove the assignment.' });
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((index) => (
          <div key={index} className="h-24 animate-pulse rounded-xl bg-surface-sunken" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error ? <p className="text-xs text-red-600">{error}</p> : null}

      <SegmentedControl
        ariaLabel="Shift settings section"
        value={section}
        onChange={(value) => setSection(value as ShiftSection)}
        options={SECTIONS.map((item) => ({ value: item.value, label: item.label }))}
      />

      {section === 'patterns' ? (
        <SettingsCard
          title="Shift patterns"
          description="A shift is a start, an end and an unpaid break. Its working hours are what attendance counts down to — without one, everybody is assumed to work eight hours."
          aside={
            editingId === null ? (
              <Button size="sm" iconLeft={<Plus className="h-4 w-4" />} onClick={() => openEditor(null)}>
                New shift
              </Button>
            ) : null
          }
        >
          {editingId !== null ? (
            <div className="mb-4 rounded-lg border border-slate-300 bg-surface-sunken p-4">
              <div className="mb-3 flex items-center justify-between">
                <h4 className="text-sm font-semibold text-slate-900">
                  {editingId === 'new' ? 'New shift' : 'Edit shift'}
                </h4>
                <button
                  type="button"
                  onClick={closeEditor}
                  aria-label="Close the shift editor"
                  className="rounded-md p-1.5 text-slate-500 transition hover:text-slate-900"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <FieldLabel>Name</FieldLabel>
                  <TextInput
                    value={draft.name}
                    onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                    placeholder="e.g. Night Support"
                  />
                  {draftErrors.name ? <p className="mt-1 text-xs text-red-600">{draftErrors.name}</p> : null}
                </div>
                <div>
                  <FieldLabel hint="Unique in this workspace">Code</FieldLabel>
                  <TextInput
                    value={draft.code}
                    onChange={(event) => setDraft({ ...draft, code: event.target.value })}
                    placeholder="e.g. NIGHT"
                  />
                  {draftErrors.code ? <p className="mt-1 text-xs text-red-600">{draftErrors.code}</p> : null}
                </div>

                <div>
                  <FieldLabel>Type</FieldLabel>
                  <SelectInput
                    aria-label="Shift type"
                    value={draft.type}
                    onChange={(event) => setDraft({ ...draft, type: event.target.value as ShiftDraft['type'] })}
                  >
                    {SHIFT_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </SelectInput>
                </div>
                <div>
                  <FieldLabel>Status</FieldLabel>
                  <SegmentedControl
                    size="sm"
                    ariaLabel="Shift status"
                    value={draft.is_active ? 'active' : 'inactive'}
                    onChange={(value) => setDraft({ ...draft, is_active: value === 'active' })}
                    options={[
                      { value: 'active', label: 'Active', tone: 'success' },
                      { value: 'inactive', label: 'Retired', tone: 'neutral' },
                    ]}
                  />
                </div>

                <div>
                  <FieldLabel>Starts</FieldLabel>
                  <TextInput
                    type="time"
                    value={draft.start_time}
                    onChange={(event) => setDraft({ ...draft, start_time: event.target.value })}
                  />
                  {draftErrors.start_time ? (
                    <p className="mt-1 text-xs text-red-600">{draftErrors.start_time}</p>
                  ) : null}
                </div>
                <div>
                  <FieldLabel>Ends</FieldLabel>
                  <TextInput
                    type="time"
                    value={draft.end_time}
                    onChange={(event) => setDraft({ ...draft, end_time: event.target.value })}
                  />
                  {draftErrors.end_time ? (
                    <p className="mt-1 text-xs text-red-600">{draftErrors.end_time}</p>
                  ) : null}
                </div>

                <div>
                  <FieldLabel hint="Unpaid">Break</FieldLabel>
                  <TextInput
                    type="number"
                    min={0}
                    max={720}
                    value={draft.break_minutes}
                    onChange={(event) => setDraft({ ...draft, break_minutes: event.target.value })}
                  />
                  {draftErrors.break_minutes ? (
                    <p className="mt-1 text-xs text-red-600">{draftErrors.break_minutes}</p>
                  ) : null}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <FieldLabel>Late grace</FieldLabel>
                    <TextInput
                      type="number"
                      min={0}
                      max={240}
                      value={draft.grace_minutes}
                      onChange={(event) => setDraft({ ...draft, grace_minutes: event.target.value })}
                    />
                    {draftErrors.grace_minutes ? (
                      <p className="mt-1 text-xs text-red-600">{draftErrors.grace_minutes}</p>
                    ) : null}
                  </div>
                  <div>
                    <FieldLabel>Early exit</FieldLabel>
                    <TextInput
                      type="number"
                      min={0}
                      max={240}
                      value={draft.early_exit_grace_minutes}
                      onChange={(event) =>
                        setDraft({ ...draft, early_exit_grace_minutes: event.target.value })
                      }
                    />
                    {draftErrors.early_exit_grace_minutes ? (
                      <p className="mt-1 text-xs text-red-600">{draftErrors.early_exit_grace_minutes}</p>
                    ) : null}
                  </div>
                </div>

                <div className="sm:col-span-2">
                  <FieldLabel hint="Leave empty to run every day">Runs on</FieldLabel>
                  <div className="flex flex-wrap gap-1.5">
                    {SHIFT_DAY_OPTIONS.map((day) => {
                      const isOn = draft.applicable_days.includes(day.value);
                      return (
                        <button
                          key={day.value}
                          type="button"
                          aria-pressed={isOn}
                          onClick={() =>
                            setDraft({ ...draft, applicable_days: toggleShiftDay(draft.applicable_days, day.value) })
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
                </div>

                <div className="sm:col-span-2">
                  <FieldLabel>Description</FieldLabel>
                  <TextareaInput
                    rows={2}
                    value={draft.description}
                    onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                    placeholder="Who this shift is for, and anything a roster needs to know."
                  />
                </div>
              </div>

              {/*
                The preview is the point of the editor. Two time inputs cannot
                say that a 22:00 shift finishes tomorrow, nor that an hour of
                unpaid break turns a nine-hour span into an eight-hour day.
              */}
              <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-slate-200 bg-surface-card px-3 py-2.5 text-xs">
                <span className="inline-flex items-center gap-1.5 text-slate-600">
                  <CalendarClock className="h-4 w-4" />
                  {describeShiftWindow(draft.start_time, draft.end_time) || 'Set a start and an end'}
                </span>
                <span className="text-slate-600">
                  Span <span className="font-semibold text-slate-900">{formatSpanMinutes(draftSpan)}</span>
                </span>
                <span className="text-slate-600">
                  Working hours{' '}
                  <span className="font-semibold text-slate-900">{formatHours(draftWorkSeconds)}</span>
                </span>
              </div>

              <div className="mt-4 flex gap-2">
                <Button onClick={saveDraft} loading={isSaving} disabled={isSaving}>
                  {editingId === 'new' ? 'Create shift' : 'Save changes'}
                </Button>
                <Button variant="secondary" onClick={closeEditor} disabled={isSaving}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}

          {shifts.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-300 p-4 text-xs text-slate-600">
              No shifts yet. Until one exists, attendance counts everybody down from eight hours.
            </p>
          ) : (
            <div className="space-y-2">
              {shifts.map((shift) => (
                <div
                  key={shift.id}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-surface-sunken p-3"
                >
                  <div className="min-w-[10rem] flex-1">
                    <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                      {shift.name}
                      <span className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-600">
                        {shift.code}
                      </span>
                      {shift.crosses_midnight ? (
                        <span
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-600"
                          title="Ends on the next calendar day"
                        >
                          <Moon className="h-3.5 w-3.5" /> overnight
                        </span>
                      ) : null}
                      {!shift.is_active ? (
                        <span className="text-[11px] font-medium text-slate-500">retired</span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-600">
                      {describeShiftWindow(shift.start_time, shift.end_time)} · working{' '}
                      {formatHours(shift.expected_work_seconds)} · {shift.break_duration_minutes}m break
                      {shift.applicable_days && shift.applicable_days.length > 0
                        ? ` · ${shift.applicable_days.length} days a week`
                        : ' · every day'}
                    </p>
                  </div>

                  <span className="text-xs text-slate-600">
                    {shift.assigned_count} assigned
                  </span>

                  <button
                    type="button"
                    onClick={() => openEditor(shift)}
                    aria-label={`Edit ${shift.name}`}
                    className="rounded-md p-2 text-slate-500 transition hover:text-blue-600"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeShift(shift)}
                    aria-label={`Delete ${shift.name}`}
                    className="rounded-md p-2 text-slate-500 transition hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </SettingsCard>
      ) : (
        <SettingsCard
          title="Who works which shift"
          description="Assignment is per person and dated. Re-rostering someone is a new assignment starting later, not an edit — so an earlier month still resolves the shift that was actually in force then."
        >
          <div className="mb-4 grid items-end gap-3 rounded-lg border border-dashed border-slate-300 p-3 sm:grid-cols-5">
            <div className="sm:col-span-2">
              <FieldLabel>Employee</FieldLabel>
              <SelectInput
                aria-label="Employee to roster"
                value={assignUserId}
                onChange={(event) => setAssignUserId(event.target.value)}
              >
                <option value="">Select a person</option>
                {people.map((person) => (
                  <option key={person.id} value={String(person.id)}>
                    {person.name}
                  </option>
                ))}
              </SelectInput>
            </div>
            <div>
              <FieldLabel>Shift</FieldLabel>
              <SelectInput
                aria-label="Shift to assign"
                value={assignShiftId}
                onChange={(event) => setAssignShiftId(event.target.value)}
              >
                <option value="">Select a shift</option>
                {shifts
                  .filter((shift) => shift.is_active)
                  .map((shift) => (
                    <option key={shift.id} value={String(shift.id)}>
                      {shift.name}
                    </option>
                  ))}
              </SelectInput>
            </div>
            <div>
              <FieldLabel>From</FieldLabel>
              <TextInput
                type="date"
                value={assignFrom}
                onChange={(event) => setAssignFrom(event.target.value)}
              />
            </div>
            <div>
              <FieldLabel hint="Optional">Until</FieldLabel>
              <TextInput
                type="date"
                value={assignTo}
                onChange={(event) => setAssignTo(event.target.value)}
              />
            </div>
            <div className="sm:col-span-5">
              <Button onClick={assign} loading={isAssigning} disabled={isAssigning}>
                Assign shift
              </Button>
            </div>
          </div>

          {assignments.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-300 p-4 text-xs text-slate-600">
              Nobody is rostered yet.
            </p>
          ) : (
            <div className="space-y-2">
              {assignments.map((assignment) => {
                const shift = assignment.shift || shiftsById.get(assignment.shift_id) || null;
                const personName =
                  assignment.user?.name
                  || peopleById.get(assignment.user_id)
                  || `Employee #${assignment.user_id}`;

                return (
                  <div
                    key={assignment.id}
                    className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-surface-sunken p-3"
                  >
                    <span className="min-w-[9rem] flex-1 truncate text-sm font-medium text-slate-900">
                      {personName}
                    </span>
                    <span className="text-xs text-slate-600">{shift?.name || 'Shift removed'}</span>
                    <span className="text-xs text-slate-600">
                      {assignment.effective_from}
                      {assignment.effective_to ? ` to ${assignment.effective_to}` : ' onwards'}
                    </span>
                    <button
                      type="button"
                      onClick={() => unassign(assignment)}
                      aria-label={`Remove ${personName} from ${shift?.name || 'this shift'}`}
                      className="rounded-md p-2 text-slate-500 transition hover:text-red-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </SettingsCard>
      )}
    </div>
  );
}
