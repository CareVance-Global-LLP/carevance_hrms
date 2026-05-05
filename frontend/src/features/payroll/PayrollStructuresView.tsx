import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import PageHeader from '@/components/dashboard/PageHeader';
import MetricCard from '@/components/dashboard/MetricCard';
import FilterPanel from '@/components/dashboard/FilterPanel';
import DataTable from '@/components/dashboard/DataTable';
import EmptyStateCard from '@/components/dashboard/EmptyStateCard';
import Button from '@/components/ui/Button';
import EmployeeSelect from '@/components/ui/EmployeeSelect';
import { FieldLabel, SelectInput, TextInput, ToggleInput } from '@/components/ui/FormField';
import { FeedbackBanner, PageErrorState, PageLoadingState } from '@/components/ui/PageState';
import { LayoutTemplate, Shuffle, Users, Wallet } from 'lucide-react';
import { payrollApi, payrollWorkspaceApi } from '@/services/api';
import type { PayrollComponent, PayrollProfile, PayrollStructure, SalaryTemplate } from '@/types';
import PayrollSectionCard from '@/features/payroll/components/PayrollSectionCard';
import PayrollStatusBadge from '@/features/payroll/components/PayrollStatusBadge';
import {
  calculateTemplatePreview,
  formatPayrollCurrency,
  formatPayrollMonth,
  salaryComponentCategoryLabel,
  salaryComponentValueTypeLabel,
  sortTemplateComponents,
} from '@/features/payroll/utils';

type TemplateRow = {
  salary_component_id: number;
  value_type: 'fixed' | 'percentage';
  value: number;
  sort_order: number;
  is_enabled: boolean;
};

type LegacyStructureForm = {
  user_id: number | '';
  basic_salary: number;
  currency: 'INR' | 'USD';
  effective_from: string;
  allowances: PayrollComponent[];
  deductions: PayrollComponent[];
};

const emptyTemplateForm = {
  name: '',
  description: '',
  currency: 'INR',
  is_active: true,
  rows: [] as TemplateRow[],
};

const createEmptyLegacyForm = (): LegacyStructureForm => ({
  user_id: '',
  basic_salary: 0,
  currency: 'INR',
  effective_from: new Date().toISOString().slice(0, 10),
  allowances: [],
  deductions: [],
});

const createLegacyRow = (): PayrollComponent => ({
  name: '',
  calculation_type: 'fixed',
  amount: 0,
});

