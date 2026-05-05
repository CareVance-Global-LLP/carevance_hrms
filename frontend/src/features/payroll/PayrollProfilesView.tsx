import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import PageHeader from '@/components/dashboard/PageHeader';
import MetricCard from '@/components/dashboard/MetricCard';
import FilterPanel from '@/components/dashboard/FilterPanel';
import DataTable from '@/components/dashboard/DataTable';
import Button from '@/components/ui/Button';
import { FieldLabel, SelectInput, TextInput } from '@/components/ui/FormField';
import SearchSuggestInput from '@/components/ui/SearchSuggestInput';
import { FeedbackBanner, PageErrorState, PageLoadingState } from '@/components/ui/PageState';
import { buildEmployeeSearchSuggestions, getSuggestionDisplayValue, matchesSearchFilter, normalizeSearchValue } from '@/lib/searchSuggestions';
import { payrollWorkspaceApi } from '@/services/api';
import type { PayrollProfile } from '@/types';
import { Landmark, Receipt, UserRound, Wallet } from 'lucide-react';
import PayrollSectionCard from '@/features/payroll/components/PayrollSectionCard';
import PayrollStatusBadge from '@/features/payroll/components/PayrollStatusBadge';
import PayrollProfileForm, { type PayrollProfileFormValue } from '@/features/payroll/components/PayrollProfileForm';
import { defaultPayrollMonth, formatPayrollCurrency, formatPayrollMonth, maskBankAccount, templateAssignmentLabel } from '@/features/payroll/utils';

const profileWarnings = (profile: PayrollProfile) => {
  const warnings: string[] = [];
  if (!profile.salary_template_id) warnings.push('Missing salary template');
  if (!profile.payroll_code) warnings.push('Missing payroll code');
  if (!profile.pay_group) warnings.push('Missing pay group');
  if (!profile.payout_method) warnings.push('Missing payout method');
  if (!profile.bank_account_number && !profile.payment_email) warnings.push('Missing payout destination');
  if (profile.bank_verification_status !== 'verified') warnings.push('Bank not verified');
  if (!profile.pan_or_tax_id && !profile.tax_identifier) warnings.push('Missing PAN / tax ID');
  if (profile.compliance_readiness_status === 'blocked') warnings.push('Compliance blocked');
  if (!['submitted', 'approved'].includes(String(profile.declaration_status || ''))) warnings.push('Tax declaration incomplete');
  if (!profile.payroll_eligible) warnings.push('Payroll eligibility disabled');
  if (!profile.is_active) warnings.push('Profile inactive');
  return warnings;
};

