import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Calculator, TrendingUp, IndianRupee, Loader2, BarChart3, Info, Home } from 'lucide-react';
import { payrollApi, getApiErrorMessage } from '@/services/api';
import Button from '@/components/ui/Button';
import { TextInput, SelectInput, FieldLabel } from '@/components/ui/FormField';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import PageHeader from '@/components/dashboard/PageHeader';
import StatusBadge from '@/components/ui/StatusBadge';
import { formatPayrollAmount } from '@/components/ui/PayrollAmount';
import { useToast } from '@/components/ui/Toast';

const EXEMPTION_FIELDS = [
  { key: 'section_80c', label: '80C (EPF, PPF, ELSS, etc.)', limit: 150000 },
  { key: 'section_80d', label: '80D (Health Insurance)', limit: 25000 },
  { key: 'section_80ccd1b', label: '80CCD1B (NPS Additional)', limit: 50000 },
  { key: 'section_80e', label: '80E (Education Loan Interest)', limit: null },
  { key: 'section_80g', label: '80G (Donations)', limit: null },
  { key: 'hra_exemption', label: 'HRA Exemption', limit: null },
  { key: 'lta_exemption', label: 'LTA Exemption', limit: null },
  { key: 'home_loan_interest_24b', label: 'Home Loan Interest (24B)', limit: 200000 },
  { key: 'standard_deduction', label: 'Standard Deduction', limit: 75000 },
];

const HRA_FIELDS = [
  { key: 'basic_salary', label: 'Basic Salary (₹)', placeholder: 'e.g. 25000' },
  { key: 'hra_received', label: 'HRA Received (₹)', placeholder: 'e.g. 10000' },
  { key: 'rent_paid', label: 'Rent Paid (₹)', placeholder: 'e.g. 15000' },
];