export default function PayrollStructuresView() {
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [templateForm, setTemplateForm] = useState(emptyTemplateForm);
  const [selectedLegacyId, setSelectedLegacyId] = useState<number | null>(null);
  const [legacyForm, setLegacyForm] = useState<LegacyStructureForm>(createEmptyLegacyForm);
  const [assignmentTemplateId, setAssignmentTemplateId] = useState<number | ''>('');
  const [assignmentEmployeeId, setAssignmentEmployeeId] = useState<number | ''>('');
  const [assignmentEffectiveFrom, setAssignmentEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
  const [legacyEmployeeFilter, setLegacyEmployeeFilter] = useState<number | ''>('');
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const workspaceQuery = useQuery({
    queryKey: ['payroll-structures'],
    queryFn: async () => {
      const [templatesResponse, profilesResponse, structuresResponse] = await Promise.all([
        payrollWorkspaceApi.getTemplates(),
        payrollWorkspaceApi.getProfiles(),
        payrollApi.getStructures(),
      ]);

      return {
        components: templatesResponse.data.components,
        templates: templatesResponse.data.data,
        employees: profilesResponse.data.employees,
        profiles: profilesResponse.data.profiles,
        structures: structuresResponse.data.structures,
      };
    },
  });

  const components = workspaceQuery.data?.components || [];
  const templates = workspaceQuery.data?.templates || [];
  const employees = workspaceQuery.data?.employees || [];
  const profiles = workspaceQuery.data?.profiles || [];
  const structures = workspaceQuery.data?.structures || [];
  const profileByUserId = useMemo(() => new Map<number, PayrollProfile>(profiles.map((profile) => [profile.user_id, profile])), [profiles]);

  const templatePreview = useMemo(() => calculateTemplatePreview(
    templateForm.rows.map((row) => ({
      ...row,
      component: components.find((component) => component.id === row.salary_component_id),
    }))
  ), [components, templateForm.rows]);

  const templateCards = useMemo(
    () => templates.map((template) => {
      const preview = calculateTemplatePreview(template.components.map((row) => ({ ...row, component: row.component })));
      const assignmentCount = Number(template.assignments_count ?? profiles.filter((profile) => profile.salary_template_id === template.id).length);
      const status = !template.is_active ? 'inactive' : template.components.length === 0 ? 'draft' : 'active';
      return {
        template,
        preview,
        assignmentCount,
        effectiveFrom: template.assignments_max_effective_from || null,
        status,
      };
    }),
    [profiles, templates]
  );

  const assignmentRows = useMemo(
    () => profiles
      .filter((profile) => profile.salary_template_id && (!selectedTemplateId || profile.salary_template_id === selectedTemplateId))
      .sort((left, right) => String(left.user?.name || '').localeCompare(String(right.user?.name || ''))),
    [profiles, selectedTemplateId]
  );

  const filteredStructures = useMemo(
    () => structures.filter((structure) => !legacyEmployeeFilter || structure.user_id === legacyEmployeeFilter),
    [legacyEmployeeFilter, structures]
  );

  const loadTemplate = (template: SalaryTemplate) => {
    setSelectedTemplateId(template.id);
    setTemplateForm({
      name: template.name,
      description: template.description || '',
      currency: template.currency || 'INR',
      is_active: template.is_active,
      rows: sortTemplateComponents(template.components).map((row) => ({
        salary_component_id: row.salary_component_id,
        value_type: row.value_type,
        value: Number(row.value || 0),
        sort_order: Number(row.sort_order || 0),
        is_enabled: Boolean(row.is_enabled),
      })),
    });
  };

  const loadStructure = (structure: PayrollStructure) => {
    setSelectedLegacyId(structure.id);
    setLegacyForm({
      user_id: structure.user_id,
      basic_salary: Number(structure.basic_salary || 0),
      currency: structure.currency as 'INR' | 'USD',
      effective_from: structure.effective_from,
      allowances: structure.allowances?.map((item) => ({ ...item, amount: Number(item.amount || item.value || 0) })) || [],
      deductions: structure.deductions?.map((item) => ({ ...item, amount: Number(item.amount || item.value || 0) })) || [],
    });
  };

  const resetTemplate = () => {
    setSelectedTemplateId(null);
    setTemplateForm(emptyTemplateForm);
  };

  const resetStructure = () => {
    setSelectedLegacyId(null);
    setLegacyForm(createEmptyLegacyForm());
  };

  const toggleTemplateRow = (componentId: number) => {
    const component = components.find((item) => item.id === componentId);
    const exists = templateForm.rows.find((item) => item.salary_component_id === componentId);
    if (exists) {
      setTemplateForm((current) => ({
        ...current,
        rows: current.rows.filter((item) => item.salary_component_id !== componentId),
      }));
      return;
    }

    setTemplateForm((current) => ({
      ...current,
      rows: [
        ...current.rows,
        {
          salary_component_id: componentId,
          value_type: component?.value_type || 'fixed',
          value: Number(component?.default_value || 0),
          sort_order: current.rows.length + 1,
          is_enabled: true,
        },
      ],
    }));
  };

  const saveTemplate = async () => {
    setFeedback(null);
    setIsSaving(true);
    try {
      const payload = {
        name: templateForm.name,
        description: templateForm.description || undefined,
        currency: templateForm.currency,
        is_active: templateForm.is_active,
        components: templateForm.rows.map((row, index) => ({
          ...row,
          sort_order: Number(row.sort_order || index + 1),
        })),
      };

      if (selectedTemplateId) {
        await payrollWorkspaceApi.updateTemplate(selectedTemplateId, payload);
      } else {
        await payrollWorkspaceApi.createTemplate(payload);
      }

      setFeedback({ tone: 'success', message: selectedTemplateId ? 'Salary template updated.' : 'Salary template created.' });
      resetTemplate();
      await workspaceQuery.refetch();
    } catch (error: any) {
      setFeedback({ tone: 'error', message: error?.response?.data?.message || 'Failed to save salary template.' });
    } finally {
      setIsSaving(false);
    }
  };

  const deleteTemplate = async () => {
    if (!selectedTemplateId) return;
    setFeedback(null);
    setIsSaving(true);
    try {
      await payrollWorkspaceApi.deleteTemplate(selectedTemplateId);
      setFeedback({ tone: 'success', message: 'Salary template deleted.' });
      resetTemplate();
      await workspaceQuery.refetch();
    } catch (error: any) {
      setFeedback({ tone: 'error', message: error?.response?.data?.message || 'Failed to delete salary template.' });
    } finally {
      setIsSaving(false);
    }
  };

  const assignTemplate = async () => {
    if (!assignmentTemplateId || !assignmentEmployeeId) return;
    setFeedback(null);
    setIsSaving(true);
    try {
      const existing = profileByUserId.get(Number(assignmentEmployeeId));
      const payload = existing
        ? {
            user_id: existing.user_id,
            salary_template_id: Number(assignmentTemplateId),
            currency: existing.currency,
            payout_method: existing.payout_method,
            bank_name: existing.bank_name || undefined,
            bank_account_number: existing.bank_account_number || undefined,
            bank_ifsc_swift: existing.bank_ifsc_swift || undefined,
            payment_email: existing.payment_email || undefined,
            tax_identifier: existing.tax_identifier || undefined,
            payroll_eligible: existing.payroll_eligible,
            reimbursements_eligible: existing.reimbursements_eligible,
            is_active: existing.is_active,
            bonus_amount: Number(existing.bonus_amount || 0),
            tax_amount: Number(existing.tax_amount || 0),
            template_effective_from: assignmentEffectiveFrom,
          }
        : {
            user_id: Number(assignmentEmployeeId),
            salary_template_id: Number(assignmentTemplateId),
            currency: 'INR',
            payout_method: 'mock',
            payroll_eligible: true,
            reimbursements_eligible: true,
            is_active: true,
            bonus_amount: 0,
            tax_amount: 0,
            template_effective_from: assignmentEffectiveFrom,
          };

      if (existing) {
        await payrollWorkspaceApi.updateProfile(existing.id, payload);
      } else {
        await payrollWorkspaceApi.createProfile(payload);
      }

      setFeedback({ tone: 'success', message: 'Template assigned to employee.' });
      await workspaceQuery.refetch();
    } catch (error: any) {
      setFeedback({ tone: 'error', message: error?.response?.data?.message || 'Failed to assign template.' });
    } finally {
      setIsSaving(false);
    }
  };

  const updateStructureRow = (bucket: 'allowances' | 'deductions', index: number, field: keyof PayrollComponent, value: string | number) => {
    setLegacyForm((current) => ({
      ...current,
      [bucket]: current[bucket].map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item),
    }));
  };

  const saveStructure = async () => {
    setFeedback(null);
    setIsSaving(true);
    try {
      const payload = {
        user_id: Number(legacyForm.user_id),
        basic_salary: Number(legacyForm.basic_salary || 0),
        currency: legacyForm.currency,
        effective_from: legacyForm.effective_from,
        allowances: legacyForm.allowances.filter((item) => item.name?.trim()).map((item) => ({
          name: item.name,
          calculation_type: item.calculation_type,
          amount: Number(item.amount || item.value || 0),
        })),
        deductions: legacyForm.deductions.filter((item) => item.name?.trim()).map((item) => ({
          name: item.name,
          calculation_type: item.calculation_type,
          amount: Number(item.amount || item.value || 0),
        })),
      };

      if (selectedLegacyId) {
        await payrollApi.updateStructure(selectedLegacyId, payload);
      } else {
        await payrollApi.saveStructure(payload);
      }

      setFeedback({ tone: 'success', message: selectedLegacyId ? 'Legacy structure updated.' : 'Legacy structure created.' });
      resetStructure();
      await workspaceQuery.refetch();
    } catch (error: any) {
      setFeedback({ tone: 'error', message: error?.response?.data?.message || 'Failed to save legacy structure.' });
    } finally {
      setIsSaving(false);
    }
  };

  const deleteStructure = async () => {
    if (!selectedLegacyId) return;
    setFeedback(null);
    setIsSaving(true);
    try {
      await payrollApi.deleteStructure(selectedLegacyId);
      setFeedback({ tone: 'success', message: 'Legacy structure deleted.' });
      resetStructure();
      await workspaceQuery.refetch();
    } catch (error: any) {
      setFeedback({ tone: 'error', message: error?.response?.data?.message || 'Failed to delete legacy structure.' });
    } finally {
      setIsSaving(false);
    }
  };

  if (workspaceQuery.isLoading) {
    return <PageLoadingState label="Loading salary structures..." />;
  }

  if (workspaceQuery.isError) {
    return <PageErrorState message={(workspaceQuery.error as any)?.response?.data?.message || 'Failed to load salary structures.'} onRetry={() => void workspaceQuery.refetch()} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Payroll setup"
        title="Salary Structures"
        description="Build salary templates, inspect breakup intelligence, assign them with effective dates, and keep legacy structures available only where compatibility still matters."
      />

      {feedback ? <FeedbackBanner tone={feedback.tone} message={feedback.message} /> : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Templates" value={templates.length} hint="Primary structure system for payroll." icon={LayoutTemplate} accent="sky" />
        <MetricCard label="Active Templates" value={templates.filter((template) => template.is_active).length} hint="Ready for new assignments." icon={Shuffle} accent="emerald" />
        <MetricCard label="Template Assignments" value={profiles.filter((profile) => profile.salary_template_id).length} hint="Employee payroll profiles linked to templates." icon={Users} accent="violet" />
        <MetricCard label="Legacy Structures" value={structures.length} hint="Compatibility records still supported by the backend." icon={Wallet} accent="amber" />
      </div>

      <PayrollSectionCard title="Template Library" description="Reusable salary templates with breakup intelligence, assignment visibility, and effective-date activity.">
        {templateCards.length === 0 ? (
          <EmptyStateCard title="No salary templates yet" description="Create a template to shift salary setup away from direct payroll record editing." icon={LayoutTemplate} />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {templateCards.map(({ template, preview, assignmentCount, effectiveFrom, status }) => (
              <button
                key={template.id}
                type="button"
                onClick={() => loadTemplate(template)}
                className={`rounded-[24px] border px-4 py-4 text-left transition ${selectedTemplateId === template.id ? 'border-sky-300 bg-sky-50/70' : 'border-slate-200/80 bg-slate-50/70 hover:bg-white'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-slate-950">{template.name}</p>
                    <p className="mt-1 text-sm text-slate-500">{template.description || 'No description provided.'}</p>
                  </div>
                  <PayrollStatusBadge status={status} />
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-slate-500">Gross estimate</p>
                    <p className="font-semibold text-slate-950">{formatPayrollCurrency(preview.basic_salary + preview.allowances + preview.bonus, template.currency)}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Net estimate</p>
                    <p className="font-semibold text-slate-950">{formatPayrollCurrency(preview.net_salary, template.currency)}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Components</p>
                    <p className="font-semibold text-slate-950">{template.components.length}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Assignments</p>
                    <p className="font-semibold text-slate-950">{assignmentCount}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-slate-500">Latest effective date</p>
                    <p className="font-semibold text-slate-950">{effectiveFrom ? formatPayrollMonth(effectiveFrom) : 'No active assignment yet'}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </PayrollSectionCard>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.08fr_0.92fr]">
        <DataTable
          title="Assignment Visibility"
          description={selectedTemplateId ? 'Employees currently mapped to the selected template.' : 'Current employee-level template assignments across payroll profiles.'}
          rows={assignmentRows}
          emptyMessage="No employee assignments match the current selection."
          headerAction={<Button variant="secondary" size="sm" onClick={() => setSelectedTemplateId(null)}>Show All</Button>}
          columns={[
            {
              key: 'employee',
              header: 'Employee',
              className: 'min-w-[15rem]',
              render: (profile: PayrollProfile) => (
                <div>
                  <p className="font-medium text-slate-950">{profile.user?.name || `User #${profile.user_id}`}</p>
                  <p className="mt-1 text-sm text-slate-500">{profile.user?.email}</p>
                </div>
              ),
            },
            {
              key: 'template',
              header: 'Template',
              render: (profile: PayrollProfile) => (
                <div>
                  <p className="font-medium text-slate-950">{profile.salary_template?.name || 'Not assigned'}</p>
                  <p className="mt-1 text-sm text-slate-500">{profile.currency} | {profile.payout_method || 'No payout method'}</p>
                </div>
              ),
            },
            {
              key: 'eligibility',
              header: 'Eligibility',
              render: (profile: PayrollProfile) => (
                <div className="flex flex-wrap gap-2">
                  <PayrollStatusBadge status={profile.is_active ? 'active' : 'inactive'} />
                  <PayrollStatusBadge status={profile.payroll_eligible ? 'eligible' : 'ineligible'} />
                </div>
              ),
            },
            {
              key: 'defaults',
              header: 'Defaults',
              render: (profile: PayrollProfile) => (
                <div>
                  <p className="font-medium text-slate-950">{formatPayrollCurrency(Number(profile.bonus_amount || 0), profile.currency)} bonus</p>
                  <p className="mt-1 text-sm text-slate-500">{formatPayrollCurrency(Number(profile.tax_amount || 0), profile.currency)} tax</p>
                </div>
              ),
            },
            {
              key: 'actions',
              header: 'Action',
              render: (profile: PayrollProfile) => (
                <Link to={`/payroll/employees/${profile.user_id}`}>
                  <Button size="sm" variant="secondary">Open Record</Button>
                </Link>
              ),
            },
          ]}
        />

        <PayrollSectionCard title="Assign Template" description="Assign a template to an employee payroll profile with an effective date.">
          <div className="grid grid-cols-1 gap-4">
            <div>
              <FieldLabel>Template</FieldLabel>
              <SelectInput value={assignmentTemplateId} onChange={(event) => setAssignmentTemplateId(event.target.value ? Number(event.target.value) : '')}>
                <option value="">Select template</option>
                {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
              </SelectInput>
            </div>
            <div>
              <FieldLabel>Employee</FieldLabel>
              <SelectInput value={assignmentEmployeeId} onChange={(event) => setAssignmentEmployeeId(event.target.value ? Number(event.target.value) : '')}>
                <option value="">Select employee</option>
                {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
              </SelectInput>
            </div>
            <div>
              <FieldLabel>Effective From</FieldLabel>
              <TextInput type="date" value={assignmentEffectiveFrom} onChange={(event) => setAssignmentEffectiveFrom(event.target.value)} />
            </div>
          </div>
          <div className="mt-4 space-y-3">
            <Button onClick={assignTemplate} disabled={isSaving || !assignmentTemplateId || !assignmentEmployeeId}>Assign Template</Button>
            <p className="text-sm leading-6 text-slate-500">
              Pay groups are still a backend gap, so assignments remain employee-scoped even though the page is structured to support group-level rollout later.
            </p>
          </div>
        </PayrollSectionCard>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.14fr_0.86fr]">
        <PayrollSectionCard
          title={selectedTemplateId ? 'Edit Template Builder' : 'Create Template Builder'}
          description="Compose salary templates from reusable component masters, with ordering and calculation behavior controlled here."
          action={<Button variant="secondary" size="sm" onClick={resetTemplate}>New Template</Button>}
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <FieldLabel>Name</FieldLabel>
              <TextInput value={templateForm.name} onChange={(event) => setTemplateForm((current) => ({ ...current, name: event.target.value }))} />
            </div>
            <div>
              <FieldLabel>Currency</FieldLabel>
              <TextInput value={templateForm.currency} onChange={(event) => setTemplateForm((current) => ({ ...current, currency: event.target.value }))} />
            </div>
            <div className="md:col-span-2">
              <FieldLabel>Description</FieldLabel>
              <TextInput value={templateForm.description} onChange={(event) => setTemplateForm((current) => ({ ...current, description: event.target.value }))} />
            </div>
            <div className="md:col-span-2 rounded-[22px] border border-slate-200/80 bg-slate-50/70 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">Template active</p>
                  <p className="text-sm text-slate-500">Inactive templates stay in history but are not offered for new assignments.</p>
                </div>
                <ToggleInput checked={templateForm.is_active} onChange={(checked) => setTemplateForm((current) => ({ ...current, is_active: checked }))} />
              </div>
            </div>
          </div>

          <div className="mt-5 space-y-3">
            {components.map((component) => {
              const row = templateForm.rows.find((item) => item.salary_component_id === component.id);
              return (
                <div key={component.id} className="grid grid-cols-1 gap-3 rounded-[22px] border border-slate-200/80 bg-slate-50/70 px-4 py-3 md:grid-cols-[1.15fr_0.95fr_0.7fr_0.55fr] md:items-center">
                  <label className="flex items-center gap-3">
                    <input type="checkbox" checked={Boolean(row)} onChange={() => toggleTemplateRow(component.id)} />
                    <span>
                      <span className="block font-medium text-slate-950">{component.name}</span>
                      <span className="text-sm text-slate-500">{salaryComponentCategoryLabel(component.category)}</span>
                    </span>
                  </label>
                  <SelectInput
                    value={row?.value_type || component.value_type}
                    disabled={!row}
                    onChange={(event) => setTemplateForm((current) => ({
                      ...current,
                      rows: current.rows.map((item) => item.salary_component_id === component.id ? { ...item, value_type: event.target.value as 'fixed' | 'percentage' } : item),
                    }))}
                  >
                    <option value="fixed">Fixed amount</option>
                    <option value="percentage">Percentage of basic</option>
                  </SelectInput>
                  <TextInput
                    type="number"
                    min={0}
                    value={Number(row?.value ?? component.default_value ?? 0)}
                    disabled={!row}
                    onChange={(event) => setTemplateForm((current) => ({
                      ...current,
                      rows: current.rows.map((item) => item.salary_component_id === component.id ? { ...item, value: Number(event.target.value || 0) } : item),
                    }))}
                  />
                  <TextInput
                    type="number"
                    min={1}
                    value={Number(row?.sort_order || 0)}
                    disabled={!row}
                    onChange={(event) => setTemplateForm((current) => ({
                      ...current,
                      rows: current.rows.map((item) => item.salary_component_id === component.id ? { ...item, sort_order: Number(event.target.value || 0) } : item),
                    }))}
                  />
                </div>
              );
            })}
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <Button onClick={saveTemplate} disabled={isSaving || !templateForm.name.trim()}>Save Template</Button>
            <Button variant="secondary" onClick={resetTemplate}>Reset</Button>
            {selectedTemplateId ? <Button variant="danger" onClick={deleteTemplate} disabled={isSaving}>Delete</Button> : null}
          </div>
        </PayrollSectionCard>

        <div className="space-y-5">
          <PayrollSectionCard title="Template Preview" description="Live breakup from the current builder configuration.">
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Basic', value: templatePreview.basic_salary },
                { label: 'Allowances', value: templatePreview.allowances },
                { label: 'Bonus', value: templatePreview.bonus },
                { label: 'Deductions', value: templatePreview.deductions },
                { label: 'Tax', value: templatePreview.tax },
                { label: 'Estimated net', value: templatePreview.net_salary },
              ].map((item) => (
                <div key={item.label} className="rounded-[20px] border border-slate-200/80 bg-slate-50/70 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{item.label}</p>
                  <p className="mt-2 text-sm font-semibold text-slate-950">{formatPayrollCurrency(item.value, templateForm.currency)}</p>
                </div>
              ))}
            </div>

            <div className="mt-4 space-y-2">
              {sortTemplateComponents(templateForm.rows)
                .map((row) => ({ ...row, component: components.find((component) => component.id === row.salary_component_id) }))
                .filter((row) => row.component)
                .map((row) => (
                  <div key={row.salary_component_id} className="flex items-center justify-between gap-3 rounded-[18px] border border-slate-200/80 bg-slate-50/70 px-3 py-2 text-sm">
                    <div>
                      <p className="font-medium text-slate-950">{row.component?.name}</p>
                      <p className="text-slate-500">{salaryComponentValueTypeLabel(row.value_type)}</p>
                    </div>
                    <p className="font-semibold text-slate-950">
                      {row.value_type === 'percentage'
                        ? `${Number(row.value || 0)}%`
                        : formatPayrollCurrency(Number(row.value || 0), templateForm.currency)}
                    </p>
                  </div>
                ))}
            </div>
          </PayrollSectionCard>
        </div>
      </div>

      <PayrollSectionCard title="Legacy Structures" description="Compatibility layer for older salary structures that the payroll engine still honors when no template assignment exists.">
        <FilterPanel className="grid grid-cols-1 gap-3 p-0 shadow-none md:grid-cols-[1fr_auto]">
          <div>
            <FieldLabel>Filter by Employee</FieldLabel>
            <EmployeeSelect employees={employees} value={legacyEmployeeFilter} onChange={setLegacyEmployeeFilter} includeAllOption />
          </div>
          <div className="flex items-end">
            <Button variant="secondary" onClick={() => setLegacyEmployeeFilter('')}>Clear</Button>
          </div>
        </FilterPanel>

        <div className="mt-4">
          <DataTable
            title="Legacy Structure Registry"
            description="These records remain supported for migration compatibility and fallback salary resolution."
            rows={filteredStructures}
            emptyMessage="No legacy structures match the current filters."
            columns={[
              {
                key: 'employee',
                header: 'Employee',
                className: 'min-w-[15rem]',
                render: (structure: PayrollStructure) => (
                  <div>
                    <p className="font-medium text-slate-950">{structure.user?.name || `User #${structure.user_id}`}</p>
                    <p className="mt-1 text-sm text-slate-500">Effective from {structure.effective_from}</p>
                  </div>
                ),
              },
              {
                key: 'basic',
                header: 'Basic Salary',
                render: (structure: PayrollStructure) => formatPayrollCurrency(structure.basic_salary, structure.currency),
              },
              {
                key: 'rows',
                header: 'Rows',
                render: (structure: PayrollStructure) => (structure.allowances?.length || 0) + (structure.deductions?.length || 0),
              },
              {
                key: 'status',
                header: 'Status',
                render: (structure: PayrollStructure) => <PayrollStatusBadge status={structure.is_active ? 'active' : 'inactive'} />,
              },
              {
                key: 'action',
                header: 'Action',
                render: (structure: PayrollStructure) => (
                  <Button size="sm" variant="secondary" onClick={() => loadStructure(structure)}>
                    Edit
                  </Button>
                ),
              },
            ]}
          />
        </div>
      </PayrollSectionCard>

      <PayrollSectionCard title={selectedLegacyId ? 'Edit Legacy Structure' : 'Create Legacy Structure'} description="Separate compatibility workflow for older salary structures.">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <FieldLabel>Employee</FieldLabel>
            <SelectInput value={legacyForm.user_id} onChange={(event) => setLegacyForm((current) => ({ ...current, user_id: event.target.value ? Number(event.target.value) : '' }))}>
              <option value="">Select employee</option>
              {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
            </SelectInput>
          </div>
          <div>
            <FieldLabel>Currency</FieldLabel>
            <SelectInput value={legacyForm.currency} onChange={(event) => setLegacyForm((current) => ({ ...current, currency: event.target.value as 'INR' | 'USD' }))}>
              <option value="INR">INR</option>
              <option value="USD">USD</option>
            </SelectInput>
          </div>
          <div>
            <FieldLabel>Basic Salary</FieldLabel>
            <TextInput type="number" min={0} value={Number(legacyForm.basic_salary || 0)} onChange={(event) => setLegacyForm((current) => ({ ...current, basic_salary: Number(event.target.value || 0) }))} />
          </div>
          <div>
            <FieldLabel>Effective From</FieldLabel>
            <TextInput type="date" value={legacyForm.effective_from} onChange={(event) => setLegacyForm((current) => ({ ...current, effective_from: event.target.value }))} />
          </div>
        </div>

        <div className="mt-5 space-y-5">
          {(['allowances', 'deductions'] as const).map((bucket) => (
            <div key={bucket}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-950">{bucket === 'allowances' ? 'Allowances' : 'Deductions'}</p>
                  <p className="text-sm text-slate-500">These rows are sent to the existing legacy structure API.</p>
                </div>
                <Button variant="secondary" size="sm" onClick={() => setLegacyForm((current) => ({ ...current, [bucket]: [...current[bucket], createLegacyRow()] }))}>
                  Add Row
                </Button>
              </div>
              <div className="mt-3 space-y-3">
                {legacyForm[bucket].length === 0 ? (
                  <div className="rounded-[20px] border border-dashed border-slate-300 bg-slate-50/70 px-4 py-3 text-sm text-slate-500">No {bucket} configured.</div>
                ) : legacyForm[bucket].map((item, index) => (
                  <div key={`${bucket}-${index}`} className="grid grid-cols-1 gap-3 rounded-[20px] border border-slate-200/80 bg-slate-50/70 px-4 py-3 md:grid-cols-[1fr_0.8fr_0.8fr_auto]">
                    <TextInput value={item.name} placeholder="Component name" onChange={(event) => updateStructureRow(bucket, index, 'name', event.target.value)} />
                    <SelectInput value={item.calculation_type} onChange={(event) => updateStructureRow(bucket, index, 'calculation_type', event.target.value)}>
                      <option value="fixed">Fixed amount</option>
                      <option value="percentage">Percentage</option>
                    </SelectInput>
                    <TextInput type="number" min={0} value={Number(item.amount || item.value || 0)} onChange={(event) => updateStructureRow(bucket, index, 'amount', Number(event.target.value || 0))} />
                    <Button variant="ghost" onClick={() => setLegacyForm((current) => ({ ...current, [bucket]: current[bucket].filter((_, itemIndex) => itemIndex !== index) }))}>
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <Button onClick={saveStructure} disabled={isSaving || !legacyForm.user_id}>Save Legacy Structure</Button>
          <Button variant="secondary" onClick={resetStructure}>Reset</Button>
          {selectedLegacyId ? <Button variant="danger" onClick={deleteStructure} disabled={isSaving}>Delete</Button> : null}
        </div>
      </PayrollSectionCard>
    </div>
  );
}
