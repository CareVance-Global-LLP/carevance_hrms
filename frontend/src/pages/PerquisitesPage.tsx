import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Briefcase, Search, Loader2, Plus, IndianRupee, Home, Car, GraduationCap, Wifi, Coffee } from 'lucide-react';
import { payrollApi } from '@/services/api';
import Button from '@/components/ui/Button';
import { TextInput, SelectInput, TextareaInput, FieldLabel } from '@/components/ui/FormField';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import PageHeader from '@/components/dashboard/PageHeader';
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
  const [userFilter, setUserFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    user_id: '',
    type: 'car',
    monthly_value: '',
    details: '',
  });

  const { data: usersData } = useQuery({
    queryKey: ['payroll-employees'],
    queryFn: () => payrollApi.getEmployees().then(res => res.data ?? []),
  });

  const { data: perquisitesData, isLoading } = useQuery({
    queryKey: ['perquisites', userFilter],
    queryFn: () => userFilter
      ? payrollApi.getUserPerquisites(parseInt(userFilter)).then(res => res.data)
      : null,
    enabled: !!userFilter,
  });

  const createMutation = useMutation({
    mutationFn: () => payrollApi.createPerquisite({
      user_id: parseInt(formData.user_id),
      type: formData.type,
      monthly_value: parseFloat(formData.monthly_value),
      details: formData.details ? { notes: formData.details } : {},
    }),
    onSuccess: () => {
      setShowForm(false);
      setFormData({ user_id: '', type: 'car', monthly_value: '', details: '' });
      queryClient.invalidateQueries({ queryKey: ['perquisites'] });
    },
  });

  const users = Array.isArray(usersData) ? usersData : [];
  const perquisites = Array.isArray(perquisitesData) ? perquisitesData : (perquisitesData as any)?.records ?? [];

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHeader
        title="Perquisites"
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
                  <Icon className="h-5 w-5 text-blue-600 mx-auto mb-1" />
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
                <SelectInput value={formData.type} onChange={(e) => setFormData({ ...formData, type: e.target.value })}>
                  {PERQUISITE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </SelectInput>
              </div>
              <div>
                <FieldLabel>Monthly Value (₹)</FieldLabel>
                <TextInput
                  type="number"
                  value={formData.monthly_value}
                  onChange={(e) => setFormData({ ...formData, monthly_value: e.target.value })}
                  placeholder="0"
                />
              </div>
              <div>
                <FieldLabel>Details (Optional)</FieldLabel>
                <TextareaInput
                  value={formData.details}
                  onChange={(e) => setFormData({ ...formData, details: e.target.value })}
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
                disabled={!formData.user_id || !formData.monthly_value || createMutation.isPending}
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
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
              </div>
            ) : perquisites.length === 0 ? (
              <div className="text-center py-12">
                <Briefcase className="h-12 w-12 text-slate-300 mx-auto mb-3" />
                <p className="text-sm text-slate-500">No perquisites recorded for this employee</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50">
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Type</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Monthly Value</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Annual Value</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Taxable Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {perquisites.map((p: any, idx: number) => (
                      <tr key={p.id || idx} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-blue-50 text-blue-700">
                            {PERQUISITE_TYPES.find(t => t.value === p.type)?.label || p.type}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-900">₹{Number(p.monthly_value || 0).toLocaleString('en-IN')}</td>
                        <td className="px-4 py-3 text-slate-900">₹{Number(p.annual_value || (p.monthly_value * 12) || 0).toLocaleString('en-IN')}</td>
                        <td className="px-4 py-3 text-rose-600 font-medium">₹{Number(p.taxable_amount || p.annual_value || 0).toLocaleString('en-IN')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SurfaceCard>
        )}

        {/* Info Banner */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
          <p className="font-medium">About Perquisites:</p>
          <p className="mt-1">Perquisites are benefits provided by the employer in addition to salary. They are taxable under the head "Income from Salaries" and are reported in Form 12BA. The taxable value is calculated based on Income Tax Rules.</p>
        </div>
      </div>
    </div>
  );
}
