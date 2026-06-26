import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, Save, Loader2, CheckCircle2, AlertCircle, IndianRupee, ChevronRight } from 'lucide-react';
import SetupLayout, { StepHeader } from './SetupLayout';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import { TextInput, SelectInput, FieldLabel } from '@/components/ui/FormField';
import Button from '@/components/ui/Button';
import InfoTooltip from '@/components/ui/InfoTooltip';
import { payrollApi } from '@/services/api';
import { usePayrollOnboarding } from '@/hooks/usePayrollOnboarding';

export default function SetupEmployees() {
  const queryClient = useQueryClient();
  const { status, markSetupStep } = usePayrollOnboarding();
  const isComplete = status?.steps.employees ?? false;
  const [search, setSearch] = useState('');
  const [ctcs, setCtcs] = useState<Record<number, string>>({});
  const [regimes, setRegimes] = useState<Record<number, 'new' | 'old'>>({});
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { data: employeesData, isLoading } = useQuery({
    queryKey: ['payroll', 'employees-list'],
    queryFn: () => payrollApi.getEmployees().then(res => res.data ?? []),
  });

  // Pull current org settings so new employee templates inherit them
  const { data: settingsData } = useQuery({
    queryKey: ['payroll', 'settings-existing'],
    queryFn: () => payrollApi.getPayrollSettings().then(res => res.data?.settings ?? {}),
  });
  const orgSettings = (settingsData as any) ?? {};

  const employees = Array.isArray(employeesData) ? employeesData : [];

  const filtered = employees.filter((e: any) =>
    !search ||
    e.name?.toLowerCase().includes(search.toLowerCase()) ||
    e.email?.toLowerCase().includes(search.toLowerCase())
  );

  const setCtc = (userId: number, val: string) =>
    setCtcs(prev => ({ ...prev, [userId]: val }));
  const setRegime = (userId: number, val: 'new' | 'old') =>
    setRegimes(prev => ({ ...prev, [userId]: val }));

  const handleSaveAll = async () => {
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      const updates: Array<{ userId: number; annual_ctc: number; regime?: string }> = [];
      for (const userIdStr of Object.keys(ctcs)) {
        const userId = parseInt(userIdStr);
        const ctc = parseFloat(ctcs[userId]);
        if (Number.isNaN(ctc) || ctc <= 0) continue;
        updates.push({
          userId,
          annual_ctc: ctc,
          regime: regimes[userId] ?? 'new',
        });
      }

      if (updates.length === 0) {
        setError('Enter at least one CTC to save.');
        return;
      }

      let successCount = 0;
      let failCount = 0;
      for (const u of updates) {
        try {
          // Pull live org settings for each save so any change made in SetupDefaults
          // is reflected in the template even if the user didn't re-open this page.
          await payrollApi.updateEmployeeTemplate(u.userId, {
            annual_ctc: u.annual_ctc,
            tax_regime: u.regime ?? orgSettings.defaultTaxRegime ?? 'new',
            pf_enabled: orgSettings.pfEnabled ?? true,
            esi_enabled: (orgSettings.esiEnabled ?? true) && (u.annual_ctc / 12) <= (orgSettings.esiThreshold ?? 21000),
            pt_enabled: orgSettings.ptEnabled ?? true,
            tds_enabled: orgSettings.tdsEnabled ?? true,
            lwf_enabled: orgSettings.lwfEnabled ?? false,
            pt_state: orgSettings.defaultState ?? 'maharashtra',
            is_metro_city: orgSettings.isMetroCity ?? true,
            basic_percentage: orgSettings.defaultBasicPercentage ?? 40,
            hra_percentage: orgSettings.defaultHraPercentage ?? 50,
            conveyance_allowance: orgSettings.defaultConveyance ?? 1600,
          } as any);
          successCount++;
        } catch {
          failCount++;
        }
      }

      queryClient.invalidateQueries({ queryKey: ['payroll'] });
      queryClient.invalidateQueries({ queryKey: ['payroll', 'onboarding-status'] });
      setCtcs({});
      setRegimes({});

      if (failCount === 0) {
        setSuccess(`Saved CTC for ${successCount} employee${successCount === 1 ? '' : 's'}.`);
      } else {
        setSuccess(`Saved ${successCount}, failed ${failCount}.`);
      }
      setTimeout(() => setSuccess(null), 5000);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Failed to save');
    } finally {
      setSubmitting(false);
    }
  };

  const handleMarkComplete = async () => {
    try {
      await markSetupStep('employees');
      queryClient.invalidateQueries({ queryKey: ['payroll', 'onboarding-status'] });
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Failed to save progress');
    }
  };

  const employeesWithCtc = status?.employees_with_ctc ?? 0;
  const employeesTotal = status?.employees_total ?? employees.length;
  const remaining = Math.max(0, employeesTotal - employeesWithCtc);
  const pendingChanges = Object.values(ctcs).filter(v => parseFloat(v) > 0).length;

  return (
    <SetupLayout currentStep="employees">
      <StepHeader
        stepNumber={4}
        title="Employees & CTC"
        description="Set the annual CTC for each employee. New templates inherit your org defaults from Step 2."
        isComplete={isComplete}
      />

      <SurfaceCard className="p-4 mb-4 bg-blue-50 border-blue-200">
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <div>
            <span className="font-medium text-blue-900">{employeesWithCtc}</span>
            <span className="text-blue-700"> of </span>
            <span className="font-medium text-blue-900">{employeesTotal}</span>
            <span className="text-blue-700"> employees have CTC</span>
          </div>
          {remaining > 0 && (
            <div className="text-blue-800">
              · {remaining} remaining
            </div>
          )}
          {pendingChanges > 0 && (
            <div className="ml-auto text-blue-800">
              <span className="font-medium">{pendingChanges}</span> unsaved change{pendingChanges === 1 ? '' : 's'}
            </div>
          )}
        </div>
        {orgSettings.defaultState && (
          <div className="mt-2 text-xs text-blue-700">
            New templates will use: PT state <strong>{orgSettings.defaultState}</strong>, Basic <strong>{orgSettings.defaultBasicPercentage ?? 40}%</strong>, HRA <strong>{orgSettings.defaultHraPercentage ?? 50}%</strong>
          </div>
        )}
      </SurfaceCard>

      {error && (
        <div className="mb-4 p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-rose-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-rose-700 break-words flex-1">{error}</p>
          <button onClick={() => setError(null)} className="text-rose-400 hover:text-rose-600">×</button>
        </div>
      )}
      {success && (
        <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-start gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-emerald-700 break-words flex-1">{success}</p>
        </div>
      )}

      <SurfaceCard className="p-3 mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <TextInput
            placeholder="Search by name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
      </SurfaceCard>

      {isLoading ? (
        <SurfaceCard className="p-8 text-center">
          <Loader2 className="h-6 w-6 animate-spin mx-auto text-slate-400" />
        </SurfaceCard>
      ) : filtered.length === 0 ? (
        <SurfaceCard className="p-8 text-center">
          <p className="text-sm text-slate-500">No employees found.</p>
        </SurfaceCard>
      ) : (
        <SurfaceCard className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Employee</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    <span className="inline-flex items-center gap-1">
                      Annual CTC (₹)
                      <InfoTooltip content="Total annual package including all benefits, taxes paid by employer, and employee deductions. Not what hits the bank account — that\'s Net Pay." title="CTC" />
                    </span>
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    <span className="inline-flex items-center gap-1">
                      Tax Regime
                      <InfoTooltip content="New Regime: lower rates, fewer exemptions. Old Regime: higher rates, full 80C/80D/HRA deductions." title="Tax regime" />
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((emp: any) => {
                  const currentCtc = ctcs[emp.id] ?? '';
                  const currentRegime = regimes[emp.id] ?? (orgSettings.defaultTaxRegime ?? 'new');
                  const hasChange = currentCtc && parseFloat(currentCtc) > 0;
                  return (
                    <tr key={emp.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{emp.name}</div>
                        <div className="text-xs text-slate-500">{emp.email}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="relative max-w-[180px]">
                          <IndianRupee className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-400" />
                          <TextInput
                            type="number"
                            value={currentCtc}
                            onChange={(e) => setCtc(emp.id, e.target.value)}
                            placeholder="e.g. 1200000"
                            className={`pl-7 ${hasChange ? 'border-blue-300 bg-blue-50' : ''}`}
                          />
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <SelectInput
                          value={currentRegime}
                          onChange={(e) => setRegime(emp.id, e.target.value as 'new' | 'old')}
                          className="max-w-[140px]"
                        >
                          <option value="new">New</option>
                          <option value="old">Old</option>
                        </SelectInput>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SurfaceCard>
      )}

      <div className="mt-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <Button variant="secondary" onClick={handleMarkComplete} disabled={isComplete}>
          {isComplete ? 'Marked as complete ✓' : 'Skip — mark as complete'}
        </Button>
        {pendingChanges > 0 && (
          <Button
            variant="primary"
            iconLeft={submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            onClick={handleSaveAll}
            disabled={submitting}
          >
            {submitting ? 'Saving...' : `Save ${pendingChanges} CTC${pendingChanges === 1 ? '' : 's'}`}
          </Button>
        )}
      </div>
    </SetupLayout>
  );
}
