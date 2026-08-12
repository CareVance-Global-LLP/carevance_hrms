import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Copy, Pencil, Trash2, Calculator, ChevronDown, ChevronRight, X, Save } from 'lucide-react';
import { payrollApi } from '@/services/api';
import type { SalaryStructure, SalaryStructureBreakdown, CreateSalaryStructurePayload } from '@/types';
import Modal from '@/components/ui/dialog/Modal';

interface OtherEarning {
  name: string;
  type: 'fixed' | 'percentage';
  value: number;
}

interface OtherDeduction {
  name: string;
  type: 'fixed' | 'percentage';
  value: number;
}

interface FormData {
  name: string;
  description: string;
  basic_percentage: number;
  hra_percentage: number;
  conveyance_amount: number;
  da_percentage: number;
  cca_amount: number;
  education_allowance: number;
  internet_allowance: number;
  meal_allowance: number;
  transport_allowance: number;
  uniform_allowance: number;
  books_periodicals: number;
  fuel_maintenance: number;
  nps_percentage: number;
  vpf_percentage: number;
  other_earnings: OtherEarning[];
  other_deductions: OtherDeduction[];
  is_default: boolean;
}

const defaultFormData: FormData = {
  name: '',
  description: '',
  basic_percentage: 50,
  hra_percentage: 50,
  conveyance_amount: 1600,
  da_percentage: 0,
  cca_amount: 0,
  education_allowance: 0,
  internet_allowance: 0,
  meal_allowance: 0,
  transport_allowance: 0,
  uniform_allowance: 0,
  books_periodicals: 0,
  fuel_maintenance: 0,
  nps_percentage: 0,
  vpf_percentage: 0,
  other_earnings: [],
  other_deductions: [],
  is_default: false,
};

// ── Keka-style input helpers ──────────────────────────────────

function PctInput({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  label: string;
}) {
  const [display, setDisplay] = useState(value === 0 ? '' : String(value));

  useEffect(() => {
    setDisplay(value === 0 ? '' : String(value));
  }, [value]);

  return (
    <div className="flex items-center justify-between py-2.5 border-b border-gray-50 last:border-0">
      <span className="text-sm text-gray-700">{label}</span>
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          value={display}
          onChange={(e) => {
            setDisplay(e.target.value);
            onChange(e.target.value === '' ? 0 : Number(e.target.value));
          }}
          onBlur={() => setDisplay(value === 0 ? '' : String(value))}
          className="w-20 text-right px-2 py-1 border border-gray-200 rounded-lg text-sm
                     focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400
                     outline-none transition-all
                     [&::-webkit-inner-spin-button]:appearance-none
                     [&::-webkit-outer-spin-button]:appearance-none"
          min={0}
          max={100}
        />
        <span className="text-sm text-gray-400 w-4">%</span>
      </div>
    </div>
  );
}

function RupeeInput({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  label: string;
}) {
  const [display, setDisplay] = useState(value === 0 ? '' : String(value));

  useEffect(() => {
    setDisplay(value === 0 ? '' : String(value));
  }, [value]);

  return (
    <div className="flex items-center justify-between py-2.5 border-b border-gray-50 last:border-0">
      <span className="text-sm text-gray-700">{label}</span>
      <div className="flex items-center gap-1.5">
        <span className="text-sm text-gray-400">₹</span>
        <input
          type="number"
          value={display}
          onChange={(e) => {
            setDisplay(e.target.value);
            onChange(e.target.value === '' ? 0 : Number(e.target.value));
          }}
          onBlur={() => setDisplay(value === 0 ? '' : String(value))}
          className="w-24 text-right px-2 py-1 border border-gray-200 rounded-lg text-sm
                     focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400
                     outline-none transition-all
                     [&::-webkit-inner-spin-button]:appearance-none
                     [&::-webkit-outer-spin-button]:appearance-none"
          min={0}
        />
      </div>
    </div>
  );
}

