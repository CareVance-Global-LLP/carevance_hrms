import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { payrollApi } from '@/services/api';
import Button from '@/components/ui/Button';
import { TextInput, TextareaInput, FieldLabel, SelectInput, ToggleInput } from '@/components/ui/FormField';
import Modal from '@/components/ui/dialog/Modal';
import type { SalaryStructure, CreateSalaryStructurePayload } from '@/types';

interface OtherItem {
  name: string;
  type: 'fixed' | 'percentage';
  value: number;
}

interface Props {
  structure: SalaryStructure | null;
  onClose: () => void;
}

const emptyForm = {
  name: '',
  description: '',
  basic_percentage: 50,
  hra_percentage: 50,
  conveyance_amount: 0,
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
  other_earnings: [] as OtherItem[],
  other_deductions: [] as OtherItem[],
  is_default: false,
};

export default function SalaryStructureFormModal({ structure, onClose }: Props) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(emptyForm);
  const isEdit = !!structure;

  useEffect(() => {
    if (structure) {
      setForm({
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
        other_earnings: (structure.other_earnings as OtherItem[]) ?? [],
        other_deductions: (structure.other_deductions as OtherItem[]) ?? [],
        is_default: structure.is_default,
      });
    }
  }, [structure]);

  const createMutation = useMutation({
    mutationFn: (data: CreateSalaryStructurePayload) => payrollApi.createSalaryStructure(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['salary-structures'] });
      onClose();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<CreateSalaryStructurePayload> }) =>
      payrollApi.updateSalaryStructure(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['salary-structures'] });
      onClose();
    },
  });

  const handleSave = () => {
    const payload: CreateSalaryStructurePayload = {
      name: form.name,
      description: form.description || undefined,
      basic_percentage: form.basic_percentage,
      hra_percentage: form.hra_percentage,
      conveyance_amount: form.conveyance_amount,
      da_percentage: form.da_percentage,
      cca_amount: form.cca_amount,
      education_allowance: form.education_allowance,
      internet_allowance: form.internet_allowance,
      meal_allowance: form.meal_allowance,
      transport_allowance: form.transport_allowance,
      uniform_allowance: form.uniform_allowance,
      books_periodicals: form.books_periodicals,
      fuel_maintenance: form.fuel_maintenance,
      nps_percentage: form.nps_percentage,
      vpf_percentage: form.vpf_percentage,
      other_earnings: form.other_earnings.length > 0 ? form.other_earnings : undefined,
      other_deductions: form.other_deductions.length > 0 ? form.other_deductions : undefined,
      is_default: form.is_default,
    };
    if (isEdit && structure) {
      updateMutation.mutate({ id: structure.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const addOtherItem = (field: 'other_earnings' | 'other_deductions') => {
    setForm((prev) => ({
      ...prev,
      [field]: [...prev[field], { name: '', type: 'fixed', value: 0 }],
    }));
  };

  const updateOtherItem = (field: 'other_earnings' | 'other_deductions', idx: number, key: string, val: any) => {
    setForm((prev) => {
      const items = [...prev[field]];
      (items[idx] as any)[key] = val;
      return { ...prev, [field]: items };
    });
  };

  const removeOtherItem = (field: 'other_earnings' | 'other_deductions', idx: number) => {
    setForm((prev) => ({
      ...prev,
      [field]: prev[field].filter((_, i) => i !== idx),
    }));
  };

  const busy = createMutation.isPending || updateMutation.isPending;

  return (
    <Modal
      open
      onClose={() => !busy && onClose()}
      title={isEdit ? 'Edit Template' : 'New Template'}
      size="2xl"
      panelClassName="max-h-[90vh]"
      busy={busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSave}
            disabled={!form.name}
            loading={busy}
          >
            {isEdit ? 'Update' : 'Create'}
          </Button>
        </>
      }
    >
      <div className="px-6 py-4 space-y-4">
        <div>
          <FieldLabel>Name</FieldLabel>
          <TextInput
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g., Standard 50/20/30"
          />
        </div>

        <div>
          <FieldLabel>Description</FieldLabel>
          <TextareaInput
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={2}
            placeholder="Optional"
          />
        </div>

        <div className="rounded-xl border border-slate-200 p-4 space-y-0">
          <PctRow label="Basic %" value={form.basic_percentage} onChange={(v) => setForm({ ...form, basic_percentage: v })} />
          <PctRow label="HRA %" value={form.hra_percentage} onChange={(v) => setForm({ ...form, hra_percentage: v })} />
          <PctRow label="DA %" value={form.da_percentage} onChange={(v) => setForm({ ...form, da_percentage: v })} />
          <PctRow label="NPS %" value={form.nps_percentage} onChange={(v) => setForm({ ...form, nps_percentage: v })} />
          <PctRow label="VPF %" value={form.vpf_percentage} onChange={(v) => setForm({ ...form, vpf_percentage: v })} />

          <div className="flex items-center gap-3 my-3">
            <div className="flex-1 border-t border-slate-200" />
            <span className="text-[10px] text-slate-500 uppercase tracking-wide">Fixed Amounts</span>
            <div className="flex-1 border-t border-slate-200" />
          </div>

          <MoneyRow label="Conveyance" value={form.conveyance_amount} onChange={(v) => setForm({ ...form, conveyance_amount: v })} />
          <MoneyRow label="CCA" value={form.cca_amount} onChange={(v) => setForm({ ...form, cca_amount: v })} />
          <MoneyRow label="Education Allowance" value={form.education_allowance} onChange={(v) => setForm({ ...form, education_allowance: v })} />
          <MoneyRow label="Internet Allowance" value={form.internet_allowance} onChange={(v) => setForm({ ...form, internet_allowance: v })} />
          <MoneyRow label="Meal Allowance" value={form.meal_allowance} onChange={(v) => setForm({ ...form, meal_allowance: v })} />
          <MoneyRow label="Transport Allowance" value={form.transport_allowance} onChange={(v) => setForm({ ...form, transport_allowance: v })} />
          <MoneyRow label="Uniform Allowance" value={form.uniform_allowance} onChange={(v) => setForm({ ...form, uniform_allowance: v })} />
          <MoneyRow label="Books & Periodicals" value={form.books_periodicals} onChange={(v) => setForm({ ...form, books_periodicals: v })} />
          <MoneyRow label="Fuel & Maintenance" value={form.fuel_maintenance} onChange={(v) => setForm({ ...form, fuel_maintenance: v })} />

          <OtherSection
            label="Other Earnings"
            items={form.other_earnings}
            onAdd={() => addOtherItem('other_earnings')}
            onChange={(i, k, v) => updateOtherItem('other_earnings', i, k, v)}
            onRemove={(i) => removeOtherItem('other_earnings', i)}
          />

          <OtherSection
            label="Other Deductions"
            items={form.other_deductions}
            onAdd={() => addOtherItem('other_deductions')}
            onChange={(i, k, v) => updateOtherItem('other_deductions', i, k, v)}
            onRemove={(i) => removeOtherItem('other_deductions', i)}
          />
        </div>

        <div className="flex items-center gap-3">
          <ToggleInput checked={form.is_default} onChange={(v) => setForm({ ...form, is_default: v })} />
          <span className="text-sm text-slate-700">Set as default</span>
        </div>
      </div>
    </Modal>
  );
}

function PctRow({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const [display, setDisplay] = useState(value === 0 ? '' : String(value));
  useEffect(() => { setDisplay(value === 0 ? '' : String(value)); }, [value]);
  return (
    <div className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
      <span className="text-xs text-slate-600">{label}</span>
      <div className="flex items-center gap-1">
        <TextInput
          type="number"
          value={display}
          onChange={(e) => { setDisplay(e.target.value); onChange(e.target.value === '' ? 0 : Number(e.target.value)); }}
          onBlur={() => setDisplay(value === 0 ? '' : String(value))}
          min={0}
          max={100}
          className="!w-16 !px-1.5 !py-1 !text-right !text-xs"
        />
        <span className="text-[11px] text-slate-500">%</span>
      </div>
    </div>
  );
}

function MoneyRow({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const [display, setDisplay] = useState(value === 0 ? '' : String(value));
  useEffect(() => { setDisplay(value === 0 ? '' : String(value)); }, [value]);
  return (
    <div className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
      <span className="text-xs text-slate-600">{label}</span>
      <div className="flex items-center gap-1">
        <span className="text-[11px] text-slate-500">₹</span>
        <TextInput
          type="number"
          value={display}
          onChange={(e) => { setDisplay(e.target.value); onChange(e.target.value === '' ? 0 : Number(e.target.value)); }}
          onBlur={() => setDisplay(value === 0 ? '' : String(value))}
          min={0}
          className="!w-20 !px-1.5 !py-1 !text-right !text-xs"
        />
      </div>
    </div>
  );
}

function OtherSection({
  label,
  items,
  onAdd,
  onChange,
  onRemove,
}: {
  label: string;
  items: OtherItem[];
  onAdd: () => void;
  onChange: (idx: number, key: string, val: any) => void;
  onRemove: (idx: number) => void;
}) {
  return (
    <div className="mt-3">
      <div className="flex items-center gap-3 mb-2">
        <div className="flex-1 border-t border-slate-200" />
        <span className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</span>
        <div className="flex-1 border-t border-slate-200" />
      </div>
      {items.map((item, idx) => (
        <div key={idx} className="flex items-center gap-1.5 py-1.5">
          <TextInput
            value={item.name}
            onChange={(e) => onChange(idx, 'name', e.target.value)}
            placeholder="Name"
            className="!flex-1 !px-2 !py-1 !text-xs"
          />
          <SelectInput
            value={item.type}
            onChange={(e) => onChange(idx, 'type', e.target.value)}
            className="!w-16 !px-1.5 !py-1 !text-xs"
          >
            <option value="fixed">₹</option>
            <option value="percentage">%</option>
          </SelectInput>
          <TextInput
            type="number"
            value={item.value === 0 ? '' : item.value}
            onChange={(e) => onChange(idx, 'value', e.target.value === '' ? 0 : Number(e.target.value))}
            min={0}
            className="!w-16 !px-1.5 !py-1 !text-right !text-xs"
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onRemove(idx)}
            iconLeft={<X className="h-3 w-3" />}
            className="!p-0.5 text-slate-300 hover:text-rose-500"
            aria-label="Remove item"
          />
        </div>
      ))}
      <Button
        variant="secondary"
        size="sm"
        iconLeft={<Plus className="h-3 w-3" />}
        onClick={onAdd}
        className="mt-1.5"
      >
        Add
      </Button>
    </div>
  );
}
