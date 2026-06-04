import { IndianRupee, TrendingUp, TrendingDown, Building2, User } from 'lucide-react';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import type { PayrollCalculation } from '@/types';

interface SalaryBreakdownProps {
  calculation: PayrollCalculation | null;
  isLoading?: boolean;
}

function formatCurrency(amount: number): string {
  return '₹' + amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function SalaryBreakdown({ calculation, isLoading }: SalaryBreakdownProps) {
  if (isLoading) {
    return (
      <SurfaceCard className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 w-48 rounded bg-slate-200" />
          <div className="h-32 rounded bg-slate-200" />
          <div className="h-32 rounded bg-slate-200" />
        </div>
      </SurfaceCard>
    );
  }

  if (!calculation) {
    return (
      <SurfaceCard className="p-6">
        <div className="text-center py-8">
          <IndianRupee className="mx-auto h-12 w-12 text-slate-300" />
          <p className="mt-4 text-sm text-slate-500">Enter CTC to see salary breakdown</p>
        </div>
      </SurfaceCard>
    );
  }

  const { monthly, annual, components, breakdown } = calculation;

  return (
    <SurfaceCard className="p-6">
      <div className="flex items-center gap-2 mb-6">
        <IndianRupee className="h-5 w-5 text-blue-600" />
        <h3 className="text-lg font-semibold text-slate-900">Salary Breakdown</h3>
        <span className="ml-auto text-xs px-2 py-1 rounded-full bg-blue-50 text-blue-700">
          {breakdown.tax_regime === 'new' ? 'New Tax Regime' : 'Old Tax Regime'}
        </span>
      </div>

      {/* CTC & Net Summary */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-slate-50 rounded-lg p-4">
          <p className="text-xs text-slate-500 uppercase tracking-wide">Monthly CTC</p>
          <p className="mt-1 text-2xl font-bold text-slate-950">{formatCurrency(monthly.ctc)}</p>
          <p className="text-xs text-slate-400 mt-1">Annual: {formatCurrency(annual.ctc)}</p>
        </div>
        <div className="bg-emerald-50 rounded-lg p-4">
          <p className="text-xs text-emerald-600 uppercase tracking-wide">Net Take Home</p>
          <p className="mt-1 text-2xl font-bold text-emerald-700">{formatCurrency(monthly.net)}</p>
          <p className="text-xs text-emerald-500 mt-1">Annual: {formatCurrency(annual.net)}</p>
        </div>
      </div>

      {/* Earnings */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp className="h-4 w-4 text-emerald-600" />
          <h4 className="text-sm font-semibold text-slate-900">Earnings</h4>
        </div>
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-slate-600">Basic Salary (40%)</span>
            <span className="font-medium">{formatCurrency(components.earnings.basic)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-slate-600">HRA ({breakdown.is_metro_city ? '50%' : '40%'} of Basic)</span>
            <span className="font-medium">{formatCurrency(components.earnings.hra)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-slate-600">Conveyance Allowance</span>
            <span className="font-medium">{formatCurrency(components.earnings.conveyance)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-slate-600">Special Allowance</span>
            <span className="font-medium">{formatCurrency(components.earnings.special_allowance)}</span>
          </div>
          <div className="flex justify-between text-sm pt-2 border-t border-slate-200">
            <span className="font-semibold text-slate-900">Gross Salary</span>
            <span className="font-semibold">{formatCurrency(monthly.gross)}</span>
          </div>
        </div>
      </div>

      {/* Deductions */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <TrendingDown className="h-4 w-4 text-rose-600" />
          <h4 className="text-sm font-semibold text-slate-900">Employee Deductions</h4>
        </div>
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-slate-600">Provident Fund (PF)</span>
            <span className="font-medium">{formatCurrency(components.deductions.pf_employee)}</span>
          </div>
          {components.deductions.esi_employee > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">ESI (0.75%)</span>
              <span className="font-medium">{formatCurrency(components.deductions.esi_employee)}</span>
            </div>
          )}
          <div className="flex justify-between text-sm">
            <span className="text-slate-600">Professional Tax ({breakdown.state_code})</span>
            <span className="font-medium">{formatCurrency(components.deductions.pt)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-slate-600">Income Tax (TDS)</span>
            <span className="font-medium">{formatCurrency(components.deductions.tds)}</span>
          </div>
          <div className="flex justify-between text-sm pt-2 border-t border-slate-200">
            <span className="font-semibold text-slate-900">Total Deductions</span>
            <span className="font-semibold text-rose-600">{formatCurrency(monthly.total_deductions)}</span>
          </div>
        </div>
      </div>

      {/* Employer Contributions */}
      <div className="mb-6 bg-blue-50 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <Building2 className="h-4 w-4 text-blue-600" />
          <h4 className="text-sm font-semibold text-blue-900">Employer Contributions</h4>
        </div>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-blue-700">Employer PF (12%)</span>
            <span className="font-medium">{formatCurrency(components.employer_contributions.pf_employer)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-blue-700">EPS (Pension - 8.33%)</span>
            <span className="font-medium">{formatCurrency(components.employer_contributions.eps)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-blue-700">EPF (3.67%)</span>
            <span className="font-medium">{formatCurrency(components.employer_contributions.epf)}</span>
          </div>
          {components.employer_contributions.esi_employer > 0 && (
            <div className="flex justify-between">
              <span className="text-blue-700">ESI (3.25%)</span>
              <span className="font-medium">{formatCurrency(components.employer_contributions.esi_employer)}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-blue-700">Gratuity Provision (4.81%)</span>
            <span className="font-medium">{formatCurrency(components.employer_contributions.gratuity)}</span>
          </div>
        </div>
      </div>

      {/* Compliance Info */}
      <div className="text-xs text-slate-500 space-y-1">
        <p>
          <strong>PF Wages:</strong> {formatCurrency(breakdown.pf_wages)} 
          {breakdown.pf_cap_applied && ' (Capped at ₹15,000)'}
        </p>
        <p>
          <strong>ESI:</strong> {breakdown.esi_applicable ? 'Applicable' : 'Not Applicable (Gross > ₹21,000)'}
        </p>
        <p>
          <strong>State:</strong> {breakdown.state_code.charAt(0).toUpperCase() + breakdown.state_code.slice(1)}
        </p>
      </div>
    </SurfaceCard>
  );
}
