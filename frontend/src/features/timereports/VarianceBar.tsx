import { cn } from '@/utils/cn';

/**
 * A diverging bar with the estimate as its zero line: growth to the left means
 * the work came in under, to the right means it ran over.
 *
 * Every bar on the old page was `Math.min(100, …)`, so a task at 320% of its
 * estimate rendered identically to one that landed exactly on target — the page
 * clamped away the only thing it existed to show.
 */
export default function VarianceBar({
  percent,
  scale = 100,
  height = 'md',
  label,
}: {
  /** Signed deviation from the estimate. Null when there is nothing to compare. */
  percent: number | null;
  /** Deviation, in percent, that fills half the track. Overruns beyond it clip. */
  scale?: number;
  height?: 'sm' | 'md';
  label?: string;
}) {
  const trackHeight = height === 'sm' ? 'h-3.5' : 'h-4';

  if (percent === null) {
    return (
      <div className={cn('flex items-center', trackHeight)}>
        <span className="text-xs text-slate-600">No estimate</span>
      </div>
    );
  }

  const magnitude = Math.min(50, (Math.abs(percent) / scale) * 50);
  const isOver = percent > 0;
  const clipped = Math.abs(percent) / scale > 1;

  return (
    <div
      className={cn('relative w-full min-w-[8rem] overflow-hidden rounded bg-slate-100', trackHeight)}
      role="img"
      aria-label={label ?? `${percent > 0 ? 'Over' : 'Under'} estimate by ${Math.abs(percent)}%`}
    >
      {/* Zero line — the estimate itself. */}
      <span aria-hidden="true" className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-slate-400" />

      <span
        aria-hidden="true"
        className={cn(
          'absolute inset-y-0.5 block rounded-sm',
          isOver ? 'bg-rose-500' : 'bg-emerald-500',
          // A bar that has run past the end of the track gets a flat edge, so
          // "off the scale" is visible rather than silently maxed out.
          clipped ? (isOver ? 'rounded-r-none' : 'rounded-l-none') : ''
        )}
        style={
          isOver
            ? { left: '50%', width: `${magnitude}%` }
            : { right: '50%', width: `${magnitude}%` }
        }
      />
    </div>
  );
}
