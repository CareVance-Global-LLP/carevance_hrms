import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import PageHeader from '@/components/dashboard/PageHeader';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import Button from '@/components/ui/Button';
import StatusBadge from '@/components/ui/StatusBadge';
import { FeedbackBanner, PageErrorState, PageLoadingState } from '@/components/ui/PageState';
import { FieldLabel, SelectInput, TextInput, ToggleInput } from '@/components/ui/FormField';
import { employeeWorkspaceApi, payrollWorkspaceApi } from '@/services/api';
import EmployeeWorkspaceTabs from '@/features/employees/EmployeeWorkspaceTabs';
import EmployeeStatCard from '@/features/employees/EmployeeStatCard';
import EmployeeSectionCard from '@/features/employees/EmployeeSectionCard';
import PayrollProfileForm, { type PayrollProfileFormValue } from '@/features/payroll/components/PayrollProfileForm';
import { formatPayrollCurrency, formatPayrollDuration, payrollStatusTone } from '@/features/payroll/utils';
import { ArrowLeft, Download } from 'lucide-react';

const tabs = ['overview', 'about', 'work', 'payroll', 'government', 'bank', 'documents', 'attendance', 'leave', 'activity'];
const labelize = (value: string) => value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const createEmptyBankForm = () => ({ payout_method: 'bank_transfer', verification_status: 'unverified', is_default: true });

