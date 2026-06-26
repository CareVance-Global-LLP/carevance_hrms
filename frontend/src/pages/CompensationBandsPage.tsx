import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Search, Loader2, IndianRupee, Layers, TrendingUp, DollarSign, Target } from 'lucide-react';
import { payrollApi } from '@/services/api';
import Button from '@/components/ui/Button';
import { TextInput } from '@/components/ui/FormField';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import PageHeader from '@/components/dashboard/PageHeader';
import HowItWorksCard from '@/components/payroll/HowItWorksCard';

type TabKey = 'daily-wage' | 'ctc-bands' | 'find-band';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'daily-wage', label: 'Daily Wage Structures' },
  { key: 'ctc-bands', label: 'CTC Bands' },
  { key: 'find-band', label: 'Find Band' },
];

export default function CompensationBandsPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('daily-wage');
  const [annualCtc, setAnnualCtc] = useState('');

  // Tab 1: Daily Wage Structures
  const { data: dailyWageData, isLoading: dailyWageLoading } = useQuery({
    queryKey: ['daily-wage-structures'],
    queryFn: () => payrollApi.listDailyWageStructures().then(res => res.data ?? []),
    enabled: activeTab === 'daily-wage',
  });

  // Tab 2: CTC Bands
  const { data: ctcBandsData, isLoading: ctcBandsLoading } = useQuery({
    queryKey: ['ctc-bands'],
    queryFn: () => payrollApi.listCtcBands().then(res => res.data ?? []),
    enabled: activeTab === 'ctc-bands',
  });

  // Tab 3: Find Band
  const findBandMutation = useMutation({
    mutationFn: () => payrollApi.findCtcBand(parseFloat(annualCtc)),
  });

  const dailyWageStructures = Array.isArray(dailyWageData) ? dailyWageData : [];
  const ctcBands = Array.isArray(ctcBandsData) ? ctcBandsData : [];
  const foundBand = findBandMutation.data?.data || findBandMutation.data;

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHeader
        title="Compensation Bands"
        description="Manage daily wage structures, CTC compensation bands, and find applicable bands for employees."
      />

      <div className="p-6 max-w-7xl mx-auto space-y-6">
        <HowItWorksCard
          whatIsThis="Compensation bands define the salary structure and benefits applicable to employees based on their level, role, or CTC range. Daily wage structures determine how daily-rate workers are paid, while CTC bands group employees into compensation tiers with associated perks and benefits."
          whenToUse={[
            'Setting up pay grades for new hires or after promotions',
            'Determining benefits eligibility based on compensation tier',
            'Calculating daily wages for contract or casual workers',
            'Standardizing compensation across similar roles',
          ]}
          howItFlows={[
            { step: 1, label: 'Define bands', desc: 'Create CTC bands with min/max ranges and assign benefits' },
            { step: 2, label: 'Assign structures', desc: 'Link daily wage rates to employment types or criteria' },
            { step: 3, label: 'Map employees', desc: 'Each employee falls into a band based on their annual CTC' },
            { step: 4, label: 'Apply benefits', desc: 'Benefits (insurance, bonuses, allowances) auto-apply per band' },
          ]}
          commonMistakes={[
            'Overlapping band ranges — ensure min/max do not conflict between tiers',
            'Forgetting to update bands after market revisions or annual increments',
            'Not mapping daily wage structures correctly to employment categories',
          ]}
        />

        {/* Tab Navigation */}
        <SurfaceCard className="p-1">
          <div className="flex gap-1">
            {TABS.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex-1 px-4 py-2.5 text-sm font-medium rounded-lg transition-colors ${
                  activeTab === tab.key
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </SurfaceCard>

        {/* Tab 1: Daily Wage Structures */}
        {activeTab === 'daily-wage' && (
          <SurfaceCard className="overflow-hidden">
            <div className="p-5 border-b border-slate-200">
              <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                <DollarSign className="h-5 w-5 text-blue-600" />
                Daily Wage Structures
              </h3>
              <p className="text-sm text-slate-500 mt-1">
                View all configured daily wage rates and their applicable criteria.
              </p>
            </div>
            {dailyWageLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
              </div>
            ) : dailyWageStructures.length === 0 ? (
              <div className="text-center py-12">
                <DollarSign className="h-12 w-12 text-slate-300 mx-auto mb-3" />
                <p className="text-sm text-slate-500">No daily wage structures configured yet</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50">
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Label</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Rate (₹/day)</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Applicable Criteria</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {dailyWageStructures.map((item: any, idx: number) => (
                      <tr key={item.id || idx} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3">
                          <span className="font-medium text-slate-900">{item.label || item.name || '-'}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center text-emerald-700 font-medium">
                            ₹{Number(item.rate || item.daily_rate || item.amount || 0).toLocaleString('en-IN')}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {item.applicable_criteria || item.criteria || item.description || '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SurfaceCard>
        )}

        {/* Tab 2: CTC Bands */}
        {activeTab === 'ctc-bands' && (
          <SurfaceCard className="overflow-hidden">
            <div className="p-5 border-b border-slate-200">
              <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                <Layers className="h-5 w-5 text-blue-600" />
                CTC Bands
              </h3>
              <p className="text-sm text-slate-500 mt-1">
                Compensation bands with CTC ranges and associated benefits.
              </p>
            </div>
            {ctcBandsLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
              </div>
            ) : ctcBands.length === 0 ? (
              <div className="text-center py-12">
                <Layers className="h-12 w-12 text-slate-300 mx-auto mb-3" />
                <p className="text-sm text-slate-500">No CTC bands configured yet</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50">
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Band Label</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Min CTC</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Max CTC</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Benefits</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {ctcBands.map((band: any, idx: number) => (
                      <tr key={band.id || idx} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-blue-50 text-blue-700">
                            {band.label || band.name || '-'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-900">
                          ₹{Number(band.min_ctc || band.min_salary || 0).toLocaleString('en-IN')}
                        </td>
                        <td className="px-4 py-3 text-slate-900">
                          {band.max_ctc || band.max_salary
                            ? `₹${Number(band.max_ctc || band.max_salary).toLocaleString('en-IN')}`
                            : 'No upper limit'}
                        </td>
                        <td className="px-4 py-3 text-slate-600 max-w-xs">
                          {band.benefits || band.description || '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SurfaceCard>
        )}

        {/* Tab 3: Find Band */}
        {activeTab === 'find-band' && (
          <div className="space-y-6">
            <SurfaceCard className="p-5">
              <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2 mb-4">
                <Target className="h-5 w-5 text-blue-600" />
                Find Applicable CTC Band
              </h3>
              <p className="text-sm text-slate-500 mb-4">
                Enter an annual CTC amount to find which compensation band it falls into.
              </p>
              <div className="flex gap-4 items-end">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Annual CTC (₹)
                  </label>
                  <TextInput
                    type="number"
                    value={annualCtc}
                    onChange={(e) => setAnnualCtc(e.target.value)}
                    placeholder="e.g. 800000"
                  />
                </div>
                <Button
                  variant="primary"
                  iconLeft={<Search className="h-4 w-4" />}
                  onClick={() => {
                    if (annualCtc && parseFloat(annualCtc) > 0) {
                      findBandMutation.mutate();
                    }
                  }}
                  disabled={!annualCtc || parseFloat(annualCtc) <= 0 || findBandMutation.isPending}
                  loading={findBandMutation.isPending}
                >
                  Find Band
                </Button>
              </div>
            </SurfaceCard>

            {/* Result */}
            {findBandMutation.isSuccess && foundBand && (
              <SurfaceCard className="p-5 border border-emerald-200 bg-emerald-50/30">
                <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2 mb-4">
                  <TrendingUp className="h-5 w-5 text-emerald-600" />
                  Matching Band Found
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-white rounded-lg p-4 border border-slate-200">
                    <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">Band Label</p>
                    <p className="text-lg font-semibold text-slate-900">
                      {foundBand.label || foundBand.name || '-'}
                    </p>
                  </div>
                  <div className="bg-white rounded-lg p-4 border border-slate-200">
                    <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">CTC Range</p>
                    <p className="text-lg font-semibold text-slate-900">
                      ₹{Number(foundBand.min_ctc || foundBand.min_salary || 0).toLocaleString('en-IN')}
                      {' — '}
                      {foundBand.max_ctc || foundBand.max_salary
                        ? `₹${Number(foundBand.max_ctc || foundBand.max_salary).toLocaleString('en-IN')}`
                        : 'No upper limit'}
                    </p>
                  </div>
                  {foundBand.benefits && (
                    <div className="bg-white rounded-lg p-4 border border-slate-200 md:col-span-2">
                      <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">Benefits</p>
                      <p className="text-sm text-slate-700">{foundBand.benefits}</p>
                    </div>
                  )}
                  {foundBand.description && (
                    <div className="bg-white rounded-lg p-4 border border-slate-200 md:col-span-2">
                      <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">Description</p>
                      <p className="text-sm text-slate-700">{foundBand.description}</p>
                    </div>
                  )}
                </div>
              </SurfaceCard>
            )}

            {findBandMutation.isSuccess && !foundBand && (
              <SurfaceCard className="p-5 border border-amber-200 bg-amber-50/30">
                <div className="text-center py-6">
                  <Search className="h-10 w-10 text-amber-400 mx-auto mb-3" />
                  <p className="text-sm font-medium text-amber-800">No matching band found</p>
                  <p className="text-xs text-amber-600 mt-1">
                    The entered CTC amount does not fall within any configured band.
                  </p>
                </div>
              </SurfaceCard>
            )}

            {findBandMutation.isError && (
              <SurfaceCard className="p-5 border border-rose-200 bg-rose-50/30">
                <div className="text-center py-6">
                  <p className="text-sm font-medium text-rose-800">Error finding band</p>
                  <p className="text-xs text-rose-600 mt-1">
                    Please check the input and try again.
                  </p>
                </div>
              </SurfaceCard>
            )}

            {/* Quick Reference */}
            {ctcBands.length > 0 && (
              <SurfaceCard className="p-5">
                <h3 className="text-sm font-semibold text-slate-700 mb-3">Quick Reference — Available Bands</h3>
                <div className="flex flex-wrap gap-2">
                  {ctcBands.map((band: any, idx: number) => (
                    <button
                      key={band.id || idx}
                      onClick={() => {
                        const mid = band.min_ctc
                          ? (Number(band.min_ctc) + Number(band.max_ctc || band.min_ctc)) / 2
                          : 0;
                        setAnnualCtc(mid.toString());
                      }}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-slate-100 text-slate-700 rounded-full hover:bg-blue-50 hover:text-blue-700 transition-colors"
                    >
                      {band.label || band.name}
                    </button>
                  ))}
                </div>
              </SurfaceCard>
            )}
          </div>
        )}

        {/* Info Banner */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
          <p className="font-medium">About Compensation Bands:</p>
          <p className="mt-1">
            Compensation bands standardize salary structures across the organization. Daily wage structures define rates for
            contract and casual workers, while CTC bands group employees into tiers with defined min/max ranges and
            associated benefits (insurance coverage, bonuses, allowances, etc.).
          </p>
        </div>
      </div>
    </div>
  );
}
