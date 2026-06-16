import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Building2, Save, Trash2, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { payrollApi } from '@/services/api';
import Button from '@/components/ui/Button';
import { TextInput, SelectInput, FieldLabel } from '@/components/ui/FormField';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import PageHeader from '@/components/dashboard/PageHeader';

const INDIAN_STATES = [
  { value: 'andhra_pradesh', label: 'Andhra Pradesh' },
  { value: 'assam', label: 'Assam' },
  { value: 'bihar', label: 'Bihar' },
  { value: 'delhi', label: 'Delhi' },
  { value: 'gujarat', label: 'Gujarat' },
  { value: 'haryana', label: 'Haryana' },
  { value: 'jharkhand', label: 'Jharkhand' },
  { value: 'karnataka', label: 'Karnataka' },
  { value: 'kerala', label: 'Kerala' },
  { value: 'madhya_pradesh', label: 'Madhya Pradesh' },
  { value: 'maharashtra', label: 'Maharashtra' },
  { value: 'odisha', label: 'Odisha' },
  { value: 'punjab', label: 'Punjab' },
  { value: 'rajasthan', label: 'Rajasthan' },
  { value: 'tamil_nadu', label: 'Tamil Nadu' },
  { value: 'telangana', label: 'Telangana' },
  { value: 'uttar_pradesh', label: 'Uttar Pradesh' },
  { value: 'west_bengal', label: 'West Bengal' },
];

interface DepartmentTemplatesProps {
  onBack: () => void;
}

type Template = {
  id: number;
  organization_id: number;
  department_id: number;
  default_annual_ctc: number | string;
  basic_percentage: number | string;
  hra_percentage: number | string;
  da_percentage: number | string;
  conveyance_allowance: number | string;
  pf_enabled: boolean;
  esi_enabled: boolean;
  pt_enabled: boolean;
  tds_enabled: boolean;
  lwf_enabled: boolean;
  pf_employee_percentage: number | string;
  pf_employer_percentage: number | string;
  pf_wage_cap: number | string;
  esi_employee_percentage: number | string;
  esi_employer_percentage: number | string;
  esi_threshold: number | string;
  pt_state: string;
  tax_regime: string;
  is_metro_city: boolean;
  is_active: boolean;
  department?: { id: number; name: string; slug: string };
};

const emptyTemplate: Omit<Template, 'id' | 'organization_id' | 'department_id' | 'department'> = {
  default_annual_ctc: 0,
  basic_percentage: 40,
  hra_percentage: 50,
  da_percentage: 0,
  conveyance_allowance: 1600,
  pf_enabled: true,
  esi_enabled: true,
  pt_enabled: true,
  tds_enabled: true,
  lwf_enabled: false,
  pf_employee_percentage: 12,
  pf_employer_percentage: 12,
  pf_wage_cap: 15000,
  esi_employee_percentage: 0.75,
  esi_employer_percentage: 3.25,
  esi_threshold: 21000,
  pt_state: 'maharashtra',
  tax_regime: 'new',
  is_metro_city: true,
  is_active: true,
};

