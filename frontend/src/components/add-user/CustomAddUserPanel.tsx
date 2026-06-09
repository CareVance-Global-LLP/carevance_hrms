import { useState, useCallback } from 'react';
import { Loader2, UserPlus, CheckCircle2, AlertCircle, User, Mail, Lock, Phone, MapPin, Briefcase, Calendar, FileText, Building2, CreditCard, Shield, Upload } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Button from '@/components/ui/Button';
import { TextInput, SelectInput, ToggleInput } from '@/components/ui/FormField';
import GroupMultiSelect from '@/components/add-user/GroupMultiSelect';
import QuickCreateGroupDialog from '@/components/groups/QuickCreateGroupDialog';
import { COMMON_TIMEZONES, DEFAULT_APP_TIMEZONE } from '@/lib/timezones';
import type { InviteUserRole, InviteOption, AdditionalInviteSettings } from '@/services/addUser';

interface CustomAddUserForm {
  // Account Info (Basic)
  email: string;
  password: string;
  confirmPassword: string;
  role: InviteUserRole;
  
  // Employee Details (Personal)
  firstName: string;
  lastName: string;
  gender: 'male' | 'female' | 'other' | '';
  dateOfBirth: string;
  phone: string;
  personalEmail: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  emergencyContact: string;
  emergencyNumber: string;
  relationship: string;
  
  // Work Information
  employeeCode: string;
  designation: string;
  departmentIds: number[];
  employmentType: 'full_time' | 'part_time' | 'contract' | 'intern' | '';
  workLocation: string;
  expectedStartTime: string;
  timezone: string;
  joiningDate: string;
  
  // Government IDs
  idType: 'aadhaar' | 'pan' | 'passport' | 'driving_license' | 'voter_id' | '';
  idNumber: string;
  idProofFile: File | null;
  
  // Bank Account Details
  accountHolderName: string;
  bankName: string;
  accountNumber: string;
  ifscCode: string;
  branchName: string;
  accountType: 'savings' | 'current';
  bankProofFile: File | null;
  isDefaultAccount: boolean;
  
  // Documents
  documentTitle: string;
  documentCategory: string;
  documentFile: File | null;
  
  // Settings
  settings: AdditionalInviteSettings;
}

interface CustomAddUserPanelProps {
  organizationId: number;
  allowedRoles: InviteUserRole[];
  onSuccess: () => void;
  onError: (message: string) => void;
}

const browserTimezone = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined;

const defaultForm: CustomAddUserForm = {
  email: '',
  password: '',
  confirmPassword: '',
  role: 'employee',
  firstName: '',
  lastName: '',
  gender: '',
  dateOfBirth: '',
  phone: '',
  personalEmail: '',
  address: '',
  city: '',
  state: '',
  pincode: '',
  emergencyContact: '',
  emergencyNumber: '',
  relationship: '',
  employeeCode: '',
  designation: '',
  departmentIds: [],
  employmentType: '',
  workLocation: '',
  expectedStartTime: '',
  timezone: browserTimezone && COMMON_TIMEZONES.includes(browserTimezone) ? browserTimezone : DEFAULT_APP_TIMEZONE,
  joiningDate: new Date().toISOString().split('T')[0],
  idType: '',
  idNumber: '',
  idProofFile: null,
  accountHolderName: '',
  bankName: '',
  accountNumber: '',
  ifscCode: '',
  branchName: '',
  accountType: 'savings',
  bankProofFile: null,
  isDefaultAccount: true,
  documentTitle: '',
  documentCategory: 'other',
  documentFile: null,
  settings: {
    monitoringInterval: 10,
    canEditTime: false,
    attendanceMonitoring: true,
    payrollVisibility: false,
    taskAssignmentAccess: true,
    timezone: browserTimezone && COMMON_TIMEZONES.includes(browserTimezone) ? browserTimezone : DEFAULT_APP_TIMEZONE,
  },
};

const monitoringIntervalOptions = [
  { value: 1, label: 'Every 1 minute' },
  { value: 3, label: 'Every 3 minutes' },
  { value: 5, label: 'Every 5 minutes' },
  { value: 10, label: 'Every 10 minutes' },
  { value: 15, label: 'Every 15 minutes' },
  { value: 30, label: 'Every 30 minutes' },
];

