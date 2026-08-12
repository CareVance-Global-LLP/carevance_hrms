import { cn } from '@/utils/cn';
import type { ProjectBurn } from './projectUtils';

const TONE_FILL: Record<ProjectBurn['tone'], string> = {
  good: 'bg-emerald-500',
  warn: 'bg-amber-500',
  over: 'bg-rose-500',
  none: 'bg-slate-400',
};

/**
 * Two facts on one axis: the fill is budget consumed, the tick is how far
 * through the schedule the project is. When the fill has passed the tick the
 * project is burning faster than the calendar — which you can read across
 * twenty rows at a glance, and could never read from a card.
 */
export default function ProjectBurnBar({ burn, label }: { burn: ProjectBurn; label: string }) {
  // Over-budget bars stay full and turn red rather than overflowing the track;
  // the exact percentage is printed next to the bar.
  const fillWidth = burn.percent === null ? 0 : Math.min(100, Math.max(0, burn.percent));

  return (
    <div className="flex min-w-[10rem] items-center gap-2">
      <div
        className="relative h-4 w-full overflow-hidden rounded bg-slate-100"
        role="img"
        aria-label={label}
      >
        {burn.unavailable !== null ? (
          // The track is only 10rem wide, so both states get two words. A money
          // budget with no rate is a different problem from no budget at all —
          // the figure is there, nothing can price hours against it yet.
          <div
            className="flex h-full items-center pl-2 text-[10px] text-slate-600"
            title={
              burn.unavailable === 'no-rate'
                ? 'Set an hourly rate to measure spend against this budget.'
                : undefined
            }
          >
            {burn.unavailable === 'no-rate' ? 'Rate needed' : 'No budget set'}
          </div>
        ) : (
          <div className={cn('h-full rounded-l transition-all', TONE_FILL[burn.tone])} style={{ width: `${fillWidth}%` }} />
        )}

        {burn.elapsedPercent !== null ? (
          <span
            aria-hidden="true"
            title="Deadline position"
            className="absolute inset-y-0 w-0.5 bg-slate-900"
            style={{ left: `${burn.elapsedPercent}%` }}
          />
        ) : null}
      </div>

      <span
        className={cn(
          'w-12 shrink-0 text-right text-xs tabular-nums',
          burn.tone === 'over' ? 'font-semibold text-rose-700' : 'text-slate-600'
        )}
      >
        {burn.percent === null ? '—' : `${burn.percent}%`}
      </span>
    </div>
  );
}
