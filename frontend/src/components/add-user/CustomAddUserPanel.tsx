import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import api, { payrollApi } from '../../services/api';
import { WizardProgress } from './steps/WizardProgress';
import { WizardActions } from './steps/WizardActions';
import { Step1BasicInfo } from './steps/Step1BasicInfo';
import { Step2AccountCreated } from './steps/Step2AccountCreated';
import { Step3Profile } from './steps/Step3Profile';
import { defaultForm, type AddUserWizardForm, type IncompleteUserCheck } from './steps/types';
import EmployeeDetailsSection from '@/components/EmployeeDetailsSection';

// ── Helper: Extract user-friendly error message ────────────

function extractErrorMessage(error: any): string {
  if (!error.response) {
    return 'Network error. Please check your connection.';
  }

  const { status, data } = error.response;

  if (status === 422) {
    const errors = data?.errors;
    if (errors && typeof errors === 'object') {
      const firstField = Object.keys(errors)[0];
      const firstMessage = errors[firstField]?.[0];
      if (firstMessage) return firstMessage;
    }
    return data?.message || 'Please check your input and try again.';
  }

  if (status === 401) return 'Your session has expired. Please log in again.';
  if (status === 403) return 'You do not have permission to perform this action.';
  if (status === 404) return 'The requested resource was not found.';
  if (status === 409) return data?.message || 'This record already exists.';
  if (status === 429) return 'Too many requests. Please wait a moment and try again.';
  if (status === 500) return 'Something went wrong on our end. Please try again later.';

  return data?.message || `Something went wrong (Error ${status}).`;
}

// ── Helper: Extract field-specific errors ──────────────────

function extractFieldErrors(error: any): Partial<Record<keyof AddUserWizardForm, string>> {
  const fieldErrors: Partial<Record<keyof AddUserWizardForm, string>> = {};

  if (error.response?.status !== 422) return fieldErrors;

  const errors = error.response?.data?.errors;
  if (!errors || typeof errors !== 'object') return fieldErrors;

  const fieldMapping: Record<string, keyof AddUserWizardForm> = {
    name: 'firstName',
    first_name: 'firstName',
    last_name: 'lastName',
    email: 'email',
    phone: 'phone',
    role: 'role',
    designation: 'designation',
    joining_date: 'joiningDate',
    work_location: 'workLocation',
    timezone: 'timezone',
    department_ids: 'departmentIds',
    group_ids: 'departmentIds',
    employee_code: 'employeeCode',
  };

  Object.entries(errors).forEach(([field, messages]) => {
    const formField = fieldMapping[field];
    if (formField && Array.isArray(messages) && messages.length > 0) {
      fieldErrors[formField] = messages[0];
    }
  });

  return fieldErrors;
}

type WizardStep = 1 | 2 | 3 | 'completed';

interface CustomAddUserPanelProps {
  organizationId: number;
  allowedRoles: string[];
  onSuccess: () => void;
  onError: (message: string) => void;
}

// ── Validation helpers ──────────────────────────────────────

