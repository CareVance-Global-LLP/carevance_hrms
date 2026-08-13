import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, Search, CheckCircle, XCircle, Eye } from 'lucide-react';
import { payrollApi, getApiErrorMessage } from '@/services/api';
import Button from '@/components/ui/Button';
import { TextInput, SelectInput, FieldLabel } from '@/components/ui/FormField';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import FilterPanel from '@/components/dashboard/FilterPanel';
import MetricCard from '@/components/dashboard/MetricCard';
import StatusBadge from '@/components/ui/StatusBadge';
import { formatPayrollAmount } from '@/components/ui/PayrollAmount';
import { PageLoadingState, PageErrorState, PageEmptyState } from '@/components/ui/PageState';
import { useToast } from '@/components/ui/Toast';
import RejectReasonModal from '@/components/ui/RejectReasonModal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import HowItWorksCard from '@/components/payroll/HowItWorksCard';
import ModuleHeader from '@/components/payroll/ModuleHeader';
import { currentFinancialYear } from '@/lib/payroll/financialYear';
import { payrollStatusTone, titleCase } from '@/utils/payrollStatus';

const STATUS_OPTIONS = ['pending', 'approved', 'rejected', 'auto_approved'];

/** Current FY and the three before it, in the 'YYYY-YYYY' form tax proofs are stored under. */
function taxProofFinancialYears(): string[] {
  const startYear = Number.parseInt(currentFinancialYear().slice(0, 4), 10);
  return [0, 1, 2, 3].map((back) => `${startYear - back}-${startYear - back + 1}`);
}

