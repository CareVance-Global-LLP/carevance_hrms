import { defaultForm, type AddUserWizardForm } from './steps/types';

export const WIZARD_DRAFT_KEY = 'add-user-wizard-state';

/** A draft older than this is dropped rather than restored. Sliding: every save refreshes it. */
const DRAFT_TTL_HOURS = 24;

/**
 * Fields deliberately never written to storage.
 *
 * `password` is another person's sign-in credential. It used to be persisted in
 * cleartext for 24 hours, surviving logout, on whatever machine the admin
 * happened to be using. A draft is a convenience; it is not worth holding a
 * credential at rest to provide one.
 *
 * The `*File` fields hold `File` objects, which `JSON.stringify` turns into
 * `{}` — truthy. A restored draft would therefore pass `{}` to
 * `FormData.append` and upload an empty part in place of the document.
 */
const OMITTED_FIELDS = [
  'password',
  'idProofFile',
  'resumeFile',
  'experienceCertFile',
  'educationCertFile',
  'bankProofFile',
] as const;

export type OmittedDraftField = (typeof OMITTED_FIELDS)[number];
export type PersistableForm = Omit<AddUserWizardForm, OmittedDraftField>;

export interface WizardDraft {
  step: 1 | 2 | 3;
  form: Partial<PersistableForm>;
  completedSteps: number[];
  createdAt: string;
}

/**
 * Whether the form holds anything worth restoring.
 *
 * Guards against writing a draft for a form the admin only ever looked at:
 * mounting the wizard pre-selects a default salary structure and stamps today's
 * joining date, so "untouched" is not the same as "equal to defaultForm".
 */
export function hasMeaningfulInput(form: AddUserWizardForm): boolean {
  return Boolean(
    form.userId ||
      form.firstName.trim() ||
      form.lastName.trim() ||
      form.email.trim() ||
      form.phone.trim() ||
      form.designation.trim() ||
      form.employeeCode.trim() ||
      form.departmentIds.length > 0 ||
      form.annualCtc ||
      form.payGroupId
  );
}

export function loadWizardDraft(): WizardDraft | null {
  try {
    const stored = localStorage.getItem(WIZARD_DRAFT_KEY);
    if (!stored) return null;

    const draft = JSON.parse(stored) as WizardDraft;

    if (draft?.createdAt) {
      const hoursOld = (Date.now() - new Date(draft.createdAt).getTime()) / (1000 * 60 * 60);
      if (!Number.isFinite(hoursOld) || hoursOld > DRAFT_TTL_HOURS) {
        clearWizardDraft();
        return null;
      }
    }

    if (![1, 2, 3].includes(draft?.step)) return null;

    return {
      step: draft.step,
      form: draft.form ?? {},
      completedSteps: Array.isArray(draft.completedSteps) ? draft.completedSteps : [],
      createdAt: draft.createdAt,
    };
  } catch {
    clearWizardDraft();
    return null;
  }
}

export function saveWizardDraft(input: { step: 1 | 2 | 3; form: AddUserWizardForm; completedSteps: number[] }): void {
  const form: Record<string, unknown> = { ...input.form };
  for (const field of OMITTED_FIELDS) {
    delete form[field];
  }

  try {
    localStorage.setItem(
      WIZARD_DRAFT_KEY,
      JSON.stringify({
        step: input.step,
        form,
        completedSteps: input.completedSteps,
        createdAt: new Date().toISOString(),
      })
    );
  } catch {
    // Storage full, disabled, or private mode. Losing the draft is acceptable;
    // failing the keystroke that triggered the save is not.
  }
}

export function clearWizardDraft(): void {
  try {
    localStorage.removeItem(WIZARD_DRAFT_KEY);
  } catch {
    // ignore
  }
}

export interface RestoredDraft {
  form: AddUserWizardForm;
  step: 1 | 2 | 3;
  completedSteps: number[];
  /** Set when the admin must re-enter the temporary password before the account can be created. */
  needsPasswordReentry: boolean;
  /** Set when the account already exists but its password is no longer recoverable from this browser. */
  passwordUnavailable: boolean;
}

/**
 * Rebuild wizard state from a draft.
 *
 * The password is never stored, so a restored draft cannot create an account on
 * its own — `POST /users` requires `min:8` and would 422 on the empty string.
 * A draft that has not yet created its user is therefore rewound to step 1 to
 * have the password re-entered, rather than allowed to walk into that failure.
 * Once the user exists the password is no longer needed to proceed, but it can
 * also no longer be shown at the end, which the caller has to say out loud.
 */
export function restoreDraft(draft: WizardDraft | null): RestoredDraft | null {
  if (!draft) return null;

  const form: AddUserWizardForm = { ...defaultForm, ...draft.form, password: '' };
  const accountExists = Boolean(form.userId);

  if (!accountExists && draft.step > 1) {
    return {
      form,
      step: 1,
      completedSteps: [],
      needsPasswordReentry: true,
      passwordUnavailable: false,
    };
  }

  return {
    form,
    step: draft.step,
    completedSteps: draft.completedSteps,
    needsPasswordReentry: false,
    passwordUnavailable: accountExists,
  };
}
