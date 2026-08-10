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

const profileField = (key: string) => (user: any) => profileOf(user)[key];
const workField = (key: string) => (user: any) => workInfoOf(user)[key];

export const PROFILE_FIELDS: ReadonlyArray<ProfileField> = [
  // ── Identity ────────────────────────────────────────────────
  { key: 'first_name', label: 'First name', group: 'identity', owner: 'employee', read: profileField('first_name') },
  { key: 'last_name', label: 'Last name', group: 'identity', owner: 'employee', read: profileField('last_name') },
  { key: 'gender', label: 'Gender', group: 'identity', owner: 'employee', read: profileField('gender') },
  { key: 'date_of_birth', label: 'Date of birth', group: 'identity', owner: 'employee', requiredForPayroll: true, read: profileField('date_of_birth') },

  // ── Contact ─────────────────────────────────────────────────
  { key: 'phone', label: 'Phone', group: 'contact', owner: 'employee', read: profileField('phone') },
  { key: 'personal_email', label: 'Personal email', group: 'contact', owner: 'employee', read: profileField('personal_email') },

  // ── Address ─────────────────────────────────────────────────
  { key: 'address_line', label: 'Address', group: 'address', owner: 'employee', read: profileField('address_line') },
  { key: 'city', label: 'City', group: 'address', owner: 'employee', read: profileField('city') },
  { key: 'state', label: 'State', group: 'address', owner: 'employee', read: profileField('state') },
  { key: 'postal_code', label: 'Postal code', group: 'address', owner: 'employee', read: profileField('postal_code') },

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
    read: (user: any) =>
      governmentIdsOf(user).find((id: any) =>
        String(id?.id_type ?? '').toLowerCase().includes('pan')
      )?.id_number,
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
