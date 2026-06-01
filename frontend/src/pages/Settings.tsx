import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { hasAdminAccess, hasStrictAdminAccess, isEmployeeUser, resolveUserRoleLabel, canAccess } from '@/lib/permissions';
import { resolveMediaUrl } from '@/lib/mediaUrl';
import { COMMON_TIMEZONES, DEFAULT_APP_TIMEZONE, getSupportedTimezones, resolveTimeZone } from '@/lib/timezones';
import { employeeWorkspaceApi, productivityClassificationApi, settingsApi, supportApi, organizationApi } from '@/services/api';
import type { ProductivityClassificationItem } from '@/types';
import { ArrowRight, User, Bell, Lock, CreditCard, Building, Briefcase, Link2, FileSpreadsheet, LifeBuoy, Trash2, AlertTriangle } from 'lucide-react';
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

type LeaveCategorySetting = {
  code: string;
  name: string;
  annual_quota: string;
};

type PersonalDetailsForm = {
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

const createEmptyPersonalDetailsForm = (): PersonalDetailsForm => ({
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

const labelize = (value: string) =>
  value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const DEFAULT_LEAVE_CATEGORIES: LeaveCategorySetting[] = [
  { code: 'paid', name: 'Paid Leave', annual_quota: '21' },
  { code: 'sick', name: 'Sick Leave', annual_quota: '12' },
  { code: 'birthday', name: 'Birthday Leave', annual_quota: '1' },
];

const readLeaveCategories = (org?: any): LeaveCategorySetting[] => {
  const rawCategories = (org?.settings as any)?.leave_policy?.categories;
  if (!Array.isArray(rawCategories) || rawCategories.length === 0) {
    return DEFAULT_LEAVE_CATEGORIES;
  }

  const normalized = rawCategories
    .map((item: any) => {
      const code = String(item?.code || '').trim().toLowerCase().replace(/\s+/g, '_');
      const name = String(item?.name || '').trim();
      const quota = Number(item?.annual_quota);

      if (!code || !name || code === 'unpaid' || !Number.isFinite(quota) || quota < 0) {
        return null;
      }

      return {
        code,
        name,
        annual_quota: String(quota),
      };
    })
    .filter(Boolean) as LeaveCategorySetting[];

  return normalized.length ? normalized : DEFAULT_LEAVE_CATEGORIES;
};

export default function SettingsPage() {
  const { user, organization, updateUser, updateOrganization } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('profile');
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [canManageOrg, setCanManageOrg] = useState(false);
  const [billingPlan, setBillingPlan] = useState<{ name: string; status: string; renewal_date?: string | null } | null>(null);

  const [prodItems, setProdItems] = useState<ProductivityClassificationItem[]>([]);
  const [prodMeta, setProdMeta] = useState<Record<string, any>>({});
  const [prodLoading, setProdLoading] = useState(false);
  const [prodSearch, setProdSearch] = useState('');
  const [prodFilter, setProdFilter] = useState('');
  const [prodDays, setProdDays] = useState(7);
  const [prodPage, setProdPage] = useState(1);
  const [prodSelected, setProdSelected] = useState<Set<string>>(new Set());
  const [prodBulkClassification, setProdBulkClassification] = useState('productive');
  const [prodSaving, setProdSaving] = useState(false);

  const [profileName, setProfileName] = useState(user?.name || '');
  const [profileEmail, setProfileEmail] = useState(user?.email || '');
  const [profileAvatar, setProfileAvatar] = useState(user?.avatar || '');
  const [profileAvatarFile, setProfileAvatarFile] = useState<File | null>(null);
  const [profileAvatarPreview, setProfileAvatarPreview] = useState(user?.avatar || '');
  const [personalDetailsForm, setPersonalDetailsForm] = useState<PersonalDetailsForm>(createEmptyPersonalDetailsForm());
  const [isLoadingPersonalDetails, setIsLoadingPersonalDetails] = useState(false);
  const personalDetailsRef = useRef<HTMLDivElement>(null);

  const [orgName, setOrgName] = useState(organization?.name || '');
  const [orgSlug, setOrgSlug] = useState(organization?.slug || '');
  const [orgLogo, setOrgLogo] = useState(extractOrganizationLogoUrl(organization));
  const [orgLogoFile, setOrgLogoFile] = useState<File | null>(null);
  const [orgLogoPreview, setOrgLogoPreview] = useState(extractOrganizationLogoUrl(organization));
  const [officeStartTime, setOfficeStartTime] = useState('');
  const [lateAfterTime, setLateAfterTime] = useState('');
  const [orgTimezone, setOrgTimezone] = useState(DEFAULT_APP_TIMEZONE);
  const [leaveCategories, setLeaveCategories] = useState<LeaveCategorySetting[]>(() => readLeaveCategories(organization));

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

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [isDeletingOrg, setIsDeletingOrg] = useState(false);

  const isEmployee = isEmployeeUser(user);
  // Use permission-based checks for custom roles support
  const canViewSettings = canAccess(user, 'settings.view') || hasStrictAdminAccess(user);
  const canManageSettings = canAccess(user, 'settings.manage') || hasStrictAdminAccess(user);
  const canManageProductivity = canAccess(user, 'productivity.manage') || hasStrictAdminAccess(user);
  const isOrgEditable = canManageOrg && (canManageSettings || hasStrictAdminAccess(user));
  const canEditTimezone = canManageOrg && (hasAdminAccess(user) || canManageSettings || hasStrictAdminAccess(user));
  const isStrictAdminUser = hasStrictAdminAccess(user);
  const canEditEmail = hasStrictAdminAccess(user);
  const hasDesktopBrowserTracking = Boolean(window.desktopTracker);

  const tabs = [
    { id: 'profile', name: 'Profile', icon: User },
    ...(canViewSettings ? [{ id: 'organization', name: 'Organization', icon: Building }] : []),
    { id: 'notifications', name: 'Notifications', icon: Bell },
    { id: 'security', name: 'Security', icon: Lock },
    { id: 'help', name: 'Help', icon: LifeBuoy },
    ...(canManageSettings ? [{ id: 'integrations', name: 'Integrations', icon: Link2 }] : []),
    ...(canManageSettings ? [{ id: 'custom-fields', name: 'Custom Fields', icon: FileSpreadsheet }] : []),
    { id: 'billing', name: 'Billing', icon: CreditCard },
    ...(hasDesktopBrowserTracking ? [{ id: 'browser-tracking', name: 'Browser Tracking', icon: Link2 }] : []),
    ...(canManageProductivity ? [{ id: 'productivity', name: 'Productivity', icon: Briefcase }] : []),
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
    setOrgTimezone(resolveTimeZone((organization?.settings as any)?.timezone));
    setLeaveCategories(readLeaveCategories(organization));
  }, [organization]);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      setError('');
      try {
        const [meResult, billingResult] = await Promise.allSettled([
          settingsApi.me(),
          settingsApi.billing(),
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
          setOrgTimezone(resolveTimeZone((fetchedOrg?.settings as any)?.timezone));
          setLeaveCategories(readLeaveCategories(fetchedOrg));
          setTimezone(resolveTimeZone(settings.timezone || DEFAULT_APP_TIMEZONE));
          setNotifyEmail(notifications.email ?? true);
          setNotifyInApp(notifications.in_app ?? true);
          setNotifyDesktopPush(notifications.desktop_push ?? true);
          setNotifyChatMessages(notifications.chat_messages ?? true);
          setNotifyWeekly(notifications.weekly_summary ?? true);
          setNotifyProject(notifications.project_updates ?? true);
          setNotifyTask(notifications.task_assignments ?? true);

          // Populate personal details from employee_profile if available
          const employeeProfile = payload.employee_profile;
          if (employeeProfile) {
            setPersonalDetailsForm({
              first_name: employeeProfile.first_name || '',
              last_name: employeeProfile.last_name || '',
              gender: employeeProfile.gender || '',
              date_of_birth: String(employeeProfile.date_of_birth || '').slice(0, 10),
              phone: employeeProfile.phone || '',
              personal_email: employeeProfile.personal_email || '',
              address_line: employeeProfile.address_line || '',
              city: employeeProfile.city || '',
              state: employeeProfile.state || '',
              postal_code: employeeProfile.postal_code || '',
              emergency_contact_name: employeeProfile.emergency_contact_name || '',
              emergency_contact_number: employeeProfile.emergency_contact_number || '',
              emergency_contact_relationship: employeeProfile.emergency_contact_relationship || '',
            });
          }
        } else {
          setCanManageOrg(Boolean(hasAdminAccess(user) && !isEmployee));
        }

        if (billingResult.status === 'fulfilled') {
          setBillingPlan((billingResult.value.data as any)?.plan || null);
        } else {
          setBillingPlan(null);
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

  useEffect(() => {
    const currentUserId = Number(user?.id || 0);
    if (!currentUserId) {
      setPersonalDetailsForm(createEmptyPersonalDetailsForm());
      setIsLoadingPersonalDetails(false);
      return;
    }

    const loadPersonalDetails = async () => {
      setIsLoadingPersonalDetails(true);
      try {
        const response = await employeeWorkspaceApi.getWorkspace(currentUserId);
        const about = (response.data as any)?.about || {};
        // Merge API data with existing form data (only update non-empty values)
        setPersonalDetailsForm((prev) => ({
          first_name: about.first_name ?? prev.first_name ?? '',
          last_name: about.last_name ?? prev.last_name ?? '',
          gender: about.gender ?? prev.gender ?? '',
          date_of_birth: about.date_of_birth ? String(about.date_of_birth).slice(0, 10) : (prev.date_of_birth ?? ''),
          phone: about.phone ?? prev.phone ?? '',
          personal_email: about.personal_email ?? prev.personal_email ?? '',
          address_line: about.address_line ?? prev.address_line ?? '',
          city: about.city ?? prev.city ?? '',
          state: about.state ?? prev.state ?? '',
          postal_code: about.postal_code ?? prev.postal_code ?? '',
          emergency_contact_name: about.emergency_contact_name ?? prev.emergency_contact_name ?? '',
          emergency_contact_number: about.emergency_contact_number ?? prev.emergency_contact_number ?? '',
          emergency_contact_relationship: about.emergency_contact_relationship ?? prev.emergency_contact_relationship ?? '',
        }));
      } catch {
        // Keep existing form data on error instead of resetting to empty
      } finally {
        setIsLoadingPersonalDetails(false);
      }
    };

    void loadPersonalDetails();
  }, [user?.id]);

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

  const validatePersonalDetails = (): { valid: boolean; errors: Record<string, string[]> } => {
    const errors: Record<string, string[]> = {};
    
    // Validate email format
    if (personalDetailsForm.personal_email && personalDetailsForm.personal_email.trim()) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(personalDetailsForm.personal_email)) {
        errors.personal_email = ['Please enter a valid email address.'];
      }
    }
    
    // Validate phone numbers (only digits, spaces, dashes, and + allowed)
    const phoneFields = ['phone', 'emergency_contact_number'];
    phoneFields.forEach((field) => {
      const value = personalDetailsForm[field as keyof PersonalDetailsForm];
      if (value && value.trim()) {
        const phoneRegex = /^[0-9\s\-+]+$/;
        if (!phoneRegex.test(value)) {
          errors[field] = ['Phone number should only contain digits, spaces, dashes, or + sign.'];
        }
      }
    });
    
    return { valid: Object.keys(errors).length === 0, errors };
  };

  const saveProfile = async () => {
    setError('');
    setMessage('');
    setFieldErrors({});
    
    // Client-side validation
    const validation = validatePersonalDetails();
    if (!validation.valid) {
      setFieldErrors(validation.errors);
      setError('Please fix the validation errors below.');
      return;
    }
    
    try {
      const name = profileName.trim();
      const email = profileEmail.trim();
      const avatar = profileAvatar.trim() || null;
      const currentUserId = Number(user?.id || 0);
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

      const results = await Promise.allSettled([
        settingsApi.updateProfile(payload),
        currentUserId > 0
          ? employeeWorkspaceApi.updateProfile(currentUserId, personalDetailsForm)
          : Promise.resolve(null),
        settingsApi.updatePreferences({ timezone }),
      ]);

      const allFieldErrors: Record<string, string[]> = {};
      let firstErrorMessage = '';
      let hasErrors = false;

      for (const result of results) {
        if (result.status === 'rejected') {
          hasErrors = true;
          const err = result.reason;
          const apiErrors = err?.response?.data?.errors;
          const msg = err?.response?.data?.message;
          if (apiErrors && typeof apiErrors === 'object') {
            for (const [field, msgs] of Object.entries(apiErrors)) {
              allFieldErrors[field] = [...(allFieldErrors[field] || []), ...(msgs as string[])];
            }
          }
          if (!firstErrorMessage && msg) {
            firstErrorMessage = msg;
          }
        }
      }

      if (hasErrors) {
        if (Object.keys(allFieldErrors).length > 0) {
          setFieldErrors(allFieldErrors);
        }
        setError(firstErrorMessage || 'The given data was invalid.');
        setTimeout(() => {
          const firstKey = Object.keys(allFieldErrors)[0];
          if (firstKey) {
            const el = document.querySelector(`[data-field="${firstKey}"]`);
            el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          } else {
            personalDetailsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }, 100);
        return;
      }

      const res = (results[0] as PromiseFulfilledResult<any>)?.value;
      const updated = (res?.data as any)?.user;
      if (updated) {
        updateUser(updated);
        setProfileAvatar(resolveMediaUrl(updated.avatar || ''));
        setProfileAvatarPreview(resolveMediaUrl(updated.avatar || ''));
      }
      setProfileAvatarFile(null);

      // Update personal details form with saved values from the second API call
      const personalDetailsResult = (results[1] as PromiseFulfilledResult<any>)?.value;
      const savedProfile = personalDetailsResult?.data;
      if (savedProfile) {
        setPersonalDetailsForm({
          first_name: savedProfile.first_name || '',
          last_name: savedProfile.last_name || '',
          gender: savedProfile.gender || '',
          date_of_birth: String(savedProfile.date_of_birth || '').slice(0, 10),
          phone: savedProfile.phone || '',
          personal_email: savedProfile.personal_email || '',
          address_line: savedProfile.address_line || '',
          city: savedProfile.city || '',
          state: savedProfile.state || '',
          postal_code: savedProfile.postal_code || '',
          emergency_contact_name: savedProfile.emergency_contact_name || '',
          emergency_contact_number: savedProfile.emergency_contact_number || '',
          emergency_contact_relationship: savedProfile.emergency_contact_relationship || '',
        });
      }

      setMessage(
        (res?.data as any)?.message ||
        'Profile updated'
      );
    } catch (e: any) {
      const apiErrors = e?.response?.data?.errors;
      if (apiErrors) {
        setFieldErrors(apiErrors);
      }
      setError(e?.response?.data?.message || 'Failed to update profile');
    }
  };

  const saveOrganization = async () => {
    setError('');
    setMessage('');
    try {
      const name = orgName.trim();
      const slug = orgSlug.trim();
      const normalizedLeaveCategories = leaveCategories
        .map((category) => ({
          code: category.code.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_\-]/g, ''),
          name: category.name.trim(),
          annual_quota: Number(category.annual_quota || 0),
        }))
        .filter((category) => category.code && category.name && Number.isFinite(category.annual_quota) && category.annual_quota >= 0)
        .slice(0, 15);

      if (isStrictAdminUser && normalizedLeaveCategories.length === 0) {
        setError('Please configure at least one paid leave category.');
        return;
      }

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
            formData.append('timezone', orgTimezone);
            if (isStrictAdminUser) {
              formData.append('leave_categories_json', JSON.stringify(normalizedLeaveCategories));
            }
            formData.append('logo_file', orgLogoFile);
            return formData;
          })()
        : {
            name,
            slug,
            office_start_time: officeStartTime || null,
            late_after_time: lateAfterTime || null,
            timezone: orgTimezone,
            ...(isStrictAdminUser ? { leave_categories: normalizedLeaveCategories } : {}),
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
      const apiErrors = e?.response?.data?.errors;
      if (apiErrors) {
        setFieldErrors(apiErrors);
      }
      setError(e?.response?.data?.message || 'Failed to update organization');
    }
  };

  const deleteOrganization = async () => {
    const expectedName = orgName || organization?.name || '';
    if (!expectedName || deleteConfirmText !== expectedName) {
      setError('Organization name does not match. Please type the exact name to confirm.');
      return;
    }

    if (!organization?.id) {
      setError('Organization ID is missing. Please refresh the page and try again.');
      return;
    }

    setIsDeletingOrg(true);
    setError('');
    try {
      await organizationApi.delete(organization.id);
      localStorage.clear();
      window.location.href = '/';
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Failed to delete organization');
      setIsDeletingOrg(false);
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

  const updateLeaveCategory = (index: number, updates: Partial<LeaveCategorySetting>) => {
    setLeaveCategories((current) => current.map((row, rowIndex) => (
      rowIndex === index ? { ...row, ...updates } : row
    )));
  };

  const addLeaveCategory = () => {
    setLeaveCategories((current) => {
      const fallbackCode = `other_${current.length + 1}`;
      return [...current, { code: fallbackCode, name: 'Other Leave', annual_quota: '0' }];
    });
  };

  const removeLeaveCategory = (index: number) => {
    setLeaveCategories((current) => {
      const next = current.filter((_, rowIndex) => rowIndex !== index);
      return next.length ? next : DEFAULT_LEAVE_CATEGORIES;
    });
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
      const apiErrors = e?.response?.data?.errors;
      if (apiErrors) {
        setFieldErrors(apiErrors);
      }
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
      const apiErrors = e?.response?.data?.errors;
      if (apiErrors) {
        setFieldErrors(apiErrors);
      }
      setError(e?.response?.data?.message || 'Failed to update password');
    }
  };

  const loadProductivityHistory = async (p?: number) => {
    setProdLoading(true);
    setError('');
    try {
      const res = await productivityClassificationApi.history({
        search: prodSearch || undefined,
        classification: prodFilter || undefined,
        days: prodDays,
        page: p ?? prodPage,
        per_page: 25,
      });
      setProdItems(res.data.data || []);
      setProdMeta(res.data.meta || {});
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Failed to load productivity history');
    } finally {
      setProdLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'productivity') {
      loadProductivityHistory();
    }
  }, [activeTab, prodFilter, prodDays]);

  useEffect(() => {
    if (activeTab === 'productivity' && prodSearch === '') {
      loadProductivityHistory();
    }
  }, [prodPage]);

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
                    <StatusBadge tone="info">{resolveUserRoleLabel(user)}</StatusBadge>
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-200 pt-5" ref={personalDetailsRef}>
                <h3 className="text-base font-semibold text-slate-900">Personal Details</h3>
                <p className="mt-1 text-sm text-slate-500">Add or update your personal information here anytime, even if you skipped details earlier.</p>

                {isLoadingPersonalDetails ? (
                  <p className="mt-3 text-sm text-slate-500">Loading your personal details...</p>
                ) : (
                  <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {Object.keys(personalDetailsForm).map((key) => (
                      <div key={key} data-field={key}>
                        <FieldLabel>{labelize(key)}</FieldLabel>
                        {key === 'gender' ? (
                          <SelectInput
                            value={personalDetailsForm[key as keyof PersonalDetailsForm]}
                            onChange={(event) => setPersonalDetailsForm((current) => ({ ...current, [key]: event.target.value }))}
                          >
                            <option value="">Select gender</option>
                            <option value="male">Male</option>
                            <option value="female">Female</option>
                            <option value="other">Other</option>
                            <option value="prefer_not_to_say">Prefer not to say</option>
                          </SelectInput>
                        ) : key.includes('phone') || key.includes('number') ? (
                          <TextInput
                            type="tel"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            value={personalDetailsForm[key as keyof PersonalDetailsForm]}
                            onChange={(event) => {
                              // Only allow numbers, spaces, dashes, and plus sign
                              const value = event.target.value.replace(/[^0-9\s\-+]/g, '');
                              setPersonalDetailsForm((current) => ({ ...current, [key]: value }));
                            }}
                          />
                        ) : key.includes('email') ? (
                          <TextInput
                            type="email"
                            value={personalDetailsForm[key as keyof PersonalDetailsForm]}
                            onChange={(event) => setPersonalDetailsForm((current) => ({ ...current, [key]: event.target.value }))}
                          />
                        ) : key.includes('date') ? (
                          <TextInput
                            type="date"
                            value={personalDetailsForm[key as keyof PersonalDetailsForm]}
                            onChange={(event) => setPersonalDetailsForm((current) => ({ ...current, [key]: event.target.value }))}
                          />
                        ) : (
                          <TextInput
                            type="text"
                            value={personalDetailsForm[key as keyof PersonalDetailsForm]}
                            onChange={(event) => setPersonalDetailsForm((current) => ({ ...current, [key]: event.target.value }))}
                          />
                        )}
                        {fieldErrors[key]?.map((msg) => (
                          <p key={msg} className="mt-1 text-sm text-red-600">{msg}</p>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="border-t border-slate-200 pt-5">
                <h3 className="text-base font-semibold text-slate-900">Preferences</h3>
                <p className="mt-1 text-sm text-slate-500">Your timezone settings for attendance tracking and notifications.</p>
                <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <FieldLabel>Timezone</FieldLabel>
                    <SelectInput value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                      {Array.from(new Set([...COMMON_TIMEZONES, orgTimezone])).map((tz) => (
                        <option key={tz} value={tz}>{tz}</option>
                      ))}
                    </SelectInput>
                  </div>
                </div>
              </div>

              <Button onClick={saveProfile} disabled={isLoadingPersonalDetails || !user?.id}>Save Changes</Button>
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
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <FieldLabel>Timezone</FieldLabel>
                  <SelectInput
                    value={orgTimezone}
                    onChange={(e) => setOrgTimezone(e.target.value)}
                    disabled={!canEditTimezone}
                    className={!canEditTimezone ? 'bg-slate-50 text-slate-500' : ''}
                  >
                    {COMMON_TIMEZONES.map((tz) => (
                      <option key={tz} value={tz}>{tz}</option>
                    ))}
                  </SelectInput>
                  <p className="mt-2 text-sm text-gray-500">Organization-wide timezone used for attendance and reports. Managers can also update this.</p>
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <FieldLabel>Leave Policy (Annual)</FieldLabel>
                    <p className="mt-1 text-sm text-gray-500">Set yearly leave quotas per category. Unpaid leave is tracked automatically when quota is exhausted.</p>
                  </div>
                  {isStrictAdminUser ? (
                    <Button type="button" size="sm" variant="secondary" onClick={addLeaveCategory}>
                      Add Leave Type
                    </Button>
                  ) : null}
                </div>
                <div className="mt-4 space-y-3">
                  {leaveCategories.map((category, index) => (
                    <div key={`${category.code || 'leave'}-${index}`} className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-white p-3 md:grid-cols-[1fr_2fr_1fr_auto]">
                      <div>
                        <FieldLabel>Code</FieldLabel>
                        <TextInput
                          value={category.code}
                          onChange={(event) => updateLeaveCategory(index, { code: event.target.value })}
                          disabled={!isOrgEditable || !isStrictAdminUser}
                          className={!isOrgEditable || !isStrictAdminUser ? 'bg-slate-50 text-slate-500' : ''}
                        />
                      </div>
                      <div>
                        <FieldLabel>Name</FieldLabel>
                        <TextInput
                          value={category.name}
                          onChange={(event) => updateLeaveCategory(index, { name: event.target.value })}
                          disabled={!isOrgEditable || !isStrictAdminUser}
                          className={!isOrgEditable || !isStrictAdminUser ? 'bg-slate-50 text-slate-500' : ''}
                        />
                      </div>
                      <div>
                        <FieldLabel>Quota</FieldLabel>
                        <TextInput
                          type="number"
                          min="0"
                          step="0.5"
                          value={category.annual_quota}
                          onChange={(event) => updateLeaveCategory(index, { annual_quota: event.target.value })}
                          disabled={!isOrgEditable || !isStrictAdminUser}
                          className={!isOrgEditable || !isStrictAdminUser ? 'bg-slate-50 text-slate-500' : ''}
                        />
                      </div>
                      <div className="flex items-end">
                        {isStrictAdminUser ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="danger"
                            onClick={() => removeLeaveCategory(index)}
                            disabled={!isOrgEditable}
                          >
                            Remove
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
                {!isStrictAdminUser ? (
                  <p className="mt-3 text-xs text-slate-500">Only admin can edit leave policy categories.</p>
                ) : null}
              </div>
              {organization?.id ? (
                <>
                  {isOrgEditable ? (
                    <Button onClick={saveOrganization}>Save Changes</Button>
                  ) : (
                    <p className="text-sm text-gray-500">Only admin/manager can update organization settings.</p>
                  )}

                  {isStrictAdminUser && (
                    <div className="mt-8 pt-8 border-t border-red-200">
                      <h3 className="text-lg font-semibold text-red-700 flex items-center gap-2">
                        <AlertTriangle className="h-5 w-5" />
                        Danger Zone
                      </h3>
                      <p className="mt-2 text-sm text-gray-600">
                        Once you delete your organization, there is no going back. This will permanently delete your organization, all users, projects, tasks, time entries, and all associated data.
                      </p>

                      {!showDeleteConfirm ? (
                        <Button
                          variant="danger"
                          className="mt-4"
                          onClick={() => setShowDeleteConfirm(true)}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete Organization
                        </Button>
                      ) : (
                        <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                          <p className="text-sm font-medium text-red-800 mb-3">
                            Type <span className="font-bold">"{orgName || organization?.name || 'your organization name'}"</span> to confirm deletion:
                          </p>
                          <div className="flex gap-3">
                            <input
                              type="text"
                              value={deleteConfirmText}
                              onChange={(e) => setDeleteConfirmText(e.target.value)}
                              placeholder="Type organization name"
                              className="flex-1 px-3 py-2 border border-red-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                            />
                            <Button
                              variant="danger"
                              onClick={deleteOrganization}
                              disabled={isDeletingOrg || deleteConfirmText !== (orgName || organization?.name || '')}
                            >
                              {isDeletingOrg ? 'Deleting...' : 'Confirm Delete'}
                            </Button>
                            <Button
                              variant="secondary"
                              onClick={() => {
                                setShowDeleteConfirm(false);
                                setDeleteConfirmText('');
                                setError('');
                              }}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="mt-8 rounded-2xl border border-amber-200 bg-amber-50/85 px-6 py-6">
                  <h3 className="text-base font-semibold text-amber-900">No Organization Found</h3>
                  <p className="mt-2 text-sm text-amber-700 leading-6">
                    Your account is not linked to an organization. Create a workspace to start using CareVance.
                  </p>
                  <button
                    type="button"
                    onClick={() => navigate('/signup-owner')}
                    className="mt-4 inline-flex items-center gap-2 rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
                  >
                    Create Workspace
                  </button>
                </div>
              )}
            </div>
          )}

          {activeTab === 'notifications' && (
            <div className="space-y-6">
              <h2 className="text-lg font-semibold text-gray-900">Notification Preferences</h2>
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
              <Link to="/settings/billing" className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800">
                Manage Subscription <ArrowRight className="h-4 w-4" />
              </Link>
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
              <DesktopBrowserTrackingPanel />
            </div>
          )}

          {activeTab === 'productivity' && hasStrictAdminAccess(user) && (
            <div className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Productivity Classification</h2>
                  <p className="mt-1 text-sm text-slate-500">Review visited domains and apps, then classify them as productive, unproductive, or neutral.</p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1 sm:max-w-xs">
                  <TextInput type="text" placeholder="Search domains or apps..." value={prodSearch} onChange={(e) => { setProdSearch(e.target.value); setProdPage(1); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); loadProductivityHistory(); } }} />
                </div>
                <SelectInput value={prodFilter} onChange={(e) => { setProdFilter(e.target.value); setProdPage(1); }}>
                  <option value="">All classifications</option>
                  <option value="productive">Productive</option>
                  <option value="unproductive">Unproductive</option>
                  <option value="neutral">Neutral</option>
                </SelectInput>
                <SelectInput value={prodDays} onChange={(e) => { setProdDays(Number(e.target.value)); setProdPage(1); }}>
                  <option value={1}>Today</option>
                  <option value={3}>Last 3 days</option>
                  <option value={7}>Last 7 days</option>
                  <option value={14}>Last 14 days</option>
                  <option value={30}>Last 30 days</option>
                  <option value={90}>Last 90 days</option>
                </SelectInput>
                <Button variant="secondary" size="sm" onClick={() => loadProductivityHistory()}>Search</Button>
                <div className="text-xs text-slate-400">
                  {prodMeta?.total != null ? `${prodMeta.total} item${prodMeta.total === 1 ? '' : 's'}` : ''}
                  {prodMeta?.classifications ? ` · ${prodMeta.classifications.productive}P / ${prodMeta.classifications.unproductive}U / ${prodMeta.classifications.neutral}N` : ''}
                </div>
              </div>

              {prodSelected.size > 0 && (
                <div className="flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
                  <span className="text-sm font-medium text-blue-800">{prodSelected.size} selected</span>
                  <SelectInput value={prodBulkClassification} onChange={(e) => setProdBulkClassification(e.target.value)}>
                    <option value="productive">Productive</option>
                    <option value="unproductive">Unproductive</option>
                    <option value="neutral">Neutral</option>
                  </SelectInput>
                  <Button size="sm" disabled={prodSaving} onClick={async () => {
                    setProdSaving(true);
                    setError('');
                    try {
                      const items = prodItems.filter((item) => prodSelected.has(item.id)).map((item) => ({ target_type: item.target_type, target_value: item.target_value }));
                      await productivityClassificationApi.batchUpdate({ classification: prodBulkClassification, items });
                      setProdSelected(new Set());
                      await loadProductivityHistory();
                      setMessage(`${items.length} item(s) updated to ${prodBulkClassification}`);
                    } catch (e: any) {
                      setError(e?.response?.data?.message || 'Failed to update');
                    } finally {
                      setProdSaving(false);
                    }
                  }}>Apply</Button>
                  <Button variant="secondary" size="sm" onClick={() => setProdSelected(new Set())}>Clear</Button>
                </div>
              )}

              <div className="overflow-hidden rounded-lg border border-slate-200">
                {prodLoading ? (
                  <div className="p-8 text-center text-sm text-slate-400">Loading...</div>
                ) : prodItems.length === 0 ? (
                  <div className="p-8 text-center text-sm text-slate-400">No items found for the selected period.</div>
                ) : (
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="w-10 px-3 py-3">
                          <input type="checkbox" className="rounded border-slate-300" checked={prodSelected.size === prodItems.length && prodItems.length > 0} onChange={() => {
                            if (prodSelected.size === prodItems.length) {
                              setProdSelected(new Set());
                            } else {
                              setProdSelected(new Set(prodItems.map((i) => i.id)));
                            }
                          }} />
                        </th>
                        <th className="px-3 py-3 font-medium">Name</th>
                        <th className="px-3 py-3 font-medium">Type</th>
                        <th className="px-3 py-3 font-medium">Classification</th>
                        <th className="px-3 py-3 font-medium">Users</th>
                        <th className="px-3 py-3" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {prodItems.map((item) => (
                        <tr key={item.id} className={prodSelected.has(item.id) ? 'bg-blue-50' : 'hover:bg-slate-50'}>
                          <td className="px-3 py-2.5">
                            <input type="checkbox" className="rounded border-slate-300" checked={prodSelected.has(item.id)} onChange={() => {
                              const next = new Set(prodSelected);
                              if (next.has(item.id)) { next.delete(item.id); } else { next.add(item.id); }
                              setProdSelected(next);
                            }} />
                          </td>
                          <td className="max-w-[200px] truncate px-3 py-2.5 font-medium text-slate-900" title={item.display_label}>{item.display_label}</td>
                          <td className="px-3 py-2.5 text-slate-500">
                            <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${item.target_type === 'domain' ? 'bg-sky-50 text-sky-700' : 'bg-purple-50 text-purple-700'}`}>{item.target_type}</span>
                          </td>
                          <td className="px-3 py-2.5">
                            <span className={`rounded px-2 py-0.5 text-xs font-semibold ${item.current_classification === 'productive' ? 'bg-emerald-50 text-emerald-700' : item.current_classification === 'unproductive' ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-600'}`}>
                              {item.current_classification}
                            </span>
                            {item.override_classification ? null : null}
                          </td>
                          <td className="px-3 py-2.5 text-slate-600">{item.user_count}</td>
                          <td className="px-3 py-2.5">
                            <SelectInput value={item.override_classification || ''} onChange={async (e) => {
                              const val = e.target.value;
                              if (!val) return;
                              try {
                                await productivityClassificationApi.create({ target_type: item.target_type, target_value: item.target_value, classification: val });
                                setMessage(`${item.target_value} classified as ${val}`);
                                await loadProductivityHistory();
                              } catch (err: any) {
                                setError(err?.response?.data?.message || 'Failed to update');
                              }
                            }}>
                              <option value="">Change...</option>
                              <option value="productive">Productive</option>
                              <option value="unproductive">Unproductive</option>
                              <option value="neutral">Neutral</option>
                            </SelectInput>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {prodMeta.total_pages > 1 && (
                <div className="flex items-center justify-center gap-2">
                  <Button variant="secondary" size="sm" disabled={prodPage <= 1} onClick={() => setProdPage((p) => Math.max(1, p - 1))}>Previous</Button>
                  <span className="text-xs text-slate-500">Page {prodMeta.page} of {prodMeta.total_pages}</span>
                  <Button variant="secondary" size="sm" disabled={prodPage >= (prodMeta.total_pages || 1)} onClick={() => setProdPage((p) => p + 1)}>Next</Button>
                </div>
              )}
            </div>
          )}

        </SurfaceCard>
      </div>
    </div>
  );
}
