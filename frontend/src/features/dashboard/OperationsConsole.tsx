import { useEffect, useState } from 'react';
import AttentionStrip from './AttentionStrip';
import TodayCensus from './TodayCensus';
import HeadcountChart from './HeadcountChart';
import ShiftCoverage from './ShiftCoverage';

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

      <section aria-labelledby="ops-movement">
        <h2 id="ops-movement" className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
          Movement
        </h2>
        <div className="grid gap-3.5 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <HeadcountChart />
          </div>
          <ShiftCoverage />
        </div>
      </section>
    </div>
  );
}
