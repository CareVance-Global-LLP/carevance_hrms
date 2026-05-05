import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import PageHeader from '@/components/dashboard/PageHeader';
import MetricCard from '@/components/dashboard/MetricCard';
import FilterPanel from '@/components/dashboard/FilterPanel';
import DataTable from '@/components/dashboard/DataTable';
import Button from '@/components/ui/Button';
import { FieldLabel, SelectInput, TextInput, ToggleInput } from '@/components/ui/FormField';
import SearchSuggestInput from '@/components/ui/SearchSuggestInput';
import { FeedbackBanner, PageErrorState, PageLoadingState } from '@/components/ui/PageState';
import { Layers3, Sigma, Wallet } from 'lucide-react';
import { buildSearchSuggestions, getSuggestionDisplayValue, matchesSearchFilter, normalizeSearchValue } from '@/lib/searchSuggestions';
import { payrollWorkspaceApi } from '@/services/api';
import type { SalaryComponentMaster } from '@/types';
import PayrollSectionCard from '@/features/payroll/components/PayrollSectionCard';
import PayrollStatusBadge from '@/features/payroll/components/PayrollStatusBadge';
import {
  formatPayrollCurrency,
  salaryComponentCategoryGroup,
  salaryComponentCategoryLabel,
  salaryComponentValueTypeLabel,
} from '@/features/payroll/utils';

