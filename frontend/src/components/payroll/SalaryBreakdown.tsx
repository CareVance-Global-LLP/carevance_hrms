import { TrendingUp, TrendingDown, Wallet, Calculator } from 'lucide-react';
import InfoTooltip from '@/components/ui/InfoTooltip';
import type { PayrollCalculation, EmployeePayrollTemplate } from '@/types';

interface SalaryBreakdownProps {
  calculation: PayrollCalculation | null;
  template?: EmployeePayrollTemplate | null;
}

function formatCurrency(amount: number): string {
  return '₹' + Number(amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

function labelToGlossaryKey(label: string): string | null {
  const map: Record<string, string> = {
    basic: 'basic',
    hra: 'hra',
    conveyance: 'conveyance',
    pf_employee: 'pf_employee',
    pf_employer: 'pf_employer',
    esi_employee: 'esi_employee',
    esi_employer: 'esi_employer',
    professional_tax: 'pt',
    pt: 'pt',
    tds: 'tds',
    nps: 'nps',
    vpf: 'vpf',
    gross: 'gross',
    net: 'net',
    total: 'net',
    total_deductions: 'gross',
    lop: 'lop',
    overtime: 'overtime',
    special_allowance: 'basic',
    medical_allowance: 'ctc',
  };
  return map[label.toLowerCase()] ?? null;
}

export default function SalaryBreakdown({ calculation, template }: SalaryBreakdownProps) {
  if (!calculation) {
    return (
      <div className="bg-white rounded-lg border border-slate-200 p-6 text-center text-slate-500">
        <Calculator className="h-10 w-10 mx-auto mb-2 text-slate-300" />
        <p className="text-sm">Enter CTC to see salary breakdown</p>
      </div>
    );
  }

  const { monthly, components, breakdown } = calculation;
  const earnings = components?.earnings ?? {};
  const deductions = components?.deductions ?? {};

  const renderRow = (key: string, value: any, bold = false) => {
    const glossaryKey = labelToGlossaryKey(key);
    const labelText = key.replace(/_/g, ' ');
    return (
      <div className={`flex justify-between items-center text-sm py-1 border-b border-slate-100 ${bold ? 'font-semibold text-slate-900 bg-slate-50 -mx-2 px-2 rounded' : 'text-slate-700'}`}>
        <span className="flex items-center gap-1.5 capitalize">
          {labelText}
          {glossaryKey && <InfoTooltip title={labelText.toUpperCase()} content="See glossary for full explanation" size="sm" />}
        </span>
        <span className={bold ? 'font-bold text-slate-900' : 'font-medium text-slate-900'}>{formatCurrency(value as number)}</span>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Net pay headline */}
      <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 border border-emerald-200 rounded-xl p-5 flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wider flex items-center gap-1">
            Net Pay (Take Home)
            <InfoTooltip title="Net / Take-Home" content="What hits your bank account = Gross minus all deductions." size="sm" />
          </p>
          <p className="text-3xl font-bold text-emerald-900 mt-1">{formatCurrency(monthly.net)}</p>
          <p className="text-xs text-emerald-600 mt-1">
            {monthly.gross > 0 ? ((monthly.net / monthly.gross) * 100).toFixed(1) : 0}% of gross
          </p>
        </div>
        <Wallet className="h-12 w-12 text-emerald-300" />
      </div>

      {/* Earnings + Deductions side-by-side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1">
            <TrendingUp className="h-3 w-3" /> Earnings
            <InfoTooltip title="Gross Salary" content="Monthly salary before any deductions. Sum of Basic + HRA + allowances." size="sm" />
          </h4>
          <div className="space-y-1">
            {Object.entries(earnings).map(([key, value]) => (
              <div key={key}>
                {renderRow(key, value)}
              </div>
            ))}
            <div className="mt-1">{renderRow('gross', monthly.gross, true)}</div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1">
            <TrendingDown className="h-3 w-3" /> Deductions
            <InfoTooltip title="Statutory deductions" content="PF, ESI, PT, TDS — what's taken from Gross before Net." size="sm" />
          </h4>
          <div className="space-y-1">
            {Object.entries(deductions).map(([key, value]) => (
              <div key={key}>
                {renderRow(key, value)}
              </div>
            ))}
            <div className="mt-1">{renderRow('total_deductions', monthly.total_deductions, true)}</div>
          </div>
        </div>
      </div>

      {/* Statutory notes */}
      {breakdown && (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-600 space-y-1">
          {breakdown.pf_wages != null && (
            <p>• PF Wages: {formatCurrency(breakdown.pf_wages)}{breakdown.pf_cap_applied ? ' (Capped at ₹15,000)' : ''}</p>
          )}
          {breakdown.esi_applicable != null && (
            <p>• ESI: {breakdown.esi_applicable ? 'Applicable (salary < ₹21,000)' : 'Not Applicable'}</p>
          )}
          {breakdown.tax_regime && (
            <p>• Tax Regime: {breakdown.tax_regime === 'new' ? 'New Tax Regime' : 'Old Tax Regime'}</p>
          )}
          {template?.pt_state && <p>• PT State: {template.pt_state}</p>}
        </div>
      )}
    </div>
  );
}
