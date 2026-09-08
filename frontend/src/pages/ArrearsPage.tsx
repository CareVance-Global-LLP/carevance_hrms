import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Calculator, Search, CheckCircle, XCircle, Plus } from 'lucide-react';
import { payrollApi, getApiErrorMessage } from '@/services/api';
import Button from '@/components/ui/Button';
import { TextInput, SelectInput, FieldLabel } from '@/components/ui/FormField';
import { useEmployees } from '@/hooks/useEmployees';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import FilterPanel from '@/components/dashboard/FilterPanel';
import MetricCard from '@/components/dashboard/MetricCard';
import { formatPayrollAmount } from '@/components/ui/PayrollAmount';
import { PageLoadingState, PageErrorState, PageEmptyState } from '@/components/ui/PageState';
import { useToast } from '@/components/ui/Toast';
import RejectReasonModal from '@/components/ui/RejectReasonModal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Modal from '@/components/ui/dialog/Modal';
import HowItWorksCard from '@/components/payroll/HowItWorksCard';
import ModuleHeader from '@/components/payroll/ModuleHeader';
import PayrollDataTable, { type PayrollDataTableColumn } from '@/components/payroll/PayrollDataTable';
import StatusFilter from '@/components/payroll/StatusFilter';
import EmployeePicker from '@/components/payroll/EmployeePicker';
import StatusBadge from '@/components/ui/StatusBadge';
import { payrollStatusTone, titleCase } from '@/utils/payrollStatus';

