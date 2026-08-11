interface CompletenessRingProps {
  filled: number;
  total: number;
  onJump?: () => void;
  jumpLabel?: string;
}

const RADIUS = 18;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * How much of the personal profile is actually filled in. It exists because
 * emergency contacts were empty across the whole org and nothing on the page
 * ever said so.
 */
export default function CompletenessRing({ filled, total, onJump, jumpLabel = 'Jump to the first gap' }: CompletenessRingProps) {
  const safeTotal = Math.max(total, 1);
  const percent = Math.round((filled / safeTotal) * 100);
  const remaining = Math.max(safeTotal - filled, 0);

  return (
    <div className="flex items-center gap-3">
      <svg viewBox="0 0 44 44" className="h-14 w-14 -rotate-90" role="img" aria-label={`Profile ${percent} percent complete`}>
        <circle cx="22" cy="22" r={RADIUS} fill="none" strokeWidth="5" className="stroke-slate-200" />
        <circle
          cx="22"
          cy="22"
          r={RADIUS}
          fill="none"
          strokeWidth="5"
          strokeLinecap="round"
          className="stroke-blue-600 transition-[stroke-dasharray] duration-500"
          strokeDasharray={`${(CIRCUMFERENCE * percent) / 100} ${CIRCUMFERENCE}`}
        />
      </svg>
      <div>
        <p className="text-sm font-semibold text-slate-900">{percent}% complete</p>
        <p className="text-xs text-slate-600">
          {remaining === 0 ? 'Nothing missing' : `${remaining} detail${remaining === 1 ? '' : 's'} left`}
        </p>
        {remaining > 0 && onJump ? (
          <button
            type="button"
            onClick={onJump}
            className="mt-0.5 text-xs font-semibold text-blue-700 underline-offset-2 hover:underline"
          >
            {jumpLabel} →
          </button>
        ) : null}
      </div>
    </div>
  );
}
