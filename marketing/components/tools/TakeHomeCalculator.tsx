'use client';

import { useMemo, useState } from 'react';
import { salaryBreakup, taxNewRegime, taxOldRegime, hraExemption, rupees, lakhs } from '@/lib/calc';
import { PT_STATES } from '@/lib/pt-states';
import { Card, cn } from '@/components/ui/primitives';
import {
  MoneyInput,
  SelectInput,
  SegmentedInput,
  ResultRow,
  Headline,
} from '@/components/tools/ui';

const STATE_OPTIONS = PT_STATES.map((s) => ({
  value: s.code,
  label: s.levies ? s.name : `${s.name} — no PT`,
  group: s.type === 'state' ? 'States' : 'Union territories',
}));

/**
 * Take-home, with the regime comparison built in.
 *
 * Most take-home calculators pick a regime silently. Since the choice is worth
 * real money and is made once a year under time pressure, this one computes
 * BOTH and says which wins — which is also what the product's own regime
 * simulator does.
 */
export function TakeHomeCalculator() {
  const [ctc, setCtc] = useState(1200000);
  const [metro, setMetro] = useState<'metro' | 'non-metro'>('metro');
  const [state, setState] = useState('karnataka');
  const [rent, setRent] = useState(240000);
  const [s80c, setS80c] = useState(150000);
  const [s80d, setS80d] = useState(25000);

  const isMetro = metro === 'metro';

  const r = useMemo(() => {
    const b = salaryBreakup({ annualCtc: ctc || 0, isMetro, stateCode: state });
    const annualGross = b.gross * 12;

    const hra = hraExemption(b.hra * 12, b.basic * 12, rent || 0, isMetro);

    const newTax = taxNewRegime(annualGross);
    const oldTax = taxOldRegime(annualGross, {
      section80c: s80c || 0,
      section80d: s80d || 0,
      hraExemption: hra.exempt,
    });

    const better = oldTax.totalTax <= newTax.totalTax ? oldTax : newTax;
    const saving = Math.abs(oldTax.totalTax - newTax.totalTax);

    const annualStatutory = (b.employeePf + b.esiEmployee + b.pt) * 12;
    const takeHomeAnnual = annualGross - annualStatutory - better.totalTax;

    return { b, annualGross, hra, newTax, oldTax, better, saving, annualStatutory, takeHomeAnnual };
  }, [ctc, isMetro, state, rent, s80c, s80d]);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)] lg:items-start">
      <Card className="p-5">
        <div className="grid gap-4">
          <MoneyInput
            id="ctc"
            label="Annual CTC"
            hint={ctc > 0 ? lakhs(ctc) : undefined}
            value={ctc}
            onChange={setCtc}
            step={10000}
          />
          <SegmentedInput
            label="City"
            value={metro}
            onChange={setMetro}
            options={[
              { value: 'metro', label: 'Metro' },
              { value: 'non-metro', label: 'Non-metro' },
            ]}
          />
          <SelectInput
            id="state"
            label="State (for professional tax)"
            value={state}
            onChange={setState}
            options={STATE_OPTIONS}
          />

          <div className="border-t border-n-200 pt-4">
            <p className="text-caption uppercase text-n-600">Old regime only</p>
            <p className="mt-1 mb-3 text-[11.5px] leading-4 text-n-600">
              These reduce tax under the old regime. The new regime allows none of them — only the
              ₹75,000 standard deduction.
            </p>
            <div className="grid gap-4">
              <MoneyInput
                id="rent"
                label="Annual rent paid"
                hint="For the HRA exemption. Zero if you do not rent."
                value={rent}
                onChange={setRent}
                step={6000}
              />
              <MoneyInput
                id="s80c"
                label="Section 80C investments"
                hint="EPF, ELSS, life insurance, principal on a home loan. Capped at ₹1,50,000."
                value={s80c}
                onChange={setS80c}
                step={10000}
              />
              <MoneyInput
                id="s80d"
                label="Section 80D — health insurance"
                hint="Capped at ₹25,000."
                value={s80d}
                onChange={setS80d}
                step={5000}
              />
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-4">
        <Headline
          label="Monthly take-home"
          value={rupees(r.takeHomeAnnual / 12)}
          sub={`${lakhs(r.takeHomeAnnual)} a year, on the ${r.better.regime} regime`}
        />

        {/* The regime comparison — the part worth real money. */}
        <Card className="p-5">
          <p className="text-caption uppercase text-n-600">Which regime wins</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {[r.newTax, r.oldTax].map((t) => {
              const wins = t.regime === r.better.regime;
              return (
                <div
                  key={t.regime}
                  className={cn(
                    'rounded-lg border p-3.5',
                    wins ? 'border-brand-300 bg-brand-50' : 'border-n-200 bg-card'
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[12px] font-semibold text-n-700 capitalize">
                      {t.regime} regime
                    </p>
                    {wins && (
                      <span className="rounded bg-brand-700 px-1.5 py-0.5 text-[9.5px] font-bold tracking-wide text-on-brand uppercase">
                        Lower
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 font-display text-xl font-bold text-n-900 tnum">
                    {rupees(t.totalTax)}
                  </p>
                  <p className="text-[11.5px] text-n-600 tnum">
                    {t.effectiveRate.toFixed(1)}% effective · {rupees(t.monthly)}/month
                  </p>
                </div>
              );
            })}
          </div>
          {r.saving > 0 && (
            <p className="mt-3 text-[13px] leading-5 text-n-600">
              Choosing the <strong className="text-n-900">{r.better.regime}</strong> regime saves{' '}
              <strong className="text-n-900 tnum">{rupees(r.saving)}</strong> a year here —{' '}
              {rupees(r.saving / 12)} a month.
            </p>
          )}
        </Card>

        <Card className="p-5">
          <p className="text-caption uppercase text-n-600">Annual, in full</p>
          <div className="mt-2">
            <ResultRow label="Gross salary" value={r.annualGross} />
            <ResultRow label="Provident fund" value={-r.b.employeePf * 12} tone="negative" indent />
            <ResultRow
              label="Professional tax"
              value={r.b.pt === 0 ? '—' : -r.b.pt * 12}
              tone={r.b.pt === 0 ? 'muted' : 'negative'}
              indent
            />
            {r.b.esiEmployee > 0 && (
              <ResultRow label="Employee State Insurance" value={-r.b.esiEmployee * 12} tone="negative" indent />
            )}
            <ResultRow
              label={`Income tax (${r.better.regime} regime)`}
              value={-r.better.totalTax}
              tone="negative"
              indent
            />
            <ResultRow label="Take-home" value={r.takeHomeAnnual} tone="accent" />
          </div>

          {r.better.regime === 'old' && r.hra.exempt > 0 && (
            <p className="mt-4 border-t border-n-200 pt-3 text-[12px] leading-5 text-n-600">
              HRA exemption of {rupees(r.hra.exempt)} applied — the least of the three limbs.{' '}
              <a href="/tools/hra-exemption-calculator" className="underline underline-offset-4 hover:text-n-800">
                See the working
              </a>
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
