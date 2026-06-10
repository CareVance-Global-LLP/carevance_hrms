import { TrendingUp, TrendingDown } from 'lucide-react';
import type { PayrollCalculation, EmployeePayrollTemplate } from '@/types';

interface SalaryBreakdownProps {
  calculation: PayrollCalculation;
  template: EmployeePayrollTemplate;
  showEmployerContributions?: boolean;
}

function formatCurrency(amount: number): string {
  return '₹' + amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function SalaryBreakdown({ 
  calculation, 
  template,
  showEmployerContributions = true 
}: SalaryBreakdownProps) {
  const { monthly, components } = calculation;

  return (
    <div className="space-y-6">
      {/* Top Summary Cards */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-blue-50 rounded-xl p-4">
          <p className="text-xs text-blue-600 font-medium mb-1">Monthly CTC</p>
          <p className="text-xl font-bold text-blue-900">{formatCurrency(monthly.ctc)}</p>
        </div>
        <div className="bg-emerald-50 rounded-xl p-4">
          <p className="text-xs text-emerald-600 font-medium mb-1">Net Take Home</p>
          <p className="text-xl font-bold text-emerald-900">{formatCurrency(monthly.net)}</p>
        </div>
      </div>

      {/* Earnings Section */}
      <div className="bg-slate-50 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-4">
          <div className="h-8 w-8 rounded-lg bg-emerald-100 flex items-center justify-center">
            <TrendingUp className="h-4 w-4 text-emerald-600" />
          </div>
          <h4 className="font-semibold text-slate-900">Earnings</h4>
        </div>

        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-slate-600">Basic Salary</span>
            <span className="text-slate-400 text-sm">({template.basic_percentage}%)</span>
            <span className="font-medium">{formatCurrency(components.earnings.basic)}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-slate-600">HRA</span>
            <span className="text-slate-400 text-sm">({template.hra_percentage}% of Basic)</span>
            <span className="font-medium">{formatCurrency(components.earnings.hra)}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-slate-600">Conveyance Allowance</span>
            <span className="font-medium">{formatCurrency(components.earnings.conveyance)}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-slate-600">Special Allowance</span>
            <span className="font-medium">{formatCurrency(components.earnings.special_allowance)}</span>
          </div>
          <div className="pt-3 border-t border-slate-200 flex justify-between items-center">
            <span className="font-semibold text-slate-900">Gross Salary</span>
            <span className="font-bold text-slate-900">{formatCurrency(monthly.gross)}</span>
          </div>
        </div>
      </div>

      {/* Deductions Section */}
      <div className="bg-slate-50 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-4">
          <div className="h-8 w-8 rounded-lg bg-rose-100 flex items-center justify-center">
            <TrendingDown className="h-4 w-4 text-rose-600" />
          </div>
          <h4 className="font-semibold text-slate-900">Deductions</h4>
        </div>

        <div className="space-y-3">
          {template.pf_enabled && components.deductions.pf_employee > 0 && (
            <div className="flex justify-between items-center">
              <span className="text-slate-600">Provident Fund (PF)</span>
              <span className="text-slate-400 text-sm">(12%)</span>
              <span className="font-medium text-rose-600">-{formatCurrency(components.deductions.pf_employee)}</span>
            </div>
          )}
          {template.esi_enabled && components.deductions.esi_employee > 0 && (
            <div className="flex justify-between items-center">
              <span className="text-slate-600">ESI</span>
              <span className="text-slate-400 text-sm">(0.75%)</span>
              <span className="font-medium text-rose-600">-{formatCurrency(components.deductions.esi_employee)}</span>
            </div>
          )}
          {template.pt_enabled && components.deductions.pt > 0 && (
            <div className="flex justify-between items-center">
              <span className="text-slate-600">Professional Tax</span>
              <span className="text-slate-400 text-sm">({template.pt_state})</span>
              <span className="font-medium text-rose-600">-{formatCurrency(components.deductions.pt)}</span>
            </div>
          )}
          {template.tds_enabled && components.deductions.tds > 0 && (
            <div className="flex justify-between items-center">
              <span className="text-slate-600">Income Tax (TDS)</span>
              <span className="text-slate-400 text-sm">({template.tax_regime})</span>
              <span className="font-medium text-rose-600">-{formatCurrency(components.deductions.tds)}</span>
            </div>
          )}
          <div className="pt-3 border-t border-slate-200 flex justify-between items-center">
            <span className="font-semibold text-slate-900">Total Deductions</span>
            <span className="font-bold text-rose-600">-{formatCurrency(monthly.total_deductions)}</span>
          </div>
        </div>
      </div>

      {/* Net Pay Highlight */}
      <div className="bg-emerald-600 rounded-xl p-5 text-white">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-emerald-100 text-sm">Net Take Home Pay</p>
            <p className="text-3xl font-bold mt-1">{formatCurrency(monthly.net)}</p>
          </div>
          <div className="text-right text-sm text-emerald-100">
            <p>After deductions</p>
            <p className="font-semibold">{((monthly.net / monthly.gross) * 100).toFixed(1)}% of gross</p>
          </div>
        </div>
      </div>

      {/* Employer Contributions */}
      {showEmployerContributions && (
        <div className="bg-blue-50 rounded-xl p-4">
          <h4 className="font-semibold text-blue-900 mb-3">Employer Contributions</h4>
          <div className="space-y-2 text-sm">
            {template.pf_enabled && components.employer_contributions.pf_employer > 0 && (
              <div className="flex justify-between text-blue-800">
                <span>Provident Fund (12%)</span>
                <span>{formatCurrency(components.employer_contributions.pf_employer)}</span>
              </div>
            )}
            {template.esi_enabled && components.employer_contributions.esi_employer > 0 && (
              <div className="flex justify-between text-blue-800">
                <span>ESI (3.25%)</span>
                <span>{formatCurrency(components.employer_contributions.esi_employer)}</span>
              </div>
            )}
            <div className="flex justify-between text-blue-800">
              <span>Gratuity (4.81%)</span>
              <span>{formatCurrency(components.employer_contributions.gratuity)}</span>
            </div>
            <div className="pt-2 border-t border-blue-200 flex justify-between font-medium text-blue-900">
              <span>Total Employer Cost</span>
              <span>
                {formatCurrency(
                  (template.pf_enabled ? components.employer_contributions.pf_employer : 0) +
                  (template.esi_enabled ? components.employer_contributions.esi_employer : 0) +
                  components.employer_contributions.gratuity
                )}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Additional Info */}
      <div className="text-xs text-slate-400 space-y-1">
        <p>• PF Wages: {formatCurrency(calculation.breakdown.pf_wages)} {calculation.breakdown.pf_cap_applied && '(Capped at ₹15,000)'}</p>
        <p>• ESI: {calculation.breakdown.esi_applicable ? 'Applicable (salary < ₹21,000)' : 'Not Applicable'}</p>
        <p>• Tax Regime: {calculation.breakdown.tax_regime === 'new' ? 'New Tax Regime' : 'Old Tax Regime'}</p>
      </div>
    </div>
  );
}
