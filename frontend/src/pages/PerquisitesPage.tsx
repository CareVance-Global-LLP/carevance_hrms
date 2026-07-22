import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Briefcase, Plus, IndianRupee, Home, Car, GraduationCap, Wifi, Coffee, Pencil } from 'lucide-react';
import { payrollApi, getApiErrorMessage } from '@/services/api';
import Button from '@/components/ui/Button';
import { TextInput, SelectInput, TextareaInput, FieldLabel } from '@/components/ui/FormField';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import PageHeader from '@/components/dashboard/PageHeader';
import { formatPayrollAmount } from '@/components/ui/PayrollAmount';
import { PageLoadingState, PageEmptyState } from '@/components/ui/PageState';
import { useToast } from '@/components/ui/Toast';
import HowItWorksCard from '@/components/payroll/HowItWorksCard';

const PERQUISITE_TYPES = [
  { value: 'car', label: 'Company Car', icon: Car },
  { value: 'accommodation', label: 'Accommodation', icon: Home },
  { value: 'esop', label: 'ESOP', icon: Briefcase },
  { value: 'sweeper', label: 'Sweeper/Driver', icon: Briefcase },
  { value: 'gardener', label: 'Gardener', icon: Briefcase },
  { value: 'domestic_help', label: 'Domestic Help', icon: Briefcase },
  { value: 'gas_electricity', label: 'Gas/Electricity', icon: Wifi },
  { value: 'free_food', label: 'Free Food', icon: Coffee },
  { value: 'education', label: 'Education', icon: GraduationCap },
  { value: 'others', label: 'Others', icon: Briefcase },
];

