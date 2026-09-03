import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Wallet, Search, Plus, IndianRupee, FileText, Settings } from 'lucide-react';
import { payrollApi, getApiErrorMessage } from '@/services/api';
import Button from '@/components/ui/Button';
import { TextInput, SelectInput, TextareaInput, FieldLabel } from '@/components/ui/FormField';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import FilterPanel from '@/components/dashboard/FilterPanel';
import MetricCard from '@/components/dashboard/MetricCard';
import { formatPayrollAmount } from '@/components/ui/PayrollAmount';
import { PageLoadingState, PageEmptyState, PageErrorState, FeedbackBanner } from '@/components/ui/PageState';
import { useToast } from '@/components/ui/Toast';
import HowItWorksCard from '@/components/payroll/HowItWorksCard';
import ModuleHeader from '@/components/payroll/ModuleHeader';
import PayrollDataTable, { type PayrollDataTableColumn } from '@/components/payroll/PayrollDataTable';
import StatusFilter from '@/components/payroll/StatusFilter';
import StatusBadge from '@/components/ui/StatusBadge';
import EmployeePicker from '@/components/payroll/EmployeePicker';
import { useEmployees } from '@/hooks/useEmployees';
import { currentFinancialYear, formatFinancialYear } from '@/lib/payroll/financialYear';
import { payrollStatusTone, titleCase } from '@/utils/payrollStatus';