export default function EmployeeDetailWorkspace() {
  const { employeeId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const id = Number(employeeId || 0);
  const tab = searchParams.get('tab') || 'overview';
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [aboutForm, setAboutForm] = useState<Record<string, any>>({});
  const [workForm, setWorkForm] = useState<Record<string, any>>({});
  const [govForm, setGovForm] = useState<Record<string, any>>({ id_type: 'PAN', status: 'pending' });
  const [bankForm, setBankForm] = useState<Record<string, any>>(createEmptyBankForm());
  const [docForm, setDocForm] = useState<Record<string, any>>({ category: 'other', review_status: 'pending' });

  const workspaceQuery = useQuery({
    queryKey: ['employee-workspace', id],
    queryFn: async () => (await employeeWorkspaceApi.getWorkspace(id)).data,
    enabled: id > 0,
  });
  const templatesQuery = useQuery({
    queryKey: ['employee-workspace-templates'],
    queryFn: async () => (await payrollWorkspaceApi.getProfiles()).data,
    enabled: id > 0,
  });

  const data = workspaceQuery.data;
  useEffect(() => {
    if (!data) return;
    setAboutForm({
      first_name: data.about?.first_name || '', last_name: data.about?.last_name || '', display_name: data.about?.display_name || '', gender: data.about?.gender || '',
      date_of_birth: data.about?.date_of_birth || '', phone: data.about?.phone || '', personal_email: data.about?.personal_email || '', address_line: data.about?.address_line || '',
      city: data.about?.city || '', state: data.about?.state || '', postal_code: data.about?.postal_code || '', emergency_contact_name: data.about?.emergency_contact_name || '',
      emergency_contact_number: data.about?.emergency_contact_number || '', emergency_contact_relationship: data.about?.emergency_contact_relationship || '',
    });
    setWorkForm({
      employee_code: data.work_info?.employee_code || '', report_group_id: data.work_info?.report_group_id || '', designation: data.work_info?.designation || '',
      reporting_manager_id: data.work_info?.reporting_manager_id || '', work_location: data.work_info?.work_location || '', shift_name: data.work_info?.shift_name || '',
      attendance_policy: data.work_info?.attendance_policy || '', employment_type: data.work_info?.employment_type || '', joining_date: data.work_info?.joining_date || '',
      probation_status: data.work_info?.probation_status || '', employment_status: data.work_info?.employment_status || 'active', exit_date: data.work_info?.exit_date || '', work_mode: data.work_info?.work_mode || '',
    });
    const savedBank = data.bank_accounts.find((item) => item.is_default) || data.bank_accounts[0];
    setBankForm(savedBank ? {
      id: savedBank.id,
      account_holder_name: savedBank.account_holder_name || '',
      bank_name: savedBank.bank_name || '',
      account_number: savedBank.account_number || '',
      ifsc_swift: savedBank.ifsc_swift || '',
      branch: savedBank.branch || '',
      account_type: savedBank.account_type || '',
      upi_id: savedBank.upi_id || '',
      payment_email: savedBank.payment_email || '',
      payout_method: savedBank.payout_method || 'bank_transfer',
      verification_status: savedBank.verification_status || 'unverified',
      is_default: Boolean(savedBank.is_default),
    } : createEmptyBankForm());
  }, [data]);

  const refetch = async () => void queryClient.invalidateQueries({ queryKey: ['employee-workspace', id] });
  const success = async (message: string) => { setFeedback({ tone: 'success', message }); await refetch(); };
  const failure = (message: string, error: any) => setFeedback({ tone: 'error', message: error?.response?.data?.message || message });

  const saveAbout = useMutation({ mutationFn: () => employeeWorkspaceApi.updateProfile(id, aboutForm), onSuccess: async () => success('Personal details saved.'), onError: (e) => failure('Could not save personal details.', e) });
  const saveWork = useMutation({ mutationFn: () => employeeWorkspaceApi.updateWorkInfo(id, workForm), onSuccess: async () => success('Work information saved.'), onError: (e) => failure('Could not save work information.', e) });
  const saveGov = useMutation({ mutationFn: () => employeeWorkspaceApi.saveGovernmentId(id, govForm), onSuccess: async () => { setGovForm({ id_type: 'PAN', status: 'pending' }); await success('Government ID saved.'); }, onError: (e) => failure('Could not save government ID.', e) });
  const saveBank = useMutation({ mutationFn: () => employeeWorkspaceApi.saveBankAccount(id, bankForm), onSuccess: async () => { setBankForm(createEmptyBankForm()); await success('Bank details saved.'); }, onError: (e) => failure('Could not save bank details.', e) });
  const saveDoc = useMutation({ mutationFn: () => employeeWorkspaceApi.uploadDocument(id, docForm as any), onSuccess: async () => { setDocForm({ category: 'other', review_status: 'pending' }); await success('Document uploaded.'); }, onError: (e) => failure('Could not upload document.', e) });
  const savePayroll = useMutation({
    mutationFn: async (form: PayrollProfileFormValue) => {
      const payload = { ...form, user_id: Number(form.user_id), salary_template_id: form.salary_template_id ? Number(form.salary_template_id) : undefined, bonus_amount: Number(form.bonus_amount || 0), tax_amount: Number(form.tax_amount || 0) };
      return data?.payroll.profile?.id ? payrollWorkspaceApi.updateProfile(data.payroll.profile.id, payload) : payrollWorkspaceApi.createProfile(payload);
    },
    onSuccess: async () => success('Payroll profile saved.'),
    onError: (e) => failure('Could not save payroll profile.', e),
  });

  const initials = useMemo(() => (data?.employee?.name || 'Employee').split(' ').slice(0, 2).map((part) => part[0]?.toUpperCase()).join(''), [data]);
  if (workspaceQuery.isLoading) return <PageLoadingState label="Loading employee workspace..." />;
  if (workspaceQuery.isError || !data) return <PageErrorState message={(workspaceQuery.error as any)?.response?.data?.message || 'Failed to load employee workspace.'} onRetry={() => void workspaceQuery.refetch()} />;

  const currentEmployeeLabel = `${data.employee.name} (${data.employee.email})`;
  const templates = templatesQuery.data?.templates || [];
  const employees = templatesQuery.data?.employees || [];
  const defaultBank = data.bank_accounts.find((item) => item.is_default) || data.bank_accounts[0];

  const grid = (items: Array<{ label: string; value?: string | number | null }>) => (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => <div key={item.label} className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3"><p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">{item.label}</p><p className="mt-2 text-sm font-medium text-slate-950">{item.value || 'Not added yet'}</p></div>)}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="sticky top-20 z-20 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm ">
        <Button variant="secondary" onClick={() => navigate('/employees')}>
          <ArrowLeft className="h-4 w-4" />
          Back to Employees
        </Button>
      </div>
      <PageHeader eyebrow="Employee workspace" title={data.employee.name} description="Connected employee master built on the current users, payroll, attendance, leave, payslip, and audit systems." />
      {feedback ? <FeedbackBanner tone={feedback.tone} message={feedback.message} /> : null}
      <EmployeeWorkspaceTabs tabs={tabs.map((item) => ({ id: item, label: labelize(item) }))} activeTab={tab} onChange={(next) => setSearchParams({ tab: next })} />

      {tab === 'overview' ? <><div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.15fr_0.85fr]"><SurfaceCard className="p-6"><div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between"><div className="flex items-center gap-4"><div className="flex h-20 w-20 items-center justify-center rounded-lg bg-[linear-gradient(135deg,#e0f2fe_0%,#dbeafe_100%)] text-2xl font-semibold text-sky-800">{initials}</div><div><p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Employee Master</p><h1 className="mt-1 text-2xl font-semibold tracking-[-0.04em] text-slate-950">{data.employee.name}</h1><p className="mt-1 text-sm text-slate-500">{data.employee.email}</p><div className="mt-3 flex flex-wrap gap-2"><StatusBadge tone={data.readiness.payroll_readiness.is_ready ? 'success' : 'warning'}>{data.readiness.payroll_readiness.is_ready ? 'Payroll Ready' : 'Needs Setup'}</StatusBadge><StatusBadge tone={data.readiness.payout_readiness.is_ready ? 'success' : 'warning'}>{data.readiness.payout_readiness.is_ready ? 'Payout Ready' : 'Payout Incomplete'}</StatusBadge></div></div></div><div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => setSearchParams({ tab: 'about' })}>Edit employee</Button><Link to="/payroll/payslips"><Button variant="secondary">View payslips</Button></Link><Button variant="secondary" onClick={() => setSearchParams({ tab: 'documents' })}>Upload document</Button></div></div><div className="mt-5">{grid([{ label: 'Employee Code', value: data.work_info?.employee_code }, { label: 'Department', value: data.overview.department }, { label: 'Designation', value: data.overview.designation }, { label: 'Reporting Manager', value: data.overview.reporting_manager?.name }, { label: 'Employment Type', value: data.work_info?.employment_type }, { label: 'Joining Date', value: data.work_info?.joining_date }, { label: 'Work Location', value: data.work_info?.work_location }, { label: 'Payroll Eligibility', value: data.payroll.profile?.payroll_eligible ? 'Eligible' : 'Pending' }])}</div></SurfaceCard><EmployeeSectionCard title="Profile Readiness" description="Completeness and readiness checks for payroll and payouts."><div className="rounded-lg border border-slate-200 bg-slate-50 p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold text-slate-950">Overall completeness</p><p className="text-sm text-slate-500">Useful before pay run generation.</p></div><p className="text-3xl font-semibold tracking-[-0.05em] text-slate-950">{data.readiness.overall_percentage}%</p></div><div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-[linear-gradient(90deg,#38bdf8_0%,#0f172a_100%)]" style={{ width: `${data.readiness.overall_percentage}%` }} /></div><div className="mt-4 flex flex-wrap gap-2">{Object.entries(data.readiness.sections).map(([key, value]) => <StatusBadge key={key} tone={value ? 'success' : 'warning'}>{labelize(key)}</StatusBadge>)}</div></div></EmployeeSectionCard></div><div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6"><EmployeeStatCard label="Attendance This Month" value={data.attendance.present_days || 0} /><EmployeeStatCard label="Payable Days" value={data.attendance.payable_days || 0} /><EmployeeStatCard label="Salary Template" value={data.overview.salary_template || 'Not assigned'} /><EmployeeStatCard label="Pending Reimbursements" value={data.overview.pending_reimbursements || 0} /><EmployeeStatCard label="Documents Uploaded" value={data.overview.documents_uploaded || 0} /><EmployeeStatCard label="Leave Summary" value={data.leave.approved_count || 0} /></div></> : null}

      {tab === 'about' ? <EmployeeSectionCard title="About" description="Personal information and emergency contacts.">{grid([{ label: 'First Name', value: data.about?.first_name }, { label: 'Last Name', value: data.about?.last_name }, { label: 'Display Name', value: data.about?.display_name }, { label: 'Gender', value: data.about?.gender }, { label: 'Date of Birth', value: data.about?.date_of_birth }, { label: 'Phone', value: data.about?.phone }, { label: 'Personal Email', value: data.about?.personal_email }, { label: 'Address', value: data.about?.address_line }, { label: 'City', value: data.about?.city }, { label: 'State', value: data.about?.state }, { label: 'Postal Code', value: data.about?.postal_code }, { label: 'Emergency Contact', value: data.about?.emergency_contact_name }, { label: 'Emergency Number', value: data.about?.emergency_contact_number }, { label: 'Relationship', value: data.about?.emergency_contact_relationship }])}<div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">{Object.keys(aboutForm).map((key) => <div key={key}><FieldLabel>{labelize(key)}</FieldLabel><TextInput type={key.includes('date') ? 'date' : key.includes('email') ? 'email' : 'text'} value={aboutForm[key] || ''} onChange={(event) => setAboutForm((current) => ({ ...current, [key]: event.target.value }))} /></div>)}</div><div className="mt-6"><Button onClick={() => saveAbout.mutate()} disabled={saveAbout.isPending}>Save Personal Info</Button></div></EmployeeSectionCard> : null}

      {tab === 'work' ? <EmployeeSectionCard title="Work Info" description="Department, reporting, attendance policy, and employment status."><div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"><div><FieldLabel>Employee Code</FieldLabel><TextInput value={workForm.employee_code || ''} onChange={(event) => setWorkForm((current) => ({ ...current, employee_code: event.target.value }))} /></div><div><FieldLabel>Department</FieldLabel><SelectInput value={workForm.report_group_id || ''} onChange={(event) => setWorkForm((current) => ({ ...current, report_group_id: event.target.value ? Number(event.target.value) : '' }))}><option value="">Select department</option>{data.options.departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</SelectInput></div><div><FieldLabel>Designation</FieldLabel><TextInput value={workForm.designation || ''} onChange={(event) => setWorkForm((current) => ({ ...current, designation: event.target.value }))} /></div><div><FieldLabel>Reporting Manager</FieldLabel><SelectInput value={workForm.reporting_manager_id || ''} onChange={(event) => setWorkForm((current) => ({ ...current, reporting_manager_id: event.target.value ? Number(event.target.value) : '' }))}><option value="">Select manager</option>{data.options.managers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</SelectInput></div><div><FieldLabel>Work Location</FieldLabel><TextInput value={workForm.work_location || ''} onChange={(event) => setWorkForm((current) => ({ ...current, work_location: event.target.value }))} /></div><div><FieldLabel>Shift</FieldLabel><TextInput value={workForm.shift_name || ''} onChange={(event) => setWorkForm((current) => ({ ...current, shift_name: event.target.value }))} /></div><div><FieldLabel>Attendance Policy</FieldLabel><TextInput value={workForm.attendance_policy || ''} onChange={(event) => setWorkForm((current) => ({ ...current, attendance_policy: event.target.value }))} /></div><div><FieldLabel>Employment Type</FieldLabel><TextInput value={workForm.employment_type || ''} onChange={(event) => setWorkForm((current) => ({ ...current, employment_type: event.target.value }))} /></div><div><FieldLabel>Joining Date</FieldLabel><TextInput type="date" value={workForm.joining_date || ''} onChange={(event) => setWorkForm((current) => ({ ...current, joining_date: event.target.value }))} /></div><div><FieldLabel>Probation Status</FieldLabel><TextInput value={workForm.probation_status || ''} onChange={(event) => setWorkForm((current) => ({ ...current, probation_status: event.target.value }))} /></div><div><FieldLabel>Status</FieldLabel><SelectInput value={workForm.employment_status || 'active'} onChange={(event) => setWorkForm((current) => ({ ...current, employment_status: event.target.value }))}><option value="active">Active</option><option value="inactive">Inactive</option><option value="notice">Notice</option><option value="exited">Exited</option></SelectInput></div><div><FieldLabel>Exit Date</FieldLabel><TextInput type="date" value={workForm.exit_date || ''} onChange={(event) => setWorkForm((current) => ({ ...current, exit_date: event.target.value }))} /></div><div><FieldLabel>Work Mode</FieldLabel><SelectInput value={workForm.work_mode || ''} onChange={(event) => setWorkForm((current) => ({ ...current, work_mode: event.target.value }))}><option value="">Select mode</option><option value="office">Office</option><option value="remote">Remote</option><option value="hybrid">Hybrid</option></SelectInput></div></div><div className="mt-6"><Button onClick={() => saveWork.mutate()} disabled={saveWork.isPending}>Save Work Info</Button></div></EmployeeSectionCard> : null}

      {tab === 'payroll' ? <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.1fr_0.9fr]"><EmployeeSectionCard title="Payroll Profile" description="Uses the same payroll profile source of truth as the payroll workspace."><PayrollProfileForm employees={employees} templates={templates} profile={data.payroll.profile} lockedUserId={id} lockedUserLabel={currentEmployeeLabel} onSave={(form) => savePayroll.mutate(form)} isSaving={savePayroll.isPending} saveLabel={data.payroll.profile ? 'Update Payroll Profile' : 'Create Payroll Profile'} /></EmployeeSectionCard><EmployeeSectionCard title="Payroll Readiness" description="Current setup, bank summary, and salary revision history."><div className="space-y-3"><div className="rounded-lg border border-slate-200 bg-slate-50 p-4"><p className="text-sm font-semibold text-slate-950">Assigned template</p><p className="mt-1 text-sm text-slate-500">{data.overview.salary_template || 'No template assigned yet'}</p></div><div className="rounded-lg border border-slate-200 bg-slate-50 p-4"><p className="text-sm font-semibold text-slate-950">Default bank summary</p><p className="mt-1 text-sm text-slate-500">{defaultBank?.bank_name || 'No bank configured'}{defaultBank?.account_number ? ` • ${defaultBank.account_number}` : ''}</p></div><div className="rounded-lg border border-slate-200 bg-slate-50 p-4"><p className="text-sm font-semibold text-slate-950">Default bonus / tax</p><p className="mt-1 text-sm text-slate-500">{formatPayrollCurrency(data.payroll.profile?.bonus_amount || 0)} / {formatPayrollCurrency(data.payroll.profile?.tax_amount || 0)}</p></div>{data.payroll.warnings.length ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{data.payroll.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div> : <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">Payroll profile is currently ready for processing.</div>}{data.payroll.salary_assignments.map((item) => <div key={item.id} className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3"><div className="flex items-center justify-between gap-3"><p className="font-medium text-slate-950">{item.salary_template?.name || 'Template removed'}</p><StatusBadge tone={item.is_active ? 'success' : 'neutral'}>{item.is_active ? 'active' : 'historical'}</StatusBadge></div><p className="mt-1 text-sm text-slate-500">Effective from {item.effective_from}{item.effective_to ? ` to ${item.effective_to}` : ''}</p></div>)}</div></EmployeeSectionCard></div> : null}

      {tab === 'government' ? <EmployeeSectionCard title="Government IDs" description="Compliance IDs with proof support and verification status."><div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"><div><FieldLabel>ID Type</FieldLabel><TextInput value={govForm.id_type || ''} onChange={(event) => setGovForm((current) => ({ ...current, id_type: event.target.value }))} /></div><div><FieldLabel>ID Number</FieldLabel><TextInput value={govForm.id_number || ''} onChange={(event) => setGovForm((current) => ({ ...current, id_number: event.target.value }))} /></div><div><FieldLabel>Status</FieldLabel><SelectInput value={govForm.status || 'pending'} onChange={(event) => setGovForm((current) => ({ ...current, status: event.target.value }))}><option value="pending">Pending</option><option value="verified">Verified</option><option value="rejected">Rejected</option></SelectInput></div><div><FieldLabel>Issue Date</FieldLabel><TextInput type="date" value={govForm.issue_date || ''} onChange={(event) => setGovForm((current) => ({ ...current, issue_date: event.target.value }))} /></div><div><FieldLabel>Expiry Date</FieldLabel><TextInput type="date" value={govForm.expiry_date || ''} onChange={(event) => setGovForm((current) => ({ ...current, expiry_date: event.target.value }))} /></div><div><FieldLabel>Proof File</FieldLabel><input type="file" className="block min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" onChange={(event) => setGovForm((current) => ({ ...current, proof_file: event.target.files?.[0] || null }))} /></div></div><div className="mt-5"><Button onClick={() => saveGov.mutate()} disabled={saveGov.isPending || !govForm.id_type || !govForm.id_number}>Save ID</Button></div><div className="mt-5 space-y-3">{data.government_ids.map((item) => <div key={item.id} className="rounded-lg border border-slate-200 bg-slate-50 p-4"><div className="flex items-center justify-between gap-3"><div><p className="font-medium text-slate-950">{item.id_type}</p><p className="text-sm text-slate-500">{item.id_number}</p></div><StatusBadge tone={payrollStatusTone(item.status)}>{item.status}</StatusBadge></div><p className="mt-2 text-sm text-slate-500">{item.document ? `Proof: ${item.document.title}` : 'No proof attached yet.'}</p></div>)}</div></EmployeeSectionCard> : null}

      {tab === 'bank' ? (
        <EmployeeSectionCard title="Bank Details" description="Payout bank details, alternative payment channels, and verification.">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[
              ['account_holder_name', 'Account Holder'],
              ['bank_name', 'Bank Name'],
              ['account_number', 'Account Number'],
              ['ifsc_swift', 'IFSC / SWIFT'],
              ['branch', 'Branch'],
              ['account_type', 'Account Type'],
              ['upi_id', 'UPI'],
              ['payment_email', 'Payment Email'],
            ].map(([key, label]) => (
              <div key={key}>
                <FieldLabel>{label}</FieldLabel>
                <TextInput
                  type={key.includes('email') ? 'email' : 'text'}
                  value={bankForm[key] || ''}
                  onChange={(event) => setBankForm((current) => ({ ...current, [key]: event.target.value }))}
                />
              </div>
            ))}

            <div>
              <FieldLabel>Payout Method</FieldLabel>
              <SelectInput value={bankForm.payout_method || 'bank_transfer'} onChange={(event) => setBankForm((current) => ({ ...current, payout_method: event.target.value }))}>
                <option value="bank_transfer">Bank transfer</option>
                <option value="stripe">Stripe</option>
                <option value="upi">UPI</option>
              </SelectInput>
            </div>

            <div>
              <FieldLabel>Verification</FieldLabel>
              <SelectInput value={bankForm.verification_status || 'unverified'} onChange={(event) => setBankForm((current) => ({ ...current, verification_status: event.target.value }))}>
                <option value="unverified">Unverified</option>
                <option value="pending">Pending</option>
                <option value="verified">Verified</option>
                <option value="rejected">Rejected</option>
              </SelectInput>
            </div>

            <div>
              <FieldLabel>Proof File</FieldLabel>
              <input
                type="file"
                className="block min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                onChange={(event) => setBankForm((current) => ({ ...current, proof_file: event.target.files?.[0] || null }))}
              />
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-slate-900">Default payout account</p>
                <p className="text-sm text-slate-500">This account will be treated as the employee's primary payroll payout destination.</p>
              </div>
              <ToggleInput checked={Boolean(bankForm.is_default)} onChange={(checked) => setBankForm((current) => ({ ...current, is_default: checked }))} />
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <Button onClick={() => saveBank.mutate()} disabled={saveBank.isPending}>
              Save Bank Details
            </Button>
            <Button variant="secondary" onClick={() => setBankForm(createEmptyBankForm())}>
              New Bank Entry
            </Button>
          </div>

          <div className="mt-5 space-y-3">
            {data.bank_accounts.map((item) => (
              <button
                key={item.id}
                type="button"
                className="w-full rounded-lg border border-slate-200 bg-slate-50 p-4 text-left transition hover:bg-white"
                onClick={() => setBankForm({
                  id: item.id,
                  account_holder_name: item.account_holder_name || '',
                  bank_name: item.bank_name || '',
                  account_number: item.account_number || '',
                  ifsc_swift: item.ifsc_swift || '',
                  branch: item.branch || '',
                  account_type: item.account_type || '',
                  upi_id: item.upi_id || '',
                  payment_email: item.payment_email || '',
                  payout_method: item.payout_method || 'bank_transfer',
                  verification_status: item.verification_status || 'unverified',
                  is_default: Boolean(item.is_default),
                })}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-slate-950">{item.bank_name || 'Bank not specified'}</p>
                    <p className="text-sm text-slate-500">{item.account_holder_name || 'No holder'}{item.account_number ? ` • ${item.account_number}` : ''}</p>
                  </div>
                  <div className="flex gap-2">
                    {item.is_default ? <StatusBadge tone="info">Default</StatusBadge> : null}
                    <StatusBadge tone={payrollStatusTone(item.verification_status)}>{item.verification_status}</StatusBadge>
                  </div>
                </div>
              </button>
            ))}

            {!data.readiness.payout_readiness.is_ready ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                {data.readiness.payout_readiness.warnings.join(', ')}
              </div>
            ) : (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                Default payout account is configured and payout readiness is complete.
              </div>
            )}
          </div>
        </EmployeeSectionCard>
      ) : null}

      {tab === 'documents' ? <EmployeeSectionCard title="Documents" description="Document manager using the current app storage approach."><div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4"><div><FieldLabel>Title</FieldLabel><TextInput value={docForm.title || ''} onChange={(event) => setDocForm((current) => ({ ...current, title: event.target.value }))} /></div><div><FieldLabel>Category</FieldLabel><TextInput value={docForm.category || ''} onChange={(event) => setDocForm((current) => ({ ...current, category: event.target.value }))} /></div><div><FieldLabel>Review Status</FieldLabel><SelectInput value={docForm.review_status || 'pending'} onChange={(event) => setDocForm((current) => ({ ...current, review_status: event.target.value }))}><option value="pending">Pending</option><option value="verified">Verified</option><option value="rejected">Rejected</option></SelectInput></div><div><FieldLabel>File</FieldLabel><input type="file" className="block min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" onChange={(event) => setDocForm((current) => ({ ...current, file: event.target.files?.[0] || null }))} /></div></div><div className="mt-5"><Button onClick={() => saveDoc.mutate()} disabled={saveDoc.isPending || !docForm.title || !docForm.file}>Upload Document</Button></div><div className="mt-5 space-y-3">{data.documents.map((item) => <div key={item.id} className="rounded-lg border border-slate-200 bg-slate-50 p-4"><div className="flex items-center justify-between gap-3"><div><p className="font-medium text-slate-950">{item.title}</p><p className="text-sm text-slate-500">{item.category} • {item.file_name}</p></div><StatusBadge tone={payrollStatusTone(item.review_status)}>{item.review_status}</StatusBadge></div><div className="mt-3 flex flex-wrap gap-3 text-sm text-slate-500"><span>Uploaded: {item.uploaded_at ? new Date(item.uploaded_at).toLocaleString() : 'n/a'}</span><span>By: {item.uploader?.name || 'System'}</span><button type="button" className="inline-flex items-center gap-1 font-semibold text-sky-700" onClick={async () => { const response = await employeeWorkspaceApi.downloadDocument(id, item.id); const url = window.URL.createObjectURL(new Blob([response.data])); const link = document.createElement('a'); link.href = url; link.download = item.file_name; document.body.appendChild(link); link.click(); link.remove(); window.URL.revokeObjectURL(url); }}><Download className="h-4 w-4" />Download</button></div></div>)}</div></EmployeeSectionCard> : null}

      {tab === 'attendance' ? <EmployeeSectionCard title="Attendance" description="Employee-specific attendance summary reused from the current attendance and payroll attendance logic."><div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6"><EmployeeStatCard label="Present Days" value={data.attendance.present_days || 0} /><EmployeeStatCard label="Absent Days" value={data.attendance.absent_days || 0} /><EmployeeStatCard label="Leave Days" value={data.attendance.approved_leave_days || 0} /><EmployeeStatCard label="Payable Days" value={data.attendance.payable_days || 0} /><EmployeeStatCard label="Overtime" value={formatPayrollDuration(data.attendance.overtime_seconds || 0)} /><EmployeeStatCard label="Late Days" value={data.attendance.late_days || 0} /></div></EmployeeSectionCard> : null}

      {tab === 'leave' ? <EmployeeSectionCard title="Leave" description="Leave summary connected to the existing leave request system."><div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4"><EmployeeStatCard label="Approved Leave" value={data.leave.approved_count || 0} /><EmployeeStatCard label="Pending Requests" value={data.leave.pending_count || 0} /><EmployeeStatCard label="Rejected Requests" value={data.leave.rejected_count || 0} /><EmployeeStatCard label="Payroll Impact" value={data.leave.payroll_impact_days || 0} /></div><div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">{data.leave.balance_note}</div></EmployeeSectionCard> : null}

      {tab === 'activity' ? <EmployeeSectionCard title="Activity / Audit" description="Employee actions aggregated from employee updates, payroll audit, and user audit logs."><div className="space-y-3">{data.activity.map((item) => <div key={item.id} className="rounded-lg border border-slate-200 bg-slate-50 p-4"><div className="flex items-center justify-between gap-3"><p className="font-medium text-slate-950">{labelize(item.action)}</p><p className="text-xs text-slate-500">{new Date(item.created_at).toLocaleString()}</p></div><p className="mt-2 text-sm text-slate-600">{item.description}</p>{item.actor ? <p className="mt-1 text-xs text-slate-500">By {item.actor.name}</p> : null}</div>)}</div></EmployeeSectionCard> : null}
    </div>
  );
}
