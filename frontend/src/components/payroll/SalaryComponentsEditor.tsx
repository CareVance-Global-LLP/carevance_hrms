import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { payrollApi } from '@/services/api';
import type { SalaryStructure, CreateSalaryStructurePayload } from '@/types';
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

  const { data: structuresData, isLoading } = useQuery({
    queryKey: ['salary-structures'],
    queryFn: () => payrollApi.getSalaryStructures().then((r) => r.data),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => payrollApi.deleteSalaryStructure(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['salary-structures'] });
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

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-52 bg-gray-100 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">Salary Templates</h2>
        <button
          onClick={() => setShowCreateModal(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-teal-700 rounded-md hover:bg-teal-800 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          New Template
        </button>
      </div>

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
                  <div className="text-[10px] text-slate-400">Basic %</div>
                  <div className="text-xs font-semibold text-slate-700">{structure.basic_percentage}%</div>
                </div>
                <div className="bg-slate-50 border border-slate-100 rounded px-2 py-1.5 text-center">
                  <div className="text-[10px] text-slate-400">HRA %</div>
                  <div className="text-xs font-semibold text-slate-700">{structure.hra_percentage}%</div>
                </div>
                <div className="bg-slate-50 border border-slate-100 rounded px-2 py-1.5 text-center">
                  <div className="text-[10px] text-slate-400">Special %</div>
                  <div className="text-xs font-semibold text-slate-700">{specialPercentage(structure)}%</div>
                </div>
              </div>

              {earns.length > 0 && (
                <div className="mb-1">
                  <div className="text-[10px] font-medium text-slate-400 mb-0.5">Earnings ({earns.length})</div>
                  <div className="text-[11px] text-slate-500 leading-snug">{earns.join(' \u00b7 ')}</div>
                </div>
              )}

              {deds.length > 0 && (
                <div className="mb-3">
                  <div className="text-[10px] font-medium text-slate-400 mb-0.5">Deductions ({deds.length})</div>
                  <div className="text-[11px] text-slate-500 leading-snug">{deds.join(' \u00b7 ')}</div>
                </div>
              )}

              {(earns.length === 0 && deds.length === 0) && <div className="flex-1" />}

              <div className="flex items-center gap-2 mt-auto pt-3 border-t border-slate-100">
                <button
                  onClick={() => setEditingStructure(structure)}
                  className="px-2.5 py-1 text-[11px] font-medium text-slate-600 border border-slate-200 rounded hover:bg-slate-50 transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={() => setEditingStructure(structure)}
                  className="px-2.5 py-1 text-[11px] font-medium text-teal-600 hover:text-teal-700 transition-colors"
                >
                  + Earning
                </button>
                <button
                  onClick={() => setEditingStructure(structure)}
                  className="px-2.5 py-1 text-[11px] font-medium text-teal-600 hover:text-teal-700 transition-colors"
                >
                  + Deduction
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Delete template "${structure.name}"? This cannot be undone.`)) {
                      deleteMutation.mutate(structure.id);
                    }
                  }}
                  className="px-2.5 py-1 text-[11px] font-medium text-red-500 hover:text-red-600 transition-colors ml-auto"
                >
                  Delete
                </button>
              </div>
            </div>
          );
        })}

        <button
          onClick={() => setShowCreateModal(true)}
          className="border-2 border-dashed border-slate-200 bg-slate-50/50 rounded-lg p-4 flex flex-col items-center justify-center min-h-[200px] cursor-pointer hover:border-slate-300 hover:bg-slate-50 transition-colors"
        >
          <div className="text-2xl text-slate-400">+</div>
          <div className="text-xs text-slate-400 mt-2">New Template</div>
        </button>
      </div>

      {(showCreateModal || editingStructure) && (
        <SalaryStructureFormModal
          structure={editingStructure}
          onClose={() => {
            setShowCreateModal(false);
            setEditingStructure(null);
          }}
        />
      )}
    </div>
  );
}
