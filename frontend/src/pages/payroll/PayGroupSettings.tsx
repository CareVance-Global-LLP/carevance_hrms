import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Trash2, ChevronDown, ChevronRight, X, Save, Settings, Building2, FileText, ToggleLeft, ToggleRight, ArrowLeft } from 'lucide-react';
import { payrollApi } from '@/services/api';
import Button from '@/components/ui/Button';
import type { PayGroupSettings, CreatePayGroupSettingsPayload, SalaryStructure, PayGroupFilingDetail, UpdateFilingDetailsPayload } from '@/types';
import Modal from '@/components/ui/dialog/Modal';
import ComponentOverrideGates from '@/components/payroll/overrides/ComponentOverrideGates';

const INDIAN_STATES = [
  { code: 'andhra_pradesh', name: 'Andhra Pradesh' },
  { code: 'arunachal_pradesh', name: 'Arunachal Pradesh' },
  { code: 'assam', name: 'Assam' },
  { code: 'bihar', name: 'Bihar' },
  { code: 'chhattisgarh', name: 'Chhattisgarh' },
  { code: 'delhi', name: 'Delhi' },
  { code: 'goa', name: 'Goa' },
  { code: 'gujarat', name: 'Gujarat' },
  { code: 'haryana', name: 'Haryana' },
  { code: 'himachal_pradesh', name: 'Himachal Pradesh' },
  { code: 'jharkhand', name: 'Jharkhand' },
  { code: 'karnataka', name: 'Karnataka' },
  { code: 'kerala', name: 'Kerala' },
  { code: 'madhya_pradesh', name: 'Madhya Pradesh' },
  { code: 'maharashtra', name: 'Maharashtra' },
  { code: 'manipur', name: 'Manipur' },
  { code: 'meghalaya', name: 'Meghalaya' },
  { code: 'mizoram', name: 'Mizoram' },
  { code: 'nagaland', name: 'Nagaland' },
  { code: 'odisha', name: 'Odisha' },
  { code: 'punjab', name: 'Punjab' },
  { code: 'rajasthan', name: 'Rajasthan' },
  { code: 'sikkim', name: 'Sikkim' },
  { code: 'tamil_nadu', name: 'Tamil Nadu' },
  { code: 'telangana', name: 'Telangana' },
  { code: 'tripura', name: 'Tripura' },
  { code: 'uttar_pradesh', name: 'Uttar Pradesh' },
  { code: 'uttarakhand', name: 'Uttarakhand' },
  { code: 'west_bengal', name: 'West Bengal' },
  { code: 'jammu_kashmir', name: 'Jammu & Kashmir' },
  { code: 'ladakh', name: 'Ladakh' },
  { code: 'puducherry', name: 'Puducherry' },
  { code: 'chandigarh', name: 'Chandigarh' },
  { code: 'andaman_nicobar', name: 'Andaman & Nicobar' },
  { code: 'dadra_nagar_haveli', name: 'Dadra & Nagar Haveli and Daman & Diu' },
  { code: 'lakshadweep', name: 'Lakshadweep' },
];

// ============================================================================
// Comprehensive State Tax Configuration — All 36 Indian States & UTs
// Based on current government rates (2024-25)
// ============================================================================

interface FilingRefData {
  state_code: string;
  state_name: string;
  pt_enabled: boolean;
  pt_slabs: Array<{ min_income: number; max_income: number | null; monthly_tax: number }>;
  pt_annual_max: number;
  lwf_enabled: boolean;
  lwf_amount: number;
  lwf_frequency: 'monthly' | 'bi_annual' | 'annual' | 'not_applicable';
  pf_registration_number: string;
  esi_registration_number: string;
  effective_from: string;
  notes: string;
}