const formatUpdatedLabel = (value?: string | null) => {
  if (!value) return 'Recently created';
  return new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

type ComponentFormState = {
  name: string;
  code: string;
  category: SalaryComponentMaster['category'];
  value_type: SalaryComponentMaster['value_type'];
  default_value: number;
  is_taxable: boolean;
  is_active: boolean;
};

const emptyForm: ComponentFormState = {
  name: '',
  code: '',
  category: 'allowance',
  value_type: 'fixed',
  default_value: 0,
  is_taxable: false,
  is_active: true,
};

const componentCategories: SalaryComponentMaster['category'][] = ['basic', 'allowance', 'overtime', 'bonus', 'reimbursement', 'penalty', 'tax', 'deduction', 'other'];

export default function PayrollComponentsView() {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [selectedSearchComponentId, setSelectedSearchComponentId] = useState<number | null>(null);
  const [category, setCategory] = useState<string>('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [form, setForm] = useState<ComponentFormState>(emptyForm);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const componentsQuery = useQuery({
    queryKey: ['payroll-components'],
    queryFn: async () => (await payrollWorkspaceApi.getComponents()).data.data,
  });

  const components = componentsQuery.data || [];
  const componentSearchSuggestions = useMemo(
    () =>
      buildSearchSuggestions(components, (component) => ({
        id: component.id,
        label: component.name,
        description: component.code,
        keywords: [component.category, component.value_type],
        payload: component,
      })),
    [components]
  );
  const filteredComponents = useMemo(
    () => components.filter((component) => {
      if (selectedSearchComponentId && Number(component.id) !== Number(selectedSearchComponentId)) {
        return false;
      }

      const matchesSearch = matchesSearchFilter(search, [component.name, component.code, component.category, component.value_type]);
      const matchesCategory = !category || component.category === category;
      const matchesActive = activeFilter === 'all' || (activeFilter === 'active' ? component.is_active : !component.is_active);
      return matchesSearch && matchesCategory && matchesActive;
    }),
    [activeFilter, category, components, search, selectedSearchComponentId]
  );

  const selectedComponent = useMemo(
    () => components.find((component) => component.id === selectedId) || null,
    [components, selectedId]
  );

  const totals = useMemo(() => ({
    earnings: components.filter((component) => salaryComponentCategoryGroup(component.category) === 'earning').length,
    deductions: components.filter((component) => salaryComponentCategoryGroup(component.category) === 'deduction').length,
    used: components.filter((component) => Number(component.template_components_count || 0) > 0).length,
  }), [components]);

  const resetForm = () => {
    setSelectedId(null);
    setForm(emptyForm);
  };

  const loadComponent = (component: SalaryComponentMaster) => {
    setSelectedId(component.id);
    setForm({
      name: component.name,
      code: component.code,
      category: component.category,
      value_type: component.value_type,
      default_value: Number(component.default_value || 0),
      is_taxable: Boolean(component.is_taxable),
      is_active: Boolean(component.is_active),
    });
  };

  const saveComponent = async () => {
    setFeedback(null);
    setIsSaving(true);
    try {
      const payload = {
        ...form,
        default_value: Number(form.default_value || 0),
      };

      if (selectedId) {
        await payrollWorkspaceApi.updateComponent(selectedId, payload);
      } else {
        await payrollWorkspaceApi.createComponent(payload);
      }

      setFeedback({ tone: 'success', message: selectedId ? 'Salary component updated.' : 'Salary component created.' });
      resetForm();
      await componentsQuery.refetch();
    } catch (error: any) {
      setFeedback({ tone: 'error', message: error?.response?.data?.message || 'Failed to save salary component.' });
    } finally {
      setIsSaving(false);
    }
  };

  const deleteComponent = async () => {
    if (!selectedId) return;
    setFeedback(null);
    setIsSaving(true);
    try {
      await payrollWorkspaceApi.deleteComponent(selectedId);
      setFeedback({ tone: 'success', message: 'Salary component deleted.' });
      resetForm();
      await componentsQuery.refetch();
    } catch (error: any) {
      setFeedback({ tone: 'error', message: error?.response?.data?.message || 'Failed to delete salary component.' });
    } finally {
      setIsSaving(false);
    }
  };

  if (componentsQuery.isLoading) {
    return <PageLoadingState label="Loading salary components..." />;
  }

  if (componentsQuery.isError) {
    return <PageErrorState message={(componentsQuery.error as any)?.response?.data?.message || 'Failed to load salary components.'} onRetry={() => void componentsQuery.refetch()} />;
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Payroll setup"
        title="Salary Components"
        description="Manage reusable earnings and deductions as payroll master data, with clearer visibility into calculation style, tax behavior, and where each component is already in use."
        actions={<Button onClick={resetForm}>New Component</Button>}
      />

      {feedback ? <FeedbackBanner tone={feedback.tone} message={feedback.message} /> : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total Components" value={components.length} hint="Reusable building blocks across payroll." icon={Layers3} accent="sky" />
        <MetricCard label="Earnings Mix" value={totals.earnings} hint="Components used on the earning side of salary structures." icon={Wallet} accent="emerald" />
        <MetricCard label="Deduction Mix" value={totals.deductions} hint="Tax, penalties, and deduction-side components." icon={Sigma} accent="amber" />
        <MetricCard label="Used In Templates" value={totals.used} hint="Components already referenced by at least one salary template." icon={Layers3} accent="violet" />
      </div>

      <FilterPanel className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <div className="xl:col-span-2">
          <FieldLabel>Search</FieldLabel>
          <SearchSuggestInput
            value={search}
            onValueChange={(value) => {
              setSearch(value);

              const selectedComponentName =
                components.find((component) => Number(component.id) === Number(selectedSearchComponentId))?.name || '';

              if (!value.trim() || normalizeSearchValue(value) !== normalizeSearchValue(selectedComponentName)) {
                setSelectedSearchComponentId(null);
              }
            }}
            onSuggestionSelect={(suggestion) => {
              const nextComponent = suggestion.payload as SalaryComponentMaster | undefined;
              const nextComponentId = Number(nextComponent?.id || suggestion.id || 0);
              setSearch(getSuggestionDisplayValue(suggestion));
              setSelectedSearchComponentId(Number.isFinite(nextComponentId) && nextComponentId > 0 ? nextComponentId : null);

              if (nextComponent) {
                loadComponent(nextComponent);
              }
            }}
            suggestions={componentSearchSuggestions}
            placeholder="Search by component name or code"
            emptyMessage="No salary components match this search."
          />
        </div>
        <div>
          <FieldLabel>Category</FieldLabel>
          <SelectInput value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="">All categories</option>
            {componentCategories.map((item) => <option key={item} value={item}>{salaryComponentCategoryLabel(item)}</option>)}
          </SelectInput>
        </div>
        <div>
          <FieldLabel>Status</FieldLabel>
          <SelectInput value={activeFilter} onChange={(event) => setActiveFilter(event.target.value as 'all' | 'active' | 'inactive')}>
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </SelectInput>
        </div>
        <div className="flex items-end">
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => {
              setSearch('');
              setSelectedSearchComponentId(null);
              setCategory('');
              setActiveFilter('all');
            }}
          >
            Reset Filters
          </Button>
        </div>
      </FilterPanel>

      <DataTable
        title="Component Registry"
        description="Reusable component master list for salary templates, payroll profiles, and compatibility structures."
        rows={filteredComponents}
        emptyMessage="No salary components match the current filters."
        stickyHeader
        headerAction={selectedComponent ? <Button variant="secondary" size="sm" onClick={resetForm}>Clear Selection</Button> : undefined}
        columns={[
          {
            key: 'component',
            header: 'Component',
            className: 'min-w-[14rem]',
            render: (component: SalaryComponentMaster) => (
              <button type="button" onClick={() => loadComponent(component)} className="space-y-1 text-left">
                <p className="font-medium text-slate-950">{component.name}</p>
                <p className="text-sm text-slate-500">{component.code}</p>
              </button>
            ),
          },
          {
            key: 'type',
            header: 'Type',
            render: (component: SalaryComponentMaster) => (
              <div>
                <p className="font-medium text-slate-950">{salaryComponentCategoryLabel(component.category)}</p>
                <p className="mt-1 text-sm text-slate-500">{salaryComponentCategoryGroup(component.category) === 'earning' ? 'Earning side' : 'Deduction side'}</p>
              </div>
            ),
          },
          {
            key: 'calculation',
            header: 'Calculation Type',
            render: (component: SalaryComponentMaster) => (
              <div>
                <p className="font-medium text-slate-950">{salaryComponentValueTypeLabel(component.value_type)}</p>
                <p className="mt-1 text-sm text-slate-500">
                  {component.value_type === 'percentage'
                    ? `${Number(component.default_value || 0)}% default`
                    : formatPayrollCurrency(Number(component.default_value || 0))}
                </p>
              </div>
            ),
          },
          {
            key: 'taxable',
            header: 'Taxable',
            render: (component: SalaryComponentMaster) => <PayrollStatusBadge status={component.is_taxable ? 'taxable' : 'non taxable'} />,
          },
          {
            key: 'active',
            header: 'Active',
            render: (component: SalaryComponentMaster) => <PayrollStatusBadge status={component.is_active ? 'active' : 'inactive'} />,
          },
          {
            key: 'usage',
            header: 'Usage',
            render: (component: SalaryComponentMaster) => (
              <div>
                <p className="font-medium text-slate-950">{Number(component.template_components_count || 0)}</p>
                <p className="mt-1 text-sm text-slate-500">template assignments</p>
              </div>
            ),
          },
          {
            key: 'updated',
            header: 'Updated',
            render: (component: SalaryComponentMaster) => (
              <div>
                <p className="font-medium text-slate-950">{formatUpdatedLabel(component.updated_at)}</p>
                <p className="mt-1 text-sm text-slate-500">Last touched</p>
              </div>
            ),
          },
          {
            key: 'action',
            header: 'Action',
            render: (component: SalaryComponentMaster) => (
              <Button size="sm" variant="ghost" onClick={() => loadComponent(component)}>
                Edit
              </Button>
            ),
          },
        ]}
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <PayrollSectionCard
          title={selectedId ? 'Edit Component' : 'Create Component'}
          description="Define component defaults once, then reuse them consistently across templates and payroll records."
          action={selectedId ? <Button variant="secondary" size="sm" onClick={resetForm}>New Component</Button> : null}
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <FieldLabel>Name</FieldLabel>
              <TextInput value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
            </div>
            <div>
              <FieldLabel>Code</FieldLabel>
              <TextInput value={form.code} onChange={(event) => setForm((current) => ({ ...current, code: event.target.value.toUpperCase() }))} />
            </div>
            <div>
              <FieldLabel>Category</FieldLabel>
              <SelectInput value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value as SalaryComponentMaster['category'] }))}>
                {componentCategories.map((item) => <option key={item} value={item}>{salaryComponentCategoryLabel(item)}</option>)}
              </SelectInput>
            </div>
            <div>
              <FieldLabel>Calculation Type</FieldLabel>
              <SelectInput value={form.value_type} onChange={(event) => setForm((current) => ({ ...current, value_type: event.target.value as SalaryComponentMaster['value_type'] }))}>
                <option value="fixed">Fixed amount</option>
                <option value="percentage">Percentage of basic</option>
              </SelectInput>
            </div>
            <div>
              <FieldLabel>Default Value</FieldLabel>
              <TextInput type="number" min={0} value={Number(form.default_value || 0)} onChange={(event) => setForm((current) => ({ ...current, default_value: Number(event.target.value || 0) }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-[20px] border border-slate-200/80 bg-slate-50/70 px-3 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-slate-700">Taxable</span>
                  <ToggleInput checked={form.is_taxable} onChange={(checked) => setForm((current) => ({ ...current, is_taxable: checked }))} />
                </div>
              </div>
              <div className="rounded-[20px] border border-slate-200/80 bg-slate-50/70 px-3 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-slate-700">Active</span>
                  <ToggleInput checked={form.is_active} onChange={(checked) => setForm((current) => ({ ...current, is_active: checked }))} />
                </div>
              </div>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <Button onClick={saveComponent} disabled={isSaving || !form.name.trim() || !form.code.trim()}>
              {selectedId ? 'Update Component' : 'Create Component'}
            </Button>
            <Button variant="secondary" onClick={resetForm}>Reset</Button>
            {selectedId ? <Button variant="danger" onClick={deleteComponent} disabled={isSaving}>Delete</Button> : null}
          </div>
        </PayrollSectionCard>

        <div className="space-y-5">
          <PayrollSectionCard title="Selected Component" description="Operational readout for the component you are editing or reviewing.">
            {selectedComponent ? (
              <div className="space-y-4">
                <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-slate-950">{selectedComponent.name}</p>
                      <p className="mt-1 text-sm text-slate-500">{selectedComponent.code}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <PayrollStatusBadge status={selectedComponent.is_active ? 'active' : 'inactive'} />
                      <PayrollStatusBadge status={selectedComponent.value_type} />
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-slate-500">Category</p>
                      <p className="font-semibold text-slate-950">{salaryComponentCategoryLabel(selectedComponent.category)}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">Template usage</p>
                      <p className="font-semibold text-slate-950">{Number(selectedComponent.template_components_count || 0)}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">Updated</p>
                      <p className="font-semibold text-slate-950">{formatUpdatedLabel(selectedComponent.updated_at)}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">Default rule</p>
                      <p className="font-semibold text-slate-950">{salaryComponentValueTypeLabel(selectedComponent.value_type)}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">Tax treatment</p>
                      <p className="font-semibold text-slate-950">{selectedComponent.is_taxable ? 'Taxable' : 'Non-taxable'}</p>
                    </div>
                  </div>
                </div>
                <p className="text-sm leading-6 text-slate-500">
                  Formula-based dependency chains are still a backend limitation, so this screen stays focused on fixed and percentage-driven components without pretending there is a full rule engine behind it yet.
                </p>
              </div>
            ) : (
              <p className="text-sm text-slate-500">Select a component from the registry to review its usage and edit it here.</p>
            )}
          </PayrollSectionCard>

          <PayrollSectionCard title="Configuration Notes" description="How this master data behaves in the current payroll engine.">
            <div className="space-y-3 text-sm text-slate-600">
              <p>Template usage counts come from the existing salary-template engine, so you can see whether a component is safe to edit or deactivate.</p>
              <p>Fixed and percentage-based calculations are production-ready today. More advanced formula evaluation remains a backend extension, not a missing UI step.</p>
            </div>
          </PayrollSectionCard>
        </div>
      </div>
    </div>
  );
}
