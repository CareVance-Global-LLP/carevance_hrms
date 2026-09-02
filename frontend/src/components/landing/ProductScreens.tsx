import type { ReactNode } from 'react';
import {
  EMPLOYEE,
  PERIOD,
  TRACKED,
  ATTENDANCE,
  RUN_STAGES,
  DIFFERENCES,
  EARNINGS,
  DEDUCTIONS,
  GROSS,
  TOTAL_DEDUCTIONS,
  NET_PAY,
  inr,
  num,
} from './demoData';
import { brandPrefix } from '@/config/brand';

/**
 * The product's screens, rebuilt in markup.
 *
 * NOT screenshots, and not decorative illustrations either — these reproduce
 * the app's own layout and field names from `demoData.ts`, which is why each
 * one can be trusted to match the sentence printed beside it.
 *
 * THE RULE THAT GOVERNS THIS FILE: a screen may only show something the
 * product actually does, and every figure in it must trace to the derivation
 * documented in demoData.ts. No invented modules, no aspirational panels, no
 * numbers chosen because they look good. If a screen needs a capability that
 * does not exist, the screen is wrong — not the product.
 *
 * Each carries a "Worked example" marker so nobody reads it as a real
 * organisation's data.
 */

/* ── Chrome ──────────────────────────────────────────────────────────── */

export function AppFrame({
  title,
  subtitle,
  children,
  tone = 'light',
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  tone?: 'light' | 'dark';
}) {
  return (
    <div
      className={`overflow-hidden rounded-2xl border shadow-lg ${
        tone === 'dark' ? 'border-slate-700 bg-slate-900' : 'border-slate-200 bg-white'
      }`}
    >
      <div
        className={`flex items-center gap-2 border-b px-3.5 py-2.5 ${
          tone === 'dark' ? 'border-slate-700 bg-slate-800' : 'border-slate-200 bg-slate-50'
        }`}
      >
        <span className="flex gap-1.5" aria-hidden="true">
          <span className={`h-2 w-2 rounded-full ${tone === 'dark' ? 'bg-slate-600' : 'bg-slate-300'}`} />
          <span className={`h-2 w-2 rounded-full ${tone === 'dark' ? 'bg-slate-600' : 'bg-slate-300'}`} />
          <span className={`h-2 w-2 rounded-full ${tone === 'dark' ? 'bg-slate-600' : 'bg-slate-300'}`} />
        </span>
        <p className={`text-[11px] font-medium ${tone === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>
          {title}
        </p>
        {subtitle && (
          <p className={`ml-auto text-[10.5px] ${tone === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}>
            {subtitle}
          </p>
        )}
      </div>
      {children}
    </div>
  );
}

/**
 * Printed on EVERY screen, without exception.
 *
 * These reproduce the product's real layout closely enough to be mistaken for a
 * capture of a live tenant, and a reader who makes that mistake has been misled
 * about something that matters — whose data this is. One line removes the
 * ambiguity, and it is cheap enough that no screen has an excuse to skip it.
 */
function ExampleTag({
  tone = 'light',
  source = 'figures derived from the payroll engine',
}: {
  tone?: 'light' | 'dark';
  /*
   * Where these numbers come from, which is not the same on every screen. The
   * payroll figures really are the engine's output; the tracker panel's are
   * the tracker's own, and saying "payroll engine" there described the wrong
   * system. The line exists to be exact about provenance, so it has to be.
   */
  source?: string;
}) {
  return (
    <p
      className={`border-t px-4 py-1.5 text-[10px] ${
        tone === 'dark'
          ? 'border-slate-700 bg-slate-800/60 text-slate-500'
          : 'border-slate-100 bg-slate-50 text-slate-400'
      }`}
    >
      Worked example · {source}, not a customer record
    </p>
  );
}

/* ── 1 · Track ───────────────────────────────────────────────────────── */

/**
 * Matches: "The work is captured as it happens."
 *
 * Shows a tracked day with its hours, its active share, the captures behind it,
 * and the idle that was rewound. Every one of those is a thing the tracker does
 * (TIM-01, TIM-04).
 */
