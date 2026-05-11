import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { hasAdminAccess, hasStrictAdminAccess, isEmployeeUser } from '@/lib/permissions';
import { resolveMediaUrl } from '@/lib/mediaUrl';
import { DEFAULT_APP_TIMEZONE, getSupportedTimezones, resolveTimeZone } from '@/lib/timezones';
import { productivityRuleApi, settingsApi, supportApi } from '@/services/api';
import type { ProductivityRule as ProductivityRuleType } from '@/types';
import { User, Bell, Lock, CreditCard, Building, Briefcase, Link2, FileSpreadsheet, LifeBuoy } from 'lucide-react';
import PageHeader from '@/components/dashboard/PageHeader';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import Button from '@/components/ui/Button';
import DesktopBrowserTrackingPanel from '@/components/desktop/DesktopBrowserTrackingPanel';
import { FeedbackBanner, PageLoadingState } from '@/components/ui/PageState';
import { FieldLabel, SelectInput, TextInput, TextareaInput, ToggleInput } from '@/components/ui/FormField';
import StatusBadge from '@/components/ui/StatusBadge';

const helpIssueCategories = [
  { value: 'bug', label: 'Bug' },
  { value: 'ui', label: 'UI issue' },
  { value: 'performance', label: 'Performance' },
  { value: 'billing', label: 'Billing' },
  { value: 'account', label: 'Account access' },
  { value: 'other', label: 'Other' },
] as const;

const toTimeInputValue = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim()) {
    return '';
  }
  const trimmed = value.trim();
  if (/^\d{2}:\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  if (/^\d{2}:\d{2}:\d{2}$/.test(trimmed)) {
    return trimmed.slice(0, 5);
  }
  const parsed = new Date(`1970-01-01T${trimmed}`);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toTimeString().slice(0, 5);
  }
  return '';
};

const extractOrganizationLogoUrl = (org: any): string => {
  const logoValue = org?.settings?.branding?.logo_url;
  return resolveMediaUrl(logoValue);
};

