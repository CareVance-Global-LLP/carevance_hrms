import { useEffect, useMemo, useState } from 'react';
import { IndianRupee } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { payrollApi } from '@/services/api';
import { FieldLabel, TextInput } from '@/components/ui/FormField';
import {
  DEFAULT_BASIC_PERCENTAGE,
  DEFAULT_CONVEYANCE,
  LABOUR_CODE_BASIC_FLOOR,
  NON_METRO_HRA_PERCENTAGE_OF_BASIC,
  METRO_HRA_PERCENTAGE_OF_BASIC,
  type BreakupLine,
  calculateCtcBreakup,
  formatRupees,
  resolvePtAmount,
  structureToConfig,
} from '@/lib/payroll/ctcBreakup';

interface CtcBreakupPanelProps {
  annualCtc: string;
  /** Structure chosen in step 1, if any. */
  salaryStructureId?: number | null;
  isMetroCity: boolean;
  onMetroChange: (value: boolean) => void;
}

/** Percentages are held as strings so a half-typed value does not snap to 0. */
interface EditableConfig {
  basicPercentage: string;
  hraPercentage: string;
  daPercentage: string;
  conveyance: string;
  npsPercentage: string;
  vpfPercentage: string;
  allowances: BreakupLine[];
}

const toNumber = (value: string, fallback = 0): number => {
  const parsed = Number(String(value).replace(/[^0-9.]/g, ''));
  return Number.isFinite(parsed) ? parsed : fallback;
};

/**
 * What an annual CTC means month to month.
 *
 * Two sources, one calculation. When a salary structure is chosen in step 1 the
 * figures follow it; otherwise they follow the engine defaults. Either way the
 * admin can switch to Custom and edit every head, because a structure is a
 * starting point and the offer being made is sometimes not the template.
 *
 * Every figure comes from lib/payroll/ctcBreakup, which mirrors
 * PayrollCalculatorService — see the note there on why a preview that disagrees
 * with the engine is worse than no preview.
 */
