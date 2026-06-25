import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Trash2, ChevronDown, ChevronRight, X, Save, Settings, Building2, FileText, ToggleLeft, ToggleRight, ArrowLeft } from 'lucide-react';
import { payrollApi } from '@/services/api';
import Button from '@/components/ui/Button';
import type { PayGroupSettings, CreatePayGroupSettingsPayload, SalaryStructure, PayGroupFilingDetail } from '@/types';

const INDIAN_STATES = [
  { code: 'andhra_pradesh', name: 'Andhra Pradesh' },
  { code: 'bihar', name: 'Bihar' },
  { code: 'delhi', name: 'Delhi' },
  { code: 'gujarat', name: 'Gujarat' },
  { code: 'karnataka', name: 'Karnataka' },
  { code: 'kerala', name: 'Kerala' },
  { code: 'madhya_pradesh', name: 'Madhya Pradesh' },
  { code: 'maharashtra', name: 'Maharashtra' },
  { code: 'punjab', name: 'Punjab' },
  { code: 'rajasthan', name: 'Rajasthan' },
  { code: 'tamil_nadu', name: 'Tamil Nadu' },
  { code: 'telangana', name: 'Telangana' },
  { code: 'uttar_pradesh', name: 'Uttar Pradesh' },
  { code: 'west_bengal', name: 'West Bengal' },
];

