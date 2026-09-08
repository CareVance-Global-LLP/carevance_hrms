import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, Plus, TrendingUp } from 'lucide-react';
import { payrollApi, getApiErrorMessage } from '@/services/api';
import Button from '@/components/ui/Button';
import { TextInput, SelectInput, FieldLabel, ToggleInput } from '@/components/ui/FormField';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import FilterPanel from '@/components/dashboard/FilterPanel';
import MetricCard from '@/components/dashboard/MetricCard';
import StatusBadge from '@/components/ui/StatusBadge';
import { formatPayrollAmount } from '@/components/ui/PayrollAmount';
import { PageLoadingState, PageErrorState, PageEmptyState } from '@/components/ui/PageState';
import { useToast } from '@/components/ui/Toast';
import HowItWorksCard from '@/components/payroll/HowItWorksCard';
import ModuleHeader from '@/components/payroll/ModuleHeader';
import PayrollDataTable, { type PayrollDataTableColumn } from '@/components/payroll/PayrollDataTable';
import StatusFilter from '@/components/payroll/StatusFilter';
import EmployeePicker from '@/components/payroll/EmployeePicker';
import { payrollStatusTone, titleCase } from '@/utils/payrollStatus';

export default function SalaryRevisionPage() {
  const queryClient = useQueryClient();
  const { show } = useToast();
  const [statusFilter, setStatusFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showForm, setShowForm] = useState(false);

  /*
   * Bring the form to the person who asked for it.
   *
   * The panel renders below the list, so on anything short of a very tall
   * window "New Revision" appeared to do nothing — the button label flipped
   * to Cancel and the form opened off-screen. Keka drops a drawer over the
   * page for exactly this reason.
   *
   * Scrolling rather than converting to a modal keeps the existing list
   * visible beside the form, which is useful while deciding who to revise,
   * and avoids introducing a focus trap this page does not have today.
   */
  useEffect(() => {
    if (!showForm) return;
    document
      .getElementById('new-revision-form')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [showForm]);

  const [formData, setFormData] = useState({
    user_id: '',
    new_ctc: '',
    revision_type: 'annual_increment',
    reason: '',
    effective_date: '',
    generate_arrears: true,
  });

  const { data: lettersData, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['revision-letters', statusFilter],
    queryFn: () =>
      payrollApi.getRevisionLetters(undefined, statusFilter || undefined).then((res) => {
        const body = res.data?.data ?? res.data ?? [];
        if (Array.isArray(body)) return body;
        return Array.isArray(body?.data) ? body.data : [];
      }),
  });

  const { data: usersData } = useQuery({
    queryKey: ['payroll-employees'],
    queryFn: () => payrollApi.getEmployees().then((res) => res.data ?? []),
  });

  const generateMutation = useMutation({
    mutationFn: () => payrollApi.generateRevisionLetter({
      user_id: parseInt(formData.user_id),
      new_ctc: parseFloat(formData.new_ctc),
      effective_date: formData.effective_date,
      revision_type: formData.revision_type,
      reason: formData.reason || undefined,
      generate_arrears: formData.generate_arrears,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['revision-letters'] });
      setFormData({ user_id: '', new_ctc: '', revision_type: 'annual_increment', reason: '', effective_date: '', generate_arrears: true });
      setShowForm(false);
      show({ kind: 'success', message: 'Salary revision letter generated.' });
    },
    onError: (e: any) => show({ kind: 'error', message: getApiErrorMessage(e, 'Failed to generate revision letter.') }),
  });

  const letters = Array.isArray(lettersData) ? lettersData : [];
  const users = Array.isArray(usersData) ? usersData : [];

  const filteredLetters = letters.filter((l) => {
    if (searchQuery && !l.user?.name?.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const stats = {
    total: letters.length,
    draft: letters.filter((l) => l.status === 'draft').length,
    generated: letters.filter((l) => l.status === 'generated').length,
    accepted: letters.filter((l) => l.status === 'accepted').length,
  };

  const columns: PayrollDataTableColumn<any>[] = [
    {
      key: 'employee',
      header: 'Employee',
      render: (l) => <span className="font-medium text-slate-900">{l.user?.name || 'Unknown'}</span>,
    },
    {
      key: 'old',
      header: 'Old CTC',
      align: 'right',
      render: (l) => formatPayrollAmount(l.old_ctc, { compact: true }),
    },
    {
      key: 'new',
      header: 'New CTC',
      align: 'right',
      render: (l) => formatPayrollAmount(l.new_ctc, { compact: true }),
    },
    {
      key: 'date',
      header: 'Eff. Date',
      render: (l) => l.effective_from || '-',
    },
    {
      key: 'status',
      header: 'Status',
      render: (l) => <StatusBadge tone={payrollStatusTone(l.status)}>{titleCase(l.status)}</StatusBadge>,
    },
  ];

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Salary Revisions"
        description="Record CTC changes — increments, promotions, corrections. Auto-detects arrears for back-dated revisions."
      />

      <HowItWorksCard
        whatIsThis="A record of an employee's CTC changing from one figure to another on a given date. The revision letter is the document the employee receives; the effective date is what payroll and arrears are calculated from."
        whenToUse={[
          'Annual increment cycle — raise CTC for a group of employees',
          'Promotion or role change mid-year',
          'Correcting a CTC that was entered wrong at hiring',
        ]}
        howItFlows={[
          { step: 1, label: 'Pick employee and new CTC', desc: 'The current CTC comes from their payroll template' },
          { step: 2, label: 'Set the effective date', desc: 'A past date means arrears are owed for the months already run' },
          { step: 3, label: 'Generate the letter', desc: 'Creates the revision record and, if asked, queues the arrears' },
          { step: 4, label: 'Arrears paid', desc: 'Approve the arrear against a run in the Arrears panel' },
        ]}
        commonMistakes={[
          'Back-dating without ticking Generate Arrears — the employee is underpaid for the elapsed months',
          'Revising CTC directly on the payroll template instead of here, which leaves no audit trail',
          'Setting an effective date mid-month when the run for that month is already locked',
        ]}
      />

      <FilterPanel>
        <div className="flex flex-wrap items-end gap-4">
          <StatusFilter
            namespace="revisions"
            value={statusFilter}
            onChange={setStatusFilter}
          />
          <div className="flex-1 min-w-[200px]">
            <FieldLabel>Search</FieldLabel>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
              <TextInput
                placeholder="Search employee..."
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
            onClick={() => setShowForm(!showForm)}
          >
            {showForm ? 'Cancel' : 'New Revision'}
          </Button>
        </div>
      </FilterPanel>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <MetricCard label="Total" value={stats.total} accent="sky" icon={TrendingUp} />
        <MetricCard label="Draft" value={stats.draft} accent="slate" />
        <MetricCard label="Generated" value={stats.generated} accent="amber" />
        <MetricCard label="Accepted" value={stats.accepted} accent="emerald" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SurfaceCard className="overflow-hidden">
          {isLoading ? (
            <PageLoadingState label="Loading salary revisions…" />
          ) : isError ? (
            <PageErrorState
              message={getApiErrorMessage(error, "Couldn't load salary revisions.")}
              onRetry={() => refetch()}
            />
          ) : (
            <PayrollDataTable
              columns={columns}
              rows={filteredLetters}
              rowKey={(l) => l.id}
              emptyState={
                <PageEmptyState
                  title={letters.length === 0 ? 'No salary revisions found' : 'No matching revisions'}
                  description={
                    letters.length === 0
                      ? "When salary revisions are created, they'll appear here."
                      : 'No revision matches your filters. Clear the search or status to see all.'
                  }
                />
              }
              ariaLabel="Salary revisions"
            />
          )}
        </SurfaceCard>

        {showForm && (
          <SurfaceCard id="new-revision-form" className="p-6">
            <h3 className="text-lg font-semibold text-slate-900 mb-6">New Revision</h3>
            <div className="space-y-4">
              <EmployeePicker
                label="Employee"
                value={formData.user_id}
                onChange={(v) => setFormData({ ...formData, user_id: v })}
                emptyLabel="Select employee…"
                required
              />

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
                <FieldLabel>Revision Type</FieldLabel>
                <SelectInput
                  value={formData.revision_type}
                  onChange={(e) => setFormData({ ...formData, revision_type: e.target.value })}
                >
                  <option value="annual_increment">Annual increment</option>
                  <option value="promotion">Promotion</option>
                  <option value="correction">Correction</option>
                  <option value="other">Other</option>
                </SelectInput>
              </div>

              <div>
                <FieldLabel>Reason (optional)</FieldLabel>
                <TextInput
                  value={formData.reason}
                  placeholder="e.g. Promoted to Senior Recruiter after Q2 review"
                  onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                />
              </div>

              <div>
                <FieldLabel>Generate Arrears?</FieldLabel>
                <div className="flex items-center gap-3 mt-1">
                  <ToggleInput
                    checked={formData.generate_arrears}
                    onChange={(v) => setFormData({ ...formData, generate_arrears: v })}
                  />
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
                  loading={generateMutation.isPending}
                >
                  Save & Generate Letter
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setShowForm(false);
                    setFormData({ user_id: '', new_ctc: '', revision_type: 'annual_increment', reason: '', effective_date: '', generate_arrears: true });
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
