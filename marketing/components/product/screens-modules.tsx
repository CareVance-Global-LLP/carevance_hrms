import { Panel } from '@/components/product/Frame';
import { inr, num } from '@/lib/demo';
import { cn } from '@/components/ui/primitives';

/**
 * Product screens for the modules the first audit missed.
 *
 * Split from screens.tsx rather than appended to it: that file was already the
 * longest in the codebase, and these belong to a different set of pages
 * (recruitment, leave, rostering, accounting). Same rules apply — server
 * components, real tokens, every figure in the server-rendered HTML.
 *
 * See PRODUCT_TRUTH.md §3.12–§3.20 for the claims each of these illustrates.
 */

/* ── Hiring ───────────────────────────────────────────────────────────── */

/**
 * The pipeline as a funnel. `hiring_stage_id` says where somebody is;
 * `application_stage_events` says how they got there.
 */
export function HiringPipeline({ className }: { className?: string }) {
  const stages = [
    { name: 'Applied', n: 48 },
    { name: 'Screening', n: 21 },
    { name: 'Tech round', n: 9 },
    { name: 'Panel', n: 4 },
    { name: 'Offer', n: 2 },
    { name: 'Hired', n: 1 },
  ];
  const max = stages[0].n;

  return (
    <Panel
      label="Senior Engineer · pipeline"
      className={className}
      toolbar={
        <span className="rounded-md bg-brand-100 px-2 py-0.5 text-[10.5px] font-semibold text-brand-800">
          2 openings
        </span>
      }
    >
      <ul className="divide-y divide-n-100">
        {stages.map((s) => (
          <li key={s.name} className="flex items-center gap-3 px-4 py-2">
            <span className="w-24 shrink-0 text-[12px] font-medium text-n-700">{s.name}</span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-n-100">
              <span
                className="block h-full rounded-full bg-brand-400"
                style={{ width: `${(s.n / max) * 100}%` }}
              />
            </span>
            <span className="w-7 shrink-0 text-right text-[12px] font-semibold text-n-900 tnum">
              {s.n}
            </span>
          </li>
        ))}
      </ul>
      <p className="border-t border-n-200 bg-sunken px-4 py-2 text-[11px] leading-4 text-n-600">
        Moving backwards is allowed and recorded as a stage event. A forward-only pipeline gets
        worked around by deleting the application, which destroys the history.
      </p>
    </Panel>
  );
}

/**
 * Panel feedback, never averaged.
 *
 * Three people going two-to-one and three people all lukewarm produce the same
 * mean and call for completely different conversations. The summary returns the
 * split and an explicit “is split”, never a score.
 */
export function PanelFeedback({ className }: { className?: string }) {
  const panel = [
    { who: 'A. Deshpande', verdict: 'Strong hire', tone: 'yes' as const },
    { who: 'F. Sheikh', verdict: 'Hire', tone: 'yes' as const },
    { who: 'A. Iyer', verdict: 'No hire', tone: 'no' as const },
    { who: 'R. Verma', verdict: 'Not submitted', tone: 'pending' as const },
  ];

  return (
    <Panel label="Panel feedback · tech round" className={className}>
      <ul className="divide-y divide-n-100">
        {panel.map((r) => (
          <li key={r.who} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <span className="text-[12.5px] font-medium text-n-800">{r.who}</span>
            <span
              className={cn(
                'shrink-0 rounded px-1.5 py-0.5 text-[10.5px] font-semibold',
                r.tone === 'yes' && 'bg-emerald-100 text-emerald-700',
                r.tone === 'no' && 'bg-rose-100 text-rose-700',
                r.tone === 'pending' && 'bg-n-100 text-n-600'
              )}
            >
              {r.verdict}
            </span>
          </li>
        ))}
      </ul>
      <div className="border-t border-n-200 bg-accent-50 px-4 py-2.5">
        <p className="text-[11px] font-semibold tracking-[0.06em] text-accent-700 uppercase">
          Split panel · 3 of 4 responded
        </p>
        <p className="mt-1 text-[11.5px] leading-4 text-n-700">
          No average is computed. Two-to-one is a conversation; a mean of 3.7 is a number that hides
          one.
        </p>
      </div>
    </Panel>
  );
}

