'use client';

import { useMemo, useState } from 'react';
import { gratuity, rupees, lakhs, C } from '@/lib/calc';
import { Card } from '@/components/ui/primitives';
import { MoneyInput, NumberInput, ResultRow, Headline, Refusal } from '@/components/tools/ui';

/**
 * Gratuity, on the guarded path.
 *
 * Two rules decide most real answers and most calculators skip at least one:
 * service under five years pays NOTHING, and the payout is capped at
 * ₹20,00,000. The product has two functions for this — a raw one and a
 * settlement one — and only the settlement path applies both. This tool mirrors
 * the settlement path, because that is the number a leaver actually receives.
 */
export function GratuityCalculator() {
  const [lastBasic, setLastBasic] = useState(50000);
  const [years, setYears] = useState(6.5);

  const r = useMemo(() => gratuity(lastBasic || 0, years || 0), [lastBasic, years]);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)] lg:items-start">
      <Card className="p-5">
        <div className="grid gap-4">
          <MoneyInput
            id="last-basic"
            label="Last drawn Basic + Dearness Allowance"
            hint="Monthly. Gratuity is computed on basic plus DA — not on gross."
            value={lastBasic}
            onChange={setLastBasic}
            step={1000}
          />
          <NumberInput
            id="years"
            label="Years of continuous service"
            hint="Six months or more counts as a full year under the Act."
            value={years}
            onChange={setYears}
            min={0}
            max={60}
            step={0.5}
            suffix="yrs"
          />
        </div>

        <div className="mt-5 rounded-lg bg-sunken p-3.5">
          <p className="text-caption uppercase text-n-600">The formula</p>
          <p className="mt-1.5 font-mono text-[12px] leading-5 text-n-700">
            (Basic + DA) × 15 × years ÷ 26
          </p>
          <p className="mt-1.5 text-[11.5px] leading-4 text-n-600">
            Fifteen days’ wages for each completed year, on a 26-day month.
          </p>
        </div>
      </Card>

      <div className="grid gap-4">
        {!r.eligible ? (
          <Refusal>
            Gratuity requires <strong>{C.GRATUITY_MIN_YEARS} years</strong> of continuous service.
            At {years} years there is no entitlement — another{' '}
            <strong>{r.shortfallYears.toFixed(1)} years</strong> would be needed.
            <br />
            <br />
            The raw formula would give {rupees(r.raw)}, and calculators that show that number are
            telling a leaver they are owed money they are not.
          </Refusal>
        ) : (
          <Headline
            label="Gratuity payable"
            value={rupees(r.amount)}
            sub={
              r.cappedByCeiling
                ? `Capped at the statutory ceiling of ${lakhs(C.GRATUITY_MAX_PAYOUT)}`
                : `${years} years of service`
            }
          />
        )}

        <Card className="p-5">
          <p className="text-caption uppercase text-n-600">The working</p>
          <div className="mt-2">
            <ResultRow label="Last drawn Basic + DA" value={lastBasic} />
            <ResultRow label="Years of service" value={`${years}`} />
            <ResultRow label="Formula result" value={r.raw} />
            <ResultRow
              label="Statutory ceiling"
              value={C.GRATUITY_MAX_PAYOUT}
              note={r.cappedByCeiling ? 'applied' : 'not reached'}
              tone={r.cappedByCeiling ? 'default' : 'muted'}
            />
            <ResultRow
              label="Five-year eligibility"
              value={r.eligible ? 'Met' : 'Not met'}
              tone={r.eligible ? 'default' : 'negative'}
            />
            <ResultRow label="Payable" value={r.amount} tone="accent" />
          </div>
        </Card>

        {r.cappedByCeiling && (
          <p className="rounded-lg border border-accent-200 bg-accent-50 p-3.5 text-[13px] leading-5 text-n-700">
            The formula gives {rupees(r.raw)}, but the Payment of Gratuity Act caps a payout at{' '}
            {lakhs(C.GRATUITY_MAX_PAYOUT)}. The difference —{' '}
            <strong className="tnum">{rupees(r.raw - C.GRATUITY_MAX_PAYOUT)}</strong> — is not
            payable as gratuity.
          </p>
        )}
      </div>
    </div>
  );
}
