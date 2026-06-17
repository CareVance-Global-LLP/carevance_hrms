import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Receipt, Search, Loader2, Plus, CheckCircle, XCircle, IndianRupee } from 'lucide-react';
import { payrollApi } from '@/services/api';
import Button from '@/components/ui/Button';
import { TextInput, SelectInput, TextareaInput, FieldLabel } from '@/components/ui/FormField';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import PageHeader from '@/components/dashboard/PageHeader';

const STATUS_OPTIONS = ['pending', 'approved', 'rejected', 'paid'];

export default function ReimbursementsPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    user_id: '',
    category: 'travel',
    amount: '',
    description: '',
    bill_date: '',
  });

  const { data: reimbursementsData, isLoading } = useQuery({
    queryKey: ['reimbursements', statusFilter],
    queryFn: () => payrollApi.listReimbursements({ status: statusFilter || undefined }).then(res => res.data?.data ?? res.data ?? []),
  });

  const { data: usersData } = useQuery({
    queryKey: ['payroll-employees'],
    queryFn: () => payrollApi.getEmployees().then(res => res.data ?? []),
  });

  const createMutation = useMutation({
    mutationFn: () => payrollApi.createReimbursement({
      user_id: parseInt(formData.user_id),
      category: formData.category,
      amount: parseFloat(formData.amount),
      description: formData.description,
      bill_date: formData.bill_date,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reimbursements'] });
      setShowForm(false);
      setFormData({ user_id: '', category: 'travel', amount: '', description: '', bill_date: '' });
    },
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) => payrollApi.approveReimbursement(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['reimbursements'] }),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => payrollApi.rejectReimbursement(id, reason),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['reimbursements'] }),
  });

  const reimbursements = Array.isArray(reimbursementsData) ? reimbursementsData : [];
  const users = Array.isArray(usersData) ? usersData : [];

  const stats = {
    total: reimbursements.length,
    pending: reimbursements.filter(r => r.status === 'pending').length,
    approved: reimbursements.filter(r => r.status === 'approved').length,
    rejected: reimbursements.filter(r => r.status === 'rejected').length,
    totalAmount: reimbursements.reduce((sum, r) => sum + (Number(r.amount) || 0), 0),
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHeader title="Reimbursements" description="Manage employee expense reimbursements" />

      <div className="p-6 max-w-7xl mx-auto space-y-6">
        {/* Action Bar */}
        <div className="flex items-center justify-between">
          <SurfaceCard className="p-4 flex-1 mr-4">
            <div className="flex flex-wrap gap-4 items-end">
              <div>
                <FieldLabel>Status</FieldLabel>
                <SelectInput value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  <option value="">All Status</option>
                  {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                </SelectInput>
              </div>
              <div className="flex-1 min-w-[200px]">
                <FieldLabel>Search</FieldLabel>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <TextInput
                    placeholder="Search by employee or description..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>
            </div>
          </SurfaceCard>
          <Button variant="primary" iconLeft={<Plus className="h-4 w-4" />} onClick={() => setShowForm(true)}>
            New Reimbursement
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <SurfaceCard className="p-4 text-center">
            <p className="text-2xl font-bold text-slate-900">{stats.total}</p>
            <p className="text-sm text-slate-500">Total Claims</p>
          </SurfaceCard>
          <SurfaceCard className="p-4 text-center">
            <p className="text-2xl font-bold text-amber-600">{stats.pending}</p>
            <p className="text-sm text-slate-500">Pending</p>
          </SurfaceCard>
          <SurfaceCard className="p-4 text-center">
            <p className="text-2xl font-bold text-emerald-600">{stats.approved}</p>
            <p className="text-sm text-slate-500">Approved</p>
          </SurfaceCard>
          <SurfaceCard className="p-4 text-center">
            <p className="text-2xl font-bold text-blue-600">₹{stats.totalAmount.toLocaleString('en-IN')}</p>
            <p className="text-sm text-slate-500">Total Amount</p>
          </SurfaceCard>
        </div>

        {/* Add Form */}
        {showForm && (
          <SurfaceCard className="p-5">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">New Reimbursement Claim</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <FieldLabel>Employee</FieldLabel>
                <SelectInput value={formData.user_id} onChange={(e) => setFormData({ ...formData, user_id: e.target.value })}>
                  <option value="">Select...</option>
                  {users.map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </SelectInput>
              </div>
              <div>
                <FieldLabel>Category</FieldLabel>
                <SelectInput value={formData.category} onChange={(e) => setFormData({ ...formData, category: e.target.value })}>
                  <option value="travel">Travel</option>
                  <option value="meals">Meals & Entertainment</option>
                  <option value="office_supplies">Office Supplies</option>
                  <option value="communication">Communication</option>
                  <option value="medical">Medical</option>
                  <option value="training">Training & Development</option>
                  <option value="other">Other</option>
                </SelectInput>
              </div>
              <div>
                <FieldLabel>Amount (₹)</FieldLabel>
                <TextInput
                  type="number"
                  value={formData.amount}
                  onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                  placeholder="0"
                />
              </div>
              <div>
                <FieldLabel>Bill Date</FieldLabel>
                <TextInput
                  type="date"
                  value={formData.bill_date}
                  onChange={(e) => setFormData({ ...formData, bill_date: e.target.value })}
                />
              </div>
              <div className="md:col-span-2">
                <FieldLabel>Description</FieldLabel>
                <TextareaInput
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Describe the expense..."
                  rows={2}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button
                variant="primary"
                iconLeft={<Receipt className="h-4 w-4" />}
                onClick={() => createMutation.mutate()}
                disabled={!formData.user_id || !formData.amount || createMutation.isPending}
              >
                {createMutation.isPending ? 'Submitting...' : 'Submit Claim'}
              </Button>
            </div>
          </SurfaceCard>
        )}

        {/* Table */}
        <SurfaceCard className="overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : reimbursements.length === 0 ? (
            <div className="text-center py-12">
              <Receipt className="h-12 w-12 text-slate-300 mx-auto mb-3" />
              <p className="text-sm text-slate-500">No reimbursement claims found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Employee</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Category</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Description</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Amount</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Bill Date</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {reimbursements
                    .filter(r => !searchQuery || r.description?.toLowerCase().includes(searchQuery.toLowerCase()) || r.user?.name?.toLowerCase().includes(searchQuery.toLowerCase()))
                    .map((reim: any) => (
                    <tr key={reim.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{reim.user?.name || 'Unknown'}</div>
                        <div className="text-xs text-slate-500">{reim.user?.email || ''}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-blue-50 text-blue-700">
                          {reim.category?.charAt(0).toUpperCase() + reim.category?.slice(1)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600 max-w-xs truncate">{reim.description || '-'}</td>
                      <td className="px-4 py-3 text-slate-900 font-medium">₹{Number(reim.amount || 0).toLocaleString('en-IN')}</td>
                      <td className="px-4 py-3 text-slate-600">{reim.bill_date || '-'}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          reim.status === 'approved' ? 'bg-emerald-50 text-emerald-700' :
                          reim.status === 'rejected' ? 'bg-rose-50 text-rose-700' :
                          reim.status === 'paid' ? 'bg-violet-50 text-violet-700' :
                          'bg-amber-50 text-amber-700'
                        }`}>
                          {reim.status?.charAt(0).toUpperCase() + reim.status?.slice(1)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex gap-2 justify-end">
                          {reim.status === 'pending' && (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                iconLeft={<CheckCircle className="h-3 w-3 text-emerald-600" />}
                                onClick={() => approveMutation.mutate(reim.id)}
                                disabled={approveMutation.isPending}
                              >
                                Approve
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                iconLeft={<XCircle className="h-3 w-3 text-rose-600" />}
                                onClick={() => {
                                  const reason = prompt('Rejection reason:');
                                  if (reason) rejectMutation.mutate({ id: reim.id, reason });
                                }}
                                disabled={rejectMutation.isPending}
                              >
                                Reject
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SurfaceCard>
      </div>
    </div>
  );
}