export default function FBPPage() {
  const queryClient = useQueryClient();
  const [, setSearchParams] = useSearchParams();
  const { show } = useToast();
  const [statusFilter, setStatusFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [showAllocateForm, setShowAllocateForm] = useState(false);
  const [showClaimForm, setShowClaimForm] = useState(false);
  const [allocateData, setAllocateData] = useState({ user_id: '', fbp_component_id: '', amount: '' });
  const [claimData, setClaimData] = useState({
    fbp_component_id: '',
    claimed_amount: '',
    bill_number: '',
    bill_date: '',
    description: '',
  });

  const financialYear = currentFinancialYear();

  const { data: componentsData, isLoading: componentsLoading, isError: componentsError, error: componentsErrorObj, refetch: refetchComponents } = useQuery({
    queryKey: ['fbp-components'],
    queryFn: () => payrollApi.getFbpComponents().then((res) => res.data),
  });

  const { data: usersData } = useEmployees();

  /*
   * Allocations are readable one employee at a time
   * (GET /payroll/fbp/allocations/{userId}), so the employee filter is what
   * loads the table rather than narrowing an already-loaded list. Before this,
   * the three filters rendered but drove nothing at all — the page only ever
   * showed the basket components.
   */
  const {
    data: allocationsData,
    isLoading: allocationsLoading,
    isError: allocationsError,
    error: allocationsErrorObj,
    refetch: refetchAllocations,
  } = useQuery({
    queryKey: ['fbp-allocations', userFilter, financialYear],
    queryFn: () => payrollApi.getFbpAllocations(parseInt(userFilter), financialYear).then((res) => res.data),
    enabled: !!userFilter,
  });

  const allocateMutation = useMutation({
    mutationFn: () => payrollApi.allocateFbp({
      user_id: parseInt(allocateData.user_id),
      allocations: [{
        fbp_component_id: parseInt(allocateData.fbp_component_id),
        allocated_amount: parseFloat(allocateData.amount),
      }],
      financial_year: financialYear,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fbp-allocations'] });
      setShowAllocateForm(false);
      setAllocateData({ user_id: '', fbp_component_id: '', amount: '' });
      show({ kind: 'success', message: 'FBP allocation created.' });
    },
    onError: (e: any) => show({ kind: 'error', message: getApiErrorMessage(e, 'Failed to allocate FBP.') }),
  });

  const claimMutation = useMutation({
    mutationFn: () => payrollApi.submitFbpClaim({
      fbp_component_id: parseInt(claimData.fbp_component_id),
      amount: parseFloat(claimData.claimed_amount),
      claim_date: claimData.bill_date,
      description: [claimData.bill_number && `Bill ${claimData.bill_number}`, claimData.description]
        .filter(Boolean)
        .join(' — ') || undefined,
    }),
    onSuccess: () => {
      setShowClaimForm(false);
      setClaimData({ fbp_component_id: '', claimed_amount: '', bill_number: '', bill_date: '', description: '' });
      queryClient.invalidateQueries({ queryKey: ['fbp-allocations'] });
      show({ kind: 'success', message: 'FBP claim submitted.' });
    },
    onError: (e: any) => show({ kind: 'error', message: getApiErrorMessage(e, 'Failed to submit FBP claim.') }),
  });

  const components = Array.isArray(componentsData) ? componentsData : (componentsData as any)?.data ?? [];
  const users = Array.isArray(usersData) ? usersData : [];
  const allocations: any[] = Array.isArray(allocationsData)
    ? allocationsData
    : (allocationsData as any)?.data ?? [];

  const filteredAllocations = allocations.filter((a: any) => {
    if (statusFilter && String(a.status ?? '').toLowerCase() !== statusFilter) return false;
    if (searchQuery) {
      const needle = searchQuery.toLowerCase();
      const name = a.component?.name ?? a.component?.component_name ?? '';
      if (!name.toLowerCase().includes(needle)) return false;
    }
    return true;
  });

  const totalAllocated = allocations.reduce(
    (sum: number, a: any) => sum + Number(a.allocated_amount || 0),
    0,
  );

  const allocationColumns: PayrollDataTableColumn<any>[] = [
    {
      key: 'component',
      header: 'Component',
      render: (a) => <span className="font-medium text-slate-900">{a.component?.name || a.component?.component_name || '—'}</span>,
    },
    {
      key: 'allocated',
      header: 'Allocated',
      align: 'right',
      render: (a) => formatPayrollAmount(a.allocated_amount, { compact: true }),
    },
    {
      key: 'cap',
      header: 'Annual Cap',
      align: 'right',
      render: (a) => a.component?.max_amount ? formatPayrollAmount(a.component.max_amount, { compact: true }) : '—',
      cellClassName: 'text-slate-600',
    },
    {
      key: 'fy',
      header: 'Financial Year',
      render: (a) => <span className="text-slate-600">{a.financial_year || '—'}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (a) => <StatusBadge tone={payrollStatusTone(a.status || 'approved')}>{titleCase(a.status || 'active')}</StatusBadge>,
    },
  ];

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="FBP Basket"
        description="Admin sets the FBP basket per template; employee allocates within their FBP amount, submits bills, admin verifies against exemption limits."
      />
      <HowItWorksCard
        whatIsThis="Restructures part of CTC into tax-free components the employee picks (meal vouchers, fuel, phone, books, driver). Reduces taxable income vs plain cash allowance."
        whenToUse={[
          'Tax optimisation for senior employees with large CTCs',
          'Cafeteria-style benefits — let employees choose what they actually use',
          'Reduce employer\'s salary cost-to-tax ratio while raising take-home',
        ]}
        howItFlows={[
          { step: 1, label: 'Define components', desc: 'Set up FBP components with annual caps (e.g. meal vouchers ₹26,400/yr)' },
          { step: 2, label: 'Allocate', desc: 'Assign components and amounts to each employee' },
          { step: 3, label: 'Employee claims', desc: 'Employee submits bills against their allocation' },
          { step: 4, label: 'Approved & paid', desc: 'Approved claims flow into payroll as tax-free component' },
        ]}
        commonMistakes={[
          'Crossing statutory caps (e.g. meal vouchers > ₹2,200/month become taxable)',
          'Forgetting that unclaimed FBP balance usually lapses at year-end',
          'Allocating components without confirming employee actually uses them',
        ]}
      />

      <FilterPanel>
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <FieldLabel>Employee</FieldLabel>
            <SelectInput value={userFilter} onChange={(e) => setUserFilter(e.target.value)}>
              <option value="">Select employee...</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
            </SelectInput>
          </div>
          <StatusFilter namespace="fbp" value={statusFilter} onChange={setStatusFilter} />
          <div className="flex-1 min-w-[200px]">
            <FieldLabel>Search</FieldLabel>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
              <TextInput
                placeholder="Search component..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>
          {/*
            * "Configure Basket" used to sit here with no onClick at all.
            * There is no create/update endpoint for fbp_components — only
            * GET /payroll/fbp/components — so it navigates to Salary Templates,
            * where the basket is actually defined.
            */}
          <Button
            variant="secondary"
            size="sm"
            iconLeft={<Settings className="h-4 w-4" />}
            onClick={() => setSearchParams({ tab: 'employee-pay', type: 'dept-templates' })}
          >
            Configure Basket
          </Button>
          <Button variant="secondary" size="sm" iconLeft={<Plus className="h-4 w-4" />} onClick={() => setShowClaimForm(true)}>
            Submit Claim
          </Button>
          <Button variant="primary" size="sm" iconLeft={<Plus className="h-4 w-4" />} onClick={() => setShowAllocateForm(true)}>
            Allocate
          </Button>
        </div>
      </FilterPanel>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <MetricCard label="Basket Components" value={components.length} accent="sky" icon={Wallet} />
        <MetricCard
          label="Allocations"
          value={userFilter ? allocations.length : '—'}
          accent="violet"
          hint={userFilter ? undefined : 'Select an employee'}
        />
        <MetricCard
          label="Total Allocated"
          value={userFilter ? formatPayrollAmount(totalAllocated, { compact: true }) : '—'}
          accent="emerald"
          hint={userFilter ? formatFinancialYear(financialYear) : 'Select an employee'}
        />
      </div>

      <SurfaceCard className="overflow-hidden">
        <h3 className="text-lg font-semibold text-slate-900 p-5 border-b border-slate-200">
          Employee Allocations
        </h3>
        {!userFilter ? (
          <PageEmptyState
            title="Select an employee"
            description="Allocations are held per employee. Pick someone above to see what they have allocated this year."
          />
        ) : allocationsLoading ? (
          <PageLoadingState label="Loading allocations…" />
        ) : allocationsError ? (
          <PageErrorState
            message={getApiErrorMessage(allocationsErrorObj, "Couldn't load FBP allocations.")}
            onRetry={() => refetchAllocations()}
          />
        ) : (
          <PayrollDataTable
            columns={allocationColumns}
            rows={filteredAllocations}
            rowKey={(a) => a.id}
            emptyState={
              <PageEmptyState
                title={allocations.length === 0 ? 'No allocations yet' : 'No matching allocations'}
                description={
                  allocations.length === 0
                    ? 'This employee has not allocated any FBP components for this financial year.'
                    : 'No allocation matches your filters. Clear them to see all.'
                }
              />
            }
            ariaLabel="FBP allocations"
          />
        )}
      </SurfaceCard>

      <SurfaceCard className="p-5">
        <h3 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
          <Wallet className="h-5 w-5 text-blue-600" />
          Basket Components (per Salary Template)
        </h3>
        {componentsLoading ? (
          <PageLoadingState label="Loading FBP components…" />
        ) : componentsError ? (
          <PageErrorState
            message={getApiErrorMessage(componentsErrorObj, 'Couldn\'t load FBP components.')}
            onRetry={() => refetchComponents()}
          />
        ) : components.length === 0 ? (
          <PageEmptyState
            title="No FBP components yet"
            description="The basket is defined on a salary template. Add components there and they appear here for employees to allocate against."
            action={
              <Button
                size="sm"
                iconLeft={<Settings className="h-4 w-4" />}
                onClick={() => setSearchParams({ tab: 'employee-pay', type: 'dept-templates' })}
              >
                Set up in Salary Templates
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {components.map((comp: any) => (
              <div key={comp.id} className="p-4 bg-slate-50 rounded-lg">
                <h4 className="font-semibold text-slate-900">{comp.name || comp.component_name}</h4>
                <p className="text-sm text-slate-500 mt-1">{comp.description}</p>
                {comp.max_amount && (
                  <p className="text-xs text-slate-500 mt-2">Max: {formatPayrollAmount(comp.max_amount, { compact: true })}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </SurfaceCard>

      {showAllocateForm && (
        <SurfaceCard className="p-5">
          <h3 className="text-lg font-semibold text-slate-900 mb-4">Allocate FBP to Employee</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <EmployeePicker
              label="Employee"
              value={allocateData.user_id}
              onChange={(v) => setAllocateData({ ...allocateData, user_id: v })}
              emptyLabel="Select…"
              required
            />
            <div>
              <FieldLabel>Component</FieldLabel>
              <SelectInput value={allocateData.fbp_component_id} onChange={(e) => setAllocateData({ ...allocateData, fbp_component_id: e.target.value })}>
                <option value="">Select...</option>
                {components.map((c: any) => <option key={c.id} value={c.id}>{c.name || c.component_name}</option>)}
              </SelectInput>
            </div>
            <div>
              <FieldLabel>Amount (₹)</FieldLabel>
              <TextInput
                type="number"
                value={allocateData.amount}
                onChange={(e) => setAllocateData({ ...allocateData, amount: e.target.value })}
                placeholder="e.g. 24000"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="secondary" onClick={() => setShowAllocateForm(false)}>Cancel</Button>
            <Button
              variant="primary"
              iconLeft={<IndianRupee className="h-4 w-4" />}
              onClick={() => allocateMutation.mutate()}
              disabled={!allocateData.user_id || !allocateData.fbp_component_id || !allocateData.amount || allocateMutation.isPending}
              loading={allocateMutation.isPending}
            >
              Allocate
            </Button>
          </div>
        </SurfaceCard>
      )}

      {showClaimForm && (
        <SurfaceCard className="p-5">
          <h3 className="text-lg font-semibold text-slate-900 mb-1">Submit FBP Claim</h3>
          <p className="text-sm text-slate-500 mb-4">
            Claims are filed against your own allocation — the API records the signed-in user as the claimant.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <FieldLabel>Component</FieldLabel>
              <SelectInput value={claimData.fbp_component_id} onChange={(e) => setClaimData({ ...claimData, fbp_component_id: e.target.value })}>
                <option value="">Select...</option>
                {components.map((c: any) => <option key={c.id} value={c.id}>{c.name || c.component_name}</option>)}
              </SelectInput>
            </div>
            <div>
              <FieldLabel>Claimed Amount (₹)</FieldLabel>
              <TextInput
                type="number"
                value={claimData.claimed_amount}
                onChange={(e) => setClaimData({ ...claimData, claimed_amount: e.target.value })}
                placeholder="0"
              />
            </div>
            <div>
              <FieldLabel>Bill Number</FieldLabel>
              <TextInput
                value={claimData.bill_number}
                onChange={(e) => setClaimData({ ...claimData, bill_number: e.target.value })}
                placeholder="Bill/Invoice number"
              />
            </div>
            <div>
              <FieldLabel>Bill Date</FieldLabel>
              <TextInput
                type="date"
                value={claimData.bill_date}
                onChange={(e) => setClaimData({ ...claimData, bill_date: e.target.value })}
              />
              <p className="mt-1 text-xs text-slate-500">Recorded as the claim date. Required.</p>
            </div>
            <div className="md:col-span-2">
              <FieldLabel>Description</FieldLabel>
              <TextareaInput
                value={claimData.description}
                onChange={(e) => setClaimData({ ...claimData, description: e.target.value })}
                placeholder="Describe the claim..."
                rows={2}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="secondary" onClick={() => setShowClaimForm(false)}>Cancel</Button>
            <Button
              variant="primary"
              iconLeft={<FileText className="h-4 w-4" />}
              onClick={() => claimMutation.mutate()}
              disabled={!claimData.fbp_component_id || !claimData.claimed_amount || !claimData.bill_date || claimMutation.isPending}
              loading={claimMutation.isPending}
            >
              Submit Claim
            </Button>
          </div>
        </SurfaceCard>
      )}

      <FeedbackBanner
        tone="success"
        message="Flexible Benefits Plan allows employees to allocate a portion of their CTC across various components (Fuel, Phone, LTA, Books, etc.) for tax optimization. FBP components are fully exempt from income tax when used for the intended purpose."
      />
    </div>
  );
}
