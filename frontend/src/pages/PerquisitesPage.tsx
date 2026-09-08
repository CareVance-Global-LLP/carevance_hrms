import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Briefcase, Plus, IndianRupee, Home, Car, GraduationCap, Wifi, Coffee, Search } from 'lucide-react';
import { payrollApi, getApiErrorMessage } from '@/services/api';
import Button from '@/components/ui/Button';
import { TextInput, SelectInput, FieldLabel, TextareaInput } from '@/components/ui/FormField';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import FilterPanel from '@/components/dashboard/FilterPanel';
import MetricCard from '@/components/dashboard/MetricCard';
import { formatPayrollAmount } from '@/components/ui/PayrollAmount';
import { PageLoadingState, PageErrorState, PageEmptyState } from '@/components/ui/PageState';
import { useToast } from '@/components/ui/Toast';
import HowItWorksCard from '@/components/payroll/HowItWorksCard';
import ModuleHeader from '@/components/payroll/ModuleHeader';
import PayrollDataTable, { type PayrollDataTableColumn } from '@/components/payroll/PayrollDataTable';
import EmployeePicker from '@/components/payroll/EmployeePicker';
import { useEmployees } from '@/hooks/useEmployees';
import { currentFinancialYear } from '@/lib/payroll/financialYear';

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
  const [searchQuery, setSearchQuery] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    user_id: '',
    perquisite_type: 'car',
    annual_value: '',
    description: '',
  });

  const { data: usersData } = useEmployees();
  const users = Array.isArray(usersData) ? usersData : [];

  const { data: perquisitesData, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['perquisites', userFilter],
    queryFn: () => userFilter
      ? payrollApi.getUserPerquisites(parseInt(userFilter)).then((res) => res.data)
      : null,
    enabled: !!userFilter,
  });

  const createMutation = useMutation({
    mutationFn: () => payrollApi.createPerquisite({
      user_id: parseInt(formData.user_id),
      perquisite_type: formData.perquisite_type,
      annual_value: parseFloat(formData.annual_value),
      taxable_value: parseFloat(formData.annual_value),
      financial_year: currentFinancialYear(),
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

  const perquisites = Array.isArray(perquisitesData) ? perquisitesData : (perquisitesData as any)?.records ?? [];

  const filteredPerquisites = perquisites.filter((p: any) => {
    if (!searchQuery) return true;
    const needle = searchQuery.toLowerCase();
    const typeLabel = PERQUISITE_TYPES.find((t) => t.value === p.perquisite_type)?.label ?? '';
    return (
      typeLabel.toLowerCase().includes(needle) ||
      String(p.perquisite_type ?? '').toLowerCase().includes(needle) ||
      String(p.description ?? '').toLowerCase().includes(needle)
    );
  });

  const selectedEmployee = users.find((u: any) => String(u.id) === userFilter);
  const totalTaxable = perquisites.reduce(
    (sum: number, p: any) => sum + Number(p.taxable_value || p.annual_value || 0),
    0,
  );

  const columns: PayrollDataTableColumn<any>[] = [
    {
      key: 'employee',
      header: 'Employee',
      render: (p, _idx) => {
        const emp = users.find((u: any) => String(u.id) === String(p.user_id));
        return (
          <div>
            <div className="font-medium text-slate-900">{emp?.name || p.user?.name || 'Unknown'}</div>
            <div className="text-xs text-slate-500">{emp?.email || p.user?.email || ''}</div>
          </div>
        );
      },
    },
    {
      key: 'type',
      header: 'Type',
      render: (p) => (
        <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] bg-blue-500/10 text-blue-600">
          {PERQUISITE_TYPES.find((t) => t.value === p.perquisite_type)?.label || p.perquisite_type}
        </span>
      ),
    },
    {
      key: 'description',
      header: 'Description',
      cellClassName: 'max-w-[200px] truncate',
      render: (p) => <span className="text-slate-600">{p.description || '-'}</span>,
    },
    {
      key: 'taxable',
      header: 'Taxable Value',
      align: 'right',
      render: (p) => (
        <span className="font-medium text-rose-600">
          {formatPayrollAmount(p.taxable_value || p.annual_value || 0, { compact: true })}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Perquisites"
        description="Track taxable non-cash benefits (rent-free house, company car, club membership) — added to TDS."
      />
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

      <FilterPanel>
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[240px]">
            <FieldLabel>Employee</FieldLabel>
            <SelectInput value={userFilter} onChange={(e) => setUserFilter(e.target.value)}>
              <option value="">Select employee...</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
            </SelectInput>
          </div>
          <div className="flex-1 min-w-[200px]">
            <FieldLabel>Search</FieldLabel>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
              <TextInput
                placeholder="Search type, description..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>
          <Button variant="primary" size="sm" iconLeft={<Plus className="h-4 w-4" />} onClick={() => setShowForm(true)}>
            Add Perquisite
          </Button>
        </div>
      </FilterPanel>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <MetricCard label="Records" value={perquisites.length} accent="sky" icon={Briefcase} />
        <MetricCard
          label="Total Taxable Value"
          value={formatPayrollAmount(totalTaxable, { compact: true })}
          accent="rose"
          hint={selectedEmployee ? selectedEmployee.name : 'No employee selected'}
        />
      </div>

      {showForm && (
        <SurfaceCard className="p-5">
          <h3 className="text-lg font-semibold text-slate-900 mb-4">Add Perquisite Record</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <EmployeePicker
              label="Employee"
              value={formData.user_id}
              onChange={(v) => setFormData({ ...formData, user_id: v })}
              emptyLabel="Select…"
              required
            />
            <div>
              <FieldLabel>Perquisite Type</FieldLabel>
              <SelectInput value={formData.perquisite_type} onChange={(e) => setFormData({ ...formData, perquisite_type: e.target.value })}>
                {PERQUISITE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
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
              loading={createMutation.isPending}
            >
              Add Perquisite
            </Button>
          </div>
        </SurfaceCard>
      )}

      <SurfaceCard className="overflow-hidden">
        <h3 className="text-lg font-semibold text-slate-900 p-5 border-b border-slate-200">Perquisite Records</h3>
        {!userFilter ? (
          <PageEmptyState
            title="Select an employee"
            description="Perquisites are recorded per employee. Pick someone above to see what they hold."
          />
        ) : isLoading ? (
          <PageLoadingState label="Loading perquisites…" />
        ) : isError ? (
          <PageErrorState
            message={getApiErrorMessage(error, "Couldn't load perquisites.")}
            onRetry={() => refetch()}
          />
        ) : (
          <PayrollDataTable
            columns={columns}
            rows={filteredPerquisites}
            rowKey={(p, idx) => p.id ?? `perp-${idx}`}
            emptyState={
              <PageEmptyState
                title={perquisites.length === 0 ? 'No perquisites recorded' : 'No matching perquisites'}
                description={
                  perquisites.length === 0
                    ? 'No perquisites have been recorded for this employee yet.'
                    : 'No record matches your search. Clear it to see all of them.'
                }
              />
            }
            ariaLabel="Perquisites"
          />
        )}
      </SurfaceCard>

      <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-sm text-slate-700">
        <p className="font-medium">About Perquisites:</p>
        <p className="mt-1">Perquisites are benefits provided by the employer in addition to salary. They are taxable under the head "Income from Salaries" and are reported in Form 12BA. The taxable value is calculated based on Income Tax Rules.</p>
      </div>
    </div>
  );
}
