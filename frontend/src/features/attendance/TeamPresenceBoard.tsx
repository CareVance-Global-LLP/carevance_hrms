import { useMemo, useState } from 'react';
import { CalendarDays, Coffee, LogIn, Minus, Palmtree, Search, X } from 'lucide-react';

export type PresenceStatus = 'in' | 'on_break' | 'not_in' | 'on_leave';

export type PresencePerson = {
  id: number;
  name: string;
  designation?: string | null;
  status: PresenceStatus;
  checked_in_at?: string | null;
};

export type OffSoonEntry = {
  id: number;
  name: string;
  from: string;
  to: string;
};

type TeamPresenceBoardProps = {
  people: PresencePerson[];
  offSoon: OffSoonEntry[];
  departmentName?: string | null;
  isLoading: boolean;
  timeZone?: string;
};

/**
 * What an employee sees of their own department.
 *
 * This board answers "who is around today", which is what a colleague needs.
 * It deliberately carries no attendance rate, worked hours or idle share — the
 * HR roster in AttendanceRoster does that job for people who manage others.
 * Keeping the two surfaces separate is why the API sends two different shapes.
 */

const SECTIONS: Array<{
  key: string;
  label: string;
  icon: typeof LogIn;
  tone: string;
  match: (person: PresencePerson) => boolean;
}> = [
  { key: 'in', label: 'In', icon: LogIn, tone: 'text-emerald-600', match: (p) => p.status === 'in' || p.status === 'on_break' },
  { key: 'not_in', label: 'Not in', icon: Minus, tone: 'text-slate-500', match: (p) => p.status === 'not_in' },
  { key: 'on_leave', label: 'On leave', icon: Palmtree, tone: 'text-amber-600', match: (p) => p.status === 'on_leave' },
];

const initialsOf = (value: string): string => {
  const parts = String(value || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

const clockTime = (iso: string | null | undefined, timeZone?: string): string | null => {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    ...(timeZone ? { timeZone } : {}),
  });
};

const dayLabel = (date: string, timeZone?: string): string => {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(timeZone ? { timeZone } : {}),
  });
};

export default function TeamPresenceBoard({
  people,
  offSoon,
  departmentName,
  isLoading,
  timeZone,
}: TeamPresenceBoardProps) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();

  const visible = useMemo(
    () => (needle ? people.filter((person) => person.name.toLowerCase().includes(needle)) : people),
    [people, needle]
  );

  if (isLoading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-6 py-16 text-center text-sm text-slate-500">
        Loading your team…
      </div>
    );
  }

  if (people.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-6 py-16 text-center">
        <p className="text-sm font-semibold text-slate-700">No team to show yet</p>
        <p className="mt-1 text-xs text-slate-500">
          You are not assigned to a department, so there are no colleagues to show here.
          Ask an admin to add you to one.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Today</h2>
          <p className="text-xs text-slate-500">
            {departmentName ? `${departmentName} · ` : ''}
            {people.length} {people.length === 1 ? 'person' : 'people'}
          </p>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
          <input
            type="search"
            aria-label="Search your team"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name"
            className="w-56 rounded-lg border border-slate-200 bg-white py-1.5 pl-9 pr-8 text-xs text-slate-800 placeholder:text-slate-500 focus:border-blue-400 focus:outline-none"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-500 hover:text-slate-700"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      {/* items-start so an empty column does not stretch to match a full one */}
      <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-3">
        {SECTIONS.map((section) => {
          const members = visible.filter(section.match);
          const Icon = section.icon;

          return (
            <section
              key={section.key}
              role="group"
              aria-label={`${section.label} · ${members.length}`}
              className="rounded-xl border border-slate-200 bg-white p-3"
            >
              <div className="mb-2 flex items-center gap-2">
                <Icon className={`h-3.5 w-3.5 ${section.tone}`} aria-hidden="true" />
                <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
                  {section.label}
                </span>
                <span className="ml-auto text-xs font-bold tabular-nums text-slate-700">
                  {members.length}
                </span>
              </div>

              {members.length === 0 ? (
                <p className="px-1 py-3 text-xs text-slate-500">Nobody</p>
              ) : (
                <ul className="space-y-1">
                  {members.map((person) => {
                    const time = person.status === 'in' ? clockTime(person.checked_in_at, timeZone) : null;

                    return (
                      <li key={person.id} className="flex items-center gap-2 rounded-lg px-1 py-1.5">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-600">
                          {initialsOf(person.name)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium text-slate-900">
                            {person.name}
                          </span>
                          {person.designation ? (
                            <span className="block truncate text-[10px] text-slate-500">
                              {person.designation}
                            </span>
                          ) : null}
                        </span>
                        {person.status === 'on_break' ? (
                          <Coffee className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-label="On a break" />
                        ) : null}
                        {time ? (
                          <span className="shrink-0 text-[11px] tabular-nums text-slate-500">{time}</span>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      <section
        role="group"
        aria-label="Off in the next two weeks"
        className="rounded-xl border border-slate-200 bg-white p-3"
      >
        <div className="mb-2 flex items-center gap-2">
          <CalendarDays className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
          <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
            Off in the next two weeks
          </span>
        </div>

        {offSoon.length === 0 ? (
          <p className="px-1 py-2 text-xs text-slate-500">Nobody is off in the next two weeks.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {offSoon.map((entry, index) => (
              <li
                key={`${entry.id}-${entry.from}-${index}`}
                className="flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-50 text-[9px] font-semibold text-amber-700">
                  {initialsOf(entry.name)}
                </span>
                <span className="text-xs font-medium text-slate-800">{entry.name}</span>
                <span className="text-[11px] tabular-nums text-slate-500">
                  {dayLabel(entry.from, timeZone)}
                  {entry.to && entry.to !== entry.from ? ` – ${dayLabel(entry.to, timeZone)}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