const formatRevisionDate = (value?: string | null) => {
  if (!value) return 'Not recorded';
  return new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

export default function PayrollProfilesView() {
  const [selectedProfileId, setSelectedProfileId] = useState<number | null>(null);
  const [draftUserId, setDraftUserId] = useState<number | undefined>(undefined);
  const [payrollMonth, setPayrollMonth] = useState(defaultPayrollMonth());
  const [search, setSearch] = useState('');
  const [selectedSearchEmployeeId, setSelectedSearchEmployeeId] = useState<number | null>(null);
  const [filterType, setFilterType] = useState<'all' | 'configured' | 'missing'>('all');
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const profilesQuery = useQuery({
    queryKey: ['payroll-workspace-profiles', payrollMonth],
    queryFn: async () => (await payrollWorkspaceApi.getProfiles({ payroll_month: payrollMonth })).data,
  });

  const profiles = profilesQuery.data?.profiles || [];
  const employees = profilesQuery.data?.employees || [];
  const employeeSearchSuggestions = useMemo(() => buildEmployeeSearchSuggestions(employees), [employees]);
  const templates = profilesQuery.data?.templates || [];
  const profileByUserId = useMemo(() => new Map(profiles.map((profile) => [profile.user_id, profile])), [profiles]);
  const missingEmployees = useMemo(() => employees.filter((employee) => !profileByUserId.has(employee.id)), [employees, profileByUserId]);

  const filteredProfiles = useMemo(
    () => profiles.filter((profile) => {
      if (selectedSearchEmployeeId) {
        return Number(profile.user_id) === Number(selectedSearchEmployeeId);
      }

      return matchesSearchFilter(search, [profile.user?.name]);
    }),
    [profiles, search, selectedSearchEmployeeId]
  );

  const filteredMissing = useMemo(
    () => missingEmployees.filter((employee) => {
      if (selectedSearchEmployeeId) {
        return Number(employee.id) === Number(selectedSearchEmployeeId);
      }

      return matchesSearchFilter(search, [employee.name]);
    }),
    [missingEmployees, search, selectedSearchEmployeeId]
  );

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId) || null,
    [profiles, selectedProfileId]
  );

  const selectedWarnings = selectedProfile ? profileWarnings(selectedProfile) : [];
  const readyProfilesCount = profiles.filter((profile) => profileWarnings(profile).length === 0).length;
  const bankReadyCount = profiles.filter((profile) => Boolean(profile.bank_account_number || profile.payment_email)).length;
  const currentCycleReadyCount = profiles.filter((profile) => profile.payroll_eligible && profile.is_active && profileWarnings(profile).length === 0).length;

  const openCreateForm = (userId?: number) => {
    setSelectedProfileId(null);
    setDraftUserId(userId);
  };

  const openEditForm = (profileId: number) => {
    setDraftUserId(undefined);
    setSelectedProfileId(profileId);
  };

  const saveProfile = async (form: PayrollProfileFormValue) => {
    setFeedback(null);
    setIsSaving(true);
    try {
      const payload = {
        ...form,
        user_id: Number(form.user_id),
        salary_template_id: form.salary_template_id ? Number(form.salary_template_id) : undefined,
        bonus_amount: Number(form.bonus_amount || 0),
        tax_amount: Number(form.tax_amount || 0),
      };

      if (selectedProfile) {
        await payrollWorkspaceApi.updateProfile(selectedProfile.id, payload);
      } else {
        await payrollWorkspaceApi.createProfile(payload);
      }

      setFeedback({ tone: 'success', message: selectedProfile ? 'Payroll profile updated.' : 'Payroll profile created.' });
      setSelectedProfileId(null);
      setDraftUserId(undefined);
      await profilesQuery.refetch();
    } catch (error: any) {
      setFeedback({ tone: 'error', message: error?.response?.data?.message || 'Failed to save payroll profile.' });
    } finally {
      setIsSaving(false);
    }
  };

  if (profilesQuery.isLoading) {
    return <PageLoadingState label="Loading payroll employee profiles..." />;
  }

  if (profilesQuery.isError) {
    return <PageErrorState message={(profilesQuery.error as any)?.response?.data?.message || 'Failed to load payroll employee profiles.'} onRetry={() => void profilesQuery.refetch()} />;
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Payroll records"
        title="Employee Payroll Profiles"
        description="Review payroll readiness, payout setup, template assignment, revision signals, and current-cycle completeness before moving people into pay runs."
        actions={(
          <div className="min-w-[11rem]">
            <FieldLabel>Current Cycle</FieldLabel>
            <TextInput type="month" value={payrollMonth} onChange={(event) => setPayrollMonth(event.target.value)} />
          </div>
        )}
      />

      {feedback ? <FeedbackBanner tone={feedback.tone} message={feedback.message} /> : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="Configured Profiles" value={profiles.length} hint="Employee payroll records already created." icon={UserRound} accent="sky" />
        <MetricCard label="Payroll Ready" value={readyProfilesCount} hint="Profiles with template, payout method, destination, and active eligibility." icon={Wallet} accent="emerald" />
        <MetricCard label="Current Cycle Ready" value={currentCycleReadyCount} hint={`Ready for ${formatPayrollMonth(payrollMonth)}.`} icon={Wallet} accent="violet" />
        <MetricCard label="Missing Profiles" value={missingEmployees.length} hint="Employees not yet configured for payroll." icon={Receipt} accent="amber" />
        <MetricCard label="Payout Ready" value={bankReadyCount} hint="Profiles with a payout destination already captured." icon={Landmark} accent="sky" />
      </div>

      <FilterPanel className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_0.6fr_auto]">
        <div>
          <FieldLabel>Search employee</FieldLabel>
          <SearchSuggestInput
            value={search}
            onValueChange={(value) => {
              setSearch(value);

              const selectedEmployeeName =
                employees.find((employee) => Number(employee.id) === Number(selectedSearchEmployeeId))?.name || '';

              if (!value.trim() || normalizeSearchValue(value) !== normalizeSearchValue(selectedEmployeeName)) {
                setSelectedSearchEmployeeId(null);
              }
            }}
            onSuggestionSelect={(suggestion) => {
              const nextEmployeeId = Number((suggestion.payload as any)?.id || 0);
              setSearch(getSuggestionDisplayValue(suggestion));
              setSelectedSearchEmployeeId(Number.isFinite(nextEmployeeId) && nextEmployeeId > 0 ? nextEmployeeId : null);
            }}
            suggestions={employeeSearchSuggestions}
            placeholder="Search by employee name"
            emptyMessage="No employee names match this search."
          />
        </div>
        <div>
          <FieldLabel>View</FieldLabel>
          <SelectInput value={filterType} onChange={(event) => setFilterType(event.target.value as 'all' | 'configured' | 'missing')}>
            <option value="all">Configured + missing</option>
            <option value="configured">Configured only</option>
            <option value="missing">Missing only</option>
          </SelectInput>
        </div>
        <div className="flex items-end">
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => {
              setSearch('');
              setSelectedSearchEmployeeId(null);
              setFilterType('all');
            }}
          >
            Reset Filters
          </Button>
        </div>
      </FilterPanel>

      {(filterType === 'all' || filterType === 'configured') ? (
        <DataTable
          title="Configured Payroll Records"
          description={`Operational payroll record index for ${formatPayrollMonth(payrollMonth)} with readiness, payout setup, compliance visibility, and compensation-change signals.`}
          rows={filteredProfiles}
          emptyMessage="No configured payroll profiles match the current filters."
          stickyHeader
          headerAction={<Button variant="secondary" size="sm" onClick={() => openCreateForm()}>New Payroll Profile</Button>}
          columns={[
            {
              key: 'employee',
              header: 'Employee',
              className: 'min-w-[16rem]',
              render: (profile: PayrollProfile) => (
                <div>
                  <p className="font-medium text-slate-950">{profile.user?.name || `User #${profile.user_id}`}</p>
                  <p className="mt-1 text-sm text-slate-500">{profile.user?.email}</p>
                </div>
              ),
            },
            {
              key: 'record',
              header: 'Payroll Record',
              className: 'min-w-[15rem]',
              render: (profile: PayrollProfile) => {
                const cycleReady = profile.is_active && profile.payroll_eligible && profileWarnings(profile).length === 0;
                return (
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-2">
                      <PayrollStatusBadge status={profile.is_active ? 'active' : 'inactive'} />
                      <PayrollStatusBadge status={profile.payroll_eligible ? 'eligible' : 'ineligible'} />
                      <PayrollStatusBadge status={cycleReady ? 'healthy' : 'pending'} />
                    </div>
                    <p className="text-sm text-slate-500">{cycleReady ? 'Ready for current cycle' : 'Needs setup before clean processing'}</p>
                  </div>
                );
              },
            },
            {
              key: 'salary_setup',
              header: 'Salary Template',
              render: (profile: PayrollProfile) => (
                <div>
                  <p className="font-medium text-slate-950">{templateAssignmentLabel(profile.salary_template)}</p>
                  <p className="mt-1 text-sm text-slate-500">
                    Bonus {formatPayrollCurrency(Number(profile.bonus_amount || 0), profile.currency)} | Tax {formatPayrollCurrency(Number(profile.tax_amount || 0), profile.currency)}
                  </p>
                </div>
              ),
            },
            {
              key: 'payout',
              header: 'Payout And Bank',
              render: (profile: PayrollProfile) => {
                const payoutReady = Boolean(profile.bank_account_number || profile.payment_email);
                return (
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-2">
                      <PayrollStatusBadge status={profile.payout_method || 'incomplete'} />
                      <PayrollStatusBadge status={payoutReady ? 'verified' : 'incomplete'} />
                    </div>
                    <p className="text-sm text-slate-500">
                      {profile.bank_account_number ? maskBankAccount(profile.bank_account_number) : profile.payment_email || 'No payout destination'}
                    </p>
                  </div>
                );
              },
            },
            {
              key: 'compliance',
              header: 'Compliance',
              render: (profile: PayrollProfile) => (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    <PayrollStatusBadge status={profile.pan_or_tax_id || profile.tax_identifier ? 'verified' : 'incomplete'} />
                    <PayrollStatusBadge status={profile.declaration_status || 'not_started'} />
                    <PayrollStatusBadge status={profile.compliance_readiness_status || 'pending'} />
                    <PayrollStatusBadge status={profile.reimbursements_eligible ? 'active' : 'inactive'} />
                  </div>
                  <p className="text-sm text-slate-500">{profile.compliance_readiness_status === 'ready' ? 'Compliance setup is payroll-ready' : 'Compliance details still need attention'}</p>
                </div>
              ),
            },
            {
              key: 'revisions',
              header: 'Revisions And Adjustments',
              className: 'min-w-[15rem]',
              render: (profile: PayrollProfile) => (
                <div>
                  <p className="font-medium text-slate-950">Revised {formatRevisionDate(profile.last_revision_date)}</p>
                  <p className="mt-1 text-sm text-slate-500">
                    {Number(profile.current_cycle_adjustments_count || 0)} current-cycle adjustments | {formatPayrollCurrency(Number(profile.current_cycle_adjustments_total || 0), profile.currency)}
                  </p>
                </div>
              ),
            },
            {
              key: 'issues',
              header: 'Setup Alerts',
              className: 'min-w-[14rem]',
              render: (profile: PayrollProfile) => {
                const warnings = profileWarnings(profile);
                return warnings.length === 0 ? (
                  <div className="flex items-center gap-2">
                    <PayrollStatusBadge status="healthy" />
                    <span className="text-sm text-slate-500">No missing setup</span>
                  </div>
                ) : (
                  <div>
                    <p className="font-medium text-slate-950">{warnings.length} alerts</p>
                    <p className="mt-1 text-sm text-slate-500">{warnings.slice(0, 2).join(' | ')}</p>
                  </div>
                );
              },
            },
            {
              key: 'actions',
              header: 'Actions',
              className: 'min-w-[13rem]',
              render: (profile: PayrollProfile) => (
                <div className="flex flex-wrap gap-2">
                  <Link to={`/payroll/employees/${profile.user_id}`}>
                    <Button size="sm">Open Record</Button>
                  </Link>
                  <Button size="sm" variant="secondary" onClick={() => openEditForm(profile.id)}>
                    Quick Edit
                  </Button>
                </div>
              ),
            },
          ]}
        />
      ) : null}

      {(filterType === 'all' || filterType === 'missing') ? (
        <DataTable
          title="Employees Missing Payroll Setup"
          description="Employees who need a payroll record before they can move cleanly through payroll validation and pay runs."
          rows={filteredMissing}
          emptyMessage="No missing payroll profiles match the current filters."
          columns={[
            {
              key: 'employee',
              header: 'Employee',
              className: 'min-w-[16rem]',
              render: (employee: { id: number; name: string; email: string }) => (
                <div>
                  <p className="font-medium text-slate-950">{employee.name}</p>
                  <p className="mt-1 text-sm text-slate-500">{employee.email}</p>
                </div>
              ),
            },
            {
              key: 'readiness',
              header: 'Record State',
              render: () => <PayrollStatusBadge status="missing profile" />,
            },
            {
              key: 'actions',
              header: 'Actions',
              className: 'min-w-[13rem]',
              render: (employee: { id: number; name: string; email: string }) => (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => openCreateForm(employee.id)}>
                    Create Profile
                  </Button>
                  <Link to={`/payroll/employees/${employee.id}`}>
                    <Button size="sm" variant="secondary">Open Record</Button>
                  </Link>
                </div>
              ),
            },
          ]}
        />
      ) : null}

      <PayrollSectionCard
        title={selectedProfile ? 'Quick Edit Payroll Record' : draftUserId ? 'Create Missing Payroll Record' : 'Create Payroll Record'}
        description="Use the quick editor for profile-level setup, then open the employee payroll record for compensation history, readiness checks, and deeper payroll context."
      >
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[0.72fr_1.28fr]">
          <div className="space-y-4 rounded-[24px] border border-slate-200/80 bg-slate-50/70 p-4">
            <div>
              <p className="text-sm font-semibold text-slate-950">{selectedProfile ? 'Selected payroll record' : 'Quick-create guidance'}</p>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                {selectedProfile
                  ? 'This quick editor is best for payout defaults, template assignment, and eligibility changes. Use the employee payroll record for revision history and richer payroll context.'
                  : 'Create payroll records here for missing employees or lightweight setup updates without leaving the payroll workspace.'}
              </p>
            </div>

            {selectedProfile ? (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <PayrollStatusBadge status={selectedProfile.is_active ? 'active' : 'inactive'} />
                  <PayrollStatusBadge status={selectedProfile.payroll_eligible ? 'eligible' : 'ineligible'} />
                  <PayrollStatusBadge status={selectedProfile.bank_account_number || selectedProfile.payment_email ? 'verified' : 'incomplete'} />
                </div>
                <div className="grid grid-cols-1 gap-3 text-sm">
                  <div>
                    <p className="text-slate-500">Current cycle</p>
                    <p className="font-semibold text-slate-950">{selectedProfile.is_active && selectedProfile.payroll_eligible && selectedWarnings.length === 0 ? `Ready for ${formatPayrollMonth(payrollMonth)}` : `Blocked for ${formatPayrollMonth(payrollMonth)}`}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Salary template</p>
                    <p className="font-semibold text-slate-950">{templateAssignmentLabel(selectedProfile.salary_template)}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Payout method</p>
                    <p className="font-semibold text-slate-950">{selectedProfile.payout_method || 'Not configured'}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Tax readiness</p>
                    <p className="font-semibold text-slate-950">{selectedProfile.declaration_status === 'approved' ? 'Declaration approved' : selectedProfile.pan_or_tax_id || selectedProfile.tax_identifier ? 'Tax details captured' : 'Tax details pending'}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Compliance status</p>
                    <p className="font-semibold text-slate-950">{selectedProfile.compliance_readiness_status || 'pending'}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Last revision</p>
                    <p className="font-semibold text-slate-950">{formatRevisionDate(selectedProfile.last_revision_date)}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Adjustment summary</p>
                    <p className="font-semibold text-slate-950">
                      {Number(selectedProfile.current_cycle_adjustments_count || 0)} items | {formatPayrollCurrency(Number(selectedProfile.current_cycle_adjustments_total || 0), selectedProfile.currency)}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500">Missing setup</p>
                    <p className="font-semibold text-slate-950">{selectedWarnings.length === 0 ? 'No outstanding issues' : selectedWarnings.join(' | ')}</p>
                  </div>
                </div>
                <Link to={`/payroll/employees/${selectedProfile.user_id}`}>
                  <Button size="sm" variant="secondary">Open Full Payroll Record</Button>
                </Link>
              </div>
            ) : (
              <div className="space-y-3 text-sm text-slate-600">
                <p>Minimum good setup is a salary template, payout method, and destination details.</p>
                <p>Employees with missing payroll records stay visible in the table above until their profile is created.</p>
              </div>
            )}
          </div>

          <PayrollProfileForm
            employees={employees}
            templates={templates}
            profile={selectedProfile}
            defaultUserId={draftUserId}
            onSave={saveProfile}
            isSaving={isSaving}
            onReset={() => {
              setSelectedProfileId(null);
              setDraftUserId(undefined);
            }}
          />
        </div>
      </PayrollSectionCard>
    </div>
  );
}
