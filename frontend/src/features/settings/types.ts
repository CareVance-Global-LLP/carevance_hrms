export type SettingsTabId =
  | 'profile'
  | 'notifications'
  | 'appearance'
  | 'security'
  | 'privacy'
  | 'organization'
  | 'legal-entities'
  | 'leave-types'
  | 'biometric-devices'
  | 'single-sign-on'
  | 'shifts'
  | 'working-time'
  | 'productivity'
  | 'integrations'
  | 'custom-fields'
  | 'billing'
  | 'help'
  | 'development';

export type SettingsGroupId = 'you' | 'workspace' | 'support';

export type LeaveCategorySetting = {
  code: string;
  name: string;
  annual_quota: string;
};

export type PersonalDetailsForm = {
  first_name: string;
  last_name: string;
  gender: string;
  date_of_birth: string;
  blood_group: string;
  phone: string;
  personal_email: string;
  address_line: string;
  city: string;
  state: string;
  postal_code: string;
  permanent_address_line: string;
  permanent_city: string;
  permanent_state: string;
  permanent_postal_code: string;
  emergency_contact_name: string;
  emergency_contact_number: string;
  emergency_contact_relationship: string;
};

export const createEmptyPersonalDetailsForm = (): PersonalDetailsForm => ({
  first_name: '',
  last_name: '',
  gender: '',
  date_of_birth: '',
  blood_group: '',
  phone: '',
  personal_email: '',
  address_line: '',
  city: '',
  state: '',
  postal_code: '',
  permanent_address_line: '',
  permanent_city: '',
  permanent_state: '',
  permanent_postal_code: '',
  emergency_contact_name: '',
  emergency_contact_number: '',
  emergency_contact_relationship: '',
});

/**
 * The company profile.
 *
 * These columns used to be collected on the signup form and read by nothing —
 * there was no screen anywhere in the product to see or change them. They are
 * edited here now, and two of them do real work at conversion: the address is
 * what the invoice is raised against, and `size` seeds the seat count suggested
 * when a trial converts.
 */
export type CompanyProfileForm = {
  description: string;
  website: string;
  industry: string;
  size: string;
  phone: string;
  org_email: string;
  address_line: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
};

export const createEmptyCompanyProfileForm = (): CompanyProfileForm => ({
  description: '',
  website: '',
  industry: '',
  size: '',
  phone: '',
  org_email: '',
  address_line: '',
  city: '',
  state: '',
  postal_code: '',
  country: '',
});

/** The subset an invoice cannot be raised without — mirrors CompanyProfileService::BILLING_FIELDS. */
export const COMPANY_BILLING_FIELDS: Array<keyof CompanyProfileForm> = [
  'address_line',
  'city',
  'state',
  'postal_code',
  'country',
];

export const COMPANY_SIZE_OPTIONS = ['1-10', '11-50', '51-200', '201-500', '500+'] as const;

export const COMPANY_INDUSTRY_OPTIONS = [
  'technology',
  'healthcare',
  'finance',
  'education',
  'manufacturing',
  'retail',
  'other',
] as const;

export const DEFAULT_LEAVE_CATEGORIES: LeaveCategorySetting[] = [
  { code: 'paid', name: 'Paid Leave', annual_quota: '21' },
  { code: 'sick', name: 'Sick Leave', annual_quota: '12' },
  { code: 'birthday', name: 'Birthday Leave', annual_quota: '1' },
];

export type NotificationKey =
  | 'email'
  | 'in_app'
  | 'desktop_push'
  | 'chat_messages'
  | 'weekly_summary'
  | 'project_updates'
  | 'task_assignments';

export type NotificationState = Record<NotificationKey, boolean>;

export const DEFAULT_NOTIFICATIONS: NotificationState = {
  email: true,
  in_app: true,
  desktop_push: true,
  chat_messages: true,
  weekly_summary: true,
  project_updates: true,
  task_assignments: true,
};
