import { AlertTriangle } from 'lucide-react';
import type { EmployeeSalaryBreakdown, SalaryBreakdownLine } from '@/types';
import { formatPayrollAmount } from '@/components/ui/PayrollAmount';

function LineTable({
  title,
  lines,
  emptyLabel,
}: {
  title: string;
  lines: SalaryBreakdownLine[];
  emptyLabel: string;
}) {
  const total = lines.reduce((sum, l) => sum + l.monthly, 0);

  return (
    <div className="rounded-lg border border-slate-200 overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</span>
        <span className="text-xs font-semibold text-slate-700">
          {formatPayrollAmount(total, { compact: true })}/mo
        </span>
      </div>
      {lines.length === 0 ? (
        <p className="px-3 py-4 text-xs text-slate-500">{emptyLabel}</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wider text-slate-500">Component</th>
              <th className="px-3 py-2 text-right text-[11px] font-medium uppercase tracking-wider text-slate-500">Monthly</th>
              <th className="px-3 py-2 text-right text-[11px] font-medium uppercase tracking-wider text-slate-500">Annual</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {lines.map((line) => (
              <tr key={line.key}>
                <td className="px-3 py-2 text-slate-700">
                  {line.label}
                  {line.origin === 'residual' && (
                    <span className="ml-1.5 text-[10px] text-slate-500">balances to CTC</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-900">
                  {formatPayrollAmount(line.monthly, { compact: true })}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                  {formatPayrollAmount(line.annual, { compact: true })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/**
 * The read-only rendering of a salary breakdown: headline tiles, the earnings
 * and deductions tables, employer cost, and the statutory footnotes.
 *
 * Purely presentational — it holds no state and offers no controls, so the same
 * markup serves the Add User review step and the interactive Salary Breakdown
 * panel. The panel wraps it in its own what-if inputs; the wizard shows it
 * bare. Neither has a second copy of this layout to keep in sync.
 */
export default function SalaryBreakdownView({
  breakdown,
  className = '',
}: {
  breakdown: EmployeeSalaryBreakdown;
  className?: string;
}) {
  return (
    <div className={`space-y-4 ${className}`.trim()}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Monthly CTC', value: breakdown.monthly.ctc },
          { label: 'Monthly Gross', value: breakdown.monthly.gross },
          { label: 'Deductions', value: breakdown.monthly.total_deductions },
          { label: 'Net (take-home)', value: breakdown.monthly.net },
        ].map((tile) => (
          <div key={tile.label} className="rounded-lg border border-slate-200 p-3">
            <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
              {tile.label}
            </div>
            <div className="mt-1 text-lg font-bold tabular-nums text-slate-900">
              {formatPayrollAmount(tile.value, { compact: true })}
            </div>
          </div>
        ))}
      </div>

      {breakdown.warnings.length > 0 && (
        <div className="space-y-2">
          {breakdown.warnings.map((w) => (
            <div
              key={w}
              className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <LineTable
          title={
            breakdown.source.salary_template_name
              ? `Earnings — ${breakdown.source.salary_template_name}`
              : 'Earnings'
          }
          lines={breakdown.earnings}
          emptyLabel="No earning components."
        />
        <LineTable
          title="Deductions"
          lines={breakdown.deductions}
          emptyLabel="No deductions apply to this employee."
        />
      </div>

      <LineTable
        title="Employer contributions (not deducted from the employee)"
        lines={breakdown.employer_contributions}
        emptyLabel="No employer contributions."
      />

      <p className="text-xs text-slate-500">
        Gross is CTC less employer PF and the gratuity provision.
        {breakdown.notes.pf_cap_applied &&
          ` PF is capped at the ₹15,000 wage ceiling (PF wages ${formatPayrollAmount(breakdown.notes.pf_wages, { compact: true })}).`}
        {!breakdown.notes.esi_applicable && ' ESI does not apply above the ₹21,000 gross threshold.'}
        {breakdown.notes.tds_is_estimate &&
          ` TDS is an estimate on the ${breakdown.notes.tax_regime} regime and changes as investment proofs are verified.`}
      </p>
    </div>
  );
}
