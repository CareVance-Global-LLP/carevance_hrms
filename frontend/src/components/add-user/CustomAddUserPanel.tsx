import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import api, { billingApi, payrollApi } from '../../services/api';
import { WizardProgress } from './steps/WizardProgress';
import { WizardActions } from './steps/WizardActions';
import { Step1BasicInfo } from './steps/Step1BasicInfo';
import { Step2AccountCreated } from './steps/Step2AccountCreated';
import { Step3Profile } from './steps/Step3Profile';
import { defaultForm, type AddUserWizardForm, type IncompleteUserCheck } from './steps/types';
import {
  clearWizardDraft,
  hasMeaningfulInput,
  loadWizardDraft,
  restoreDraft,
  saveWizardDraft,
} from './wizardDraft';
import EmployeeDetailsSection from '@/components/EmployeeDetailsSection';
import { isUserStep1Valid, splitDisplayName, validateUserStep1 } from '@/lib/validation/userRules';

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
    middle_name: 'middleName',
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

/**
 * Which step owns each field, so a server error can be shown where it can be
 * fixed rather than on whichever step happened to be open.
 *
 * Every field the create sends belongs to step 1 — step 2 is a read-only review
 * and step 3 is the optional profile — but the map is explicit so it stays
 * correct if fields move between steps.
 */
const FIELD_STEP: Partial<Record<keyof AddUserWizardForm, 1 | 2 | 3>> = {
  firstName: 1,
  middleName: 1,
  lastName: 1,
  email: 1,
  phone: 1,
  role: 1,
  designation: 1,
  joiningDate: 1,
  workLocation: 1,
  timezone: 1,
  departmentIds: 1,
  employeeCode: 1,
};

/**
 * Field errors from responses that carry no `errors` object.
 *
 * Most 422s use the standard envelope, but two checks bypass it: the employee
 * code uniqueness check throws an InvalidArgumentException surfaced as a bare
 * `{message}`, and the reporting-manager checks return an `error_code` with no
 * field. Without this they fall through to the generic banner, which cannot say
 * which field is wrong.
 */
function extractUnenvelopedFieldError(error: any): Partial<Record<keyof AddUserWizardForm, string>> {
  const { status, data } = error.response ?? {};
  if (status !== 422 || data?.errors) return {};

  const message: string = data?.message ?? '';

  if (/employee code/i.test(message)) {
    return { employeeCode: message };
  }
  if (data?.error_code === 'REPORTING_CYCLE' || data?.error_code === 'INVALID_REPORTING_LINE') {
    return { role: message };
  }

  return {};
}

/** The lowest-numbered step owning any of these fields, or null. */
function firstStepWithError(
  fieldErrors: Partial<Record<keyof AddUserWizardForm, string>>,
): 1 | 2 | 3 | null {
  const steps = Object.keys(fieldErrors)
    .map((field) => FIELD_STEP[field as keyof AddUserWizardForm])
    .filter((step): step is 1 | 2 | 3 => typeof step === 'number')
    .sort((a, b) => a - b);

  return steps[0] ?? null;
}

type WizardStep = 1 | 2 | 3 | 'completed';

interface CustomAddUserPanelProps {
  organizationId: number;
  allowedRoles: string[];
  onSuccess: () => void;
  onError: (message: string) => void;
  onCancel?: () => void;
}

// ── Validation ──────────────────────────────────────────────
//
// The rules live in lib/validation/userRules, which mirrors the Laravel rules
// field by field and is unit-tested against them. They used to live here as a
// thin hand-rolled set with no length checks at all — a 200-digit phone number
// and an article pasted into Employee Code both passed, and only failed on the
// server two steps later.

const validateStep1 = validateUserStep1;

const canProceedFromStep1 = (
  form: AddUserWizardForm,
  incompleteUser: IncompleteUserCheck | null,
): boolean => {
  // Block submission if email already exists as a complete account in this org
  if (incompleteUser?.exists && !incompleteUser?.incomplete) {
    return false;
  }
  /*
   * Derived from the same validator that produces the messages, rather than a
   * second hand-written copy of the conditions. The two previously disagreed
   * about joining dates — this required one on or before today while the
   * validator allowed two years out — so choosing a future date left Next doing
   * nothing with no error shown, because validateStep1 returned no errors to
   * display.
   */
  return isUserStep1Valid(form);



};

