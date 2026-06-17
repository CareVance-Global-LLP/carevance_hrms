import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, Search, Loader2, Filter, Plus, CheckCircle, XCircle, Eye, DollarSign, Briefcase } from 'lucide-react';
import { payrollApi } from '@/services/api';
import Button from '@/components/ui/Button';
import { TextInput, SelectInput } from '@/components/ui/FormField';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import PageHeader from '@/components/dashboard/PageHeader';

const STATUS_OPTIONS = ['draft', 'pending', 'approved', 'rejected', 'paid'];
const EXIT_TYPES = ['resignation', 'termination', 'retirement', 'death', 'layoff'];

export default function FnFSettlementsPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [userFilter, setUserFilter] = useState('');

  const { data: settlementsData, isLoading } = useQuery({
    queryKey: ['fnf-settlements', statusFilter, userFilter],
    queryFn: () => payrollApi.listFnFSettlements({ status: statusFilter || undefined }).then(res => res.data?.data ?? res.data ?? []),
  });

  const { data: usersData } = useQuery({
    queryKey: ['payroll-employees'],
    queryFn: () => payrollApi.getEmployees().then(res => res.data),
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => payrollApi.createFnFSettlement(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fnf-settlements'] });
    },
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) => payrollApi.approveFnFSettlement(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fnf-settlements'] });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => payrollApi.rejectFnFSettlement(id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fnf-settlements'] });
    },
  });

  const processPaymentMutation = useMutation({
    mutationFn: ({ id, method, reference }: { id: number; method: string; reference?: string }) =>
      payrollApi.processFnFPayment(id, method, reference),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fnf-settlements'] });
    },
  });

  const settlements = Array.isArray(settlementsData) ? settlementsData : [];
  const users = Array.isArray(usersData) ? usersData : [];

  const stats = {
    total: settlements.length,
    draft: settlements.filter(s => s.status === 'draft').length,
    pending: settlements.filter(s => s.status === 'pending').length,
    approved: settlements.filter(s => s.status === 'approved').length,
    paid: settlements.filter(s => s.status === 'paid').length,
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHeader title="Full & Final Settlements" description="Manage employee F&F settlements" />

      <div className="p-6 max-w-7xl mx-auto space-y-6">
        {/* Filters */}
        <SurfaceCard className="p-5">
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
              <SelectInput
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="">All Status</option>
                {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
              </SelectInput>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Employee</label>
              <SelectInput
                value={userFilter}
                onChange={(e) => setUserFilter(e.target.value)}
              >
                <option value="">All Employees</option>
                {users.map((u: any) => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
              </SelectInput>
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="block text-sm font-medium text-slate-700 mb-1">Search</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <TextInput
                  placeholder="Search by employee name..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
          </div>
        </SurfaceCard>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {[
            { label: 'Total', value: stats.total, color: 'blue' },
            { label: 'Draft', value: stats.draft, color: 'slate' },
            { label: 'Pending', value: stats.pending, color: 'amber' },
            { label: 'Approved', value: stats.approved, color: 'emerald' },
            { label: 'Paid', value: stats.paid, color: 'violet' },
          ].map(s => (
            <SurfaceCard key={s.label} className="p-4 text-center">
              <p className="text-2xl font-bold text-slate-900">{s.value}</p>
              <p className={`text-sm text-${s.color}-600`}>{s.label}</p>
            </SurfaceCard>
          ))}
        </div>

        {/* Settlements Table */}
        <SurfaceCard className="overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : settlements.length === 0 ? (
            <div className="text-center py-12">
              <Briefcase className="h-12 w-12 text-slate-300 mx-auto mb-3" />
              <p className="text-sm text-slate-500">No F&F settlement records found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Employee</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Exit Type</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Resignation</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Last Working</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Years</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Gratuity</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Net Settlement</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {settlements
                    .filter(s => !searchQuery ||
                      s.user?.name?.toLowerCase().includes(searchQuery.toLowerCase()))
                    .map((settlement: any) => (
                    <tr key={settlement.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{settlement.user?.name || 'Unknown'}</div>
                        <div className="text-xs text-slate-500">{settlement.user?.email || ''}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-blue-50 text-blue-700">
                          {settlement.exit_type?.charAt(0).toUpperCase() + settlement.exit_type?.slice(1)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-900">{settlement.resignation_date || '-'}</td>
                      <td className="px-4 py-3 text-slate-900">{settlement.last_working_date || '-'}</td>
                      <td className="px-4 py-3 text-slate-900">{Number(settlement.years_of_service || 0).toFixed(1)}</td>
                      <td className="px-4 py-3 text-slate-900">₹{Number(settlement.gratuity_amount || 0).toLocaleString('en-IN')}</td>
                      <td className="px-4 py-3 text-emerald-600 font-medium">₹{Number(settlement.net_settlement || 0).toLocaleString('en-IN')}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          settlement.status === 'paid' ? 'bg-violet-50 text-violet-700' :
                          settlement.status === 'approved' ? 'bg-emerald-50 text-emerald-700' :
                          settlement.status === 'rejected' ? 'bg-rose-50 text-rose-700' :
                          settlement.status === 'pending' ? 'bg-amber-50 text-amber-700' :
                          'bg-slate-100 text-slate-700'
                        }`}>
                          {settlement.status?.charAt(0).toUpperCase() + settlement.status?.slice(1)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex gap-2 justify-end">
                          {(settlement.status === 'draft' || settlement.status === 'pending') && (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                iconLeft={<CheckCircle className="h-3 w-3 text-emerald-600" />}
                                onClick={() => approveMutation.mutate(settlement.id)}
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
                                  if (reason) rejectMutation.mutate({ id: settlement.id, reason });
                                }}
                                disabled={rejectMutation.isPending}
                              >
                                Reject
                              </Button>
                            </>
                          )}
                          {settlement.status === 'approved' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              iconLeft={<DollarSign className="h-3 w-3 text-emerald-600" />}
                              onClick={() => {
                                const method = prompt('Payment method (bank_transfer/cash/cheque):', 'bank_transfer');
                                if (method) processPaymentMutation.mutate({ id: settlement.id, method });
                              }}
                              disabled={processPaymentMutation.isPending}
                            >
                              Pay
                            </Button>
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