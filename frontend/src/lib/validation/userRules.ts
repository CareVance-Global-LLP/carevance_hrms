/**
 * Client-side rules for creating a user, mirroring the server.
 *
 * Every limit here is transcribed from a Laravel rule, with the file and rule
 * it mirrors named beside it. The Add User wizard previously validated almost
 * nothing in the browser: a 200-character phone number and an entire Wikipedia
 * article pasted into Employee Code were both accepted, sent, and rejected by
 * the server one field per round trip — and because the create fires when
 * step 3 mounts, those rejections surfaced two steps after the field that
 * caused them.
 *
 * Keeping the numbers in one place is the point. They were previously either
 * absent or hardcoded per input, so they could drift from the backend silently;
 * userRules.test.ts pins each one so drift fails CI instead of reaching a user.
 */

import type { AddUserWizardForm } from '@/components/add-user/steps/types';

/**
 * Maximum length accepted by the server, per form field.
 *
 * Where two endpoints disagree about the same field we take the TIGHTER value,
 * so the browser never accepts something a later call will reject. `designation`
 * is the live example: POST /users allows 255 while PUT work-info allows 120,
 * and the wizard sends it to both.
 */
export const USER_FIELD_LIMITS = {
  /** employee_profiles.first_name — EmployeeWorkspaceController::updateProfile 'max:120' */
  firstName: 120,
  /** employee_profiles.middle_name — EmployeeWorkspaceController::updateProfile 'max:120' */
  middleName: 120,
  /** employee_profiles.last_name — EmployeeWorkspaceController::updateProfile 'max:120' */
  lastName: 120,
  /** users.email — UserController::store 'max:255' */
  email: 255,
  /** users.phone — UserController::store 'max:64' */
  phone: 64,
  /** work-info 'max:120' (POST /users allows 255; the tighter one wins) */
  designation: 120,
  /** employee_work_infos.employee_code — EmployeeWorkspaceController::updateWorkInfo 'max:80' */
  employeeCode: 80,
  /** employee_work_infos.work_location — EmployeeWorkspaceController::updateWorkInfo 'max:255' */
  workLocation: 255,
} as const;

/**
 * A joining date this far ahead is treated as a typo rather than pre-boarding.
 *
 * Future joining dates are valid and normal — CLAUDE.md calls pre-boarding the
 * expected path — so this is deliberately generous. It exists only to catch a
 * mistyped year.
 */
export const MAX_JOINING_DATE_MONTHS_AHEAD = 24;

/** Minimum digits for a phone number to look like one at all. */
const MIN_PHONE_DIGITS = 10;

/**
 * Password policy, mirroring `Password::defaults()` in AppServiceProvider.
 *
 * That rule is environment-dependent: `Password::min(8)` outside production,
 * and in production `min(12)->letters()->mixedCase()->numbers()->symbols()
 * ->uncompromised()`. The browser cannot know which environment it is talking to.
 *
 * This file used to resolve that by holding everyone to 12. Safe, but wrong for
 * the local and staging workflows the form is used in daily — an admin could not
 * set a password their own API would have accepted. The form now blocks at the
 * universal floor (MIN_PASSWORD_LENGTH_ACCEPTED) and shows the production rules
 * as a live checklist, so the stricter requirement is visible without being
 * enforced against an environment that does not have it.
 *
 * `uncompromised()` checks the password against a breach corpus and can only be
 * done server-side, so a 422 on that is still possible and is handled by the
 * field-error routing rather than pre-empted here.
 */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * The shortest password the API will accept anywhere — `Password::min(8)`
 * outside production.
 *
 * Below this the form blocks, because no environment would take it. Between
 * this and MIN_PASSWORD_LENGTH the form allows it and warns, because whether it
 * is accepted depends on which environment this build is talking to, and the
 * browser cannot know. Blocking at 12 everywhere was safe but wrong for the
 * staging and local workflows this form is used in daily.
 */
export const MIN_PASSWORD_LENGTH_ACCEPTED = 8;

/**
 * Everything production additionally requires, as a checklist rather than a
 * single pass/fail. Returned for display; `validateUserStep1` only blocks on
 * the length floor.
 */
