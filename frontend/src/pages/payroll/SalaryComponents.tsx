import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, ToggleLeft, ToggleRight, Pencil, Trash2, X, Save,
  AlertCircle, CheckCircle2, Loader2, FileText, Settings2
} from 'lucide-react';
import { payrollApi } from '@/services/api';
import type { SalaryComponent, SalaryFormula } from '@/types';
import Button from '@/components/ui/Button';

// ─── Formula Editor Modal ────────────────────────────────────────
function FormulaEditorModal({
  component,
  onClose,
  onSaved,
}: {
  component: SalaryComponent;
  onClose: () => void;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const existingFormula = component.formulas?.[0];

  const [expression, setExpression] = useState(existingFormula?.formula_expression ?? '');
  const [description, setDescription] = useState(existingFormula?.description ?? '');
  const [validationResult, setValidationResult] = useState<{ valid: boolean; message: string } | null>(null);
  const [testResult, setTestResult] = useState<number | null>(null);

  const saveMutation = useMutation({
    mutationFn: () => payrollApi.saveComponentFormula(component.id, {
      formula_expression: expression,
      description,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll', 'salary-components'] });
      onSaved();
    },
  });

  const validateMutation = useMutation({
    mutationFn: () => payrollApi.validateComponentFormula(component.id, { formula_expression: expression }),
    onSuccess: (res) => {
      setValidationResult({ valid: res.valid, message: res.message });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => {
      if (!existingFormula) return Promise.resolve({ success: true, message: 'noop' });
      return payrollApi.deleteComponentFormula(component.id, existingFormula.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll', 'salary-components'] });
      onSaved();
    },
  });

  // Variables available in formula
  const variables = ['CTC', 'MonthlyCTC', 'Basic', 'HRA', 'Conveyance', 'Medical', 'Special', 'Gross', 'BasicPct', 'HRAPct', 'PF', 'ESI', 'PT', 'TDS', 'NetPay', 'LOP', 'WorkingDays', 'PresentDays'];
  const functions = ['IF(cond, true, false)', 'MAX(a,b)', 'MIN(a,b)', 'ROUND(val,dec)'];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-200">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Formula — {component.name}</h3>
            <p className="text-sm text-slate-500">Define how this component is calculated</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* Result type info */}
          <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-xs text-blue-800">
            <strong>Category:</strong> {component.category === 'earning' ? 'Earning (added to gross)' : 'Deduction (subtracted from gross)'} ·{' '}
            <strong>Value Type:</strong> {component.value_type}
          </div>

          {/* Formula input */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Formula Expression</label>
            <textarea
              value={expression}
              onChange={(e) => { setExpression(e.target.value); setValidationResult(null); setTestResult(null); }}
              placeholder="e.g. (CTC * 0.08) / 12  or  IF(Gross > 21000, 0, Gross * 0.0075)"
              rows={3}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <p className="text-xs text-slate-500 mt-1">
              Use square brackets for variables (engine auto-replaces). Supports +, -, *, /, parentheses, and functions.
            </p>
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Description (optional)</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. 8% of CTC paid monthly as LTA"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Validation result */}
          {validationResult && (
            <div className={`rounded-lg p-3 text-sm flex items-center gap-2 ${
              validationResult.valid ? 'bg-emerald-50 border border-emerald-200 text-emerald-700' : 'bg-rose-50 border border-rose-200 text-rose-700'
            }`}>
              {validationResult.valid ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
              {validationResult.message}
              {testResult !== null && <span className="ml-2 font-mono">= ₹{testResult.toLocaleString('en-IN')}</span>}
            </div>
          )}

          {/* Test result */}
          {testResult !== null && (
            <div className="rounded-lg bg-violet-50 border border-violet-200 p-3 text-sm text-violet-700 flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Formula result: <strong className="font-mono">₹{testResult.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong>
            </div>
          )}

          {/* Available variables & functions */}
          <details className="rounded-lg border border-slate-200 p-3">
            <summary className="text-sm font-medium text-slate-700 cursor-pointer">Available Variables & Functions</summary>
            <div className="mt-3 space-y-2">
              <div>
                <p className="text-xs font-semibold text-slate-500 mb-1">Variables</p>
                <div className="flex flex-wrap gap-1">
                  {variables.map((v) => (
                    <button
                      key={v}
                      onClick={() => setExpression(prev => prev + `[${v}]`)}
                      className="px-2 py-0.5 rounded bg-slate-100 text-xs font-mono text-slate-700 hover:bg-blue-100 hover:text-blue-700 transition-colors"
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-500 mb-1">Functions</p>
                <div className="flex flex-wrap gap-1">
                  {functions.map((f) => (
                    <button
                      key={f}
                      onClick={() => setExpression(prev => prev + f.replace(/[()]/g, ''))}
                      className="px-2 py-0.5 rounded bg-slate-100 text-xs font-mono text-slate-700 hover:bg-blue-100 hover:text-blue-700 transition-colors"
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-xs text-slate-400">Click a variable to insert it into the formula</p>
            </div>
          </details>

          {/* Examples */}
          <details className="rounded-lg border border-slate-200 p-3">
            <summary className="text-sm font-medium text-slate-700 cursor-pointer">Common Examples</summary>
            <div className="mt-3 space-y-2 text-xs text-slate-600">
              <div className="flex justify-between items-center rounded bg-slate-50 p-2">
                <span>LTA (8% of CTC, monthly)</span>
                <code className="font-mono text-blue-600 cursor-pointer hover:underline"
                  onClick={() => setExpression('([CTC] * 0.08) / 12')}>(CTC * 0.08) / 12</code>
              </div>
              <div className="flex justify-between items-center rounded bg-slate-50 p-2">
                <span>ESI (0.75% of gross, only if ≤ ₹21k)</span>
                <code className="font-mono text-blue-600 cursor-pointer hover:underline"
                  onClick={() => setExpression('IF([Gross] <= 21000, [Gross] * 0.0075, 0)')}
                >IF(Gross≤21000, Gross*0.0075, 0)</code>
              </div>
              <div className="flex justify-between items-center rounded bg-slate-50 p-2">
                <span>Conveyance (flat ₹1,600)</span>
                <code className="font-mono text-blue-600 cursor-pointer hover:underline"
                  onClick={() => setExpression('1600')}>1600</code>
              </div>
              <div className="flex justify-between items-center rounded bg-slate-50 p-2">
                <span>HRA exemption helper</span>
                <code className="font-mono text-blue-600 cursor-pointer hover:underline"
                  onClick={() => setExpression('MIN([HRA], [Basic] * 0.5, [HRA] - [Basic] * 0.1)')}
                >MIN(HRA, Basic*0.5)</code>
              </div>
            </div>
          </details>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-5 border-t border-slate-200 bg-slate-50 rounded-b-xl">
          <div>
            {existingFormula && (
              <Button
                variant="ghost"
                size="sm"
                iconLeft={<Trash2 className="h-4 w-4" />}
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
              >
                Delete Formula
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => validateMutation.mutate()}
              disabled={!expression || validateMutation.isPending}
            >
              Validate
            </Button>
            <Button
              variant="primary"
              size="sm"
              iconLeft={<Save className="h-4 w-4" />}
              onClick={() => saveMutation.mutate()}
              disabled={!expression || saveMutation.isPending}
            >
              {saveMutation.isPending ? 'Saving...' : 'Save Formula'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Create/Edit Component Modal ────────────────────────────────
function ComponentModal({
  component,
  onClose,
  onSaved,
}: {
  component?: SalaryComponent;
  onClose: () => void;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const isEdit = !!component;

  const [form, setForm] = useState({
    name: component?.name ?? '',
    code: component?.code ?? '',
    category: component?.category ?? 'earning' as 'earning' | 'deduction',
    value_type: component?.value_type ?? 'flat' as 'flat' | 'percentage' | 'formula',
    calculation_basis: component?.calculation_basis ?? undefined as string | undefined,
    default_value: component?.default_value ?? 0,
    is_taxable: component?.is_taxable ?? true,
    is_compliance_component: component?.is_compliance_component ?? false,
  });

  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => {
      if (isEdit) {
        return payrollApi.updateSalaryComponent(component.id, form);
      }
      return payrollApi.createSalaryComponent(form);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll', 'salary-components'] });
      onSaved();
    },
    onError: (e: any) => {
      setError(e?.response?.data?.message || 'Failed to save component');
    },
  });

  const handleSubmit = () => {
    if (!form.name.trim() || !form.code.trim()) {
      setError('Name and code are required');
      return;
    }
    mutation.mutate();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-200">
          <h3 className="text-lg font-semibold text-slate-900">
            {isEdit ? 'Edit Component' : 'New Salary Component'}
          </h3>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {error && (
            <div className="rounded-lg bg-rose-50 border border-rose-200 p-3 text-sm text-rose-700 flex items-center gap-2">
              <AlertCircle className="h-4 w-4" /> {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Name *</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Transport Allowance"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Code *</label>
              <input
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                placeholder="e.g. TA"
                disabled={isEdit && component?.is_system_default}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono uppercase focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Category</label>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value as 'earning' | 'deduction' })}
                disabled={isEdit && component?.is_system_default}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100"
              >
                <option value="earning">Earning</option>
                <option value="deduction">Deduction</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Value Type</label>
              <select
                value={form.value_type}
                onChange={(e) => setForm({ ...form, value_type: e.target.value as 'flat' | 'percentage' | 'formula' })}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
              >
                <option value="flat">Flat Amount</option>
                <option value="percentage">Percentage</option>
                <option value="formula">Formula</option>
              </select>
            </div>
          </div>

          {form.value_type === 'percentage' && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Calculated On</label>
              <select
                value={form.calculation_basis ?? ''}
                onChange={(e) => setForm({ ...form, calculation_basis: e.target.value || undefined })}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
              >
                <option value="">— Select basis —</option>
                <option value="ctc">CTC</option>
                <option value="basic">Basic</option>
                <option value="gross">Gross</option>
              </select>
            </div>
          )}

          {form.value_type === 'flat' && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Default Amount (₹)</label>
              <input
                type="number"
                value={form.default_value}
                onChange={(e) => setForm({ ...form, default_value: parseFloat(e.target.value) || 0 })}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.is_taxable}
                onChange={(e) => setForm({ ...form, is_taxable: e.target.checked })}
                className="rounded border-slate-300"
              />
              Taxable
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.is_compliance_component}
                onChange={(e) => setForm({ ...form, is_compliance_component: e.target.checked })}
                className="rounded border-slate-300"
              />
              Compliance Component
            </label>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 p-5 border-t border-slate-200">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={mutation.isPending}
            iconLeft={mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          >
            {mutation.isPending ? 'Saving...' : isEdit ? 'Update' : 'Create'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────
export default function SalaryComponentsPage() {
  const queryClient = useQueryClient();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingComponent, setEditingComponent] = useState<SalaryComponent | undefined>(undefined);
  const [formulaComponent, setFormulaComponent] = useState<SalaryComponent | null>(null);
  const [activeTab, setActiveTab] = useState<'earning' | 'deduction'>('earning');

  // Fetch components
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['payroll', 'salary-components'],
    queryFn: () => payrollApi.listSalaryComponents(),
  });

  // Toggle mutation
  const toggleMutation = useMutation({
    mutationFn: (id: number) => payrollApi.toggleSalaryComponent(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll', 'salary-components'] });
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (id: number) => payrollApi.deleteSalaryComponent(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll', 'salary-components'] });
    },
  });

  const components = data?.components ?? [];
  const earnings = components.filter((c) => c.category === 'earning');
  const deductions = components.filter((c) => c.category === 'deduction');
  const activeComponents = activeTab === 'earning' ? earnings : deductions;

  const activeCount = components.filter((c) => c.is_active).length;
  const inactiveCount = components.filter((c) => !c.is_active).length;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Salary Components</h1>
          <p className="mt-1 text-sm text-slate-500">
            Define which earnings and deductions are available in your payroll. Toggle them on/off per pay group.
          </p>
        </div>
        <Button
          variant="primary"
          iconLeft={<Plus className="h-4 w-4" />}
          onClick={() => setShowCreateModal(true)}
        >
          Add Component
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500 uppercase tracking-wide">Total</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{components.length}</p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-xs text-emerald-600 uppercase tracking-wide">Active</p>
          <p className="mt-1 text-2xl font-semibold text-emerald-700">{activeCount}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs text-slate-500 uppercase tracking-wide">Inactive</p>
          <p className="mt-1 text-2xl font-semibold text-slate-700">{inactiveCount}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
        <button
          onClick={() => setActiveTab('earning')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'earning'
              ? 'bg-blue-100 text-blue-700'
              : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
          }`}
        >
          Earnings ({earnings.length})
        </button>
        <button
          onClick={() => setActiveTab('deduction')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'deduction'
              ? 'bg-blue-100 text-blue-700'
              : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
          }`}
        >
          Deductions ({deductions.length})
        </button>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-12 text-slate-500">
          <Loader2 className="h-6 w-6 animate-spin mr-2" />
          Loading components...
        </div>
      )}

      {/* Component list */}
      {!isLoading && activeComponents.length === 0 && (
        <div className="text-center py-12 rounded-xl border border-dashed border-slate-300 bg-slate-50">
          <Settings2 className="h-12 w-12 mx-auto text-slate-300 mb-3" />
          <p className="text-sm text-slate-500">No {activeTab} components defined yet.</p>
          <p className="text-xs text-slate-400 mt-1">Click "Add Component" to create one.</p>
        </div>
      )}

      {!isLoading && activeComponents.length > 0 && (
        <div className="space-y-2">
          {activeComponents.map((component) => (
            <div
              key={component.id}
              className={`rounded-xl border bg-white p-4 transition-all ${
                component.is_active ? 'border-slate-200' : 'border-slate-100 bg-slate-50 opacity-60'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  {/* Toggle */}
                  <button
                    onClick={() => toggleMutation.mutate(component.id)}
                    disabled={toggleMutation.isPending}
                    className="flex-shrink-0"
                    title={component.is_active ? 'Click to disable' : 'Click to enable'}
                  >
                    {component.is_active ? (
                      <ToggleRight className="h-8 w-8 text-emerald-500" />
                    ) : (
                      <ToggleLeft className="h-8 w-8 text-slate-400" />
                    )}
                  </button>

                  {/* Info */}
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-900">{component.name}</span>
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 text-[10px] font-mono text-slate-500">
                        {component.code}
                      </span>
                      {component.is_system_default && (
                        <span className="px-1.5 py-0.5 rounded bg-blue-100 text-[10px] text-blue-600">
                          System
                        </span>
                      )}
                      {!component.is_active && (
                        <span className="px-1.5 py-0.5 rounded bg-slate-200 text-[10px] text-slate-500">
                          Disabled
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-xs text-slate-500">
                      <span className="capitalize">{component.value_type}</span>
                      {component.value_type === 'flat' && component.default_value > 0 && (
                        <span>· ₹{component.default_value.toLocaleString('en-IN')}</span>
                      )}
                      {component.value_type === 'percentage' && component.calculation_basis && (
                        <span>· % of {component.calculation_basis.toUpperCase()}</span>
                      )}
                      {component.formulas && component.formulas.length > 0 && (
                        <span className="font-mono text-blue-600">· {component.formulas[0].formula_expression}</span>
                      )}
                      {component.is_taxable && <span>· Taxable</span>}
                      {component.is_compliance_component && <span>· Statutory</span>}
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1">
                  {(component.value_type === 'formula' || component.formulas?.length) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      iconLeft={<FileText className="h-4 w-4" />}
                      onClick={() => setFormulaComponent(component)}
                    >
                      Formula
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    iconLeft={<Pencil className="h-4 w-4" />}
                    onClick={() => setEditingComponent(component)}
                  />
                  {!component.is_system_default && (
                    <Button
                      variant="ghost"
                      size="sm"
                      iconLeft={<Trash2 className="h-4 w-4" />}
                      onClick={() => {
                        if (confirm(`Delete "${component.name}"?`)) {
                          deleteMutation.mutate(component.id);
                        }
                      }}
                      disabled={deleteMutation.isPending}
                    />
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Info note */}
      <div className="rounded-xl bg-blue-50 border border-blue-200 p-4 text-sm text-blue-800">
        <p className="font-medium mb-1">How it works</p>
        <ul className="text-blue-700 space-y-1 list-disc list-inside text-xs">
          <li>Components defined here are available across all pay groups</li>
          <li>Toggle a component off to hide it from payroll processing (it won't appear in any pay group)</li>
          <li>Use <strong>Formula</strong> type with expressions like <code className="bg-blue-100 px-1 rounded">(CTC * 0.08) / 12</code> for dynamic calculation</li>
          <li>Per-pay-group enable/disable is available in each pay group's settings</li>
        </ul>
      </div>

      {/* Modals */}
      {showCreateModal && (
        <ComponentModal
          onClose={() => setShowCreateModal(false)}
          onSaved={() => { setShowCreateModal(false); refetch(); }}
        />
      )}
      {editingComponent && (
        <ComponentModal
          component={editingComponent}
          onClose={() => setEditingComponent(undefined)}
          onSaved={() => { setEditingComponent(undefined); refetch(); }}
        />
      )}
      {formulaComponent && (
        <FormulaEditorModal
          component={formulaComponent}
          onClose={() => setFormulaComponent(null)}
          onSaved={() => { setFormulaComponent(null); refetch(); }}
        />
      )}
    </div>
  );
}
