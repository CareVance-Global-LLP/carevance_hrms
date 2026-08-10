import {useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Mail, Phone, Calendar, MapPin, Briefcase, Building2, Globe, Loader2, Hash, AlertTriangle, XCircle, IndianRupee, Users, FileStack, Lock } from 'lucide-react';
import { groupApi, payrollApi } from '../../../services/api';
import api from '../../../services/api';
import CustomSelect from '../../../components/ui/CustomSelect';
import type { AddUserWizardForm, IncompleteUserCheck } from './types';

interface Step1Props {
  form: AddUserWizardForm;
  setForm: React.Dispatch<React.SetStateAction<AddUserWizardForm>>;
  errors: Partial<Record<keyof AddUserWizardForm, string>>;
  setErrors: React.Dispatch<React.SetStateAction<Partial<Record<keyof AddUserWizardForm, string>>>>;
  onResumeFromStep2?: (userId: number) => void;
  incompleteUser: IncompleteUserCheck | null;
  setIncompleteUser: React.Dispatch<React.SetStateAction<IncompleteUserCheck | null>>;
}

const WORK_LOCATIONS = [
  { value: 'office', label: 'Office' },
  { value: 'remote', label: 'Remote' },
  { value: 'hybrid', label: 'Hybrid' },
];

const ROLES = [
  { value: 'employee', label: 'Employee' },
  { value: 'manager', label: 'Manager' },
  { value: 'admin', label: 'Admin' },
];

const TIMEZONES = [
  { value: 'Asia/Kolkata', label: 'IST (UTC+5:30) — India Standard Time' },
  { value: 'America/New_York', label: 'EST (UTC-5) — Eastern Time' },
  { value: 'America/Chicago', label: 'CST (UTC-6) — Central Time' },
  { value: 'America/Denver', label: 'MST (UTC-7) — Mountain Time' },
  { value: 'America/Los_Angeles', label: 'PST (UTC-8) — Pacific Time' },
  { value: 'Europe/London', label: 'GMT (UTC+0) — London' },
  { value: 'Europe/Berlin', label: 'CET (UTC+1) — Berlin' },
  { value: 'Asia/Dubai', label: 'GST (UTC+4) — Dubai' },
  { value: 'Asia/Singapore', label: 'SGT (UTC+8) — Singapore' },
  { value: 'Asia/Tokyo', label: 'JST (UTC+9) — Tokyo' },
  { value: 'Australia/Sydney', label: 'AEST (UTC+10) — Sydney' },
];

/**
 * The furthest joining date the picker will accept, as `YYYY-MM-DD`.
 *
 * Assembled from local date parts on purpose. `toISOString()` converts to UTC
 * first, so in IST it returns yesterday for any local time before 05:30 — the
 * same class of bug that made date-only columns land a day early elsewhere.
 */
function computeMaxJoiningDate(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 2);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