export default function PerquisitesPage() {
  const queryClient = useQueryClient();
  const { show } = useToast();
  const [userFilter, setUserFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    user_id: '',
    perquisite_type: 'car',
    annual_value: '',
    description: '',
  });

  const { data: usersData } = useQuery({
    queryKey: ['payroll-employees'],
    queryFn: () => payrollApi.getEmployees().then(res => res.data ?? []),
  });

  const { data: perquisitesData, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['perquisites', userFilter],
    queryFn: () => userFilter
      ? payrollApi.getUserPerquisites(parseInt(userFilter)).then(res => res.data)
      : null,
    enabled: !!userFilter,
  });

  const createMutation = useMutation({
    mutationFn: () => payrollApi.createPerquisite({
      user_id: parseInt(formData.user_id),
      perquisite_type: formData.perquisite_type,
      annual_value: parseFloat(formData.annual_value),
      description: formData.description || undefined,
    }),
    onSuccess: () => {
      setShowForm(false);
      setFormData({ user_id: '', perquisite_type: 'car', annual_value: '', description: '' });
      queryClient.invalidateQueries({ queryKey: ['perquisites'] });
      show({ kind: 'success', message: 'Perquisite added.' });
    },
    onError: (e: any) => show({ kind: 'error', message: getApiErrorMessage(e, 'Failed to add perquisite.') }),
  });

  const users = Array.isArray(usersData) ? usersData : [];
  const perquisites = Array.isArray(perquisitesData) ? perquisitesData : (perquisitesData as any)?.records ?? [];

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHeader
        title="Perquisites — Q3 FY 25-26"
        description="Track taxable non-cash benefits (rent-free house, company car, club membership) — added to TDS."
      />

      <div className="p-6 max-w-7xl mx-auto space-y-6">
        <HowItWorksCard
          whatIsThis="Non-cash benefits provided to employees that have a taxable value per Income Tax Rules. Perquisite value is added to employee\'s taxable income, increasing TDS for the year."
          whenToUse={[
            'Rent-free or concessional accommodation provided by employer',
            'Company car used for personal purposes',
            'Interest-free or low-interest loans above ₹20,000',
            'ESOPs, club membership, domestic help, gas/electricity',
          ]}
          howItFlows={[
            { step: 1, label: 'Add perquisite', desc: 'Pick employee, type, and value (auto-calculated for some)' },
            { step: 2, label: 'System values it', desc: 'Per IT Rules — e.g. rent-free house = 15% of Basic (or actual rent)' },
            { step: 3, label: 'Tax impact', desc: 'Value flows into Form 16 and TDS projection' },
            { step: 4, label: 'Track in payslip', desc: 'Shown as taxable perquisite line item' },
          ]}
          commonMistakes={[
            'Forgetting that car fuel + driver are separate perquisites',
            'Not valuing accommodation correctly (city, basic, owned vs rented)',
            'Missing ESOP perquisite on exercise date (taxable at difference between FMV and exercise price)',
          ]}
        />

        {/* Action Bar */}
        <div className="flex items-center justify-between">
          <SurfaceCard className="p-4 flex-1 mr-4">
            <div className="flex items-end gap-4">
              <div className="flex-1">
                <FieldLabel>Select Employee to View Perquisites</FieldLabel>
                <SelectInput value={userFilter} onChange={(e) => setUserFilter(e.target.value)}>
                  <option value="">Select employee...</option>
                  {users.map((u: any) => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
                </SelectInput>
              </div>
            </div>
          </SurfaceCard>
          <Button variant="primary" iconLeft={<Plus className="h-4 w-4" />} onClick={() => setShowForm(true)}>
            Add Perquisite
          </Button>
        </div>

        {/* Perquisites Types Info */}
        <SurfaceCard className="p-5">
          <h3 className="text-lg font-semibold text-slate-900 mb-4">Perquisite Types (Taxable)</h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {PERQUISITE_TYPES.map(type => {
              const Icon = type.icon;
              return (
                <div key={type.value} className="p-3 bg-slate-50 rounded-lg text-center">
                  <Icon className="h-5 w-5 text-[#5D969D] mx-auto mb-1" />
                  <p className="text-xs text-slate-700">{type.label}</p>
                </div>
              );
            })}
          </div>
        </SurfaceCard>

        {/* Add Form */}
        {showForm && (
          <SurfaceCard className="p-5">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">Add Perquisite Record</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <FieldLabel>Employee</FieldLabel>
                <SelectInput value={formData.user_id} onChange={(e) => setFormData({ ...formData, user_id: e.target.value })}>
                  <option value="">Select...</option>
                  {users.map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </SelectInput>
              </div>
              <div>
                <FieldLabel>Perquisite Type</FieldLabel>
                <SelectInput value={formData.perquisite_type} onChange={(e) => setFormData({ ...formData, perquisite_type: e.target.value })}>
                  {PERQUISITE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </SelectInput>
              </div>
              <div>
                <FieldLabel>Annual Value (₹)</FieldLabel>
                <TextInput
                  type="number"
                  value={formData.annual_value}
                  onChange={(e) => setFormData({ ...formData, annual_value: e.target.value })}
                  placeholder="0"
                />
              </div>
              <div>
                <FieldLabel>Description (Optional)</FieldLabel>
                <TextareaInput
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Additional details..."
                  rows={1}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button
                variant="primary"
                iconLeft={<IndianRupee className="h-4 w-4" />}
                onClick={() => createMutation.mutate()}
                disabled={!formData.user_id || !formData.annual_value || createMutation.isPending}
              >
                {createMutation.isPending ? 'Adding...' : 'Add Perquisite'}
              </Button>
            </div>
          </SurfaceCard>
        )}

        {/* Perquisites List */}
        {userFilter && (
          <SurfaceCard className="overflow-hidden">
            <h3 className="text-lg font-semibold text-slate-900 p-5 border-b">Perquisites Records</h3>
            {isLoading ? (
              <PageLoadingState label="Loading perquisites…" />
            ) : isError ? (
              <PageEmptyState
                title="Couldn't load perquisites"
                description={getApiErrorMessage(error, 'Please try again.')}
                action={
                  <Button variant="secondary" size="sm" onClick={() => refetch()}>
                    Retry
                  </Button>
                }
              />
            ) : perquisites.length === 0 ? (
              <PageEmptyState
                title="No perquisites recorded"
                description="No perquisites have been recorded for this employee yet."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50">
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Employee</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Type</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Description</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Taxable Value</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {perquisites.map((p: any, idx: number) => {
                      const emp = users.find((u: any) => String(u.id) === String(p.user_id));
                      return (
                        <tr key={p.id || idx} className="hover:bg-slate-50">
                          <td className="px-4 py-3">
                            <div className="font-medium text-slate-900">{emp?.name || p.user?.name || 'Unknown'}</div>
                            <div className="text-xs text-slate-500">{emp?.email || p.user?.email || ''}</div>
                          </td>
                          <td className="px-4 py-3">
                            <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] bg-[rgba(93,150,157,0.1)] text-[#5D969D]">
                              {PERQUISITE_TYPES.find(t => t.value === p.perquisite_type)?.label || p.perquisite_type}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-slate-600 max-w-[200px] truncate">{p.description || '-'}</td>
                          <td className="px-4 py-3 font-medium text-rose-600">{formatPayrollAmount(p.taxable_value || p.annual_value || 0, { compact: true })}</td>
                          <td className="px-4 py-3 text-right">
                            <button className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100" title="Edit">
                              <Pencil className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </SurfaceCard>
        )}

        {/* Info Banner */}
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-sm text-slate-700">
          <p className="font-medium">About Perquisites:</p>
          <p className="mt-1">Perquisites are benefits provided by the employer in addition to salary. They are taxable under the head "Income from Salaries" and are reported in Form 12BA. The taxable value is calculated based on Income Tax Rules.</p>
        </div>
      </div>
    </div>
  );
}
