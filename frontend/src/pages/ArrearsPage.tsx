import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, Search, Loader2, Filter, Plus, CheckCircle, XCircle, Eye, Calculator } from 'lucide-react';
import { payrollApi } from '@/services/api';
import Button from '@/components/ui/Button';
import { TextInput, SelectInput } from '@/components/ui/FormField';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import PageHeader from '@/components/dashboard/PageHeader';
import HowItWorksCard from '@/components/payroll/HowItWorksCard';

const STATUS_OPTIONS = ['draft', 'approved', 'rejected', 'paid'];
const ARREAR_TYPES = ['salary', 'increment', 'promotion', 'retrospective', 'settlement'];

export default function ArrearsPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [userFilter, setUserFilter] = useState('');

  const { data: arrearsData, isLoading } = useQuery({
    queryKey: ['arrears', statusFilter, userFilter],
    queryFn: () => payrollApi.listArrears({ status: statusFilter || undefined }).then(res => res.data?.data ?? res.data ?? []),
  });

  const { data: usersData } = useQuery({
    queryKey: ['payroll-employees'],
    queryFn: () => payrollApi.getEmployees().then(res => res.data),
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => payrollApi.requestLoan(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['arrears'] });
    },
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) => payrollApi.approveArrear(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['arrears'] });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => payrollApi.rejectArrear(id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['arrears'] });
    },
  });

  const detectMutation = useMutation({
    mutationFn: ({ userId, month }: { userId: number; month: string }) => payrollApi.detectCtcArrears(userId, month),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['arrears'] });
    },
  });

  const arrears = Array.isArray(arrearsData) ? arrearsData : [];
  const users = Array.isArray(usersData) ? usersData : [];

  const stats = {
    total: arrears.length,
    draft: arrears.filter(a => a.status === 'draft').length,
    approved: arrears.filter(a => a.status === 'approved').length,
    rejected: arrears.filter(a => a.status === 'rejected').length,
    paid: arrears.filter(a => a.status === 'paid').length,
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHeader
        title="Arrears"
        description="Retroactive salary payments — for increments, promotions, or revisions applied after the effective date."
      />

      <div className="p-6 max-w-7xl mx-auto space-y-6">
        <HowItWorksCard
          whatIsThis="Salary paid for past months when something changed retrospectively — e.g. an increment approved in October but effective from April. The system calculates the differential for each affected month and pays the total in the current run."
          whenToUse={[
            'Annual increment processed late (effective date in the past)',
            'Promotion approved retroactively after a delayed review',
            'Settlement of any retrospective pay correction',
          ]}
          howItFlows={[
            { step: 1, label: 'Detect or create', desc: 'Use "Detect" on an employee/month, or create manually' },
            { step: 2, label: 'Pick arrear type', desc: 'Salary, increment, promotion, retrospective, or settlement' },
            { step: 3, label: 'Enter months + delta', desc: 'Which months, and the new-vs-old differential per month' },
            { step: 4, label: 'Approve & pay', desc: 'Add to current month\'s payroll run for disbursement' },
          ]}
          commonMistakes={[
            'Paying arrears for a month that already had a disbursed run — needs re-processing',
            'Forgetting to update the employee template for the new CTC going forward',
            'Calculating arrears on Basic alone instead of full CTC differential',
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
                  placeholder="Search reason, type..."
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
            { label: 'Approved', value: stats.approved, color: 'emerald' },
            { label: 'Rejected', value: stats.rejected, color: 'rose' },
            { label: 'Paid', value: stats.paid, color: 'violet' },
          ].map(s => (
            <SurfaceCard key={s.label} className="p-4 text-center">
              <p className="text-2xl font-bold text-slate-900">{s.value}</p>
              <p className={`text-sm text-${s.color}-600`}>{s.label}</p>
            </SurfaceCard>
          ))}
        </div>

        {/* Arrears Table */}
        <SurfaceCard className="overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : arrears.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="h-12 w-12 text-slate-300 mx-auto mb-3" />
              <p className="text-sm text-slate-500">No arrears records found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Employee</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Arrear Month</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Calc Month</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Type</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Gross Diff</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Net Arrear</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {arrears
                    .filter(a => !searchQuery ||
                      a.reason?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                      a.arrear_type?.toLowerCase().includes(searchQuery.toLowerCase()))
                    .map((arrear: any) => (
                    <tr key={arrear.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{arrear.user?.name || 'Unknown'}</div>
                        <div className="text-xs text-slate-500">{arrear.user?.email || ''}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-900">{arrear.arrear_month || '-'}</td>
                      <td className="px-4 py-3 text-slate-900">{arrear.calculation_month || '-'}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-blue-50 text-blue-700">
                          {arrear.arrear_type?.charAt(0).toUpperCase() + arrear.arrear_type?.slice(1)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-900">₹{Number(arrear.gross_difference || 0).toLocaleString('en-IN')}</td>
                      <td className="px-4 py-3 text-emerald-600 font-medium">₹{Number(arrear.net_arrear_amount || 0).toLocaleString('en-IN')}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          arrear.status === 'approved' ? 'bg-emerald-50 text-emerald-700' :
                          arrear.status === 'rejected' ? 'bg-rose-50 text-rose-700' :
                          arrear.status === 'paid' ? 'bg-violet-50 text-violet-700' :
                          'bg-amber-50 text-amber-700'
                        }`}>
                          {arrear.status?.charAt(0).toUpperCase() + arrear.status?.slice(1)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex gap-2 justify-end">
                          {arrear.status === 'draft' && (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                iconLeft={<CheckCircle className="h-3 w-3 text-emerald-600" />}
                                onClick={() => approveMutation.mutate(arrear.id)}
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
                                  if (reason) rejectMutation.mutate({ id: arrear.id, reason });
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