// ── Main Component ──────────────────────────────────────────

export default function CustomAddUserPanel({ organizationId, allowedRoles, onSuccess, onError, onCancel }: CustomAddUserPanelProps) {
  const queryClient = useQueryClient();

  /*
   * Read storage exactly once, into the initial state.
   *
   * This used to be a bare call in the component body, so every render — every
   * keystroke — re-read localStorage and re-parsed the whole draft, only for
   * the result to be discarded by `useState`.
   */
  const [restored] = useState(() => restoreDraft(loadWizardDraft()));

  const [currentStep, setCurrentStep] = useState<WizardStep>(restored?.step ?? 1);
  const [form, setForm] = useState<AddUserWizardForm>(restored?.form ?? { ...defaultForm });
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set(restored?.completedSteps ?? []));
  const [errors, setErrors] = useState<Partial<Record<keyof AddUserWizardForm, string>>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [incompleteUser, setIncompleteUser] = useState<IncompleteUserCheck | null>(null);
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [creationError, setCreationError] = useState<string | null>(null);
  /*
   * True once a resumed draft has reached the end without the admin ever
   * re-typing the password. The final panel hands over sign-in details, and it
   * must not present an empty box as if it were the credential.
   */
  const [passwordUnavailable, setPasswordUnavailable] = useState(restored?.passwordUnavailable ?? false);

  // ── Seats ─────────────────────────────────────────────────
  /*
   * Checked here rather than left to the API. The server refuses correctly, but
   * it refused at the point the account is created — three steps and a full
   * form after the admin could have done anything about it.
   */
  const { data: billing } = useQuery({
    queryKey: ['billing-snapshot'],
    queryFn: async () => (await billingApi.current()).data,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const seats = billing?.seats ?? null;
  // Mirrors SeatGuard::canAdd — a cap of zero or less was never configured, and
  // must not be read as "nobody may join".
  const seatsExhausted = Boolean(seats && seats.max > 0 && seats.used + 1 > seats.max);

  /*
   * Say what was restored, and say what was not.
   *
   * The password is the one field deliberately left behind, so a silent restore
   * reads as the form having lost it by accident — and on a resumed draft the
   * admin has no other way to know they have to type it again.
   */
  useEffect(() => {
    if (!restored) return;

    if (restored.needsPasswordReentry) {
      setFeedback({
        type: 'error',
        message:
          'Draft restored. The temporary password is never saved in your browser — re-enter it to continue.',
      });
    } else if (restored.step >= 2 && restored.form.email) {
      setFeedback({
        type: 'success',
        message: `Welcome back! Continuing setup for ${restored.form.email}.`,
      });
    } else {
      setFeedback({
        type: 'success',
        message: 'Draft restored. The temporary password is never saved in your browser — re-enter it.',
      });
    }
  }, [restored]);

  /*
   * Persist on change, debounced.
   *
   * The draft used to be written at exactly one moment — leaving step 1 — which
   * meant the long form everyone actually loses work in was the one part never
   * saved. Saving `form`, `currentStep` and `completedSteps` together also
   * keeps `userId` on disk, so a refresh taken after the account is created
   * resumes into it rather than stranding a real user with no way back.
   */
  useEffect(() => {
    if (currentStep === 'completed') return;

    if (!hasMeaningfulInput(form)) {
      clearWizardDraft();
      return;
    }

    const timer = setTimeout(() => {
      saveWizardDraft({
        step: currentStep,
        form,
        completedSteps: Array.from(completedSteps),
      });
    }, 500);

    return () => clearTimeout(timer);
  }, [form, currentStep, completedSteps]);

  // ✅ Auto-create user when Step 3 loads (user not yet created)
  useEffect(() => {
    if (currentStep !== 3 || form.userId || isCreatingUser || createUserMutation.isPending) return;

    let cancelled = false;

    const createUser = async () => {
      setIsCreatingUser(true);
      setCreationError(null);
      // Only one error may be on screen at a time; clear the other surface.
      setFeedback(null);
      try {
        const result = await createUserMutation.mutateAsync(form);
        if (cancelled) return;
        const userId = result.userId || result.id;
        setForm((prev) => ({ ...prev, userId }));

        queryClient.invalidateQueries({ queryKey: ['payroll', 'pay-groups'] });
        queryClient.invalidateQueries({ queryKey: ['payroll', 'unassigned-employees'] });
        queryClient.invalidateQueries({ queryKey: ['payroll', 'dashboard'] });
        queryClient.invalidateQueries({ queryKey: ['payroll', 'stats'] });
        queryClient.invalidateQueries({ queryKey: ['employee-payroll-cards'] });
      } catch (error: any) {
        if (cancelled) return;

        /*
         * Put the message on the field that caused it. The mapping to do this
         * already existed but was never called, so a "phone must not be greater
         * than 64 characters" arrived as anonymous red text on step 3 — two
         * steps away from the input at fault, with no indication of which field
         * was meant.
         */
        const fieldErrors = {
          ...extractFieldErrors(error),
          ...extractUnenvelopedFieldError(error),
        };
        const targetStep = firstStepWithError(fieldErrors);

        if (targetStep !== null) {
          setErrors(fieldErrors);
          setCurrentStep(targetStep);
          setFeedback({
            type: 'error',
            message: 'Some details need fixing before the account can be created.',
          });
          return;
        }

        // Nothing field-specific to show — fall back to the single banner.
        setCreationError(extractErrorMessage(error));
      } finally {
        if (!cancelled) setIsCreatingUser(false);
      }
    };

    void createUser();

    return () => { cancelled = true; };
  }, [currentStep, form.userId]);

  // ❌ REMOVED: Old disabled saveWizardState usage — now we save properly below

  // ── API: Create user (Step 1) ────────────────────────────

  const createUserMutation = useMutation({
    mutationFn: async (formData: AddUserWizardForm) => {
      // Middle name sits between the other two so `users.name` reads as it does
      // on the PAN card, which is what the statutory filings match against.
      const fullName = [formData.firstName, formData.middleName, formData.lastName]
        .map((part) => part.trim())
        .filter(Boolean)
        .join(' ');

      // Step A: Create user
      const userResponse = await api.post('/users', {
        name: fullName || formData.email.split('@')[0],
        email: formData.email,
        // The admin sets this and hands it over directly, which is what makes
        // the account usable on create. Without it the API mints a random
        // password nobody knows, and the joiner has no way in at all.
        password: formData.password,
        phone: formData.phone,
        role: formData.role,
        group_ids: formData.departmentIds,
        // Sent at creation, not with the later work-info call, because the
        // onboarding checklist anchors its due dates on the joining date the
        // moment the journey opens — several tasks fall before day one.
        joining_date: formData.joiningDate || undefined,
        designation: formData.designation || undefined,
        settings: {
          timezone: formData.timezone,
          attendance_monitoring: true,
          payroll_visibility: false,
          can_edit_time: false,
          task_assignment_access: true,
          // No monitoring_interval_minutes key: this wizard never asks for one,
          // and omitting it means "inherit the organization default" rather
          // than silently pinning every user created here to a hardcoded 10.
        },
      });

      const userId = userResponse.data?.id || userResponse.data?.data?.id;

      // Step B–E: Save profile, work-info, CTC, pay group
      // If any step fails AFTER user is created, attempt rollback (delete orphaned user)
      if (userId) {
        try {
          await api.put(`/employees/${userId}/profile`, {
            first_name: formData.firstName || undefined,
            middle_name: formData.middleName || undefined,
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

          // Save salary structure independently (via employee card update)
          if (formData.salaryStructureId) {
            await api.put(`/payroll/employee-cards/${userId}`, {
              salary_template_id: formData.salaryStructureId,
            });
          }

          // Assign to pay group separately
          if (formData.payGroupId) {
            await payrollApi.assignEmployeeToExistingPayGroup({
              pay_group_id: formData.payGroupId,
              user_ids: [userId],
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

  /*
   * Step 3 has no save path of its own on purpose.
   *
   * There used to be a `saveStep3Data` here — some 75 lines posting gender,
   * address, bank account, government ID and three document uploads. None of it
   * could ever run. `Step3Profile` takes `setForm` and never calls it; it
   * renders `EmployeeDetailsSection`, which owns those fields and saves them
   * itself, against the user id it is handed. So the wizard's copies of
   * `form.gender`, `form.accountNumber` and the rest stayed at their defaults
   * for the life of the wizard, the `hasAnyStep3Data` guard in front of the
   * call was permanently false, and the whole block read as working code.
   *
   * If step 3 ever needs to collect something itself, wire it through
   * EmployeeDetailsSection rather than reviving a parallel save.
   */

  /*
   * This wizard used to POST /invites/send here, on top of creating the user.
   *
   * That endpoint belonged to the legacy `invites` system, which has been
   * removed: its accept path looked the invited address up across every
   * organization and overwrote the password of any account that already held
   * it. See the note in backend routes/api/public.php.
   *
   * There is nothing to send in its place. This tab creates a usable account —
   * the admin sets the password and the address is verified on create — so the
   * joiner signs in with the credentials the admin hands them. The three invite
   * tabs are the path for "let the recipient set their own password", and they
   * use `invitations`, which is unaffected.
   */

  // ── Navigation handlers ───────────────────────────────────

  const handleNext = async () => {
    if (currentStep === 1) {
      if (!canProceedFromStep1(form, incompleteUser)) {
        setErrors(validateStep1(form));
        return;
      }

      setErrors({});
      setIncompleteUser(null);
      setFeedback(null);
      setCompletedSteps((prev) => new Set(prev).add(1));
      setCurrentStep(2);
    } else if (currentStep === 2) {
      /*
       * Re-validate before leaving the review step. Moving to step 3 is what
       * fires the create — the effect that issues POST /users runs when step 3
       * mounts — so this transition, not the submit button, is the last point
       * at which bad input can be caught before it reaches the server. It was
       * previously ungated entirely.
       *
       * Step 1's fields can still be wrong here: the wizard restores a saved
       * step and a partial form from localStorage, so a stale draft can land
       * on step 2 without ever having passed step 1.
       */
      const step1Errors = validateStep1(form);
      if (Object.keys(step1Errors).length > 0) {
        setErrors(step1Errors);
        setFeedback({
          type: 'error',
          message: 'Some details need fixing before the account can be created.',
        });
        setCurrentStep(1);
        return;
      }

      setErrors({});
      setCompletedSteps((prev) => new Set(prev).add(2));
      setCurrentStep(3);
    } else if (currentStep === 3) {
      if (!form.userId) {
        // The button is disabled while the account is being created, so this is
        // only reachable if the create failed — in which case creationError is
        // already on screen and this message would contradict it.
        return;
      }

      setCompletedSteps((prev) => new Set(prev).add(3));
      setCurrentStep('completed');
      clearWizardDraft();
    }
  };

  const handleBack = () => {
    setErrors({});
    setFeedback(null);
    if (currentStep === 2) setCurrentStep(1);
    else if (currentStep === 3) setCurrentStep(2);
  };

  /*
   * Leaving is not discarding.
   *
   * This used to wipe the form and delete the draft, behind a button labelled
   * "← Back", with no confirmation — so stepping out to check a department name
   * cost the admin everything they had typed. The draft now survives; the three
   * routes that genuinely end the job (completing, skipping, adding another)
   * clear it explicitly.
   */
  const handleCancel = () => {
    setErrors({});
    setFeedback(null);
    onCancel?.();
  };

  const handleSkip = () => {
    if (currentStep !== 3) return;

    if (!form.userId) {
      // Skip is disabled while the create is in flight, so reaching here means
      // it failed and creationError is already on screen. Raising a second
      // banner here put "still being created" over "something went wrong".
      return;
    }

    setCompletedSteps((prev) => new Set(prev).add(3));
    setCurrentStep('completed');
    clearWizardDraft();
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
        // splitDisplayName, not a bare split: this used to take token 0 as the
        // first name and everything after it as the last name, which puts a
        // middle name into the last-name field the moment one exists.
        firstName: splitDisplayName(userData.name).firstName || form.firstName,
        middleName: splitDisplayName(userData.name).middleName || form.middleName,
        lastName: splitDisplayName(userData.name).lastName || form.lastName,
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
      // The account already exists, so its password is not ours to show.
      setPasswordUnavailable(true);

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
    setPasswordUnavailable(false);
    clearWizardDraft();
    // The seat just consumed makes the next create the one that might not fit.
    queryClient.invalidateQueries({ queryKey: ['billing-snapshot'] });
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

      {/*
        Seat cap, surfaced before the form rather than after it.
        The API refuses correctly but only at creation — which, on this wizard,
        is two steps and a fully typed form past the point of no return.
      */}
      {currentStep !== 'completed' && seatsExhausted && seats && (
        <div className="mx-6 mt-4 px-4 py-3 rounded-lg flex items-start gap-2 text-sm bg-amber-50 text-amber-900 border border-amber-200">
          <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">No seats available</p>
            <p className="mt-1">
              This workspace is using {seats.used} of {seats.max} seats. Add at least one more before
              creating another user.
            </p>
            <Link
              to="/settings/billing"
              className="mt-2 inline-block font-medium underline underline-offset-2 hover:no-underline"
            >
              Manage seats in Billing
            </Link>
          </div>
        </div>
      )}

      {/* Step content */}
      {currentStep === 1 && (
        <Step1BasicInfo form={form} setForm={setForm} errors={errors} setErrors={setErrors} onResumeFromStep2={handleResumeFromStep2} incompleteUser={incompleteUser} setIncompleteUser={setIncompleteUser} />
      )}
      {currentStep === 2 && <Step2AccountCreated form={form} />}
      {currentStep === 3 && (
        <Step3Profile
          form={form}
          setForm={setForm}
          isCreatingUser={isCreatingUser}
          creationError={creationError}
          onGoBack={handleBack}
        />
      )}
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
                  {form.firstName} {form.lastName} ({form.employeeCode || 'No code'}) has been added
                  and can sign in straight away.
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
          {/*
            No email is sent on this path, so the credentials only exist here.
            Showing them once, at the only moment they are known, is what stops
            the admin from creating an account nobody can get into.

            A resumed draft is the one case where they are genuinely not known:
            the password is deliberately never persisted, so after a refresh
            there is nothing to show. Say so, rather than render an empty box
            that reads as the password being blank.
          */}
          {form.password ? (
            <div className="mx-6 mt-4 px-4 py-3 rounded-lg flex items-start gap-2 text-sm bg-sky-50 text-sky-900 border border-sky-200">
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-medium">Share these sign-in details with {form.firstName}</p>
                <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 font-mono text-[13px]">
                  <dt className="text-sky-700">Email</dt>
                  <dd className="break-all">{form.email}</dd>
                  <dt className="text-sky-700">Password</dt>
                  <dd className="break-all">{form.password}</dd>
                </dl>
                <p className="mt-2 text-[13px] text-sky-800">
                  This password is not shown again. They can change it from Settings after signing in.
                </p>
              </div>
            </div>
          ) : (
            <div className="mx-6 mt-4 px-4 py-3 rounded-lg flex items-start gap-2 text-sm bg-amber-50 text-amber-900 border border-amber-200">
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-medium">Sign-in password not available</p>
                <p className="mt-1">
                  {passwordUnavailable
                    ? 'This setup was resumed, and the temporary password is never kept in the browser.'
                    : 'The temporary password is no longer available in this session.'}{' '}
                  If it was not noted down, set a new one for <strong>{form.email}</strong> from their
                  profile before handing the account over.
                </p>
              </div>
            </div>
          )}
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
          showCancel={currentStep === 1}
          showSkip={currentStep === 3}
          isSubmitting={isSubmitting}
          // Step 3 cannot be completed until the account exists. Without this
          // the button stayed live through the create, and pressing it stacked
          // a second, contradictory banner over the creation error.
          isBusy={currentStep === 3 && (isCreatingUser || !form.userId)}
          onBack={handleBack}
          onCancel={handleCancel}
          onNext={handleNext}
          onSkip={handleSkip}
          /*
            Step 1 used to say "Create Account" while doing nothing of the sort:
            it advanced to step 2, and the POST fired later, from an effect on
            step 3's mount — behind a button labelled "Continue". The labels now
            name what the click does, so the irreversible one is the one that
            says so.
          */
          nextLabel={
            currentStep === 1
              ? 'Continue'
              : currentStep === 2
                ? form.userId ? 'Continue' : 'Create Account'
                : 'Complete'
          }
          disabled={currentStep === 2 && !form.userId && seatsExhausted}
        />
      )}
    </div>
  );
}
