import { useState } from 'react';
import { BarChart3, Search, TrendingUp, Loader2, IndianRupee, CheckCircle } from 'lucide-react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { payrollApi } from '@/services/api';
import Button from '@/components/ui/Button';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import PageHeader from '@/components/dashboard/PageHeader';
import HowItWorksCard from './HowItWorksCard';
import { useToast } from '@/components/ui/Toast';
import { TextInput, FieldLabel } from '@/components/ui/FormField';

type Tab = 'daily-wage' | 'ctc-bands' | 'find-band';

interface DailyWageStructure {
  id?: number;
  label: string;
  description?: string;
  rate: number;
  applicable_to?: string;
  [key: string]: any;
}

interface CtcBand {
  id?: number;
  label: string;
  min_ctc: number;
  max_ctc: number;
  benefits?: string;
  level?: string;
  [key: string]: any;
}

export default function CompensationBands() {
  const { show } = useToast();
  const [activeTab, setActiveTab] = useState<Tab>('ctc-bands');
  const [annualCtc, setAnnualCtc] = useState('');

  // Fetch CTC Bands
  const { data: ctcBands, isLoading: ctcLoading } = useQuery({
    queryKey: ['ctc-bands'],
    queryFn: () => payrollApi.listCtcBands().then(res => res.data?.data ?? res.data ?? []),
    enabled: activeTab === 'ctc-bands',
  });

  // Fetch Daily Wage Structures
  const { data: dailyWageStructures, isLoading: wageLoading } = useQuery({
    queryKey: ['daily-wage-structures'],
    queryFn: () => payrollApi.listDailyWageStructures().then(res => res.data?.data ?? res.data ?? []),
    enabled: activeTab === 'daily-wage',
  });

  // Find CTC Band mutation
  const findBandMutation = useMutation({
    mutationFn: (ctc: number) => payrollApi.findCtcBand(ctc),
    onSuccess: (_data) => {
      show({ kind: 'success', message: 'Band found successfully', durationMs: 3000 });
    },
    onError: (e: any) => {
      show({ kind: 'error', message: e.message || 'No matching band found', durationMs: 4000 });
    },
  });

  const handleFindBand = () => {
    const ctc = parseFloat(annualCtc);
    if (isNaN(ctc) || ctc <= 0) {
      show({ kind: 'error', message: 'Please enter a valid annual CTC amount', durationMs: 3000 });
      return;
    }
    findBandMutation.mutate(ctc);
  };

  const formatCurrency = (amount: number) =>
    '₹' + amount.toLocaleString('en-IN', { maximumFractionDigits: 0 });

  const ctcBandList: CtcBand[] = Array.isArray(ctcBands) ? ctcBands : [];
  const wageList: DailyWageStructure[] = Array.isArray(dailyWageStructures) ? dailyWageStructures : [];

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHeader
        title="Compensation Bands"
        description="Manage daily wage structures and CTC bands for salary benchmarking and compliance"
      />
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        <HowItWorksCard
          whatIsThis="Compensation bands define salary ranges for different employee levels. CTC bands help benchmark salaries, while daily wage structures apply to contract and casual workers."
          whenToUse={[
            'Setting up salary ranges for new hires during onboarding',
            'Benchmarking compensation against industry standards',
            'Determining daily wage rates for contract/casual workers',
            'Planning annual increments within band boundaries',
          ]}
          howItFlows={[
            { step: 1, label: 'View bands', desc: 'Browse existing CTC bands and daily wage structures' },
            { step: 2, label: 'Find applicable band', desc: 'Enter annual CTC to find the matching band' },
            { step: 3, label: 'Apply to template', desc: 'Use band values when creating employee salary templates' },
          ]}
          commonMistakes={[
            'Setting CTC band min/max too narrow (no room for negotiation)',
            'Not updating bands annually for inflation/market changes',
            'Forgetting that daily wage workers have different statutory deductions',
            'Applying monthly rates to daily wage calculations',
          ]}
        />

        {/* Tab Navigation */}
        <div className="flex gap-1 border-b border-slate-200">
          {([
            { key: 'ctc-bands' as Tab, label: 'CTC Bands', icon: TrendingUp },
            { key: 'daily-wage' as Tab, label: 'Daily Wage Structures', icon: IndianRupee },
            { key: 'find-band' as Tab, label: 'Find My Band', icon: Search },
          ]).map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  isActive
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* CTC Bands Tab */}
        {activeTab === 'ctc-bands' && (
          <div className="space-y-4">
            {ctcLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
              </div>
            ) : ctcBandList.length === 0 ? (
              <SurfaceCard className="p-8 text-center">
                <BarChart3 className="h-12 w-12 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500">No CTC bands configured yet.</p>
                <p className="text-xs text-slate-500 mt-1">Bands are created from payroll settings.</p>
              </SurfaceCard>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {ctcBandList.map((band, idx) => (
                  <SurfaceCard key={band.id || idx} className="p-5">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="font-semibold text-slate-900">{band.label || `Band ${idx + 1}`}</h4>
                      {band.level && (
                        <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full">
                          {band.level}
                        </span>
                      )}
                    </div>
                    <div className="text-lg font-bold text-blue-600 mb-1">
                      {formatCurrency(band.min_ctc)} – {formatCurrency(band.max_ctc)}
                    </div>
                    <div className="text-xs text-slate-500">
                      Annual CTC range
                    </div>
                    {band.benefits && (
                      <div className="mt-3 pt-3 border-t border-slate-100">
                        <div className="text-xs text-slate-500">Benefits:</div>
                        <div className="text-sm text-slate-700 mt-0.5">{band.benefits}</div>
                      </div>
                    )}
                  </SurfaceCard>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Daily Wage Structures Tab */}
        {activeTab === 'daily-wage' && (
          <div className="space-y-4">
            {wageLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
              </div>
            ) : wageList.length === 0 ? (
              <SurfaceCard className="p-8 text-center">
                <IndianRupee className="h-12 w-12 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500">No daily wage structures configured yet.</p>
                <p className="text-xs text-slate-500 mt-1">Daily wage rates are set in payroll organization settings.</p>
              </SurfaceCard>
            ) : (
              <SurfaceCard className="overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-slate-600">Label</th>
                      <th className="text-left px-4 py-3 font-medium text-slate-600">Description</th>
                      <th className="text-right px-4 py-3 font-medium text-slate-600">Daily Rate</th>
                      <th className="text-left px-4 py-3 font-medium text-slate-600">Applicable To</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {wageList.map((wage, idx) => (
                      <tr key={wage.id || idx} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-medium text-slate-900">{wage.label || '-'}</td>
                        <td className="px-4 py-3 text-slate-600">{wage.description || '-'}</td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-900">
                          {formatCurrency(wage.rate)}
                        </td>
                        <td className="px-4 py-3 text-slate-600">{wage.applicable_to || 'All'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </SurfaceCard>
            )}
          </div>
        )}

        {/* Find Band Tab */}
        {activeTab === 'find-band' && (
          <div className="space-y-6">
            <SurfaceCard className="p-5">
              <h3 className="font-semibold text-slate-900 mb-3">Find Matching CTC Band</h3>
              <p className="text-sm text-slate-500 mb-4">
                Enter an annual CTC amount to find which compensation band it falls into.
              </p>
              <div className="flex gap-3 items-end">
                <div className="flex-1">
                  <FieldLabel>Annual CTC (₹)</FieldLabel>
                  <TextInput
                    type="number"
                    value={annualCtc}
                    onChange={(e) => setAnnualCtc(e.target.value)}
                    placeholder="e.g., 1200000"
                  />
                </div>
                <Button
                  variant="primary"
                  size="md"
                  iconLeft={<Search className="h-4 w-4" />}
                  onClick={handleFindBand}
                  loading={findBandMutation.isPending}
                >
                  Find Band
                </Button>
              </div>
            </SurfaceCard>

            {findBandMutation.data && (
              <SurfaceCard className="p-5">
                {(() => {
                  const data = findBandMutation.data as any;
                  const band = data.band || data;
                  if (!band || Object.keys(band).length === 0) {
                    return (
                      <div className="flex items-center gap-2 text-amber-700">
                        <Search className="h-5 w-5" />
                        <span>No matching band found for this CTC amount.</span>
                      </div>
                    );
                  }
                  return (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-green-700">
                        <CheckCircle className="h-5 w-5" />
                        <span className="font-medium">Matching Band Found</span>
                      </div>
                      <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                        <div className="text-lg font-bold text-green-800">{band.label || 'Unnamed Band'}</div>
                        <div className="text-sm text-green-700 mt-1">
                          Range: {formatCurrency(band.min_ctc || 0)} – {formatCurrency(band.max_ctc || 0)}
                        </div>
                        {band.level && (
                          <div className="text-sm text-green-700 mt-1">Level: {band.level}</div>
                        )}
                        {band.benefits && (
                          <div className="text-sm text-green-700 mt-1">Benefits: {band.benefits}</div>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </SurfaceCard>
            )}

            {findBandMutation.isError && (
              <SurfaceCard className="p-5">
                <div className="flex items-center gap-2 text-red-700">
                  <Search className="h-5 w-5" />
                  <span>No matching band found for ₹{parseFloat(annualCtc).toLocaleString('en-IN')} annual CTC.</span>
                </div>
              </SurfaceCard>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