export default function ArrearsPage() {
  const queryClient = useQueryClient();
  const { show } = useToast();
  const [statusFilter, setStatusFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);

  const [rejecting, setRejecting] = useState<{ id: number; name: string } | null>(null);
  const [approving, setApproving] = useState<{ id: number; name: string } | null>(null);

  const { data: arrearsData, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['arrears', statusFilter, userFilter],
    queryFn: () => payrollApi.listArrears({ status: statusFilter || undefined, user_id: userFilter ? parseInt(userFilter) : undefined }).then((res) => res.data?.data ?? res.data ?? []),
  });

  const { data: usersData } = useEmployees();
  const users = Array.isArray(usersData) ? usersData : [];

  const createMutation = useMutation({
    mutationFn: (data: any) => payrollApi.createArrear(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['arrears'] });
      show({ kind: 'success', message: 'Arrear saved.' });
    },
    onError: (e: any) => show({ kind: 'error', message: getApiErrorMessage(e, 'Failed to save arrear.') }),
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) => payrollApi.approveArrear(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['arrears'] });
      setApproving(null);
      show({ kind: 'success', message: 'Arrear approved.' });
    },
    onError: (e: any) => {
      setApproving(null);
      show({ kind: 'error', message: getApiErrorMessage(e, 'Failed to approve arrear.') });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => payrollApi.rejectArrear(id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['arrears'] });
      setRejecting(null);
      show({ kind: 'success', message: 'Arrear rejected.' });
    },
    onError: (e: any) => {
      setRejecting(null);
      show({ kind: 'error', message: getApiErrorMessage(e, 'Failed to reject arrear.') });
    },
  });

  const arrears = Array.isArray(arrearsData) ? arrearsData : [];

  const stats = {
    total: arrears.length,
    draft: arrears.filter((a: any) => a.status === 'draft').length,
    approved: arrears.filter((a: any) => a.status === 'approved').length,
    rejected: arrears.filter((a: any) => a.status === 'rejected').length,
    paid: arrears.filter((a: any) => a.status === 'paid').length,
  };

  const filteredArrears = arrears.filter(
    (a: any) =>
      !searchQuery ||
      a.reason?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.arrear_type?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Heading: only show "— X Run" when there is actually a run context.
  const headingTitle = arrears.length > 0
    ? `Pending Arrears — ${arrears[0]?.arrear_month || arrears[0]?.calculation_month || 'Current'} Run`
    : 'Pending Arrears';

  const columns: PayrollDataTableColumn<any>[] = [
    {
      key: 'employee',
      header: 'Employee',
      render: (a) => (
        <div>
          <div className="font-medium text-slate-900">{a.user?.name || 'Unknown'}</div>
          <div className="text-xs text-slate-500">{a.user?.email || ''}</div>
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      render: (a) => titleCase(a.arrear_type || 'salary'),
    },
    {
      key: 'month',
      header: 'Arrear Month',
      render: (a) => a.arrear_month || '-',
    },
    {
      key: 'gross',
      header: 'Gross Diff',
      align: 'right',
      render: (a) => formatPayrollAmount(a.gross_difference || 0, { compact: true }),
    },
    {
      key: 'net',
      header: 'Net Arrear',
      align: 'right',
      render: (a) => (
        <span className="font-medium">{formatPayrollAmount(a.net_arrear_amount || 0, { compact: true })}</span>
      ),
    },
    {
      key: 'reason',
      header: 'Reason',
      cellClassName: 'max-w-[200px] truncate',
      render: (a) => a.reason || '-',
    },
    {
      key: 'status',
      header: 'Status',
      align: 'center',
      render: (a) => <StatusBadge tone={payrollStatusTone(a.status)}>{titleCase(a.status)}</StatusBadge>,
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (a) =>
        a.status === 'draft' ? (
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              iconLeft={<CheckCircle className="h-3 w-3 text-emerald-600" />}
              onClick={() => setApproving({ id: a.id, name: a.user?.name || 'this arrear' })}
              disabled={approveMutation.isPending}
            >
              Approve
            </Button>
            <Button
              variant="ghost"
              size="sm"
              iconLeft={<XCircle className="h-3 w-3 text-rose-600" />}
              onClick={() => setRejecting({ id: a.id, name: a.user?.name || 'this arrear' })}
              disabled={rejectMutation.isPending}
            >
              Reject
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      <ModuleHeader
        title={headingTitle}
        description="Retroactive salary payments — for increments, promotions, or revisions applied after the effective date."
      />
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
          { step: 4, label: 'Approve & pay', desc: "Add to current month's payroll run for disbursement" },
        ]}
        commonMistakes={[
          'Paying arrears for a month that already had a disbursed run — needs re-processing',
          'Forgetting to update the employee template for the new CTC going forward',
          'Calculating arrears on Basic alone instead of full CTC differential',
        ]}
      />

      <FilterPanel>
        <div className="flex flex-wrap gap-4 items-end">
          <StatusFilter
            namespace="arrears"
            value={statusFilter}
            onChange={setStatusFilter}
          />
          <div>
            <FieldLabel>Employee</FieldLabel>
            <SelectInput value={userFilter} onChange={(e) => setUserFilter(e.target.value)}>
              <option value="">All Employees</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
              ))}
            </SelectInput>
          </div>
          <div className="flex-1 min-w-[200px]">
            <FieldLabel>Search</FieldLabel>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
              <TextInput
                placeholder="Search reason, type..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>
          <Button
            variant="primary"
            size="sm"
            iconLeft={<Plus className="h-4 w-4" />}
            onClick={() => setShowCreateModal(true)}
          >
            Manual Arrear
          </Button>
        </div>
      </FilterPanel>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <MetricCard label="Total" value={stats.total} accent="sky" icon={Calculator} />
        <MetricCard label="Draft" value={stats.draft} accent="slate" />
        <MetricCard label="Approved" value={stats.approved} accent="emerald" />
        <MetricCard label="Rejected" value={stats.rejected} accent="rose" />
        <MetricCard label="Paid" value={stats.paid} accent="violet" />
      </div>

      <SurfaceCard className="overflow-hidden">
        {isLoading ? (
          <PageLoadingState label="Loading arrears…" />
        ) : isError ? (
          <PageErrorState
            message={getApiErrorMessage(error, "Couldn't load arrears.")}
            onRetry={() => refetch()}
          />
        ) : (
          <PayrollDataTable
            columns={columns}
            rows={filteredArrears}
            rowKey={(a) => a.id}
            loading={false}
            emptyState={
              <PageEmptyState
                title="No arrears records found"
                description="When retroactive pay corrections are created, they'll appear here."
              />
            }
            ariaLabel="Arrears"
          />
        )}
      </SurfaceCard>

      <RejectReasonModal
        isOpen={rejecting !== null}
        title="Reject arrear"
        description={rejecting ? `Provide a reason for rejecting the arrear for ${rejecting.name}.` : undefined}
        onSubmit={(reason) => {
          if (rejecting) rejectMutation.mutate({ id: rejecting.id, reason });
        }}
        onClose={() => !rejectMutation.isPending && setRejecting(null)}
        isLoading={rejectMutation.isPending}
      />

      <ConfirmDialog
        isOpen={approving !== null}
        title="Approve arrear"
        message={approving ? `Approve the arrear for ${approving.name}? It will be added to the current payroll run.` : ''}
        confirmLabel="Approve"
        onConfirm={() => {
          if (approving) approveMutation.mutate(approving.id);
        }}
        onClose={() => !approveMutation.isPending && setApproving(null)}
        isLoading={approveMutation.isPending}
      />

      <ManualArrearModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        submitting={createMutation.isPending}
        onSubmit={(payload) => {
          createMutation.mutate(payload, {
            onSuccess: () => setShowCreateModal(false),
          });
        }}
      />
    </div>
  );
}