export default function SettingsPage() {
  const { user, organization, updateUser, updateOrganization } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('profile');
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [canManageOrg, setCanManageOrg] = useState(false);
  const [billingPlan, setBillingPlan] = useState<{ name: string; status: string; renewal_date?: string | null } | null>(null);
  const [productivityRules, setProductivityRules] = useState<any[]>([]);
  const [productivityMeta, setProductivityMeta] = useState<Record<string, string[]>>({});
  const [ruleForm, setRuleForm] = useState({
    id: 0,
    name: '',
    target_type: 'app',
    match_mode: 'contains',
    target_value: '',
    classification: 'productive',
    priority: '100',
    scope_type: 'global',
    scope_id: '',
    is_active: true,
    reason: '',
    notes: '',
  });
  const [ruleTest, setRuleTest] = useState({ name: '', type: 'app', window_title: '', app_name: '', url: '' });
  const [ruleTestResult, setRuleTestResult] = useState<Record<string, any> | null>(null);

  const [profileName, setProfileName] = useState(user?.name || '');
  const [profileEmail, setProfileEmail] = useState(user?.email || '');
  const [profileAvatar, setProfileAvatar] = useState(user?.avatar || '');
  const [profileAvatarFile, setProfileAvatarFile] = useState<File | null>(null);
  const [profileAvatarPreview, setProfileAvatarPreview] = useState(user?.avatar || '');

  const [orgName, setOrgName] = useState(organization?.name || '');
  const [orgSlug, setOrgSlug] = useState(organization?.slug || '');
  const [orgLogo, setOrgLogo] = useState(extractOrganizationLogoUrl(organization));
  const [orgLogoFile, setOrgLogoFile] = useState<File | null>(null);
  const [orgLogoPreview, setOrgLogoPreview] = useState(extractOrganizationLogoUrl(organization));
  const [officeStartTime, setOfficeStartTime] = useState('');
  const [lateAfterTime, setLateAfterTime] = useState('');

  const [notifyEmail, setNotifyEmail] = useState(true);
  const [notifyInApp, setNotifyInApp] = useState(true);
  const [notifyDesktopPush, setNotifyDesktopPush] = useState(true);
  const [notifyChatMessages, setNotifyChatMessages] = useState(true);
  const [notifyWeekly, setNotifyWeekly] = useState(true);
  const [notifyProject, setNotifyProject] = useState(true);
  const [notifyTask, setNotifyTask] = useState(true);
  const [timezone, setTimezone] = useState(DEFAULT_APP_TIMEZONE);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [helpName, setHelpName] = useState(user?.name || '');
  const [helpEmail, setHelpEmail] = useState(user?.email || '');
  const [helpIssueCategory, setHelpIssueCategory] = useState<(typeof helpIssueCategories)[number]['value']>('bug');
  const [helpSummary, setHelpSummary] = useState('');
  const [helpDescription, setHelpDescription] = useState('');
  const [isSubmittingHelp, setIsSubmittingHelp] = useState(false);

  const isEmployee = isEmployeeUser(user);
  const isOrgEditable = canManageOrg && hasAdminAccess(user) && !isEmployee;
  const canEditEmail = hasStrictAdminAccess(user);
  const hasDesktopBrowserTracking = Boolean(window.desktopTracker);

  const tabs = [
    { id: 'profile', name: 'Profile', icon: User },
    { id: 'organization', name: 'Organization', icon: Building },
    { id: 'notifications', name: 'Notifications', icon: Bell },
    { id: 'security', name: 'Security', icon: Lock },
    { id: 'help', name: 'Help', icon: LifeBuoy },
    ...(hasAdminAccess(user) ? [{ id: 'integrations', name: 'Integrations', icon: Link2 }] : []),
    ...(hasAdminAccess(user) ? [{ id: 'custom-fields', name: 'Custom Fields', icon: FileSpreadsheet }] : []),
    { id: 'billing', name: 'Billing', icon: CreditCard },
    ...(hasDesktopBrowserTracking ? [{ id: 'browser-tracking', name: 'Browser Tracking', icon: Link2 }] : []),
    ...(hasStrictAdminAccess(user) ? [{ id: 'productivity', name: 'Productivity', icon: Briefcase }] : []),
  ];
  const allowedTabIds = useMemo(() => new Set(tabs.map((tab) => tab.id)), [tabs]);

  const timezoneOptions = useMemo(() => getSupportedTimezones(), []);

  useEffect(() => {
    const tabFromQuery = new URLSearchParams(location.search).get('tab');
    let tabFromPath = '';

    if (location.pathname.endsWith('/integrations')) {
      tabFromPath = 'integrations';
    } else if (location.pathname.endsWith('/custom-fields')) {
      tabFromPath = 'custom-fields';
    }

    const requestedTab = tabFromPath || tabFromQuery || '';
    if (requestedTab && allowedTabIds.has(requestedTab)) {
      if (activeTab !== requestedTab) {
        setActiveTab(requestedTab);
      }
      return;
    }

    if (!allowedTabIds.has(activeTab)) {
      setActiveTab('profile');
    }
  }, [activeTab, allowedTabIds, location.pathname, location.search]);

  useEffect(() => {
    setProfileName(user?.name || '');
    setProfileEmail(user?.email || '');
    setProfileAvatar(resolveMediaUrl(user?.avatar || ''));
    setProfileAvatarFile(null);
    setProfileAvatarPreview(resolveMediaUrl(user?.avatar || ''));
    setHelpName(user?.name || '');
    setHelpEmail(user?.email || '');
  }, [user]);

  useEffect(() => {
    setOrgName(organization?.name || '');
    setOrgSlug(organization?.slug || '');
    const logoUrl = extractOrganizationLogoUrl(organization);
    setOrgLogo(logoUrl);
    setOrgLogoFile(null);
    setOrgLogoPreview(logoUrl);
    setOfficeStartTime(toTimeInputValue((organization?.settings as any)?.attendance?.office_start_time));
    setLateAfterTime(toTimeInputValue((organization?.settings as any)?.attendance?.late_after_time));
  }, [organization]);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      setError('');
      try {
        const [meResult, billingResult, rulesResult] = await Promise.allSettled([
          settingsApi.me(),
          settingsApi.billing(),
          hasStrictAdminAccess(user) ? productivityRuleApi.list() : Promise.resolve({ data: { data: [], meta: {} } }),
        ]);

        if (meResult.status === 'fulfilled') {
          const payload = meResult.value.data;
          const fetchedUser = payload.user;
          const fetchedOrg = payload.organization;
          const settings = fetchedUser?.settings || {};
          const notifications = settings.notifications || {};

          setCanManageOrg(Boolean(payload.can_manage_org));
          setProfileName(fetchedUser?.name || '');
          setProfileEmail(fetchedUser?.email || '');
          setProfileAvatar(resolveMediaUrl(fetchedUser?.avatar || ''));
          setProfileAvatarFile(null);
          setProfileAvatarPreview(resolveMediaUrl(fetchedUser?.avatar || ''));
          setOrgName(fetchedOrg?.name || '');
          setOrgSlug(fetchedOrg?.slug || '');
          const fetchedOrgLogo = extractOrganizationLogoUrl(fetchedOrg);
          setOrgLogo(fetchedOrgLogo);
          setOrgLogoFile(null);
          setOrgLogoPreview(fetchedOrgLogo);
          setOfficeStartTime(toTimeInputValue((fetchedOrg?.settings as any)?.attendance?.office_start_time));
          setLateAfterTime(toTimeInputValue((fetchedOrg?.settings as any)?.attendance?.late_after_time));
          setTimezone(resolveTimeZone(settings.timezone || DEFAULT_APP_TIMEZONE));
          setNotifyEmail(notifications.email ?? true);
          setNotifyInApp(notifications.in_app ?? true);
          setNotifyDesktopPush(notifications.desktop_push ?? true);
          setNotifyChatMessages(notifications.chat_messages ?? true);
          setNotifyWeekly(notifications.weekly_summary ?? true);
          setNotifyProject(notifications.project_updates ?? true);
          setNotifyTask(notifications.task_assignments ?? true);
        } else {
          setCanManageOrg(Boolean(hasAdminAccess(user) && !isEmployee));
        }

        if (billingResult.status === 'fulfilled') {
          setBillingPlan((billingResult.value.data as any)?.plan || null);
        } else {
          setBillingPlan(null);
        }

        if (rulesResult.status === 'fulfilled') {
          setProductivityRules((rulesResult.value.data as any)?.data || []);
          setProductivityMeta((rulesResult.value.data as any)?.meta || {});
        }

        if (meResult.status === 'rejected' && billingResult.status === 'rejected') {
          const meError = meResult.reason as any;
          setError(meError?.response?.data?.message || 'Failed to load settings');
        } else if (meResult.status === 'rejected') {
          const meError = meResult.reason as any;
          setError(meError?.response?.data?.message || 'Some settings could not be refreshed');
        } else if (billingResult.status === 'rejected') {
          setError('Billing details are temporarily unavailable');
        }
      } finally {
        setIsLoading(false);
      }
    };

    load();
  }, [isEmployee, user]);

  const handleTabChange = (nextTab: string) => {
    setActiveTab(nextTab);
    if (location.search) {
      navigate(location.pathname, { replace: true });
    }
  };

  const submitHelpTicket = async () => {
    setError('');
    setMessage('');

    const summary = helpSummary.trim();
    const description = helpDescription.trim();
    const email = helpEmail.trim();

    if (!email || !summary || !description) {
      setError('Email, summary, and description are required to raise a support ticket.');
      return;
    }

    setIsSubmittingHelp(true);
    try {
      const currentPath = `${location.pathname}${location.search}`;
      const response = await supportApi.submitBugReport({
        name: helpName.trim() || undefined,
        email,
        issue_category: helpIssueCategory,
        summary,
        description,
        current_path: currentPath,
      });

      setHelpSummary('');
      setHelpDescription('');
      if (!user) {
        setHelpName('');
      }
      setMessage(response.data.message || 'Support ticket raised successfully.');
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Unable to raise support ticket right now.');
    } finally {
      setIsSubmittingHelp(false);
    }
  };

  const saveProfile = async () => {
    setError('');
    setMessage('');
    try {
      const name = profileName.trim();
      const email = profileEmail.trim();
      const avatar = profileAvatar.trim() || null;
      const payload = profileAvatarFile
        ? (() => {
            const formData = new FormData();
            formData.append('name', name);
            if (canEditEmail) {
              formData.append('email', email);
            }
            formData.append('avatar_file', profileAvatarFile);
            return formData;
          })()
        : {
            name,
            avatar,
            ...(canEditEmail ? { email } : {}),
          };

      const res = await settingsApi.updateProfile(payload);
      const updated = (res.data as any)?.user;
      if (updated) {
        updateUser(updated);
        setProfileAvatar(resolveMediaUrl(updated.avatar || ''));
        setProfileAvatarPreview(resolveMediaUrl(updated.avatar || ''));
      }
      setProfileAvatarFile(null);
      setMessage((res.data as any)?.message || 'Profile updated');
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Failed to update profile');
    }
  };

  const saveOrganization = async () => {
    setError('');
    setMessage('');
    try {
      const name = orgName.trim();
      const slug = orgSlug.trim();
      const payload = orgLogoFile
        ? (() => {
            const formData = new FormData();
            formData.append('name', name);
            formData.append('slug', slug);
            if (officeStartTime) {
              formData.append('office_start_time', officeStartTime);
            }
            if (lateAfterTime) {
              formData.append('late_after_time', lateAfterTime);
            }
            formData.append('logo_file', orgLogoFile);
            return formData;
          })()
        : {
            name,
            slug,
            office_start_time: officeStartTime || null,
            late_after_time: lateAfterTime || null,
          };

      const res = await settingsApi.updateOrganization(payload);

      const updatedOrg = (res.data as any)?.organization || null;
      updateOrganization(updatedOrg);
      const nextLogo = extractOrganizationLogoUrl(updatedOrg);
      setOrgLogo(nextLogo);
      setOrgLogoPreview(nextLogo);
      setOrgLogoFile(null);
      setMessage((res.data as any)?.message || 'Organization updated');
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Failed to update organization');
    }
  };

  const onProfileAvatarFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    if (!file) {
      setProfileAvatarFile(null);
      setProfileAvatarPreview(profileAvatar);
      return;
    }

    if (!file.type.startsWith('image/')) {
      setError('Please upload a valid image file for profile photo.');
      event.target.value = '';
      return;
    }

    setError('');
    setProfileAvatarFile(file);
    setProfileAvatarPreview(URL.createObjectURL(file));
  };

  const onOrganizationLogoFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    if (!file) {
      setOrgLogoFile(null);
      setOrgLogoPreview(orgLogo);
      return;
    }

    if (!file.type.startsWith('image/')) {
      setError('Please upload a valid image file for organization logo.');
      event.target.value = '';
      return;
    }

    setError('');
    setOrgLogoFile(file);
    setOrgLogoPreview(URL.createObjectURL(file));
  };

  const savePreferences = async () => {
    setError('');
    setMessage('');
    try {
      const res = await settingsApi.updatePreferences({
        timezone,
        notifications: {
          email: notifyEmail,
          in_app: notifyInApp,
          desktop_push: notifyDesktopPush,
          chat_messages: notifyChatMessages,
          weekly_summary: notifyWeekly,
          project_updates: notifyProject,
          task_assignments: notifyTask,
        },
      });
      if (user) {
        updateUser({
          ...user,
          settings: {
            ...(user.settings || {}),
            timezone,
            notifications: {
              ...((user.settings as Record<string, any> | undefined)?.notifications || {}),
              email: notifyEmail,
              in_app: notifyInApp,
              desktop_push: notifyDesktopPush,
              chat_messages: notifyChatMessages,
              weekly_summary: notifyWeekly,
              project_updates: notifyProject,
              task_assignments: notifyTask,
            },
          },
        });
      }
      setMessage((res.data as any)?.message || 'Preferences updated');
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Failed to update preferences');
    }
  };

  const updatePassword = async () => {
    setError('');
    setMessage('');
    if (newPassword !== confirmPassword) {
      setError('New password and confirm password do not match.');
      return;
    }
    try {
      const res = await settingsApi.updatePassword({
        current_password: currentPassword,
        new_password: newPassword,
        new_password_confirmation: confirmPassword,
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setMessage((res.data as any)?.message || 'Password updated');
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Failed to update password');
    }
  };

  const saveRule = async () => {
    setError('');
    setMessage('');
    try {
      const payload: Partial<ProductivityRuleType> = {
        name: ruleForm.name || null,
        target_type: ruleForm.target_type as ProductivityRuleType['target_type'],
        match_mode: ruleForm.match_mode as ProductivityRuleType['match_mode'],
        target_value: ruleForm.target_value,
        classification: ruleForm.classification as ProductivityRuleType['classification'],
        priority: Number(ruleForm.priority || 100),
        scope_type: ruleForm.scope_type as ProductivityRuleType['scope_type'],
        scope_id: ruleForm.scope_type === 'global' ? null : Number(ruleForm.scope_id || 0) || null,
        is_active: ruleForm.is_active,
        reason: ruleForm.reason || null,
        notes: ruleForm.notes || null,
      };

      if (ruleForm.id) {
        await productivityRuleApi.update(ruleForm.id, payload);
        setMessage('Productivity rule updated.');
      } else {
        await productivityRuleApi.create(payload);
        setMessage('Productivity rule created.');
      }

      const refreshed = await productivityRuleApi.list();
      setProductivityRules(refreshed.data.data || []);
      setProductivityMeta((refreshed.data as any)?.meta || {});
      setRuleForm({ id: 0, name: '', target_type: 'app', match_mode: 'contains', target_value: '', classification: 'productive', priority: '100', scope_type: 'global', scope_id: '', is_active: true, reason: '', notes: '' });
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Failed to save productivity rule');
    }
  };

  const runRuleTest = async () => {
    setError('');
    try {
      const res = await productivityRuleApi.test(ruleTest);
      setRuleTestResult(res.data);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Failed to test rule');
    }
  };

  if (isLoading) {
    return <PageLoadingState label="Loading settings..." />;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        eyebrow="Account controls"
        title="Settings"
        description="Manage your profile, organization preferences, notifications, security, and billing details."
      />

      {message ? <FeedbackBanner tone="success" message={message} /> : null}
      {error ? <FeedbackBanner tone="error" message={error} /> : null}

      <div className="flex flex-col lg:flex-row gap-6">
        <div className="lg:w-64 shrink-0">
          <SurfaceCard className="p-2">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={`w-full flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium transition ${activeTab === tab.id ? 'bg-sky-50 text-sky-700 shadow-sm' : 'text-gray-600 hover:bg-slate-50'}`}
              >
                <tab.icon className="h-5 w-5" />
                {tab.name}
              </button>
            ))}
          </SurfaceCard>
        </div>

        <SurfaceCard className="flex-1 p-6">
          {activeTab === 'profile' && (
            <div className="space-y-6">
              <h2 className="text-lg font-semibold text-gray-900">Profile Settings</h2>
              <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
                {profileAvatarPreview ? (
                  <img src={profileAvatarPreview} alt={profileName || user?.name || 'Profile'} className="h-20 w-20 rounded-full object-cover border border-slate-200" />
                ) : (
                  <div className="h-20 w-20 rounded-full bg-primary-100 flex items-center justify-center text-primary-600 text-2xl font-bold">
                    {(profileName || user?.name)?.charAt(0)}
                  </div>
                )}
                <div className="flex-1">
                  <FieldLabel>Profile Photo</FieldLabel>
                  <TextInput type="file" accept="image/*" onChange={onProfileAvatarFileChange} />
                  <p className="text-sm text-gray-500 mt-2">Upload your profile photo directly (max 2MB).</p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <FieldLabel>Full Name</FieldLabel>
                  <TextInput
                    type="text"
                    value={profileName}
                    onChange={(e) => setProfileName(e.target.value)}
                  />
                </div>
                <div>
                  <FieldLabel>Email</FieldLabel>
                  <TextInput
                    type="email"
                    value={profileEmail}
                    onChange={(e) => setProfileEmail(e.target.value)}
                    disabled={!canEditEmail}
                    className={!canEditEmail ? 'bg-slate-50 text-slate-500' : ''}
                  />
                  {!canEditEmail ? <p className="mt-2 text-sm text-gray-500">Only admins can change their own email from settings.</p> : null}
                </div>
                <div>
                  <FieldLabel>Role</FieldLabel>
                  <div className="flex min-h-11 items-center rounded-lg border border-slate-200 bg-slate-50 px-3.5">
                    <StatusBadge tone="info">{user?.role || 'Unknown'}</StatusBadge>
                  </div>
                </div>
              </div>
              <Button onClick={saveProfile}>Save Changes</Button>
            </div>
          )}

          {activeTab === 'organization' && (
            <div className="space-y-6">
              <h2 className="text-lg font-semibold text-gray-900">Organization Settings</h2>
              <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
                {orgLogoPreview ? (
                  <img src={orgLogoPreview} alt={orgName || 'Organization Logo'} className="h-20 w-20 rounded-2xl object-cover border border-slate-200" />
                ) : (
                  <div className="h-20 w-20 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-500 text-xs font-semibold text-center px-2">
                    No Logo
                  </div>
                )}
                <div className="flex-1">
                  <FieldLabel>Company Logo</FieldLabel>
                  <TextInput type="file" accept="image/*" onChange={onOrganizationLogoFileChange} disabled={!isOrgEditable} className={!isOrgEditable ? 'bg-slate-50 text-slate-500' : ''} />
                  <p className="text-sm text-gray-500 mt-2">Upload your company logo (max 2MB).</p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <FieldLabel>Organization Name</FieldLabel>
                  <TextInput type="text" value={orgName} onChange={(e) => setOrgName(e.target.value)} disabled={!isOrgEditable} className={!isOrgEditable ? 'bg-slate-50 text-slate-500' : ''} />
                </div>
                <div>
                  <FieldLabel>Slug</FieldLabel>
                  <TextInput type="text" value={orgSlug} onChange={(e) => setOrgSlug(e.target.value)} disabled={!isOrgEditable} className={!isOrgEditable ? 'bg-slate-50 text-slate-500' : ''} />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <FieldLabel>Office Start Time</FieldLabel>
                  <TextInput
                    type="time"
                    value={officeStartTime}
                    onChange={(e) => setOfficeStartTime(e.target.value)}
                    disabled={!isOrgEditable}
                    className={!isOrgEditable ? 'bg-slate-50 text-slate-500' : ''}
                  />
                  <p className="mt-2 text-sm text-gray-500">Employees can check in earlier; this is the expected office start time.</p>
                </div>
                <div>
                  <FieldLabel>Late After</FieldLabel>
                  <TextInput
                    type="time"
                    value={lateAfterTime}
                    onChange={(e) => setLateAfterTime(e.target.value)}
                    disabled={!isOrgEditable}
                    className={!isOrgEditable ? 'bg-slate-50 text-slate-500' : ''}
                  />
                  <p className="mt-2 text-sm text-gray-500">Check-ins after this time are marked late (for example 09:15).</p>
                </div>
              </div>
              {isOrgEditable ? (
                <Button onClick={saveOrganization}>Save Changes</Button>
              ) : (
                <p className="text-sm text-gray-500">Only admin/manager can update organization settings.</p>
              )}
            </div>
          )}

          {activeTab === 'notifications' && (
            <div className="space-y-6">
              <h2 className="text-lg font-semibold text-gray-900">Notification Preferences</h2>
              <div>
                <FieldLabel>Timezone</FieldLabel>
                <SelectInput value={timezone} onChange={(e) => setTimezone(e.target.value)} className="w-full md:w-72">
                  {timezoneOptions.map((tz) => (
                    <option key={tz} value={tz}>{tz}</option>
                  ))}
                </SelectInput>
              </div>
              {[
                { label: 'Email notifications', value: notifyEmail, set: setNotifyEmail },
                { label: 'In-app notifications', value: notifyInApp, set: setNotifyInApp },
                { label: 'Desktop popup notifications', value: notifyDesktopPush, set: setNotifyDesktopPush },
                { label: 'Chat message notifications', value: notifyChatMessages, set: setNotifyChatMessages },
                { label: 'Weekly summary', value: notifyWeekly, set: setNotifyWeekly },
                { label: 'Project updates', value: notifyProject, set: setNotifyProject },
                { label: 'Task assignments', value: notifyTask, set: setNotifyTask },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-4 py-3">
                  <span className="text-gray-700">{item.label}</span>
                  <ToggleInput checked={item.value} onChange={item.set} />
                </div>
              ))}
              <Button onClick={savePreferences}>Save Preferences</Button>
            </div>
          )}

          {activeTab === 'security' && (
            <div className="space-y-6">
              <h2 className="text-lg font-semibold text-gray-900">Security Settings</h2>
              <div><FieldLabel>Current Password</FieldLabel><TextInput type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} /></div>
              <div><FieldLabel>New Password</FieldLabel><TextInput type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} /></div>
              <div><FieldLabel>Confirm Password</FieldLabel><TextInput type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} /></div>
              <Button onClick={updatePassword}>Update Password</Button>
            </div>
          )}

          {activeTab === 'help' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Help & Support</h2>
                <p className="mt-2 text-sm text-slate-500">
                  Raise a support ticket and our team will receive it directly on the support inbox.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <FieldLabel>Name</FieldLabel>
                  <TextInput type="text" value={helpName} onChange={(event) => setHelpName(event.target.value)} placeholder="Your name" />
                </div>
                <div>
                  <FieldLabel>Email</FieldLabel>
                  <TextInput type="email" value={helpEmail} onChange={(event) => setHelpEmail(event.target.value)} placeholder="you@company.com" />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <FieldLabel>Issue Category</FieldLabel>
                  <SelectInput value={helpIssueCategory} onChange={(event) => setHelpIssueCategory(event.target.value as (typeof helpIssueCategories)[number]['value'])}>
                    {helpIssueCategories.map((category) => (
                      <option key={category.value} value={category.value}>{category.label}</option>
                    ))}
                  </SelectInput>
                </div>
                <div>
                  <FieldLabel>Summary</FieldLabel>
                  <TextInput type="text" value={helpSummary} onChange={(event) => setHelpSummary(event.target.value)} placeholder="Short summary of your issue" maxLength={255} />
                </div>
              </div>

              <div>
                <FieldLabel>Description</FieldLabel>
                <TextareaInput
                  value={helpDescription}
                  onChange={(event) => setHelpDescription(event.target.value)}
                  placeholder="Describe the issue in detail so we can assist faster."
                  rows={5}
                  maxLength={4000}
                />
              </div>

              <Button onClick={submitHelpTicket} disabled={isSubmittingHelp}>
                {isSubmittingHelp ? 'Raising Ticket...' : 'Raise Ticket'}
              </Button>
            </div>
          )}

          {activeTab === 'billing' && (
            <div className="space-y-6">
              <h2 className="text-lg font-semibold text-gray-900">Billing & Subscription</h2>
              <div className="rounded-lg border border-sky-200 bg-sky-50 p-4">
                <p className="text-sm text-primary-600">Current Plan: <span className="font-semibold">{billingPlan?.name || 'Basic'}</span></p>
                <p className="text-xs text-primary-500 mt-1">
                  Status: {billingPlan?.status || 'N/A'}
                  {billingPlan?.renewal_date ? ` | Renewal: ${new Date(billingPlan.renewal_date).toLocaleDateString()}` : ''}
                </p>
              </div>
              <Button disabled variant="secondary">Manage Subscription (Coming soon)</Button>
            </div>
          )}

          {activeTab === 'integrations' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Integrations</h2>
                <p className="mt-2 text-sm text-slate-500">Manage connected services and workspace integrations from one clean panel.</p>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {[
                  ['Desktop App', 'Connected through the CareVance desktop tracker for attendance, screenshots, and activity data.', 'Configured'],
                  ['Browser Tracking', 'Pair browser activity with desktop tracking when the extension is available.', hasDesktopBrowserTracking ? 'Available' : 'Desktop app required'],
                  ['Payroll Export', 'Use payroll reports and exports from the payroll workspace.', 'Ready'],
                  ['Notifications', 'Email, in-app, desktop, and chat notification preferences are managed here.', 'Ready'],
                ].map(([title, description, status]) => (
                  <div key={title} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold text-slate-950">{title}</p>
                      <StatusBadge tone={status === 'Configured' || status === 'Ready' || status === 'Available' ? 'success' : 'neutral'}>{status}</StatusBadge>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-slate-500">{description}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'custom-fields' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Custom Fields</h2>
                <p className="mt-2 text-sm text-slate-500">Keep employee and workspace metadata organized with consistent fields.</p>
              </div>
              <div className="overflow-hidden rounded-lg border border-slate-200">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-medium">Field</th>
                      <th className="px-4 py-3 font-medium">Applies To</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {[
                      ['Employee Code', 'Employees', 'Default'],
                      ['Department', 'Employees', 'Default'],
                      ['Designation', 'Employees', 'Default'],
                      ['Payroll Profile', 'Payroll', 'Default'],
                    ].map(([field, target, status]) => (
                      <tr key={field}>
                        <td className="px-4 py-3 font-semibold text-slate-900">{field}</td>
                        <td className="px-4 py-3 text-slate-600">{target}</td>
                        <td className="px-4 py-3"><StatusBadge tone="info">{status}</StatusBadge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Button disabled variant="secondary">Add Custom Field (Coming soon)</Button>
            </div>
          )}

          {activeTab === 'browser-tracking' && hasDesktopBrowserTracking && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Browser Tracking</h2>
                <p className="mt-2 text-sm text-slate-500">
                  Install once, pair once, and let the desktop app keep the browser connected across restarts. Published desktop builds can open direct browser install pages, while local builds still provide the unpacked extension folder.
                </p>
              </div>
              <DesktopBrowserTrackingPanel />
            </div>
          )}

          {activeTab === 'productivity' && hasStrictAdminAccess(user) && (
            <div className="space-y-6">
              <h2 className="text-lg font-semibold text-gray-900">Productivity Rule Engine</h2>
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <div className="space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div><FieldLabel>Name</FieldLabel><TextInput type="text" value={ruleForm.name} onChange={(e) => setRuleForm((current) => ({ ...current, name: e.target.value }))} /></div>
                    <div><FieldLabel>Target Value</FieldLabel><TextInput type="text" value={ruleForm.target_value} onChange={(e) => setRuleForm((current) => ({ ...current, target_value: e.target.value }))} /></div>
                    <div><FieldLabel>Target Type</FieldLabel><SelectInput value={ruleForm.target_type} onChange={(e) => setRuleForm((current) => ({ ...current, target_type: e.target.value }))}>{(productivityMeta.target_types || ['app', 'domain', 'title_pattern', 'url_pattern']).map((option) => <option key={option} value={option}>{option}</option>)}</SelectInput></div>
                    <div><FieldLabel>Match Mode</FieldLabel><SelectInput value={ruleForm.match_mode} onChange={(e) => setRuleForm((current) => ({ ...current, match_mode: e.target.value }))}>{(productivityMeta.match_modes || ['exact', 'contains', 'starts_with', 'ends_with', 'regex']).map((option) => <option key={option} value={option}>{option}</option>)}</SelectInput></div>
                    <div><FieldLabel>Classification</FieldLabel><SelectInput value={ruleForm.classification} onChange={(e) => setRuleForm((current) => ({ ...current, classification: e.target.value }))}>{(productivityMeta.classifications || ['productive', 'unproductive', 'neutral', 'context_dependent']).map((option) => <option key={option} value={option}>{option}</option>)}</SelectInput></div>
                    <div><FieldLabel>Priority</FieldLabel><TextInput type="number" value={ruleForm.priority} onChange={(e) => setRuleForm((current) => ({ ...current, priority: e.target.value }))} /></div>
                    <div><FieldLabel>Scope Type</FieldLabel><SelectInput value={ruleForm.scope_type} onChange={(e) => setRuleForm((current) => ({ ...current, scope_type: e.target.value }))}>{(productivityMeta.scope_types || ['global', 'workspace', 'group', 'user']).map((option) => <option key={option} value={option}>{option}</option>)}</SelectInput></div>
                    <div><FieldLabel>Scope Id</FieldLabel><TextInput type="number" value={ruleForm.scope_id} onChange={(e) => setRuleForm((current) => ({ ...current, scope_id: e.target.value }))} disabled={ruleForm.scope_type === 'global'} /></div>
                  </div>
                  <div><FieldLabel>Reason</FieldLabel><TextInput type="text" value={ruleForm.reason} onChange={(e) => setRuleForm((current) => ({ ...current, reason: e.target.value }))} /></div>
                  <div><FieldLabel>Notes</FieldLabel><TextInput type="text" value={ruleForm.notes} onChange={(e) => setRuleForm((current) => ({ ...current, notes: e.target.value }))} /></div>
                  <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3"><span className="text-sm text-slate-700">Rule enabled</span><ToggleInput checked={ruleForm.is_active} onChange={(checked) => setRuleForm((current) => ({ ...current, is_active: checked }))} /></div>
                  <div className="flex gap-3">
                    <Button onClick={saveRule}>{ruleForm.id ? 'Update Rule' : 'Create Rule'}</Button>
                    <Button variant="secondary" onClick={() => setRuleForm({ id: 0, name: '', target_type: 'app', match_mode: 'contains', target_value: '', classification: 'productive', priority: '100', scope_type: 'global', scope_id: '', is_active: true, reason: '', notes: '' })}>Reset</Button>
                  </div>
                </div>
                <div className="space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <h3 className="font-semibold text-slate-900">Test Classification</h3>
                  <div><FieldLabel>Name</FieldLabel><TextInput type="text" value={ruleTest.name} onChange={(e) => setRuleTest((current) => ({ ...current, name: e.target.value }))} /></div>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div><FieldLabel>Type</FieldLabel><SelectInput value={ruleTest.type} onChange={(e) => setRuleTest((current) => ({ ...current, type: e.target.value }))}><option value="app">app</option><option value="url">url</option><option value="idle">idle</option></SelectInput></div>
                    <div><FieldLabel>App Name</FieldLabel><TextInput type="text" value={ruleTest.app_name} onChange={(e) => setRuleTest((current) => ({ ...current, app_name: e.target.value }))} /></div>
                  </div>
                  <div><FieldLabel>Window Title</FieldLabel><TextInput type="text" value={ruleTest.window_title} onChange={(e) => setRuleTest((current) => ({ ...current, window_title: e.target.value }))} /></div>
                  <div><FieldLabel>URL</FieldLabel><TextInput type="text" value={ruleTest.url} onChange={(e) => setRuleTest((current) => ({ ...current, url: e.target.value }))} /></div>
                  <Button variant="secondary" onClick={runRuleTest}>Run Test</Button>
                  {ruleTestResult ? <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-700"><p><strong>Classification:</strong> {String(ruleTestResult.classification || 'neutral')}</p><p><strong>Label:</strong> {String(ruleTestResult.normalized_label || 'n/a')}</p><p><strong>Reason:</strong> {String(ruleTestResult.classification_reason || 'n/a')}</p></div> : null}
                </div>
              </div>
              <div className="space-y-3">
                {productivityRules.map((rule) => (
                  <div key={rule.id} className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white px-4 py-4 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="font-medium text-slate-950">{rule.name || rule.target_value}</p>
                      <p className="text-sm text-slate-500">{rule.scope_type} • {rule.target_type} • {rule.match_mode} • {rule.classification}</p>
                      <p className="text-xs text-slate-500">priority {rule.priority}{rule.reason ? ` • ${rule.reason}` : ''}</p>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="secondary" size="sm" onClick={() => setRuleForm({ id: rule.id, name: rule.name || '', target_type: rule.target_type, match_mode: rule.match_mode, target_value: rule.target_value, classification: rule.classification, priority: String(rule.priority || 100), scope_type: rule.scope_type, scope_id: rule.scope_id ? String(rule.scope_id) : '', is_active: !!rule.is_active, reason: rule.reason || '', notes: rule.notes || '' })}>Edit</Button>
                      <Button variant="secondary" size="sm" onClick={async () => { await productivityRuleApi.update(rule.id, { is_active: !rule.is_active }); const refreshed = await productivityRuleApi.list(); setProductivityRules(refreshed.data.data || []); }}>{rule.is_active ? 'Disable' : 'Enable'}</Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </SurfaceCard>
      </div>
    </div>
  );
}
