import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, Plus } from 'lucide-react';
import { payrollApi, getApiErrorMessage } from '@/services/api';
import Button from '@/components/ui/Button';
import { TextInput, SelectInput, FieldLabel } from '@/components/ui/FormField';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import StatusBadge from '@/components/ui/StatusBadge';
import { formatPayrollAmount } from '@/components/ui/PayrollAmount';
import { PageLoadingState, PageEmptyState } from '@/components/ui/PageState';
import { useToast } from '@/components/ui/Toast';
import { payrollStatusTone, titleCase } from '@/utils/payrollStatus';

const STATUS_OPTIONS = ['draft', 'generated', 'accepted', 'rejected'];

export default function SalaryRevisionPage() {
  const queryClient = useQueryClient();
  const { show } = useToast();
  const [statusFilter, setStatusFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showForm, setShowForm] = useState(false);

  const [formData, setFormData] = useState({
    user_id: '',
    new_ctc: '',
    effective_date: '',
    generate_arrears: true,
  });

  const { data: lettersData, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['revision-letters', statusFilter],
    queryFn: () => payrollApi.getRevisionLetters(undefined, statusFilter || undefined).then(res => res.data?.data ?? res.data ?? []),
  });

  const { data: usersData } = useQuery({
    queryKey: ['payroll-employees'],
    queryFn: () => payrollApi.getEmployees().then(res => res.data ?? []),
  });

  const generateMutation = useMutation({
    mutationFn: () => payrollApi.generateRevisionLetter({
      user_id: parseInt(formData.user_id),
      new_ctc: parseFloat(formData.new_ctc),
      effective_date: formData.effective_date,
      generate_arrears: formData.generate_arrears,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['revision-letters'] });
      setFormData({ user_id: '', new_ctc: '', effective_date: '', generate_arrears: true });
      setShowForm(false);
      show({ kind: 'success', message: 'Salary revision letter generated.' });
    },
    onError: (e: any) => show({ kind: 'error', message: getApiErrorMessage(e, 'Failed to generate revision letter.') }),
  });

  const letters = Array.isArray(lettersData) ? lettersData : [];
  const users = Array.isArray(usersData) ? usersData : [];

  const filteredLetters = letters.filter(l => {
    if (searchQuery && !l.user?.name?.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Salary Revisions</h2>
          <p className="text-sm text-slate-500 mt-1">
            Record CTC changes — increments, promotions, corrections. Auto-detects arrears for back-dated revisions.
          </p>
        </div>
        <Button
          variant="primary"
          size="sm"
          iconLeft={<Plus className="h-4 w-4" />}
          onClick={() => setShowForm(!showForm)}
        >
          {showForm ? 'Cancel' : '+ New Revision'}
        </Button>
      </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SurfaceCard className="overflow-hidden">
            {isLoading ? (
              <PageLoadingState label="Loading salary revisions…" />
            ) : isError ? (
              <PageEmptyState
                title="Couldn't load salary revisions"
                description={getApiErrorMessage(error, 'Please try again.')}
                action={
                  <Button variant="secondary" size="sm" onClick={() => refetch()}>
                    Retry
                  </Button>
                }
              />
            ) : filteredLetters.length === 0 ? (
              <PageEmptyState
                title="No salary revisions found"
                description="When salary revisions are created, they'll appear here."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50">
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Employee</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Old CTC</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">New CTC</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Eff. Date</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredLetters.map((letter: any) => (
                      <tr key={letter.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-900">{letter.user?.name || 'Unknown'}</div>
                        </td>
                        <td className="px-4 py-3 text-slate-900">{formatPayrollAmount(letter.old_ctc, { compact: true })}</td>
                        <td className="px-4 py-3 text-slate-900">{formatPayrollAmount(letter.new_ctc, { compact: true })}</td>
                        <td className="px-4 py-3 text-slate-900">{letter.effective_from || '-'}</td>
                        <td className="px-4 py-3">
                          <StatusBadge tone={payrollStatusTone(letter.status)}>{titleCase(letter.status)}</StatusBadge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SurfaceCard>

          {showForm && (
            <SurfaceCard className="p-6">
              <h3 className="text-lg font-semibold text-slate-900 mb-6">New Revision</h3>
              <div className="space-y-4">
                <div>
                  <FieldLabel>Employee</FieldLabel>
                  <SelectInput
                    value={formData.user_id}
                    onChange={(e) => setFormData({ ...formData, user_id: e.target.value })}
                  >
                    <option value="">Select employee...</option>
                    {users.map((u: any) => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </SelectInput>
                </div>

                <div>
                  <FieldLabel>New Annual CTC (₹)</FieldLabel>
                  <TextInput
                    type="number"
                    value={formData.new_ctc}
                    onChange={(e) => setFormData({ ...formData, new_ctc: e.target.value })}
                    placeholder="e.g. 1440000"
                  />
                </div>

                <div>
                  <FieldLabel>Effective Date</FieldLabel>
                  <TextInput
                    type="date"
                    value={formData.effective_date}
                    onChange={(e) => setFormData({ ...formData, effective_date: e.target.value })}
                  />
                </div>

                <div>
                  <FieldLabel>Generate Arrears?</FieldLabel>
                  <div className="flex items-center gap-3 mt-1">
                    <button
                      type="button"
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        formData.generate_arrears ? 'bg-blue-600' : 'bg-slate-300'
                      }`}
                      onClick={() => setFormData({ ...formData, generate_arrears: !formData.generate_arrears })}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          formData.generate_arrears ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                    <span className="text-sm text-slate-600">Auto-calculate and queue arrears</span>
                  </div>
                </div>

                {formData.generate_arrears && formData.effective_date && formData.user_id && formData.new_ctc && (() => {
                  const selectedUser = users.find((u: any) => String(u.id) === formData.user_id) as any;
                  const oldCtc = selectedUser?.annual_ctc || 0;
                  const newCtc = parseFloat(formData.new_ctc) || 0;
                  const monthlyDiff = (newCtc - oldCtc) / 12;
                  const effectiveDate = new Date(formData.effective_date);
                  const now = new Date();
                  const monthsBack = Math.max(0, (now.getFullYear() - effectiveDate.getFullYear()) * 12 + (now.getMonth() - effectiveDate.getMonth()));
                  const projected = Math.round(monthlyDiff * monthsBack);
                  return monthsBack > 0 && projected !== 0 ? (
                    <div className="rounded-md bg-blue-50 border border-blue-200 p-3">
                      <p className="text-sm text-blue-800">
                        Projected arrear: {formatPayrollAmount(projected)} for {monthsBack} month{monthsBack > 1 ? 's' : ''}
                      </p>
                    </div>
                  ) : null;
                })()}

                <div className="flex gap-3 pt-4">
                  <Button
                    variant="primary"
                    onClick={() => generateMutation.mutate()}
                    disabled={!formData.user_id || !formData.new_ctc || !formData.effective_date || generateMutation.isPending}
                  >
                    {generateMutation.isPending ? 'Generating...' : 'Save & Generate Letter'}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setShowForm(false);
                      setFormData({ user_id: '', new_ctc: '', effective_date: '', generate_arrears: true });
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </SurfaceCard>
          )}
        </div>
      </div>
  );
}