export default function CtcBreakupPanel({
  annualCtc,
  salaryStructureId,
  isMetroCity,
  onMetroChange,
}: CtcBreakupPanelProps) {
  const parsedCtc = toNumber(annualCtc);
  const [mode, setMode] = useState<'structure' | 'custom'>('structure');

  /*
   * Shares the query key step 1 uses, so this is served from cache rather than
   * refetching the list the admin already loaded to pick a structure.
   */
  /*
   * Professional tax needs a state, and the wizard never collects one — Work
   * Location is Office/Remote/Hybrid, which says nothing about which state
   * levies PT. So the panel asks. Left blank it shows a dash, which is honest:
   * several states levy no PT at all, and guessing would put a number on screen
   * that payroll then contradicts.
   */
  const [ptStateCode, setPtStateCode] = useState('');

  const ptStatesQuery = useQuery({
    queryKey: ['pt-states'],
    queryFn: async () => (await payrollApi.getPTStates()).data,
    staleTime: 60 * 60 * 1000,
    enabled: parsedCtc > 0,
  });

  const ptConfigQuery = useQuery({
    queryKey: ['pt-state-configuration', ptStateCode],
    queryFn: async () => (await payrollApi.getPTConfiguration(ptStateCode)).data,
    enabled: Boolean(ptStateCode),
    staleTime: 60 * 60 * 1000,
  });

  const structuresQuery = useQuery({
    queryKey: ['add-user-salary-structures'],
    queryFn: async () => {
      const response = await payrollApi.getSalaryStructures();
      return response.data?.templates || [];
    },
    staleTime: 5 * 60 * 1000,
    enabled: parsedCtc > 0,
  });

  const structure = useMemo(
    () =>
      salaryStructureId
        ? (structuresQuery.data || []).find((item: any) => item.id === salaryStructureId) ?? null
        : null,
    [structuresQuery.data, salaryStructureId],
  );

  /** The structure's values, or the engine defaults when there is no structure. */
  const baseConfig = useMemo(() => {
    if (structure) return structureToConfig(structure);
    return {
      basicPercentage: DEFAULT_BASIC_PERCENTAGE,
      hraPercentageOfBasic: isMetroCity
        ? METRO_HRA_PERCENTAGE_OF_BASIC
        : NON_METRO_HRA_PERCENTAGE_OF_BASIC,
      daPercentage: 0,
      conveyance: DEFAULT_CONVEYANCE,
      allowances: [] as BreakupLine[],
      npsPercentage: 0,
      vpfPercentage: 0,
    };
  }, [structure, isMetroCity]);

  const [edited, setEdited] = useState<EditableConfig | null>(null);

  /*
   * Re-seed the editable copy whenever the underlying source changes — a
   * different structure, or metro toggled with no structure. Without this,
   * switching structures leaves the previous one's numbers on screen under the
   * new structure's name.
   */
  useEffect(() => {
    setEdited({
      basicPercentage: String(Math.round(baseConfig.basicPercentage * 1000) / 10),
      hraPercentage: String(Math.round(baseConfig.hraPercentageOfBasic * 1000) / 10),
      daPercentage: String(Math.round(baseConfig.daPercentage * 1000) / 10),
      conveyance: String(baseConfig.conveyance),
      npsPercentage: String(Math.round(baseConfig.npsPercentage * 1000) / 10),
      vpfPercentage: String(Math.round(baseConfig.vpfPercentage * 1000) / 10),
      allowances: baseConfig.allowances.map((line) => ({ ...line })),
    });
  }, [baseConfig]);

  const active = mode === 'custom' && edited ? edited : null;

  const breakup = useMemo(
    () =>
      calculateCtcBreakup({
        annualCtc: parsedCtc,
        basicPercentage: active
          ? toNumber(active.basicPercentage, 40) / 100
          : baseConfig.basicPercentage,
        hraPercentageOfBasic: active
          ? toNumber(active.hraPercentage, 40) / 100
          : baseConfig.hraPercentageOfBasic,
        daPercentage: active ? toNumber(active.daPercentage) / 100 : baseConfig.daPercentage,
        conveyance: active ? toNumber(active.conveyance) : baseConfig.conveyance,
        allowances: active ? active.allowances : baseConfig.allowances,
        npsPercentage: active ? toNumber(active.npsPercentage) / 100 : baseConfig.npsPercentage,
        vpfPercentage: active ? toNumber(active.vpfPercentage) / 100 : baseConfig.vpfPercentage,
      }),
    [parsedCtc, active, baseConfig],
  );

  if (!parsedCtc || parsedCtc <= 0) {
    return (
      <div className="mt-4 rounded-lg border border-dashed border-border-strong bg-surface-sunken px-4 py-6 text-center">
        <IndianRupee className="mx-auto h-5 w-5 text-slate-400" />
        <p className="mt-2 text-sm font-medium text-slate-700">Enter an annual CTC in step 1 to see the breakup</p>
        <p className="mt-1 text-xs text-slate-500">
          Basic, HRA, PF and the monthly figure the employee actually receives.
        </p>
      </div>
    );
  }

  const ptSlabs = ptConfigQuery.data?.configuration?.monthly ?? null;
  const ptAmount = resolvePtAmount(ptSlabs, breakup.gross);
  const ptStates = ptStatesQuery.data?.all_states ?? [];
  const ptStateHasNone = Boolean(ptStateCode) && ptConfigQuery.data && ptConfigQuery.data.has_pt === false;

  const editing = mode === 'custom' && edited;
  const patch = (changes: Partial<EditableConfig>) =>
    setEdited((current) => (current ? { ...current, ...changes } : current));

  const earningRows: Array<{ label: string; value: number; note?: string; muted?: boolean }> = [
    { label: 'Basic', value: breakup.basic, note: `${Math.round(breakup.basic / breakup.monthlyCtc * 100)}% of CTC — drives PF, gratuity and HRA` },
    ...(breakup.da > 0 ? [{ label: 'Dearness allowance', value: breakup.da, note: 'counts with basic toward the labour-code floor' }] : []),
    { label: 'HRA', value: breakup.hra, note: structure ? 'from the salary structure' : isMetroCity ? '50% of basic (metro)' : '40% of basic (non-metro)' },
    ...(breakup.conveyance > 0 ? [{ label: 'Conveyance', value: breakup.conveyance }] : []),
    ...breakup.allowances.map((line) => ({ label: line.label, value: line.amount })),
    { label: 'Special allowance', value: breakup.specialAllowance, note: 'balancing figure', muted: true },
  ];

  return (
    <div className="mt-4 space-y-4">
      {/* Where the numbers come from, and how to override them. */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border-strong bg-surface-sunken px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-800">
            {structure ? `Following “${structure.name}”` : 'Using organisation defaults'}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {structure
              ? 'Basic, HRA and allowances come from the salary structure picked in step 1.'
              : 'No salary structure selected in step 1, so the payroll engine defaults apply.'}
          </p>
        </div>
        <div className="flex gap-2">
          {[
            { key: 'structure' as const, label: structure ? 'Structure' : 'Defaults' },
            { key: 'custom' as const, label: 'Custom' },
          ].map((option) => (
            <button
              key={option.key}
              type="button"
              aria-pressed={mode === option.key}
              onClick={() => setMode(option.key)}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
                mode === option.key
                  ? 'border-blue-500 bg-blue-50 text-blue-800'
                  : 'border-border-strong bg-surface-card text-slate-600 hover:border-blue-300'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {editing ? (
        <div className="space-y-4 rounded-lg border border-blue-300 bg-blue-50/40 p-4">
          <p className="text-xs text-slate-600">
            Editing this breakup only. It changes what is shown here, not the salary structure itself.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <FieldLabel>Basic % of CTC</FieldLabel>
              <TextInput type="number" min={1} max={100} value={edited.basicPercentage}
                onChange={(e) => patch({ basicPercentage: e.target.value })} />
            </div>
            <div>
              <FieldLabel>HRA % of basic</FieldLabel>
              <TextInput type="number" min={0} max={100} value={edited.hraPercentage}
                onChange={(e) => patch({ hraPercentage: e.target.value })} />
            </div>
            <div>
              <FieldLabel>DA % of basic</FieldLabel>
              <TextInput type="number" min={0} max={100} value={edited.daPercentage}
                onChange={(e) => patch({ daPercentage: e.target.value })} />
            </div>
            <div>
              <FieldLabel>Conveyance ₹</FieldLabel>
              <TextInput type="number" min={0} value={edited.conveyance}
                onChange={(e) => patch({ conveyance: e.target.value })} />
            </div>
            <div>
              <FieldLabel>NPS % of basic</FieldLabel>
              <TextInput type="number" min={0} max={100} value={edited.npsPercentage}
                onChange={(e) => patch({ npsPercentage: e.target.value })} />
            </div>
            <div>
              <FieldLabel>VPF % of basic</FieldLabel>
              <TextInput type="number" min={0} max={100} value={edited.vpfPercentage}
                onChange={(e) => patch({ vpfPercentage: e.target.value })} />
            </div>
          </div>

          {edited.allowances.length > 0 ? (
            <div>
              <FieldLabel hint="monthly">Allowances from the structure</FieldLabel>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {edited.allowances.map((line, index) => (
                  <div key={line.label} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{line.label}</span>
                    <TextInput
                      type="number"
                      min={0}
                      className="w-32"
                      value={String(line.amount)}
                      aria-label={`${line.label} amount`}
                      onChange={(e) =>
                        patch({
                          allowances: edited.allowances.map((item, i) =>
                            i === index ? { ...item, amount: toNumber(e.target.value) } : item,
                          ),
                        })
                      }
                    />
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {!structure && !editing ? (
        <div>
          <FieldLabel hint="affects HRA">Work city</FieldLabel>
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
      ) : null}

      {/*
        PT is state-levied, so it cannot be shown without knowing the state —
        and the wizard collects Work Location as Office/Remote/Hybrid, which
        does not say. Asking here is what turns the dash into a number.
      */}
      <div>
        <FieldLabel hint="for professional tax">Work state</FieldLabel>
        <select
          value={ptStateCode}
          onChange={(event) => setPtStateCode(event.target.value)}
          aria-label="Work state for professional tax"
          className="w-full rounded-lg border border-border-strong bg-surface-card px-3.5 py-2.5 text-sm text-slate-900 shadow-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-300/30"
        >
          <option value="">Not set — professional tax not shown</option>
          {ptStates.map((state: any) => (
            <option key={state.code ?? state.state} value={state.code ?? state.state}>
              {state.name ?? state.state}
              {state.has_pt === false ? ' — levies none' : ''}
            </option>
          ))}
        </select>
      </div>

      {!breakup.meetsLabourCodeFloor ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-semibold">Basic{breakup.da > 0 ? ' plus DA' : ''} is {Math.round(breakup.basicShareOfCtc * 100)}% of CTC</p>
          <p className="mt-1">
            The labour codes put basic plus DA at a floor of {Math.round(LABOUR_CODE_BASIC_FLOOR * 100)}% of total
            remuneration. A lower basic also shrinks PF and gratuity, which is usually why one gets set. This is a
            warning, not a block — payroll will still run.
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
              {earningRows.map((row) => (
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
              {breakup.esiApplicable ? (
                <tr className="border-b border-border-strong/40">
                  <td className="px-4 py-2 align-top">
                    <span className="text-slate-700">Employee ESI</span>
                    <span className="block text-[11px] text-slate-500">0.75% of gross, applies at or below ₹21,000</span>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-900">{formatRupees(breakup.employeeEsi)}</td>
                </tr>
              ) : null}
              {breakup.nps > 0 ? (
                <tr className="border-b border-border-strong/40">
                  <td className="px-4 py-2"><span className="text-slate-700">NPS</span></td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-900">{formatRupees(breakup.nps)}</td>
                </tr>
              ) : null}
              {breakup.vpf > 0 ? (
                <tr className="border-b border-border-strong/40">
                  <td className="px-4 py-2"><span className="text-slate-700">VPF</span></td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-900">{formatRupees(breakup.vpf)}</td>
                </tr>
              ) : null}
              <tr className="border-b border-border-strong/40">
                <td className="px-4 py-2 align-top">
                  <span className="text-slate-700">Professional tax</span>
                  {/*
                    Resolved from the state's own slab table via
                    /payroll/pt-states, not estimated. With no state chosen this
                    stays a dash rather than a guess — several states levy none,
                    so a default would be wrong in both directions.
                  */}
                  <span className="block text-[11px] text-slate-500">
                    {!ptStateCode
                      ? 'set a work state above to show this'
                      : ptStateHasNone
                        ? 'this state levies no professional tax'
                        : 'from the state slab table'}
                  </span>
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-slate-900">
                  {ptStateCode && !ptConfigQuery.isLoading ? formatRupees(ptAmount) : <span className="text-slate-500">—</span>}
                </td>
              </tr>
              <tr className="border-b border-border-strong/40">
                <td className="px-4 py-2 align-top">
                  <span className="text-slate-700">Employer PF</span>
                  <span className="block text-[11px] text-slate-500">part of CTC, not paid to the employee</span>
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-slate-600">{formatRupees(breakup.employerPf)}</td>
              </tr>
              {breakup.esiApplicable ? (
                <tr className="border-b border-border-strong/40">
                  <td className="px-4 py-2 align-top">
                    <span className="text-slate-700">Employer ESI</span>
                    <span className="block text-[11px] text-slate-500">3.25% of gross</span>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-600">{formatRupees(breakup.employerEsi)}</td>
                </tr>
              ) : null}
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
          {formatRupees(breakup.netBeforeTax - ptAmount)}
        </p>
        <p className="mt-1 text-xs text-slate-600">
          {Math.round(((breakup.netBeforeTax - ptAmount) * 12) / parsedCtc * 100)}% of the{' '}
          {formatRupees(parsedCtc)} CTC.{' '}
          {ptStateCode ? 'Professional tax is included.' : 'Professional tax is not included — no work state set.'}{' '}
          Income tax is applied at the payroll run and is not included here.
        </p>
      </div>
    </div>
  );
}
