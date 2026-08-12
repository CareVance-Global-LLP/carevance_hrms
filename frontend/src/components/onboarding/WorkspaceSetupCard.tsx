import { Link } from 'react-router-dom';
import { ArrowRight, Check, Compass, X } from 'lucide-react';
import { useWorkspaceOnboarding } from '@/hooks/useWorkspaceOnboarding';
import { useProductTour } from '@/features/tour/useProductTour';
import { TOUR_ANCHORS } from '@/features/tour/tourSteps';
import { reportSilentError } from '@/lib/reportSilentError';

/**
 * "Get your workspace ready" — the first thing a new owner sees.
 *
 * Replaces a dashboard of ~20 empty analytics cards that told a brand-new
 * workspace nothing about what to do next. Steps derive their own completion
 * server-side, so this reflects the workspace rather than a list of boxes
 * somebody has to remember to tick.
 */
export default function WorkspaceSetupCard() {
  const { status, isVisible, hasSeenTour, dismiss, markTourSeen, isMutating } = useWorkspaceOnboarding();

  const { start: startTour } = useProductTour({
    includesPayroll: !!status?.includes_payroll,
    hasSeenTour,
    isReady: isVisible,
    onSeen: markTourSeen,
  });

  if (!isVisible || !status) {
    return null;
  }

  const stepKeys = Object.keys(status.steps);
  const { completed_count: done, total_count: total, completion_percentage: percent } = status;

  const handleDismiss = () => {
    dismiss().catch((error) => reportSilentError('workspace setup: dismiss failed', error));
  };

  return (
    // Same shell as AdminDashboard's local Card, which is defined inside that
    // page rather than shared — duplicated here rather than exported, to avoid
    // reshaping a 3,000-line file for one card.
    <section
      data-tour={TOUR_ANCHORS.setupCard}
      className="scroll-mt-24 rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-blue-700">Getting started</p>
          <h2 className="mt-1 text-lg font-semibold text-slate-950">Get your workspace ready</h2>
          <p className="mt-1 text-sm text-slate-600">
            {done} of {total} done. Each step completes itself once the work behind it is done.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={startTour}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
          >
            <Compass className="h-3.5 w-3.5" />
            Take the tour
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            disabled={isMutating}
            aria-label="Hide the setup checklist"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:text-slate-800 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-blue-600 transition-[width] duration-500"
          style={{ width: `${percent}%` }}
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Workspace setup progress"
        />
      </div>

      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {stepKeys.map((key) => {
          const complete = status.steps[key];
          const label = status.step_labels[key] ?? key;
          const route = status.step_routes[key];

          const body = (
            <>
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                  complete ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 bg-white'
                }`}
              >
                {complete ? <Check className="h-3 w-3" /> : null}
              </span>
              <span className={`min-w-0 flex-1 truncate ${complete ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
                {label}
              </span>
              {!complete && route ? (
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-blue-600" />
              ) : null}
            </>
          );

          const className = `group flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm transition ${
            complete
              ? 'border-slate-100 bg-slate-50/60'
              : 'border-slate-200 bg-white hover:border-blue-200 hover:bg-blue-50/40'
          }`;

          return (
            <li key={key}>
              {complete || !route ? (
                <div className={className}>{body}</div>
              ) : (
                <Link to={route} className={className}>
                  {body}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