const isValidEmail = (email: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const isValidPhone = (phone: string): boolean => /^[+]?[\d\s-]{10,}$/.test(phone);

const canProceedFromStep1 = (form: AddUserWizardForm, incompleteUser: IncompleteUserCheck | null): boolean => {
  // Block submission if email already exists as a complete account in this org
  if (incompleteUser?.exists && !incompleteUser?.incomplete) {
    return false;
  }
  return (
    form.firstName.trim() !== '' &&
    form.email.trim() !== '' &&
    isValidEmail(form.email) &&
    form.phone.trim() !== '' &&
    isValidPhone(form.phone) &&
    form.departmentIds.length > 0 &&
    form.designation.trim() !== '' &&
    form.joiningDate !== '' &&
    new Date(form.joiningDate) <= new Date()
  );
};

const validateStep1 = (form: AddUserWizardForm): Partial<Record<keyof AddUserWizardForm, string>> => {
  const errors: Partial<Record<keyof AddUserWizardForm, string>> = {};

  if (!form.firstName.trim()) {
    errors.firstName = 'First name is required';
  }
  if (!form.email.trim()) {
    errors.email = 'Email is required';
  } else if (!isValidEmail(form.email)) {
    errors.email = 'Please enter a valid email';
  }
  if (!form.phone.trim()) {
    errors.phone = 'Phone number is required';
  } else if (!isValidPhone(form.phone)) {
    errors.phone = 'Please enter a valid phone number';
  }
  if (form.departmentIds.length === 0) {
    errors.departmentIds = 'Please select at least one department';
  }
  if (!form.designation.trim()) {
    errors.designation = 'Designation is required';
  }
  if (!form.joiningDate) {
    errors.joiningDate = 'Joining date is required';
  } else if (new Date(form.joiningDate) > new Date()) {
    errors.joiningDate = 'Joining date cannot be in the future';
  }

  return errors;
};

const hasAnyStep3Data = (form: AddUserWizardForm): boolean => {
  return (
    form.gender !== '' ||
    form.dateOfBirth !== '' ||
    form.personalEmail !== '' ||
    form.addressLine1 !== '' ||
    form.city !== '' ||
    form.state !== '' ||
    form.pincode !== '' ||
    form.emergencyContactName !== '' ||
    form.idType !== '' ||
    form.accountNumber !== ''
  );
};

// ── localStorage helpers ───────────────────────────────────

const STORAGE_KEY = 'add-user-wizard-state';

interface PersistedWizardState {
  step: 1 | 2 | 3;
  form: Partial<AddUserWizardForm>;
  userId: number | null;
  createdAt: string;
}

function loadWizardState(): PersistedWizardState | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    const state = JSON.parse(stored) as PersistedWizardState;
    // Expire after 24 hours
    if (state.createdAt) {
      const hoursDiff = (Date.now() - new Date(state.createdAt).getTime()) / (1000 * 60 * 60);
      if (hoursDiff > 24) {
        localStorage.removeItem(STORAGE_KEY);
        return null;
      }
    }
    return state;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

function saveWizardState(state: PersistedWizardState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, createdAt: new Date().toISOString() }));
  } catch {
    // localStorage full or unavailable
  }
}

function clearWizardState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

// ── Main Component ──────────────────────────────────────────

