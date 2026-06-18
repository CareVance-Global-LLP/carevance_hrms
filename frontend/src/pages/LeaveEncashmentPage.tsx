import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, Search, Loader2, Filter, Plus, CheckCircle, XCircle, Eye, Clock } from 'lucide-react';
import { payrollApi } from '@/services/api';
import Button from '@/components/ui/Button';
import { TextInput, SelectInput } from '@/components/ui/FormField';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import PageHeader from '@/components/dashboard/PageHeader';
import HowItWorksCard from '@/components/payroll/HowItWorksCard';

const STATUS_OPTIONS = ['draft', 'approved', 'rejected'];
const LEAVE_TYPES = ['earned', 'casual', 'sick', 'compensatory'];

export default function LeaveEncashmentPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [userFilter, setUserFilter] = useState('');

  const { data: encashmentsData, isLoading } = useQuery({
    queryKey: ['leave-encashments', statusFilter, userFilter],
    queryFn: () => payrollApi.listLeaveEncashments({ status: statusFilter || undefined }).then(res => res.data?.data ?? res.data ?? []),
  });

  const { data: usersData } = useQuery({
    queryKey: ['payroll-employees'],
    queryFn: () => payrollApi.getEmployees().then(res => res.data),
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => payrollApi.requestLeaveEncashment(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leave-encashments'] });
    },
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) => payrollApi.approveLeaveEncashment(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leave-encashments'] });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => payrollApi.rejectLeaveEncashment(id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leave-encashments'] });
    },
  });

  const encashments = Array.isArray(encashmentsData) ? encashmentsData : [];
  const users = Array.isArray(usersData) ? usersData : [];

  const stats = {
    total: encashments.length,
    draft: encashments.filter(a => a.status === 'draft').length,
    approved: encashments.filter(a => a.status === 'approved').length,
    rejected: encashments.filter(a => a.status === 'rejected').length,
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHeader
        title="Leave Encashment"
        description="Pay out unused earned/privilege leaves — typically at exit, or annually per company policy."
      />

      <div className="p-6 max-w-7xl mx-auto space-y-6">
        <HowItWorksCard
          whatIsThis="Converts unused earned leaves into cash. Per-day rate = (Monthly Basic ÷ Working Days). Tax-free up to ₹25 lakh for non-government employees at exit."
          whenToUse={[
            'At exit (most common — pay out unused earned leaves as part of F&F)',
            'Annually (some companies encash up to a cap each year)',
            'When an employee crosses the maximum accumulation limit',
          ]}
          howItFlows={[
            { step: 1, label: 'Pick employee', desc: 'And select leave type (earned, casual, sick, compensatory)' },
            { step: 2, label: 'Enter days', desc: 'How many days to encash — system checks leave balance' },
            { step: 3, label: 'Calculate', desc: 'Per-day Basic × days encashed' },
            { step: 4, label: 'Approve', desc: 'Admin approves, amount flows into next payroll run' },
          ]}
          commonMistakes={[
            'Encashing leaves that don\'t qualify (e.g. sick leave usually can\'t be encashed)',
            'Confusing "leave balance" with "leave type" — only earned/privilege leaves are typically encashable',
            'Forgetting that encashed leaves are taxable as salary',
          ]}
        />
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
                  placeholder="Search leave type, notes..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
          </div>
        </SurfaceCard>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total', value: stats.total, color: 'blue' },
            { label: 'Draft', value: stats.draft, color: 'slate' },
            { label: 'Approved', value: stats.approved, color: 'emerald' },
            { label: 'Rejected', value: stats.rejected, color: 'rose' },
          ].map(s => (
            <SurfaceCard key={s.label} className="p-4 text-center">
              <p className="text-2xl font-bold text-slate-900">{s.value}</p>
              <p className={`text-sm text-${s.color}-600`}>{s.label}</p>
            </SurfaceCard>
          ))}
        </div>

        {/* Encashments Table */}
        <SurfaceCard className="overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : encashments.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="h-12 w-12 text-slate-300 mx-auto mb-3" />
              <p className="text-sm text-slate-500">No leave encashment requests found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Employee</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Month</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Leave Type</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Eligible Days</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Encashed Days</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Amount</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Net Amount</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {encashments
                    .filter(a => !searchQuery ||
                      a.leave_type?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                      a.notes?.toLowerCase().includes(searchQuery.toLowerCase()))
                    .map((enc: any) => (
                    <tr key={enc.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{enc.user?.name || 'Unknown'}</div>
                        <div className="text-xs text-slate-500">{enc.user?.email || ''}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-900">{enc.month_year || '-'}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-blue-50 text-blue-700">
                          {enc.leave_type?.charAt(0).toUpperCase() + enc.leave_type?.slice(1)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-900">{enc.eligible_days || 0}</td>
                      <td className="px-4 py-3 text-slate-900">{enc.encashed_days || 0}</td>
                      <td className="px-4 py-3 text-slate-900">₹{Number(enc.total_amount || 0).toLocaleString('en-IN')}</td>
                      <td className="px-4 py-3 text-emerald-600 font-medium">₹{Number(enc.net_amount || 0).toLocaleString('en-IN')}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          enc.status === 'approved' ? 'bg-emerald-50 text-emerald-700' :
                          enc.status === 'rejected' ? 'bg-rose-50 text-rose-700' :
                          'bg-amber-50 text-amber-700'
                        }`}>
                          {enc.status?.charAt(0).toUpperCase() + enc.status?.slice(1)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex gap-2 justify-end">
                          {enc.status === 'draft' && (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                iconLeft={<CheckCircle className="h-3 w-3 text-emerald-600" />}
                                onClick={() => approveMutation.mutate(enc.id)}
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
                                  if (reason) rejectMutation.mutate({ id: enc.id, reason });
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