export interface PasswordRequirement {
  label: string;
  met: boolean;
  /** false = advisory, production-only. true = blocks submission. */
  blocking: boolean;
}

export function passwordRequirements(password: string): PasswordRequirement[] {
  const value = password ?? '';
  return [
    { label: `${MIN_PASSWORD_LENGTH_ACCEPTED}+ characters`, met: value.length >= MIN_PASSWORD_LENGTH_ACCEPTED, blocking: true },
    { label: `${MIN_PASSWORD_LENGTH}+ for production`, met: value.length >= MIN_PASSWORD_LENGTH, blocking: false },
    ...PASSWORD_COMPOSITION.map((rule) => ({
      label: rule.missing.replace(/^an? /, ''),
      met: rule.test.test(value),
      blocking: false,
    })),
  ];
}

/** True when the password clears every production rule, not just the floor. */
export const meetsProductionPasswordPolicy = (password: string): boolean =>
  (password ?? '').length >= MIN_PASSWORD_LENGTH && passwordShortfall(password ?? '') === null;

const PASSWORD_COMPOSITION: Array<{ test: RegExp; missing: string }> = [
  { test: /\p{L}/u, missing: 'a letter' },
  { test: /\p{Lu}/u, missing: 'an upper-case letter' },
  { test: /\p{Ll}/u, missing: 'a lower-case letter' },
  { test: /\d/, missing: 'a number' },
  { test: /[^\p{L}\d\s]/u, missing: 'a symbol' },
];

/** The first composition requirement a password fails, or null. */
export function passwordShortfall(password: string): string | null {
  const missing = PASSWORD_COMPOSITION.filter((rule) => !rule.test.test(password)).map((r) => r.missing);
  return missing.length > 0 ? missing.join(', ') : null;
}

export const isValidEmail = (email: string): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

/**
 * Phone shape AND length.
 *
 * The wizard's previous regex, /^[+]?[\d\s-]{10,}$/, had a floor and no
 * ceiling — which is exactly how a 200-digit number reached the server.
 */
export const isValidPhone = (phone: string): boolean => {
  const trimmed = phone.trim();
  if (trimmed.length > USER_FIELD_LIMITS.phone) return false;
  if (!/^[+]?[\d\s-]+$/.test(trimmed)) return false;
  return (trimmed.match(/\d/g) ?? []).length >= MIN_PHONE_DIGITS;
};

/**
 * How many departments a role may belong to.
 *
 * Not a validation rule on the server — UserController::assertSingleGroupMembershipLimit
 * throws after validation, keyed `group_ids`, with "Managers and employees can
 * belong to only one department at a time." Admins are exempt.
 */
export const maxDepartmentsFor = (role: AddUserWizardForm['role']): number =>
  role === 'admin' ? Infinity : 1;

/** The latest joining date the form will accept, as a yyyy-mm-dd string. */
export const maxJoiningDate = (from: Date = new Date()): string => {
  const limit = new Date(from);
  limit.setMonth(limit.getMonth() + MAX_JOINING_DATE_MONTHS_AHEAD);
  return limit.toISOString().split('T')[0];
};

export type UserFieldErrors = Partial<Record<keyof AddUserWizardForm, string>>;

const tooLong = (max: number) => `Use ${max} characters or fewer`;

/**
 * Validate everything step 1 owns.
 *
 * Messages are phrased as the fix rather than the failure — "Use 64 characters
 * or fewer" rather than "The phone field must not be greater than 64
 * characters" — because the person reading it is mid-form and wants to know
 * what to do, not what the validator is called.
 */
/**
 * Split a stored `users.name` back into first, middle and last.
 *
 * The wizard composes `users.name` from three fields and the API stores it as
 * one string, so rehydrating an incomplete user has to reverse that. The naive
 * version — token 0 is the first name, the rest is the last name — puts a
 * middle name into the last-name field, and the next save writes it back that
 * way permanently.
 *
 * Middle is everything between the first and last token, so a compound surname
 * entered as a middle name survives the round trip; a two-part name has no
 * middle, which is the common case.
 */
