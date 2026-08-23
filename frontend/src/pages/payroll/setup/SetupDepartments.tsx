import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Save, Edit2, Trash2, CheckCircle2, AlertCircle, Loader2, Building2 } from 'lucide-react';
import SetupLayout, { StepHeader } from './SetupLayout';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import { TextInput, FieldLabel } from '@/components/ui/FormField';
import Button from '@/components/ui/Button';
import InfoTooltip from '@/components/ui/InfoTooltip';
import { payrollApi } from '@/services/api';
import { usePayrollOnboarding } from '@/hooks/usePayrollOnboarding';

interface DepartmentTemplate {
  id?: number;
  department_id: number;
  department_name?: string;
  basic_percentage: number;
  hra_percentage: number;
  conveyance_allowance: number;
  working_days_per_month: number;
  pf_enabled: boolean;
  esi_enabled: boolean;
  pt_enabled: boolean;
  tds_enabled: boolean;
  lwf_enabled: boolean;
}

export default function SetupDepartments() {
  const { status, markSetupStep } = usePayrollOnboarding();
  const isComplete = status?.steps.departments ?? false;
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const { data: departmentsData } = useQuery({
    queryKey: ['payroll', 'departments'],
    queryFn: () => payrollApi.getDepartments().then(res => res.data),
  });

  const { data: templatesData, isLoading } = useQuery({
    queryKey: ['payroll', 'department-templates'],
    queryFn: () => payrollApi.listDepartmentTemplates().then(res => res.data?.templates ?? res.data ?? []),
  });

  const departments = (departmentsData?.departments ?? []) as Array<{ id: number; name: string }>;

  const saveTemplateMutation = useMutation({
    mutationFn: ({ departmentId, data }: { departmentId: number; data: any }) =>
      payrollApi.upsertDepartmentTemplate(departmentId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll', 'department-templates'] });
      setEditingId(null);
      setError(null);
      setSuccess('Department template saved');
      setTimeout(() => setSuccess(null), 3000);
    },
    onError: (e: any) => setError(e?.response?.data?.message || 'Failed to save template'),
  });

  const deleteTemplateMutation = useMutation({
    mutationFn: (id: number) => payrollApi.deleteDepartmentTemplate(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['payroll', 'department-templates'] }),
  });

  const templates = Array.isArray(templatesData) ? templatesData : [];
  const templatesByDept = new Map<number, any>();
  for (const t of templates) {
    if (t?.department_id) templatesByDept.set(t.department_id, t);
  }

  const handleCompleteStep = async () => {
    try {
      await markSetupStep('departments');
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Failed to save progress');
    }
  };

  return (
    <SetupLayout currentStep="departments">
      <StepHeader
        stepNumber={3}
        title="Department Templates"
        description="Set default salary structure per department. These override org defaults."
        isComplete={isComplete}
      />

      {error && (
        <div className="mb-4 p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-rose-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-rose-700 break-words flex-1">{error}</p>
          <button onClick={() => setError(null)} className="text-rose-400 hover:text-rose-600">×</button>
        </div>
      )}
      {success && (
        <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-start gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-emerald-700 flex-1">{success}</p>
        </div>
      )}

      <div className="mb-6">
        <p className="text-sm text-slate-600">
          Department templates let you apply different salary structures to different teams.
          For example, engineering might have a higher Basic % while sales has a higher conveyance.
        </p>
      </div>

      {isLoading ? (
        <SurfaceCard className="p-8 text-center">
          <Loader2 className="h-6 w-6 animate-spin mx-auto text-slate-500" />
        </SurfaceCard>
      ) : departments.length === 0 ? (
        <SurfaceCard className="p-8 text-center">
          <Building2 className="h-12 w-12 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-500">No departments yet. Add departments in the HR module first.</p>
        </SurfaceCard>
      ) : (
        <div className="space-y-3">
          {departments.map((dept) => {
            const t = templatesByDept.get(dept.id);
            const isEditing = editingId === dept.id;
            return (
              <DepartmentRow
                key={dept.id}
                department={dept}
                template={t}
                isEditing={isEditing}
                onEdit={() => setEditingId(dept.id)}
                onCancel={() => setEditingId(null)}
                onSave={(data) => saveTemplateMutation.mutate({ departmentId: dept.id, data })}
                onDelete={() => deleteTemplateMutation.mutate(dept.id)}
                isSaving={saveTemplateMutation.isPending}
              />
            );
          })}
        </div>
      )}

      <div className="mt-6 flex justify-between">
        <Button variant="secondary" onClick={handleCompleteStep} disabled={isComplete}>
          {isComplete ? 'Marked as complete ✓' : 'Mark this step as complete (skip for now)'}
        </Button>
      </div>
    </SetupLayout>
  );
}

