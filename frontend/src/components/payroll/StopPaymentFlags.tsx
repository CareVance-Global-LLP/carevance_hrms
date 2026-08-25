import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldAlert, Plus, X } from 'lucide-react';
import { payrollApi } from '@/services/api';
import Button from '@/components/ui/Button';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import StatusBadge from '@/components/ui/StatusBadge';
import CustomSelect from '@/components/ui/CustomSelect';
import { TextInput, FieldLabel } from '@/components/ui/FormField';
import { useToast } from '@/components/ui/Toast';
import Modal from '@/components/ui/dialog/Modal';

const HOLD_TYPE_OPTIONS = [
  { value: 'processing', label: 'Hold (Processing)' },
  { value: 'payout', label: 'Hold (Payout)' },
];

interface StopPaymentFlagsProps {
  payGroupId?: number;
  monthYear?: string;
}

export default function StopPaymentFlags({ payGroupId, monthYear }: StopPaymentFlagsProps) {
  const queryClient = useQueryClient();
  const { show } = useToast();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [resolveConfirmId, setResolveConfirmId] = useState<number | null>(null);

  const { data: flagsData, isLoading } = useQuery({
    queryKey: ['payroll', 'stop-payment-flags', payGroupId, monthYear],
    queryFn: () => payrollApi.listStopPaymentFlags().then((r) => r.data),
    enabled: true,
  });

  const createMutation = useMutation({
    mutationFn: (data: {
      user_id: number;
      month_year: string;
      hold_type: 'processing' | 'payout';
      reason?: string;
    }) => payrollApi.createStopPaymentFlag(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll', 'stop-payment-flags'] });
      setShowCreateModal(false);
      show({ kind: 'success', message: 'Stop payment flag created.' });
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message || 'Failed to create stop payment flag.';
      show({ kind: 'error', message: msg });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { hold_type?: 'processing' | 'payout'; reason?: string; resolve?: boolean } }) =>
      payrollApi.updateStopPaymentFlag(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll', 'stop-payment-flags'] });
      setEditingId(null);
      show({ kind: 'success', message: 'Stop payment flag updated.' });
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message || 'Failed to update stop payment flag.';
      show({ kind: 'error', message: msg });
    },
  });

  const resolveMutation = useMutation({
    mutationFn: (id: number) => payrollApi.resolveStopPaymentFlag(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll', 'stop-payment-flags'] });
      setResolveConfirmId(null);
      show({ kind: 'success', message: 'Stop payment flag resolved.' });
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message || 'Failed to resolve stop payment flag.';
      show({ kind: 'error', message: msg });
    },
  });

  const flags = (flagsData?.data ?? []) as Array<{
    id: number;
    user_id: number;
    user_name: string;
    user_email: string;
    month_year: string;
    hold_type: 'processing' | 'payout';
    reason: string | null;
    is_active: boolean;
    created_at: string;
  }>;

  const holdTypeOptions = [
    { value: 'processing', label: 'Hold (Processing)' },
    { value: 'payout', label: 'Hold (Payout)' },
  ];

  return (
    <SurfaceCard className="p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-amber-500" />
          <h3 className="text-sm font-semibold text-slate-900">Stop Payment Flags</h3>
          <span className="text-xs text-slate-500">({flags.length} active)</span>
        </div>
        <Button variant="primary" size="sm" onClick={() => setShowCreateModal(true)}>
          <Plus className="h-4 w-4 mr-1" />
          Add Flag
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <ShieldAlert className="h-4 w-4 animate-spin" />
          Loading stop payment flags…
        </div>
      ) : flags.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <span className="text-green-500">✓</span>
          No active stop payment flags.
        </div>
      ) : (
        <div className="space-y-2">
          {flags.map((flag) => (
            <div
              key={flag.id}
              className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-900">{flag.user_name}</p>
                <p className="text-xs text-slate-500">{flag.user_email}</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {flag.month_year} · {flag.hold_type === 'processing' ? 'Hold (Processing)' : 'Hold (Payout)'}
                  {flag.reason ? ` · ${flag.reason}` : ''}
                </p>
              </div>
              <StatusBadge
                tone={flag.hold_type === 'processing' ? 'warning' : 'danger'}
              >
                {flag.hold_type === 'processing' ? 'Processing' : 'Payout'}
              </StatusBadge>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditingId(flag.id)}
                >
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setResolveConfirmId(flag.id)}
                  className="text-red-500 hover:text-red-700"
                >
                  Resolve
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreateModal && (
        <CreateStopPaymentFlagModal
          onClose={() => setShowCreateModal(false)}
          onCreated={() => {
            queryClient.invalidateQueries({ queryKey: ['payroll', 'stop-payment-flags'] });
            setShowCreateModal(false);
          }}
          payGroupId={payGroupId}
          monthYear={monthYear}
        />
      )}

      {editingId !== null && (
        <EditStopPaymentFlagModal
          flagId={editingId}
          onClose={() => setEditingId(null)}
          onUpdated={() => {
            queryClient.invalidateQueries({ queryKey: ['payroll', 'stop-payment-flags'] });
            setEditingId(null);
          }}
        />
      )}

      {resolveConfirmId !== null && (
        <Modal
          open
          onClose={() => setResolveConfirmId(null)}
          titleId="resolve-stop-payment-title"
          size="sm"
          panelClassName="p-6"
          busy={resolveMutation.isPending}
        >
            <h4 id="resolve-stop-payment-title" className="text-sm font-semibold text-slate-900 mb-2">Resolve Stop Payment Flag?</h4>
            <p className="text-xs text-slate-500 mb-4">
              This will clear the hold and allow payroll processing to proceed for this employee.
            </p>
            <div className="flex items-center gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={() => setResolveConfirmId(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => resolveMutation.mutate(resolveConfirmId)}
                disabled={resolveMutation.isPending}
              >
                Resolve
              </Button>
            </div>
        </Modal>
      )}
    </SurfaceCard>
  );
}

