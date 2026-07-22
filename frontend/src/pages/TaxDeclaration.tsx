import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, Save, Send, CheckCircle, XCircle, Upload, Plus, Trash2, IndianRupee } from 'lucide-react';
import { payrollApi, getApiErrorMessage } from '@/services/api';
import Button from '@/components/ui/Button';
import { TextInput, SelectInput, FieldLabel } from '@/components/ui/FormField';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import PageHeader from '@/components/dashboard/PageHeader';
import MetricCard from '@/components/dashboard/MetricCard';
import StatusBadge from '@/components/ui/StatusBadge';
import { formatPayrollAmount } from '@/components/ui/PayrollAmount';
import { useToast } from '@/components/ui/Toast';
import { payrollStatusTone, titleCase } from '@/utils/payrollStatus';

const FINANCIAL_YEARS = [
  '2024-25', '2025-26', '2026-27', '2027-28',
];

export default function TaxDeclarationPage() {
  const queryClient = useQueryClient();
  const { show } = useToast();
  const [financialYear, setFinancialYear] = useState('2025-26');
  const [items, setItems] = useState<any[]>([]);
  const [activeSection, setActiveSection] = useState('80C');

  const { data, isLoading } = useQuery({
    queryKey: ['tax-declaration', financialYear],
    queryFn: () => payrollApi.getMyTaxDeclaration({ financial_year: financialYear }).then(res => res.data),
  });

  const sections = data?.sections || {};
  const categories = data?.categories || {};
  const declaration = data?.declaration;

  useEffect(() => {
    if (declaration?.items) {
      setItems(declaration.items);
    } else {
      setItems([]);
    }
  }, [declaration]);

  const saveMutation = useMutation({
    mutationFn: (data: { items: any[] }) =>
      payrollApi.saveTaxDeclarationItems({ ...data, financial_year: financialYear }),
    onSuccess: () => {
      show({ kind: 'success', message: 'Declaration saved!' });
      queryClient.invalidateQueries({ queryKey: ['tax-declaration'] });
      queryClient.invalidateQueries({ queryKey: ['tax-declarations'] });
    },
    onError: (e: any) => show({ kind: 'error', message: getApiErrorMessage(e, 'Failed to save declaration.') }),
  });

  const submitMutation = useMutation({
    mutationFn: (declarationId: number) =>
      payrollApi.submitTaxDeclaration(declarationId),
    onSuccess: () => {
      show({ kind: 'success', message: 'Declaration submitted for approval!' });
      queryClient.invalidateQueries({ queryKey: ['tax-declaration'] });
      queryClient.invalidateQueries({ queryKey: ['tax-declarations'] });
    },
    onError: (e: any) => show({ kind: 'error', message: getApiErrorMessage(e, 'Failed to submit declaration.') }),
  });

  const addItem = (section: string) => {
    const cats = categories[section] || ['Other'];
    setItems(prev => [...prev, {
      id: null,
      section,
      category: cats[0],
      description: '',
      declared_amount: 0,
      approved_amount: 0,
      status: 'pending',
      proof_path: null,
    }]);
  };

  const updateItem = (index: number, field: string, value: any) => {
    setItems(prev => prev.map((item, i) => i === index ? { ...item, [field]: value } : item));
  };

  const removeItem = (index: number) => {
    setItems(prev => prev.filter((_, i) => i !== index));
  };

  const handleSave = () => {
    saveMutation.mutate({ items });
  };

  const handleSubmit = () => {
    if (!declaration?.id) return;
    submitMutation.mutate(declaration.id);
  };

  const handleUploadProof = async (itemId: number, file: File) => {
    try {
      await payrollApi.uploadTaxProof(itemId, file);
      show({ kind: 'success', message: 'Proof uploaded!' });
      queryClient.invalidateQueries({ queryKey: ['tax-declaration'] });
      queryClient.invalidateQueries({ queryKey: ['tax-declarations'] });
    } catch (e) {
      show({ kind: 'error', message: getApiErrorMessage(e, 'Failed to upload proof.') });
    }
  };

  const totalDeclared = items.reduce((sum, i) => sum + (parseFloat(i.declared_amount) || 0), 0);
  const sectionTotals = items.reduce((acc: Record<string, number>, i) => {
    acc[i.section] = (acc[i.section] || 0) + (parseFloat(i.declared_amount) || 0);
    return acc;
  }, {});

  const isLocked = declaration?.status === 'approved' || declaration?.status === 'rejected';
  const isSubmitted = declaration?.status === 'submitted';

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHeader title="Tax Declarations" description="Form 12BB - Declare your tax-saving investments" />

      <div className="p-6 max-w-6xl mx-auto space-y-6">
        {/* Header Controls */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <SelectInput value={financialYear} onChange={(e) => setFinancialYear(e.target.value)}>
              {FINANCIAL_YEARS.map(fy => <option key={fy} value={fy}>{fy}</option>)}
            </SelectInput>
            <StatusBadge tone={payrollStatusTone(declaration?.status)}>
              {titleCase(declaration?.status) || 'Draft'}
            </StatusBadge>
          </div>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <MetricCard label="Total Declared" value={formatPayrollAmount(totalDeclared)} accent="sky" icon={IndianRupee} />
          <MetricCard label="Approved" value={formatPayrollAmount(declaration?.approved_amount || 0)} accent="emerald" icon={CheckCircle} />
          <MetricCard label="Items" value={items.length} accent="violet" icon={FileText} />
          {declaration && (
            <MetricCard label="Status" value={titleCase(declaration.status) || 'Draft'} accent="slate" />
          )}
        </div>

        {/* Section Navigation */}
        <div className="flex gap-2 overflow-x-auto pb-2">
          {Object.entries(sections).map(([key]) => (
            <button
              key={key}
              onClick={() => setActiveSection(key)}
              className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                activeSection === key
                  ? 'bg-blue-600 text-white'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {key}
              {sectionTotals[key] > 0 && (
                <span className="ml-1 text-xs opacity-80">({formatPayrollAmount(sectionTotals[key])})</span>
              )}
            </button>
          ))}
        </div>

        {/* Items for Active Section */}
        <SurfaceCard>
          {isLoading ? (
            <div className="p-10 text-center text-slate-500">Loading declaration…</div>
          ) : (
            <>
              <div className="p-5 border-b border-slate-200 flex items-center justify-between">
                <h3 className="font-semibold text-slate-900">{sections[activeSection] || activeSection}</h3>
                {!isLocked && (
                  <Button variant="secondary" size="sm" iconLeft={<Plus className="h-3 w-3" />} onClick={() => addItem(activeSection)}>
                    Add
                  </Button>
                )}
              </div>

              <div className="p-5 space-y-4">
                {items.filter(i => i.section === activeSection).length === 0 ? (
                  <div className="text-center py-8 text-slate-500">
                    <FileText className="h-10 w-10 mx-auto mb-2 text-slate-300" />
                    <p>No declarations in this section</p>
                    {!isLocked && (
                      <Button variant="ghost" size="sm" className="mt-2" onClick={() => addItem(activeSection)}>
                        <Plus className="h-3 w-3 mr-1" /> Add Investment
                      </Button>
                    )}
                  </div>
                ) : (
                  items.filter(i => i.section === activeSection).map((item) => {
                    const realIdx = items.indexOf(item);
                    return (
                      <div key={realIdx} className="p-4 border border-slate-200 rounded-lg space-y-3">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          <div>
                            <FieldLabel>Category</FieldLabel>
                            <SelectInput
                              value={item.category}
                              onChange={(e) => updateItem(realIdx, 'category', e.target.value)}
                              disabled={isLocked}
                            >
                              {(categories[activeSection] || ['Other']).map((cat: string) => (
                                <option key={cat} value={cat}>{cat}</option>
                              ))}
                            </SelectInput>
                          </div>
                          <div>
                            <FieldLabel>Description</FieldLabel>
                            <TextInput
                              value={item.description || ''}
                              onChange={(e) => updateItem(realIdx, 'description', e.target.value)}
                              placeholder="Optional details"
                              disabled={isLocked}
                            />
                          </div>
                          <div>
                            <FieldLabel>Amount (Rs)</FieldLabel>
                            <div className="relative">
                              <TextInput
                                type="number"
                                value={item.declared_amount || 0}
                                onChange={(e) => updateItem(realIdx, 'declared_amount', parseFloat(e.target.value) || 0)}
                                min="0"
                                disabled={isLocked}
                              />
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center justify-between text-xs text-slate-500">
                          <div className="flex items-center gap-3">
                            {item.status === 'approved' && (
                              <span className="flex items-center gap-1 text-emerald-600">
                                <CheckCircle className="h-3 w-3" /> Approved: {formatPayrollAmount(item.approved_amount || 0)}
                              </span>
                            )}
                            {item.status === 'rejected' && (
                              <span className="flex items-center gap-1 text-rose-600">
                                <XCircle className="h-3 w-3" /> Rejected
                              </span>
                            )}
                            {item.proof_path && (
                              <span className="flex items-center gap-1 text-blue-600">
                                <Upload className="h-3 w-3" /> Proof uploaded
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            {item.id && !isLocked && (
                              <>
                                <label className="cursor-pointer text-blue-600 hover:text-blue-800">
                                  <Upload className="h-3 w-3 inline mr-1" />
                                  Upload Proof
                                  <input
                                    type="file"
                                    accept=".pdf,.jpg,.jpeg,.png"
                                    className="hidden"
                                    onChange={(e) => {
                                      const file = e.target.files?.[0];
                                      if (file && item.id) handleUploadProof(item.id, file);
                                    }}
                                  />
                                </label>
                              </>
                            )}
                            {!isLocked && (
                              <button onClick={() => removeItem(realIdx)} className="text-rose-500 hover:text-rose-700">
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </SurfaceCard>

        {/* Summary & Actions */}
        <SurfaceCard className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <p className="text-sm text-slate-500">Total Declared Amount</p>
              <p className="text-2xl font-bold text-slate-900">{formatPayrollAmount(totalDeclared)}</p>
              {declaration?.approved_amount > 0 && (
                <p className="text-sm text-emerald-600">Approved: {formatPayrollAmount(declaration.approved_amount)}</p>
              )}
            </div>
            <div className="flex gap-3">
              {!isLocked && (
                <Button
                  variant="secondary"
                  iconLeft={<Save className="h-4 w-4" />}
                  onClick={handleSave}
                  disabled={saveMutation.isPending}
                >
                  {saveMutation.isPending ? 'Saving...' : 'Save Draft'}
                </Button>
              )}
              {!isSubmitted && !isLocked && items.length > 0 && (
                <Button
                  variant="primary"
                  iconLeft={<Send className="h-4 w-4" />}
                  onClick={handleSubmit}
                  disabled={submitMutation.isPending}
                >
                  {submitMutation.isPending ? 'Submitting...' : 'Submit for Approval'}
                </Button>
              )}
              {declaration?.status === 'submitted' && (
                <div className="bg-blue-50 text-blue-700 px-4 py-2 rounded-lg text-sm">
                  Awaiting admin approval
                </div>
              )}
            </div>
          </div>
        </SurfaceCard>

        {/* Info */}
        <div className="bg-blue-50 rounded-lg p-4 text-sm text-blue-800 space-y-1">
          <p className="font-medium">Important Notes:</p>
          <ul className="list-disc list-inside text-blue-700 space-y-0.5">
            <li>Declarations are for the selected financial year (Apr-Mar)</li>
            <li>Upload proof documents for each declaration item (PDF/JPG/PNG, max 5MB)</li>
            <li>Admin will verify and approve/reject each item individually</li>
            <li>Once approved, declarations cannot be modified</li>
            <li>Submit before the deadline to avoid higher TDS deduction</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
