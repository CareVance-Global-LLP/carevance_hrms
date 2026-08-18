import {
  Bell,
  Briefcase,
  Building,
  CreditCard,
  FileSpreadsheet,
  LifeBuoy,
  Link2,
  Lock,
  Palette,
  Sparkles,
  User,
  type LucideIcon,
} from 'lucide-react';
import type { SettingsGroupId, SettingsTabId } from './types';

export interface SettingsTabDef {
  id: SettingsTabId;
  name: string;
  group: SettingsGroupId;
  icon: LucideIcon;
  /**
   * Extra words the rail search should match on. The point is that someone who
   * remembers the *setting* ("late after", "quota", "dark mode") finds the tab
   * without having to remember which tab it was filed under.
   */
  keywords: string;
}

export const SETTINGS_GROUPS: Array<{ id: SettingsGroupId; label: string }> = [
  { id: 'you', label: 'You' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'support', label: 'Support' },
];

export const SETTINGS_TABS: SettingsTabDef[] = [
  {
    id: 'profile',
    name: 'Profile',
    group: 'you',
    icon: User,
    keywords: 'name email avatar photo picture personal details address city state pin emergency contact timezone gender birthday phone assets',
  },
  {
    id: 'notifications',
    name: 'Notifications',
    group: 'you',
    icon: Bell,
    keywords: 'email in-app desktop popup push chat message weekly summary project task assignment alerts mute',
  },
  {
    id: 'appearance',
    name: 'Appearance',
    group: 'you',
    icon: Palette,
    keywords: 'theme dark light system colour color display look night mode',
  },
  {
    id: 'security',
    name: 'Security',
    group: 'you',
    icon: Lock,
    keywords: 'password change sign in session device login credentials',
  },
  {
    id: 'organization',
    name: 'Organization',
    group: 'workspace',
    icon: Building,
    keywords: 'company workspace logo slug office start late after working hours leave policy quota holiday break types paid unpaid screenshot interval monitoring timezone delete danger',
  },
  {
    id: 'productivity',
    name: 'Productivity',
    group: 'workspace',
    icon: Briefcase,
    keywords: 'classification domains apps websites productive unproductive neutral tracking',
  },
  {
    id: 'integrations',
    name: 'Integrations',
    group: 'workspace',
    icon: Link2,
    keywords: 'desktop app tracker browser extension payroll export connected services',
  },
  {
    id: 'custom-fields',
    name: 'Custom Fields',
    group: 'workspace',
    icon: FileSpreadsheet,
    keywords: 'metadata employee code department designation payroll profile',
  },
  {
    id: 'billing',
    name: 'Billing',
    group: 'workspace',
    icon: CreditCard,
    keywords: 'subscription plan invoice renewal seats payment upgrade',
  },
  {
    id: 'help',
    name: 'Help & Support',
    group: 'support',
    icon: LifeBuoy,
    keywords: 'ticket bug issue contact raise problem broken slow report',
  },
  {
    id: 'development',
    name: 'Development',
    group: 'support',
    icon: Sparkles,
    keywords: 'condensed navigation environment debug dev flags',
  },
];

export const matchesSettingsQuery = (tab: SettingsTabDef, query: string): boolean => {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) {
    return true;
  }
  return `${tab.name} ${tab.keywords}`.toLowerCase().includes(trimmed);
};
