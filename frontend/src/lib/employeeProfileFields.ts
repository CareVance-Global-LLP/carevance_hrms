/**
 * One definition of what an employee profile is.
 *
 * The same person's details were described in three unrelated places: the admin
 * Add User panel (~28 fields), the first-login profile form (14), and
 * `hasIncompleteProfile` on the Employees page (2 — bank and PAN, which is why
 * it reported "85 of 85 incomplete"). Three hand-maintained lists meant adding a
 * field in one place silently left the others behind, and no two screens agreed
 * on what "complete" meant.
 *
 * Every surface now reads this registry, so completeness has a single answer.
 */

export type FieldOwner = 'hr' | 'employee';
export type FieldGroup = 'identity' | 'contact' | 'address' | 'emergency' | 'employment' | 'statutory';

export interface ProfileField {
  key: string;
  label: string;
  group: FieldGroup;
  /** Who is expected to supply it — drives onboarding checklist ownership. */
  owner: FieldOwner;
  /** Payroll cannot run without it. Statutory and bank details, mostly. */
  requiredForPayroll?: boolean;
  /** Reads the value off a user record, wherever it happens to live. */
  read: (user: any) => unknown;
}

export const FIELD_GROUP_LABEL: Record<FieldGroup, string> = {
  identity: 'Identity',
  contact: 'Contact',
  address: 'Address',
  emergency: 'Emergency contact',
  employment: 'Employment',
  statutory: 'Statutory & pay',
};

/*
 * Profile details can arrive under either `employee_profile` (API resource) or
 * `employeeProfile` (relation casing), and the same is true of work info. One
 * accessor keeps every caller from repeating the fallback chain.
 */
const profileOf = (user: any) => user?.employee_profile ?? user?.employeeProfile ?? {};
const workInfoOf = (user: any) => user?.employee_work_info ?? user?.employeeWorkInfo ?? {};

/*
 * Government IDs and bank accounts arrive as `employee_government_ids` /
 * `employee_bank_accounts` — Eloquent's snake_case of the relation names. The
 * shorter aliases are accepted too so a caller holding an already-mapped record
 * still resolves. Reading only the short names is what left PAN and bank
 * permanently missing and every employee flagged incomplete.
 */
const governmentIdsOf = (user: any): any[] =>
  user?.employee_government_ids ?? user?.employeeGovernmentIds ?? user?.government_ids ?? [];
const bankAccountsOf = (user: any): any[] =>
  user?.employee_bank_accounts ?? user?.employeeBankAccounts ?? user?.bank_accounts ?? [];
const educationsOf = (user: any): any[] =>
  user?.employee_educations ?? user?.employeeEducations ?? user?.educations ?? [];

/** A government ID of a given kind, matched the way the backend matches it. */
const governmentIdOfType = (user: any, type: string) =>
  governmentIdsOf(user).find((id: any) =>
    String(id?.id_type ?? '').toLowerCase().includes(type)
  )?.id_number;

const profileField = (key: string) => (user: any) => profileOf(user)[key];
const workField = (key: string) => (user: any) => workInfoOf(user)[key];

