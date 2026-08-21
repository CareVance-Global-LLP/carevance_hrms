'use client';

import { useMemo, useState } from 'react';
import {
  PT_STATES,
  professionalTax,
  annualProfessionalTax,
  getPtState,
  PT_LEVYING_COUNT,
  PT_NIL_COUNT,
} from '@/lib/pt-states';
import { rupees } from '@/lib/calc';
import { Card, cn } from '@/components/ui/primitives';
import { MoneyInput, SelectInput, Headline } from '@/components/tools/ui';

const OPTIONS = PT_STATES.map((s) => ({
  value: s.code,
  label: s.levies ? s.name : `${s.name} — no PT`,
  group: s.type === 'state' ? 'States' : 'Union territories',
}));

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * Professional tax, by state.
 *
 * The differentiated tool in the cluster. Two things make it so, and both come
 * straight from the engine:
 *
 * 1. It covers all 37 states and union territories INCLUDING the 17 that levy
 *    nothing. Most calculators list eight states and leave everyone else
 *    guessing whether they owe something.
 *
 * 2. It is month-aware. Maharashtra charges a higher February instalment so the
 *    annual total reaches the statutory ceiling, and that only applies to the
 *    top band. Getting this right is a small thing that anyone who runs
 *    Maharashtra payroll will notice immediately.
 */
