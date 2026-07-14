import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, Plus, CheckCircle, XCircle, Download, Send } from 'lucide-react';
import { payrollApi, getApiErrorMessage } from '@/services/api';
import Button from '@/components/ui/Button';
import { TextInput, SelectInput, TextareaInput, FieldLabel } from '@/components/ui/FormField';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import PageHeader from '@/components/dashboard/PageHeader';
import MetricCard from '@/components/dashboard/MetricCard';
import StatusBadge from '@/components/ui/StatusBadge';
import { formatPayrollAmount } from '@/components/ui/PayrollAmount';
import { PageLoadingState, PageEmptyState } from '@/components/ui/PageState';
import { useToast } from '@/components/ui/Toast';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import HowItWorksCard from '@/components/payroll/HowItWorksCard';
import { payrollStatusTone, titleCase } from '@/utils/payrollStatus';

const REVISION_TYPES = [
  { value: 'annual_increment', label: 'Annual Increment' },
  { value: 'promotion', label: 'Promotion' },
  { value: 'correction', label: 'Correction' },
  { value: 'other', label: 'Other' },
];

const STATUS_OPTIONS = ['draft', 'generated', 'accepted', 'rejected'];

export default function SalaryRevisionPage() {
  const queryClient = useQueryClient();
  const { show } = useToast();
  const [statusFilter, setStatusFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showGenerateForm, setShowGenerateForm] = useState(false);
  const [formData, setFormData] = useState({
    user_id: '',
    new_ctc: '',
    revision_type: 'annual_increment',
    reason: '',
  });

  const [accepting, setAccepting] = useState<{ id: number; name: string } | null>(null);
  const [rejecting, setRejecting] = useState<{ id: number; name: string } | null>(null);

  const { data: lettersData, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['revision-letters', statusFilter],
    queryFn: () => payrollApi.getRevisionLetters().then(res => res.data?.data ?? res.data ?? []),
  });

  const { data: usersData } = useQuery({
    queryKey: ['payroll-employees'],
    queryFn: () => payrollApi.getEmployees().then(res => res.data ?? []),
  });

  const generateMutation = useMutation({
    mutationFn: () => payrollApi.generateRevisionLetter({
      user_id: parseInt(formData.user_id),
      new_ctc: parseFloat(formData.new_ctc),
      revision_type: formData.revision_type,
      reason: formData.reason,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['revision-letters'] });
      setShowGenerateForm(false);
      setFormData({ user_id: '', new_ctc: '', revision_type: 'annual_increment', reason: '' });
      show({ kind: 'success', message: 'Salary revision letter generated.' });
    },
    onError: (e: any) => show({ kind: 'error', message: getApiErrorMessage(e, 'Failed to generate revision letter.') }),
  });

  const acceptMutation = useMutation({
    mutationFn: (id: number) => payrollApi.acceptRevisionLetter(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['revision-letters'] });
      setAccepting(null);
      show({ kind: 'success', message: 'Salary revision letter accepted.' });
    },
    onError: (e: any) => {
      setAccepting(null);
      show({ kind: 'error', message: getApiErrorMessage(e, 'Failed to accept revision letter.') });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (id: number) => payrollApi.rejectRevisionLetter(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['revision-letters'] });
      setRejecting(null);
      show({ kind: 'success', message: 'Salary revision letter rejected.' });
    },
    onError: (e: any) => {
      setRejecting(null);
      show({ kind: 'error', message: getApiErrorMessage(e, 'Failed to reject revision letter.') });
    },
  });

  const letters = Array.isArray(lettersData) ? lettersData : [];
  const users = Array.isArray(usersData) ? usersData : [];

  const stats = {
    total: letters.length,
    draft: letters.filter(l => l.status === 'draft').length,
    generated: letters.filter(l => l.status === 'generated').length,
    accepted: letters.filter(l => l.status === 'accepted').length,
    rejected: letters.filter(l => l.status === 'rejected').length,
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHeader
        title="Salary Revisions"
        description="Record CTC changes — increments, promotions, corrections. Auto-detects arrears for back-dated revisions."
      />

      <div className="p-6 max-w-7xl mx-auto space-y-6">
        <HowItWorksCard
          whatIsThis="Formal record of an employee\'s CTC change — annual increment, promotion, or correction. Stores old vs new CTC, effective date, reason, and auto-detects arrears for back-dated changes."
          whenToUse={[
            'Annual appraisal cycle (increment effective from April 1)',
            'Mid-year promotion with CTC revision',
            'Salary correction after a payroll audit',
            'Counter-offer adjustment to retain an employee',
          ]}
          howItFlows={[
            { step: 1, label: 'Create revision', desc: 'Old CTC, new CTC, effective date, reason' },
            { step: 2, label: 'Generate letter', desc: 'PDF revision letter auto-generated for the employee' },
            { step: 3, label: 'Detect arrears', desc: 'System calculates back-dated differential from effective date' },
            { step: 4, label: 'Send & pay', desc: 'Letter sent; arrears added to current month\'s payroll run' },
          ]}
          commonMistakes={[
            'Forgetting to set the correct effective date — arrears will be wrong',
            'Not checking tax regime impact (CTC increase can shift employee to higher slab)',
            'Generating letter before employee countersigns',
          ]}
        />

        {/* Action Bar */}
        <div className="flex items-center justify-between">
          <SurfaceCard className="p-4 flex-1 mr-4">
            <div className="flex flex-wrap gap-4 items-end">
              <div>
                <FieldLabel>Status</FieldLabel>
                <SelectInput value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  <option value="">All Status</option>
                  {STATUS_OPTIONS.map(s => <option key={s} value={s}>{titleCase(s)}</option>)}
                </SelectInput>
              </div>
              <div className="flex-1 min-w-[200px]">
                <FieldLabel>Search</FieldLabel>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <TextInput
                    placeholder="Search by employee..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>
            </div>
          </SurfaceCard>
          <Button
            variant="primary"
            iconLeft={<Plus className="h-4 w-4" />}
            onClick={() => setShowGenerateForm(true)}
          >
            Generate Letter
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <MetricCard label="Total" value={stats.total} accent="sky" />
          <MetricCard label="Draft" value={stats.draft} accent="slate" />
          <MetricCard label="Generated" value={stats.generated} accent="amber" />
          <MetricCard label="Accepted" value={stats.accepted} accent="emerald" />
          <MetricCard label="Rejected" value={stats.rejected} accent="rose" />
        </div>

        {/* Generate Form Modal */}
        {showGenerateForm && (
          <SurfaceCard className="p-5">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">Generate Salary Revision Letter</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <FieldLabel>Employee</FieldLabel>
                <SelectInput
                  value={formData.user_id}
                  onChange={(e) => setFormData({ ...formData, user_id: e.target.value })}
                >
                  <option value="">Select employee...</option>
                  {users.map((u: any) => (
                    <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
                  ))}
                </SelectInput>
              </div>
              <div>
                <FieldLabel>New Annual CTC (₹)</FieldLabel>
                <TextInput
                  type="number"
                  value={formData.new_ctc}
                  onChange={(e) => setFormData({ ...formData, new_ctc: e.target.value })}
                  placeholder="e.g. 1500000"
                />
              </div>
              <div>
                <FieldLabel>Revision Type</FieldLabel>
                <SelectInput
                  value={formData.revision_type}
                  onChange={(e) => setFormData({ ...formData, revision_type: e.target.value })}
                >
                  {REVISION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </SelectInput>
              </div>
              <div className="md:col-span-2">
                <FieldLabel>Reason</FieldLabel>
                <TextareaInput
                  value={formData.reason}
                  onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                  placeholder="Describe the reason for revision..."
                  rows={3}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="secondary" onClick={() => setShowGenerateForm(false)}>Cancel</Button>
              <Button
                variant="primary"
                iconLeft={<Send className="h-4 w-4" />}
                onClick={() => generateMutation.mutate()}
                disabled={!formData.user_id || !formData.new_ctc || !formData.reason || generateMutation.isPending}
              >
                {generateMutation.isPending ? 'Generating...' : 'Generate & Send'}
              </Button>
            </div>
          </SurfaceCard>
        )}

        {/* Letters Table */}
        <SurfaceCard className="overflow-hidden">
          {isLoading ? (
            <PageLoadingState label="Loading salary revision letters…" />
          ) : isError ? (
            <PageEmptyState
              title="Couldn't load salary revision letters"
              description={getApiErrorMessage(error, 'Please try again.')}
              action={
                <Button variant="secondary" size="sm" onClick={() => refetch()}>
                  Retry
                </Button>
              }
            />
          ) : letters.length === 0 ? (
            <PageEmptyState
              title="No salary revision letters found"
              description="When salary revision letters are generated, they'll appear here."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Employee</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Old CTC</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">New CTC</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Change</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Type</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Effective</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {letters
                    .filter(l => !searchQuery || l.user?.name?.toLowerCase().includes(searchQuery.toLowerCase()))
                    .map((letter: any) => {
                      const change = (letter.new_ctc - letter.old_ctc);
                      const changePct = letter.old_ctc > 0 ? (change / letter.old_ctc * 100) : 0;
                      return (
                        <tr key={letter.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-4 py-3">
                            <div className="font-medium text-slate-900">{letter.user?.name || 'Unknown'}</div>
                            <div className="text-xs text-slate-500">{letter.user?.email || ''}</div>
                          </td>
                          <td className="px-4 py-3 text-slate-900">{formatPayrollAmount(letter.old_ctc, { compact: true })}</td>
                          <td className="px-4 py-3 text-slate-900">{formatPayrollAmount(letter.new_ctc, { compact: true })}</td>
                          <td className="px-4 py-3">
                            <span className={change > 0 ? 'text-emerald-600' : change < 0 ? 'text-rose-600' : 'text-slate-500'}>
                              {change > 0 ? '+' : ''}{formatPayrollAmount(change, { compact: true })} ({changePct.toFixed(1)}%)
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] bg-[rgba(93,150,157,0.1)] text-[#5D969D]">
                              {REVISION_TYPES.find(t => t.value === letter.revision_type)?.label || letter.revision_type}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-slate-900">{letter.effective_from || '-'}</td>
                          <td className="px-4 py-3">
                            <StatusBadge tone={payrollStatusTone(letter.status)}>{titleCase(letter.status)}</StatusBadge>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex gap-2 justify-end">
                              {letter.letter_file_path && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  iconLeft={<Download className="h-3 w-3" />}
                                  onClick={() => window.open(letter.letter_file_path, '_blank')}
                                >
                                  View
                                </Button>
                              )}
                              {letter.status === 'generated' && (
                                <>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    iconLeft={<CheckCircle className="h-3 w-3 text-emerald-600" />}
                                    onClick={() => setAccepting({ id: letter.id, name: letter.user?.name || 'this letter' })}
                                    disabled={acceptMutation.isPending}
                                  >
                                    Accept
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    iconLeft={<XCircle className="h-3 w-3 text-rose-600" />}
                                    onClick={() => setRejecting({ id: letter.id, name: letter.user?.name || 'this letter' })}
                                    disabled={rejectMutation.isPending}
                                  >
                                    Reject
                                  </Button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </SurfaceCard>
      </div>

      <ConfirmDialog
        isOpen={accepting !== null}
        title="Accept salary revision"
        message={accepting ? `Accept the salary revision letter for ${accepting.name}?` : ''}
        confirmLabel="Accept"
        onConfirm={() => {
          if (accepting) acceptMutation.mutate(accepting.id);
        }}
        onClose={() => !acceptMutation.isPending && setAccepting(null)}
        isLoading={acceptMutation.isPending}
      />

      <ConfirmDialog
        isOpen={rejecting !== null}
        title="Reject salary revision"
        message={rejecting ? `Reject the salary revision letter for ${rejecting.name}?` : ''}
        confirmLabel="Reject"
        onConfirm={() => {
          if (rejecting) rejectMutation.mutate(rejecting.id);
        }}
        onClose={() => !rejectMutation.isPending && setRejecting(null)}
        isLoading={rejectMutation.isPending}
      />
    </div>
  );
}
