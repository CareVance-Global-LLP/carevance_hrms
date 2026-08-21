'use client';

import { useMemo, useState } from 'react';
import { hraExemption, rupees } from '@/lib/calc';
import { Card, cn } from '@/components/ui/primitives';
import { MoneyInput, SegmentedInput, ResultRow, Headline } from '@/components/tools/ui';

/**
 * HRA exemption — the least-of-three rule, with the binding limb named.
 *
 * Showing WHICH of the three limbs binds is the whole point. "Your exemption is
 * ₹1,20,000" tells someone nothing actionable; "the rent limb binds, so paying
 * more rent is the only thing that raises this" tells them what to do — and
 * showing the reason alongside the number is the same discipline the override
 * register applies to a payslip.
 */
export function HraCalculator() {
  const [basic, setBasic] = useState(600000);
  const [hra, setHra] = useState(300000);
  const [rent, setRent] = useState(300000);
  const [metro, setMetro] = useState<'metro' | 'non-metro'>('metro');

  const isMetro = metro === 'metro';
  const r = useMemo(
    () => hraExemption(hra || 0, basic || 0, rent || 0, isMetro),
    [hra, basic, rent, isMetro]
  );

  const bindingIndex = r.limbs.findIndex((l) => l.binding);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)] lg:items-start">
      <Card className="p-5">
        <div className="grid gap-4">
          <MoneyInput
            id="basic"
            label="Annual Basic salary"
            hint="Basic plus DA if your structure has one."
            value={basic}
            onChange={setBasic}
            step={10000}
          />
          <MoneyInput
            id="hra"
            label="Annual HRA received"
            hint="The HRA line on your payslip, times twelve."
            value={hra}
            onChange={setHra}
            step={10000}
          />
          <MoneyInput
            id="rent"
            label="Annual rent paid"
            value={rent}
            onChange={setRent}
            step={6000}
          />
          <SegmentedInput
            label="City"
            hint="Metro means Delhi, Mumbai, Kolkata or Chennai. Nothing else counts, whatever the rent looks like."
            value={metro}
            onChange={setMetro}
            options={[
              { value: 'metro', label: 'Metro' },
              { value: 'non-metro', label: 'Non-metro' },
            ]}
          />
        </div>
      </Card>

      <div className="grid gap-4">
        <Headline
          label="HRA exempt from tax"
          value={rupees(r.exempt)}
          sub={`${rupees(r.taxable)} of your HRA remains taxable`}
        />

        <Card className="p-5">
          <p className="text-caption uppercase text-n-600">The three limbs — the least one wins</p>
          <ul className="mt-3 grid gap-2">
            {r.limbs.map((limb, i) => (
              <li
                key={limb.label}
                className={cn(
                  'flex items-baseline justify-between gap-3 rounded-lg border p-3',
                  i === bindingIndex ? 'border-brand-300 bg-brand-50' : 'border-n-200'
                )}
              >
                <div className="min-w-0">
                  <p
                    className={cn(
                      'text-[13.5px]',
                      i === bindingIndex ? 'font-semibold text-brand-900' : 'text-n-600'
                    )}
                  >
                    {limb.label}
                  </p>
                  {i === bindingIndex && (
                    <p className="mt-0.5 text-[11.5px] text-brand-700">
                      This is the smallest, so it sets your exemption.
                    </p>
                  )}
                </div>
                <p
                  className={cn(
                    'shrink-0 text-[14px] tnum',
                    i === bindingIndex ? 'font-bold text-brand-900' : 'text-n-700'
                  )}
                >
                  {rupees(limb.value)}
                </p>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="p-5">
          <p className="text-caption uppercase text-n-600">What this means</p>
          <div className="mt-2">
            <ResultRow label="HRA received" value={hra} />
            <ResultRow label="Exempt" value={-r.exempt} tone="negative" indent />
            <ResultRow label="Taxable HRA" value={r.taxable} tone="total" />
          </div>
          <p className="mt-3 text-[12.5px] leading-5 text-n-600">
            {bindingIndex === 2
              ? 'The rent limb binds. Rent below 10% of your basic gives no exemption at all, and paying more rent is the only lever that raises this figure.'
              : bindingIndex === 1
                ? `The ${isMetro ? '50' : '40'}% limb binds. Your exemption is capped by your basic salary, so more rent will not increase it.`
                : 'The HRA-received limb binds. You cannot be exempted on more HRA than you were actually paid.'}
          </p>
          <p className="mt-2 text-[12.5px] leading-5 text-n-600">
            HRA exemption applies under the <strong className="text-n-700">old regime only</strong>.
            The new regime allows just the ₹75,000 standard deduction.
          </p>
        </Card>
      </div>
    </div>
  );
}
