import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/utils/cn';

export interface ReportSummary {
  value: number;
  unit: string;
  delta: number;
  delta_direction: 'up' | 'down';
  delta_label?: string;
  sparkline: number[];
  hint?: string;
}

interface ReportTileProps {
  title: string;
  description: string;
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  summary?: ReportSummary;
}

function Sparkline({ points }: { points: number[] }) {
  const max = Math.max(1, ...points);

  return (
    <span className="flex h-6 items-end gap-0.5" aria-hidden="true">
      {points.map((point, index) => (
        <span
          key={index}
          className={cn('flex-1 rounded-sm bg-blue-600', index === points.length - 1 ? 'opacity-100' : 'opacity-40')}
          style={{ height: `${Math.max(8, (point / max) * 100)}%` }}
        />
      ))}
    </span>
  );
}

/**
 * A report tile that says what the report currently reports.
 *
 * These used to be link cards carrying a title, a sentence and three decorative
 * chips — nothing that would tell you whether opening the report was worth it.
 * When the summary is missing (the figure failed, or the viewer cannot see that
 * report) the tile falls back to exactly what it used to be.
 */
export default function ReportTile({ title, description, to, icon: Icon, summary }: ReportTileProps) {
  // `delta_direction` is sentiment, not arithmetic — the endpoint already knows
  // that more overdue tasks is bad news while more tracked hours is not. An
  // extra "higher is better" flag here just double-negated it and painted
  // "17 overdue" green.
  const deltaIsGood = summary?.delta_direction === 'up';
  const hasDelta = Boolean(summary && (summary.delta !== 0 || summary.delta_label));

  return (
    <Link
      to={to}
      className="group flex flex-col gap-2.5 rounded-lg border border-slate-200 bg-surface-card p-4 transition hover:border-blue-300 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-950">{title}</h2>
        <Icon className="h-4 w-4 shrink-0 text-slate-600" />
      </div>

      {summary ? (
        <>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold tabular-nums tracking-[-0.02em] text-slate-950">
              {summary.value.toLocaleString()}
              {summary.unit}
            </span>
            {hasDelta ? (
              <span
                className={cn(
                  'text-xs font-medium tabular-nums',
                  deltaIsGood ? 'text-emerald-700' : 'text-rose-700'
                )}
              >
                {summary.delta_label
                  ? summary.delta_label
                  : `${summary.delta > 0 ? '+' : ''}${summary.delta.toLocaleString()}${summary.unit}`}
              </span>
            ) : null}
          </div>

          {summary.sparkline.length > 0 ? <Sparkline points={summary.sparkline} /> : null}

          <p className="text-xs text-slate-600">{summary.hint || description}</p>
        </>
      ) : (
        <p className="text-xs leading-5 text-slate-600">{description}</p>
      )}

      <span className="mt-auto inline-flex items-center gap-1.5 pt-1 text-xs font-semibold text-blue-700">
        Open
        <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" aria-hidden="true" />
      </span>
    </Link>
  );
}