export function Step1BasicInfo({ form, setForm, errors, setErrors, onResumeFromStep2, incompleteUser, setIncompleteUser }: Step1Props) {
  const maxJoiningDate = useMemo(computeMaxJoiningDate, []);
  // Fetch departments from backend API
  const { data: departments, isLoading: departmentsLoading } = useQuery({
    queryKey: ['add-user-groups'],
    queryFn: async () => {
      const response = await groupApi.getAll();
      return response.data.data.map(group => ({
        id: group.id,
        name: group.name,
      }));
    },
    staleTime: 5 * 60 * 1000,
  });

  // Fetch pay groups from backend API
  const { data: payGroups, isLoading: payGroupsLoading } = useQuery({
    queryKey: ['add-user-pay-groups'],
    queryFn: async () => {
      const response = await payrollApi.getPayGroups({ is_active: true });
      return response.data?.pay_groups || [];
    },
    staleTime: 5 * 60 * 1000,
  });

  // Fetch salary structures from backend API
  const { data: salaryStructures, isLoading: salaryStructuresLoading } = useQuery({
    queryKey: ['add-user-salary-structures'],
    queryFn: async () => {
      const response = await payrollApi.getSalaryStructures();
      return response.data?.templates || [];
    },
    staleTime: 5 * 60 * 1000,
  });

  // Pre-select the default salary template when data loads
  useEffect(() => {
    if (salaryStructures && salaryStructures.length > 0 && !form.salaryStructureId) {
      const defaultTemplate = salaryStructures.find((ss: any) => ss.is_default) || salaryStructures[0];
      if (defaultTemplate) {
        setForm((p) => ({ ...p, salaryStructureId: defaultTemplate.id }));
      }
    }
  }, [salaryStructures]);

  const handleDepartmentToggle = (deptId: number) => {
    setForm((prev) => ({
      ...prev,
      departmentIds: prev.departmentIds.includes(deptId)
        ? prev.departmentIds.filter((id) => id !== deptId)
        : [...prev.departmentIds, deptId],
    }));
    if (errors.departmentIds) {
      setErrors((prev) => ({ ...prev, departmentIds: undefined }));
    }
  };

  const [showIncompleteModal, setShowIncompleteModal] = useState(false);

  const [checkingEmail, setCheckingEmail] = useState(false);

  const checkEmail = async (email: string) => {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setIncompleteUser(null);
      return;
    }
    try {
      const response = await api.get(`/users/check-incomplete?email=${encodeURIComponent(email)}`);
      setIncompleteUser(response.data);
    } catch {
      setIncompleteUser(null);
    }
  };

  const handleBlur = (field: keyof AddUserWizardForm) => {
    const newErrors = { ...errors };
    if (field === 'email' && form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      newErrors.email = 'Please enter a valid email';
    }
    if (field === 'phone' && form.phone && !/^[+]?[\d\s-]{10,}$/.test(form.phone)) {
      newErrors.phone = 'Please enter a valid phone number (10+ digits)';
    }
    // Mirrors the API rule (min:8). Caught here so the admin fixes it before
    // reaching step 2, where the account has already been created.
    if (field === 'password' && form.password && form.password.length < 8) {
      newErrors.password = 'Password must be at least 8 characters';
    }
    // Kept in step with the `max` on the date input below, so the picker and
    // the validation agree on what a plausible joining date is.
    //
    // A future joining date is the normal case, not an error: HR sets a joiner
    // up before day one so payroll, assets and accounts are ready when they
    // arrive. Only an implausibly distant date is worth questioning.
    if (field === 'joiningDate' && form.joiningDate) {
      const joining = new Date(form.joiningDate);
      const twoYearsOut = new Date();
      twoYearsOut.setFullYear(twoYearsOut.getFullYear() + 2);
      if (joining > twoYearsOut) {
        newErrors.joiningDate = 'Joining date is more than two years away — please check it';
      } else {
        delete newErrors.joiningDate;
      }
    }
    setErrors(newErrors);
  };

  const inputClass = (field: keyof AddUserWizardForm) =>
    `w-full px-3 py-2.5 text-sm border rounded-lg outline-none transition-all ${
      errors[field]
        ? 'border-red-300 focus:border-red-400 focus:ring-2 focus:ring-red-100'
        : 'border-gray-200 focus:border-blue-400 focus:ring-2 focus:ring-blue-100'
    }`;

  return (
    <div className="px-6 py-5 space-y-5 max-h-[60vh] overflow-y-auto">
      {/* Name Row */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1.5">
            <Briefcase className="h-3.5 w-3.5 text-gray-400" />
            First Name <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={form.firstName}
            onChange={(e) => {
              setForm((p) => ({ ...p, firstName: e.target.value }));
              if (errors.firstName) setErrors((p) => ({ ...p, firstName: undefined }));
            }}
            onBlur={() => handleBlur('firstName')}
            className={inputClass('firstName')}
            placeholder="John"
          />
          {errors.firstName && <p className="mt-1 text-xs text-red-500">{errors.firstName}</p>}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Last Name</label>
          <input
            type="text"
            value={form.lastName}
            onChange={(e) => setForm((p) => ({ ...p, lastName: e.target.value }))}
            className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg outline-none
                       focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
            placeholder="Doe"
          />
        </div>
      </div>

      {/* Email & Phone */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1.5">
            <Mail className="h-3.5 w-3.5 text-gray-400" />
            Email Address <span className="text-red-400">*</span>
          </label>
          <input
            type="email"
            value={form.email}
            onChange={(e) => {
              setForm((p) => ({ ...p, email: e.target.value }));
              if (errors.email) setErrors((p) => ({ ...p, email: undefined }));
              setIncompleteUser(null);
            }}
            onBlur={() => {
              handleBlur('email');
              if (!form.userId) {
                checkEmail(form.email);
              }
            }}
            className={inputClass('email')}
            placeholder="john@company.com"
          />
          {errors.email && <p className="mt-1 text-xs text-red-500">{errors.email}</p>}
          {checkingEmail && (
            <p className="mt-1 text-xs text-blue-500">Checking email availability...</p>
          )}
          {/* Show amber Resume popup for ANY existing user — incomplete or complete */}
          {incompleteUser?.exists && incompleteUser.userId && onResumeFromStep2 && !showIncompleteModal && !form.userId && (
            <div className="mt-2 flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg cursor-pointer"
                 onClick={() => setShowIncompleteModal(true)}>
              <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
              <span className="text-sm text-amber-700 font-medium">
                An account with this email already exists. Click here for options.
              </span>
            </div>
          )}
          {incompleteUser?.exists && !incompleteUser?.incomplete && (
            <div className="mt-3 p-4 bg-red-50 border border-red-200 rounded-lg">
              <div className="flex items-start gap-2">
                <XCircle className="h-5 w-5 text-red-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-red-800">Email already registered</p>
                  <p className="text-sm text-red-700 mt-1">
                    An account with <strong>{incompleteUser.email}</strong> already exists.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
        <div>
          <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1.5">
            <Lock className="h-3.5 w-3.5 text-gray-400" />
            Temporary Password <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={form.password}
            onChange={(e) => {
              setForm((p) => ({ ...p, password: e.target.value }));
              if (errors.password) setErrors((p) => ({ ...p, password: undefined }));
            }}
            onBlur={() => handleBlur('password')}
            className={inputClass('password')}
            placeholder="At least 8 characters"
            autoComplete="new-password"
          />
          {errors.password ? (
            <p className="mt-1 text-xs text-red-500">{errors.password}</p>
          ) : (
            // Deliberately not masked: the admin has to read this back to the
            // joiner, and a dot-filled box they cannot check is how the wrong
            // password gets handed over.
            <p className="mt-1 text-xs text-gray-500">
              Share this with the employee — they can change it from Settings after signing in.
            </p>
          )}
        </div>
        <div>
          <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1.5">
            <Phone className="h-3.5 w-3.5 text-gray-400" />
            Phone Number <span className="text-red-400">*</span>
          </label>
          <input
            type="tel"
            value={form.phone}
            onChange={(e) => {
              setForm((p) => ({ ...p, phone: e.target.value }));
              if (errors.phone) setErrors((p) => ({ ...p, phone: undefined }));
            }}
            onBlur={() => handleBlur('phone')}
            className={inputClass('phone')}
            placeholder="+91 98765 43210"
          />
          {errors.phone && <p className="mt-1 text-xs text-red-500">{errors.phone}</p>}
        </div>
      </div>

      {/* Role & Designation */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1.5">
            <Building2 className="h-3.5 w-3.5 text-gray-400" />
            Role <span className="text-red-400">*</span>
          </label>
          <CustomSelect
            options={ROLES.map((r) => ({ value: r.value, label: r.label }))}
            value={form.role}
            onChange={(value) => setForm((p) => ({ ...p, role: value as any }))}
            placeholder="Select role"
          />
        </div>
        <div>
          <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1.5">
            <Briefcase className="h-3.5 w-3.5 text-gray-400" />
            Designation <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={form.designation}
            onChange={(e) => {
              setForm((p) => ({ ...p, designation: e.target.value }));
              if (errors.designation) setErrors((p) => ({ ...p, designation: undefined }));
            }}
            onBlur={() => handleBlur('designation')}
            className={inputClass('designation')}
            placeholder="e.g., Software Engineer"
          />
          {errors.designation && <p className="mt-1 text-xs text-red-500">{errors.designation}</p>}
        </div>
      </div>

      {/* Employee Code (optional) */}
      <div>
        <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1.5">
          <Hash className="h-3.5 w-3.5 text-gray-400" />
          Employee Code <span className="text-xs text-gray-400 font-normal">(optional)</span>
        </label>
        <input
          type="text"
          value={form.employeeCode}
          onChange={(e) => setForm((p) => ({ ...p, employeeCode: e.target.value }))}
          className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg outline-none
                     focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
          placeholder="e.g., EMP-001"
        />
        <p className="mt-1 text-xs text-gray-400">Unique identifier for this employee</p>
      </div>

      {/* Department (Multi-select chips) — FROM BACKEND API */}
      <div>
        <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-2">
          <Building2 className="h-3.5 w-3.5 text-gray-400" />
          Department <span className="text-red-400">*</span>
          <span className="text-xs text-gray-400 font-normal">select one or more</span>
        </label>

        {departmentsLoading ? (
          <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading departments...
          </div>
        ) : departments && departments.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {departments.map((dept) => {
              const isActive = form.departmentIds.includes(dept.id);
              return (
                <button
                  key={dept.id}
                  onClick={() => handleDepartmentToggle(dept.id)}
                  className={`px-3 py-1.5 text-sm rounded-full border transition-all ${
                    isActive
                      ? 'bg-blue-50 border-blue-300 text-blue-700 font-medium'
                      : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  {isActive && <span className="mr-1">✓</span>}
                  {dept.name}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-4 text-sm text-gray-500 bg-gray-50 rounded-lg">
            No departments found. Create one in Settings → Groups.
          </div>
        )}
        {errors.departmentIds && <p className="mt-1 text-xs text-red-500">{errors.departmentIds}</p>}
      </div>

      {/* Date of Joining & Work Location */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1.5">
            <Calendar className="h-3.5 w-3.5 text-gray-400" />
            Date of Joining <span className="text-red-400">*</span>
          </label>
          <input
            type="date"
            value={form.joiningDate}
            /* Was capped at today, which made pre-boarding impossible on the
               primary hire path — the picker refused the future date that the
               validation above explicitly allows, and that the whole onboarding
               checklist is anchored on (its first items sit at day −14).
               Matched to that validation: two years out, and no lower bound
               because backdating a late-entered joiner is legitimate.
               Built from local date parts rather than toISOString(), which
               resolves against UTC and lands a day early in IST. */
            max={maxJoiningDate}
            onChange={(e) => {
              setForm((p) => ({ ...p, joiningDate: e.target.value }));
              if (errors.joiningDate) setErrors((p) => ({ ...p, joiningDate: undefined }));
            }}
            onBlur={() => handleBlur('joiningDate')}
            className={inputClass('joiningDate')}
          />
          {errors.joiningDate && <p className="mt-1 text-xs text-red-500">{errors.joiningDate}</p>}
        </div>
        <div>
          <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1.5">
            <MapPin className="h-3.5 w-3.5 text-gray-400" />
            Work Location <span className="text-red-400">*</span>
          </label>
          <CustomSelect
            options={WORK_LOCATIONS.map((loc) => ({ value: loc.value, label: loc.label }))}
            value={form.workLocation}
            onChange={(value) => setForm((p) => ({ ...p, workLocation: value as any }))}
            placeholder="Select location"
          />
        </div>
      </div>

      {/* Timezone */}
      <div>
        <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1.5">
          <Globe className="h-3.5 w-3.5 text-gray-400" />
          Timezone <span className="text-red-400">*</span>
        </label>
        <CustomSelect
          options={TIMEZONES.map((tz) => ({ value: tz.value, label: tz.label }))}
          value={form.timezone}
          onChange={(value) => setForm((p) => ({ ...p, timezone: value }))}
          placeholder="Select timezone"
        />
        <p className="mt-1 text-xs text-gray-400">Auto-detected from browser. Change if needed.</p>
      </div>

      {/* Payroll & Compensation */}
      <div className="border-t border-gray-100 pt-5 mt-5">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700 mb-4">Payroll & Compensation</p>

        {/* Annual CTC */}
        <div className="mb-4">
          <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1.5">
            <IndianRupee className="h-3.5 w-3.5 text-gray-400" />
            Annual CTC <span className="text-xs text-gray-400 font-normal">(optional)</span>
          </label>
          <input
            type="number"
            min="0"
            step="1000"
            value={form.annualCtc || ''}
            onChange={(e) => setForm((p) => ({ ...p, annualCtc: e.target.value ? Number(e.target.value) : null }))}
            className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
            placeholder="e.g., 600000"
          />
          <p className="mt-1 text-xs text-gray-400">Annual cost to company in INR</p>
        </div>

        {/* Pay Group */}
        <div className="mb-4">
          <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1.5">
            <Users className="h-3.5 w-3.5 text-gray-400" />
            Pay Group <span className="text-xs text-gray-400 font-normal">(optional)</span>
          </label>
          {payGroupsLoading ? (
            <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading pay groups...
            </div>
          ) : payGroups && payGroups.length > 0 ? (
            <CustomSelect
              options={[
                { value: '', label: 'Select pay group (optional)' },
                ...payGroups.map((pg: any) => ({ value: String(pg.id), label: `${pg.name} (${pg.code})` })),
              ]}
              value={form.payGroupId ? String(form.payGroupId) : ''}
              onChange={(value) => setForm((p) => ({ ...p, payGroupId: value ? Number(value) : null }))}
              placeholder="Select pay group"
              dropDirection="down"
            />
          ) : (
            <div className="text-sm text-gray-500 py-2 bg-gray-50 rounded-lg px-3">
              No pay groups found. Create one in Payroll → Pay Groups.
            </div>
          )}
        </div>

        {/* Salary Structure */}
        <div className="mb-4">
          <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1.5">
            <FileStack className="h-3.5 w-3.5 text-gray-400" />
            Salary Structure <span className="text-xs text-gray-400 font-normal">(optional)</span>
          </label>
          {salaryStructuresLoading ? (
            <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading salary structures...
            </div>
          ) : salaryStructures && salaryStructures.length > 0 ? (
            <>
              <CustomSelect
                options={[
                  ...salaryStructures.map((ss: any) => ({
                    value: String(ss.id),
                    label: ss.is_default ? `${ss.name} (Default)` : ss.name,
                  })),
                ]}
                value={form.salaryStructureId ? String(form.salaryStructureId) : ''}
                onChange={(value) => setForm((p) => ({ ...p, salaryStructureId: value ? Number(value) : null }))}
                placeholder="Select salary structure"
                dropDirection="down"
              />
              <p className="mt-1 text-xs text-gray-400">
                Default structure is auto-selected. Change if needed.
              </p>
            </>
          ) : (
            <div className="text-sm text-gray-500 py-2 bg-gray-50 rounded-lg px-3">
              No salary structures found. Create one in Payroll → Salary Structures.
            </div>
          )}
        </div>
      </div>

      {/* Existing User Modal Popup — shows for ANY existing user */}
      {showIncompleteModal && incompleteUser?.exists && incompleteUser.userId && onResumeFromStep2 && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={(e) => e.stopPropagation()}
          />

          <div className="relative z-10 w-full max-w-md mx-4 bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden">
            <div className="px-6 pt-6 pb-2">
              <div className="flex items-center justify-center mb-3">
                <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center">
                  <AlertTriangle className="h-6 w-6 text-amber-500" />
                </div>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 text-center">
                {incompleteUser.incomplete ? 'Incomplete Account Found' : 'Account Already Exists'}
              </h3>
              <p className="mt-2 text-sm text-gray-500 text-center leading-relaxed">
                An account for <span className="font-semibold text-gray-700">{incompleteUser.email}</span> already exists.
                {incompleteUser.incomplete ? ' It was started but not completed.' : ''}
                {' '}What would you like to do?
              </p>
            </div>

            <div className="px-6 pb-6 pt-4 space-y-2.5">
              <button
                type="button"
                onClick={() => {
                  setForm((prev) => ({
                    ...prev,
                    userId: incompleteUser.userId!,
                    firstName: incompleteUser.name?.split(' ')[0] || prev.firstName,
                    lastName: incompleteUser.name?.split(' ').slice(1).join(' ') || prev.lastName,
                  }));
                  setShowIncompleteModal(false);
                  onResumeFromStep2(incompleteUser.userId!);
                }}
                className="w-full px-4 py-2.5 text-sm font-semibold text-white bg-amber-500 rounded-xl hover:bg-amber-600 active:bg-amber-700 transition-colors shadow-sm"
              >
                {incompleteUser.incomplete ? 'Resume Setup' : 'View Account'}
              </button>

              <button
                type="button"
                onClick={() => {
                  setForm((prev) => ({ ...prev, email: '' }));
                  setIncompleteUser(null);
                  setErrors((prev) => ({ ...prev, email: undefined }));
                  setShowIncompleteModal(false);
                }}
                className="w-full px-4 py-2.5 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-xl hover:bg-gray-50 active:bg-gray-100 transition-colors"
              >
                Use Different Email
              </button>

              <button
                type="button"
                onClick={async () => {
                  if (!incompleteUser.userId) return;
                  try {
                    await api.delete(`/users/${incompleteUser.userId}/incomplete`);
                    setIncompleteUser(null);
                    setShowIncompleteModal(false);
                  } catch (error: any) {
                    alert(error.response?.data?.message || 'Cannot remove this user. Please resume instead.');
                  }
                }}
                className="w-full px-4 py-2.5 text-sm font-medium text-red-600 bg-red-50 border border-red-200 rounded-xl hover:bg-red-100 active:bg-red-200 transition-colors"
              >
                Delete & Start Fresh
              </button>

              <button
                type="button"
                onClick={() => setShowIncompleteModal(false)}
                className="w-full px-4 py-2 text-sm font-medium text-gray-400 hover:text-gray-600 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