// PT Slabs per state — income ranges are monthly unless noted as annual
const DEFAULT_PT_SLABS: Record<string, Array<{ min_income: number; max_income: number | null; monthly_tax: number }>> = {
  maharashtra: [
    { min_income: 0, max_income: 7500, monthly_tax: 0 },
    { min_income: 7501, max_income: 10000, monthly_tax: 175 },
    { min_income: 10001, max_income: null, monthly_tax: 200 },
  ],
  gujarat: [
    { min_income: 0, max_income: 12000, monthly_tax: 0 },
    { min_income: 12001, max_income: 15000, monthly_tax: 150 },
    { min_income: 15001, max_income: null, monthly_tax: 200 },
  ],
  karnataka: [
    { min_income: 0, max_income: 15000, monthly_tax: 0 },
    { min_income: 15001, max_income: 25000, monthly_tax: 200 },
    { min_income: 25001, max_income: null, monthly_tax: 300 },
  ],
  tamil_nadu: [
    { min_income: 0, max_income: 21000, monthly_tax: 0 },
    { min_income: 21001, max_income: null, monthly_tax: 200 },
  ],
  west_bengal: [
    { min_income: 0, max_income: 10000, monthly_tax: 0 },
    { min_income: 10001, max_income: 15000, monthly_tax: 110 },
    { min_income: 15001, max_income: 25000, monthly_tax: 130 },
    { min_income: 25001, max_income: null, monthly_tax: 200 },
  ],
  andhra_pradesh: [
    { min_income: 0, max_income: 15000, monthly_tax: 0 },
    { min_income: 15001, max_income: 20000, monthly_tax: 150 },
    { min_income: 20001, max_income: null, monthly_tax: 200 },
  ],
  telangana: [
    { min_income: 0, max_income: 15000, monthly_tax: 0 },
    { min_income: 15001, max_income: 20000, monthly_tax: 150 },
    { min_income: 20001, max_income: null, monthly_tax: 200 },
  ],
  kerala: [
    { min_income: 0, max_income: 12000, monthly_tax: 0 },
    { min_income: 12001, max_income: 20000, monthly_tax: 120 },
    { min_income: 20001, max_income: null, monthly_tax: 200 },
  ],
  rajasthan: [
    { min_income: 0, max_income: 25000, monthly_tax: 0 },
    { min_income: 25001, max_income: null, monthly_tax: 200 },
  ],
  uttar_pradesh: [
    { min_income: 0, max_income: 21000, monthly_tax: 0 },
    { min_income: 21001, max_income: null, monthly_tax: 200 },
  ],
  madhya_pradesh: [
    { min_income: 0, max_income: 25000, monthly_tax: 0 },
    { min_income: 25001, max_income: null, monthly_tax: 200 },
  ],
  bihar: [
    { min_income: 0, max_income: 15000, monthly_tax: 0 },
    { min_income: 15001, max_income: null, monthly_tax: 200 },
  ],
  delhi: [
    { min_income: 0, max_income: 15000, monthly_tax: 0 },
    { min_income: 15001, max_income: 25000, monthly_tax: 150 },
    { min_income: 25001, max_income: null, monthly_tax: 200 },
  ],
  punjab: [
    { min_income: 0, max_income: 15000, monthly_tax: 0 },
    { min_income: 15001, max_income: null, monthly_tax: 200 },
  ],
  haryana: [
    { min_income: 0, max_income: 15000, monthly_tax: 0 },
    { min_income: 15001, max_income: null, monthly_tax: 200 },
  ],
  chhattisgarh: [
    { min_income: 0, max_income: 15000, monthly_tax: 0 },
    { min_income: 15001, max_income: null, monthly_tax: 200 },
  ],
  jharkhand: [
    { min_income: 0, max_income: 15000, monthly_tax: 0 },
    { min_income: 15001, max_income: null, monthly_tax: 200 },
  ],
  goa: [
    { min_income: 0, max_income: 15000, monthly_tax: 0 },
    { min_income: 15001, max_income: 25000, monthly_tax: 150 },
    { min_income: 25001, max_income: 40000, monthly_tax: 200 },
    { min_income: 40001, max_income: null, monthly_tax: 300 },
  ],
  odisha: [
    { min_income: 0, max_income: 15000, monthly_tax: 0 },
    { min_income: 15001, max_income: null, monthly_tax: 200 },
  ],
  assam: [
    { min_income: 0, max_income: 10000, monthly_tax: 0 },
    { min_income: 10001, max_income: 15000, monthly_tax: 150 },
    { min_income: 15001, max_income: 25000, monthly_tax: 180 },
    { min_income: 25001, max_income: null, monthly_tax: 200 },
  ],
  tripura: [
    { min_income: 0, max_income: 15000, monthly_tax: 0 },
    { min_income: 15001, max_income: 20000, monthly_tax: 100 },
    { min_income: 20001, max_income: null, monthly_tax: 200 },
  ],
  meghalaya: [
    { min_income: 0, max_income: 12000, monthly_tax: 0 },
    { min_income: 12001, max_income: 15000, monthly_tax: 100 },
    { min_income: 15001, max_income: null, monthly_tax: 200 },
  ],
  mizoram: [
    { min_income: 0, max_income: 15000, monthly_tax: 0 },
    { min_income: 15001, max_income: null, monthly_tax: 200 },
  ],
  jammu_kashmir: [
    { min_income: 0, max_income: 15000, monthly_tax: 0 },
    { min_income: 15001, max_income: null, monthly_tax: 200 },
  ],
  uttarakhand: [
    { min_income: 0, max_income: 15000, monthly_tax: 0 },
    { min_income: 15001, max_income: null, monthly_tax: 200 },
  ],
  ladakh: [
    { min_income: 0, max_income: 15000, monthly_tax: 0 },
    { min_income: 15001, max_income: null, monthly_tax: 200 },
  ],
  puducherry: [
    { min_income: 0, max_income: 15000, monthly_tax: 0 },
    { min_income: 15001, max_income: null, monthly_tax: 200 },
  ],
  chandigarh: [
    { min_income: 0, max_income: 15000, monthly_tax: 0 },
    { min_income: 15001, max_income: null, monthly_tax: 200 },
  ],
  himachal_pradesh: [], // No PT
  manipur: [], // No PT
  nagaland: [], // No PT
  sikkim: [], // No PT
  arunachal_pradesh: [], // No PT
  andaman_nicobar: [
    { min_income: 0, max_income: 15000, monthly_tax: 0 },
    { min_income: 15001, max_income: null, monthly_tax: 200 },
  ],
  dadra_nagar_haveli: [
    { min_income: 0, max_income: 15000, monthly_tax: 0 },
    { min_income: 15001, max_income: null, monthly_tax: 200 },
  ],
  lakshadweep: [
    { min_income: 0, max_income: 15000, monthly_tax: 0 },
    { min_income: 15001, max_income: null, monthly_tax: 200 },
  ],
};

// PT Annual Max per state
const PT_ANNUAL_MAX: Record<string, number> = {
  maharashtra: 2400, gujarat: 2400, karnataka: 3600, tamil_nadu: 2400,
  west_bengal: 2400, andhra_pradesh: 2400, telangana: 2400, kerala: 2400,
  rajasthan: 2400, uttar_pradesh: 2400, madhya_pradesh: 2400, bihar: 3600,
  delhi: 2400, punjab: 2400, haryana: 2400, chhattisgarh: 2400,
  jharkhand: 2400, goa: 3600, odisha: 2400, assam: 2400,
  tripura: 2400, meghalaya: 2400, mizoram: 2400, jammu_kashmir: 2400,
  uttarakhand: 2400, ladakh: 2400, puducherry: 2400, chandigarh: 2400,
  himachal_pradesh: 0, manipur: 0, nagaland: 0, sikkim: 0, arunachal_pradesh: 0,
  andaman_nicobar: 2400, dadra_nagar_haveli: 2400, lakshadweep: 2400,
};