export default function PayGroupSettings({ onBack, payGroupId }: { onBack: () => void; payGroupId?: number }) {
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingFilingState, setEditingFilingState] = useState<string | null>(null);

  const [formData, setFormData] = useState<{
    name: string;
    code: string;
    description: string;
    pay_frequency: 'monthly' | 'weekly' | 'biweekly';
    pay_day: number;
    pay_day_type: 'fixed' | 'last_working' | 'last_day';
    salary_template_id: string;
    statutory_rules: {
      pf_enabled: boolean;
      esi_enabled: boolean;
      pt_enabled: boolean;
      lwf_enabled: boolean;
      tds_enabled: boolean;
    };
  }>({
    name: '',
    code: '',
    description: '',
    pay_frequency: 'monthly',
    pay_day: 1,
    pay_day_type: 'last_working',
    salary_template_id: '',
    statutory_rules: {
      pf_enabled: true,
      esi_enabled: true,
      pt_enabled: true,
      lwf_enabled: false,
      tds_enabled: true,
    },
  });

  const [filingFormData, setFilingFormData] = useState<{
    state_code: string;
    state_name: string;
    pt_enabled: boolean;
    pt_establishment_id: string;
    pt_registration_date: string;
    pt_signatory: string;
    lwf_enabled: boolean;
    lwf_establishment_id: string;
    lwf_registration_date: string;
    lwf_signatory: string;
    pf_registration_number: string;
    pf_group_code: string;
    esi_registration_number: string;
  }>({
    state_code: '',
    state_name: '',
    pt_enabled: false,
    pt_establishment_id: '',
    pt_registration_date: '',
    pt_signatory: '',
    lwf_enabled: false,
    lwf_establishment_id: '',
    lwf_registration_date: '',
    lwf_signatory: '',
    pf_registration_number: '',
    pf_group_code: '',
    esi_registration_number: '',
  });

  const { data: settingsData, isLoading } = useQuery({
    queryKey: ['pay-group-settings'],
    queryFn: () => payrollApi.getPayGroupSettings(),
  });

  const { data: structuresData } = useQuery({
    queryKey: ['salary-structures'],
    queryFn: () => payrollApi.getSalaryStructures(),
  });

  const payGroups = settingsData?.data?.pay_groups || [];
  const structures = structuresData?.data?.templates || [];

  // When payGroupId is provided, scope to that single group
  const scopedGroups = payGroupId
    ? payGroups.filter((pg: PayGroupSettings) => pg.id === payGroupId)
    : payGroups;
  const isScoped = !!payGroupId;

  const createMutation = useMutation({
    mutationFn: (data: CreatePayGroupSettingsPayload) => payrollApi.createPayGroupSettings(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pay-group-settings'] });
      setShowCreateModal(false);
      resetFormData();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<CreatePayGroupSettingsPayload> }) =>
      payrollApi.updatePayGroupSettings(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pay-group-settings'] });
      setEditingId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => payrollApi.deletePayGroupSettings(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pay-group-settings'] });
      setExpandedId(null);
    },
  });

  const updateStatutoryMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>     payrollApi.updatePayGroupStatutoryRules(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pay-group-settings'] });
    },
  });

  const updateFilingMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>     payrollApi.updatePayGroupFilingDetails(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pay-group-settings'] });
      setEditingFilingState(null);
    },
  });

  const resetFormData = () => {
    setFormData({
      name: '',
      code: '',
      description: '',
      pay_frequency: 'monthly',
      pay_day: 1,
      pay_day_type: 'last_working',
      salary_template_id: '',
      statutory_rules: {
        pf_enabled: true,
        esi_enabled: true,
        pt_enabled: true,
        lwf_enabled: false,
        tds_enabled: true,
      },
    });
  };

  const handleEdit = (pg: PayGroupSettings) => {
    setEditingId(pg.id);
    setFormData({
      name: pg.name,
      code: pg.code,
      description: pg.description || '',
      pay_frequency: pg.pay_frequency,
      pay_day: pg.pay_day,
      pay_day_type: pg.pay_day_type,
      salary_template_id: pg.salary_template_id?.toString() || '',
      statutory_rules: {
        pf_enabled: pg.statutory_rules?.pf_enabled ?? true,
        esi_enabled: pg.statutory_rules?.esi_enabled ?? true,
        pt_enabled: pg.statutory_rules?.pt_enabled ?? true,
        lwf_enabled: pg.statutory_rules?.lwf_enabled ?? false,
        tds_enabled: pg.statutory_rules?.tds_enabled ?? true,
      },
    });
  };

  const handleSave = () => {
    const payload: CreatePayGroupSettingsPayload = {
      name: formData.name,
      code: formData.code,
      description: formData.description || undefined,
      pay_frequency: formData.pay_frequency,
      pay_day: formData.pay_day,
      pay_day_type: formData.pay_day_type,
      salary_template_id: formData.salary_template_id ? parseInt(formData.salary_template_id) : undefined,
      statutory_rules: formData.statutory_rules,
    };

    if (editingId) {
      updateMutation.mutate({ id: editingId, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const handleToggleStatutory = (pgId: number, key: keyof typeof formData.statutory_rules) => {
    const pg = payGroups.find((p: PayGroupSettings) => p.id === pgId);
    if (!pg) return;

    const newRules = {
      ...pg.statutory_rules,
      [key]: !pg.statutory_rules[key],
    };

    updateStatutoryMutation.mutate({ id: pgId, data: newRules });
  };

  const handleAddFilingDetail = (pgId: number) => {
    if (!filingFormData.state_code) return;

    const state = INDIAN_STATES.find((s) => s.code === filingFormData.state_code);
    if (!state) return;

    const pg = payGroups.find((p: PayGroupSettings) => p.id === pgId);
    if (!pg) return;

    const existingDetails = pg.filing_details || [];
    const newDetail = {
      state_code: filingFormData.state_code,
      state_name: state.name,
      pt_enabled: filingFormData.pt_enabled,
      pt_establishment_id: filingFormData.pt_establishment_id || null,
      pt_registration_date: filingFormData.pt_registration_date || null,
      pt_signatory: filingFormData.pt_signatory || null,
      lwf_enabled: filingFormData.lwf_enabled,
      lwf_establishment_id: filingFormData.lwf_establishment_id || null,
      lwf_registration_date: filingFormData.lwf_registration_date || null,
      lwf_signatory: filingFormData.lwf_signatory || null,
      pf_registration_number: filingFormData.pf_registration_number || null,
      pf_group_code: filingFormData.pf_group_code || null,
      esi_registration_number: filingFormData.esi_registration_number || null,
    };

    const existingIndex = existingDetails.findIndex((d) => d.state_code === filingFormData.state_code);
    let updatedDetails;
    if (existingIndex >= 0) {
      updatedDetails = [...existingDetails];
      updatedDetails[existingIndex] = newDetail as any;
    } else {
      updatedDetails = [...existingDetails, newDetail as any];
    }

    updateFilingMutation.mutate({ id: pgId, data: { filing_details: updatedDetails } });
    setFilingFormData({
      state_code: '',
      state_name: '',
      pt_enabled: false,
      pt_establishment_id: '',
      pt_registration_date: '',
      pt_signatory: '',
      lwf_enabled: false,
      lwf_establishment_id: '',
      lwf_registration_date: '',
      lwf_signatory: '',
      pf_registration_number: '',
      pf_group_code: '',
      esi_registration_number: '',
    });
  };

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
      <div className="flex items-center gap-3 mb-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          iconLeft={<ArrowLeft className="h-4 w-4" />}
        >
          Back to Pay Group
        </Button>
      </div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">
            {isScoped ? `${scopedGroups[0]?.name ?? 'Pay Group'} Settings` : 'Pay Group Settings'}
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Configure pay frequency, statutory compliance, and state-wise filing details
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {scopedGroups.length === 0 && (
          <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
            <p className="text-gray-500">No pay groups configured yet.</p>
            <p className="text-sm text-gray-400 mt-1">Create your first pay group to get started.</p>
          </div>
        )}

        {scopedGroups.map((pg: PayGroupSettings) => (
          <div key={pg.id} className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div
              className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-50"
              onClick={() => setExpandedId(expandedId === pg.id ? null : pg.id)}
            >
              <div className="flex items-center gap-3">
                {expandedId === pg.id ? (
                  <ChevronDown className="w-4 h-4 text-gray-400" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-gray-400" />
                )}
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900">{pg.name}</span>
                    <span className="text-xs text-gray-400 px-2 py-0.5 bg-gray-100 rounded">
                      {pg.code}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500">
                    {pg.pay_frequency} • Pay on {pg.pay_day_type?.replace('_', ' ')}
                    {pg.salary_template && ` • ${pg.salary_template.name}`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => handleEdit(pg)}
                  className="p-1.5 text-gray-400 hover:text-gray-600 rounded"
                  title="Edit"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                <button
                  onClick={() => {
                    if (confirm('Delete this pay group?')) {
                      deleteMutation.mutate(pg.id);
                    }
                  }}
                  className="p-1.5 text-gray-400 hover:text-red-600 rounded"
                  title="Delete"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {expandedId === pg.id && (
              <div className="border-t border-gray-200 px-4 py-4">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <ToggleRight className="w-4 h-4 text-gray-400" />
                      <h4 className="text-sm font-medium text-gray-900">Statutory Compliance</h4>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { key: 'pf_enabled', label: 'PF' },
                        { key: 'esi_enabled', label: 'ESI' },
                        { key: 'pt_enabled', label: 'PT' },
                        { key: 'tds_enabled', label: 'TDS' },
                        { key: 'lwf_enabled', label: 'LWF' },
                      ].map(({ key, label }) => (
                        <button
                          key={key}
                          onClick={() => handleToggleStatutory(pg.id, key as 'pf_enabled')}
                          className={`flex items-center justify-between px-3 py-2 rounded-md border transition-colors ${
                            pg.statutory_rules?.[key as 'pf_enabled']
                              ? 'bg-green-50 border-green-200 text-green-800'
                              : 'bg-gray-50 border-gray-200 text-gray-600'
                          }`}
                        >
                          <span className="text-sm">{label}</span>
                          {pg.statutory_rules?.[key as 'pf_enabled'] ? (
                            <ToggleRight className="w-4 h-4 text-green-600" />
                          ) : (
                            <ToggleLeft className="w-4 h-4 text-gray-400" />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <Building2 className="w-4 h-4 text-gray-400" />
                      <h4 className="text-sm font-medium text-gray-900">State-wise Filing Details</h4>
                    </div>

                    {pg.filing_details && pg.filing_details.length > 0 && (
                      <div className="space-y-2 mb-4">
                        {pg.filing_details.map((fd: PayGroupFilingDetail) => (
                          <div
                            key={fd.id}
                            className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-md text-sm"
                          >
                            <div>
                              <span className="font-medium text-gray-900">{fd.state_name}</span>
                              <span className="text-xs text-gray-500 ml-2">
                                {fd.pt_enabled && 'PT'} {fd.lwf_enabled && 'LWF'}
                              </span>
                            </div>
                            <button
                              onClick={() => setEditingFilingState(fd.state_code)}
                              className="text-gray-400 hover:text-gray-600"
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="border border-gray-200 rounded-md p-3 space-y-3">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">State</label>
                        <select
                          value={filingFormData.state_code}
                          onChange={(e) => {
                            const state = INDIAN_STATES.find((s) => s.code === e.target.value);
                            setFilingFormData({
                              ...filingFormData,
                              state_code: e.target.value,
                              state_name: state?.name || '',
                            });
                          }}
                          className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-indigo-500 focus:border-indigo-500"
                        >
                          <option value="">Select state</option>
                          {INDIAN_STATES.map((s) => (
                            <option key={s.code} value={s.code}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="flex gap-4">
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={filingFormData.pt_enabled}
                            onChange={(e) =>
                              setFilingFormData({ ...filingFormData, pt_enabled: e.target.checked })
                            }
                            className="h-4 w-4 text-indigo-600 border-gray-300 rounded"
                          />
                          <span className="text-sm text-gray-700">PT</span>
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={filingFormData.lwf_enabled}
                            onChange={(e) =>
                              setFilingFormData({ ...filingFormData, lwf_enabled: e.target.checked })
                            }
                            className="h-4 w-4 text-indigo-600 border-gray-300 rounded"
                          />
                          <span className="text-sm text-gray-700">LWF</span>
                        </label>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">PF Number</label>
                          <input
                            type="text"
                            value={filingFormData.pf_registration_number}
                            onChange={(e) =>
                              setFilingFormData({ ...filingFormData, pf_registration_number: e.target.value })
                            }
                            className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-indigo-500 focus:border-indigo-500"
                            placeholder="PF reg. no."
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">ESI Number</label>
                          <input
                            type="text"
                            value={filingFormData.esi_registration_number}
                            onChange={(e) =>
                              setFilingFormData({ ...filingFormData, esi_registration_number: e.target.value })
                            }
                            className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-indigo-500 focus:border-indigo-500"
                            placeholder="ESI reg. no."
                          />
                        </div>
                      </div>

                      <button
                        onClick={() => handleAddFilingDetail(pg.id)}
                        disabled={!filingFormData.state_code}
                        className="w-full px-3 py-1.5 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Add Filing Detail
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {(showCreateModal || editingId) && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">
                {editingId ? 'Edit Pay Group' : 'New Pay Group'}
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

            <div className="px-6 py-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
                    placeholder="e.g., Engineering"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Code</label>
                  <input
                    type="text"
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
                    placeholder="e.g., ENG"
                    maxLength={10}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder="Optional description"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Pay Frequency</label>
                  <select
                    value={formData.pay_frequency}
                    onChange={(e) => setFormData({ ...formData, pay_frequency: e.target.value as any })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
                  >
                    <option value="monthly">Monthly</option>
                    <option value="biweekly">Bi-Weekly</option>
                    <option value="weekly">Weekly</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Pay Day Type</label>
                  <select
                    value={formData.pay_day_type}
                    onChange={(e) => setFormData({ ...formData, pay_day_type: e.target.value as any })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
                  >
                    <option value="last_working">Last Working Day</option>
                    <option value="last_day">Last Day of Month</option>
                    <option value="fixed">Fixed Day</option>
                  </select>
                </div>
              </div>

              {formData.pay_day_type === 'fixed' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Pay Day (1-31)</label>
                  <input
                    type="number"
                    value={formData.pay_day}
                    onChange={(e) => setFormData({ ...formData, pay_day: parseInt(e.target.value) || 1 })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
                    min={1}
                    max={31}
                  />
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Salary Structure</label>
                <select
                  value={formData.salary_template_id}
                  onChange={(e) => setFormData({ ...formData, salary_template_id: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
                >
                  <option value="">Use employee's assigned structure</option>
                  {structures.map((s: SalaryStructure) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
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
                disabled={!formData.name || !formData.code}
                className="inline-flex items-center px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Save className="w-4 h-4 mr-2" />
                {editingId ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