const accountTypeOptions = [
  { value: 'savings', label: 'Savings Account' },
  { value: 'current', label: 'Current Account' },
];

const genderOptions = [
  { value: '', label: 'Select gender' },
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'other', label: 'Other' },
];

const idTypeOptions = [
  { value: '', label: 'Select ID type' },
  { value: 'aadhaar', label: 'Aadhaar' },
  { value: 'pan', label: 'PAN' },
  { value: 'passport', label: 'Passport' },
  { value: 'driving_license', label: 'Driving License' },
  { value: 'voter_id', label: 'Voter ID' },
];

const employmentTypeOptions = [
  { value: '', label: 'Select employment type' },
  { value: 'full_time', label: 'Full Time' },
  { value: 'part_time', label: 'Part Time' },
  { value: 'contract', label: 'Contract' },
  { value: 'intern', label: 'Intern' },
];

const documentCategoryOptions = [
  { value: 'other', label: 'Other' },
  { value: 'experience_certificate', label: 'Experience Certificate' },
  { value: 'education_certificate', label: 'Education Certificate' },
  { value: 'offer_letter', label: 'Offer Letter' },
  { value: 'resume', label: 'Resume' },
];

const indianStates = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 
  'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 
  'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 
  'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 
  'Uttarakhand', 'West Bengal', 'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Puducherry'
];

const relationshipOptions = [
  { value: '', label: 'Select relationship' },
  { value: 'spouse', label: 'Spouse' },
  { value: 'parent', label: 'Parent' },
  { value: 'child', label: 'Child' },
  { value: 'sibling', label: 'Sibling' },
  { value: 'friend', label: 'Friend' },
  { value: 'other', label: 'Other' },
];