interface ManualArrearModalProps {
  open: boolean;
  onClose: () => void;
  submitting: boolean;
  onSubmit: (payload: { user_id: number; arrear_type: string; reason: string; gross_diff: number; net_arrear: number; status: string }) => void;
}

/**
 * Manual Arrear form modal.
 *
 * Replaces the previous inline button that posted a zero-value arrear against
 * whichever employee happened to be `users[0]`. The form now requires an
 * explicit employee pick before the submit button enables.
 */
function ManualArrearModal({ open, onClose, submitting, onSubmit }: ManualArrearModalProps) {
  const [userId, setUserId] = useState('');
  const [arrearType, setArrearType] = useState('salary');
  const [reason, setReason] = useState('');
  const [grossDiff, setGrossDiff] = useState('');
  const [netArrear, setNetArrear] = useState('');

  useEffect(() => {
    if (!open) {
      setUserId('');
      setArrearType('salary');
      setReason('');
      setGrossDiff('');
      setNetArrear('');
    }
  }, [open]);

  const canSubmit = !!userId && !!arrearType && !submitting;

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit({
      user_id: parseInt(userId, 10),
      arrear_type: arrearType,
      reason: reason || 'Manual arrear',
      gross_diff: parseFloat(grossDiff) || 0,
      net_arrear: parseFloat(netArrear) || 0,
      status: 'draft',
    });
  };

  return (
    <Modal
      open={open}
      onClose={() => !submitting && onClose()}
      title="Create manual arrear"
      subtitle="Record a retrospective pay correction for a specific employee."
      size="lg"
      busy={submitting}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={!canSubmit}
            loading={submitting}
          >
            Save arrear
          </Button>
        </>
      }
    >
      <div className="space-y-4 p-5">
        <EmployeePicker
          label="Employee"
          value={userId}
          onChange={setUserId}
          emptyLabel="Select employee…"
          required
        />

        <div>
          <FieldLabel>Arrear type</FieldLabel>
          <SelectInput value={arrearType} onChange={(e) => setArrearType(e.target.value)}>
            <option value="salary">Salary</option>
            <option value="increment">Increment</option>
            <option value="promotion">Promotion</option>
            <option value="retrospective">Retrospective</option>
            <option value="settlement">Settlement</option>
          </SelectInput>
        </div>

        <div>
          <FieldLabel>Reason</FieldLabel>
          <TextInput
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Q1 increment approved in July"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <FieldLabel>Gross difference (₹)</FieldLabel>
            <TextInput
              type="number"
              value={grossDiff}
              onChange={(e) => setGrossDiff(e.target.value)}
              placeholder="0"
            />
          </div>
          <div>
            <FieldLabel>Net arrear (₹)</FieldLabel>
            <TextInput
              type="number"
              value={netArrear}
              onChange={(e) => setNetArrear(e.target.value)}
              placeholder="0"
            />
          </div>
        </div>
      </div>
    </Modal>
  );
}
