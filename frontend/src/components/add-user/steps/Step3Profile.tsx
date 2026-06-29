import { useState } from 'react';
import { User, MapPin, CreditCard, FileText, Upload, Plus } from 'lucide-react';
import CustomSelect from '../../../components/ui/CustomSelect';
import type { AddUserWizardForm } from './types';

interface Step3Props {
  form: AddUserWizardForm;
  setForm: React.Dispatch<React.SetStateAction<AddUserWizardForm>>;
}

const GENDER_OPTIONS = [
  { value: '', label: 'Select' },
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'other', label: 'Other' },
];

const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat',
  'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh',
  'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab',
  'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh',
  'Uttarakhand', 'West Bengal', 'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Puducherry',
];

const RELATIONSHIP_OPTIONS = [
  { value: '', label: 'Select' },
  { value: 'spouse', label: 'Spouse' },
  { value: 'parent', label: 'Parent' },
  { value: 'child', label: 'Child' },
  { value: 'sibling', label: 'Sibling' },
  { value: 'friend', label: 'Friend' },
  { value: 'other', label: 'Other' },
];

const ID_TYPE_OPTIONS = [
  { value: '', label: 'Select ID type' },
  { value: 'aadhaar', label: 'Aadhaar' },
  { value: 'pan', label: 'PAN' },
  { value: 'passport', label: 'Passport' },
  { value: 'driving_license', label: 'Driving License' },
  { value: 'voter_id', label: 'Voter ID' },
];

function SectionHeader({ icon: Icon, title, subtitle }: { icon: any; title: string; subtitle?: string }) {
  return (
    <div className="flex items-center gap-3 pb-2 border-b border-gray-100">
      <Icon className="h-4 w-4 text-blue-500" />
      <div>
        <h4 className="text-sm font-semibold text-gray-800">{title}</h4>
        {subtitle && <p className="text-xs text-gray-400">{subtitle}</p>}
      </div>
    </div>
  );
}