function CreateStopPaymentFlagModal({
  onClose,
  onCreated,
  payGroupId,
  monthYear,
}: {
  onClose: () => void;
  onCreated: () => void;
  payGroupId?: number;
  monthYear?: string;
}) {
  const { show } = useToast();
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState('');
  const [flagMonthYear, setFlagMonthYear] = useState(monthYear ?? '');
  const [holdType, setHoldType] = useState<'processing' | 'payout'>('processing');
  const [reason, setReason] = useState('');

  const createMutation = useMutation({
    mutationFn: (data: {
      user_id: number;
      month_year: string;
      hold_type: 'processing' | 'payout';
      reason?: string;
    }) => payrollApi.createStopPaymentFlag(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll', 'stop-payment-flags'] });
      onCreated();
      show({ kind: 'success', message: 'Stop payment flag created.' });
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message || 'Failed to create stop payment flag.';
      show({ kind: 'error', message: msg });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId || !flagMonthYear) return;
    createMutation.mutate({
      user_id: Number(userId),
      month_year: flagMonthYear,
      hold_type: holdType,
      reason: reason || undefined,
    });
  };

  return (
    <Modal open onClose={onClose} titleId="add-stop-payment-title" size="md" panelClassName="p-6">
        <div className="flex items-center justify-between mb-4">
          <h4 id="add-stop-payment-title" className="text-sm font-semibold text-slate-900">Add Stop Payment Flag</h4>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <FieldLabel>Employee ID</FieldLabel>
            <TextInput
              type="number"
              min={1}
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="User ID"
              className="w-full"
              required
            />
          </div>
          <div>
            <FieldLabel>Month/Year</FieldLabel>
            <TextInput
              type="month"
              value={flagMonthYear}
              onChange={(e) => setFlagMonthYear(e.target.value)}
              className="w-full"
              required
            />
          </div>
          <div>
            <FieldLabel>Hold Type</FieldLabel>
            <CustomSelect
              options={HOLD_TYPE_OPTIONS}
              value={holdType}
              onChange={(value) => setHoldType(value as 'processing' | 'payout')}
              placeholder="Select hold type"
            />
          </div>
          <div>
            <FieldLabel>Reason (optional)</FieldLabel>
            <TextInput
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason for hold"
              className="w-full"
            />
          </div>
          <div className="flex items-center gap-2 justify-end pt-2">
            <Button variant="ghost" size="sm" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Creating…' : 'Create Flag'}
            </Button>
          </div>
        </form>
    </Modal>
  );
}

function EditStopPaymentFlagModal({
  flagId,
  onClose,
  onUpdated,
}: {
  flagId: number;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const { show } = useToast();
  const queryClient = useQueryClient();
  const [holdType, setHoldType] = useState<'processing' | 'payout'>('processing');
  const [reason, setReason] = useState('');

  const updateMutation = useMutation({
    mutationFn: (data: { hold_type?: 'processing' | 'payout'; reason?: string }) =>
      payrollApi.updateStopPaymentFlag(flagId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll', 'stop-payment-flags'] });
      onUpdated();
      show({ kind: 'success', message: 'Stop payment flag updated.' });
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message || 'Failed to update stop payment flag.';
      show({ kind: 'error', message: msg });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateMutation.mutate({
      hold_type: holdType,
      reason: reason || undefined,
    });
  };

  return (
    <Modal open onClose={onClose} titleId="edit-stop-payment-title" size="md" panelClassName="p-6">
        <div className="flex items-center justify-between mb-4">
          <h4 id="edit-stop-payment-title" className="text-sm font-semibold text-slate-900">Edit Stop Payment Flag</h4>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <FieldLabel>Hold Type</FieldLabel>
            <CustomSelect
              options={HOLD_TYPE_OPTIONS}
              value={holdType}
              onChange={(value) => setHoldType(value as 'processing' | 'payout')}
            />
          </div>
          <div>
            <FieldLabel>Reason (optional)</FieldLabel>
            <TextInput
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason for hold"
              className="w-full"
            />
          </div>
          <div className="flex items-center gap-2 justify-end pt-2">
            <Button variant="ghost" size="sm" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" type="submit" disabled={updateMutation.isPending}>
              {updateMutation.isPending ? 'Saving…' : 'Save Changes'}
            </Button>
          </div>
        </form>
    </Modal>
  );
}