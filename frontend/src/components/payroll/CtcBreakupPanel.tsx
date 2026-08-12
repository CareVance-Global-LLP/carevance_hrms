import { useMemo } from 'react';
import { IndianRupee } from 'lucide-react';
import { FieldLabel, TextInput } from '@/components/ui/FormField';
import {
  DEFAULT_BASIC_PERCENTAGE,
  LABOUR_CODE_BASIC_FLOOR,
  calculateCtcBreakup,
  formatRupees,
} from '@/lib/payroll/ctcBreakup';

interface CtcBreakupPanelProps {
  /** Annual CTC as typed — a raw string, because it comes straight from the field. */
  annualCtc: string;
  /** Basic as a percentage of CTC, 0-100. Blank falls back to the engine default. */
  basicPercentage: string;
  onBasicPercentageChange: (value: string) => void;
  isMetroCity: boolean;
  onMetroChange: (value: boolean) => void;
}

/**
 * What an annual CTC actually means to the person, computed live.
 *
 * Add User collected a CTC and showed nothing back, so the admin typed a number
 * and had no idea what the joiner would receive. Every figure comes from
 * lib/payroll/ctcBreakup, which mirrors PayrollCalculatorService — see the note
 * there about why a preview that disagrees with the engine is worse than none.
 */