/** The offer approval chain. Rows are written up front, recording who was asked. */
export function OfferApproval({ className }: { className?: string }) {
  const chain = [
    { who: 'Hiring manager', state: 'Approved', tone: 'done' as const },
    { who: 'Finance', state: 'Approved', tone: 'done' as const },
    { who: 'Founder', state: 'Awaiting', tone: 'wait' as const },
  ];

  return (
    <Panel label="Offer · pending approval" className={className}>
      <div className="p-4">
        <div className="flex items-baseline justify-between text-[12.5px]">
          <p className="text-n-600">Annual CTC offered</p>
          <p className="font-semibold text-n-900 tnum">{inr(1440000)}</p>
        </div>

        <ul className="mt-3 grid gap-1.5 border-t border-n-100 pt-3">
          {chain.map((c) => (
            <li key={c.who} className="flex items-center justify-between gap-3 text-[12px]">
              <span className="text-n-700">{c.who}</span>
              <span
                className={cn(
                  'shrink-0 rounded px-1.5 py-0.5 text-[10.5px] font-semibold',
                  c.tone === 'done' ? 'bg-emerald-100 text-emerald-700' : 'bg-n-100 text-n-600'
                )}
              >
                {c.state}
              </span>
            </li>
          ))}
        </ul>

        <p className="mt-3 border-t border-n-200 pt-2.5 text-[11px] leading-4 text-n-600">
          Approval rows are written when the offer is submitted, so they record who was{' '}
          <em>asked</em> — not just who answered. One rejection sends the whole offer back to draft
          immediately, rather than collecting the rest of a chain for something already refused.
        </p>
      </div>
    </Panel>
  );
}

