export type SettingsTabId =
  | 'profile'
  | 'notifications'
  | 'appearance'
  | 'security'
  | 'organization'
  | 'productivity'
  | 'integrations'
  | 'custom-fields'
  | 'billing'
  | 'browser-tracking'
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
  phone: string;
  personal_email: string;
  address_line: string;
  city: string;
  state: string;
  postal_code: string;
  emergency_contact_name: string;
  emergency_contact_number: string;
  emergency_contact_relationship: string;
};

export const createEmptyPersonalDetailsForm = (): PersonalDetailsForm => ({
  first_name: '',
  last_name: '',
  gender: '',
  date_of_birth: '',
  phone: '',
  personal_email: '',
  address_line: '',
  city: '',
  state: '',
  postal_code: '',
  emergency_contact_name: '',
  emergency_contact_number: '',
  emergency_contact_relationship: '',
});

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
