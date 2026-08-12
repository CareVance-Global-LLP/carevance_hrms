import { useState, useEffect, useId, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Mail, Phone, Calendar, MapPin, Briefcase, Building2, Globe, Loader2, Hash, AlertTriangle, XCircle, IndianRupee, Users, FileStack, Lock } from 'lucide-react';
import { groupApi, payrollApi } from '../../../services/api';
import api from '../../../services/api';
import CustomSelect from '../../../components/ui/CustomSelect';
import { TextInput } from '@/components/ui/FormField';
import type { AddUserWizardForm, IncompleteUserCheck } from './types';
import {
  MIN_PASSWORD_LENGTH_ACCEPTED,
  USER_FIELD_LIMITS,
  maxDepartmentsFor,
  passwordRequirements,
  maxJoiningDate as computeMaxJoiningDate,
  validateUserStep1,
} from '@/lib/validation/userRules';

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
/*
 * The input's max now comes from the same helper the validator uses, so the
 * date the picker allows and the date the wizard accepts cannot drift apart —
 * they previously did, and a future joining date left Next silently inert.
 */

export function Step1BasicInfo({ form, setForm, errors, setErrors, onResumeFromStep2, incompleteUser, setIncompleteUser }: Step1Props) {
  const maxJoiningDate = useMemo(computeMaxJoiningDate, []);

  /**
   * Stable ids so each visible caption is bound to its control.
   *
   * Every field here previously rendered a bare `<label>` next to an input with
   * no id, so nothing associated them: a screen reader announced each one as
   * "edit text, blank", and clicking a caption did not focus its field. Chrome's
   * own audit reported the whole form as "No label associated with a form
   * field". `useId()` keeps them unique if the wizard is ever rendered twice.
   */
  const idPrefix = useId();
  const fieldId = (name: string) => `${idPrefix}-${name}`;

  /**
   * The eleven curated zones, plus the current value if it is not among them.
   *
   * Without the fallback entry a timezone outside this shortlist — anyone
   * working from a country the list does not name — renders the placeholder on
   * a field marked required, with a value silently submitted underneath.
   */
  const timezoneOptions = useMemo(() => {
    const options = TIMEZONES.map((tz) => ({ value: tz.value, label: tz.label }));
    if (form.timezone && !options.some((option) => option.value === form.timezone)) {
      options.push({ value: form.timezone, label: `${form.timezone} (detected)` });
    }
    return options;
  }, [form.timezone]);
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
    setForm((prev) => {
      const alreadySelected = prev.departmentIds.includes(deptId);
      if (alreadySelected) {
        return { ...prev, departmentIds: prev.departmentIds.filter((id) => id !== deptId) };
      }

      /*
       * Only an admin may hold more than one department — the server enforces
       * this after validation, in assertSingleGroupMembershipLimit, with
       * "Managers and employees can belong to only one department at a time."
       * Picking a second one here used to be accepted, then rejected two steps
       * later. For a capped role, selecting a department now replaces the
       * previous choice, which is what the picker is actually for.
       */
      const limit = maxDepartmentsFor(prev.role);
      const next = limit === 1 ? [deptId] : [...prev.departmentIds, deptId];

      return { ...prev, departmentIds: next };
    });

    if (errors.departmentIds) {
      setErrors((prev) => ({ ...prev, departmentIds: undefined }));
    }
  };

  const [showIncompleteModal, setShowIncompleteModal] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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

  /**
   * Show the blurred field's error as soon as the user leaves it.
   *
   * Runs the same validator the step gate runs and takes only the message for
   * that one field, rather than re-deriving the rule. This used to re-implement
   * the email, phone, password and joining-date checks inline — four more
   * copies to keep in step with the server — and the phone copy still carried
   * the old unbounded regex, so an over-long number produced no error on blur
   * even though the gate would refuse it a moment later.
   *
   * A field with nothing wrong has its error cleared, so correcting a value and
   * tabbing away removes the message.
   */
  const handleBlur = (field: keyof AddUserWizardForm) => {
    // Untouched empty fields should not be scolded before the user has had a
    // chance to fill them — only report a required-field error once there is
    // something to report about.
    const isEmpty = !String(form[field] ?? '').trim();
    if (isEmpty && !errors[field]) return;

    const fieldErrors = validateUserStep1(form);
    setErrors((prev) => ({ ...prev, [field]: fieldErrors[field] }));

  };

  /*
   * Only the error state is expressed here.
   *
   * The base styling now comes from the shared `TextInput`, which every other
   * form in the app renders through. This file used to hand-roll the whole
   * control — its own border, padding and focus ring, against a hardcoded white
   * background — so the wizard's fields sat a shade off from the drawer around
   * them and did not pick up the theme tokens the rest of the app resolves
   * against. Overriding the border via className is the existing convention;
   * see the government-ID fields in EmployeeDetailWorkspace.
   */
  const errorClass = (field: keyof AddUserWizardForm) =>
    errors[field] ? 'border-red-300 focus:border-red-500 focus:ring-red-500' : '';

  return (
    <div className="px-6 py-5 space-y-5 max-h-[60vh] overflow-y-auto">
      {/*
        Name row. Three columns rather than two: the middle name is kept as its
        own field because statutory filings match on the name as printed on the
        PAN card, and a mismatch is a common cause of 24Q and Form 16 rejection.

        `grid-cols-1 sm:grid-cols-3` rather than a bare `grid-cols-3` — this file
        previously carried no breakpoints at all, so every row stayed multi-column
        on a phone and the inputs were unusably narrow.
      */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor={fieldId('f1')} className="flex items-center gap-1.5 text-sm font-medium text-slate-700 mb-1.5">
            <Briefcase className="h-3.5 w-3.5 text-slate-400" />
            First Name <span className="text-red-400">*</span>
          </label>
          <TextInput
            id={fieldId('f1')}
            type="text"
            value={form.firstName}
            onChange={(e) => {
              setForm((p) => ({ ...p, firstName: e.target.value }));
              if (errors.firstName) setErrors((p) => ({ ...p, firstName: undefined }));
            }}
            onBlur={() => handleBlur('firstName')}
            className={errorClass('firstName')}
            placeholder="John"
          />
          {errors.firstName && <p className="mt-1 text-xs text-red-500">{errors.firstName}</p>}
        </div>
        <div>
          <label htmlFor={fieldId('f1m')} className="block text-sm font-medium text-slate-700 mb-1.5">
            Middle Name <span className="text-slate-400 font-normal">(optional)</span>
          </label>
          <TextInput
            id={fieldId('f1m')}
            type="text"
            value={form.middleName}
            onChange={(e) => setForm((p) => ({ ...p, middleName: e.target.value }))}
            placeholder="as printed on PAN"
          />
        </div>
        <div>
          <label htmlFor={fieldId('f2')} className="block text-sm font-medium text-slate-700 mb-1.5">Last Name</label>
          <TextInput
            id={fieldId('f2')}
            type="text"
            value={form.lastName}
            onChange={(e) => setForm((p) => ({ ...p, lastName: e.target.value }))}
            placeholder="Doe"
          />
        </div>
      </div>

      {/* Email & Phone */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor={fieldId('f3')} className="flex items-center gap-1.5 text-sm font-medium text-slate-700 mb-1.5">
            <Mail className="h-3.5 w-3.5 text-slate-400" />
            Email Address <span className="text-red-400">*</span>
          </label>
          <TextInput
            id={fieldId('f3')}
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
            className={errorClass('email')}
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
          <label htmlFor={fieldId('f4')} className="flex items-center gap-1.5 text-sm font-medium text-slate-700 mb-1.5">
            <Lock className="h-3.5 w-3.5 text-slate-400" />
            Temporary Password <span className="text-red-400">*</span>
          </label>
          <TextInput
            id={fieldId('f4')}
            type="text"
            value={form.password}
            onChange={(e) => {
              setForm((p) => ({ ...p, password: e.target.value }));
              if (errors.password) setErrors((p) => ({ ...p, password: undefined }));
            }}
            onBlur={() => handleBlur('password')}
            className={errorClass('password')}
            placeholder={`At least ${MIN_PASSWORD_LENGTH_ACCEPTED} characters`}
            autoComplete="new-password"
          />
          {errors.password ? (
            <p className="mt-1 text-xs text-red-500">{errors.password}</p>
          ) : (
            // Deliberately not masked: the admin has to read this back to the
            // joiner, and a dot-filled box they cannot check is how the wrong
            // password gets handed over.
            <p className="mt-1 text-xs text-slate-500">
              Share this with the employee — they can change it from Settings after signing in.
            </p>
          )}
          {/*
            Live requirement list rather than one pass/fail message.

            The API's floor is environment-dependent — min(8) outside production,
            min(12) plus composition in it — and this build cannot tell which one
            it is talking to. Blocking at 12 refused passwords a local API would
            take; blocking at 8 with nothing shown would let a production admin
            pass here and collect a 422. So the 8 blocks and the rest advise.
          */}
          {form.password ? (
            <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1" aria-label="Password requirements">
              {passwordRequirements(form.password).map((requirement) => (
                <li
                  key={requirement.label}
                  className={`text-[11px] ${
                    requirement.met
                      ? 'text-emerald-600'
                      : requirement.blocking
                        ? 'text-red-500'
                        : 'text-amber-600'
                  }`}
                >
                  {requirement.met ? '✓' : '○'} {requirement.label}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div>
          <label htmlFor={fieldId('f5')} className="flex items-center gap-1.5 text-sm font-medium text-slate-700 mb-1.5">
            <Phone className="h-3.5 w-3.5 text-slate-400" />
            Phone Number <span className="text-red-400">*</span>
          </label>
          <TextInput
            id={fieldId('f5')}
            type="tel"
            /*
             * maxLength mirrors the server's cap, so an over-long paste is
             * truncated in the field rather than becoming a validation error
             * two steps later.
             */
            maxLength={USER_FIELD_LIMITS.phone}
            value={form.phone}
            onChange={(e) => {
              setForm((p) => ({ ...p, phone: e.target.value }));
              if (errors.phone) setErrors((p) => ({ ...p, phone: undefined }));
            }}
            onBlur={() => handleBlur('phone')}
            className={errorClass('phone')}
            placeholder="+91 98765 43210"
          />
          {errors.phone && <p className="mt-1 text-xs text-red-500">{errors.phone}</p>}
        </div>
      </div>

      {/* Role & Designation */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700 mb-1.5">
            <Building2 className="h-3.5 w-3.5 text-slate-400" />
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
          <label htmlFor={fieldId('f7')} className="flex items-center gap-1.5 text-sm font-medium text-slate-700 mb-1.5">
            <Briefcase className="h-3.5 w-3.5 text-slate-400" />
            Designation <span className="text-red-400">*</span>
          </label>
          <TextInput
            id={fieldId('f7')}
            type="text"
            maxLength={USER_FIELD_LIMITS.designation}
            value={form.designation}
            onChange={(e) => {
              setForm((p) => ({ ...p, designation: e.target.value }));
              if (errors.designation) setErrors((p) => ({ ...p, designation: undefined }));
            }}
            onBlur={() => handleBlur('designation')}
            className={errorClass('designation')}
            placeholder="e.g., Software Engineer"
          />
          {errors.designation && <p className="mt-1 text-xs text-red-500">{errors.designation}</p>}
        </div>
      </div>

      {/* Employee Code (optional) */}
      <div>
        <label htmlFor={fieldId('f8')} className="flex items-center gap-1.5 text-sm font-medium text-slate-700 mb-1.5">
          <Hash className="h-3.5 w-3.5 text-slate-400" />
          Employee Code <span className="text-xs text-slate-400 font-normal">(optional)</span>
        </label>
        <TextInput
            id={fieldId('f8')}
          type="text"
          maxLength={USER_FIELD_LIMITS.employeeCode}
          value={form.employeeCode}
          onChange={(e) => {
            setForm((p) => ({ ...p, employeeCode: e.target.value }));
            if (errors.employeeCode) setErrors((p) => ({ ...p, employeeCode: undefined }));
          }}
          placeholder="e.g., EMP-001"
        />
        {errors.employeeCode ? (
          <p className="mt-1 text-xs text-red-500">{errors.employeeCode}</p>
        ) : (
          <p className="mt-1 text-xs text-slate-400">Unique identifier for this employee</p>
        )}
      </div>

      {/* Department (Multi-select chips) — FROM BACKEND API */}
      <div>
        <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700 mb-2">
          <Building2 className="h-3.5 w-3.5 text-slate-400" />
          Department <span className="text-red-400">*</span>
          <span className="text-xs text-slate-400 font-normal">
            {maxDepartmentsFor(form.role) === 1 ? 'select one' : 'select one or more'}
          </span>
        </label>

        {departmentsLoading ? (
          <div className="flex items-center gap-2 text-sm text-slate-500 py-2">
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
                      : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                  }`}
                >
                  {isActive && <span className="mr-1">✓</span>}
                  {dept.name}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-4 text-sm text-slate-500 bg-slate-50 rounded-lg">
            No departments found. Create one in Settings → Groups.
          </div>
        )}
        {errors.departmentIds && <p className="mt-1 text-xs text-red-500">{errors.departmentIds}</p>}
      </div>

      {/* Date of Joining & Work Location */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor={fieldId('f10')} className="flex items-center gap-1.5 text-sm font-medium text-slate-700 mb-1.5">
            <Calendar className="h-3.5 w-3.5 text-slate-400" />
            Date of Joining <span className="text-red-400">*</span>
          </label>
          <TextInput
            id={fieldId('f10')}
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
            className={errorClass('joiningDate')}
          />
          {errors.joiningDate && <p className="mt-1 text-xs text-red-500">{errors.joiningDate}</p>}
        </div>
        <div>
          <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700 mb-1.5">
            <MapPin className="h-3.5 w-3.5 text-slate-400" />
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
        <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700 mb-1.5">
          <Globe className="h-3.5 w-3.5 text-slate-400" />
          Timezone <span className="text-red-400">*</span>
        </label>
        <CustomSelect
          options={timezoneOptions}
          value={form.timezone}
          onChange={(value) => {
            setForm((p) => ({ ...p, timezone: value }));
            if (errors.timezone) setErrors((p) => ({ ...p, timezone: undefined }));
          }}
          placeholder="Select timezone"
        />
        {errors.timezone ? (
          <p className="mt-1 text-xs text-red-500">{errors.timezone}</p>
        ) : (
          <p className="mt-1 text-xs text-slate-400">Auto-detected from browser. Change if needed.</p>
        )}
      </div>

      {/* Payroll & Compensation */}
      <div className="border-t border-slate-100 pt-5 mt-5">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700 mb-4">Payroll & Compensation</p>

        {/* Annual CTC */}
        <div className="mb-4">
          <label htmlFor={fieldId('f13')} className="flex items-center gap-1.5 text-sm font-medium text-slate-700 mb-1.5">
            <IndianRupee className="h-3.5 w-3.5 text-slate-400" />
            Annual CTC <span className="text-xs text-slate-400 font-normal">(optional)</span>
          </label>
          <TextInput
            id={fieldId('f13')}
            type="number"
            min="0"
            step="1000"
            value={form.annualCtc || ''}
            onChange={(e) => setForm((p) => ({ ...p, annualCtc: e.target.value ? Number(e.target.value) : null }))}
            placeholder="e.g., 600000"
          />
          <p className="mt-1 text-xs text-slate-400">Annual cost to company in INR</p>
        </div>

        {/* Pay Group */}
        <div className="mb-4">
          <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700 mb-1.5">
            <Users className="h-3.5 w-3.5 text-slate-400" />
            Pay Group <span className="text-xs text-slate-400 font-normal">(optional)</span>
          </label>
          {payGroupsLoading ? (
            <div className="flex items-center gap-2 text-sm text-slate-500 py-2">
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
            <div className="text-sm text-slate-500 py-2 bg-slate-50 rounded-lg px-3">
              No pay groups found. Create one in Payroll → Pay Groups.
            </div>
          )}
        </div>

        {/* Salary Structure */}
        <div className="mb-4">
          <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700 mb-1.5">
            <FileStack className="h-3.5 w-3.5 text-slate-400" />
            Salary Structure <span className="text-xs text-slate-400 font-normal">(optional)</span>
          </label>
          {salaryStructuresLoading ? (
            <div className="flex items-center gap-2 text-sm text-slate-500 py-2">
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
              <p className="mt-1 text-xs text-slate-400">
                Default structure is auto-selected. Change if needed.
              </p>
            </>
          ) : (
            <div className="text-sm text-slate-500 py-2 bg-slate-50 rounded-lg px-3">
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

          <div className="relative z-10 w-full max-w-md mx-4 bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden">
            <div className="px-6 pt-6 pb-2">
              <div className="flex items-center justify-center mb-3">
                <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center">
                  <AlertTriangle className="h-6 w-6 text-amber-500" />
                </div>
              </div>
              <h3 className="text-lg font-semibold text-slate-900 text-center">
                {incompleteUser.incomplete ? 'Incomplete Account Found' : 'Account Already Exists'}
              </h3>
              <p className="mt-2 text-sm text-slate-500 text-center leading-relaxed">
                An account for <span className="font-semibold text-slate-700">{incompleteUser.email}</span> already exists.
                {incompleteUser.incomplete ? ' It was started but not completed.' : ''}
                {' '}What would you like to do?
              </p>
            </div>

            {deleteError ? (
              <div role="alert" className="mx-6 mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {deleteError}
              </div>
            ) : null}

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
                className="w-full px-4 py-2.5 text-sm font-medium text-slate-600 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 active:bg-slate-100 transition-colors"
              >
                Use Different Email
              </button>

              <button
                type="button"
                onClick={async () => {
                  if (!incompleteUser.userId) return;
                  setDeleteError(null);
                  try {
                    await api.delete(`/users/${incompleteUser.userId}/incomplete`);
                    setIncompleteUser(null);
                    setShowIncompleteModal(false);
                  } catch (error: any) {
                    // Shown inside the dialog rather than through alert(), which
                    // stacked a browser dialog on top of this one and read as a
                    // crash for what is usually "this account is too far along
                    // to delete".
                    setDeleteError(
                      error.response?.data?.message || 'This account cannot be removed. Resume the setup instead.'
                    );
                  }
                }}
                className="w-full px-4 py-2.5 text-sm font-medium text-red-600 bg-red-50 border border-red-200 rounded-xl hover:bg-red-100 active:bg-red-200 transition-colors"
              >
                Delete & Start Fresh
              </button>

              <button
                type="button"
                onClick={() => setShowIncompleteModal(false)}
                className="w-full px-4 py-2 text-sm font-medium text-slate-400 hover:text-slate-600 transition-colors"
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
