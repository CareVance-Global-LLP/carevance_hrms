import { useEffect, useState } from 'react';
import AttentionStrip from './AttentionStrip';
import TodayCensus from './TodayCensus';
import HeadcountChart from './HeadcountChart';
import ShiftCoverage from './ShiftCoverage';
import LiveBoard from './LiveBoard';
import AttendanceHeatmap from './AttendanceHeatmap';
import ArrivalCurve from './ArrivalCurve';
import PeopleMovement from './PeopleMovement';
import PayrollDashboardStrip from '@/features/payroll/PayrollDashboardStrip';

/**
 * The admin landing screen.
 *
 * Ordered attention -> today -> movement, and that order is the design: the
 * first two bands answer "is anything on fire" and "who is here", which are
 * the reasons the page gets opened at all. Trends sit below because nobody has
 * ever opened a dashboard to look at a chart first.
 *
 * THIS PAGE HAS NO GLOBAL DATE PICKER. The one that used to sit on top applied
 * to every tile at once, so every number had to be interpreted twice and the
 * default reading was usually stale. A dashboard answers "what needs me now";
 * a report answers "what happened between these dates", and Reports is where
 * that question belongs.
 *
 * NOTHING HERE CLAIMS TO BE LIVE. BROADCAST_CONNECTION is `log`, so there is
 * no realtime transport and these queries poll. The header says "updated N ago"
 * rather than "live", because a stale board that claims to be live is worse
 * than one that admits its age.
 */
export default function OperationsConsole() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(tick);
  }, []);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">Operations</h1>
        <p className="text-xs text-slate-500">
          As of{' '}
          {now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })}
          {' · '}
          {now.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
        </p>
      </header>

      <section aria-labelledby="ops-attention">
        <h2 id="ops-attention" className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
          Waiting on you
        </h2>
        <AttentionStrip />
      </section>

      <section aria-labelledby="ops-today">
        <h2 id="ops-today" className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
          Today
        </h2>
        <TodayCensus />
      </section>

      <section aria-labelledby="ops-now">
        <h2 id="ops-now" className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
          Right now
        </h2>
        <div className="grid gap-3.5 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <LiveBoard />
          </div>
          <ShiftCoverage />
        </div>
      </section>

      {/*
        Rhythm sits above the twelve-month curve deliberately.

        Both bands are history, but these two are history somebody can act on
        this week - a bad Monday, a bus that arrives five minutes late - while
        headcount over a year is context for a quarterly conversation.
      */}
      <section aria-labelledby="ops-rhythm">
        <h2 id="ops-rhythm" className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
          Rhythm
        </h2>
        <div className="grid gap-3.5 lg:grid-cols-2">
          <AttendanceHeatmap />
          <ArrivalCurve />
        </div>
      </section>

      {/*
        Payroll follows a MONTH, not the thirty-day window above it, so it gets
        its own band rather than a card inside Rhythm. Forcing a run onto a
        rolling range produces a figure that belongs to no run at all.
      */}
      <section aria-labelledby="ops-payroll">
        <h2 id="ops-payroll" className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
          Payroll &amp; compliance
        </h2>
        <PayrollDashboardStrip />
      </section>

      <section aria-labelledby="ops-movement">
        <h2 id="ops-movement" className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
          Movement
        </h2>
        <div className="grid gap-3.5">
          <HeadcountChart />
          <PeopleMovement />
        </div>
      </section>
    </div>
  );
}
