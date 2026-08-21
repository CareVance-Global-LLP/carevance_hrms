import {
  EMPLOYEE,
  PERIOD,
  EARNINGS,
  DEDUCTIONS,
  EMPLOYER_COST,
  GROSS,
  TOTAL_DEDUCTIONS,
  NET_PAY,
  TRACKED,
  ATTENDANCE,
  RUN_ROSTER,
  RUN_STAGES,
  OVERRIDE_EXAMPLE,
  OVERRIDE_REFUSAL,
  DIFFERENCES,
  FILINGS,
  inr,
  num,
} from '@/lib/demo';
import { Panel, TrackerWindow, PhoneFrame } from '@/components/product/Frame';
import { cn } from '@/components/ui/primitives';

/**
 * The product, rebuilt as components.
 *
 * These are not illustrations and not screenshots — they are the real screens
 * reconstructed from the app's own tokens and layout rules, which buys three
 * things a PNG cannot: they are correct in dark mode without a second asset,
 * they stay sharp at any density, and the hero chain can animate their actual
 * nodes rather than cross-fading pictures of them.
 *
 * All server components. Nothing here ships JavaScript, and every figure lands
 * in the server-rendered HTML where a crawler — and an answer engine — reads it.
 */

/* ── Stage 1 · the tracker ────────────────────────────────────────────── */

export function TrackerCapture({ className }: { className?: string }) {
  return (
    <TrackerWindow className={className}>
      <div className="p-4">
        <div className="flex items-baseline justify-between">
          <div>
            <p className="text-[10px] font-semibold tracking-[0.08em] text-white/70 uppercase">
              {TRACKED.dateShort}
            </p>
            <p className="mt-1 font-display text-2xl font-bold text-white tnum">{TRACKED.hours}</p>
          </div>
          <span className="rounded-md bg-emerald-500/15 px-2 py-1 text-[11px] font-semibold text-emerald-300 tnum">
            {TRACKED.activeShare}% active
          </span>
        </div>

        {/* Activity strip — the day, classified. */}
        <div className="mt-3 flex h-1.5 gap-px overflow-hidden rounded-full" aria-hidden="true">
          {[
            ...Array<number>(17).fill(1),
            0,
            ...Array<number>(4).fill(1),
            2,
            ...Array<number>(8).fill(1),
          ].map((kind, i) => (
            <span
              key={i}
              className={cn(
                'flex-1',
                kind === 1 && 'bg-emerald-400/80',
                kind === 2 && 'bg-white/25',
                kind === 0 && 'bg-accent-400/70'
              )}
            />
          ))}
        </div>

        <ul className="mt-3.5 grid gap-1.5">
          {TRACKED.captures.map((c) => (
            <li key={c.at} className="flex items-center gap-2.5 text-[11.5px]">
              <span className="w-9 shrink-0 text-white/70 tnum">{c.at}</span>
              <span
                className={cn(
                  'h-1.5 w-1.5 shrink-0 rounded-full',
                  c.kind === 'productive' ? 'bg-emerald-400' : 'bg-white/35'
                )}
                aria-hidden="true"
              />
              <span className="text-white/80">{c.app}</span>
              <span className="ml-auto text-white/70">screenshot</span>
            </li>
          ))}
        </ul>

        <p className="mt-3.5 border-t border-white/10 pt-2.5 text-[11px] leading-4 text-white/70">
          <span className="font-semibold text-accent-400">{TRACKED.idleRecovered} idle</span>{' '}
          rewound to the last real activity — recorded, not billed.
        </p>
      </div>
    </TrackerWindow>
  );
}

/* ── Stage 2 · attendance ─────────────────────────────────────────────── */