export default function CustomAddUserPanel({ organizationId, allowedRoles, onSuccess, onError }: CustomAddUserPanelProps) {
  const queryClient = useQueryClient();

  // ✅ Load persisted state on mount
  const persistedState = loadWizardState();

  const [currentStep, setCurrentStep] = useState<WizardStep>(
    persistedState?.step && [1, 2, 3].includes(persistedState.step) ? persistedState.step : 1
  );
  const [form, setForm] = useState<AddUserWizardForm>({
    ...defaultForm,
    ...(persistedState?.form ?? {}),
  });
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [errors, setErrors] = useState<Partial<Record<keyof AddUserWizardForm, string>>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [incompleteUser, setIncompleteUser] = useState<IncompleteUserCheck | null>(null);

  // ✅ Welcome back message if resuming from persisted state
  useEffect(() => {
    if (persistedState?.step && persistedState.step >= 2 && persistedState.form?.email) {
      setFeedback({
        type: 'success',
        message: `Welcome back! Continuing setup for ${persistedState.form.email}.`,
      });
    }
  }, []);

  // ❌ REMOVED: Old disabled saveWizardState usage — now we save properly below

  // ── API: Create user (Step 1) ────────────────────────────

  const createUserMutation = useMutation({
    mutationFn: async (formData: AddUserWizardForm) => {
      const fullName = `${formData.firstName} ${formData.lastName}`.trim();

      // Step A: Create user
      const userResponse = await api.post('/users', {
        name: fullName || formData.email.split('@')[0],
        email: formData.email,
        phone: formData.phone,
        role: formData.role,
        group_ids: formData.departmentIds,
        settings: {
          timezone: formData.timezone,
          attendance_monitoring: true,
          payroll_visibility: false,
          can_edit_time: false,
          task_assignment_access: true,
          monitoring_interval_minutes: 10,
        },
      });

      const userId = userResponse.data?.id || userResponse.data?.data?.id;

      // Step B–E: Save profile, work-info, CTC, pay group
      // If any step fails AFTER user is created, attempt rollback (delete orphaned user)
      if (userId) {
        try {
          await api.put(`/employees/${userId}/profile`, {
            first_name: formData.firstName || undefined,
            last_name: formData.lastName || undefined,
            phone: formData.phone || undefined,
            personal_email: formData.email || undefined,
          });

          if (formData.employeeCode || formData.designation || formData.joiningDate || formData.workLocation) {
            await api.put(`/employees/${userId}/work-info`, {
              employee_code: formData.employeeCode || undefined,
              designation: formData.designation || undefined,
              joining_date: formData.joiningDate || undefined,
              work_location: formData.workLocation || undefined,
            });
          }

          if (formData.annualCtc) {
            const monthYear = new Date().toISOString().slice(0, 7);
            await api.patch(`/payroll/employees/${userId}/ctc`, {
              annual_ctc: formData.annualCtc,
              month_year: monthYear,
            });
          }

          // ✅ Only attempt pay-group/salary-structure assignment when
          // payGroupId is actually set. Avoids sending `pay_group_id: null`
          // to a required|integer field.
          if (formData.payGroupId) {
            await payrollApi.assignEmployeeToExistingPayGroup({
              pay_group_id: formData.payGroupId,
              user_ids: [userId],
              ...(formData.salaryStructureId
                ? { salary_structure_id: formData.salaryStructureId }
                : {}),
            });
          }
        } catch (postCreateError: any) {
          // Rollback policy:
          //  - 422 on profile/work-info/CTC = user-fixable, roll back the user.
          //  - 5xx = server error, keep the user (it's not the user's fault).
          //  - Failures on pay-group assignment only — don't roll back; the
          //    user is already created and registered, just keep them and
          //    surface the error so they can re-assign later.
          const status = postCreateError.response?.status;
          const errorEndpoint = postCreateError.response?.config?.url || '';
          const wasAssignmentFailure = errorEndpoint.includes('/pay-groups/assign-existing');
          if (!wasAssignmentFailure) {
            if (status && status < 500) {
              try {
                await api.delete(`/users/${userId}`);
              } catch {
                // Best-effort cleanup; ignore failures
              }
            } else {
              // Clear userId from form so the banner/check re-triggers fresh
              setForm((prev) => ({ ...prev, userId: null }));
            }
          }
          throw postCreateError;
        }
      }

      return { ...userResponse.data, userId };
    },
  });

  // ── API: Save profile data (Step 3) ──────────────────────

  const saveStep3Data = async (formData: AddUserWizardForm): Promise<void> => {
    if (!formData.userId) return;

    const promises: Promise<any>[] = [];

    // Save profile if any personal data provided
    if (formData.gender || formData.dateOfBirth || formData.addressLine1 || formData.city) {
      promises.push(
        api.put(`/employees/${formData.userId}/profile`, {
          gender: formData.gender || undefined,
          date_of_birth: formData.dateOfBirth || undefined,
          personal_email: formData.personalEmail || undefined,
          address: [formData.addressLine1, formData.addressLine2].filter(Boolean).join(', ') || undefined,
          city: formData.city || undefined,
          state: formData.state || undefined,
          pincode: formData.pincode || undefined,
          emergency_contact_name: formData.emergencyContactName || undefined,
          emergency_contact_number: formData.emergencyContactPhone || undefined,
          emergency_contact_relationship: formData.emergencyRelationship || undefined,
        })
      );
    }

    // Upload government ID if provided
    if (formData.idType && formData.idNumber) {
      const idFormData = new FormData();
      idFormData.append('id_type', formData.idType);
      idFormData.append('id_number', formData.idNumber);
      if (formData.idProofFile) {
        idFormData.append('proof_document', formData.idProofFile);
      }
      promises.push(
        api.post(`/employees/${formData.userId}/government-ids`, idFormData)
      );
    }

    // Save bank account if provided
    if (formData.accountNumber && formData.ifscCode) {
      const bankFormData = new FormData();
      bankFormData.append('account_holder_name', formData.accountHolderName || `${formData.firstName} ${formData.lastName}`);
      bankFormData.append('bank_name', formData.bankName);
      bankFormData.append('account_number', formData.accountNumber);
      bankFormData.append('ifsc_swift', formData.ifscCode.toUpperCase());
      bankFormData.append('branch_name', formData.branchName);
      bankFormData.append('account_type', formData.accountType);
      bankFormData.append('is_primary', formData.isDefaultAccount.toString());
      if (formData.bankProofFile) {
        bankFormData.append('proof_document', formData.bankProofFile);
      }
      promises.push(
        api.post(`/employees/${formData.userId}/bank-accounts`, bankFormData)
      );
    }

    // Upload documents
    const documentFiles = [
      { file: formData.resumeFile, title: 'Resume', category: 'resume' },
      { file: formData.experienceCertFile, title: 'Experience Certificate', category: 'experience_certificate' },
      { file: formData.educationCertFile, title: 'Education Certificate', category: 'education_certificate' },
    ];
    for (const doc of documentFiles) {
      if (doc.file) {
        const docFormData = new FormData();
        docFormData.append('title', doc.title);
        docFormData.append('category', doc.category);
        docFormData.append('file', doc.file);
        promises.push(
          api.post(`/employees/${formData.userId}/documents`, docFormData)
        );
      }
    }

    await Promise.allSettled(promises);
  };

  // ── Navigation handlers ───────────────────────────────────

  const handleNext = async () => {
    if (currentStep === 1) {
      if (!canProceedFromStep1(form, incompleteUser)) {
        setErrors(validateStep1(form));
        return;
      }

      // ✅ If user was already created (resuming from Step 2), just proceed
      if (form.userId) {
        setCompletedSteps((prev) => new Set(prev).add(1));
        setCurrentStep(2);
        return;
      }

      setIsSubmitting(true);
      setErrors({});
      setIncompleteUser(null);
      try {
        const result = await createUserMutation.mutateAsync(form);
        setForm((prev) => ({
          ...prev,
          userId: result.userId || result.id,
        }));
        setCompletedSteps((prev) => new Set(prev).add(1));
        setCurrentStep(2);
        // ✅ Persist state after Step 1 succeeds
        const userId = result.userId || result.id;
        // ✅ Refresh downstream caches so the Payroll dashboard, pay-groups
        // grid, and unassigned-employees list all reflect the new user /
        // pay-group assignment immediately.
        queryClient.invalidateQueries({ queryKey: ['payroll', 'pay-groups'] });
        queryClient.invalidateQueries({ queryKey: ['payroll', 'unassigned-employees'] });
        queryClient.invalidateQueries({ queryKey: ['payroll', 'dashboard'] });
        queryClient.invalidateQueries({ queryKey: ['payroll', 'stats'] });
        queryClient.invalidateQueries({ queryKey: ['employee-payroll-cards'] });
        saveWizardState({
          step: 2,
          form: { ...form, userId },
          userId,
          createdAt: new Date().toISOString(),
        });
      } catch (error: any) {
        const errorMessage = extractErrorMessage(error);
        const fieldErrors = extractFieldErrors(error);
        if (Object.keys(fieldErrors).length > 0) {
          setErrors(fieldErrors);
        } else {
          setErrors({ email: errorMessage });
        }
      } finally {
        setIsSubmitting(false);
      }
    } else if (currentStep === 2) {
      setCompletedSteps((prev) => new Set(prev).add(2));
      setCurrentStep(3);
    } else if (currentStep === 3) {
      setIsSubmitting(true);
      try {
        if (hasAnyStep3Data(form)) {
          await saveStep3Data(form);
        }

        // ✅ Send invitation ONLY after ALL steps complete
        if (form.userId && form.email) {
          try {
            await api.post('/invites/send', {
              email: form.email,
              role: form.role,
              first_name: form.firstName,
              last_name: form.lastName,
              employee_code: form.employeeCode,
              is_new_user: true,
            });
          } catch (inviteError) {
            console.warn('Failed to send invitation email:', inviteError);
          }
        }

        setCompletedSteps((prev) => new Set(prev).add(3));
        setCurrentStep('completed');
        clearWizardState();
      } catch (error) {
        console.warn('Step 3 save warning:', error);

        // ✅ Even if Step 3 data fails, still try to send invite
        if (form.userId && form.email) {
          try {
            await api.post('/invites/send', {
              email: form.email,
              role: form.role,
              first_name: form.firstName,
              last_name: form.lastName,
              employee_code: form.employeeCode,
              is_new_user: true,
            });
          } catch (inviteError) {
            console.warn('Failed to send invitation email:', inviteError);
          }
        }

        setCompletedSteps((prev) => new Set(prev).add(3));
        setCurrentStep('completed');
        clearWizardState();
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  const handleBack = () => {
    setErrors({});
    setFeedback(null);
    if (currentStep === 2) setCurrentStep(1);
    else if (currentStep === 3) setCurrentStep(2);
  };

  const handleSkip = () => {
    if (currentStep === 3) {
      setCompletedSteps((prev) => new Set(prev).add(3));
      setCurrentStep('completed');
    }
  };

  // ✅ Resume from Step 2 when incomplete user is detected
  const handleResumeFromStep2 = async (userId: number) => {
    setIsSubmitting(true);
    try {
      const response = await api.get(`/users/${userId}`);
      const userData = response.data;

      const updatedForm = {
        ...form,
        userId,
        firstName: userData.name?.split(' ')[0] || form.firstName,
        lastName: userData.name?.split(' ').slice(1).join(' ') || form.lastName,
        email: userData.email || form.email,
        phone: userData.phone || form.phone,
        role: userData.role || form.role,
        designation: userData.designation || form.designation,
        departmentIds: userData.department_ids || form.departmentIds,
        joiningDate: userData.joining_date || form.joiningDate,
        workLocation: userData.work_location || form.workLocation,
        employeeCode: userData.employee_code || form.employeeCode,
      };

      setForm(updatedForm);
      setCompletedSteps(new Set([1]));
      setCurrentStep(2);

      saveWizardState({
        step: 2,
        form: updatedForm,
        userId,
        createdAt: new Date().toISOString(),
      });

      setFeedback({
        type: 'success',
        message: `Resuming setup for ${userData.email || form.email}.`,
      });
    } catch (error) {
      console.warn('Failed to load user data:', error);
      setForm((prev) => ({ ...prev, userId }));
      setCompletedSteps(new Set([1]));
      setCurrentStep(2);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleComplete = () => {
    queryClient.invalidateQueries({ queryKey: ['add-user-members', organizationId] });
    queryClient.invalidateQueries({ queryKey: ['add-user-groups'] });
    queryClient.invalidateQueries({ queryKey: ['employee-workspace-users'] });
    queryClient.invalidateQueries({ queryKey: ['employee-workspace-members', organizationId] });
    onSuccess();
  };

  const handleAddAnother = () => {
    setCurrentStep(1);
    setForm({ ...defaultForm });
    setCompletedSteps(new Set());
    setErrors({});
    setFeedback(null);
    clearWizardState();
  };

  return (
    <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
      {/* Wizard Progress */}
      {currentStep !== 'completed' && (
        <WizardProgress currentStep={currentStep as number} completedSteps={completedSteps} />
      )}

      {/* Feedback banner */}
      {feedback && (
        <div
          className={`mx-6 mt-4 px-4 py-3 rounded-lg flex items-center gap-2 text-sm ${
            feedback.type === 'success'
              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
          )}
          {feedback.message}
        </div>
      )}

      {/* Step content */}
      {currentStep === 1 && (
        <Step1BasicInfo form={form} setForm={setForm} errors={errors} setErrors={setErrors} onResumeFromStep2={handleResumeFromStep2} incompleteUser={incompleteUser} setIncompleteUser={setIncompleteUser} />
      )}
      {currentStep === 2 && <Step2AccountCreated form={form} />}
      {currentStep === 3 && <Step3Profile form={form} setForm={setForm} />}
      {currentStep === 'completed' && (
        <div className="space-y-4">
          <div className="px-6 py-4 bg-emerald-50 border-b border-emerald-100 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-emerald-100 flex items-center justify-center">
                <CheckCircle2 className="h-6 w-6 text-emerald-500" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-emerald-900">User Created Successfully!</h3>
                <p className="text-sm text-emerald-700">
                  {form.firstName} {form.lastName} ({form.employeeCode || 'No code'}) has been added. Invitation email sent to {form.email}.
                </p>
              </div>
            </div>
            <button
              onClick={handleAddAnother}
              className="px-4 py-2 text-sm font-medium text-emerald-700 bg-white border border-emerald-300 rounded-lg hover:bg-emerald-50 transition-colors whitespace-nowrap"
            >
              + Add Another
            </button>
          </div>
          {form.userId && (
            <div className="p-4">
              <EmployeeDetailsSection
                userId={form.userId}
                employeeCode={form.employeeCode || String(form.userId)}
              />
            </div>
          )}
        </div>
      )}

      {/* Wizard Actions */}
      {currentStep !== 'completed' && (
        <WizardActions
          currentStep={currentStep}
          showBack={currentStep === 2 || currentStep === 3}
          showSkip={currentStep === 3}
          isSubmitting={isSubmitting}
          onBack={handleBack}
          onNext={handleNext}
          onSkip={handleSkip}
          nextLabel={currentStep === 1 ? (form.userId ? 'Continue' : 'Create Account') : currentStep === 3 ? 'Complete' : 'Continue'}
        />
      )}
    </div>
  );
}