function DepartmentRow({
  department,
  template,
  isEditing,
  onEdit,
  onCancel,
  onSave,
  onDelete,
  isSaving,
}: {
  department: { id: number; name: string };
  template?: any;
  isEditing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (data: any) => void;
  onDelete: () => void;
  isSaving: boolean;
}) {
  const [basicPct, setBasicPct] = useState(String(template?.basic_percentage ?? 40));
  const [hraPct, setHraPct] = useState(String(template?.hra_percentage ?? 50));
  const [conveyance, setConveyance] = useState(String(template?.conveyance_allowance ?? 1600));
  const [workingDays, setWorkingDays] = useState(String(template?.working_days_per_month ?? 26));

  if (!isEditing) {
    return (
      <SurfaceCard className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center flex-shrink-0">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <p className="font-medium text-slate-900">{department.name}</p>
              <p className="text-xs text-slate-500">
                {template ? (
                  <>Basic {template.basic_percentage}% · HRA {template.hra_percentage}% · {template.working_days_per_month} working days</>
                ) : (
                  <span className="text-amber-600">No template — using org defaults</span>
                )}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            {template && (
              <Button variant="ghost" size="sm" onClick={onDelete} iconLeft={<Trash2 className="h-3 w-3" />}>
                Remove
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={onEdit} iconLeft={<Edit2 className="h-3 w-3" />}>
              {template ? 'Edit' : 'Set Template'}
            </Button>
          </div>
        </div>
      </SurfaceCard>
    );
  }

  return (
    <SurfaceCard className="p-4 border-2 border-blue-300">
      <div className="flex items-center gap-3 mb-3">
        <div className="h-10 w-10 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center flex-shrink-0">
          <Building2 className="h-5 w-5" />
        </div>
        <p className="font-medium text-slate-900">{department.name}</p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        <div>
          <div className="flex items-center gap-1 mb-1">
            <FieldLabel>Basic %</FieldLabel>
            <InfoTooltip content="% of CTC allocated to Basic Salary. Drives PF and gratuity." title="Basic %" typical="40–50%" />
          </div>
          <TextInput type="number" value={basicPct} onChange={(e) => setBasicPct(e.target.value)} />
        </div>
        <div>
          <div className="flex items-center gap-1 mb-1">
            <FieldLabel>HRA %</FieldLabel>
            <InfoTooltip content="HRA as % of Basic. Tax-exempt up to 50% (metro) or 40% (non-metro) of Basic." title="HRA %" typical="50%" />
          </div>
          <TextInput type="number" value={hraPct} onChange={(e) => setHraPct(e.target.value)} />
        </div>
        <div>
          <div className="flex items-center gap-1 mb-1">
            <FieldLabel>Conveyance</FieldLabel>
            <InfoTooltip content="Tax-exempt up to ₹1,600/month under Old Regime." title="Conveyance" typical="₹1,600" />
          </div>
          <TextInput type="number" value={conveyance} onChange={(e) => setConveyance(e.target.value)} />
        </div>
        <div>
          <div className="flex items-center gap-1 mb-1">
            <FieldLabel>Working Days</FieldLabel>
            <InfoTooltip content="Expected work days/month. Used for pro-rata calculations." title="Working days" typical="26" />
          </div>
          <TextInput type="number" value={workingDays} onChange={(e) => setWorkingDays(e.target.value)} />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <Button
          variant="primary"
          size="sm"
          iconLeft={isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          onClick={() => onSave({
            basic_percentage: parseFloat(basicPct) || 40,
            hra_percentage: parseFloat(hraPct) || 50,
            conveyance_allowance: parseFloat(conveyance) || 1600,
            working_days_per_month: parseInt(workingDays) || 26,
            pf_enabled: template?.pf_enabled ?? true,
            esi_enabled: template?.esi_enabled ?? true,
            pt_enabled: template?.pt_enabled ?? true,
            tds_enabled: template?.tds_enabled ?? true,
            lwf_enabled: template?.lwf_enabled ?? false,
          })}
          disabled={isSaving}
        >
          {isSaving ? 'Saving...' : 'Save'}
        </Button>
      </div>
    </SurfaceCard>
  );
}