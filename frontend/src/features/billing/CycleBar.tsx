import { cn } from '@/utils/cn';
import type { BillingSnapshot } from '@/types';

type Cycle = NonNullable<BillingSnapshot['cycle']>;

const formatDate = (value?: string | null) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

/**
 * How far through the paid period this workspace is. The page previously showed
 * only a renewal date, which says nothing about how much of the cycle is left.
 */
export default function CycleBar({ cycle }: { cycle: Cycle }) {
  const total = cycle.cycle_length_days ?? null;
  const remaining = cycle.days_remaining ?? null;

  const elapsed = total !== null && remaining !== null ? Math.max(0, total - remaining) : null;
  const percent = total && elapsed !== null ? Math.min(100, Math.max(0, (elapsed / total) * 100)) : 0;

  const isPastDue = cycle.state === 'past_due';
  const isExpired = cycle.state === 'expired';
  const isClosing = remaining !== null && remaining <= 7 && remaining >= 0;

  const fillTone = isPastDue || isExpired ? 'bg-rose-600' : isClosing ? 'bg-amber-500' : 'bg-blue-600';

  return (
    <div>
      <div className="relative h-2 overflow-hidden rounded-full border border-slate-200 bg-surface-sunken">
        <div
          className={cn('absolute inset-y-0 left-0 rounded-full transition-[width] duration-500', fillTone)}
          style={{ width: `${isPastDue || isExpired ? 100 : percent}%` }}
        />
      </div>

      <div className="mt-2 flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs text-slate-600">
        <span>
          {formatDate(cycle.period_start) ? <>Started <span className="font-semibold text-slate-900">{formatDate(cycle.period_start)}</span></> : 'Period start unknown'}
        </span>
        <span>
          {formatDate(cycle.period_end)
            ? <>{isExpired || isPastDue ? 'Was due' : 'Renews'} <span className="font-semibold text-slate-900">{formatDate(cycle.period_end)}</span></>
            : 'No renewal date set'}
        </span>
      </div>

      {total !== null && remaining !== null ? (
        <p className="mt-2 text-xs text-slate-600">
          {remaining >= 0 ? (
            <>
              Day <span className="tabular-nums">{Math.min(elapsed ?? 0, total)}</span> of{' '}
              <span className="tabular-nums">{total}</span>.{' '}
              <span className={cn('font-semibold', isClosing ? 'text-amber-700' : 'text-slate-900')}>
                {remaining} day{remaining === 1 ? '' : 's'}
              </span>{' '}
              remain in this cycle.
            </>
          ) : (
            <span className="font-semibold text-rose-700">
              {Math.abs(remaining)} day{Math.abs(remaining) === 1 ? '' : 's'} past the renewal date.
            </span>
          )}
        </p>
      ) : null}
    </div>
  );
}
