import { useMemo } from 'react';
import { addDays, spansOverlap, toISODate } from './leaveUtils';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MAX_CHIPS_PER_DAY = 3;

export interface WhosOffStripProps {
  requests: ReadonlyArray<any>;
  /** ISO date → holiday title. */
  holidays: ReadonlyMap<string, string>;
  colorOf: (code?: string | null) => string;
  days?: number;
}

/**
 * The calendar the page never had: the next two weeks, one column per day,
 * every approved absence a chip. Built purely from the requests the page
 * already fetches — the strip shows whatever the viewer is allowed to list,
 * so an employee sees their own scope and a manager sees the team's.
 */
export default function WhosOffStrip({ requests, holidays, colorOf, days = 14 }: WhosOffStripProps) {
  const cells = useMemo(() => {
    const approved = requests.filter((item) => item?.status === 'approved');
    const start = new Date();

    return Array.from({ length: days }, (_, offset) => {
      const date = addDays(start, offset);
      const iso = toISODate(date);
      const weekend = date.getDay() === 0 || date.getDay() === 6;

      const off = weekend
        ? []
        : approved.filter((item) =>
            spansOverlap(String(item.start_date || ''), String(item.end_date || ''), iso, iso)
          );

      return {
        iso,
        label: `${DOW[date.getDay()]} ${date.getDate()}`,
        weekend,
        today: offset === 0,
        holiday: holidays.get(iso) ?? null,
        off,
      };
    });
  }, [requests, holidays, days]);

  const anyoneOff = cells.some((cell) => cell.off.length > 0);

  return (
    <div>
      <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
        Who's off · next two weeks
      </h2>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <div className="grid min-w-[820px]" style={{ gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))` }}>
          {cells.map((cell) => (
            <div
              key={cell.iso}
              className={`min-h-[92px] border-r border-slate-100 px-1.5 py-1.5 last:border-r-0 ${
                cell.weekend ? 'bg-slate-50' : ''
              } ${cell.today ? 'shadow-[inset_0_3px_0_0_#5D969D]' : ''}`}
            >
              <p
                className={`mb-1.5 text-center font-mono text-[9px] ${
                  cell.today ? 'font-bold text-blue-700' : 'text-slate-400'
                }`}
              >
                {cell.label}
                {cell.today ? ' · today' : ''}
              </p>

              {cell.holiday ? (
                <p
                  className="mb-1 truncate rounded border border-dashed border-accent-300 px-1 py-px text-center font-mono text-[8px] text-warning-800"
                  title={cell.holiday}
                >
                  {cell.holiday}
                </p>
              ) : null}

              {cell.off.slice(0, MAX_CHIPS_PER_DAY).map((item) => {
                const name = String(item.user?.name || 'Unknown');
                const color = colorOf(item.leave_category);
                return (
                  <p
                    key={`${item.id}`}
                    className="mb-0.5 truncate rounded px-1 py-0.5 text-[9px] font-bold"
                    style={{ backgroundColor: `${color}22`, color }}
                    title={`${name} · ${item.leave_category || 'leave'} · ${item.start_date} → ${item.end_date}`}
                  >
                    {name.split(' ')[0]}
                    {item.leave_type === 'half_day' ? ' ½' : ''}
                  </p>
                );
              })}

              {cell.off.length > MAX_CHIPS_PER_DAY ? (
                <p
                  className="text-center font-mono text-[9px] font-bold text-slate-400"
                  title={cell.off
                    .slice(MAX_CHIPS_PER_DAY)
                    .map((item) => String(item.user?.name || 'Unknown'))
                    .join(', ')}
                >
                  +{cell.off.length - MAX_CHIPS_PER_DAY}
                </p>
              ) : null}
            </div>
          ))}
        </div>

        {!anyoneOff ? (
          <p className="border-t border-slate-100 px-4 py-2 text-center text-[11px] text-slate-400">
            Nobody is off in the next two weeks.
          </p>
        ) : null}
      </div>
    </div>
  );
}