// LWF Configuration per state
const LWF_CONFIG: Record<string, { enabled: boolean; amount: number; frequency: 'monthly' | 'bi_annual' | 'annual' | 'not_applicable' }> = {
  maharashtra: { enabled: true, amount: 50, frequency: 'monthly' },
  gujarat: { enabled: true, amount: 50, frequency: 'bi_annual' },
  karnataka: { enabled: true, amount: 15, frequency: 'monthly' },
  andhra_pradesh: { enabled: true, amount: 20, frequency: 'monthly' },
  telangana: { enabled: true, amount: 20, frequency: 'monthly' },
  tamil_nadu: { enabled: true, amount: 25, frequency: 'monthly' },
  west_bengal: { enabled: true, amount: 10, frequency: 'monthly' },
  kerala: { enabled: true, amount: 20, frequency: 'monthly' },
  bihar: { enabled: true, amount: 10, frequency: 'monthly' },
  delhi: { enabled: true, amount: 6, frequency: 'monthly' },
  madhya_pradesh: { enabled: true, amount: 18.75, frequency: 'monthly' },
  rajasthan: { enabled: true, amount: 10, frequency: 'monthly' },
  goa: { enabled: true, amount: 15, frequency: 'monthly' },
  odisha: { enabled: true, amount: 10, frequency: 'monthly' },
  himachal_pradesh: { enabled: false, amount: 0, frequency: 'not_applicable' },
  manipur: { enabled: false, amount: 0, frequency: 'not_applicable' },
  nagaland: { enabled: false, amount: 0, frequency: 'not_applicable' },
  sikkim: { enabled: false, amount: 0, frequency: 'not_applicable' },
  arunachal_pradesh: { enabled: false, amount: 0, frequency: 'not_applicable' },
};

// Helper: get LWF config for a state (default to not applicable)
function getLwfConfig(stateCode: string) {
  return LWF_CONFIG[stateCode] || { enabled: false, amount: 0, frequency: 'not_applicable' as const };
}

// Helper: check if state has PT
function hasPt(stateCode: string): boolean {
  const slabs = DEFAULT_PT_SLABS[stateCode];
  return slabs !== undefined && slabs.length > 0;
}

