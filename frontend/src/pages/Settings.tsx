import { useMemo } from 'react';
import PageHeader from '@/components/dashboard/PageHeader';
import { FeedbackBanner, PageLoadingState } from '@/components/ui/PageState';
import { useTheme } from '@/contexts/ThemeContext';
import { useSettingsController } from '@/features/settings/useSettingsController';
import SettingsRail from '@/features/settings/components/SettingsRail';
import SaveDock from '@/features/settings/components/SaveDock';
import ProfilePane from '@/features/settings/panes/ProfilePane';
import NotificationsPane from '@/features/settings/panes/NotificationsPane';
import AppearancePane from '@/features/settings/panes/AppearancePane';
import SecurityPane from '@/features/settings/panes/SecurityPane';
import PrivacyPane from '@/features/settings/panes/PrivacyPane';
import LeaveTypesPane from '@/features/settings/panes/LeaveTypesPane';
import LegalEntitiesPane from '@/features/settings/panes/LegalEntitiesPane';
import BiometricDevicesPane from '@/features/settings/panes/BiometricDevicesPane';
import SingleSignOnPane from '@/features/settings/panes/SingleSignOnPane';
import OrganizationPane from '@/features/settings/panes/OrganizationPane';
import ShiftsPane from '@/features/settings/panes/ShiftsPane';
import WorkingTimePane from '@/features/settings/panes/WorkingTimePane';
import ProductivityPane from '@/features/settings/panes/ProductivityPane';
import IntegrationsPane from '@/features/settings/panes/IntegrationsPane';
import CustomFieldsPane from '@/features/settings/panes/CustomFieldsPane';
import BillingPane from '@/features/settings/panes/BillingPane';
import HelpPane from '@/features/settings/panes/HelpPane';
import DevelopmentPane from '@/features/settings/panes/DevelopmentPane';
import type { SettingsTabId } from '@/features/settings/types';

const PANE_TITLES: Record<SettingsTabId, { title: string; description: string }> = {
  profile: { title: 'Profile', description: 'Your details, how you appear to colleagues, and the hours you work to.' },
  notifications: { title: 'Notifications', description: 'Which updates reach you, and how.' },
  appearance: { title: 'Appearance', description: 'How CareVance looks on this device.' },
  security: { title: 'Security', description: 'Two-factor authentication, your password, and who can reach this account.' },
  privacy: { title: 'Privacy', description: 'What is collected about you at work, why, for how long, and what you have agreed to.' },
  'leave-types': { title: 'Leave', description: 'How each kind of leave is earned - all at once, twice a year, quarterly or monthly - and what happens to what is left at the end of the year.' },
  'legal-entities': { title: 'Legal entities', description: 'The companies inside this workspace. Each files its own PF, ESI and TDS returns under its own PAN and TAN.' },
  'biometric-devices': { title: 'Biometric devices', description: 'The punch terminals on your walls, and which employee each enrolled ID belongs to. A device that has gone quiet is called out here, because no attendance looks exactly like nobody turning up.' },
  'single-sign-on': { title: 'Single sign-on', description: 'Let people sign in with the account they already have at Entra, Okta or Google. A connection stays off until you turn it on, because turning it on redirects everyone.' },
  organization: { title: 'Organization', description: 'Everything that applies to everyone in this workspace.' },
  shifts: { title: 'Shifts', description: 'The shift patterns this workspace runs, and who works which. A shift decides what a full day is worth counting down to.' },
  'working-time': { title: 'Working time', description: 'Weekly off, penalisation, overtime and shift allowance. Four policies, each created once and assigned to whoever it applies to — a shift decides the timings, these decide what they are worth.' },
  productivity: { title: 'Productivity', description: 'How visited domains and apps are counted in reports.' },
  integrations: { title: 'Integrations', description: 'What CareVance is connected to right now.' },
  'custom-fields': { title: 'Custom fields', description: 'Extra data you want on every employee record.' },
  billing: { title: 'Billing', description: 'Your plan, seats and renewal.' },
  help: { title: 'Help & support', description: 'Raise a ticket with the support team.' },
  development: { title: 'Development', description: 'Flags and environment details for dev builds.' },
};

export default function SettingsPage() {
  const controller = useSettingsController();
  const { choice: themeChoice } = useTheme();

  const {
    activeTab,
    handleTabChange,
    visibleTabs,
    isLoading,
    error,
    dirtyCount,
    saveActiveTab,
    discardActiveTab,
    isSavingActiveTab,
    personalDetailsForm,
    notifications,
    billingPlan,
    billingSnapshot,
  } = controller;

  const railHints = useMemo(() => {
    const personalValues = Object.values(personalDetailsForm);
    const filled = personalValues.filter((value) => String(value || '').trim()).length;
    const notificationsOn = Object.values(notifications).filter(Boolean).length;

    return {
      profile: `${filled}/${personalValues.length}`,
      notifications: `${notificationsOn} on`,
      appearance: themeChoice.charAt(0).toUpperCase() + themeChoice.slice(1),
      billing: billingPlan?.name || undefined,
    } as Partial<Record<SettingsTabId, string>>;
  }, [personalDetailsForm, notifications, themeChoice, billingPlan]);

  if (isLoading) {
    return <PageLoadingState label="Loading settings..." />;
  }

  const heading = PANE_TITLES[activeTab];

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        eyebrow="Account controls"
        title="Settings"
        description="Your profile, this workspace, and everything either of them touches."
      />

      {error ? <FeedbackBanner tone="error" message={error} /> : null}

      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="lg:w-64 lg:shrink-0">
          <SettingsRail
            tabs={visibleTabs}
            activeTab={activeTab}
            onTabChange={handleTabChange}
            hints={railHints}
          />
        </div>

        <div className="min-w-0 flex-1">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-slate-900">{heading.title}</h2>
            <p className="mt-1 max-w-2xl text-xs text-slate-600">{heading.description}</p>
          </div>

          {activeTab === 'profile' && <ProfilePane controller={controller} />}
          {activeTab === 'notifications' && <NotificationsPane controller={controller} />}
          {activeTab === 'appearance' && <AppearancePane />}
          {activeTab === 'security' && <SecurityPane controller={controller} />}
          {activeTab === 'privacy' && <PrivacyPane />}
          {activeTab === 'leave-types' && <LeaveTypesPane />}
          {activeTab === 'legal-entities' && <LegalEntitiesPane />}
          {activeTab === 'biometric-devices' && <BiometricDevicesPane />}
          {activeTab === 'single-sign-on' && <SingleSignOnPane />}
          {activeTab === 'organization' && <OrganizationPane controller={controller} />}
          {activeTab === 'shifts' && <ShiftsPane />}
          {activeTab === 'working-time' && <WorkingTimePane />}
          {activeTab === 'productivity' && <ProductivityPane />}
          {activeTab === 'integrations' && (
            <IntegrationsPane onOpenTab={handleTabChange} />
          )}
          {activeTab === 'custom-fields' && <CustomFieldsPane />}
          {activeTab === 'billing' && <BillingPane snapshot={billingSnapshot} />}
          {activeTab === 'help' && <HelpPane controller={controller} />}
          {activeTab === 'development' && <DevelopmentPane />}

          <SaveDock
            count={dirtyCount}
            where={heading.title}
            onSave={saveActiveTab}
            onDiscard={discardActiveTab}
            isSaving={isSavingActiveTab}
          />
        </div>
      </div>
    </div>
  );
}
