import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { payrollApi } from '@/services/api';
import type { SalaryStructure, CreateSalaryStructurePayload } from '@/types';
import Button from '@/components/ui/Button';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { PageEmptyState } from '@/components/ui/PageState';
import HowItWorksCard from '@/components/payroll/HowItWorksCard';
import ModuleHeader from '@/components/payroll/ModuleHeader';
import SalaryStructureFormModal from './SalaryStructureFormModal';

interface OtherEarning {
  name: string;
  type: 'fixed' | 'percentage';
  value: number;
}

export default function SalaryComponentsEditor() {
  const queryClient = useQueryClient();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingStructure, setEditingStructure] = useState<SalaryStructure | null>(null);
  const [deleting, setDeleting] = useState<SalaryStructure | null>(null);

  const { data: structuresData, isLoading } = useQuery({
    queryKey: ['salary-structures'],
    queryFn: () => payrollApi.getSalaryStructures().then((r) => r.data),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => payrollApi.deleteSalaryStructure(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['salary-structures'] });
      setDeleting(null);
    },
  });

  const structures: SalaryStructure[] = structuresData?.templates || [];

  const specialPercentage = (s: SalaryStructure): number => {
    const basic = s.basic_percentage || 0;
    const hra = s.hra_percentage || 0;
    return Math.max(0, 100 - basic - hra);
  };

  const earningNames = (s: SalaryStructure): string[] => {
    const names: string[] = [];
    if (s.basic_percentage > 0) names.push('Basic');
    if (s.hra_percentage > 0) names.push('HRA');
    if (specialPercentage(s) > 0) names.push('Special Allowance');
    if (s.conveyance_amount > 0) names.push('Conveyance');
    if (s.education_allowance > 0) names.push('Education Allowance');
    if (s.internet_allowance > 0) names.push('Internet Allowance');
    if (s.meal_allowance > 0) names.push('Meal Allowance');
    if (s.transport_allowance > 0) names.push('Transport Allowance');
    if (s.uniform_allowance > 0) names.push('Uniform Allowance');
    if (s.books_periodicals > 0) names.push('Books & Periodicals');
    if (s.fuel_maintenance > 0) names.push('Fuel & Maintenance');
    (s.other_earnings ?? []).forEach((e: OtherEarning) => {
      if (e.name) names.push(e.name);
    });
    return names;
  };

  const deductionNames = (s: SalaryStructure): string[] => {
    const names: string[] = [];
    if (s.nps_percentage > 0) names.push('NPS');
    if (s.vpf_percentage > 0) names.push('VPF');
    (s.other_deductions ?? []).forEach((d: OtherEarning) => {
      if (d.name) names.push(d.name);
    });
    return names;
  };

  const header = (
    <ModuleHeader
      title="Salary Templates"
      description="The component breakdown a CTC is split into — Basic, HRA, allowances and deductions — assigned to employees on their payroll card."
      actions={
        <Button variant="primary" size="sm" iconLeft={<Plus className="h-4 w-4" />} onClick={() => setShowCreateModal(true)}>
          New Template
        </Button>
      }
    />
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        {header}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-52 bg-slate-100 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      <HowItWorksCard
        whatIsThis="A reusable split of annual CTC into its parts. Assigning a template to an employee is what turns a single CTC figure into a payslip with Basic, HRA, allowances and statutory deductions."
        whenToUse={[
          'Setting up payroll for the first time — one template per band or grade',
          'When a group of employees should share an identical salary structure',
          'Before hiring, so a new joiner\'s card has a template to point at',
        ]}
        howItFlows={[
          { step: 1, label: 'Define percentages', desc: 'Basic and HRA as a share of CTC; the remainder becomes Special Allowance' },
          { step: 2, label: 'Add fixed allowances', desc: 'Conveyance, meal, internet and any custom earnings' },
          { step: 3, label: 'Assign to employees', desc: 'Pick the template on each Employee Card alongside their annual CTC' },
          { step: 4, label: 'Payroll splits the CTC', desc: 'Every run computes components, PF, ESI and PT from this structure' },
        ]}
        commonMistakes={[
          'Setting Basic too low — PF, gratuity and HRA exemption are all computed from it',
          'Editing a template mid-year, which changes the split for every employee already on it',
          'Leaving Basic + HRA above 100%, which drives Special Allowance to zero',
        ]}
      />

      {structures.length === 0 ? (
        <PageEmptyState
          title="No salary templates yet"
          description="Create a template to define how a CTC is split into components. Employees cannot be paid until they are assigned one."
          action={
            <Button variant="primary" size="sm" iconLeft={<Plus className="h-4 w-4" />} onClick={() => setShowCreateModal(true)}>
              New Template
            </Button>
          }
        />
      ) : (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {structures.map((structure) => {
          const earns = earningNames(structure);
          const deds = deductionNames(structure);
          return (
            <div
              key={structure.id}
              className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-slate-900">{structure.name}</span>
                <span className="text-[10px] font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                  {structure.basic_percentage}/{structure.hra_percentage}/{specialPercentage(structure)}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 mb-3">
                <div className="bg-slate-50 border border-slate-100 rounded px-2 py-1.5 text-center">
                  <div className="text-[10px] text-slate-500">Basic %</div>
                  <div className="text-xs font-semibold text-slate-700">{structure.basic_percentage}%</div>
                </div>
                <div className="bg-slate-50 border border-slate-100 rounded px-2 py-1.5 text-center">
                  <div className="text-[10px] text-slate-500">HRA %</div>
                  <div className="text-xs font-semibold text-slate-700">{structure.hra_percentage}%</div>
                </div>
                <div className="bg-slate-50 border border-slate-100 rounded px-2 py-1.5 text-center">
                  <div className="text-[10px] text-slate-500">Special %</div>
                  <div className="text-xs font-semibold text-slate-700">{specialPercentage(structure)}%</div>
                </div>
              </div>

              {earns.length > 0 && (
                <div className="mb-1">
                  <div className="text-[10px] font-medium text-slate-500 mb-0.5">Earnings ({earns.length})</div>
                  <div className="text-[11px] text-slate-500 leading-snug">{earns.join(' \u00b7 ')}</div>
                </div>
              )}

              {deds.length > 0 && (
                <div className="mb-3">
                  <div className="text-[10px] font-medium text-slate-500 mb-0.5">Deductions ({deds.length})</div>
                  <div className="text-[11px] text-slate-500 leading-snug">{deds.join(' \u00b7 ')}</div>
                </div>
              )}

              {(earns.length === 0 && deds.length === 0) && <div className="flex-1" />}

              <div className="flex items-center gap-2 mt-auto pt-3 border-t border-slate-100">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setEditingStructure(structure)}
                >
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                  onClick={() => setDeleting(structure)}
                >
                  Delete
                </Button>
              </div>
            </div>
          );
        })}

        <button
          onClick={() => setShowCreateModal(true)}
          className="border-2 border-dashed border-slate-200 bg-slate-50/50 rounded-lg p-4 flex flex-col items-center justify-center min-h-[200px] cursor-pointer hover:border-slate-300 hover:bg-slate-50 transition-colors"
        >
          <div className="text-2xl text-slate-500">+</div>
          <div className="text-xs text-slate-500 mt-2">New Template</div>
        </button>
      </div>
      )}

      {(showCreateModal || editingStructure) && (
        <SalaryStructureFormModal
          structure={editingStructure}
          onClose={() => {
            setShowCreateModal(false);
            setEditingStructure(null);
          }}
        />
      )}

      <ConfirmDialog
        isOpen={!!deleting}
        title="Delete salary template"
        message={`Delete template "${deleting?.name ?? ''}"? This cannot be undone, and employees assigned to it will have no structure to compute pay from.`}
        confirmLabel="Delete"
        tone="danger"
        isLoading={deleteMutation.isPending}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) deleteMutation.mutate(deleting.id);
        }}
      />
    </div>
  );
}
