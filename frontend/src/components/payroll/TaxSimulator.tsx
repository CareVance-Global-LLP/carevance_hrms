import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Calculator } from 'lucide-react';
import { payrollApi } from '@/services/api';
import Button from '@/components/ui/Button';
import SurfaceCard from '@/components/dashboard/SurfaceCard';

export default function TaxSimulator() {
  const [annualCtc, setAnnualCtc] = useState<number>(1200000);
  const [isMetro, setIsMetro] = useState(true);
  const [exemptions, setExemptions] = useState<Record<string, number>>({
    section_80c: 150000,
    section_80d: 25000,
    section_24b: 200000,
    hra_exemption: 0,
    lta_exemption: 0,
  });

  const compareMutation = useMutation({
    mutationFn: (data: any) => payrollApi.compareTaxRegimes(data),
  });

  const whatIfMutation = useMutation({
    mutationFn: (data: any) => payrollApi.taxWhatIf(data),
  });

  const comparison = compareMutation.data as any;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <SurfaceCard className="p-5">
        <h3 className="text-sm font-semibold text-slate-900 mb-4">Income Parameters</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Annual CTC (₹)</label>
            <input
              type="number"
              value={annualCtc}
              onChange={(e) => setAnnualCtc(Number(e.target.value))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">City Type</label>
            <select
              value={isMetro ? 'metro' : 'non-metro'}
              onChange={(e) => setIsMetro(e.target.value === 'metro')}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="metro">Metro City</option>
              <option value="non-metro">Non-Metro City</option>
            </select>
          </div>
          <div>
            <h4 className="text-sm font-medium text-slate-700 mb-2">Exemptions / Deductions (₹)</h4>
            <div className="space-y-2">
              {[
                { key: 'section_80c', label: 'Section 80C' },
                { key: 'section_80d', label: 'Section 80D' },
                { key: 'section_24b', label: 'Home Loan (24B)' },
                { key: 'hra_exemption', label: 'HRA Exemption' },
                { key: 'lta_exemption', label: 'LTA Exemption' },
              ].map(({ key, label }) => (
                <div key={key} className="flex items-center gap-2">
                  <label className="text-sm text-slate-600 w-32">{label}</label>
                  <input
                    type="number"
                    value={exemptions[key]}
                    onChange={(e) => setExemptions(prev => ({ ...prev, [key]: Number(e.target.value) }))}
                    className="flex-1 border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              ))}
            </div>
          </div>
          <Button
            variant="primary"
            className="w-full"
            onClick={() => compareMutation.mutate({ annual_ctc: annualCtc, exemptions, is_metro: isMetro })}
            disabled={compareMutation.isPending}
            iconLeft={<Calculator className="h-4 w-4" />}
          >
            {compareMutation.isPending ? 'Calculating...' : 'Compare Tax Regimes'}
          </Button>
        </div>
      </SurfaceCard>

      <div className="space-y-4">
        {comparison ? (
          <>
            <SurfaceCard className="p-5">
              <h3 className="text-sm font-semibold text-slate-900 mb-4">Regime Comparison</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-amber-50 rounded-lg">
                  <div className="text-xs font-semibold text-amber-700 uppercase tracking-wider">Old Regime</div>
                  <div className="text-xl font-bold text-slate-900 mt-1">
                    ₹{Number(comparison.old_regime?.total_tax ?? 0).toLocaleString()}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    Take home: ₹{Number(comparison.old_regime?.take_home ?? 0).toLocaleString()}
                  </div>
                  <div className="text-xs text-slate-500">
                    Rate: {comparison.old_regime?.effective_rate ?? 0}%
                  </div>
                </div>
                <div className="p-4 bg-emerald-50 rounded-lg">
                  <div className="text-xs font-semibold text-emerald-700 uppercase tracking-wider">New Regime</div>
                  <div className="text-xl font-bold text-slate-900 mt-1">
                    ₹{Number(comparison.new_regime?.total_tax ?? 0).toLocaleString()}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    Take home: ₹{Number(comparison.new_regime?.take_home ?? 0).toLocaleString()}
                  </div>
                  <div className="text-xs text-slate-500">
                    Rate: {comparison.new_regime?.effective_rate ?? 0}%
                  </div>
                </div>
              </div>
              <div className={`mt-3 p-3 rounded-lg text-center text-sm font-medium ${
                (comparison.difference ?? 0) > 0
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-amber-50 text-amber-700'
              }`}>
                {(comparison.difference ?? 0) > 0
                  ? `New regime saves ₹${Math.abs(comparison.difference).toLocaleString()} per year`
                  : `Old regime saves ₹${Math.abs(comparison.difference).toLocaleString()} per year`
                }
              </div>
            </SurfaceCard>

            <SurfaceCard className="p-5">
              <h3 className="text-sm font-semibold text-slate-900 mb-3">What-If Scenarios</h3>
              <div className="space-y-2">
                {[
                  { label: '10% Hike', ctc: Math.round(annualCtc * 1.1) },
                  { label: '20% Hike', ctc: Math.round(annualCtc * 1.2) },
                  { label: '+ ₹5L Bonus', ctc: annualCtc + 500000 },
                ].map((scenario) => (
                  <button
                    key={scenario.label}
                    onClick={() => whatIfMutation.mutate({ current_ctc: annualCtc, scenarios: [{ label: scenario.label, ctc: scenario.ctc }] })}
                    className="w-full flex items-center justify-between p-3 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors"
                  >
                    <span className="text-sm font-medium text-slate-700">{scenario.label}</span>
                    <span className="text-sm text-slate-500">₹{scenario.ctc.toLocaleString()}</span>
                  </button>
                ))}
              </div>
            </SurfaceCard>
          </>
        ) : (
          <SurfaceCard className="p-5">
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Calculator className="h-12 w-12 text-slate-300 mb-3" />
              <p className="text-sm text-slate-500">Enter your CTC and exemptions above, then click Compare Tax Regimes</p>
            </div>
          </SurfaceCard>
        )}
      </div>
    </div>
  );
}