export function Step3Profile({ form, setForm }: Step3Props) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['personal']));

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

  const inputClass =
    'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all';

  return (
    <div className="max-h-[60vh] overflow-y-auto">
      {/* Header note */}
      <div className="px-6 py-3 bg-amber-50 border-b border-amber-100">
        <p className="text-xs text-amber-700 font-medium">
          All fields below are optional. Skip this step or fill partial data. Employee can complete later via self-service.
        </p>
      </div>

      <div className="px-6 py-4 space-y-4">
        {/* ── 3A: Personal Details ── */}
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          <button
            onClick={() => toggleSection('personal')}
            className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors"
          >
            <SectionHeader icon={User} title="Personal Details" subtitle="Gender, DOB, address, emergency contact" />
            <span className="text-gray-400 text-sm">{expandedSections.has('personal') ? '�' : '▸'}</span>
          </button>
          {expandedSections.has('personal') && (
            <div className="px-4 py-4 space-y-4">
              {/* Gender & DOB */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Gender</label>
                  <CustomSelect
                    options={GENDER_OPTIONS}
                    value={form.gender}
                    onChange={(value) => setForm((p) => ({ ...p, gender: value as any }))}
                    placeholder="Select"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Date of Birth</label>
                  <input
                    type="date"
                    value={form.dateOfBirth}
                    max={new Date().toISOString().split('T')[0]}
                    onChange={(e) => setForm((p) => ({ ...p, dateOfBirth: e.target.value }))}
                    className={inputClass}
                  />
                </div>
              </div>

              {/* Personal Email */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Personal Email</label>
                <input
                  type="email"
                  value={form.personalEmail}
                  onChange={(e) => setForm((p) => ({ ...p, personalEmail: e.target.value }))}
                  className={inputClass}
                  placeholder="personal@gmail.com"
                />
              </div>

              {/* Address */}
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Address Line 1</label>
                  <input
                    type="text"
                    value={form.addressLine1}
                    onChange={(e) => setForm((p) => ({ ...p, addressLine1: e.target.value }))}
                    className={inputClass}
                    placeholder="Flat/House No., Street"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Address Line 2</label>
                  <input
                    type="text"
                    value={form.addressLine2}
                    onChange={(e) => setForm((p) => ({ ...p, addressLine2: e.target.value }))}
                    className={inputClass}
                    placeholder="Area, Landmark"
                  />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">City</label>
                    <input
                      type="text"
                      value={form.city}
                      onChange={(e) => setForm((p) => ({ ...p, city: e.target.value }))}
                      className={inputClass}
                      placeholder="Mumbai"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">State</label>
                    <CustomSelect
                      options={INDIAN_STATES.map(value => ({ value, label: value }))}
                      value={form.state}
                      onChange={(value) => setForm((p) => ({ ...p, state: value }))}
                      placeholder="Select"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Pincode</label>
                    <input
                      type="text"
                      value={form.pincode}
                      onChange={(e) => setForm((p) => ({ ...p, pincode: e.target.value.replace(/\D/g, '').slice(0, 6) }))}
                      className={inputClass}
                      placeholder="400001"
                      maxLength={6}
                    />
                  </div>
                </div>
              </div>

              {/* Emergency Contact */}
              <div className="bg-gray-50 rounded-lg p-3 space-y-3">
                <p className="text-xs font-semibold text-gray-600">Emergency Contact</p>
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="text"
                    value={form.emergencyContactName}
                    onChange={(e) => setForm((p) => ({ ...p, emergencyContactName: e.target.value }))}
                    className={inputClass}
                    placeholder="Contact name"
                  />
                  <input
                    type="tel"
                    value={form.emergencyContactPhone}
                    onChange={(e) => setForm((p) => ({ ...p, emergencyContactPhone: e.target.value }))}
                    className={inputClass}
                    placeholder="Phone number"
                  />
                </div>
                <CustomSelect
                  options={RELATIONSHIP_OPTIONS}
                  value={form.emergencyRelationship}
                  onChange={(value) => setForm((p) => ({ ...p, emergencyRelationship: value }))}
                  placeholder="Select"
                />
              </div>
            </div>
          )}
        </div>

        {/* ── 3B: Documents ── */}
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          <button
            onClick={() => toggleSection('documents')}
            className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors"
          >
            <SectionHeader icon={FileText} title="Documents" subtitle="ID proof, resume, certificates" />
            <span className="text-gray-400 text-sm">{expandedSections.has('documents') ? '▾' : '�'}</span>
          </button>
          {expandedSections.has('documents') && (
            <div className="px-4 py-4 space-y-4">
              {/* ID Type & Number */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">ID Type</label>
                  <CustomSelect
                    options={ID_TYPE_OPTIONS}
                    value={form.idType}
                    onChange={(value) => setForm((p) => ({ ...p, idType: value as any }))}
                    placeholder="Select ID type"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">ID Number</label>
                  <input
                    type="text"
                    value={form.idNumber}
                    onChange={(e) => setForm((p) => ({ ...p, idNumber: e.target.value }))}
                    className={inputClass}
                    placeholder="Enter ID number"
                  />
                </div>
              </div>

              {/* File uploads */}
              {[
                { key: 'idProofFile', label: 'ID Proof Document', accept: '.pdf,.jpg,.jpeg,.png' },
                { key: 'resumeFile', label: 'Resume', accept: '.pdf,.doc,.docx' },
                { key: 'experienceCertFile', label: 'Experience Certificate', accept: '.pdf,.jpg,.jpeg,.png' },
                { key: 'educationCertFile', label: 'Education Certificate', accept: '.pdf,.jpg,.jpeg,.png' },
              ].map(({ key, label, accept }) => (
                <div key={key} className="flex items-center gap-3">
                  <label className="flex-1 flex items-center gap-2 px-3 py-2 border border-dashed border-gray-200 rounded-lg cursor-pointer hover:border-blue-300 hover:bg-blue-50/50 transition-all">
                    <Upload className="h-4 w-4 text-gray-400" />
                    <span className="text-sm text-gray-600">
                      {(form as any)[key] ? (form as any)[key].name : `Upload ${label}`}
                    </span>
                    <input
                      type="file"
                      accept={accept}
                      onChange={(e) => {
                        const file = e.target.files?.[0] || null;
                        setForm((p) => ({ ...p, [key]: file }));
                      }}
                      className="hidden"
                    />
                  </label>
                  {(form as any)[key] && (
                    <button
                      onClick={() => setForm((p) => ({ ...p, [key]: null }))}
                      className="text-xs text-red-400 hover:text-red-600"
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── 3C: Bank Details ── */}
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          <button
            onClick={() => toggleSection('bank')}
            className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors"
          >
            <SectionHeader icon={CreditCard} title="Bank Details" subtitle="Salary account information" />
            <span className="text-gray-400 text-sm">{expandedSections.has('bank') ? '▾' : '▸'}</span>
          </button>
          {expandedSections.has('bank') && (
            <div className="px-4 py-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Account Holder Name</label>
                  <input
                    type="text"
                    value={form.accountHolderName}
                    onChange={(e) => setForm((p) => ({ ...p, accountHolderName: e.target.value }))}
                    className={inputClass}
                    placeholder="As per bank records"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Bank Name</label>
                  <input
                    type="text"
                    value={form.bankName}
                    onChange={(e) => setForm((p) => ({ ...p, bankName: e.target.value }))}
                    className={inputClass}
                    placeholder="HDFC Bank"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Account Number</label>
                  <input
                    type="text"
                    value={form.accountNumber}
                    onChange={(e) => setForm((p) => ({ ...p, accountNumber: e.target.value.replace(/\D/g, '') }))}
                    className={inputClass}
                    placeholder="9-18 digits"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">IFSC Code</label>
                  <input
                    type="text"
                    value={form.ifscCode}
                    onChange={(e) => setForm((p) => ({ ...p, ifscCode: e.target.value.toUpperCase().slice(0, 11) }))}
                    className={inputClass}
                    placeholder="HDFC0001234"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Branch Name</label>
                  <input
                    type="text"
                    value={form.branchName}
                    onChange={(e) => setForm((p) => ({ ...p, branchName: e.target.value }))}
                    className={inputClass}
                    placeholder="Andheri West"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Account Type</label>
                  <CustomSelect
                    options={[
                      { value: 'savings', label: 'Savings' },
                      { value: 'current', label: 'Current' },
                    ]}
                    value={form.accountType}
                    onChange={(value) => setForm((p) => ({ ...p, accountType: value as any }))}
                    placeholder="Select"
                  />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.isDefaultAccount}
                    onChange={(e) => setForm((p) => ({ ...p, isDefaultAccount: e.target.checked }))}
                    className="h-4 w-4 text-blue-600 border-gray-300 rounded"
                  />
                  <span className="text-xs text-gray-600">Set as default account</span>
                </label>
                <label className="flex items-center gap-2 px-3 py-2 border border-dashed border-gray-200 rounded-lg cursor-pointer hover:border-blue-300 hover:bg-blue-50/50 transition-all">
                  <Upload className="h-4 w-4 text-gray-400" />
                  <span className="text-sm text-gray-600">
                    {form.bankProofFile ? form.bankProofFile.name : 'Upload bank proof'}
                  </span>
                  <input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    onChange={(e) => {
                      const file = e.target.files?.[0] || null;
                      setForm((p) => ({ ...p, bankProofFile: file }));
                    }}
                    className="hidden"
                  />
                </label>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
