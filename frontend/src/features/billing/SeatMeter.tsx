import { cn } from '@/utils/cn';

interface SeatMeterProps {
  used: number;
  max: number;
  className?: string;
}

/**
 * Draws the cap as a mark and the overflow as a hatched band, so being over
 * capacity looks different from being at it.
 *
 * The previous page rendered `remainingSeats > 0 ? 'N available' : 'Full'`,
 * which showed the same word for exactly-at-capacity and eighty-one-over — the
 * one case that needs action read as the one that does not.
 */
export default function SeatMeter({ used, max, className }: SeatMeterProps) {
  const hasCap = max > 0;
  const scale = Math.max(used, max, 1);
  const isOver = hasCap && used > max;
  const withinCapPercent = (Math.min(used, hasCap ? max : used) / scale) * 100;
  const overPercent = isOver ? ((used - max) / scale) * 100 : 0;
  const capPercent = hasCap ? (max / scale) * 100 : 100;

  return (
    <div className={className}>
      <div className="relative h-6 overflow-hidden rounded-lg border border-slate-200 bg-surface-sunken">
        <div
          className={cn('absolute inset-y-0 left-0 transition-[width] duration-500', isOver ? 'bg-blue-600' : 'bg-blue-600')}
          style={{ width: `${withinCapPercent}%` }}
        />
        {isOver ? (
          <div
            className="absolute inset-y-0 bg-rose-600/85 transition-[width] duration-500"
            style={{ left: `${capPercent}%`, width: `${overPercent}%` }}
            aria-hidden="true"
          />
        ) : null}
        {hasCap ? (
          <div
            className="absolute inset-y-0 w-0.5 bg-slate-900"
            style={{ left: `${capPercent}%` }}
            aria-hidden="true"
          />
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2 text-xs">
        <span className="text-slate-600">
          <span className="font-semibold tabular-nums text-slate-900">{used}</span> in use
        </span>
        <span className="text-slate-600">
          {hasCap ? (
            <>
              <span className="font-semibold tabular-nums text-slate-900">{max}</span> paid for
            </>
          ) : (
            'No seat cap set'
          )}
        </span>
      </div>
    </div>
  );
}