export default function CustomAddUserPanel({ organizationId, allowedRoles, onSuccess, onError }: CustomAddUserPanelProps) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<CustomAddUserForm>({ ...defaultForm });
  const [errors, setErrors] = useState<Partial<Record<keyof CustomAddUserForm, string>>>({});
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [createdUserEmail, setCreatedUserEmail] = useState<string | null>(null);

  const groupsQuery = useQuery({
    queryKey: ['add-user-groups'],
    queryFn: async () => {
      const response = await fetch('/api/groups');
      const data = await response.json();
      return (data.data || []).map((group: any) => ({
        id: group.id,
        name: group.name,
        description: `${group.users?.length || 0} member${group.users?.length === 1 ? '' : 's'}`,
      })) satisfies InviteOption[];
    },
  });



  const validateForm = (): boolean => {
    const newErrors: Partial<Record<keyof CustomAddUserForm, string>> = {};

    if (!form.email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      newErrors.email = 'Please enter a valid email address';
    }

    if (!form.password) {
      newErrors.password = 'Password is required';
    } else if (form.password.length < 8) {
      newErrors.password = 'Password must be at least 8 characters';
    }

    if (form.password !== form.confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
    }

    if (!form.firstName.trim() && !form.lastName.trim()) {
      newErrors.firstName = 'First name or last name is required';
    }

    if (form.phone && !/^[+]?[\d\s-]{10,}$/.test(form.phone)) {
      newErrors.phone = 'Please enter a valid phone number';
    }

    if (form.accountNumber && !/^\d{9,18}$/.test(form.accountNumber)) {
      newErrors.accountNumber = 'Please enter a valid account number (9-18 digits)';
    }

    if (form.ifscCode && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(form.ifscCode.toUpperCase())) {
      newErrors.ifscCode = 'Please enter a valid IFSC code';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const createUserMutation = useMutation({
    mutationFn: async (formData: CustomAddUserForm) => {
      const fullName = `${formData.firstName} ${formData.lastName}`.trim();
      
      // Step 1: Create user
      const userResponse = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: fullName || formData.email.split('@')[0],
          email: formData.email,
          password: formData.password,
          role: formData.role,
          group_ids: formData.departmentIds,
          settings: {
            monitoring_interval_minutes: formData.settings.monitoringInterval,
            can_edit_time: formData.settings.canEditTime,
            attendance_monitoring: formData.settings.attendanceMonitoring,
            payroll_visibility: formData.settings.payrollVisibility,
            task_assignment_access: formData.settings.taskAssignmentAccess,
            timezone: formData.settings.timezone,
          },
        }),
      });

      if (!userResponse.ok) {
        const errorData = await userResponse.json();
        throw new Error(errorData.message || 'Failed to create user');
      }

      const userData = await userResponse.json();
      const userId = userData.id;

      // Step 2: Update profile
      await fetch(`/api/employees/${userId}/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: formData.firstName || undefined,
          last_name: formData.lastName || undefined,
          gender: formData.gender || undefined,
          phone: formData.phone || undefined,
          personal_email: formData.personalEmail || undefined,
          date_of_birth: formData.dateOfBirth || undefined,
          address: formData.address || undefined,
          city: formData.city || undefined,
          state: formData.state || undefined,
          pincode: formData.pincode || undefined,
          emergency_contact_name: formData.emergencyContact || undefined,
          emergency_contact_number: formData.emergencyNumber || undefined,
          emergency_contact_relationship: formData.relationship || undefined,
        }),
      });

      // Step 3: Update work info
      await fetch(`/api/employees/${userId}/work-info`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_code: formData.employeeCode || undefined,
          designation: formData.designation || undefined,
          joining_date: formData.joiningDate || undefined,
          employment_type: formData.employmentType || undefined,
          work_location: formData.workLocation || undefined,
          expected_start_time: formData.expectedStartTime || undefined,
          timezone: formData.timezone || undefined,
        }),
      });

      // Step 4: Add Government ID if provided
      if (formData.idType && formData.idNumber) {
        const idFormData = new FormData();
        idFormData.append('id_type', formData.idType);
        idFormData.append('id_number', formData.idNumber);
        if (formData.idProofFile) {
          idFormData.append('proof_document', formData.idProofFile);
        }
        
        await fetch(`/api/employees/${userId}/government-ids`, {
          method: 'POST',
          body: idFormData,
        });
      }

      // Step 5: Create bank account if details provided
      if (formData.accountNumber && formData.ifscCode) {
        const bankFormData = new FormData();
        bankFormData.append('account_holder_name', formData.accountHolderName || fullName || formData.email.split('@')[0]);
        bankFormData.append('bank_name', formData.bankName);
        bankFormData.append('account_number', formData.accountNumber);
        bankFormData.append('ifsc_swift', formData.ifscCode.toUpperCase());
        bankFormData.append('branch_name', formData.branchName);
        bankFormData.append('account_type', formData.accountType);
        bankFormData.append('is_primary', formData.isDefaultAccount.toString());
        if (formData.bankProofFile) {
          bankFormData.append('proof_document', formData.bankProofFile);
        }
        
        await fetch(`/api/employees/${userId}/bank-accounts`, {
          method: 'POST',
          body: bankFormData,
        });
      }

      // Step 6: Upload document if provided
      if (formData.documentFile && formData.documentTitle) {
        const docFormData = new FormData();
        docFormData.append('title', formData.documentTitle);
        docFormData.append('category', formData.documentCategory);
        docFormData.append('file', formData.documentFile);
        
        await fetch(`/api/employees/${userId}/documents`, {
          method: 'POST',
          body: docFormData,
        });
      }

      return userData;
    },
    onSuccess: (data) => {
      setCreatedUserEmail(data.email);
      setFeedback({
        type: 'success',
        message: `User ${data.name} (${data.email}) has been created successfully with all details.`,
      });
      queryClient.invalidateQueries({ queryKey: ['add-user-members', organizationId] });
      queryClient.invalidateQueries({ queryKey: ['add-user-groups'] });
      onSuccess();
    },
    onError: (error: any) => {
      const message = error?.message || 'Failed to create user. Please try again.';
      setFeedback({ type: 'error', message });
      onError(message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validateForm()) {
      createUserMutation.mutate(form);
    }
  };

  const handleReset = () => {
    setForm({ ...defaultForm });
    setErrors({});
    setFeedback(null);
    setCreatedUserEmail(null);
  };

  const updateFormField = <K extends keyof CustomAddUserForm>(field: K, value: CustomAddUserForm[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  };

  const updateSettingsField = <K extends keyof AdditionalInviteSettings>(field: K, value: AdditionalInviteSettings[K]) => {
    setForm((prev) => ({
      ...prev,
      settings: { ...prev.settings, [field]: value },
    }));
  };

  const SectionHeader = useCallback(({ icon: Icon, title, subtitle }: { icon: any, title: string, subtitle: string }) => (
    <div className="flex items-center gap-3 mb-6">
      <div className="h-10 w-10 rounded-lg bg-blue-100 flex items-center justify-center">
        <Icon className="h-5 w-5 text-blue-600" />
      </div>
      <div>
        <h3 className="font-semibold text-gray-900">{title}</h3>
        <p className="text-sm text-gray-500">{subtitle}</p>
      </div>
    </div>
  ), []);

  const FormRow = useCallback(({ children, className = '' }: { children: React.ReactNode, className?: string }) => (
    <div className={`grid grid-cols-1 md:grid-cols-3 gap-4 ${className}`}>
      {children}
    </div>
  ), []);

  const FieldContainer = useCallback(({ label, children, required = false, error }: { label: string, children: React.ReactNode, required?: boolean, error?: string }) => (
    <div>
      <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </label>
      {children}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  ), []);

  return (
    <div className="space-y-6 max-h-[calc(100vh-16rem)] overflow-y-auto pr-2">
      {/* Feedback Banner */}
      {feedback && (
        <div className={`p-4 rounded-lg flex items-start gap-3 ${
          feedback.type === 'success' ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
        }`}>
          {feedback.type === 'success' ? (
            <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5" />
          ) : (
            <AlertCircle className="h-5 w-5 text-red-600 mt-0.5" />
          )}
          <div className="flex-1">
            <p className={feedback.type === 'success' ? 'text-green-800' : 'text-red-800'}>
              {feedback.message}
            </p>
            {createdUserEmail && (
              <p className="text-sm text-green-600 mt-1">
                User can now login with email: <strong>{createdUserEmail}</strong>
              </p>
            )}
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Account Info Section */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <SectionHeader 
            icon={User} 
            title="Account Information" 
            subtitle="Login credentials and access level"
          />
          
          <FormRow>
            <FieldContainer label="Email Address" required error={errors.email}>
              <TextInput
                type="email"
                placeholder="user@example.com"
                value={form.email}
                onChange={(e) => updateFormField('email', e.target.value)}
              />
            </FieldContainer>
            
            <FieldContainer label="Password" required error={errors.password}>
              <TextInput
                type="password"
                placeholder="Min 8 characters"
                value={form.password}
                onChange={(e) => updateFormField('password', e.target.value)}
              />
            </FieldContainer>
            
            <FieldContainer label="Confirm Password" required error={errors.confirmPassword}>
              <TextInput
                type="password"
                placeholder="Re-enter password"
                value={form.confirmPassword}
                onChange={(e) => updateFormField('confirmPassword', e.target.value)}
              />
            </FieldContainer>
          </FormRow>

          <div className="mt-4 md:w-1/3">
            <FieldContainer label="Role" required>
              <SelectInput
                value={form.role}
                onChange={(e) => updateFormField('role', e.target.value as InviteUserRole)}
              >
                {allowedRoles.includes('employee') && <option value="employee">Employee</option>}
                {allowedRoles.includes('manager') && <option value="manager">Manager</option>}
                {allowedRoles.includes('admin') && <option value="admin">Admin</option>}
              </SelectInput>
            </FieldContainer>
          </div>
        </div>

        {/* Employee Details Section */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <SectionHeader 
            icon={User} 
            title="Employee Details" 
            subtitle="Personal information and contact details"
          />
          
          <FormRow>
            <FieldContainer label="First Name" error={errors.firstName}>
              <TextInput
                placeholder="Enter first name"
                value={form.firstName}
                onChange={(e) => updateFormField('firstName', e.target.value)}
              />
            </FieldContainer>
            
            <FieldContainer label="Last Name">
              <TextInput
                placeholder="Enter last name"
                value={form.lastName}
                onChange={(e) => updateFormField('lastName', e.target.value)}
              />
            </FieldContainer>
            
            <FieldContainer label="Gender">
              <SelectInput
                value={form.gender}
                onChange={(e) => updateFormField('gender', e.target.value as any)}
              >
                {genderOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </SelectInput>
            </FieldContainer>
          </FormRow>

          <FormRow className="mt-4">
            <FieldContainer label="Date of Birth">
              <TextInput
                type="date"
                value={form.dateOfBirth}
                onChange={(e) => updateFormField('dateOfBirth', e.target.value)}
              />
            </FieldContainer>
            
            <FieldContainer label="Phone" error={errors.phone}>
              <TextInput
                type="tel"
                placeholder="+91 9876543210"
                value={form.phone}
                onChange={(e) => updateFormField('phone', e.target.value)}
              />
            </FieldContainer>
            
            <FieldContainer label="Personal Email">
              <TextInput
                type="email"
                placeholder="personal@example.com"
                value={form.personalEmail}
                onChange={(e) => updateFormField('personalEmail', e.target.value)}
              />
            </FieldContainer>
          </FormRow>

          <FormRow className="mt-4">
            <FieldContainer label="Address Line">
              <TextInput
                placeholder="Street address"
                value={form.address}
                onChange={(e) => updateFormField('address', e.target.value)}
              />
            </FieldContainer>
            
            <FieldContainer label="City">
              <TextInput
                placeholder="City name"
                value={form.city}
                onChange={(e) => updateFormField('city', e.target.value)}
              />
            </FieldContainer>
            
            <FieldContainer label="State">
              <SelectInput
                value={form.state}
                onChange={(e) => updateFormField('state', e.target.value)}
              >
                <option value="">Select state</option>
                {indianStates.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </SelectInput>
            </FieldContainer>
          </FormRow>

          <FormRow className="mt-4">
            <FieldContainer label="Postal Code">
              <TextInput
                placeholder="6-digit pincode"
                value={form.pincode}
                onChange={(e) => updateFormField('pincode', e.target.value)}
              />
            </FieldContainer>
            
            <FieldContainer label="Emergency Contact">
              <TextInput
                placeholder="Contact person name"
                value={form.emergencyContact}
                onChange={(e) => updateFormField('emergencyContact', e.target.value)}
              />
            </FieldContainer>
            
            <FieldContainer label="Emergency Number">
              <TextInput
                type="tel"
                placeholder="+91 9876543210"
                value={form.emergencyNumber}
                onChange={(e) => updateFormField('emergencyNumber', e.target.value)}
              />
            </FieldContainer>
          </FormRow>

          <div className="mt-4 md:w-1/3">
            <FieldContainer label="Relationship">
              <SelectInput
                value={form.relationship}
                onChange={(e) => updateFormField('relationship', e.target.value)}
              >
                {relationshipOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </SelectInput>
            </FieldContainer>
          </div>
        </div>

        {/* Work Information Section */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <SectionHeader 
            icon={Briefcase} 
            title="Work Information" 
            subtitle="Employment details, work schedule, and timezone settings"
          />
          
          <FormRow>
            <FieldContainer label="Employee Code">
              <TextInput
                placeholder="e.g., EMP001"
                value={form.employeeCode}
                onChange={(e) => updateFormField('employeeCode', e.target.value)}
              />
            </FieldContainer>
            
            <FieldContainer label="Designation">
              <TextInput
                placeholder="e.g., Software Engineer"
                value={form.designation}
                onChange={(e) => updateFormField('designation', e.target.value)}
              />
            </FieldContainer>
            
            <FieldContainer label="Department">
              <GroupMultiSelect
                options={groupsQuery.data || []}
                selectedIds={form.departmentIds}
                onChange={(ids) => updateFormField('departmentIds', ids)}
                onCreateNew={() => setShowGroupModal(true)}
                isLoading={groupsQuery.isLoading}
              />
            </FieldContainer>
          </FormRow>

          <FormRow className="mt-4">
            <FieldContainer label="Employment Type">
              <SelectInput
                value={form.employmentType}
                onChange={(e) => updateFormField('employmentType', e.target.value as any)}
              >
                {employmentTypeOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </SelectInput>
            </FieldContainer>
            
            <FieldContainer label="Work Location">
              <TextInput
                placeholder="e.g., Mumbai Office"
                value={form.workLocation}
                onChange={(e) => updateFormField('workLocation', e.target.value)}
              />
            </FieldContainer>
            
            <FieldContainer label="Expected Start Time">
              <TextInput
                type="time"
                value={form.expectedStartTime}
                onChange={(e) => updateFormField('expectedStartTime', e.target.value)}
              />
            </FieldContainer>
          </FormRow>

          <FormRow className="mt-4">
            <FieldContainer label="Expected Timezone">
              <SelectInput
                value={form.timezone}
                onChange={(e) => updateFormField('timezone', e.target.value)}
              >
                <option value="">Use organization default</option>
                {COMMON_TIMEZONES.map(tz => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
              </SelectInput>
            </FieldContainer>
            
            <FieldContainer label="Joining Date">
              <TextInput
                type="date"
                value={form.joiningDate}
                onChange={(e) => updateFormField('joiningDate', e.target.value)}
              />
            </FieldContainer>
            
            <div></div>
          </FormRow>
        </div>

        {/* Government IDs Section */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <SectionHeader 
            icon={Shield} 
            title="Government IDs" 
            subtitle="Add Aadhaar, PAN, and other government identification documents"
          />
          
          <FormRow>
            <FieldContainer label="ID Type">
              <SelectInput
                value={form.idType}
                onChange={(e) => updateFormField('idType', e.target.value as any)}
              >
                {idTypeOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </SelectInput>
            </FieldContainer>
            
            <FieldContainer label="ID Number">
              <TextInput
                placeholder="Enter ID number"
                value={form.idNumber}
                onChange={(e) => updateFormField('idNumber', e.target.value)}
              />
            </FieldContainer>
            
            <FieldContainer label="Proof Document">
              <div className="flex items-center gap-2">
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png"
                  onChange={(e) => updateFormField('idProofFile', e.target.files?.[0] || null)}
                  className="hidden"
                  id="id-proof-file"
                />
                <label
                  htmlFor="id-proof-file"
                  className="flex items-center gap-2 px-4 py-2.5 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50 transition-colors bg-white shadow-sm"
                >
                  <Upload className="h-4 w-4 text-gray-500" />
                  <span className="text-sm text-gray-600">
                    {form.idProofFile ? form.idProofFile.name : 'Choose File'}
                  </span>
                </label>
                {form.idProofFile && (
                  <button
                    type="button"
                    onClick={() => updateFormField('idProofFile', null)}
                    className="text-sm text-red-600 hover:text-red-800"
                  >
                    Remove
                  </button>
                )}
              </div>
            </FieldContainer>
          </FormRow>
        </div>

        {/* Bank Account Details Section */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <SectionHeader 
            icon={CreditCard} 
            title="Bank Account Details" 
            subtitle="Add bank account for salary payouts"
          />
          
          <FormRow>
            <FieldContainer label="Bank Name">
              <TextInput
                placeholder="e.g., State Bank of India"
                value={form.bankName}
                onChange={(e) => updateFormField('bankName', e.target.value)}
              />
            </FieldContainer>
            
            <FieldContainer label="Account Number" error={errors.accountNumber}>
              <TextInput
                placeholder="Enter account number"
                value={form.accountNumber}
                onChange={(e) => updateFormField('accountNumber', e.target.value)}
              />
            </FieldContainer>
            
            <FieldContainer label="IFSC Code" error={errors.ifscCode}>
              <TextInput
                placeholder="e.g., SBIN0001234"
                value={form.ifscCode}
                onChange={(e) => updateFormField('ifscCode', e.target.value.toUpperCase())}
              />
            </FieldContainer>
          </FormRow>

          <FormRow className="mt-4">
            <FieldContainer label="Branch Name">
              <TextInput
                placeholder="Branch name"
                value={form.branchName}
                onChange={(e) => updateFormField('branchName', e.target.value)}
              />
            </FieldContainer>
            
            <FieldContainer label="Account Type">
              <SelectInput
                value={form.accountType}
                onChange={(e) => updateFormField('accountType', e.target.value as 'savings' | 'current')}
              >
                {accountTypeOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </SelectInput>
            </FieldContainer>
            
            <FieldContainer label="Proof Document (Optional)">
              <div className="flex items-center gap-2">
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png"
                  onChange={(e) => updateFormField('bankProofFile', e.target.files?.[0] || null)}
                  className="hidden"
                  id="bank-proof-file"
                />
                <label
                  htmlFor="bank-proof-file"
                  className="flex items-center gap-2 px-4 py-2.5 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50 transition-colors bg-white shadow-sm"
                >
                  <Upload className="h-4 w-4 text-gray-500" />
                  <span className="text-sm text-gray-600">
                    {form.bankProofFile ? form.bankProofFile.name : 'Choose File'}
                  </span>
                </label>
                {form.bankProofFile && (
                  <button
                    type="button"
                    onClick={() => updateFormField('bankProofFile', null)}
                    className="text-sm text-red-600 hover:text-red-800"
                  >
                    Remove
                  </button>
                )}
              </div>
            </FieldContainer>
          </FormRow>

          <div className="mt-4 flex items-center gap-2">
            <input
              type="checkbox"
              id="default-account"
              checked={form.isDefaultAccount}
              onChange={(e) => updateFormField('isDefaultAccount', e.target.checked)}
              className="h-4 w-4 text-sky-600 focus:ring-sky-500 border-slate-300 rounded"
            />
            <label htmlFor="default-account" className="text-sm text-gray-700">
              Set as default account
            </label>
          </div>
        </div>

        {/* Documents Section */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <SectionHeader 
            icon={FileText} 
            title="Documents" 
            subtitle="Upload and manage employee documents"
          />
          
          <FormRow>
            <FieldContainer label="Document Title">
              <TextInput
                placeholder="e.g., Experience Certificate"
                value={form.documentTitle}
                onChange={(e) => updateFormField('documentTitle', e.target.value)}
              />
            </FieldContainer>
            
            <FieldContainer label="Category">
              <SelectInput
                value={form.documentCategory}
                onChange={(e) => updateFormField('documentCategory', e.target.value)}
              >
                {documentCategoryOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </SelectInput>
            </FieldContainer>
            
            <FieldContainer label="File">
              <div className="flex items-center gap-2">
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                  onChange={(e) => updateFormField('documentFile', e.target.files?.[0] || null)}
                  className="hidden"
                  id="document-file"
                />
                <label
                  htmlFor="document-file"
                  className="flex items-center gap-2 px-4 py-2.5 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50 transition-colors bg-white shadow-sm"
                >
                  <Upload className="h-4 w-4 text-gray-500" />
                  <span className="text-sm text-gray-600">
                    {form.documentFile ? form.documentFile.name : 'Choose File'}
                  </span>
                </label>
                {form.documentFile && (
                  <button
                    type="button"
                    onClick={() => updateFormField('documentFile', null)}
                    className="text-sm text-red-600 hover:text-red-800"
                  >
                    Remove
                  </button>
                )}
              </div>
            </FieldContainer>
          </FormRow>
        </div>

        {/* Settings Section */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <SectionHeader 
            icon={Shield} 
            title="User Settings" 
            subtitle="Configure user permissions and monitoring"
          />
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">
                Screenshot Monitoring Interval
              </label>
              <SelectInput
                value={form.settings.monitoringInterval}
                onChange={(e) => updateSettingsField('monitoringInterval', parseInt(e.target.value) as any)}
              >
                {monitoringIntervalOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </SelectInput>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-700">Can Edit Time</span>
                <ToggleInput
                  checked={form.settings.canEditTime}
                  onChange={(checked) => updateSettingsField('canEditTime', checked)}
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-700">Attendance Monitoring</span>
                <ToggleInput
                  checked={form.settings.attendanceMonitoring}
                  onChange={(checked) => updateSettingsField('attendanceMonitoring', checked)}
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-700">Payroll Visibility</span>
                <ToggleInput
                  checked={form.settings.payrollVisibility}
                  onChange={(checked) => updateSettingsField('payrollVisibility', checked)}
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-700">Task Assignment Access</span>
                <ToggleInput
                  checked={form.settings.taskAssignmentAccess}
                  onChange={(checked) => updateSettingsField('taskAssignmentAccess', checked)}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200">
          <button
            type="button"
            onClick={handleReset}
            className="px-4 py-2 text-gray-600 hover:text-gray-900 font-medium"
          >
            Reset
          </button>
          <Button
            type="submit"
            variant="primary"
            iconLeft={createUserMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            disabled={createUserMutation.isPending}
          >
            {createUserMutation.isPending ? 'Creating User...' : 'Create User'}
          </Button>
        </div>
      </form>

      {/* Quick Create Group Modal */}
      {showGroupModal && (
        <QuickCreateGroupDialog
          open={showGroupModal}
          onClose={() => setShowGroupModal(false)}
          onCreated={() => {
            queryClient.invalidateQueries({ queryKey: ['add-user-groups'] });
          }}
        />
      )}
    </div>
  );
}