function StateWiseTaxConfig({
  filingReferenceData,
  setFilingReferenceData,
}: {
  filingReferenceData: FilingRefData[];
  setFilingReferenceData: React.Dispatch<React.SetStateAction<FilingRefData[]>>;
}) {
  const [selectedStateCode, setSelectedStateCode] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [editingSlabs, setEditingSlabs] = useState(false);

  const selectedState = INDIAN_STATES.find((s) => s.code === selectedStateCode);
  const selectedFiling = filingReferenceData.find((f) => f.state_code === selectedStateCode);
  const stateHasPt = selectedStateCode ? hasPt(selectedStateCode) : true;
  const stateLwf = selectedStateCode ? getLwfConfig(selectedStateCode) : { enabled: false, amount: 0, frequency: 'not_applicable' as const };

  const filteredStates = INDIAN_STATES.filter(
    (s) =>
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.code.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const activePills = filingReferenceData.filter((f) => f.pt_enabled || f.lwf_enabled);
  const noPtCount = INDIAN_STATES.filter((s) => !hasPt(s.code)).length;

  const handleEnableAll = () => {
      setFilingReferenceData(() =>
        INDIAN_STATES.filter((s) => hasPt(s.code)).map((s) => {
          const existing = filingReferenceData.find((f) => f.state_code === s.code);
          return existing
            ? { ...existing, pt_enabled: true }
            : {
                state_code: s.code,
                state_name: s.name,
                pt_enabled: true,
                pt_slabs: DEFAULT_PT_SLABS[s.code] || [{ min_income: 0, max_income: null, monthly_tax: 200 }],
                pt_annual_max: PT_ANNUAL_MAX[s.code] || 2400,
                lwf_enabled: getLwfConfig(s.code).enabled,
                lwf_amount: getLwfConfig(s.code).amount,
                lwf_frequency: getLwfConfig(s.code).frequency,
                pf_registration_number: '',
                esi_registration_number: '',
                effective_from: new Date().toISOString().split('T')[0],
                notes: '',
              };
        })
      );
    };

    const handleDisableAll = () => {
      setFilingReferenceData((prev) =>
        prev.map((f) => ({ ...f, pt_enabled: false, lwf_enabled: false }))
      );
    };

    const handleToggleState = () => {
      if (!selectedStateCode) return;
      setFilingReferenceData((prev) => {
        const existing = prev.find((f) => f.state_code === selectedStateCode);
        if (existing) {
          return prev.map((f) =>
            f.state_code === selectedStateCode ? { ...f, pt_enabled: !f.pt_enabled } : f
          );
        }
        return [
          ...prev,
          {
            state_code: selectedStateCode,
            state_name: INDIAN_STATES.find((s) => s.code === selectedStateCode)?.name || '',
            pt_enabled: true,
            pt_slabs: DEFAULT_PT_SLABS[selectedStateCode] || [{ min_income: 0, max_income: null, monthly_tax: 200 }],
            pt_annual_max: PT_ANNUAL_MAX[selectedStateCode] || 2400,
            lwf_enabled: getLwfConfig(selectedStateCode).enabled,
            lwf_amount: getLwfConfig(selectedStateCode).amount,
            lwf_frequency: getLwfConfig(selectedStateCode).frequency,
            pf_registration_number: '',
            esi_registration_number: '',
            effective_from: new Date().toISOString().split('T')[0],
            notes: '',
          },
        ];
      });
    };

    const handleSaveState = () => {
      // In production this would persist to backend
      setEditingSlabs(false);
    };

    const updateSlab = (index: number, field: 'min_income' | 'max_income' | 'monthly_tax', value: number | null) => {
      if (!selectedStateCode) return;
      setFilingReferenceData((prev) =>
        prev.map((f) => {
          if (f.state_code !== selectedStateCode) return f;
          const slabs = [...(f.pt_slabs || DEFAULT_PT_SLABS[selectedStateCode] || [])];
          slabs[index] = { ...slabs[index], [field]: value };
          return { ...f, pt_slabs: slabs };
        })
      );
    };

    const currentStateEnabled = selectedFiling?.pt_enabled ?? false;
    const currentSlabs = selectedFiling?.pt_slabs || DEFAULT_PT_SLABS[selectedStateCode] || [{ min_income: 0, max_income: null, monthly_tax: 200 }];

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Building2 className="w-4 h-4 text-gray-400" />
          <h3 className="text-sm font-medium text-gray-900">State-wise Tax Configuration</h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleEnableAll}
            className="px-3 py-1 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-md hover:bg-green-100 transition-colors"
          >
            Enable All States
          </button>
          <button
            onClick={handleDisableAll}
            className="px-3 py-1 text-xs font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded-md hover:bg-gray-100 transition-colors"
          >
            Disable All
          </button>
        </div>
      </div>

      {/* Auto-detect hint */}
      <div className="flex items-start gap-2 px-3 py-2 bg-blue-50 border border-blue-100 rounded-md">
        <span className="text-blue-500 text-sm mt-0.5">💡</span>
        <p className="text-xs text-blue-700">
          Employees auto-fetch their state tax rules based on their employee card state. Configure only the states where you have employees. {noPtCount > 0 && <span className="text-blue-500">({noPtCount} states have no PT)</span>}
        </p>
      </div>

      {/* Active state pills */}
      {activePills.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-500">Active:</span>
          {activePills.map((p) => {
            const stateInfo = INDIAN_STATES.find((s) => s.code === p.state_code);
            return (
              <button
                key={p.state_code}
                onClick={() => setSelectedStateCode(p.state_code)}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-green-50 text-green-700 border border-green-200 rounded-full hover:bg-green-100 transition-colors"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                {stateInfo?.name || p.state_code}
              </button>
            );
          })}
        </div>
      )}

      {/* State selector + search */}
      <div className="flex items-center gap-3">
        <div className="flex-1 relative">
          <select
            value={selectedStateCode}
            onChange={(e) => {
              setSelectedStateCode(e.target.value);
              setEditingSlabs(false);
            }}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-indigo-500 focus:border-indigo-500 appearance-none bg-white"
          >
            <option value="">— Select a state to configure —</option>
            {filteredStates.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
                {filingReferenceData.find((f) => f.state_code === s.code)?.pt_enabled ? ' ✓' : ''}
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        </div>
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search states..."
            className="w-48 px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>
      </div>

      {/* Per-state config card */}
      {selectedState && (
        <div className="border border-gray-200 rounded-lg p-4 space-y-4 bg-gray-50">
          {/* State header with toggle */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h4 className="text-base font-semibold text-gray-900">{selectedState.name}</h4>
              <button
                onClick={handleToggleState}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  currentStateEnabled ? 'bg-green-500' : 'bg-gray-300'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    currentStateEnabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
              <span className={`text-xs font-medium ${currentStateEnabled ? 'text-green-600' : 'text-gray-400'}`}>
                {currentStateEnabled ? 'Active' : 'Inactive'}
              </span>
            </div>
            <button
              onClick={() => setEditingSlabs(!editingSlabs)}
              className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
            >
              {editingSlabs ? 'Done' : 'Edit Slabs'}
            </button>
          </div>

          {currentStateEnabled && (
            <>
              {/* No PT applicable badge */}
              {!stateHasPt && (
                <div className="flex items-center gap-2 px-3 py-2 bg-gray-100 border border-gray-200 rounded-md">
                  <span className="text-xs font-medium text-gray-500">Not Applicable</span>
                  <span className="text-xs text-gray-400">— Professional Tax is not applicable in this state</span>
                </div>
              )}

              {/* PT Slab Table — only if state has PT */}
              {stateHasPt && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h5 className="text-xs font-medium text-gray-700 uppercase tracking-wide">Professional Tax Slabs</h5>
                  <span className="text-xs text-gray-400">Monthly tax based on gross salary range</span>
                </div>
                <div className="border border-gray-200 rounded-md overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="text-left px-3 py-2 text-xs font-medium text-gray-600">Min Income (₹)</th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-gray-600">Max Income (₹)</th>
                        <th className="text-right px-3 py-2 text-xs font-medium text-gray-600">Monthly Tax (₹)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {currentSlabs.map((slab, idx) => (
                        <tr key={idx} className="hover:bg-white">
                          <td className="px-3 py-1.5">
                            {editingSlabs ? (
                              <input
                                type="number"
                                value={slab.min_income === 0 ? '' : slab.min_income}
                                onChange={(e) => updateSlab(idx, 'min_income', e.target.value === '' ? 0 : Number(e.target.value))}
                                className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                              />
                            ) : (
                              <span className="text-gray-900">₹{slab.min_income.toLocaleString()}</span>
                            )}
                          </td>
                          <td className="px-3 py-1.5">
                            {editingSlabs ? (
                              <input
                                type="number"
                                value={slab.max_income ?? ''}
                                onChange={(e) =>
                                  updateSlab(idx, 'max_income', e.target.value ? Number(e.target.value) : null)
                                }
                                placeholder="∞"
                                className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                              />
                            ) : (
                              <span className="text-gray-900">
                                {slab.max_income ? `₹${slab.max_income.toLocaleString()}` : 'No limit'}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            {editingSlabs ? (
                              <input
                                type="number"
                                value={slab.monthly_tax === 0 ? '' : slab.monthly_tax}
                                onChange={(e) => updateSlab(idx, 'monthly_tax', e.target.value === '' ? 0 : Number(e.target.value))}
                                className="w-full px-2 py-1 border border-gray-300 rounded text-sm text-right"
                              />
                            ) : (
                              <span className="font-medium text-gray-900">₹{slab.monthly_tax.toLocaleString()}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              )}

              {/* LWF section — greyed out if not applicable */}
              {stateLwf.frequency === 'not_applicable' ? (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="flex items-center gap-2 mb-2 text-gray-400">
                      <input type="checkbox" disabled className="h-4 w-4 border-gray-300 rounded" />
                      <span className="text-sm">Labour Welfare Fund (LWF)</span>
                    </label>
                    <p className="text-xs text-gray-400 italic">Not applicable in this state</p>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Not Applicable</label>
                    <input type="text" disabled className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm bg-gray-50 text-gray-400" placeholder="—" />
                  </div>
                </div>
              ) : (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="flex items-center gap-2 mb-2">
                    <input
                      type="checkbox"
                      checked={selectedFiling?.lwf_enabled ?? false}
                      onChange={() => {
                        if (!selectedStateCode) return;
                        setFilingReferenceData((prev) =>
                          prev.map((f) =>
                            f.state_code === selectedStateCode ? { ...f, lwf_enabled: !f.lwf_enabled } : f
                          )
                        );
                      }}
                      className="h-4 w-4 text-indigo-600 border-gray-300 rounded"
                    />
                    <span className="text-sm font-medium text-gray-700">Labour Welfare Fund (LWF)</span>
                  </label>
                  <div className="mt-1">
                    <label className="block text-xs text-gray-500 mb-1">LWF Amount (₹/employee/month)</label>
                    <input
                      type="number"
                      defaultValue={selectedFiling?.lwf_enabled ? 50 : 0}
                      className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                      disabled={!selectedFiling?.lwf_enabled}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Effective From</label>
                  <input
                    type="date"
                    value={selectedFiling?.effective_from || ''}
                    onChange={(e) => {
                      if (!selectedStateCode) return;
                      setFilingReferenceData((prev) =>
                        prev.map((f) =>
                          f.state_code === selectedStateCode ? { ...f, effective_from: e.target.value } : f
                        )
                      );
                    }}
                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                  />
                </div>
              </div>
              )}

              {/* Registration numbers */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">PF Registration #</label>
                  <input
                    type="text"
                    value={selectedFiling?.pf_registration_number || ''}
                    onChange={(e) => {
                      if (!selectedStateCode) return;
                      setFilingReferenceData((prev) =>
                        prev.map((f) =>
                          f.state_code === selectedStateCode
                            ? { ...f, pf_registration_number: e.target.value }
                            : f
                        )
                      );
                    }}
                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                    placeholder="PF registration number"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">ESI Registration #</label>
                  <input
                    type="text"
                    value={selectedFiling?.esi_registration_number || ''}
                    onChange={(e) => {
                      if (!selectedStateCode) return;
                      setFilingReferenceData((prev) =>
                        prev.map((f) =>
                          f.state_code === selectedStateCode
                            ? { ...f, esi_registration_number: e.target.value }
                            : f
                        )
                      );
                    }}
                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                    placeholder="ESI registration number"
                  />
                </div>
              </div>

              {/* Save button */}
              <button
                onClick={handleSaveState}
                className="w-full px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 transition-colors"
              >
                Save {selectedState.name} Configuration
              </button>
            </>
          )}

          {!currentStateEnabled && (
            <p className="text-sm text-gray-500 italic">
              Enable this state to configure tax rules. Employees with this state in their card will use these rules during payroll.
            </p>
          )}
        </div>
      )}

      {!selectedState && (
        <div className="text-center py-8 text-gray-400">
          <Building2 className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">Select a state above to configure its tax rules</p>
        </div>
      )}
    </div>
  );
}

export default function PayGroupSettings({ onBack, payGroupId }: { onBack: (target?: 'dashboard' | 'group') => void; payGroupId?: number }) {
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [filingReferenceData, setFilingReferenceData] = useState<FilingRefData[]>([
    { state_code: 'maharashtra', state_name: 'Maharashtra', pt_enabled: true, pt_slabs: DEFAULT_PT_SLABS['maharashtra'], pt_annual_max: 2400, lwf_enabled: true, lwf_amount: 50, lwf_frequency: 'monthly', pf_registration_number: '', esi_registration_number: '', effective_from: '2024-04-01', notes: '' },
    { state_code: 'karnataka', state_name: 'Karnataka', pt_enabled: true, pt_slabs: DEFAULT_PT_SLABS['karnataka'], pt_annual_max: 3600, lwf_enabled: true, lwf_amount: 15, lwf_frequency: 'monthly', pf_registration_number: '', esi_registration_number: '', effective_from: '2024-04-01', notes: '' },
    { state_code: 'gujarat', state_name: 'Gujarat', pt_enabled: true, pt_slabs: DEFAULT_PT_SLABS['gujarat'], pt_annual_max: 2400, lwf_enabled: true, lwf_amount: 50, lwf_frequency: 'bi_annual', pf_registration_number: '', esi_registration_number: '', effective_from: '2024-04-01', notes: '' },
    { state_code: 'tamil_nadu', state_name: 'Tamil Nadu', pt_enabled: true, pt_slabs: DEFAULT_PT_SLABS['tamil_nadu'], pt_annual_max: 2400, lwf_enabled: true, lwf_amount: 25, lwf_frequency: 'monthly', pf_registration_number: '', esi_registration_number: '', effective_from: '2024-04-01', notes: '' },
    { state_code: 'telangana', state_name: 'Telangana', pt_enabled: true, pt_slabs: DEFAULT_PT_SLABS['telangana'], pt_annual_max: 2400, lwf_enabled: true, lwf_amount: 20, lwf_frequency: 'monthly', pf_registration_number: '', esi_registration_number: '', effective_from: '2024-04-01', notes: '' },
    { state_code: 'delhi', state_name: 'Delhi', pt_enabled: true, pt_slabs: DEFAULT_PT_SLABS['delhi'], pt_annual_max: 2400, lwf_enabled: true, lwf_amount: 6, lwf_frequency: 'monthly', pf_registration_number: '', esi_registration_number: '', effective_from: '2024-04-01', notes: '' },
    { state_code: 'west_bengal', state_name: 'West Bengal', pt_enabled: true, pt_slabs: DEFAULT_PT_SLABS['west_bengal'], pt_annual_max: 2400, lwf_enabled: true, lwf_amount: 10, lwf_frequency: 'monthly', pf_registration_number: '', esi_registration_number: '', effective_from: '2024-04-01', notes: '' },
    { state_code: 'kerala', state_name: 'Kerala', pt_enabled: true, pt_slabs: DEFAULT_PT_SLABS['kerala'], pt_annual_max: 2400, lwf_enabled: true, lwf_amount: 20, lwf_frequency: 'monthly', pf_registration_number: '', esi_registration_number: '', effective_from: '2024-04-01', notes: '' },
    { state_code: 'rajasthan', state_name: 'Rajasthan', pt_enabled: true, pt_slabs: DEFAULT_PT_SLABS['rajasthan'], pt_annual_max: 2400, lwf_enabled: true, lwf_amount: 10, lwf_frequency: 'monthly', pf_registration_number: '', esi_registration_number: '', effective_from: '2024-04-01', notes: '' },
    { state_code: 'uttar_pradesh', state_name: 'Uttar Pradesh', pt_enabled: true, pt_slabs: DEFAULT_PT_SLABS['uttar_pradesh'], pt_annual_max: 2400, lwf_enabled: false, lwf_amount: 0, lwf_frequency: 'not_applicable', pf_registration_number: '', esi_registration_number: '', effective_from: '2024-04-01', notes: '' },
    { state_code: 'bihar', state_name: 'Bihar', pt_enabled: true, pt_slabs: DEFAULT_PT_SLABS['bihar'], pt_annual_max: 2400, lwf_enabled: true, lwf_amount: 10, lwf_frequency: 'monthly', pf_registration_number: '', esi_registration_number: '', effective_from: '2024-04-01', notes: '' },
    { state_code: 'madhya_pradesh', state_name: 'Madhya Pradesh', pt_enabled: true, pt_slabs: DEFAULT_PT_SLABS['madhya_pradesh'], pt_annual_max: 2400, lwf_enabled: true, lwf_amount: 18.75, lwf_frequency: 'monthly', pf_registration_number: '', esi_registration_number: '', effective_from: '2024-04-01', notes: '' },
    { state_code: 'andhra_pradesh', state_name: 'Andhra Pradesh', pt_enabled: true, pt_slabs: DEFAULT_PT_SLABS['andhra_pradesh'], pt_annual_max: 2400, lwf_enabled: true, lwf_amount: 20, lwf_frequency: 'monthly', pf_registration_number: '', esi_registration_number: '', effective_from: '2024-04-01', notes: '' },
    { state_code: 'punjab', state_name: 'Punjab', pt_enabled: true, pt_slabs: DEFAULT_PT_SLABS['punjab'], pt_annual_max: 2400, lwf_enabled: false, lwf_amount: 0, lwf_frequency: 'not_applicable', pf_registration_number: '', esi_registration_number: '', effective_from: '2024-04-01', notes: '' },
    { state_code: 'haryana', state_name: 'Haryana', pt_enabled: true, pt_slabs: DEFAULT_PT_SLABS['haryana'], pt_annual_max: 2400, lwf_enabled: false, lwf_amount: 0, lwf_frequency: 'not_applicable', pf_registration_number: '', esi_registration_number: '', effective_from: '2024-04-01', notes: '' },
    { state_code: 'odisha', state_name: 'Odisha', pt_enabled: true, pt_slabs: DEFAULT_PT_SLABS['odisha'], pt_annual_max: 2400, lwf_enabled: true, lwf_amount: 10, lwf_frequency: 'monthly', pf_registration_number: '', esi_registration_number: '', effective_from: '2024-04-01', notes: '' },
    { state_code: 'assam', state_name: 'Assam', pt_enabled: true, pt_slabs: DEFAULT_PT_SLABS['assam'], pt_annual_max: 2400, lwf_enabled: false, lwf_amount: 0, lwf_frequency: 'not_applicable', pf_registration_number: '', esi_registration_number: '', effective_from: '2024-04-01', notes: '' },
    { state_code: 'goa', state_name: 'Goa', pt_enabled: true, pt_slabs: DEFAULT_PT_SLABS['goa'], pt_annual_max: 3600, lwf_enabled: true, lwf_amount: 15, lwf_frequency: 'monthly', pf_registration_number: '', esi_registration_number: '', effective_from: '2024-04-01', notes: '' },
    { state_code: 'himachal_pradesh', state_name: 'Himachal Pradesh', pt_enabled: false, pt_slabs: [], pt_annual_max: 0, lwf_enabled: false, lwf_amount: 0, lwf_frequency: 'not_applicable', pf_registration_number: '', esi_registration_number: '', effective_from: '2024-04-01', notes: 'No PT applicable' },
    { state_code: 'manipur', state_name: 'Manipur', pt_enabled: false, pt_slabs: [], pt_annual_max: 0, lwf_enabled: false, lwf_amount: 0, lwf_frequency: 'not_applicable', pf_registration_number: '', esi_registration_number: '', effective_from: '2024-04-01', notes: 'No PT applicable' },
    { state_code: 'nagaland', state_name: 'Nagaland', pt_enabled: false, pt_slabs: [], pt_annual_max: 0, lwf_enabled: false, lwf_amount: 0, lwf_frequency: 'not_applicable', pf_registration_number: '', esi_registration_number: '', effective_from: '2024-04-01', notes: 'No PT applicable' },
    { state_code: 'sikkim', state_name: 'Sikkim', pt_enabled: false, pt_slabs: [], pt_annual_max: 0, lwf_enabled: false, lwf_amount: 0, lwf_frequency: 'not_applicable', pf_registration_number: '', esi_registration_number: '', effective_from: '2024-04-01', notes: 'No PT applicable' },
    { state_code: 'arunachal_pradesh', state_name: 'Arunachal Pradesh', pt_enabled: false, pt_slabs: [], pt_annual_max: 0, lwf_enabled: false, lwf_amount: 0, lwf_frequency: 'not_applicable', pf_registration_number: '', esi_registration_number: '', effective_from: '2024-04-01', notes: 'No PT applicable' },
  ]);

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
      setShowDeleteConfirm(false);
      onBack('dashboard');
    },
  });

  const updateStatutoryMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { pf_enabled?: boolean; esi_enabled?: boolean; pt_enabled?: boolean; lwf_enabled?: boolean; tds_enabled?: boolean } }) =>
      payrollApi.updatePayGroupStatutoryRules(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pay-group-settings'] });
    },
  });

  const toggleStatutory = (component: 'pf_enabled' | 'esi_enabled' | 'pt_enabled' | 'lwf_enabled' | 'tds_enabled') => {
    if (!payGroupId) return;
    const pg = scopedGroups[0];
    if (!pg) return;
    const currentValue = (pg.statutory_rules as any)?.[component] ?? false;
    const previousValue = currentValue;
    queryClient.setQueryData(['pay-group-settings'], (old: any) => {
      if (!old) return old;
      return { ...old, data: { ...old.data, pay_groups: old.data.pay_groups.map((p: PayGroupSettings) => p.id === payGroupId ? { ...p, statutory_rules: { ...p.statutory_rules, [component]: !currentValue } } : p) } };
    });
    updateStatutoryMutation.mutate(
      { id: payGroupId, data: { [component]: !currentValue } },
      { onError: () => { queryClient.setQueryData(['pay-group-settings'], (old: any) => { if (!old) return old; return { ...old, data: { ...old.data, pay_groups: old.data.pay_groups.map((p: PayGroupSettings) => p.id === payGroupId ? { ...p, statutory_rules: { ...p.statutory_rules, [component]: previousValue } } : p) } }; }); } }
    );
  };

  const updateFilingMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: UpdateFilingDetailsPayload }) => payrollApi.updatePayGroupFilingDetails(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pay-group-settings'] });
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
          onClick={() => onBack('group')}
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
            Configure statutory compliance and state-wise filing details
          </p>
        </div>
        {isScoped && (
          <button
            onClick={() => {
              const pg = scopedGroups[0];
              setEditingId(pg.id);
              setFormData({
                name: pg.name,
                code: pg.code,
                description: pg.description || '',
                pay_frequency: pg.pay_frequency,
                pay_day: pg.pay_day,
                pay_day_type: pg.pay_day_type,
                salary_template_id: pg.salary_template_id?.toString() || '',
                statutory_rules: pg.statutory_rules || { pf_enabled: true, esi_enabled: true, pt_enabled: true, lwf_enabled: false, tds_enabled: true },
              });
            }}
            className="inline-flex items-center px-4 py-2 text-sm font-medium text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-md hover:bg-indigo-100 transition-colors"
          >
            <Pencil className="w-4 h-4 mr-2" />
            Edit Pay Group
          </button>
        )}
      </div>

      {/* ===== STATUTORY COMPONENTS — Always Visible ===== */}
      {(scopedGroups[0]?.statutory_rules || isScoped) && (
        <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-4 mb-4">
          <h3 className="text-sm font-medium text-gray-900 flex items-center gap-2">
            <Settings className="w-4 h-4 text-gray-400" />
            Statutory Components
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {/* PF Card */}
            <div className={`rounded-lg border p-3 transition-colors ${scopedGroups[0]?.statutory_rules?.pf_enabled ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-gray-900">PF</span>
                <button
                  onClick={() => toggleStatutory('pf_enabled')}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${scopedGroups[0]?.statutory_rules?.pf_enabled ? 'bg-green-500' : 'bg-gray-300'}`}
                >
                  <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${scopedGroups[0]?.statutory_rules?.pf_enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </button>
              </div>
              <div className="text-xs text-gray-600 space-y-0.5">
                <p>Emp: <span className="font-medium">12%</span></p>
                <p>ER: <span className="font-medium">12%</span></p>
                <p>Cap: <span className="font-medium">₹15,000</span></p>
              </div>
            </div>
            {/* ESI Card */}
            <div className={`rounded-lg border p-3 transition-colors ${scopedGroups[0]?.statutory_rules?.esi_enabled ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-gray-900">ESI</span>
                <button
                  onClick={() => toggleStatutory('esi_enabled')}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${scopedGroups[0]?.statutory_rules?.esi_enabled ? 'bg-green-500' : 'bg-gray-300'}`}
                >
                  <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${scopedGroups[0]?.statutory_rules?.esi_enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </button>
              </div>
              <div className="text-xs text-gray-600 space-y-0.5">
                <p>Emp: <span className="font-medium">0.75%</span></p>
                <p>ER: <span className="font-medium">3.25%</span></p>
                <p>Max: <span className="font-medium">₹21,000</span></p>
              </div>
            </div>
            {/* PT Card */}
            <div className={`rounded-lg border p-3 transition-colors ${scopedGroups[0]?.statutory_rules?.pt_enabled ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-gray-900">PT</span>
                <button
                  onClick={() => toggleStatutory('pt_enabled')}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${scopedGroups[0]?.statutory_rules?.pt_enabled ? 'bg-green-500' : 'bg-gray-300'}`}
                >
                  <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${scopedGroups[0]?.statutory_rules?.pt_enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </button>
              </div>
              <div className="text-xs text-gray-600 space-y-0.5">
                <p>State: <span className="font-medium">Select below</span></p>
                <p>Max: <span className="font-medium">₹2,400/yr</span></p>
              </div>
            </div>
            {/* LWF Card */}
            <div className={`rounded-lg border p-3 transition-colors ${scopedGroups[0]?.statutory_rules?.lwf_enabled ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-gray-900">LWF</span>
                <button
                  onClick={() => toggleStatutory('lwf_enabled')}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${scopedGroups[0]?.statutory_rules?.lwf_enabled ? 'bg-green-500' : 'bg-gray-300'}`}
                >
                  <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${scopedGroups[0]?.statutory_rules?.lwf_enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </button>
              </div>
              <div className="text-xs text-gray-600 space-y-0.5">
                <p>₹<span className="font-medium">{getLwfConfig('maharashtra').amount}</span>/month</p>
                <p className="text-gray-400">{getLwfConfig('maharashtra').frequency === 'not_applicable' ? 'Varies by state' : getLwfConfig('maharashtra').frequency}</p>
              </div>
            </div>
            {/* TDS Card */}
            <div className={`rounded-lg border p-3 transition-colors ${scopedGroups[0]?.statutory_rules?.tds_enabled ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-gray-900">TDS</span>
                <button
                  onClick={() => toggleStatutory('tds_enabled')}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${scopedGroups[0]?.statutory_rules?.tds_enabled ? 'bg-green-500' : 'bg-gray-300'}`}
                >
                  <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${scopedGroups[0]?.statutory_rules?.tds_enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </button>
              </div>
              <div className="text-xs text-gray-600 space-y-0.5">
                <p>As per IT slab</p>
                <p className="text-gray-400">Auto-calculated</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== EMPLOYEE-LEVEL OVERRIDE GATES ===== */}
      <ComponentOverrideGates />

      {/* Keka-style State-wise Tax Configuration */}
      <StateWiseTaxConfig
        filingReferenceData={filingReferenceData}
        setFilingReferenceData={setFilingReferenceData}
      />

      {/* Delete Pay Group - Bottom Left */}
      {isScoped && (
        <div className="mt-6 pt-4 border-t border-gray-200">
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="inline-flex items-center px-4 py-2 text-sm font-medium text-red-600 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 transition-colors"
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Delete Pay Group
          </button>
        </div>
      )}

      {/* Edit Pay Group Modal */}
      {editingId && (
        <Modal open onClose={() => setEditingId(null)} titleId="edit-pay-group-title" size="lg">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h3 id="edit-pay-group-title" className="text-lg font-medium text-gray-900">Edit Pay Group</h3>
              <button
                onClick={() => setEditingId(null)}
                className="p-1 text-gray-400 hover:text-gray-600 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                  <input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Code</label>
                  <input type="text" value={formData.code} onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })} className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500" maxLength={10} />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500" rows={2} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Pay Frequency</label>
                  <select value={formData.pay_frequency} onChange={(e) => setFormData({ ...formData, pay_frequency: e.target.value as any })} className="w-full px-3 py-2 border border-gray-300 rounded-md">
                    <option value="monthly">Monthly</option>
                    <option value="biweekly">Bi-Weekly</option>
                    <option value="weekly">Weekly</option>
                    <option value="semi_monthly">Semi-Monthly</option>
                    <option value="quarterly">Quarterly</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Pay Day Type</label>
                  <select value={formData.pay_day_type} onChange={(e) => setFormData({ ...formData, pay_day_type: e.target.value as any })} className="w-full px-3 py-2 border border-gray-300 rounded-md">
                    <option value="fixed">Fixed Day</option>
                    <option value="last_working">Last Working Day</option>
                    <option value="last_day">Last Day of Month</option>
                    <option value="custom">Custom Day</option>
                    <option value="after_period">After Period Ends</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Pay Day</label>
                <input type="number" min={1} max={31} value={formData.pay_day} onChange={(e) => setFormData({ ...formData, pay_day: parseInt(e.target.value) || 1 })} className="w-full px-3 py-2 border border-gray-300 rounded-md" />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button onClick={() => setEditingId(null)} className="px-4 py-2 text-sm text-gray-700 hover:text-gray-900">Cancel</button>
                <button onClick={handleSave} disabled={!formData.name || !formData.code} className="inline-flex items-center px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed">
                  <Save className="w-4 h-4 mr-2" />
                  Save
                </button>
              </div>
            </div>
        </Modal>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <Modal
          open
          onClose={() => setShowDeleteConfirm(false)}
          titleId="delete-pay-group-title"
          size="md"
          busy={deleteMutation.isPending}
        >
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h3 id="delete-pay-group-title" className="text-lg font-medium text-gray-900">Delete Pay Group</h3>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="p-1 text-gray-400 hover:text-gray-600 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-6 py-4">
              <p className="text-sm text-gray-600">
                Are you sure you want to delete <span className="font-semibold text-gray-900">{scopedGroups[0]?.name}</span>?
              </p>
              <p className="text-sm text-gray-500 mt-2">
                This action will deactivate the pay group. Employees assigned to this group will need to be reassigned.
              </p>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 text-sm text-gray-700 hover:text-gray-900"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (payGroupId) {
                    deleteMutation.mutate(payGroupId);
                  }
                }}
                disabled={deleteMutation.isPending}
                className="inline-flex items-center px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
        </Modal>
      )}
    </div>
  );
}