export function AttendanceMonth({ className }: { className?: string }) {
  return (
    <Panel label={`Attendance · ${PERIOD.monthShort}`} className={className}>
      <div className="p-4">
        <div className="flex items-baseline gap-2">
          <p className="font-display text-data text-n-900 tnum">
            {ATTENDANCE.present}/{ATTENDANCE.workingDays}
          </p>
          <p className="text-sm text-n-600">days present</p>
        </div>

        {/* The month, as the calendar strip the product renders. */}
        <div className="mt-3 grid grid-cols-11 gap-1" aria-hidden="true">
          {Array.from({ length: 31 }, (_, i) => {
            const day = i + 1;
            const dow = (day + 4) % 7; // 1 Aug 2026 is a Saturday
            const weekend = dow === 0 || dow === 6;
            return (
              <span
                key={day}
                className={cn(
                  'h-4 rounded-[3px]',
                  weekend ? 'bg-n-100' : 'bg-brand-400/70'
                )}
              />
            );
          })}
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-n-200 pt-3 text-[12.5px]">
          <div className="flex justify-between">
            <dt className="text-n-600">Hours</dt>
            <dd className="font-semibold text-n-800 tnum">{ATTENDANCE.totalHours}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-n-600">Loss of pay</dt>
            <dd className="font-semibold text-n-800 tnum">{ATTENDANCE.lop} days</dd>
          </div>
          <div className="col-span-2 flex justify-between">
            <dt className="text-n-600">Shift</dt>
            <dd className="font-medium text-n-700">{ATTENDANCE.shift}</dd>
          </div>
        </dl>

        <p className="mt-3 rounded-lg bg-brand-50 px-3 py-2 text-[11.5px] leading-4 text-brand-800">
          Synced to the {PERIOD.monthShort} payroll run — no export.
        </p>
      </div>
    </Panel>
  );
}

/* ── Stage 3 · the payroll run ────────────────────────────────────────── */

