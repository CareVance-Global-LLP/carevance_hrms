import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Wallet, Search, Plus, IndianRupee, FileText, Settings } from 'lucide-react';
import { payrollApi, getApiErrorMessage } from '@/services/api';
import Button from '@/components/ui/Button';
import { TextInput, SelectInput, TextareaInput, FieldLabel } from '@/components/ui/FormField';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import { formatPayrollAmount } from '@/components/ui/PayrollAmount';
import { PageLoadingState, PageEmptyState, PageErrorState, FeedbackBanner } from '@/components/ui/PageState';
import { useToast } from '@/components/ui/Toast';
import HowItWorksCard from '@/components/payroll/HowItWorksCard';
import StatusBadge from '@/components/ui/StatusBadge';
import { payrollStatusTone, titleCase } from '@/utils/payrollStatus';

const STATUS_OPTIONS = ['pending', 'approved', 'rejected'];

export default function FBPPage() {
  const queryClient = useQueryClient();
  const { show } = useToast();
  const [statusFilter, setStatusFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [showAllocateForm, setShowAllocateForm] = useState(false);
  const [showClaimForm, setShowClaimForm] = useState(false);
  const [allocateData, setAllocateData] = useState({ user_id: '', fbp_component_id: '', amount: '' });
  const [claimData, setClaimData] = useState({
    user_id: '',
    fbp_component_id: '',
    fbp_allocation_id: '',
    claimed_amount: '',
    bill_number: '',
    bill_date: '',
    description: '',
  });

  const { data: componentsData, isLoading: componentsLoading, isError: componentsError, error: componentsErrorObj, refetch: refetchComponents } = useQuery({
    queryKey: ['fbp-components'],
    queryFn: () => payrollApi.getFbpComponents().then(res => res.data),
  });

  const { data: usersData } = useQuery({
    queryKey: ['payroll-employees'],
    queryFn: () => payrollApi.getEmployees().then(res => res.data ?? []),
  });

  const allocateMutation = useMutation({
    mutationFn: () => payrollApi.allocateFbp({
      user_id: parseInt(allocateData.user_id),
      fbp_component_id: parseInt(allocateData.fbp_component_id),
      amount: parseFloat(allocateData.amount),
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
      ...claimData,
      user_id: parseInt(claimData.user_id),
      fbp_component_id: parseInt(claimData.fbp_component_id),
      fbp_allocation_id: claimData.fbp_allocation_id ? parseInt(claimData.fbp_allocation_id) : null,
      claimed_amount: parseFloat(claimData.claimed_amount),
    }),
    onSuccess: () => {
      setShowClaimForm(false);
      setClaimData({ user_id: '', fbp_component_id: '', fbp_allocation_id: '', claimed_amount: '', bill_number: '', bill_date: '', description: '' });
      queryClient.invalidateQueries({ queryKey: ['fbp-allocations'] });
      show({ kind: 'success', message: 'FBP claim submitted.' });
    },
    onError: (e: any) => show({ kind: 'error', message: getApiErrorMessage(e, 'Failed to submit FBP claim.') }),
  });

  const components = Array.isArray(componentsData) ? componentsData : (componentsData as any)?.data ?? [];
  const users = Array.isArray(usersData) ? usersData : [];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">FBP Basket</h2>
        <p className="text-sm text-slate-500 mt-1">
          Admin sets the FBP basket per template; employee allocates within their FBP amount, submits bills, admin verifies against exemption limits.
        </p>
      </div>
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

        {/* Action Bar */}
        <div className="flex items-center justify-between">
          <div className="flex-1 mr-4">
            <SurfaceCard className="p-4">
              <div className="flex flex-wrap gap-4 items-end">
                <div>
                  <FieldLabel>Status</FieldLabel>
                  <SelectInput value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                    <option value="">All Status</option>
                    {STATUS_OPTIONS.map(s => <option key={s} value={s}>{titleCase(s)}</option>)}
                  </SelectInput>
                </div>
                <div>
                  <FieldLabel>Employee</FieldLabel>
                  <SelectInput value={userFilter} onChange={(e) => setUserFilter(e.target.value)}>
                    <option value="">All Employees</option>
                    {users.map((u: any) => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
                  </SelectInput>
                </div>
                <div className="flex-1 min-w-[200px]">
                  <FieldLabel>Search</FieldLabel>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <TextInput
                      placeholder="Search employee..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                </div>
              </div>
            </SurfaceCard>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" iconLeft={<Settings className="h-4 w-4" />}>
              Configure Basket
            </Button>
            <Button variant="secondary" iconLeft={<Plus className="h-4 w-4" />} onClick={() => setShowClaimForm(true)}>
              Submit Claim
            </Button>
            <Button variant="primary" iconLeft={<Plus className="h-4 w-4" />} onClick={() => setShowAllocateForm(true)}>
              Allocate
            </Button>
          </div>
        </div>

        {/* Basket Components */}
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
              title="No FBP components configured"
              description="Contact admin to set up FBP components."
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {components.map((comp: any) => (
                <div key={comp.id} className="p-4 bg-slate-50 rounded-lg">
                  <h4 className="font-semibold text-slate-900">{comp.name || comp.component_name}</h4>
                  <p className="text-sm text-slate-500 mt-1">{comp.description}</p>
                  {comp.max_amount && (
                    <p className="text-xs text-slate-400 mt-2">Max: {formatPayrollAmount(comp.max_amount, { compact: true })}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </SurfaceCard>

        {/* Allocate Form */}
        {showAllocateForm && (
          <SurfaceCard className="p-5">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">Allocate FBP to Employee</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <FieldLabel>Employee</FieldLabel>
                <SelectInput value={allocateData.user_id} onChange={(e) => setAllocateData({ ...allocateData, user_id: e.target.value })}>
                  <option value="">Select...</option>
                  {users.map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </SelectInput>
              </div>
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
              >
                {allocateMutation.isPending ? 'Allocating...' : 'Allocate'}
              </Button>
            </div>
          </SurfaceCard>
        )}

        {/* Claim Form */}
        {showClaimForm && (
          <SurfaceCard className="p-5">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">Submit FBP Claim</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <FieldLabel>Employee</FieldLabel>
                <SelectInput value={claimData.user_id} onChange={(e) => setClaimData({ ...claimData, user_id: e.target.value })}>
                  <option value="">Select...</option>
                  {users.map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </SelectInput>
              </div>
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
                disabled={!claimData.user_id || !claimData.fbp_component_id || !claimData.claimed_amount || claimMutation.isPending}
              >
                {claimMutation.isPending ? 'Submitting...' : 'Submit Claim'}
              </Button>
            </div>
          </SurfaceCard>
        )}

        {/* Info Banner */}
        <FeedbackBanner
          tone="success"
          message="Flexible Benefits Plan allows employees to allocate a portion of their CTC across various components (Fuel, Phone, LTA, Books, etc.) for tax optimization. FBP components are fully exempt from income tax when used for the intended purpose."
        />
      </div>
  );
}