export default function TaxSimulatorPage() {
  const { show } = useToast();
  const [annualCtc, setAnnualCtc] = useState('');
  const [isMetro, setIsMetro] = useState('false');
  const [exemptions, setExemptions] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<'compare' | 'whatif' | 'takehome' | 'hra'>('compare');
  const [hraInputs, setHraInputs] = useState<Record<string, string>>({});

  const compareMutation = useMutation({
    mutationFn: () => payrollApi.compareTaxRegimes({
      annual_ctc: parseFloat(annualCtc) || 0,
      exemptions: Object.fromEntries(Object.entries(exemptions).map(([k, v]) => [k, parseFloat(v) || 0])),
      is_metro: isMetro === 'true',
    }),
    onSuccess: () => show({ kind: 'success', message: 'Tax comparison ready.' }),
    onError: (e: any) => show({ kind: 'error', message: getApiErrorMessage(e, 'Failed to compare tax regimes.') }),
  });

  const takeHomeMutation = useMutation({
    mutationFn: () => payrollApi.calculateMonthlyTakeHome({
      annual_ctc: parseFloat(annualCtc) || 0,
      regime: 'new',
      exemptions: Object.fromEntries(Object.entries(exemptions).map(([k, v]) => [k, parseFloat(v) || 0])),
    }),
    onSuccess: () => show({ kind: 'success', message: 'Take-home calculated.' }),
    onError: (e: any) => show({ kind: 'error', message: getApiErrorMessage(e, 'Failed to calculate take-home.') }),
  });

  const [scenarios, setScenarios] = useState<Array<{ name: string; ctc: string }>>([
    { name: 'Current', ctc: annualCtc },
    { name: 'Scenario 1', ctc: '' },
  ]);

  const whatIfMutation = useMutation({
    mutationFn: () => payrollApi.taxWhatIf({
      current_ctc: parseFloat(scenarios[0]?.ctc || annualCtc) || 0,
      scenarios: scenarios.slice(1).filter(s => s.ctc).map(s => ({ name: s.name, annual_ctc: parseFloat(s.ctc) })),
    }),
    onSuccess: () => show({ kind: 'success', message: 'Scenarios calculated.' }),
    onError: (e: any) => show({ kind: 'error', message: getApiErrorMessage(e, 'Failed to run scenarios.') }),
  });

  const hraMutation = useMutation({
    mutationFn: () => payrollApi.hraOptimization({
      basic_salary: parseFloat(hraInputs.basic_salary) || 0,
      hra_received: parseFloat(hraInputs.hra_received) || 0,
      rent_paid: parseFloat(hraInputs.rent_paid) || 0,
      is_metro: isMetro === 'true',
    }),
    onSuccess: () => show({ kind: 'success', message: 'HRA optimization calculated.' }),
    onError: (e: any) => show({ kind: 'error', message: getApiErrorMessage(e, 'Failed to calculate HRA optimization.') }),
  });

  const handleExemptionChange = (key: string, value: string) => {
    setExemptions(prev => ({ ...prev, [key]: value }));
  };

  const handleHraInputChange = (key: string, value: string) => {
    setHraInputs(prev => ({ ...prev, [key]: value }));
  };

  const compareResult = compareMutation.data?.data || compareMutation.data;
  const takeHomeResult = takeHomeMutation.data?.data || takeHomeMutation.data;
  const whatIfResult = whatIfMutation.data?.data || whatIfMutation.data;
  const hraResult = hraMutation.data?.data || hraMutation.data;

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHeader title="Tax Simulator" description="Compare tax regimes and plan your taxes" />

      <div className="p-6 max-w-7xl mx-auto space-y-6">
        {/* Tabs */}
        <div className="flex gap-2">
          <Button
            variant={activeTab === 'compare' ? 'primary' : 'secondary'}
            size="sm"
            iconLeft={<BarChart3 className="h-4 w-4" />}
            onClick={() => setActiveTab('compare')}
          >
            Compare Regimes
          </Button>
          <Button
            variant={activeTab === 'whatif' ? 'primary' : 'secondary'}
            size="sm"
            iconLeft={<TrendingUp className="h-4 w-4" />}
            onClick={() => setActiveTab('whatif')}
          >
            What-If
          </Button>
          <Button
            variant={activeTab === 'takehome' ? 'primary' : 'secondary'}
            size="sm"
            iconLeft={<IndianRupee className="h-4 w-4" />}
            onClick={() => setActiveTab('takehome')}
          >
            Monthly Take-Home
          </Button>
          <Button
            variant={activeTab === 'hra' ? 'primary' : 'secondary'}
            size="sm"
            iconLeft={<Home className="h-4 w-4" />}
            onClick={() => setActiveTab('hra')}
          >
            HRA Optimizer
          </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Inputs Panel */}
          <SurfaceCard className="p-5 lg:col-span-1">
            <h3 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
              <Calculator className="h-5 w-5 text-blue-600" />
              Your Inputs
            </h3>
            <div className="space-y-4">
              <div>
                <FieldLabel>Annual CTC (₹)</FieldLabel>
                <TextInput
                  type="number"
                  value={annualCtc}
                  onChange={(e) => setAnnualCtc(e.target.value)}
                  placeholder="e.g. 1200000"
                />
              </div>
              <div>
                <FieldLabel>City Type</FieldLabel>
                <SelectInput value={isMetro} onChange={(e) => setIsMetro(e.target.value)}>
                  <option value="true">Metro City (Higher HRA)</option>
                  <option value="false">Non-Metro City</option>
                </SelectInput>
              </div>
              <div>
                <FieldLabel>Tax-Saving Investments</FieldLabel>
                <div className="space-y-3 mt-2">
                  {EXEMPTION_FIELDS.map(field => (
                    <div key={field.key}>
                      <label className="text-xs text-slate-500 flex items-center justify-between">
                        <span>{field.label}</span>
                        {field.limit && <span className="text-slate-400">Max: {formatPayrollAmount(field.limit, { compact: true })}</span>}
                      </label>
                      <TextInput
                        type="number"
                        value={exemptions[field.key] || ''}
                        onChange={(e) => handleExemptionChange(field.key, e.target.value)}
                        placeholder="0"
                        className="mt-1"
                      />
                    </div>
                  ))}
                </div>
              </div>
              {activeTab === 'compare' && (
                <Button
                  variant="primary"
                  className="w-full"
                  onClick={() => compareMutation.mutate()}
                  disabled={!annualCtc || compareMutation.isPending}
                  iconLeft={compareMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <BarChart3 className="h-4 w-4" />}
                >
                  {compareMutation.isPending ? 'Calculating...' : 'Compare Regimes'}
                </Button>
              )}
              {activeTab === 'takehome' && (
                <Button
                  variant="primary"
                  className="w-full"
                  onClick={() => takeHomeMutation.mutate()}
                  disabled={!annualCtc || takeHomeMutation.isPending}
                  iconLeft={takeHomeMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <IndianRupee className="h-4 w-4" />}
                >
                  {takeHomeMutation.isPending ? 'Calculating...' : 'Calculate Take-Home'}
                </Button>
              )}
              {activeTab === 'whatif' && (
                <Button
                  variant="primary"
                  className="w-full"
                  onClick={() => whatIfMutation.mutate()}
                  disabled={!annualCtc || whatIfMutation.isPending}
                  iconLeft={whatIfMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <TrendingUp className="h-4 w-4" />}
                >
                  {whatIfMutation.isPending ? 'Calculating...' : 'Run Scenarios'}
                </Button>
              )}
            </div>
          </SurfaceCard>

          {/* Results Panel */}
          <div className="lg:col-span-2 space-y-4">
            {activeTab === 'compare' && (
              <>
                {compareMutation.isPending && (
                  <SurfaceCard className="p-8 text-center">
                    <Loader2 className="h-8 w-8 animate-spin text-blue-600 mx-auto mb-2" />
                    <p className="text-slate-500">Calculating tax under both regimes...</p>
                  </SurfaceCard>
                )}
                {compareResult && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <SurfaceCard className="p-5">
                      <h3 className="text-lg font-semibold text-slate-900 mb-3 flex items-center gap-2">
                        <StatusBadge tone="info">New Regime</StatusBadge>
                        <span>Tax Liability</span>
                      </h3>
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-500">Gross Income</span>
                          <span className="font-medium">{formatPayrollAmount(compareResult?.new_regime?.gross_income || 0, { compact: true })}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-500">Total Deductions</span>
                          <span className="font-medium">{formatPayrollAmount(compareResult?.new_regime?.deductions || 0, { compact: true })}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-500">Taxable Income</span>
                          <span className="font-medium">{formatPayrollAmount(compareResult?.new_regime?.taxable_income || 0, { compact: true })}</span>
                        </div>
                        <div className="border-t pt-2 mt-2">
                          <div className="flex justify-between text-base font-bold">
                            <span>Annual Tax</span>
                            <span className="text-blue-600">{formatPayrollAmount(compareResult?.new_regime?.tax || 0, { compact: true })}</span>
                          </div>
                          <div className="flex justify-between text-xs text-slate-500 mt-1">
                            <span>Monthly TDS</span>
                            <span>{formatPayrollAmount(compareResult?.new_regime?.monthly_tds || 0, { compact: true })}</span>
                          </div>
                        </div>
                      </div>
                    </SurfaceCard>
                    <SurfaceCard className="p-5">
                      <h3 className="text-lg font-semibold text-slate-900 mb-3 flex items-center gap-2">
                        <StatusBadge tone="warning">Old Regime</StatusBadge>
                        <span>Tax Liability</span>
                      </h3>
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-500">Gross Income</span>
                          <span className="font-medium">{formatPayrollAmount(compareResult?.old_regime?.gross_income || 0, { compact: true })}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-500">Total Deductions</span>
                          <span className="font-medium">{formatPayrollAmount(compareResult?.old_regime?.deductions || 0, { compact: true })}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-500">Taxable Income</span>
                          <span className="font-medium">{formatPayrollAmount(compareResult?.old_regime?.taxable_income || 0, { compact: true })}</span>
                        </div>
                        <div className="border-t pt-2 mt-2">
                          <div className="flex justify-between text-base font-bold">
                            <span>Annual Tax</span>
                            <span className="text-amber-600">{formatPayrollAmount(compareResult?.old_regime?.tax || 0, { compact: true })}</span>
                          </div>
                          <div className="flex justify-between text-xs text-slate-500 mt-1">
                            <span>Monthly TDS</span>
                            <span>{formatPayrollAmount(compareResult?.old_regime?.monthly_tds || 0, { compact: true })}</span>
                          </div>
                        </div>
                      </div>
                    </SurfaceCard>
                    {compareResult?.recommendation && (
                      <SurfaceCard className="p-5 md:col-span-2">
                        <h3 className="text-sm font-semibold text-slate-900 mb-2 flex items-center gap-2">
                          <Info className="h-4 w-4 text-blue-600" />
                          Recommendation
                        </h3>
                        <p className="text-sm text-slate-600">
                          {compareResult.recommendation}
                          {compareResult.savings > 0 && (
                            <span className="font-semibold text-emerald-600 ml-1">
                              You save {formatPayrollAmount(compareResult.savings, { compact: true })} per year!
                            </span>
                          )}
                        </p>
                      </SurfaceCard>
                    )}
                  </div>
                )}
              </>
            )}

            {activeTab === 'takehome' && (
              <>
                {takeHomeMutation.isPending && (
                  <SurfaceCard className="p-8 text-center">
                    <Loader2 className="h-8 w-8 animate-spin text-blue-600 mx-auto mb-2" />
                    <p className="text-slate-500">Calculating monthly take-home...</p>
                  </SurfaceCard>
                )}
                {takeHomeResult && (
                  <SurfaceCard className="p-6">
                    <h3 className="text-lg font-semibold text-slate-900 mb-4">Monthly In-Hand Salary</h3>
                    <div className="space-y-3">
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-500">Monthly Gross</span>
                        <span className="font-medium">{formatPayrollAmount(takeHomeResult?.monthly_gross || 0, { compact: true })}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-500">PF (Employee)</span>
                        <span className="text-rose-600">- {formatPayrollAmount(takeHomeResult?.pf_employee || 0, { compact: true })}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-500">ESI (Employee)</span>
                        <span className="text-rose-600">- {formatPayrollAmount(takeHomeResult?.esi_employee || 0, { compact: true })}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-500">Professional Tax</span>
                        <span className="text-rose-600">- {formatPayrollAmount(takeHomeResult?.pt || 0, { compact: true })}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-500">TDS (Income Tax)</span>
                        <span className="text-rose-600">- {formatPayrollAmount(takeHomeResult?.tds || 0, { compact: true })}</span>
                      </div>
                      <div className="border-t pt-3">
                        <div className="flex justify-between text-xl font-bold">
                          <span>Take-Home</span>
                          <span className="text-emerald-600">{formatPayrollAmount(takeHomeResult?.take_home || 0, { compact: true })}</span>
                        </div>
                      </div>
                    </div>
                  </SurfaceCard>
                )}
              </>
            )}

            {activeTab === 'whatif' && (
              <SurfaceCard className="p-5">
                <h3 className="text-lg font-semibold text-slate-900 mb-4">What-If Scenarios</h3>
                <div className="space-y-3">
                  {scenarios.map((scenario, idx) => (
                    <div key={idx} className="flex items-center gap-3">
                      <input
                        type="text"
                        value={scenario.name}
                        onChange={(e) => {
                          const newScenarios = scenarios.map((s, i) =>
                            i === idx ? { ...s, name: e.target.value } : s
                          );
                          setScenarios(newScenarios);
                        }}
                        className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-40 focus:outline-none focus:ring-2 focus:ring-[#5D969D]"
                        placeholder="Name"
                      />
                      <TextInput
                        type="number"
                        value={idx === 0 ? annualCtc : scenario.ctc}
                        onChange={(e) => {
                          if (idx === 0) setAnnualCtc(e.target.value);
                          const newScenarios = scenarios.map((s, i) =>
                            i === idx ? { ...s, ctc: e.target.value } : s
                          );
                          setScenarios(newScenarios);
                        }}
                        placeholder="Annual CTC"
                        className="flex-1"
                      />
                      {idx > 0 && (
                        <Button variant="ghost" size="sm" onClick={() => setScenarios(scenarios.filter((_, i) => i !== idx))}>
                          Remove
                        </Button>
                      )}
                    </div>
                  ))}
                  <Button variant="secondary" size="sm" onClick={() => setScenarios([...scenarios, { name: `Scenario ${scenarios.length}`, ctc: '' }])}>
                    + Add Scenario
                  </Button>
                </div>
                {whatIfResult && (
                  <div className="mt-6 space-y-3">
                    <h4 className="text-sm font-semibold text-slate-900">Comparison Results</h4>
                    {Array.isArray(whatIfResult) ? whatIfResult.map((result: any, idx: number) => (
                      <div key={idx} className="p-3 bg-slate-50 rounded-lg">
                        <div className="flex justify-between items-center">
                          <span className="font-medium text-slate-900">{result.name || scenarios[idx]?.name}</span>
                          <span className="text-sm text-slate-500">CTC: {formatPayrollAmount(result.annual_ctc || 0, { compact: true })}</span>
                        </div>
                        <div className="flex justify-between items-center mt-1 text-sm">
                          <span className="text-slate-500">Annual Tax</span>
                          <span className="font-semibold">{formatPayrollAmount(result.tax || 0, { compact: true })}</span>
                        </div>
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-slate-500">Take-Home</span>
                          <span className="font-semibold text-emerald-600">{formatPayrollAmount(result.take_home || 0, { compact: true })}</span>
                        </div>
                      </div>
                    )) : null}
                  </div>
                )}
              </SurfaceCard>
            )}

            {/* HRA Optimization Tab */}
            {activeTab === 'hra' && (
              <SurfaceCard className="p-5">
                <h3 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
                  <Home className="h-5 w-5 text-blue-600" />
                  HRA Optimization Calculator
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                  {HRA_FIELDS.map(field => (
                    <div key={field.key}>
                      <FieldLabel>{field.label}</FieldLabel>
                      <TextInput
                        type="number"
                        value={hraInputs[field.key] || ''}
                        onChange={(e) => handleHraInputChange(field.key, e.target.value)}
                        placeholder={field.placeholder}
                      />
                    </div>
                  ))}
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => hraMutation.mutate()}
                  disabled={hraMutation.isPending}
                >
                  {hraMutation.isPending ? 'Calculating...' : 'Calculate HRA Exemption'}
                </Button>
                {hraResult && (
                  <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                    <SurfaceCard className="p-4 bg-slate-50">
                      <div className="text-sm text-slate-500">HRA Received</div>
                      <div className="text-xl font-bold text-slate-900">{formatPayrollAmount(hraResult.hra_received)}</div>
                    </SurfaceCard>
                    <SurfaceCard className="p-4 bg-slate-50">
                      <div className="text-sm text-slate-500">HRA Exemption (Tax Saving)</div>
                      <div className="text-xl font-bold text-emerald-600">{formatPayrollAmount(hraResult.hra_exemption)}</div>
                    </SurfaceCard>
                    <SurfaceCard className="p-4 bg-slate-50">
                      <div className="text-sm text-slate-500">Basic Salary</div>
                      <div className="text-xl font-bold text-slate-900">{formatPayrollAmount(hraResult.basic_salary)}</div>
                    </SurfaceCard>
                    <SurfaceCard className="p-4 bg-slate-50">
                      <div className="text-sm text-slate-500">Estimated Tax Saving</div>
                      <div className="text-xl font-bold text-blue-600">{formatPayrollAmount(hraResult.tax_saving)}</div>
                    </SurfaceCard>
                  </div>
                )}
                <div className="mt-4 text-xs text-slate-500 space-y-1">
                  <p>HRA exemption is the least of:</p>
                  <ul className="list-disc list-inside ml-4 space-y-0.5">
                    <li>Actual HRA received</li>
                    <li>50% of Basic Salary (Metro) / 40% (Non-Metro)</li>
                    <li>Rent paid minus 10% of Basic Salary</li>
                  </ul>
                </div>
              </SurfaceCard>
            )}

            {!compareMutation.isPending && !takeHomeMutation.isPending && !whatIfMutation.isPending && !hraMutation.isPending && !compareResult && !takeHomeResult && !whatIfResult && !hraResult && (
              <SurfaceCard className="p-8 text-center">
                <Calculator className="h-12 w-12 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500">Enter your details and click calculate to see results</p>
              </SurfaceCard>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
