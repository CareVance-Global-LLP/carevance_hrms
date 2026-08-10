import { AlertTriangle, CheckCircle2, ShieldCheck, XCircle } from 'lucide-react';
import { cn } from '@/utils/cn';

/**
 * "Would payroll actually pay this person?" — as a computed answer, not a
 * ticked box.
 *
 * The onboarding checklist can say "Upload PAN card ✓" while the PAN is
 * malformed, duplicated, or the bank line is missing an IFSC. That gap only
 * shows up on payday. This card surfaces the same facts payroll itself checks,
 * so the problem is visible while there is still time to fix it.
 */

export interface ReadinessCheck {
  key: string;
  label: string;
  passed: boolean;
  severity: 'blocker' | 'warning';
  detail: string;
}

export interface PayrollReadiness {
  ready: boolean;
  score: number;
  checks: ReadinessCheck[];
  blockers: number;
  warnings: number;
}

function Verdict({ readiness }: { readiness: PayrollReadiness }) {
  if (readiness.ready && readiness.warnings === 0) {
    return (
      <div className="flex items-center gap-2.5">
        <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
        <div>
          <p className="text-sm font-semibold text-slate-900">Payroll-ready</p>
          <p className="text-xs text-slate-600">Every statutory and banking detail checks out.</p>
        </div>
      </div>
    );
  }

  if (readiness.ready) {
    return (
      <div className="flex items-center gap-2.5">
        <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
        <div>
          <p className="text-sm font-semibold text-slate-900">Will be paid</p>
          <p className="text-xs text-slate-600">
            {readiness.warnings} filing {readiness.warnings === 1 ? 'issue' : 'issues'} to resolve —
            salary is unaffected.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2.5">
      <XCircle className="h-5 w-5 shrink-0 text-rose-600" aria-hidden="true" />
      <div>
        <p className="text-sm font-semibold text-slate-900">Not payroll-ready</p>
        <p className="text-xs text-slate-600">
          {readiness.blockers} {readiness.blockers === 1 ? 'issue blocks' : 'issues block'} their
          first salary run.
        </p>
      </div>
    </div>
  );
}

export default function PayrollReadinessCard({
  readiness,
  className,
}: {
  readiness?: PayrollReadiness | null;
  className?: string;
}) {
  if (!readiness || !Array.isArray(readiness.checks) || readiness.checks.length === 0) {
    return null;
  }

  const failing = readiness.checks.filter((c) => !c.passed);
  const passing = readiness.checks.filter((c) => c.passed);

  // Blockers first — they are the ones that stop money moving.
  const ordered = [
    ...failing.filter((c) => c.severity === 'blocker'),
    ...failing.filter((c) => c.severity === 'warning'),
    ...passing,
  ];

  const tone = readiness.ready
    ? readiness.warnings === 0
      ? 'border-l-emerald-500'
      : 'border-l-amber-500'
    : 'border-l-rose-500';

  return (
    <section
      className={cn(
        'rounded-lg border border-l-[3px] border-slate-200 bg-white p-5 shadow-sm',
        tone,
        className,
      )}
      aria-labelledby="payroll-readiness-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p
            id="payroll-readiness-heading"
            className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700"
          >
            Payroll Readiness
          </p>
          <div className="mt-3">
            <Verdict readiness={readiness} />
          </div>
        </div>

        <div className="text-right">
          <p className="font-mono text-2xl font-bold tabular-nums text-slate-900">
            {readiness.score}%
          </p>
          <p className="text-[11px] text-slate-600">
            {passing.length} of {readiness.checks.length} checks
          </p>
        </div>
      </div>

      {/* Segment per check rather than one filled bar: which checks pass matters
          more than the aggregate, and a blocker should never be averaged away. */}
      <div className="mt-4 flex gap-1" role="img" aria-label={`${readiness.score}% of payroll checks passing`}>
        {ordered.map((check) => (
          <span
            key={check.key}
            className={cn(
              'h-1.5 flex-1 rounded-full',
              check.passed
                ? 'bg-emerald-500'
                : check.severity === 'blocker'
                  ? 'bg-rose-500'
                  : 'bg-amber-500',
            )}
          />
        ))}
      </div>

      <ul className="mt-4 divide-y divide-slate-100">
        {ordered.map((check) => (
          <li key={check.key} className="flex items-start gap-3 py-2.5">
            <span className="mt-0.5 shrink-0" aria-hidden="true">
              {check.passed ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              ) : check.severity === 'blocker' ? (
                <XCircle className="h-4 w-4 text-rose-600" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-amber-600" />
              )}
            </span>

            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    'text-sm',
                    check.passed ? 'text-slate-700' : 'font-semibold text-slate-900',
                  )}
                >
                  {check.label}
                </span>
                {!check.passed && check.severity === 'blocker' ? (
                  <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-rose-700">
                    Blocks pay
                  </span>
                ) : null}
                {!check.passed && check.severity === 'warning' ? (
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700">
                    Filing risk
                  </span>
                ) : null}
              </span>
              <span className="mt-0.5 block break-words text-xs text-slate-600">
                {check.detail}
              </span>
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-3 border-t border-slate-100 pt-3 text-[11px] text-slate-600">
        Checked live against the same rules payroll uses — not from a completed checklist item.
      </p>
    </section>
  );
}