export function TrackerCapture() {
  return (
    <AppFrame title={`${brandPrefix}tracker`} subtitle={TRACKED.dateShort} tone="dark">
      <div className="p-4">
        <div className="flex items-baseline justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
              Tracked today
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-white">{TRACKED.hours}</p>
          </div>
          {/* "Productivity", because that is what the dashboard tile is called
              and what productivity_score measures. It used to read "% active",
              which named nothing the product computes. */}
          <span className="rounded-md bg-emerald-500/15 px-2 py-1 text-[11px] font-semibold tabular-nums text-emerald-300">
            Productivity {TRACKED.productivityScore}%
          </span>
        </div>

        {/* Activity bar: 31 capture slots, one amber for the neutral app and
            one hollow for the idle stretch that was rewound. */}
        <div className="mt-3 flex h-1.5 gap-px overflow-hidden rounded-full" aria-hidden="true">
          {Array.from({ length: TRACKED.screenshots }).map((_, i) => (
            <span
              key={i}
              className={`flex-1 ${
                i === 17 ? 'bg-amber-400/70' : i === 22 ? 'bg-white/20' : 'bg-emerald-400/80'
              }`}
            />
          ))}
        </div>

        <p className="mt-3.5 text-[10px] uppercase tracking-[0.12em] text-slate-500">
          4 of {TRACKED.screenshots} captures · every {TRACKED.captureIntervalMinutes} min
        </p>

        <ul className="mt-2 grid gap-1.5">
          {TRACKED.captures.map((c) => (
            <li key={c.at} className="flex items-center gap-2.5 text-[11.5px]">
              <span className="w-9 shrink-0 tabular-nums text-slate-400">{c.at}</span>
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  c.kind === 'productive' ? 'bg-emerald-400' : 'bg-slate-500'
                }`}
                aria-hidden="true"
              />
              <span className="text-slate-200">{c.app}</span>
              <span className="ml-auto text-slate-400">screenshot</span>
            </li>
          ))}
        </ul>

        <p className="mt-3.5 rounded-lg bg-slate-800 px-3 py-2 text-[11px] leading-4 text-slate-300">
          <span className="font-semibold text-amber-300">{TRACKED.idleRecovered} idle</span> rewound
          to the last real activity — recorded, never billed.
        </p>
      </div>
      <ExampleTag tone="dark" source="a day shaped the way the tracker records one" />
    </AppFrame>
  );
}

/* ── 2 · Attend ──────────────────────────────────────────────────────── */

/** Matches: "Activity resolves into attendance." */
export function AttendanceMonth() {
  const rows = [
    { label: 'Present', value: `${ATTENDANCE.present} / ${ATTENDANCE.workingDays}` },
    { label: 'Loss of pay', value: `${ATTENDANCE.lop} days` },
    { label: 'Total hours', value: ATTENDANCE.totalHours },
    { label: 'Regularisations', value: `${ATTENDANCE.regularisations} approved` },
  ];

  return (
    <AppFrame title="Attendance" subtitle={PERIOD.monthShort}>
      <div className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-900">{EMPLOYEE.name}</p>
            <p className="text-[11px] text-slate-500">
              {EMPLOYEE.code} · {EMPLOYEE.department}
            </p>
          </div>
          <span className="rounded-md bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700">
            Synced to run
          </span>
        </div>

        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
          {ATTENDANCE.shift}
        </p>

        <dl className="mt-3 grid grid-cols-2 gap-2">
          {rows.map((r) => (
            <div key={r.label} className="rounded-lg border border-slate-200 px-3 py-2">
              <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                {r.label}
              </dt>
              <dd className="mt-0.5 text-sm font-bold tabular-nums text-slate-900">{r.value}</dd>
            </div>
          ))}
        </dl>
      </div>
      <ExampleTag />
    </AppFrame>
  );
}

/* ── 3 · Approve ─────────────────────────────────────────────────────── */

/** Matches: "The mistake is found before the money moves." */
export function RunAndDifferences() {
  const moved = DIFFERENCES.filter((d) => d.reason);

  return (
    <AppFrame title="Payroll run" subtitle={PERIOD.month}>
      <div className="border-b border-slate-100 p-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
          Run status
        </p>
        <ol className="mt-2.5 flex items-center gap-1">
          {RUN_STAGES.map((s) => (
            <li key={s.key} className="min-w-0 flex-1">
              <span
                className={`block h-1 rounded-full ${s.done ? 'bg-blue-500' : 'bg-amber-400'}`}
              />
              <span
                className={`mt-1.5 block truncate text-[10px] font-semibold ${
                  s.done ? 'text-blue-700' : 'text-amber-700'
                }`}
              >
                {s.label}
              </span>
            </li>
          ))}
        </ol>
      </div>

      <div className="p-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
          Differences · Aug → Sep
        </p>
        <ul className="mt-2 grid gap-2">
          {moved.map((d) => (
            <li key={d.component} className="rounded-lg border border-slate-200 px-3 py-2">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[12.5px] font-medium text-slate-800">{d.component}</span>
                <span
                  className={`text-[12.5px] font-bold tabular-nums ${
                    d.to < d.from ? 'text-rose-600' : 'text-emerald-600'
                  }`}
                >
                  {d.to < d.from ? '−' : '+'}
                  {num(Math.abs(d.to - d.from))}
                </span>
              </div>
              <p className="mt-0.5 text-[11px] leading-4 text-slate-500">{d.reason}</p>
            </li>
          ))}
        </ul>
      </div>
      <ExampleTag />
    </AppFrame>
  );
}

/* ── 4 · Pay ─────────────────────────────────────────────────────────── */

/** Matches: "And the same record becomes the payslip." */
export function Payslip() {
  return (
    <AppFrame title="Payslip" subtitle={PERIOD.month}>
      <div className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-900">{EMPLOYEE.name}</p>
            <p className="text-[11px] text-slate-500">
              {EMPLOYEE.designation} · {EMPLOYEE.location}
            </p>
          </div>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
              Earnings
            </p>
            <ul className="mt-1.5 grid gap-1">
              {EARNINGS.map((e) => (
                <li key={e.label} className="flex items-baseline justify-between gap-2 text-[11.5px]">
                  <span className="truncate text-slate-600">{e.label}</span>
                  <span className="shrink-0 tabular-nums text-slate-900">{num(e.amount, true)}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
              Deductions
            </p>
            <ul className="mt-1.5 grid gap-1">
              {DEDUCTIONS.map((d) => (
                <li
                  key={d.label}
                  data-claim={d.claim}
                  className="flex items-baseline justify-between gap-2 text-[11.5px]"
                >
                  <span className="truncate text-slate-600">{d.label}</span>
                  <span className="shrink-0 tabular-nums text-slate-900">{num(d.amount, true)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-3 grid gap-1 border-t border-slate-200 pt-3 text-[12px]">
          <div className="flex items-baseline justify-between">
            <span className="text-slate-500">Gross</span>
            <span className="tabular-nums text-slate-700">{inr(GROSS, true)}</span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-slate-500">Total deductions</span>
            <span className="tabular-nums text-slate-700">−{inr(TOTAL_DEDUCTIONS, true)}</span>
          </div>
          <div className="mt-1 flex items-baseline justify-between rounded-lg bg-blue-50 px-3 py-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-blue-700">
              Net pay
            </span>
            <span className="text-lg font-bold tabular-nums text-blue-900">
              {inr(NET_PAY, true)}
            </span>
          </div>
        </div>
      </div>
      <ExampleTag />
    </AppFrame>
  );
}

/* ── Privacy demo ────────────────────────────────────────────────────── */

/**
 * Matches: "The tracker asks first, and stops looking when told."
 *
 * A capture list is the right subject for the blur demonstration: it is exactly
 * what stops being collected when consent is withdrawn (CON-01, CON-03).
 */
export function CaptureGallery() {
  return (
    <AppFrame title="Screenshots" subtitle={TRACKED.dateShort}>
      <div className="p-4">
        <div className="grid grid-cols-3 gap-2">
          {TRACKED.captures.concat(TRACKED.captures.slice(0, 2)).map((c, i) => (
            <div key={`${c.at}-${i}`} className="overflow-hidden rounded-lg border border-slate-200">
              {/* A stand-in for the captured frame — deliberately abstract:
                  inventing the contents of somebody's screen would be the
                  opposite of what this section is arguing. */}
              <div className="h-16 bg-gradient-to-br from-slate-100 to-slate-200" aria-hidden="true">
                <div className="h-2 w-full bg-slate-300/70" />
                <div className="mt-2 ml-2 h-1.5 w-2/3 rounded bg-slate-300/60" />
                <div className="mt-1 ml-2 h-1.5 w-1/2 rounded bg-slate-300/50" />
              </div>
              <p className="px-2 py-1 text-[10px] text-slate-500">
                {c.at} · {c.app}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] leading-4 text-slate-500">
          {TRACKED.screenshots} captures on {TRACKED.dateShort}, each taken only while consent for
          screenshots is active.
        </p>
      </div>
      <ExampleTag />
    </AppFrame>
  );
}