export default function DepartmentTemplates({ onBack }: DepartmentTemplatesProps) {
  const [selectedDeptId, setSelectedDeptId] = useState<number | null>(null);
  const [form, setForm] = useState<typeof emptyTemplate>(emptyTemplate);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['payroll', 'department-templates'],
    queryFn: () => payrollApi.listDepartmentTemplates().then(r => r.data),
  });

  const existingTemplates: Template[] = data?.templates || [];
  const missingDepts: Array<{ id: number; name: string; slug: string }> = data?.departments_without_template || [];

  const allDepartments = useMemo(() => {
    const fromExisting = existingTemplates.map(t => ({ id: t.department_id, name: t.department?.name || `Dept #${t.department_id}`, slug: t.department?.slug || '' }));
    const fromMissing = missingDepts;
    const seen = new Set<number>();
    const out: Array<{ id: number; name: string; slug: string }> = [];
    for (const d of [...fromExisting, ...fromMissing]) {
      if (!seen.has(d.id)) {
        seen.add(d.id);
        out.push(d);
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [existingTemplates, missingDepts]);

  useEffect(() => {
    if (selectedDeptId == null && allDepartments.length > 0) {
      setSelectedDeptId(allDepartments[0].id);
    }
  }, [allDepartments, selectedDeptId]);

  useEffect(() => {
    if (selectedDeptId == null) return;
    const existing = existingTemplates.find(t => t.department_id === selectedDeptId);
    if (existing) {
      setForm({
        default_annual_ctc: Number(existing.default_annual_ctc ?? 0),
        basic_percentage: Number(existing.basic_percentage ?? 40),
        hra_percentage: Number(existing.hra_percentage ?? 50),
        da_percentage: Number(existing.da_percentage ?? 0),
        conveyance_allowance: Number(existing.conveyance_allowance ?? 1600),
        pf_enabled: !!existing.pf_enabled,
        esi_enabled: !!existing.esi_enabled,
        pt_enabled: !!existing.pt_enabled,
        tds_enabled: !!existing.tds_enabled,
        lwf_enabled: !!existing.lwf_enabled,
        pf_employee_percentage: Number(existing.pf_employee_percentage ?? 12),
        pf_employer_percentage: Number(existing.pf_employer_percentage ?? 12),
        pf_wage_cap: Number(existing.pf_wage_cap ?? 15000),
        esi_employee_percentage: Number(existing.esi_employee_percentage ?? 0.75),
        esi_employer_percentage: Number(existing.esi_employer_percentage ?? 3.25),
        esi_threshold: Number(existing.esi_threshold ?? 21000),
        pt_state: existing.pt_state ?? 'maharashtra',
        tax_regime: existing.tax_regime ?? 'new',
        is_metro_city: !!existing.is_metro_city,
        is_active: existing.is_active !== false,
      });
    } else {
      setForm(emptyTemplate);
    }
    setSavedMessage(null);
    setErrorMessage(null);
  }, [selectedDeptId, existingTemplates]);

  const saveMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => payrollApi.upsertDepartmentTemplate(selectedDeptId!, data).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll', 'department-templates'] });
      setSavedMessage('Department template saved. New employees in this department will inherit these defaults.');
      setErrorMessage(null);
    },
    onError: (err: any) => {
      setErrorMessage(err?.message || 'Failed to save template.');
      setSavedMessage(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => payrollApi.deleteDepartmentTemplate(selectedDeptId!).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll', 'department-templates'] });
      setSavedMessage(null);
    },
  });

  const existing = existingTemplates.find(t => t.department_id === selectedDeptId);
  const isExisting = !!existing;

  const handleSave = () => {
    if (selectedDeptId == null) return;
    saveMutation.mutate(form as unknown as Record<string, unknown>);
  };

  const handleDelete = () => {
    if (!isExisting) return;
    if (!window.confirm('Remove this department template? Existing employee templates are NOT affected — only future new-hires will stop inheriting these defaults.')) {
      return;
    }
    deleteMutation.mutate();
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <PageHeader
        title="Department Salary Templates"
        description="Set default salary components and statutory toggles per department. New employees inherit these defaults; existing templates are not retroactively changed."
        actions={
          <Button variant="ghost" onClick={onBack}>
            ← Back to Payroll
          </Button>
        }
      />

      {isLoading ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
        </div>
      ) : allDepartments.length === 0 ? (
        <SurfaceCard className="p-6 text-center text-slate-500">
          <Building2 className="h-8 w-8 mx-auto mb-2 text-slate-300" />
          <p>No departments found. Create departments first to set up templates.</p>
        </SurfaceCard>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <SurfaceCard className="p-4">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Departments</h3>
            <div className="space-y-1 max-h-[600px] overflow-y-auto">
              {allDepartments.map(d => {
                const covered = existingTemplates.some(t => t.department_id === d.id);
                return (
                  <button
                    key={d.id}
                    onClick={() => setSelectedDeptId(d.id)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
                      selectedDeptId === d.id
                        ? 'bg-blue-50 text-blue-900 border border-blue-200'
                        : 'hover:bg-slate-50 text-slate-700 border border-transparent'
                    }`}
                  >
                    <span className="truncate">{d.name}</span>
                    {covered ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />
                    ) : (
                      <span className="text-[10px] uppercase tracking-wide text-amber-600 flex-shrink-0">no template</span>
                    )}
                  </button>
                );
              })}
            </div>
          </SurfaceCard>

          <SurfaceCard className="p-6 lg:col-span-2 space-y-4">
            {!isExisting && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-amber-800">
                  No template for this department yet. Saving will create one. New employees added to this department will inherit these defaults.
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <FieldLabel>Default Annual CTC (₹)</FieldLabel>
                <TextInput
                  type="number"
                  value={String(form.default_annual_ctc)}
                  onChange={e => setForm({ ...form, default_annual_ctc: parseFloat(e.target.value) || 0 })}
                />
              </div>
              <div>
                <FieldLabel>Basic Salary (% of CTC)</FieldLabel>
                <TextInput
                  type="number"
                  value={String(form.basic_percentage)}
                  onChange={e => setForm({ ...form, basic_percentage: parseFloat(e.target.value) || 0 })}
                />
              </div>
              <div>
                <FieldLabel>HRA (% of Basic)</FieldLabel>
                <TextInput
                  type="number"
                  value={String(form.hra_percentage)}
                  onChange={e => setForm({ ...form, hra_percentage: parseFloat(e.target.value) || 0 })}
                />
              </div>
              <div>
                <FieldLabel>Conveyance Allowance (₹)</FieldLabel>
                <TextInput
                  type="number"
                  value={String(form.conveyance_allowance)}
                  onChange={e => setForm({ ...form, conveyance_allowance: parseFloat(e.target.value) || 0 })}
                />
              </div>
              <div>
                <FieldLabel>DA (% of CTC)</FieldLabel>
                <TextInput
                  type="number"
                  value={String(form.da_percentage)}
                  onChange={e => setForm({ ...form, da_percentage: parseFloat(e.target.value) || 0 })}
                />
              </div>
              <div>
                <FieldLabel>State (Professional Tax)</FieldLabel>
                <SelectInput
                  value={form.pt_state}
                  onChange={e => setForm({ ...form, pt_state: e.target.value })}
                >
                  {INDIAN_STATES.map(s => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </SelectInput>
              </div>
              <div>
                <FieldLabel>Tax Regime</FieldLabel>
                <SelectInput
                  value={form.tax_regime}
                  onChange={e => setForm({ ...form, tax_regime: e.target.value })}
                >
                  <option value="new">New Regime</option>
                  <option value="old">Old Regime</option>
                </SelectInput>
              </div>
              <div>
                <FieldLabel>ESI Threshold (₹/mo)</FieldLabel>
                <TextInput
                  type="number"
                  value={String(form.esi_threshold)}
                  onChange={e => setForm({ ...form, esi_threshold: parseFloat(e.target.value) || 0 })}
                />
              </div>
            </div>

            <div className="border-t border-slate-200 pt-4">
              <h4 className="text-sm font-medium text-slate-700 mb-3">Statutory Toggles</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {([
                  ['pf_enabled', 'Provident Fund'],
                  ['esi_enabled', 'ESI'],
                  ['pt_enabled', 'Professional Tax'],
                  ['tds_enabled', 'TDS'],
                  ['lwf_enabled', 'LWF'],
                  ['is_metro_city', 'Metro City'],
                  ['is_active', 'Active'],
                ] as const).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={!!form[key]}
                      onChange={e => setForm({ ...form, [key]: e.target.checked })}
                      className="rounded border-slate-300"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            {savedMessage && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm text-emerald-800">
                {savedMessage}
              </div>
            )}
            {errorMessage && (
              <div className="bg-rose-50 border border-rose-200 rounded-lg p-3 text-sm text-rose-800">
                {errorMessage}
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              {isExisting && (
                <Button
                  variant="ghost"
                  onClick={handleDelete}
                  iconLeft={<Trash2 className="h-4 w-4" />}
                  disabled={deleteMutation.isPending}
                >
                  Remove template
                </Button>
              )}
              <Button
                variant="primary"
                onClick={handleSave}
                disabled={saveMutation.isPending}
                iconLeft={saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              >
                {saveMutation.isPending ? 'Saving…' : isExisting ? 'Update template' : 'Create template'}
              </Button>
            </div>
          </SurfaceCard>
        </div>
      )}
    </div>
  );
}
