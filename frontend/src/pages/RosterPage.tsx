import { useId, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarRange, Repeat, Send } from 'lucide-react';
import PageHeader from '@/components/dashboard/PageHeader';
import Button from '@/components/ui/Button';
import { FieldLabel, TextInput } from '@/components/ui/FormField';
import { PageLoadingState } from '@/components/ui/PageState';
import { rosterApi } from '@/services/api';
import type { RosterDay } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import RotationEditor from '@/features/roster/RotationEditor';
import SwapPanel from '@/features/roster/SwapPanel';

/**
 * The rota, as a grid: people down, days across.
 *
 * A ROSTERED REST DAY IS SHOWN, NOT LEFT BLANK. An empty cell means nobody has
 * scheduled that person; "Off" means they were told they have the day. Those
 * are different facts and a grid that renders both as whitespace is the reason
 * people ring their manager to ask.
 *
 * DRAFT DAYS ARE VISIBLY DRAFT. A manager builds next month in the open, and a
 * roster that looks identical before and after publishing is one somebody will
 * assume they have already sent out.
 */
const DAY_LABEL = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric' });

export default function RosterPage() {
  const queryClient = useQueryClient();
  const fieldId = useId();
  const { user } = useAuth();

  const [from, setFrom] = useState(() => startOfWeek());
  const [to, setTo] = useState(() => addDays(startOfWeek(), 13));
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const query = useQuery({
    queryKey: ['roster', from, to],
    queryFn: async () => (await rosterApi.days({ from, to })).data,
  });

  const generate = useMutation({
    mutationFn: async () => {
      const people = Array.from(new Set(days.map((day) => day.user_id)));
      return rosterApi.generate({ user_ids: people, from, to });
    },
    onSuccess: (response) => {
      setError('');
      const { created, updated, skipped_manual: manual, skipped_past: past } = response.data.data;
      /*
       * The skipped counts are surfaced, not swallowed. "We built 120 days and
       * left 3 alone because somebody had set them by hand" is the sentence a
       * manager needs; a bare success count hides the one thing worth checking.
       */
      setNotice(
        `Built ${created + updated} ${created + updated === 1 ? 'day' : 'days'}`
        + (manual > 0 ? ` · left ${manual} you had set by hand` : '')
        + (past > 0 ? ` · skipped ${past} already past` : ''),
      );
      queryClient.invalidateQueries({ queryKey: ['roster'] });
    },
    onError: (err: any) => setError(err?.response?.data?.message || 'Could not build that rota.'),
  });

  const publish = useMutation({
    mutationFn: () => rosterApi.publish({ from, to }),
    onSuccess: (response) => {
      setError('');
      // A publish that affected nothing looks identical to one that worked
      // unless it says so.
      const moved = response.data.published;
      setNotice(moved === 0 ? 'Nothing to publish — those days were already out.' : `Published ${moved} ${moved === 1 ? 'day' : 'days'}.`);
      queryClient.invalidateQueries({ queryKey: ['roster'] });
    },
    onError: (err: any) => setError(err?.response?.data?.message || 'Could not publish that range.'),
  });

  const days = query.data?.data ?? [];
  const canManage = query.data?.can_manage ?? false;

  const dates = useMemo(() => {
    const out: string[] = [];
    let cursor = from;

    // Bounded as well as terminated. A date helper that regresses must produce
    // a wrong grid, never a hung tab.
    while (cursor <= to && out.length < 366) {
      out.push(cursor);
      const next = addDays(cursor, 1);

      if (next === cursor) break;
      cursor = next;
    }

    return out;
  }, [from, to]);

  const byPerson = useMemo(() => {
    const map = new Map<number, { name: string; days: Map<string, RosterDay> }>();
    days.forEach((day) => {
      const entry = map.get(day.user_id) ?? { name: day.name ?? `#${day.user_id}`, days: new Map() };
      entry.days.set(day.date, day);
      map.set(day.user_id, entry);
    });
    return Array.from(map, ([userId, value]) => ({ userId, ...value }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [days]);

  const draftCount = days.filter((day) => day.status === 'draft').length;

  if (query.isLoading) {
    return <PageLoadingState label="Loading the rota..." />;
  }

  return (
    <div className="space-y-4 p-4">
      <PageHeader
        title="Rota"
        description="Who is working which shift, on which day. A day only reaches the team once it is published."
        actions={
          canManage ? (
            <span className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                iconLeft={<Repeat className="h-4 w-4" />}
                disabled={generate.isPending || days.length === 0}
                onClick={() => generate.mutate()}
              >
                {generate.isPending ? 'Building…' : 'Rebuild from patterns'}
              </Button>
              <Button
                iconLeft={<Send className="h-4 w-4" />}
                disabled={publish.isPending || draftCount === 0}
                onClick={() => publish.mutate()}
              >
                {publish.isPending ? 'Publishing…' : `Publish ${draftCount || ''}`.trim()}
              </Button>
            </span>
          ) : undefined
        }
      />

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}
      {notice ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p>
      ) : null}

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-3">
        <div>
          <FieldLabel htmlFor={`${fieldId}-from`}>From</FieldLabel>
          <TextInput id={`${fieldId}-from`} type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </div>
        <div>
          <FieldLabel htmlFor={`${fieldId}-to`}>To</FieldLabel>
          <TextInput id={`${fieldId}-to`} type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </div>
        {canManage && draftCount > 0 ? (
          <p className="ml-auto text-xs text-amber-700">
            {/* Said plainly: a roster that looks the same before and after
                publishing is one somebody assumes they have already sent. */}
            {draftCount} {draftCount === 1 ? 'day is' : 'days are'} still draft and not visible to the team.
          </p>
        ) : null}
      </div>

      {byPerson.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">
          {canManage
            ? 'Nothing rostered in this range yet.'
            : 'Nothing published for you in this range yet.'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="bg-slate-50">
              <tr>
                <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2 font-semibold text-slate-600">Person</th>
                {dates.map((date) => (
                  <th key={date} className="whitespace-nowrap px-2 py-2 text-center font-semibold text-slate-600">
                    {DAY_LABEL.format(new Date(`${date}T00:00:00`))}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {byPerson.map((person) => (
                <tr key={person.userId}>
                  <th scope="row" className="sticky left-0 z-10 whitespace-nowrap bg-white px-3 py-2 text-left font-medium text-slate-900">
                    {person.name}
                  </th>
                  {dates.map((date) => (
                    <td key={date} className="px-1 py-1 text-center">
                      <Cell day={person.days.get(date)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {canManage ? <RotationEditor /> : null}
        <SwapPanel canManage={canManage} currentUserId={user?.id} />
      </div>

      <p className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
        <CalendarRange className="h-3.5 w-3.5" />
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-slate-200" /> Off
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm border border-dashed border-slate-300" /> Not rostered
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-100 ring-1 ring-amber-300" /> Draft
        </span>
      </p>
    </div>
  );
}

/**
 * One cell.
 *
 * Three states, never two: a shift, a rostered rest day, and nothing at all.
 * Collapsing the last two into whitespace is the reason people ring their
 * manager to ask whether they are working.
 */
function Cell({ day }: { day?: RosterDay }) {
  if (!day) {
    return (
      <span
        className="block rounded-sm border border-dashed border-slate-200 px-1 py-1 text-[10px] text-slate-300"
        title="Not rostered"
      >
        –
      </span>
    );
  }

  const draft = day.status === 'draft';

  if (day.is_rest_day) {
    return (
      <span
        className={`block rounded-sm px-1 py-1 text-[10px] font-medium text-slate-500 ${
          draft ? 'bg-amber-50 ring-1 ring-amber-200' : 'bg-slate-100'
        }`}
        title={draft ? 'Off — not published yet' : 'Off'}
      >
        Off
      </span>
    );
  }

  return (
    <span
      className={`block truncate rounded-sm px-1 py-1 text-[10px] font-medium ${
        draft ? 'bg-amber-50 text-amber-900 ring-1 ring-amber-200' : 'bg-slate-900 text-white'
      }`}
      title={`${day.shift ?? 'Shift'}${draft ? ' — not published yet' : ''}${day.note ? ` · ${day.note}` : ''}`}
    >
      {day.shift ?? 'Shift'}
    </span>
  );
}

/**
 * A calendar date as YYYY-MM-DD, from LOCAL parts.
 *
 * Never toISOString(). That converts to UTC first, so anywhere east of it —
 * India included — local midnight is the previous day in UTC and the string
 * comes back a day early. In `addDays` that was worse than an off-by-one: it
 * returned the date it was given, and the loop building the column headers
 * never terminated.
 *
 * The same trap the backend guards with `date:Y-m-d` casts rather than `date`.
 */
function isoDate(value: Date): string {
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');

  return `${value.getFullYear()}-${month}-${day}`;
}

function startOfWeek(): string {
  const now = new Date();
  const day = (now.getDay() + 6) % 7; // Monday-first
  now.setDate(now.getDate() - day);

  return isoDate(now);
}

function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00`);
  parsed.setDate(parsed.getDate() + days);

  return isoDate(parsed);
}
