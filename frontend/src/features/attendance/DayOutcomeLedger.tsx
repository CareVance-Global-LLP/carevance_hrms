import { useMemo } from 'react';
import { ShieldCheck } from 'lucide-react';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import { describeDayOutcome, type DayOutcomeChip, type DayOutcomePayload, type DayOutcomeTone } from '@/lib/attendanceDayOutcome';

/**
 * The month's exceptions, each with the sentence that produced it.
 *
 * The calendar answers "what happened on the 12th"; this answers the question
 * that follows it — "why did the 12th cost me half a day" — and it is the only
 * screen in the product that can. The penalisation engine writes a full working
 * ("worked 3h 12m of an 8h 00m shift (40.00%), below the 50.00% rung") and
 * before this it went nowhere.
 *
 * Two rules shape what is listed:
 *
 *   ONLY EXCEPTIONS. A clear day and a weekly off are not listed at all. A
 *   ledger that repeats thirty ordinary days buries the two that matter.
 *
 *   PENDING OVERTIME IS AN EXCEPTION. Hours measured and not approved are
 *   somebody's to act on, and the failure mode is silence — so they appear
 *   here, in their own chip, and never merged with hours that count.
 *
 * Colours come from the semantic ramps in styles/theme.css. The SEMANTIC scale
 * is 50/100/500/700/800 only, which is why the borders are -100 and not -200.
 */

export const OUTCOME_TONE_CLASS: Record<DayOutcomeTone, string> = {
  clear: 'border-success-100 bg-success-50 text-success-800',
  info: 'border-info-100 bg-info-50 text-info-800',
  warning: 'border-warning-100 bg-warning-50 text-warning-800',
  danger: 'border-danger-100 bg-danger-50 text-danger-700',
  off: 'border-slate-300 bg-slate-100 text-slate-600',
  muted: 'border-slate-100 bg-white text-slate-500',
};

/** The chips for one day. Each keeps its own tone — never a shared one. */
export function OutcomeChips({ chips, className = '' }: { chips: DayOutcomeChip[]; className?: string }) {
  if (chips.length === 0) return null;

  return (
    <span className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {chips.map((chip) => (
        <span
          key={chip.key}
          title={chip.title}
          className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${OUTCOME_TONE_CLASS[chip.tone]}`}
        >
          {chip.label}
        </span>
      ))}
    </span>
  );
}

const formatDayLabel = (iso: string): string => {
  const parsed = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return iso;

  return parsed.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
};

export interface DayOutcomeLedgerProps {
  days: DayOutcomePayload[];
  isLoading: boolean;
  /** Whose month this is, when it is not the reader's own. */
  personName?: string | null;
}

export default function DayOutcomeLedger({ days, isLoading, personName }: DayOutcomeLedgerProps) {
  const rows = useMemo(
    () =>
      days
        .map((day) => ({ day, view: describeDayOutcome(day) }))
        // An exception is a day that cost something, a day nobody accounted
        // for, or hours waiting on somebody's decision.
        .filter(({ view }) => view.isAbsence || view.reason !== null || view.chips.length > 0),
    [days],
  );

  return (
    <SurfaceCard className="p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-semibold text-gray-900">
          What this month cost{personName ? ` — ${personName}` : ''}
        </h2>
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {rows.length} to review
        </span>
      </div>

      {isLoading ? (
        <p className="py-6 text-sm text-slate-500">Working out the month...</p>
      ) : rows.length === 0 ? (
        <p className="flex items-center gap-2 py-6 text-sm text-slate-500">
          <ShieldCheck className="h-4 w-4 shrink-0 text-success-700" />
          No penalties, no unapproved overtime — nothing to answer for this month.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.map(({ day, view }) => (
            <li key={String(day.date)} data-testid={`day-outcome-${day.date}`} className="py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-24 shrink-0 text-xs font-semibold tabular-nums text-slate-500">
                  {formatDayLabel(String(day.date))}
                </span>
                <span
                  className={`rounded-md border px-2 py-0.5 text-xs font-bold ${OUTCOME_TONE_CLASS[view.tone]}`}
                >
                  {view.headline || 'Unaccounted'}
                </span>
                <OutcomeChips chips={view.chips} />
              </div>
              {view.reason ? (
                <p className="mt-1 pl-[6.5rem] text-[11px] leading-4 text-slate-600">{view.reason}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </SurfaceCard>
  );
}