export default function CtcBreakupPanel({
  annualCtc,
  basicPercentage,
  onBasicPercentageChange,
  isMetroCity,
  onMetroChange,
}: CtcBreakupPanelProps) {
  const parsedCtc = Number(String(annualCtc).replace(/[^0-9.]/g, ''));
  const parsedBasicPct = Number(basicPercentage);

  const breakup = useMemo(
    () =>
      calculateCtcBreakup({
        annualCtc: parsedCtc,
        basicPercentage:
          Number.isFinite(parsedBasicPct) && parsedBasicPct > 0
            ? parsedBasicPct / 100
            : DEFAULT_BASIC_PERCENTAGE,
        isMetroCity,
      }),
    [parsedCtc, parsedBasicPct, isMetroCity],
  );

  if (!parsedCtc || parsedCtc <= 0) {
    return (
      <div className="mt-4 rounded-lg border border-dashed border-border-strong bg-surface-sunken px-4 py-6 text-center">
        <IndianRupee className="mx-auto h-5 w-5 text-slate-400" />
        <p className="mt-2 text-sm font-medium text-slate-700">Enter an annual CTC to see the breakup</p>
        <p className="mt-1 text-xs text-slate-500">
          Basic, HRA, PF and the monthly figure the employee actually receives.
        </p>
      </div>
    );
  }

  const rows: Array<{ label: string; value: number; note?: string; muted?: boolean }> = [
    { label: 'Basic', value: breakup.basic, note: `${Math.round(breakup.basicShareOfCtc * 100)}% of CTC — drives PF, gratuity and HRA` },
    { label: 'HRA', value: breakup.hra, note: isMetroCity ? '50% of basic (metro)' : '40% of basic (non-metro)' },
    { label: 'Conveyance', value: breakup.conveyance },
    { label: 'Special allowance', value: breakup.specialAllowance, note: 'balancing figure', muted: true },
  ];

  return (
    <div className="mt-4 space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <FieldLabel hint="optional">Basic % of CTC</FieldLabel>
          <TextInput
            type="number"
            min={1}
            max={100}
            value={basicPercentage}
            onChange={(event) => onBasicPercentageChange(event.target.value)}
            placeholder={String(DEFAULT_BASIC_PERCENTAGE * 100)}
          />
        </div>
        <div>
          <FieldLabel hint="affects HRA">Work city</FieldLabel>
          {/*
            Metro status is not decoration: the engine sets HRA to 50% of basic
            in a metro and 40% elsewhere, so getting it wrong moves real money.
          */}
          <div className="flex gap-2">
            {[
              { label: 'Non-metro', metro: false },
              { label: 'Metro', metro: true },
            ].map((option) => (
              <button
                key={option.label}
                type="button"
                aria-pressed={isMetroCity === option.metro}
                onClick={() => onMetroChange(option.metro)}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition ${
                  isMetroCity === option.metro
                    ? 'border-blue-500 bg-blue-50 text-blue-800'
                    : 'border-border-strong bg-surface-card text-slate-600 hover:border-blue-300'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!breakup.meetsLabourCodeFloor ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-semibold">
            Basic is {Math.round(breakup.basicShareOfCtc * 100)}% of CTC
          </p>
          <p className="mt-1">
            The labour codes put basic plus DA at a floor of{' '}
            {Math.round(LABOUR_CODE_BASIC_FLOOR * 100)}% of total remuneration. A lower basic also shrinks PF
            and gratuity, which is usually why one gets set. This is a warning, not a block — payroll will
            still run.
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="overflow-hidden rounded-lg border border-border-strong">
          <div className="flex items-center justify-between border-b border-border-strong bg-surface-sunken px-4 py-2">
            <span className="text-xs font-semibold text-slate-700">Earnings</span>
            <span className="text-[10px] uppercase tracking-[0.14em] text-slate-500">monthly</span>
          </div>
          <table className="w-full text-sm">
            <tbody>
              {rows.map((row) => (
                <tr key={row.label} className="border-b border-border-strong/40 last:border-b-0">
                  <td className="px-4 py-2 align-top">
                    <span className={row.muted ? 'italic text-slate-600' : 'text-slate-700'}>{row.label}</span>
                    {row.note ? <span className="block text-[11px] text-slate-500">{row.note}</span> : null}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-900">{formatRupees(row.value)}</td>
                </tr>
              ))}
              <tr className="bg-surface-sunken font-semibold">
                <td className="px-4 py-2 text-slate-900">Gross</td>
                <td className="px-4 py-2 text-right tabular-nums text-slate-900">{formatRupees(breakup.gross)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="overflow-hidden rounded-lg border border-border-strong">
          <div className="flex items-center justify-between border-b border-border-strong bg-surface-sunken px-4 py-2">
            <span className="text-xs font-semibold text-slate-700">Deductions &amp; employer cost</span>
            <span className="text-[10px] uppercase tracking-[0.14em] text-slate-500">monthly</span>
          </div>
          <table className="w-full text-sm">
            <tbody>
              <tr className="border-b border-border-strong/40">
                <td className="px-4 py-2 align-top">
                  <span className="text-slate-700">Employee PF</span>
                  <span className="block text-[11px] text-slate-500">12% of basic, capped at ₹15,000 wages</span>
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-slate-900">{formatRupees(breakup.employeePf)}</td>
              </tr>
              <tr className="border-b border-border-strong/40">
                <td className="px-4 py-2 align-top">
                  <span className="text-slate-700">Professional tax</span>
                  {/*
                    Not estimated. PT is state-levied, several states levy none,
                    and PTStateService is the authority — guessing here would put
                    a number on screen that payroll then contradicts.
                  */}
                  <span className="block text-[11px] text-slate-500">state-levied — applied at payroll run</span>
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-slate-500">—</td>
              </tr>
              <tr className="border-b border-border-strong/40">
                <td className="px-4 py-2 align-top">
                  <span className="text-slate-700">Employer PF</span>
                  <span className="block text-[11px] text-slate-500">part of CTC, not paid to the employee</span>
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-slate-600">{formatRupees(breakup.employerPf)}</td>
              </tr>
              <tr>
                <td className="px-4 py-2 align-top">
                  <span className="text-slate-700">Gratuity provision</span>
                  <span className="block text-[11px] text-slate-500">4.81% of basic</span>
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-slate-600">{formatRupees(breakup.gratuity)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-lg border border-blue-300 bg-blue-50 px-4 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">
          Monthly, before income tax
        </p>
        <p className="mt-1 text-2xl font-bold tabular-nums text-slate-950">
          {formatRupees(breakup.netBeforeTax)}
        </p>
        <p className="mt-1 text-xs text-slate-600">
          {Math.round(breakup.takeHomeRatio * 100)}% of the {formatRupees(Number(parsedCtc))} CTC.
          Income tax and professional tax are applied at the payroll run and are not included here.
        </p>
      </div>
    </div>
  );
}