export default function TaxProofsReviewPage() {
  const queryClient = useQueryClient();
  const { show } = useToast();
  const [financialYear, setFinancialYear] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [userFilter, setUserFilter] = useState('');

  const [approving, setApproving] = useState<{ id: number; name: string } | null>(null);
  const [rejecting, setRejecting] = useState<{ id: number; name: string } | null>(null);
  const [bulkConfirming, setBulkConfirming] = useState(false);

  const financialYearOptions = taxProofFinancialYears();

  const { data: proofsData, isLoading, isError, error, refetch } = useQuery({
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
      queryClient.invalidateQueries({ queryKey: ['tax-proofs-summary'] });
      setApproving(null);
      setRejecting(null);
      show({ kind: 'success', message: 'Tax proof reviewed.' });
    },
    onError: (e: any) => {
      setApproving(null);
      setRejecting(null);
      show({ kind: 'error', message: getApiErrorMessage(e, 'Failed to review tax proof.') });
    },
  });

  const bulkApproveMutation = useMutation({
    mutationFn: ({ userId, financialYear }: { userId: number; financialYear?: string }) =>
      payrollApi.bulkApproveTaxProofs(userId, financialYear),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tax-proofs'] });
      queryClient.invalidateQueries({ queryKey: ['tax-proofs-summary'] });
      setBulkConfirming(false);
      show({ kind: 'success', message: 'Tax proofs approved.' });
    },
    onError: (e: any) => {
      setBulkConfirming(false);
      show({ kind: 'error', message: getApiErrorMessage(e, 'Failed to bulk approve tax proofs.') });
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
    <div className="space-y-6">
      <ModuleHeader
        title="Tax Proofs Review"
        description="Review and approve or reject the bills and receipts employees submit against what they declared."
      />

      <HowItWorksCard
        whatIsThis="The verification step behind a tax declaration. An employee declares an investment in April and uploads the proof later; until it is approved here, the deduction is only a claim."
        whenToUse={[
          'Proof submission season, usually January to March',
          'Before the final quarter\'s TDS, so unproved declarations can be reversed in time',
          'When an employee disputes the tax deducted from their salary',
        ]}
        howItFlows={[
          { step: 1, label: 'Employee uploads', desc: 'A bill or receipt against each declared item' },
          { step: 2, label: 'You review', desc: 'Approve, or reject with a reason the employee can act on' },
          { step: 3, label: 'TDS recalculates', desc: 'Approved proofs keep the deduction; rejected ones raise the tax' },
          { step: 4, label: 'Form 16', desc: 'Only verified amounts appear on the annual certificate' },
        ]}
        commonMistakes={[
          'Approving a proof for more than the amount declared',
          'Leaving proofs pending past the last run of the year — the deduction stands unverified',
          'Rejecting without a reason, which gives the employee nothing to correct',
        ]}
      />

      <div className="space-y-6">
        {/* Filters */}
        <FilterPanel>
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <FieldLabel>Financial Year</FieldLabel>
              <SelectInput
                value={financialYear}
                onChange={(e) => setFinancialYear(e.target.value)}
              >
                <option value="">Select FY</option>
                {/*
                  * Derived, not hardcoded: this list used to stop at 2025-2026,
                  * so once that year passed there was no way to review the
                  * current year's proofs at all. Kept in the 'YYYY-YYYY' shape
                  * this endpoint stores (see TaxProofUploadController), which is
                  * not the 'YYYY-YY' key declarations match on.
                  */}
                {financialYearOptions.map((fy) => (
                  <option key={fy} value={fy}>{fy}</option>
                ))}
              </SelectInput>
            </div>
            <div>
              <FieldLabel>Status</FieldLabel>
              <SelectInput
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="">All Status</option>
                {STATUS_OPTIONS.map(s => <option key={s} value={s}>{titleCase(s)}</option>)}
              </SelectInput>
            </div>
            <div>
              <FieldLabel>Employee</FieldLabel>
              <SelectInput
                value={userFilter}
                onChange={(e) => setUserFilter(e.target.value)}
              >
                <option value="">All Employees</option>
                {users.map((u: any) => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
              </SelectInput>
            </div>
            <div className="flex-1 min-w-[200px]">
              <FieldLabel>Search</FieldLabel>
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
            <div>
              <Button
                variant="primary"
                size="sm"
                iconLeft={<CheckCircle className="h-3 w-3" />}
                disabled={!userFilter || !financialYear || bulkApproveMutation.isPending}
                onClick={() => setBulkConfirming(true)}
              >
                Bulk Approve
              </Button>
            </div>
          </div>
        </FilterPanel>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <MetricCard label="Total" value={stats.total} accent="sky" icon={FileText} />
          <MetricCard label="Pending" value={stats.pending} accent="amber" />
          <MetricCard label="Approved" value={stats.approved} accent="emerald" />
          <MetricCard label="Rejected" value={stats.rejected} accent="rose" />
          <MetricCard label="Auto-Approved" value={stats.auto_approved} accent="violet" />
        </div>

        {/* Proofs Table */}
        <SurfaceCard className="overflow-hidden">
          {!financialYear ? (
            <PageEmptyState
              title="Select a financial year"
              description="Pick a financial year above to review the proofs employees have submitted for it."
            />
          ) : isLoading ? (
            <PageLoadingState label="Loading tax proofs…" />
          ) : isError ? (
            <PageErrorState
              message={getApiErrorMessage(error, "Couldn't load tax proofs.")}
              onRetry={() => refetch()}
            />
          ) : proofs.length === 0 ? (
            <PageEmptyState
              title="No tax proofs found"
              description="No employee has submitted a proof for this financial year yet."
            />
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
                      <td className="px-4 py-3 text-slate-900">{formatPayrollAmount(proof.amount, { compact: true })}</td>
                      <td className="px-4 py-3 text-slate-600">{proof.financial_year || '-'}</td>
                      <td className="px-4 py-3">
                        <StatusBadge tone={payrollStatusTone(proof.status)}>{titleCase(proof.status)}</StatusBadge>
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
                                onClick={() => setApproving({ id: proof.id, name: proof.user?.name || 'this proof' })}
                                disabled={reviewMutation.isPending}
                              >
                                Approve
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                iconLeft={<XCircle className="h-3 w-3 text-rose-600" />}
                                onClick={() => setRejecting({ id: proof.id, name: proof.user?.name || 'this proof' })}
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

      <RejectReasonModal
        isOpen={rejecting !== null}
        title="Reject tax proof"
        description={rejecting ? `Provide a reason for rejecting the tax proof for ${rejecting.name}.` : undefined}
        onSubmit={(reason) => {
          if (rejecting) reviewMutation.mutate({ id: rejecting.id, decision: 'rejected', notes: reason });
        }}
        onClose={() => !reviewMutation.isPending && setRejecting(null)}
        isLoading={reviewMutation.isPending}
      />

      <ConfirmDialog
        isOpen={approving !== null}
        title="Approve tax proof"
        message={approving ? `Approve the tax proof for ${approving.name}?` : ''}
        confirmLabel="Approve"
        onConfirm={() => {
          if (approving) reviewMutation.mutate({ id: approving.id, decision: 'approved' });
        }}
        onClose={() => !reviewMutation.isPending && setApproving(null)}
        isLoading={reviewMutation.isPending}
      />

      <ConfirmDialog
        isOpen={bulkConfirming}
        title="Bulk approve tax proofs"
        message="Approve all pending tax proofs for the selected employee and financial year?"
        confirmLabel="Bulk Approve"
        onConfirm={() => {
          if (userFilter) bulkApproveMutation.mutate({ userId: Number(userFilter), financialYear });
        }}
        onClose={() => !bulkApproveMutation.isPending && setBulkConfirming(false)}
        isLoading={bulkApproveMutation.isPending}
      />
    </div>
  );
}