function OtherEarningRow({
  item,
  index,
  onChange,
  onRemove,
}: {
  item: OtherEarning;
  index: number;
  onChange: (i: number, field: string, val: any) => void;
  onRemove: (i: number) => void;
}) {
  const [nameDisplay, setNameDisplay] = useState(item.name);
  const [valDisplay, setValDisplay] = useState(item.value === 0 ? '' : String(item.value));

  useEffect(() => {
    setNameDisplay(item.name);
    setValDisplay(item.value === 0 ? '' : String(item.value));
  }, [item.name, item.value]);

  return (
    <div className="flex items-center gap-2 py-2">
      <input
        type="text"
        value={nameDisplay}
        onChange={(e) => {
          setNameDisplay(e.target.value);
          onChange(index, 'name', e.target.value);
        }}
        placeholder="Component name"
        className="flex-1 px-2 py-1.5 border border-gray-200 rounded-lg text-sm
                   focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400 outline-none"
      />
      <select
        value={item.type}
        onChange={(e) => onChange(index, 'type', e.target.value)}
        className="px-2 py-1.5 border border-gray-200 rounded-lg text-sm bg-white
                   focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400 outline-none"
      >
        <option value="fixed">₹ Fixed</option>
        <option value="percentage">% %</option>
      </select>
      <div className="flex items-center gap-1">
        {item.type === 'fixed' && <span className="text-sm text-gray-400">₹</span>}
        <input
          type="number"
          value={valDisplay}
          onChange={(e) => {
            setValDisplay(e.target.value);
            onChange(index, 'value', e.target.value === '' ? 0 : Number(e.target.value));
          }}
          onBlur={() => setValDisplay(item.value === 0 ? '' : String(item.value))}
          className="w-20 text-right px-2 py-1.5 border border-gray-200 rounded-lg text-sm
                     focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400 outline-none
                     [&::-webkit-inner-spin-button]:appearance-none
                     [&::-webkit-outer-spin-button]:appearance-none"
          min={0}
        />
        {item.type === 'percentage' && <span className="text-sm text-gray-400">%</span>}
      </div>
      <button
        onClick={() => onRemove(index)}
        className="p-1 text-gray-300 hover:text-red-500 transition-colors"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export default function SalaryStructureTemplates() {
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState<FormData>(defaultFormData);
  const [previewCtc, setPreviewCtc] = useState<string>('');
  const [showCreateModal, setShowCreateModal] = useState(false);

  const { data: structuresData, isLoading } = useQuery({
    queryKey: ['salary-structures'],
    queryFn: () => payrollApi.getSalaryStructures().then(r => r.data),
  });

  const { data: previewData, refetch: fetchPreview } = useQuery({
    queryKey: ['salary-structure-preview', expandedId, previewCtc],
    queryFn: () => {
      if (!expandedId || !previewCtc) return Promise.resolve(null);
      return payrollApi.previewSalaryStructure(expandedId, parseFloat(previewCtc)).then(r => r.data);
    },
    enabled: false,
  });

  useEffect(() => {
    if (previewCtc && expandedId) {
      const timeout = setTimeout(() => {
        fetchPreview();
      }, 500);
      return () => clearTimeout(timeout);
    }
  }, [previewCtc, expandedId, fetchPreview]);

  const structures = structuresData?.templates || [];

  const createMutation = useMutation({
    mutationFn: (data: CreateSalaryStructurePayload) => payrollApi.createSalaryStructure(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['salary-structures'] });
      setShowCreateModal(false);
      setFormData(defaultFormData);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<CreateSalaryStructurePayload> }) =>
      payrollApi.updateSalaryStructure(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['salary-structures'] });
      setEditingId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => payrollApi.deleteSalaryStructure(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['salary-structures'] });
      setExpandedId(null);
    },
  });

  const duplicateMutation = useMutation({
    mutationFn: async (id: number) => {
      const original = structures.find((s) => s.id === id);
      if (!original) return;
      const payload: CreateSalaryStructurePayload = {
        name: `${original.name} (Copy)`,
        description: original.description || undefined,
        basic_percentage: original.basic_percentage,
        hra_percentage: original.hra_percentage,
        conveyance_amount: original.conveyance_amount,
        da_percentage: original.da_percentage,
        cca_amount: original.cca_amount,
        education_allowance: original.education_allowance,
        internet_allowance: original.internet_allowance,
        meal_allowance: original.meal_allowance,
        transport_allowance: original.transport_allowance,
        uniform_allowance: original.uniform_allowance,
        books_periodicals: original.books_periodicals,
        fuel_maintenance: original.fuel_maintenance,
        nps_percentage: original.nps_percentage,
        vpf_percentage: original.vpf_percentage,
        other_earnings: original.other_earnings ?? [],
      };
      return payrollApi.createSalaryStructure(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['salary-structures'] });
    },
  });

  const handleEdit = (structure: SalaryStructure) => {
    setEditingId(structure.id);
    setFormData({
      name: structure.name,
      description: structure.description || '',
      basic_percentage: structure.basic_percentage,
      hra_percentage: structure.hra_percentage,
      conveyance_amount: structure.conveyance_amount,
      da_percentage: structure.da_percentage,
      cca_amount: structure.cca_amount,
      education_allowance: structure.education_allowance,
      internet_allowance: structure.internet_allowance,
      meal_allowance: structure.meal_allowance,
      transport_allowance: structure.transport_allowance,
      uniform_allowance: structure.uniform_allowance,
      books_periodicals: structure.books_periodicals,
      fuel_maintenance: structure.fuel_maintenance,
      nps_percentage: structure.nps_percentage,
      vpf_percentage: structure.vpf_percentage,
      other_earnings: structure.other_earnings ?? [],
      other_deductions: structure.other_deductions ?? [],
      is_default: structure.is_default,
    });
  };

  const handleSave = () => {
    if (editingId) {
      updateMutation.mutate({ id: editingId, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const breakdown = previewData?.breakdown;

  if (isLoading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="h-32 bg-gray-200 rounded"></div>
          <div className="h-32 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Salary Structure Templates</h2>
          <p className="text-sm text-gray-500 mt-1">
            Define percentage-based salary breakdowns for CTC calculations
          </p>
        </div>
        <button
          onClick={() => {
            setFormData(defaultFormData);
            setShowCreateModal(true);
          }}
          className="inline-flex items-center px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors"
        >
          <Plus className="w-4 h-4 mr-2" />
          New Structure
        </button>
      </div>

      <div className="space-y-3">
        {structures.length === 0 && (
          <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
            <p className="text-gray-500">No salary structures yet.</p>
            <p className="text-sm text-gray-400 mt-1">
              Create your first template to get started.
            </p>
          </div>
        )}

        {structures.map((structure) => (
          <div key={structure.id} className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div
              className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-50"
              onClick={() => setExpandedId(expandedId === structure.id ? null : structure.id)}
            >
              <div className="flex items-center gap-3">
                {expandedId === structure.id ? (
                  <ChevronDown className="w-4 h-4 text-gray-400" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-gray-400" />
                )}
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900">{structure.name}</span>
                    {structure.is_default && (
                      <span className="px-2 py-0.5 text-xs bg-indigo-100 text-indigo-700 rounded">
                        Default
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-500">
                    Basic {structure.basic_percentage}% • HRA {structure.hra_percentage}%
                    {structure.conveyance_amount > 0 && ` • Conv ₹${structure.conveyance_amount}`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => handleEdit(structure)}
                  className="p-1.5 text-gray-400 hover:text-gray-600 rounded"
                  title="Edit"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                <button
                  onClick={() => duplicateMutation.mutate(structure.id)}
                  className="p-1.5 text-gray-400 hover:text-gray-600 rounded"
                  title="Duplicate"
                >
                  <Copy className="w-4 h-4" />
                </button>
                {!structure.is_default && (
                  <button
                    onClick={() => {
                      if (confirm('Delete this structure?')) {
                        deleteMutation.mutate(structure.id);
                      }
                    }}
                    className="p-1.5 text-gray-400 hover:text-red-600 rounded"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {expandedId === structure.id && (
              <div className="border-t border-gray-200 px-4 py-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-3">Structure Details</h4>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="flex justify-between py-2 border-b border-gray-100">
                        <span className="text-gray-500">Basic %</span>
                        <span className="font-medium">{structure.basic_percentage}%</span>
                      </div>
                      <div className="flex justify-between py-2 border-b border-gray-100">
                        <span className="text-gray-500">HRA %</span>
                        <span className="font-medium">{structure.hra_percentage}%</span>
                      </div>
                      <div className="flex justify-between py-2 border-b border-gray-100">
                        <span className="text-gray-500">Conveyance</span>
                        <span className="font-medium">₹{(structure.conveyance_amount ?? 0).toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between py-2 border-b border-gray-100">
                        <span className="text-gray-500">DA %</span>
                        <span className="font-medium">{structure.da_percentage}%</span>
                      </div>
                      <div className="flex justify-between py-2 border-b border-gray-100">
                        <span className="text-gray-500">CCA</span>
                        <span className="font-medium">₹{(structure.cca_amount ?? 0).toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between py-2 border-b border-gray-100">
                        <span className="text-gray-500">NPS %</span>
                        <span className="font-medium">{structure.nps_percentage}%</span>
                      </div>
                      <div className="flex justify-between py-2 border-b border-gray-100">
                        <span className="text-gray-500">VPF %</span>
                        <span className="font-medium">{structure.vpf_percentage}%</span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <Calculator className="w-4 h-4 text-gray-400" />
                      <h4 className="text-sm font-medium text-gray-700">CTC Preview</h4>
                    </div>
                    <div className="mb-3">
                      <label className="text-xs text-gray-500 mb-1 block">Annual CTC (₹)</label>
                      <input
                        type="number"
                        value={previewCtc}
                        onChange={(e) => setPreviewCtc(e.target.value)}
                        placeholder="Enter CTC to preview"
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-indigo-500 focus:border-indigo-500"
                      />
                    </div>

                    {breakdown && (
                      <div className="bg-gray-50 rounded-md p-3 text-sm space-y-2">
                        <div className="flex items-center justify-between font-medium text-gray-900 pb-2 border-b border-gray-200">
                          <span>Monthly Breakdown</span>
                          <span>₹{(breakdown?.monthly_ctc ?? 0).toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Basic</span>
                          <span>₹{(breakdown?.basic?.monthly ?? 0).toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">HRA</span>
                          <span>₹{(breakdown?.hra?.monthly ?? 0).toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Conveyance</span>
                          <span>₹{(breakdown?.conveyance?.monthly ?? 0).toLocaleString()}</span>
                        </div>
                        {breakdown.da.monthly > 0 && (
                          <div className="flex justify-between">
                            <span className="text-gray-600">DA</span>
                            <span>₹{(breakdown?.da?.monthly ?? 0).toLocaleString()}</span>
                          </div>
                        )}
                        {breakdown.nps.monthly > 0 && (
                          <div className="flex justify-between">
                            <span className="text-gray-600">NPS</span>
                            <span>₹{(breakdown?.nps?.monthly ?? 0).toLocaleString()}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {(showCreateModal || editingId) && (
        <Modal
          open
          onClose={() => {
            setShowCreateModal(false);
            setEditingId(null);
          }}
          titleId="salary-structure-template-title"
          size="2xl"
          panelClassName="max-h-[90vh]"
        >
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h3 id="salary-structure-template-title" className="text-lg font-medium text-gray-900">
                {editingId ? 'Edit Structure' : 'New Salary Structure'}
              </h3>
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setEditingId(null);
                }}
                className="p-1 text-gray-400 hover:text-gray-600 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-4 space-y-5">
              {/* Name & Description */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm
                             focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400 outline-none"
                  placeholder="e.g., Standard 50-50"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm
                             focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400 outline-none"
                  rows={2}
                  placeholder="Optional description"
                />
              </div>

              {/* ── Salary Components Card ── */}
              <div className="bg-gray-50 rounded-xl border border-gray-200 p-4">
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                  Salary Components
                </h4>

                {/* Percentage-based */}
                <PctInput label="Basic %" value={formData.basic_percentage} onChange={(v) => setFormData({ ...formData, basic_percentage: v })} />
                <PctInput label="HRA %" value={formData.hra_percentage} onChange={(v) => setFormData({ ...formData, hra_percentage: v })} />
                <PctInput label="DA %" value={formData.da_percentage} onChange={(v) => setFormData({ ...formData, da_percentage: v })} />
                <PctInput label="NPS %" value={formData.nps_percentage} onChange={(v) => setFormData({ ...formData, nps_percentage: v })} />
                <PctInput label="VPF %" value={formData.vpf_percentage} onChange={(v) => setFormData({ ...formData, vpf_percentage: v })} />

                {/* Divider */}
                <div className="flex items-center gap-3 my-3">
                  <div className="flex-1 border-t border-gray-200"></div>
                  <span className="text-xs text-gray-400 whitespace-nowrap">Fixed Amounts (₹/month)</span>
                  <div className="flex-1 border-t border-gray-200"></div>
                </div>

                {/* Fixed amounts */}
                <RupeeInput label="Conveyance" value={formData.conveyance_amount} onChange={(v) => setFormData({ ...formData, conveyance_amount: v })} />
                <RupeeInput label="CCA" value={formData.cca_amount} onChange={(v) => setFormData({ ...formData, cca_amount: v })} />
                <RupeeInput label="Education Allowance" value={formData.education_allowance} onChange={(v) => setFormData({ ...formData, education_allowance: v })} />
                <RupeeInput label="Internet Allowance" value={formData.internet_allowance} onChange={(v) => setFormData({ ...formData, internet_allowance: v })} />
                <RupeeInput label="Meal Allowance" value={formData.meal_allowance} onChange={(v) => setFormData({ ...formData, meal_allowance: v })} />
                <RupeeInput label="Transport Allowance" value={formData.transport_allowance} onChange={(v) => setFormData({ ...formData, transport_allowance: v })} />
                <RupeeInput label="Uniform Allowance" value={formData.uniform_allowance} onChange={(v) => setFormData({ ...formData, uniform_allowance: v })} />
                <RupeeInput label="Books & Periodicals" value={formData.books_periodicals} onChange={(v) => setFormData({ ...formData, books_periodicals: v })} />
                <RupeeInput label="Fuel & Maintenance" value={formData.fuel_maintenance} onChange={(v) => setFormData({ ...formData, fuel_maintenance: v })} />

                {/* ── Other Earnings ── */}
                <div className="flex items-center gap-3 my-3">
                  <div className="flex-1 border-t border-gray-200"></div>
                  <span className="text-xs text-gray-400 whitespace-nowrap">Other Earnings</span>
                  <div className="flex-1 border-t border-gray-200"></div>
                </div>

                {formData.other_earnings.length > 0 && (
                  <div className="space-y-1">
                    {formData.other_earnings.map((item, idx) => (
                      <OtherEarningRow
                        key={idx}
                        item={item}
                        index={idx}
                        onChange={(i, field, val) => {
                          const updated = [...formData.other_earnings];
                          (updated[i] as any)[field] = val;
                          setFormData({ ...formData, other_earnings: updated });
                        }}
                        onRemove={(i) => {
                          setFormData({
                            ...formData,
                            other_earnings: formData.other_earnings.filter((_, j) => j !== i),
                          });
                        }}
                      />
                    ))}
                  </div>
                )}

                <button
                  onClick={() =>
                    setFormData({
                      ...formData,
                      other_earnings: [
                        ...formData.other_earnings,
                        { name: '', type: 'fixed', value: 0 },
                      ],
                    })
                  }
                  className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium
                             text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-lg
                             hover:bg-indigo-100 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Earning
                </button>

                {/* ── Other Deductions ── */}
                <div className="flex items-center gap-3 my-3">
                  <div className="flex-1 border-t border-gray-200"></div>
                  <span className="text-xs text-gray-400 whitespace-nowrap">Other Deductions</span>
                  <div className="flex-1 border-t border-gray-200"></div>
                </div>

                {formData.other_deductions.length > 0 && (
                  <div className="space-y-1">
                    {formData.other_deductions.map((item, idx) => (
                      <OtherEarningRow
                        key={idx}
                        item={item}
                        index={idx}
                        onChange={(i, field, val) => {
                          const updated = [...formData.other_deductions];
                          (updated[i] as any)[field] = val;
                          setFormData({ ...formData, other_deductions: updated });
                        }}
                        onRemove={(i) => {
                          setFormData({
                            ...formData,
                            other_deductions: formData.other_deductions.filter((_, j) => j !== i),
                          });
                        }}
                      />
                    ))}
                  </div>
                )}

                <button
                  onClick={() =>
                    setFormData({
                      ...formData,
                      other_deductions: [
                        ...formData.other_deductions,
                        { name: '', type: 'fixed', value: 0 },
                      ],
                    })
                  }
                  className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium
                             text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-lg
                             hover:bg-indigo-100 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Deduction
                </button>
              </div>

              {/* Default checkbox */}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="is_default"
                  checked={formData.is_default}
                  onChange={(e) => setFormData({ ...formData, is_default: e.target.checked })}
                  className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                />
                <label htmlFor="is_default" className="text-sm text-gray-700">
                  Set as default structure
                </label>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50">
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setEditingId(null);
                }}
                className="px-4 py-2 text-sm text-gray-700 hover:text-gray-900"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!formData.name}
                className="inline-flex items-center px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Save className="w-4 h-4 mr-2" />
                {editingId ? 'Update' : 'Create'}
              </button>
            </div>
        </Modal>
      )}
    </div>
  );
}