/** BGV consent — a foreign key, not a checkbox. */
export function BgvConsent({ className }: { className?: string }) {
  const scope = [
    { item: 'Employment verification', ok: true },
    { item: 'Education verification', ok: true },
    { item: 'Criminal record', ok: true },
    { item: 'Credit check', ok: false },
  ];

  return (
    <Panel label="Background check · consent" className={className}>
      <div className="p-4">
        <p className="text-caption uppercase text-n-600">Consented scope</p>
        <ul className="mt-2 grid gap-1.5">
          {scope.map((r) => (
            <li key={r.item} className="flex items-center gap-2 text-[12px]">
              <span
                className={cn(
                  'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                  r.ok ? 'border-brand-500 bg-brand-500' : 'border-n-300 bg-card'
                )}
                aria-hidden="true"
              >
                {r.ok && (
                  <svg
                    viewBox="0 0 12 12"
                    className="h-3 w-3"
                    fill="none"
                    stroke="white"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M2.5 6.2 4.8 8.5 9.5 3.8" />
                  </svg>
                )}
              </span>
              <span className={r.ok ? 'text-n-800' : 'text-n-600'}>{r.item}</span>
              {!r.ok && (
                <span className="ml-auto shrink-0 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">
                  refused
                </span>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-3 border-t border-n-200 pt-2.5 text-[11px] leading-4 text-n-600">
          A credit check was requested and refused <em>by name</em>: it is outside the recorded
          scope. Somebody who agreed to employment verification has not agreed to this.
        </p>
      </div>
    </Panel>
  );
}

/** A finding, in the vocabulary the service actually uses. */
export function BgvFinding({ className }: { className?: string }) {
  const items = [
    { check: 'Employment · Acme Ltd', result: 'clear' as const, claimed: '2021–2024', verified: '2021–2024' },
    { check: 'Employment · Beta Corp', result: 'discrepancy' as const, claimed: 'Senior Engineer', verified: 'Engineer' },
    { check: 'Education · B.E.', result: 'insufficient' as const, claimed: '2017', verified: '—' },
  ];

  return (
    <Panel label="Background check · findings" className={className}>
      <ul className="divide-y divide-n-100">
        {items.map((i) => (
          <li key={i.check} className="px-4 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate text-[12.5px] font-medium text-n-800">
                {i.check}
              </span>
              <span
                className={cn(
                  'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold',
                  i.result === 'clear' && 'bg-emerald-100 text-emerald-700',
                  i.result === 'discrepancy' && 'bg-accent-100 text-accent-700',
                  i.result === 'insufficient' && 'bg-n-100 text-n-600'
                )}
              >
                {i.result}
              </span>
            </div>
            {i.result !== 'clear' && (
              <p className="mt-1 text-[11px] text-n-600">
                claimed <b className="text-n-800">{i.claimed}</b> · verified{' '}
                <b className="text-n-800">{i.verified}</b>
              </p>
            )}
          </li>
        ))}
      </ul>
      <p className="border-t border-n-200 bg-sunken px-4 py-2 text-[11px] leading-4 text-n-600">
        The vocabulary is <b>clear · discrepancy · insufficient</b> — never pass/fail. A discrepancy
        requires both a claim and a verification: an accusation with no comparison behind it is one
        nobody can answer.
      </p>
    </Panel>
  );
}

/* ── Leave ────────────────────────────────────────────────────────────── */

/**
 * A balance is SUM(units) over a dated ledger, never a stored counter — so
 * “why is my balance 8.5” expands into the rows that produced it.
 */
export function LeaveLedger({ className }: { className?: string }) {
  const rows = [
    { on: '01 Apr', what: 'Accrual · Q1', units: 3.75 },
    { on: '01 Apr', what: 'Carried from FY 2025-26', units: 5 },
    { on: '01 Apr', what: 'Expired above carry cap', units: -2 },
    { on: '12 May', what: 'Casual leave taken', units: -1.5 },
    { on: '01 Jul', what: 'Accrual · Q2', units: 3.75 },
    { on: '08 Aug', what: 'Sick leave taken', units: -0.5 },
  ];
  const balance = rows.reduce((a, r) => a + r.units, 0);

  return (
    <Panel label="Leave ledger · Earned leave" className={className}>
      <ul className="divide-y divide-n-100">
        {rows.map((r, i) => (
          <li key={i} className="flex items-baseline gap-3 px-4 py-2">
            <span className="w-14 shrink-0 text-[11px] text-n-600 tnum">{r.on}</span>
            <span className="min-w-0 flex-1 truncate text-[12px] text-n-700">{r.what}</span>
            <span
              className={cn(
                'shrink-0 text-[12px] font-semibold tnum',
                r.units > 0 ? 'text-emerald-700' : 'text-rose-700'
              )}
            >
              {r.units > 0 ? '+' : '−'}
              {Math.abs(r.units)}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex items-baseline justify-between border-t border-n-200 bg-brand-50 px-4 py-2.5">
        <p className="text-[11px] font-semibold tracking-[0.06em] text-brand-800 uppercase">
          Balance
        </p>
        <p className="font-display text-lg font-bold text-brand-900 tnum">
          {balance.toFixed(2)} days
        </p>
      </div>
      <p className="border-t border-brand-200 px-4 py-2 text-[11px] leading-4 text-n-600">
        Carry and expiry are two rows, not one net adjustment — so “5 carried, 2 expired” is
        sayable. Nothing here is ever edited or deleted.
      </p>
    </Panel>
  );
}

/** Accrual configuration, per type. */
export function LeaveTypes({ className }: { className?: string }) {
  const types = [
    { name: 'Earned leave', quota: 15, accrual: 'Quarterly', carry: '5 days', probation: '50%' },
    { name: 'Casual leave', quota: 8, accrual: 'Annual', carry: 'Reset', probation: '—' },
    { name: 'Sick leave', quota: 12, accrual: 'Monthly', carry: 'Reset', probation: '—' },
  ];

  return (
    <Panel label="Leave types" className={className}>
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b border-n-200 text-left text-n-600">
            <th scope="col" className="px-4 py-2 font-medium">Type</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">Days</th>
            <th scope="col" className="px-2 py-2 font-medium">Accrual</th>
            <th scope="col" className="px-4 py-2 font-medium">Year end</th>
          </tr>
        </thead>
        <tbody>
          {types.map((t) => (
            <tr key={t.name} className="border-b border-n-100 last:border-0">
              <td className="px-4 py-2 font-medium text-n-800">{t.name}</td>
              <td className="px-2 py-2 text-right text-n-700 tnum">{t.quota}</td>
              <td className="px-2 py-2 text-n-700">{t.accrual}</td>
              <td className="px-4 py-2 text-n-700">{t.carry}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-n-200 bg-sunken px-4 py-2 text-[11px] leading-4 text-n-600">
        Probation rate is per type, and <b>notice period outranks probation</b>. A null rate means
        the normal rate in both cases — never zero.
      </p>
    </Panel>
  );
}

/* ── Rostering ────────────────────────────────────────────────────────── */

/** An off day is a ROW. Draft days are invisible to the resolver. */
export function RosterWeek({ className }: { className?: string }) {
  const days = [
    { d: 'Mon 17', shift: 'Night · 22:00–06:00', state: 'published' as const },
    { d: 'Tue 18', shift: 'Night · 22:00–06:00', state: 'published' as const },
    { d: 'Wed 19', shift: 'Off', state: 'off' as const },
    { d: 'Thu 20', shift: 'Off', state: 'off' as const },
    { d: 'Fri 21', shift: 'Day · 09:30–18:30', state: 'manual' as const },
    { d: 'Sat 22', shift: 'Day · 09:30–18:30', state: 'draft' as const },
  ];

  return (
    <Panel label="Roster · four-on, four-off" className={className}>
      <ul className="divide-y divide-n-100">
        {days.map((r) => (
          <li key={r.d} className="flex items-center gap-3 px-4 py-2">
            <span className="w-14 shrink-0 text-[11.5px] font-medium text-n-700">{r.d}</span>
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-[12px]',
                r.state === 'off' ? 'text-n-600 italic' : 'text-n-800'
              )}
            >
              {r.shift}
            </span>
            <span
              className={cn(
                'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold',
                r.state === 'published' && 'bg-emerald-100 text-emerald-700',
                r.state === 'off' && 'bg-n-100 text-n-600',
                r.state === 'manual' && 'bg-brand-100 text-brand-800',
                r.state === 'draft' && 'bg-accent-100 text-accent-700'
              )}
            >
              {r.state}
            </span>
          </li>
        ))}
      </ul>
      <p className="border-t border-n-200 bg-sunken px-4 py-2 text-[11px] leading-4 text-n-600">
        Friday is <b>manual</b>, so regenerating the month leaves it alone. Saturday is{' '}
        <b>draft</b> — invisible to attendance until somebody publishes. Wednesday is a <b>row</b>,
        not a gap: being told you are off is different from nobody scheduling you.
      </p>
    </Panel>
  );
}

/* ── Accounting ───────────────────────────────────────────────────────── */

/** The journal must balance exactly, or nothing is produced. */
export function JournalPreview({ className }: { className?: string }) {
  const lines = [
    { account: 'Salaries and wages', dr: 115891.2, cr: 0 },
    { account: 'Employer PF contribution', dr: 1800, cr: 0 },
    { account: 'PF payable', dr: 0, cr: 3600 },
    { account: 'TDS payable', dr: 0, cr: 6704.03 },
    { account: 'Professional tax payable', dr: 0, cr: 200 },
    { account: 'Salaries payable', dr: 0, cr: 107187.17 },
  ];
  const dr = lines.reduce((a, l) => a + l.dr, 0);
  const cr = lines.reduce((a, l) => a + l.cr, 0);

  return (
    <Panel label="Payroll journal · Aug 2026" className={className}>
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b border-n-200 text-left text-n-600">
            <th scope="col" className="px-4 py-2 font-medium">Account</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">Dr</th>
            <th scope="col" className="px-4 py-2 text-right font-medium">Cr</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.account} className="border-b border-n-100 last:border-0">
              <td className="px-4 py-1.5 text-n-800">{l.account}</td>
              <td className="px-2 py-1.5 text-right text-n-700 tnum">
                {l.dr ? num(l.dr, true) : ''}
              </td>
              <td className="px-4 py-1.5 text-right text-n-700 tnum">
                {l.cr ? num(l.cr, true) : ''}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-n-200 bg-sunken font-semibold text-n-900">
            <td className="px-4 py-2">Balanced</td>
            <td className="px-2 py-2 text-right tnum">{num(dr, true)}</td>
            <td className="px-4 py-2 text-right tnum">{num(cr, true)}</td>
          </tr>
        </tfoot>
      </table>
      <p className="border-t border-n-200 px-4 py-2 text-[11px] leading-4 text-n-600">
        PF payable carries <b>both halves</b> in one credit line — the organisation owes the total
        onward, and split into two it stops reconciling against the single challan that gets paid.
      </p>
    </Panel>
  );
}

/* ── Statutory working time ───────────────────────────────────────────── */

/** `unregulated` means unassessed, not compliant. */
export function WorkingTimeBreaches({ className }: { className?: string }) {
  const rows = [
    { who: 'Priya Nair', entity: 'Factory · Maharashtra', state: 'clear' as const, note: '46h 20m this week' },
    { who: 'Rohit Verma', entity: 'Factory · Maharashtra', state: 'breach' as const, note: 'Nine-hour daily limit exceeded on 14 Aug' },
    { who: 'Fatima Sheikh', entity: 'S&E · Karnataka', state: 'partial' as const, note: 'Daily ceiling not asserted for this state' },
    { who: 'Ananya Iyer', entity: 'No entity assigned', state: 'unassessed' as const, note: 'Not assessed — no limits resolvable' },
  ];

  return (
    <Panel label="Working-hour compliance · this week" className={className}>
      <ul className="divide-y divide-n-100">
        {rows.map((r) => (
          <li key={r.who} className="px-4 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate text-[12.5px] font-medium text-n-800">{r.who}</span>
              <span
                className={cn(
                  'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold',
                  r.state === 'clear' && 'bg-emerald-100 text-emerald-700',
                  r.state === 'breach' && 'bg-rose-100 text-rose-700',
                  r.state === 'partial' && 'bg-n-100 text-n-600',
                  r.state === 'unassessed' && 'bg-accent-100 text-accent-700'
                )}
              >
                {r.state}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-n-600">
              {r.entity} · {r.note}
            </p>
          </li>
        ))}
      </ul>
      <p className="border-t border-n-200 bg-accent-50 px-4 py-2 text-[11px] leading-4 text-n-700">
        <b>1 employee not assessed.</b> That is counted separately, never folded into the clear
        column — an empty breach list must not render as a green tick, because nobody re-checks a
        clean compliance report.
      </p>
    </Panel>
  );
}
