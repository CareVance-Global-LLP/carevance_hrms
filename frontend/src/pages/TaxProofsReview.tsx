import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, Download, Search, Loader2, Filter, CheckCircle, XCircle, Eye } from 'lucide-react';
import { payrollApi } from '@/services/api';
import Button from '@/components/ui/Button';
import { TextInput, SelectInput } from '@/components/ui/FormField';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import PageHeader from '@/components/dashboard/PageHeader';

const STATUS_OPTIONS = ['pending', 'approved', 'rejected', 'auto_approved'];

export default function TaxProofsReviewPage() {
  const queryClient = useQueryClient();
  const [financialYear, setFinancialYear] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [userFilter, setUserFilter] = useState('');

  const { data: proofsData, isLoading } = useQuery({
    queryKey: ['tax-proofs', financialYear, statusFilter, userFilter],
    queryFn: () => payrollApi.listTaxProofs({
      financial_year: financialYear || undefined,
      status: statusFilter || undefined,
      user_id: userFilter ? Number(userFilter) : undefined,
    }).then(res => res.data),
    enabled: !!financialYear,
  });

  const { data: usersData } = useQuery({
    queryKey: ['payroll-employees'],
    queryFn: () => payrollApi.getEmployees().then(res => res.data),
  });

  const reviewMutation = useMutation({
    mutationFn: ({ id, decision, approved_amount, notes }: { id: number; decision: 'approved' | 'rejected' | 'partial'; approved_amount?: number; notes?: string }) =>
      payrollApi.reviewTaxProof(id, { decision, approved_amount, notes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tax-proofs'] });
    },
  });

  const bulkApproveMutation = useMutation({
    mutationFn: ({ userId, financialYear }: { userId: number; financialYear?: string }) =>
      payrollApi.bulkApproveTaxProofs(userId, financialYear),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tax-proofs'] });
    },
  });

  const proofs = proofsData?.data ?? [];
  const users = Array.isArray(usersData) ? usersData : [];

  const stats = {
    total: proofs.length,
    pending: proofs.filter(p => p.status === 'pending').length,
    approved: proofs.filter(p => p.status === 'approved').length,
    rejected: proofs.filter(p => p.status === 'rejected').length,
    auto_approved: proofs.filter(p => p.status === 'auto_approved').length,
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHeader title="Tax Proofs Review" description="Review and approve/reject employee tax proof submissions" />

      <div className="p-6 max-w-7xl mx-auto space-y-6">
        {/* Filters */}
        <SurfaceCard className="p-5">
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Financial Year</label>
              <SelectInput
                value={financialYear}
                onChange={(e) => setFinancialYear(e.target.value)}
              >
                <option value="">Select FY</option>
                <option value="2024-2025">2024-2025</option>
                <option value="2025-2026">2025-2026</option>
                <option value="2023-2024">2023-2024</option>
              </SelectInput>
            </div>
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
                  placeholder="Search description, section..."
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
            { label: 'Pending', value: stats.pending, color: 'amber' },
            { label: 'Approved', value: stats.approved, color: 'emerald' },
            { label: 'Rejected', value: stats.rejected, color: 'rose' },
            { label: 'Auto-Approved', value: stats.auto_approved, color: 'violet' },
          ].map(s => (
            <SurfaceCard key={s.label} className="p-4 text-center">
              <p className="text-2xl font-bold text-slate-900">{s.value}</p>
              <p className={`text-sm text-${s.color}-600`}>{s.label}</p>
            </SurfaceCard>
          ))}
        </div>

        {/* Proofs Table */}
        <SurfaceCard className="overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : proofs.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="h-12 w-12 text-slate-300 mx-auto mb-3" />
              <p className="text-sm text-slate-500">No tax proofs found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Employee</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Section</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Description</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Declared</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">FY</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {proofs
                    .filter(p => !searchQuery ||
                      p.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                      p.section?.toLowerCase().includes(searchQuery.toLowerCase()))
                    .map((proof: any) => (
                    <tr key={proof.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{proof.user?.name || 'Unknown'}</div>
                        <div className="text-xs text-slate-500">{proof.user?.email || ''}</div>
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-900">{proof.section || '-'}</td>
                      <td className="px-4 py-3 text-slate-600 max-w-xs truncate">{proof.description || '-'}</td>
                      <td className="px-4 py-3 text-slate-900">₹{Number(proof.amount || 0).toLocaleString('en-IN')}</td>
                      <td className="px-4 py-3 text-slate-600">{proof.financial_year || '-'}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          proof.status === 'approved' ? 'bg-emerald-50 text-emerald-700' :
                          proof.status === 'rejected' ? 'bg-rose-50 text-rose-700' :
                          proof.status === 'auto_approved' ? 'bg-violet-50 text-violet-700' :
                          'bg-amber-50 text-amber-700'
                        }`}>
                          {proof.status.charAt(0).toUpperCase() + proof.status.slice(1).replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex gap-2 justify-end">
                          {proof.proof_file_path && (
                            <Button
                              variant="ghost"
                              size="sm"
                              iconLeft={<Eye className="h-3 w-3" />}
                              onClick={() => window.open(proof.proof_file_path, '_blank')}
                            >
                              View
                            </Button>
                          )}
                          {proof.status === 'pending' && (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                iconLeft={<CheckCircle className="h-3 w-3 text-emerald-600" />}
                                onClick={() => reviewMutation.mutate({ id: proof.id, decision: 'approved' })}
                                disabled={reviewMutation.isPending}
                              >
                                Approve
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                iconLeft={<XCircle className="h-3 w-3 text-rose-600" />}
                                onClick={() => reviewMutation.mutate({ id: proof.id, decision: 'rejected' })}
                                disabled={reviewMutation.isPending}
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