export const PROFILE_FIELDS: ReadonlyArray<ProfileField> = [
  // ── Identity ────────────────────────────────────────────────
  { key: 'first_name', label: 'First name', group: 'identity', owner: 'employee', read: profileField('first_name') },
  { key: 'last_name', label: 'Last name', group: 'identity', owner: 'employee', read: profileField('last_name') },
  { key: 'gender', label: 'Gender', group: 'identity', owner: 'employee', read: profileField('gender') },
  { key: 'date_of_birth', label: 'Date of birth', group: 'identity', owner: 'employee', requiredForPayroll: true, read: profileField('date_of_birth') },
  // Not required for payroll — nothing about a salary run depends on it. It is
  // here because an emergency contact number without a blood group means the
  // call still ends with the hospital asking.
  { key: 'blood_group', label: 'Blood group', group: 'identity', owner: 'employee', read: profileField('blood_group') },

  // ── Contact ─────────────────────────────────────────────────
  { key: 'phone', label: 'Phone', group: 'contact', owner: 'employee', read: profileField('phone') },
  { key: 'personal_email', label: 'Personal email', group: 'contact', owner: 'employee', read: profileField('personal_email') },

  // ── Address ─────────────────────────────────────────────────
  { key: 'address_line', label: 'Address', group: 'address', owner: 'employee', read: profileField('address_line') },
  { key: 'city', label: 'City', group: 'address', owner: 'employee', read: profileField('city') },
  { key: 'state', label: 'State', group: 'address', owner: 'employee', read: profileField('state') },
  { key: 'postal_code', label: 'Postal code', group: 'address', owner: 'employee', read: profileField('postal_code') },
  // Only the address line, not all four parts. The permanent address is one
  // fact for completeness purposes, and reporting four separate gaps for it
  // would drown the current address in the missing-fields list.
  { key: 'permanent_address_line', label: 'Permanent address', group: 'address', owner: 'employee', read: profileField('permanent_address_line') },

  // ── Emergency contact ───────────────────────────────────────
  { key: 'emergency_contact_name', label: 'Emergency contact name', group: 'emergency', owner: 'employee', read: profileField('emergency_contact_name') },
  { key: 'emergency_contact_number', label: 'Emergency contact number', group: 'emergency', owner: 'employee', read: profileField('emergency_contact_number') },
  { key: 'emergency_contact_relationship', label: 'Relationship', group: 'emergency', owner: 'employee', read: profileField('emergency_contact_relationship') },

  // ── Employment — HR owns these, not the joiner ──────────────
  { key: 'employee_code', label: 'Employee code', group: 'employment', owner: 'hr', read: workField('employee_code') },
  { key: 'designation', label: 'Designation', group: 'employment', owner: 'hr', read: workField('designation') },
  { key: 'joining_date', label: 'Joining date', group: 'employment', owner: 'hr', requiredForPayroll: true, read: workField('joining_date') },
  { key: 'work_location', label: 'Work location', group: 'employment', owner: 'hr', read: workField('work_location') },

  // ── Statutory & pay ─────────────────────────────────────────
  {
    key: 'pan',
    label: 'PAN',
    group: 'statutory',
    owner: 'employee',
    requiredForPayroll: true,
    read: (user: any) => governmentIdOfType(user, 'pan'),
  },
  /*
   * Aadhaar was absent from this registry even though the record has held it
   * since the workspace tables were created, so an employee with no Aadhaar on
   * file reported as complete. It is not requiredForPayroll — a salary run does
   * not read it — but EPFO seeding and most onboarding verification do.
   */
  {
    key: 'aadhaar',
    label: 'Aadhaar',
    group: 'statutory',
    owner: 'employee',
    read: (user: any) => governmentIdOfType(user, 'aadhaar'),
  },
  /*
   * Education is complete when at least one qualification is on file. Counting
   * a specific number would be wrong — a school leaver legitimately has one
   * record and a doctorate holder four.
   */
  {
    key: 'education',
    label: 'Education record',
    group: 'identity',
    owner: 'hr',
    read: (user: any) => educationsOf(user),
  },
  {
    key: 'bank_account',
    label: 'Bank account',
    group: 'statutory',
    owner: 'employee',
    requiredForPayroll: true,
    read: (user: any) => bankAccountsOf(user)[0]?.id,
  },
];

const isPresent = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  return true;
};

export interface ProfileCompleteness {
  total: number;
  filled: number;
  percentage: number;
  missing: ProfileField[];
  missingForPayroll: ProfileField[];
  isComplete: boolean;
}

/**
 * How complete one person's record is.
 *
 * `scope` limits the answer to the fields a given surface is responsible for —
 * the first-login form should not report someone incomplete because HR has not
 * set their employee code yet.
 */
export function profileCompleteness(
  user: any,
  scope?: { owner?: FieldOwner; payrollOnly?: boolean }
): ProfileCompleteness {
  const fields = PROFILE_FIELDS.filter((field) => {
    if (scope?.owner && field.owner !== scope.owner) return false;
    if (scope?.payrollOnly && !field.requiredForPayroll) return false;
    return true;
  });

  const missing = fields.filter((field) => !isPresent(field.read(user)));
  const filled = fields.length - missing.length;

  return {
    total: fields.length,
    filled,
    percentage: fields.length === 0 ? 100 : Math.round((filled / fields.length) * 100),
    missing,
    missingForPayroll: missing.filter((field) => field.requiredForPayroll),
    isComplete: missing.length === 0,
  };
}

/** Grouped missing fields, for rendering a "what's left" summary. */
export function groupMissing(missing: ProfileField[]): Array<{ group: FieldGroup; fields: ProfileField[] }> {
  const byGroup = new Map<FieldGroup, ProfileField[]>();
  missing.forEach((field) => {
    byGroup.set(field.group, [...(byGroup.get(field.group) ?? []), field]);
  });

  return (Object.keys(FIELD_GROUP_LABEL) as FieldGroup[])
    .filter((group) => byGroup.has(group))
    .map((group) => ({ group, fields: byGroup.get(group) as ProfileField[] }));
}
