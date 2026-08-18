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
import OrganizationPane from '@/features/settings/panes/OrganizationPane';
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
  security: { title: 'Security', description: 'Your password and how this account is signed in.' },
  organization: { title: 'Organization', description: 'Everything that applies to everyone in this workspace.' },
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
          {activeTab === 'organization' && <OrganizationPane controller={controller} />}
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