export function splitDisplayName(name?: string | null): {
  firstName: string;
  middleName: string;
  lastName: string;
} {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) return { firstName: '', middleName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], middleName: '', lastName: '' };
  if (parts.length === 2) return { firstName: parts[0], middleName: '', lastName: parts[1] };

  return {
    firstName: parts[0],
    middleName: parts.slice(1, -1).join(' '),
    lastName: parts[parts.length - 1],
  };
}

export function validateUserStep1(form: AddUserWizardForm): UserFieldErrors {
  const errors: UserFieldErrors = {};

  // ── Identity ────────────────────────────────────────────────
  const firstName = form.firstName.trim();
  if (!firstName) {
    errors.firstName = 'First name is required';
  } else if (firstName.length > USER_FIELD_LIMITS.firstName) {
    errors.firstName = tooLong(USER_FIELD_LIMITS.firstName);
  }

  if (form.lastName.trim().length > USER_FIELD_LIMITS.lastName) {
    errors.lastName = tooLong(USER_FIELD_LIMITS.lastName);
  }

  const email = form.email.trim();
  if (!email) {
    errors.email = 'Email is required';
  } else if (email.length > USER_FIELD_LIMITS.email) {
    errors.email = tooLong(USER_FIELD_LIMITS.email);
  } else if (!isValidEmail(email)) {
    errors.email = 'Enter a valid email address';
  }

  const phone = form.phone.trim();
  if (!phone) {
    errors.phone = 'Phone number is required';
  } else if (phone.length > USER_FIELD_LIMITS.phone) {
    errors.phone = tooLong(USER_FIELD_LIMITS.phone);
  } else if (!isValidPhone(phone)) {
    errors.phone = `Enter a valid phone number — at least ${MIN_PHONE_DIGITS} digits`;
  }

  /*
   * Blocks only below the universal floor. The production extras — length 12,
   * mixed case, a number, a symbol — are surfaced as a live checklist beside
   * the field instead, because this same build talks to environments that
   * accept 8. Blocking at 12 meant a local admin could not set a password the
   * local API would have taken; not showing the 12 at all would mean a
   * production admin passes here and gets a 422 from the server.
   */
  if (!form.password) {
    errors.password = 'Password is required';
  } else if (form.password.length < MIN_PASSWORD_LENGTH_ACCEPTED) {
    errors.password = `Use at least ${MIN_PASSWORD_LENGTH_ACCEPTED} characters — this is the password the joiner signs in with`;
  }

  // Marked required in the UI, so it is checked here too — it used to be
  // neither validated nor reliably selectable, which let an unset timezone
  // through on a starred field.
  if (!form.timezone.trim()) {
    errors.timezone = 'Timezone is required';
  }

  // ── Job ─────────────────────────────────────────────────────
  const designation = form.designation.trim();
  if (!designation) {
    errors.designation = 'Designation is required';
  } else if (designation.length > USER_FIELD_LIMITS.designation) {
    errors.designation = tooLong(USER_FIELD_LIMITS.designation);
  }

  // Optional, but the server caps it and used to be the only thing that did.
  if (form.employeeCode.trim().length > USER_FIELD_LIMITS.employeeCode) {
    errors.employeeCode = tooLong(USER_FIELD_LIMITS.employeeCode);
  }

  const maxDepartments = maxDepartmentsFor(form.role);
  if (form.departmentIds.length === 0) {
    errors.departmentIds = 'Select a department';
  } else if (form.departmentIds.length > maxDepartments) {
    errors.departmentIds =
      'Managers and employees can belong to only one department at a time';
  }

  // ── Joining date ────────────────────────────────────────────
  if (!form.joiningDate) {
    errors.joiningDate = 'Joining date is required';
  } else {
    const joining = new Date(form.joiningDate);
    if (Number.isNaN(joining.getTime())) {
      errors.joiningDate = 'Enter a valid date';
    } else if (form.joiningDate > maxJoiningDate()) {
      // A future date is normal — pre-boarding is the expected path — so this
      // only fires far enough out to look like a mistyped year.
      errors.joiningDate = `Joining date is more than ${MAX_JOINING_DATE_MONTHS_AHEAD / 12} years away — please check it`;
    }
  }

  return errors;
}

/** True when step 1 has nothing left to fix. */
export const isUserStep1Valid = (form: AddUserWizardForm): boolean =>
  Object.keys(validateUserStep1(form)).length === 0;