export function PayrollRun({
  className,
  highlight = EMPLOYEE.name,
}: {
  className?: string;
  highlight?: string;
}) {
  return (
    <Panel
      label={`Payroll run · ${PERIOD.month}`}
      className={className}
      toolbar={
        <span className="rounded-md bg-accent-100 px-2 py-0.5 text-[10.5px] font-semibold text-accent-700">
          Approved
        </span>
      }
    >
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="border-b border-n-200 text-left text-n-600">
            <th scope="col" className="px-4 py-2 font-medium">
              Employee
            </th>
            <th scope="col" className="px-2 py-2 text-right font-medium">
              Gross ₹
            </th>
            <th scope="col" className="px-4 py-2 text-right font-medium">
              Net ₹
            </th>
          </tr>
        </thead>
        <tbody>
          {RUN_ROSTER.map((row) => (
            <tr
              key={row.code}
              className={cn(
                'border-b border-n-100 last:border-0',
                row.name === highlight && 'bg-brand-50'
              )}
            >
              <td className="px-4 py-2.5">
                <span className="block font-semibold text-n-900">{row.name}</span>
                <span className="block text-[11px] text-n-600">
                  {row.code} · {row.dept}
                </span>
              </td>
              <td className="px-2 py-2.5 text-right text-n-700 tnum">{num(row.gross)}</td>
              <td className="px-4 py-2.5 text-right font-semibold text-n-900 tnum">
                {num(row.net)}
                {row.flagged && (
                  <span
                    className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-accent-400 align-middle"
                    title="Excluded from disbursement — bank details missing"
                  />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="border-t border-n-200 bg-sunken px-4 py-2 text-[11px] text-n-600">
        1 person excluded from the bank file — bank details missing. Returned as an exclusion,
        never dropped.
      </p>
    </Panel>
  );
}

/* ── Stage 4 · statutory ──────────────────────────────────────────────── */

export function StatutoryBreakdown({ className }: { className?: string }) {
  return (
    <Panel label="Statutory · this run" className={className}>
      <ul className="divide-y divide-n-100">
        {DEDUCTIONS.map((d) => (
          <li key={d.label} data-claim={d.claim} className="flex items-baseline gap-3 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12.5px] font-semibold text-n-900">{d.label}</p>
              <p className="truncate text-[11px] text-n-600">{d.note}</p>
            </div>
            <p
              className={cn(
                'shrink-0 text-[12.5px] font-semibold tnum',
                d.amount === 0 ? 'text-n-500' : 'text-n-900'
              )}
            >
              {d.amount === 0 ? '—' : inr(d.amount, true)}
            </p>
          </li>
        ))}
      </ul>
      <div className="flex items-baseline justify-between border-t border-n-200 bg-sunken px-4 py-2.5">
        <p className="text-[12.5px] font-semibold text-n-700">Total deductions</p>
        <p className="text-[12.5px] font-bold text-n-900 tnum">{inr(TOTAL_DEDUCTIONS, true)}</p>
      </div>
    </Panel>
  );
}

/* ── Stage 5 · the payslip ────────────────────────────────────────────── */

export function Payslip({ className }: { className?: string }) {
  return (
    <Panel label={`Payslip · ${PERIOD.monthShort}`} className={className}>
      <div className="px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-100 text-[11px] font-bold text-brand-800">
            {EMPLOYEE.initials}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold text-n-900">{EMPLOYEE.name}</p>
            <p className="truncate text-[11px] text-n-600">
              {EMPLOYEE.code} · {EMPLOYEE.designation}
            </p>
          </div>
        </div>

        <dl className="mt-3 grid gap-1 border-t border-n-100 pt-3 text-[12px]">
          {EARNINGS.map((e) => (
            <div key={e.label} className="flex items-baseline justify-between gap-3">
              <dt className={cn('truncate text-n-600', e.isResidual && 'text-brand-700')}>
                {e.label}
                {e.isResidual && (
                  <span className="ml-1.5 rounded bg-brand-100 px-1 py-px text-[9.5px] font-semibold tracking-wide text-brand-800 uppercase">
                    residual
                  </span>
                )}
              </dt>
              <dd className="shrink-0 text-n-800 tnum">{num(e.amount, true)}</dd>
            </div>
          ))}
          <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-n-100 pt-1.5">
            <dt className="font-semibold text-n-700">Gross</dt>
            <dd className="font-semibold text-n-900 tnum">{num(GROSS, true)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-n-600">Deductions</dt>
            <dd className="text-rose-700 tnum">−{num(TOTAL_DEDUCTIONS, true)}</dd>
          </div>
        </dl>
      </div>

      <div className="flex items-baseline justify-between border-t border-n-200 bg-brand-50 px-4 py-3">
        <p className="text-[11px] font-semibold tracking-[0.06em] text-brand-800 uppercase">
          Net pay
        </p>
        <p className="font-display text-lg font-bold text-brand-900 tnum">{inr(NET_PAY, true)}</p>
      </div>
    </Panel>
  );
}

/* ── The explainability screens ───────────────────────────────────────── */

export function OverrideRegister({ className }: { className?: string }) {
  const o = OVERRIDE_EXAMPLE;
  return (
    <Panel
      label="Override register"
      className={className}
      toolbar={
        <span className="rounded-md bg-n-100 px-2 py-0.5 text-[10.5px] font-semibold text-n-600">
          Awaiting approval
        </span>
      }
    >
      <div className="p-4">
        <div className="grid grid-cols-[1fr_auto] items-baseline gap-x-4 gap-y-2 text-[12.5px]">
          <p className="text-n-600">Component</p>
          <p className="font-semibold text-n-900">{o.component}</p>

          <p className="text-n-600">Applied value</p>
          <p className="font-semibold text-n-900 tnum">{inr(o.requested)}</p>

          {/*
            `computed_value` beside `value` is the whole point of the register:
            competitors show what changed, this shows what the engine would have
            produced and therefore what the change actually did.
          */}
          <p className="text-n-600">Engine value</p>
          <p className="text-n-600 line-through tnum">{inr(o.current)}</p>
        </div>

        <div className="mt-3.5 rounded-lg border border-accent-200 bg-accent-50 p-3">
          <p className="text-[11px] font-semibold tracking-[0.06em] text-accent-700 uppercase">
            Amplification · {o.amplification}×
          </p>
          <p className="mt-1.5 text-[12px] leading-5 text-n-700">
            Raising Basic by <b className="tnum">{inr(o.delta)}</b> costs{' '}
            <b className="tnum">{inr(o.trueCost)}</b>. HRA is derived from Basic, and employer PF
            and the gratuity provision sit inside the CTC envelope — four figures move together.
          </p>
          <p className="mt-2 flex items-baseline justify-between border-t border-accent-200/70 pt-2 text-[11.5px]">
            <span className="text-n-600">{o.absorbedBy}</span>
            <span className="tnum text-n-700">
              {num(o.residualBefore, true)} → <b className="text-n-900">{num(o.residualAfter, true)}</b>
            </span>
          </p>
        </div>
      </div>
    </Panel>
  );
}

/** The refusal. The thing no competitor documents. */
export function OverrideRefusal({ className }: { className?: string }) {
  const r = OVERRIDE_REFUSAL;
  return (
    <Panel label="Override · refused at entry" className={className}>
      <div className="p-4">
        <div className="flex items-baseline justify-between text-[12.5px]">
          <p className="text-n-600">Requested Basic</p>
          <p className="font-semibold text-n-900 tnum">{inr(r.requested)}</p>
        </div>

        <div className="mt-3 rounded-lg border border-danger-500/30 bg-danger-50 p-3">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.06em] text-danger-700 uppercase">
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <circle cx="8" cy="8" r="6.4" />
              <path d="M8 5v3.5M8 11h.01" strokeLinecap="round" />
            </svg>
            Cannot be applied
          </p>
          <p className="mt-1.5 text-[12px] leading-5 text-n-800">{r.message}</p>
          <p className="mt-2 border-t border-danger-500/20 pt-2 text-[11.5px] text-n-600">
            Special Allowance would fall to{' '}
            <b className="text-danger-700 tnum">{inr(r.wouldLeave, true)}</b>. A negative residual
            is refused here, at the screen, not weeks later at finalisation.
          </p>
        </div>
      </div>
    </Panel>
  );
}

export function DifferencesReport({ className }: { className?: string }) {
  return (
    <Panel label="Differences · Aug → Sep" className={className}>
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b border-n-200 text-left text-n-600">
            <th scope="col" className="px-4 py-2 font-medium">Component</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">Change</th>
            <th scope="col" className="px-4 py-2 font-medium">Why</th>
          </tr>
        </thead>
        <tbody>
          {DIFFERENCES.map((d) => {
            const delta = d.to - d.from;
            return (
              <tr key={d.component} className="border-b border-n-100 last:border-0 align-top">
                <td className="px-4 py-2 font-medium text-n-800">{d.component}</td>
                <td
                  className={cn(
                    'px-2 py-2 text-right font-semibold tnum',
                    delta === 0 && 'text-n-500',
                    delta > 0 && 'text-emerald-700',
                    delta < 0 && 'text-rose-700'
                  )}
                >
                  {delta === 0 ? '—' : `${delta > 0 ? '+' : '−'}${num(Math.abs(delta))}`}
                </td>
                <td className="px-4 py-2 text-[11.5px] text-n-600">{d.reason ?? '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Panel>
  );
}

export function RunLifecycle({ className }: { className?: string }) {
  return (
    <Panel label="Run status" className={className}>
      <ol className="flex items-center gap-1 p-4">
        {RUN_STAGES.map((s, i) => (
          <li key={s.key} className="flex flex-1 items-center gap-1">
            <div className="min-w-0 flex-1">
              <span
                className={cn(
                  'block h-1 rounded-full',
                  s.done ? 'bg-brand-500' : s.current ? 'bg-accent-400' : 'bg-n-200'
                )}
              />
              <span
                className={cn(
                  'mt-1.5 block truncate text-[10.5px] font-semibold',
                  s.done ? 'text-brand-700' : s.current ? 'text-accent-700' : 'text-n-500'
                )}
              >
                {s.label}
              </span>
            </div>
            {i < RUN_STAGES.length - 1 && <span className="sr-only">then</span>}
          </li>
        ))}
      </ol>
    </Panel>
  );
}

export function FilingsList({ className }: { className?: string }) {
  return (
    <Panel label="Statutory filings · this period" className={className}>
      <ul className="divide-y divide-n-100">
        {FILINGS.map((f) => (
          <li key={f.label} className="flex items-center gap-3 px-4 py-2.5">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-n-800">
              {f.label}
            </span>
            <span className="shrink-0 rounded bg-n-100 px-1.5 py-0.5 text-[10px] font-semibold text-n-600">
              {f.format}
            </span>
          </li>
        ))}
      </ul>
      <p className="border-t border-n-200 bg-sunken px-4 py-2 text-[11px] leading-4 text-n-600">
        Availability is resolved against the filesystem — the product cannot list a return it is
        unable to write.
      </p>
    </Panel>
  );
}

/** Employer cost — the part of CTC that never reaches the payslip. */
export function EmployerCost({ className }: { className?: string }) {
  return (
    <Panel label="Employer cost · inside CTC" className={className}>
      <ul className="divide-y divide-n-100">
        {EMPLOYER_COST.map((c) => (
          <li key={c.label} data-claim={c.claim} className="flex items-baseline gap-3 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12.5px] font-semibold text-n-900">{c.label}</p>
              <p className="truncate text-[11px] text-n-600">{c.note}</p>
            </div>
            <p className="shrink-0 text-[12.5px] font-semibold text-n-900 tnum">
              {inr(c.amount, true)}
            </p>
          </li>
        ))}
      </ul>
      <div className="flex items-baseline justify-between border-t border-n-200 bg-sunken px-4 py-2.5 text-[12px]">
        <p className="font-semibold text-n-700">Gross + employer cost</p>
        <p className="font-bold text-n-900 tnum">{inr(EMPLOYEE.monthlyCtc)}</p>
      </div>
      <p className="border-t border-n-200 px-4 py-2 text-[11px] leading-4 text-n-600">
        Balances to monthly CTC exactly. The residual component is what makes that true.
      </p>
    </Panel>
  );
}

/** The mobile approval inbox — real, and contradicting the old docs. */
export function MobileApprovals({ className }: { className?: string }) {
  return (
    <PhoneFrame className={className}>
      <div className="px-3 pb-4">
        <p className="px-1 pt-1 pb-2 font-display text-[15px] font-bold text-n-900">Approvals</p>
        <div className="flex gap-1 pb-2">
          {['Leave', 'Time edits', 'Expenses'].map((t, i) => (
            <span
              key={t}
              className={cn(
                'rounded-md px-2 py-1 text-[10.5px] font-semibold',
                i === 0 ? 'bg-brand-700 text-on-brand' : 'bg-n-100 text-n-600'
              )}
            >
              {t}
            </span>
          ))}
        </div>
        <ul className="grid gap-1.5">
          {[
            { who: 'Rohit Verma', what: 'Casual leave · 2 days', when: '24–25 Aug' },
            { who: 'Ananya Iyer', what: 'Sick leave · 1 day', when: '21 Aug' },
          ].map((r) => (
            <li key={r.who} className="rounded-lg border border-n-200 p-2.5">
              <p className="text-[11.5px] font-semibold text-n-900">{r.who}</p>
              <p className="text-[10.5px] text-n-600">
                {r.what} · {r.when}
              </p>
              <div className="mt-2 flex gap-1.5">
                <span className="flex-1 rounded-md bg-brand-700 py-1 text-center text-[10.5px] font-semibold text-on-brand">
                  Approve
                </span>
                <span className="flex-1 rounded-md border border-n-300 py-1 text-center text-[10.5px] font-semibold text-n-600">
                  Reject
                </span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </PhoneFrame>
  );
}

/** The consent gate every capture path passes through. */
export function ConsentNotice({ className }: { className?: string }) {
  return (
    <Panel label="Monitoring notice · v3" className={className}>
      <div className="p-4">
        <p className="text-[12.5px] leading-5 text-n-700">
          This workspace captures screenshots, application activity and location at punch-in, to
          verify hours worked and compute pay.
        </p>
        <ul className="mt-3 grid gap-1.5">
          {['Screenshots', 'Application & URL activity', 'Location at punch-in', 'Attendance selfies'].map(
            (c) => (
              <li key={c} className="flex items-center gap-2 text-[12px] text-n-700">
                <span
                  className="flex h-4 w-4 items-center justify-center rounded border border-brand-500 bg-brand-500"
                  aria-hidden="true"
                >
                  <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2.5 6.2 4.8 8.5 9.5 3.8" />
                  </svg>
                </span>
                {c}
              </li>
            )
          )}
        </ul>
        <p className="mt-3 border-t border-n-200 pt-2.5 text-[11px] leading-4 text-n-600">
          Consent is recorded per capture type and can be withdrawn. Notices are versioned and
          never edited in place.
        </p>
      </div>
    </Panel>
  );
}
