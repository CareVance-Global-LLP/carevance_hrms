'use client';

import { useMemo, useState } from 'react';
import { salaryBreakup, rupees, lakhs, C } from '@/lib/calc';
import { PT_STATES } from '@/lib/pt-states';
import { Card } from '@/components/ui/primitives';
import {
  MoneyInput,
  NumberInput,
  SelectInput,
  SegmentedInput,
  ResultRow,
  Headline,
  Refusal,
} from '@/components/tools/ui';

const STATE_OPTIONS = PT_STATES.map((s) => ({
  value: s.code,
  label: s.levies ? s.name : `${s.name} — no PT`,
  group: s.type === 'state' ? 'States' : 'Union territories',
}));

export function SalaryBreakupCalculator() {
  const [ctc, setCtc] = useState(1440000);
  const [metro, setMetro] = useState<'metro' | 'non-metro'>('metro');
  const [state, setState] = useState('maharashtra');
  const [basicPct, setBasicPct] = useState(40);

  const isMetro = metro === 'metro';

  const r = useMemo(
    () =>
      salaryBreakup({
        annualCtc: ctc || 0,
        isMetro,
        stateCode: state,
        basicPct: (basicPct || 0) / 100,
      }),
    [ctc, isMetro, state, basicPct]
  );

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
            min={0}
          />
          <NumberInput
            id="basic-pct"
            label="Basic, as a percentage of CTC"
            hint="Most Indian structures sit between 35% and 50%."
            value={basicPct}
            onChange={setBasicPct}
            min={1}
            max={100}
            step={1}
            suffix="%"
          />
          <SegmentedInput
            label="City"
            hint="Metro means Delhi, Mumbai, Kolkata or Chennai — it sets HRA at 50% of basic instead of 40%."
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
        </div>
      </Card>

      <div className="grid gap-4">
        {r.impossible ? (
          /*
            The refusal, and the reason this calculator is different from every
            other salary-breakup tool: at a high basic percentage the structure
            genuinely cannot fit inside the CTC, because HRA, employer PF and the
            gratuity provision all scale with basic. Other calculators emit a
            negative special allowance and move on.
          */
          <Refusal>
            At {basicPct}% of CTC, Basic would be {rupees(r.basic)} — and HRA, employer PF and the
            gratuity provision scale with it. There is nothing left for the residual component,
            which would land at{' '}
            <strong className="text-danger-700">{rupees(r.special)}</strong>.
            <br />
            <br />
            The highest Basic this CTC can carry is{' '}
            <strong>{(r.maxBasicPct * 100).toFixed(1)}%</strong>. The payroll engine refuses this
            at entry, and names that maximum, rather than accepting it and failing weeks later.
          </Refusal>
        ) : (
          <Headline
            label="Monthly net pay"
            value={rupees(r.netMonthly)}
            sub={`${rupees(r.gross)} gross, less ${rupees(r.totalDeductions)} in deductions`}
          />
        )}

        <Card className="p-5">
          <p className="text-caption uppercase text-n-600">Monthly earnings</p>
          <div className="mt-2">
            <ResultRow label="Basic" value={r.basic} note={`${basicPct}% of CTC`} />
            <ResultRow
              label="House Rent Allowance"
              value={r.hra}
              note={`${isMetro ? 50 : 40}% of basic`}
            />
            <ResultRow label="Conveyance Allowance" value={r.conveyance} />
            <ResultRow
              label="Special Allowance"
              value={r.special}
              note="residual"
              tone={r.impossible ? 'negative' : 'default'}
            />
            <ResultRow label="Gross" value={r.gross} tone="total" />
          </div>

          <p className="mt-5 text-caption uppercase text-n-600">Deductions</p>
          <div className="mt-2">
            <ResultRow
              label="Provident Fund"
              value={r.employeePf}
              note={`12% of ${rupees(Math.min(r.basic, C.PF_WAGE_CAP))}`}
            />
            <ResultRow
              label="Employee State Insurance"
              value={r.esiEmployee === 0 ? '—' : r.esiEmployee}
              note={r.esiEmployee === 0 ? 'gross above ₹21,000' : '0.75% of gross'}
              tone={r.esiEmployee === 0 ? 'muted' : 'default'}
            />
            <ResultRow
              label="Professional Tax"
              value={r.pt === 0 ? '—' : r.pt}
              note={r.pt === 0 ? 'this state levies none' : undefined}
              tone={r.pt === 0 ? 'muted' : 'default'}
            />
            <ResultRow label="TDS" value={r.tdsNew} note="new regime, monthly" />
            <ResultRow label="Net pay" value={r.netMonthly} tone="accent" />
          </div>

          <p className="mt-5 text-caption uppercase text-n-600">
            Employer cost — inside CTC, not on the payslip
          </p>
          <div className="mt-2">
            <ResultRow
              label="Employer PF"
              value={r.employerPf.total}
              note={`EPS ${rupees(r.employerPf.eps)} · EPF ${rupees(r.employerPf.epf)}`}
            />
            <ResultRow label="Gratuity provision" value={r.gratuityProvision} note="4.81% of basic" />
            <ResultRow
              label="Total, back to monthly CTC"
              value={r.gross + r.employerPf.total + r.gratuityProvision}
              tone="total"
            />
          </div>
        </Card>

        <p className="text-[12px] leading-5 text-n-600">
          The residual component is what makes the last line equal your CTC exactly. That is the
          same mechanism the payroll engine uses, and the same one that makes raising Basic cost
          more than its face value.
        </p>
      </div>
    </div>
  );
}