export function PtStateTool() {
  const [state, setState] = useState('maharashtra');
  const [gross, setGross] = useState(50000);
  const [query, setQuery] = useState('');

  const selected = getPtState(state);

  const monthly = useMemo(
    () => MONTHS.map((_, i) => professionalTax(state, gross || 0, i + 1)),
    [state, gross]
  );
  const annual = useMemo(() => annualProfessionalTax(state, gross || 0), [state, gross]);
  const hasFebruaryRule = monthly.some((m, i) => i === 1 && m !== monthly[0]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return PT_STATES;
    return PT_STATES.filter((s) => s.name.toLowerCase().includes(q));
  }, [query]);

  return (
    <div className="grid gap-6">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)] lg:items-start">
        <Card className="p-5">
          <div className="grid gap-4">
            <SelectInput
              id="pt-state"
              label="State or union territory"
              value={state}
              onChange={setState}
              options={OPTIONS}
            />
            <MoneyInput
              id="pt-gross"
              label="Monthly gross salary"
              value={gross}
              onChange={setGross}
              step={1000}
            />
          </div>
        </Card>

        <div className="grid gap-4">
          {selected && !selected.levies ? (
            <div className="rounded-xl border border-n-300 bg-card p-5">
              <p className="text-caption uppercase text-n-600">No professional tax</p>
              <p className="mt-1.5 font-display text-2xl font-bold text-n-900">
                {selected.name} levies none
              </p>
              <p className="mt-2 text-[13.5px] leading-6 text-n-600">
                Professional tax is levied by states, not by the union, and {PT_NIL_COUNT} of the{' '}
                {PT_STATES.length} states and union territories do not levy it at all. The correct
                deduction here is <strong className="text-n-900">₹0</strong> — never a nearby
                state’s slab.
              </p>
            </div>
          ) : (
            <Headline
              label="Professional tax"
              value={`${rupees(annual)} a year`}
              sub={
                hasFebruaryRule
                  ? `${rupees(monthly[0])} a month, and ${rupees(monthly[1])} in February`
                  : `${rupees(monthly[0])} every month`
              }
            />
          )}

          {selected && selected.levies && (
            <Card className="p-5">
              <p className="text-caption uppercase text-n-600">{selected.name} — slabs</p>
              <ul className="mt-3 grid gap-1.5">
                {selected.slabs.map((slab, i) => {
                  const active = gross >= slab.min && (slab.max === null || gross <= slab.max);
                  return (
                    <li
                      key={i}
                      className={cn(
                        'flex items-baseline justify-between gap-3 rounded-lg border px-3 py-2 text-[13px]',
                        active ? 'border-brand-300 bg-brand-50' : 'border-n-200'
                      )}
                    >
                      <span className={active ? 'font-semibold text-brand-900' : 'text-n-600'}>
                        {slab.max === null
                          ? `Above ${rupees(slab.min)}`
                          : `${rupees(slab.min)} – ${rupees(slab.max)}`}
                      </span>
                      <span
                        className={cn(
                          'shrink-0 tnum',
                          active ? 'font-bold text-brand-900' : 'text-n-700'
                        )}
                      >
                        {slab.amount === 0 ? 'Nil' : `${rupees(slab.amount)}/mo`}
                      </span>
                    </li>
                  );
                })}
              </ul>

              {selected.februaryAmount !== null && (
                <p className="mt-3 rounded-lg border border-accent-200 bg-accent-50 px-3 py-2 text-[12.5px] leading-5 text-n-700">
                  {selected.name} charges{' '}
                  <strong className="tnum">{rupees(selected.februaryAmount)}</strong> in February
                  on the top band, so the annual total reaches the statutory ceiling. It applies to
                  the top band only — applying it lower would overcharge someone the ceiling was
                  never about.
                </p>
              )}
            </Card>
          )}
        </div>
      </div>

      {/* ── The full table. The reason this page exists. ─────────────── */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-n-200 bg-sunken px-5 py-3">
          <div>
            <p className="text-[13.5px] font-semibold text-n-900">
              All {PT_STATES.length} states and union territories
            </p>
            <p className="text-[11.5px] text-n-600">
              {PT_LEVYING_COUNT} levy professional tax · {PT_NIL_COUNT} do not
            </p>
          </div>
          <div>
            <label htmlFor="pt-search" className="sr-only">
              Filter states
            </label>
            <input
              id="pt-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter…"
              className="w-40 rounded-lg border border-n-300 bg-card px-3 py-1.5 text-[13px] focus-visible:border-brand-500 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
            />
          </div>
        </div>

        <div className="max-h-[28rem] overflow-auto">
          <table className="w-full text-left text-[13px]">
            <caption className="sr-only">
              Professional tax by state at a monthly gross of {rupees(gross)}
            </caption>
            <thead className="sticky top-0 bg-card">
              <tr className="border-b border-n-200">
                <th scope="col" className="px-5 py-2.5 font-semibold text-n-900">
                  State / UT
                </th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold text-n-900">
                  At {rupees(gross)}
                </th>
                <th scope="col" className="px-5 py-2.5 text-right font-semibold text-n-900">
                  Annual
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => {
                const m = professionalTax(s.code, gross || 0);
                const a = annualProfessionalTax(s.code, gross || 0);
                return (
                  <tr
                    key={s.code}
                    className={cn(
                      'border-b border-n-100 last:border-0',
                      s.code === state && 'bg-brand-50'
                    )}
                  >
                    <th scope="row" className="px-5 py-2 font-normal">
                      <button
                        type="button"
                        onClick={() => setState(s.code)}
                        className="text-left text-n-800 underline-offset-4 hover:underline"
                      >
                        {s.name}
                      </button>
                      <span className="ml-1.5 text-[10.5px] text-n-500 uppercase">
                        {s.type === 'ut' ? 'UT' : ''}
                      </span>
                    </th>
                    <td
                      className={cn(
                        'px-3 py-2 text-right tnum',
                        m === 0 ? 'text-n-500' : 'text-n-800'
                      )}
                    >
                      {m === 0 ? '—' : rupees(m)}
                    </td>
                    <td
                      className={cn(
                        'px-5 py-2 text-right font-semibold tnum',
                        a === 0 ? 'text-n-500' : 'text-n-900'
                      )}
                    >
                      {a === 0 ? 'Nil' : rupees(a)}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-5 py-8 text-center text-n-600">
                    No state matches “{query}”.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
