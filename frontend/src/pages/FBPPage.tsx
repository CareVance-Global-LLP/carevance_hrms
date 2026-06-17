import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Wallet, Search, Loader2, Plus, CheckCircle, XCircle, IndianRupee, FileText } from 'lucide-react';
import { payrollApi } from '@/services/api';
import Button from '@/components/ui/Button';
import { TextInput, SelectInput, TextareaInput, FieldLabel } from '@/components/ui/FormField';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import PageHeader from '@/components/dashboard/PageHeader';

const STATUS_OPTIONS = ['pending', 'approved', 'rejected'];

export default function FBPPage() {
  const queryClient = useQueryClient();
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

  const { data: componentsData, isLoading: componentsLoading } = useQuery({
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
    },
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
    },
  });

  const components = Array.isArray(componentsData) ? componentsData : (componentsData as any)?.data ?? [];
  const users = Array.isArray(usersData) ? usersData : [];

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHeader title="FBP - Flexible Benefits Plan" description="Manage flexible benefits allocations and claims" />

      <div className="p-6 max-w-7xl mx-auto space-y-6">
        {/* Action Bar */}
        <div className="flex items-center justify-between">
          <div className="flex-1 mr-4">
            <SurfaceCard className="p-4">
              <div className="flex flex-wrap gap-4 items-end">
                <div>
                  <FieldLabel>Status</FieldLabel>
                  <SelectInput value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                    <option value="">All Status</option>
                    {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
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
                      placeholder="Search..."
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
            <Button variant="secondary" iconLeft={<Plus className="h-4 w-4" />} onClick={() => setShowClaimForm(true)}>
              Submit Claim
            </Button>
            <Button variant="primary" iconLeft={<Plus className="h-4 w-4" />} onClick={() => setShowAllocateForm(true)}>
              Allocate
            </Button>
          </div>
        </div>

        {/* FBP Components Info */}
        <SurfaceCard className="p-5">
          <h3 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <Wallet className="h-5 w-5 text-blue-600" />
            Available FBP Components
          </h3>
          {componentsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : components.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-slate-500">No FBP components configured. Contact admin to set up.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {components.map((comp: any) => (
                <div key={comp.id} className="p-4 bg-slate-50 rounded-lg">
                  <h4 className="font-semibold text-slate-900">{comp.name || comp.component_name}</h4>
                  <p className="text-sm text-slate-500 mt-1">{comp.description}</p>
                  {comp.max_amount && (
                    <p className="text-xs text-slate-400 mt-2">Max: ₹{Number(comp.max_amount).toLocaleString('en-IN')}</p>
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
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
          <p className="font-medium">About FBP:</p>
          <p className="mt-1">Flexible Benefits Plan allows employees to allocate a portion of their CTC across various components (Fuel, Phone, LTA, Books, etc.) for tax optimization. FBP components are fully exempt from income tax when used for the intended purpose.</p>
        </div>
      </div>
    </div>
  );
}
