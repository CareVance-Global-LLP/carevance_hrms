import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { hasAdminAccess, hasStrictAdminAccess, isEmployeeUser, canAccess } from '@/lib/permissions';
import { resolveMediaUrl } from '@/lib/mediaUrl';
import { DEFAULT_APP_TIMEZONE, resolveTimeZone } from '@/lib/timezones';
import { validateIdleThresholds } from './idlePolicy';
import { readIdleResolutionPolicy, readUrlDetailLevel, type UrlDetailLevel } from '@/lib/trackerPolicy';
import { employeeWorkspaceApi, settingsApi, supportApi, organizationApi } from '@/services/api';
import type { BillingSnapshot } from '@/types';
import {
  DEFAULT_LEAVE_CATEGORIES,
  DEFAULT_NOTIFICATIONS,
  createEmptyCompanyProfileForm,
  createEmptyPersonalDetailsForm,
  type CompanyProfileForm,
  type LeaveCategorySetting,
  type NotificationKey,
  type NotificationState,
  type PersonalDetailsForm,
  type SettingsTabId,
} from './types';
import { SETTINGS_TABS } from './settingsTabs';
import { SETTINGS_FALLBACK_PANE, requestedPaneFromLocation, resolveInitialPane } from './paneDeepLink';

export const helpIssueCategories = [
  { value: 'bug', label: 'Something is broken' },
  { value: 'ui', label: 'Looks wrong' },
  { value: 'performance', label: 'Too slow' },
  { value: 'billing', label: 'Billing' },
  { value: 'account', label: 'Cannot get in' },
  { value: 'other', label: 'Something else' },
] as const;

export type HelpIssueCategory = (typeof helpIssueCategories)[number]['value'];

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

export const extractOrganizationLogoUrl = (org: any): string => {
  const logoValue = org?.settings?.branding?.logo_url;
  return resolveMediaUrl(logoValue);
};

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

      return { code, name, annual_quota: String(quota) };
    })
    .filter(Boolean) as LeaveCategorySetting[];

  return normalized.length ? normalized : DEFAULT_LEAVE_CATEGORIES;
};

const readNotifications = (raw: any): NotificationState => ({
  email: raw?.email ?? true,
  in_app: raw?.in_app ?? true,
  desktop_push: raw?.desktop_push ?? true,
  chat_messages: raw?.chat_messages ?? true,
  weekly_summary: raw?.weekly_summary ?? true,
  project_updates: raw?.project_updates ?? true,
  task_assignments: raw?.task_assignments ?? true,
});

/** Snapshot of everything the save dock watches on the Profile tab. */
type ProfileSnapshot = {
  name: string;
  email: string;
  timezone: string;
  personal: PersonalDetailsForm;
};

/** Snapshot of everything the save dock watches on the Organization tab. */
type OrganizationSnapshot = {
  name: string;
  slug: string;
  officeStartTime: string;
  lateAfterTime: string;
  monitoringInterval: string;
  idleTrackSeconds: string;
  idleAutoStopSeconds: string;
  lockAutoStopSeconds: string;
  idleResolutionPolicy: string;
  urlDetailLevel: UrlDetailLevel;
  timezone: string;
  leaveCategories: LeaveCategorySetting[];
  companyProfile: CompanyProfileForm;
};

/**
 * Counts how many watched values differ from the snapshot taken at load (or at
 * the last successful save). The dock shows this number, so it has to count
 * fields a person would recognise as "a change" — one edited input is one
 * change, and the whole leave-policy list collapses to one.
 */
const countProfileChanges = (base: ProfileSnapshot, current: ProfileSnapshot, hasAvatarFile: boolean): number => {
  let count = 0;
  if (base.name !== current.name) count += 1;
  if (base.email !== current.email) count += 1;
  if (base.timezone !== current.timezone) count += 1;
  if (hasAvatarFile) count += 1;
  (Object.keys(current.personal) as Array<keyof PersonalDetailsForm>).forEach((key) => {
    if (base.personal[key] !== current.personal[key]) count += 1;
  });
  return count;
};

const countOrganizationChanges = (
  base: OrganizationSnapshot,
  current: OrganizationSnapshot,
  hasLogoFile: boolean
): number => {
  let count = 0;
  if (base.name !== current.name) count += 1;
  if (base.slug !== current.slug) count += 1;
  if (base.officeStartTime !== current.officeStartTime) count += 1;
  if (base.lateAfterTime !== current.lateAfterTime) count += 1;
  if (base.monitoringInterval !== current.monitoringInterval) count += 1;
  if (base.idleTrackSeconds !== current.idleTrackSeconds) count += 1;
  if (base.idleAutoStopSeconds !== current.idleAutoStopSeconds) count += 1;
  if (base.lockAutoStopSeconds !== current.lockAutoStopSeconds) count += 1;
  if (base.idleResolutionPolicy !== current.idleResolutionPolicy) count += 1;
  if (base.urlDetailLevel !== current.urlDetailLevel) count += 1;
  if (base.timezone !== current.timezone) count += 1;
  if (JSON.stringify(base.leaveCategories) !== JSON.stringify(current.leaveCategories)) count += 1;
  // Each company-profile input counts on its own, the same as the personal
  // details above — the dock number should match what a person sees themselves
  // having typed.
  (Object.keys(current.companyProfile) as Array<keyof CompanyProfileForm>).forEach((key) => {
    if (base.companyProfile[key] !== current.companyProfile[key]) count += 1;
  });
  if (hasLogoFile) count += 1;
  return count;
};

/** Read the company profile off an organization payload, coercing nulls to ''. */
const readCompanyProfile = (organization: any): CompanyProfileForm => ({
  description: organization?.description ?? '',
  website: organization?.website ?? '',
  industry: organization?.industry ?? '',
  size: organization?.size ?? '',
  phone: organization?.phone ?? '',
  // The column is `email`; the API field is `org_email`, to keep it distinct
  // from a user's address.
  org_email: organization?.email ?? '',
  address_line: organization?.address_line ?? '',
  city: organization?.city ?? '',
  state: organization?.state ?? '',
  postal_code: organization?.postal_code ?? '',
  country: organization?.country ?? '',
});

const readIdleSeconds = (settings: any, key: string): string => {
  const raw = settings?.[key];
  return raw === null || raw === undefined || raw === '' ? '' : String(raw);
};

export function useSettingsController() {
  const { user, organization, updateUser, updateOrganization } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();

  const [activeTab, setActiveTab] = useState<SettingsTabId>(SETTINGS_FALLBACK_PANE);
  const [isLoading, setIsLoading] = useState(true);
  const hasLoadedOnce = useRef(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [canManageOrg, setCanManageOrg] = useState(false);
  const [billingSnapshot, setBillingSnapshot] = useState<BillingSnapshot | null>(null);
  const billingPlan = billingSnapshot?.plan ?? null;

  // ---- profile -------------------------------------------------------------
  const [profileName, setProfileName] = useState(user?.name || '');
  const [profileEmail, setProfileEmail] = useState(user?.email || '');
  const [profileAvatar, setProfileAvatar] = useState(user?.avatar || '');
  const [profileAvatarFile, setProfileAvatarFile] = useState<File | null>(null);
  const [profileAvatarPreview, setProfileAvatarPreview] = useState(user?.avatar || '');
  const [personalDetailsForm, setPersonalDetailsForm] = useState<PersonalDetailsForm>(createEmptyPersonalDetailsForm());
  const [isLoadingPersonalDetails, setIsLoadingPersonalDetails] = useState(false);
  const [timezone, setTimezone] = useState(DEFAULT_APP_TIMEZONE);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileBaseline, setProfileBaseline] = useState<ProfileSnapshot>({
    name: user?.name || '',
    email: user?.email || '',
    timezone: DEFAULT_APP_TIMEZONE,
    personal: createEmptyPersonalDetailsForm(),
  });

  // ---- organization --------------------------------------------------------
  const [orgName, setOrgName] = useState(organization?.name || '');
  const [orgSlug, setOrgSlug] = useState(organization?.slug || '');
  const [orgLogo, setOrgLogo] = useState(extractOrganizationLogoUrl(organization));
  const [orgLogoFile, setOrgLogoFile] = useState<File | null>(null);
  const [orgLogoPreview, setOrgLogoPreview] = useState(extractOrganizationLogoUrl(organization));
  const [officeStartTime, setOfficeStartTime] = useState('');
  const [lateAfterTime, setLateAfterTime] = useState('');
  // Organization-wide screenshot capture default. '' means "no org default",
  // in which case users fall through to the system default.
  const [orgMonitoringInterval, setOrgMonitoringInterval] = useState('');
  /*
   * Organization-wide idle policy. Same '' convention as the capture interval:
   * no org override, so users fall through to the system default. The API has
   * accepted these three since the tracker-policy block was added; until now
   * no screen sent them, so no organization could change them.
   */
  const [orgIdleTrackSeconds, setOrgIdleTrackSeconds] = useState('');
  const [orgIdleAutoStopSeconds, setOrgIdleAutoStopSeconds] = useState('');
  const [orgLockAutoStopSeconds, setOrgLockAutoStopSeconds] = useState('');
  // No '' state: prompting is the default rather than an absence, so this
  // always holds one of the three real values.
  const [orgIdleResolutionPolicy, setOrgIdleResolutionPolicy] = useState('prompt');
  const [orgUrlDetailLevel, setOrgUrlDetailLevel] = useState<UrlDetailLevel>('full');
  const [orgTimezone, setOrgTimezone] = useState(DEFAULT_APP_TIMEZONE);
  const [leaveCategories, setLeaveCategories] = useState<LeaveCategorySetting[]>(() => readLeaveCategories(organization));
  const [companyProfile, setCompanyProfile] = useState<CompanyProfileForm>(() => readCompanyProfile(organization));
  const [isSavingOrganization, setIsSavingOrganization] = useState(false);
  const [orgBaseline, setOrgBaseline] = useState<OrganizationSnapshot>({
    name: organization?.name || '',
    slug: organization?.slug || '',
    officeStartTime: '',
    lateAfterTime: '',
    monitoringInterval: '',
    idleTrackSeconds: '',
    idleAutoStopSeconds: '',
    lockAutoStopSeconds: '',
    idleResolutionPolicy: 'prompt',
    urlDetailLevel: 'full',
    timezone: DEFAULT_APP_TIMEZONE,
    leaveCategories: readLeaveCategories(organization),
    companyProfile: readCompanyProfile(organization),
  });

  const updateCompanyProfileField = useCallback((field: keyof CompanyProfileForm, value: string) => {
    setCompanyProfile((current) => ({ ...current, [field]: value }));
  }, []);

  // ---- notifications (instant save) ---------------------------------------
  const [notifications, setNotifications] = useState<NotificationState>(DEFAULT_NOTIFICATIONS);
  const [savingNotification, setSavingNotification] = useState<NotificationKey | null>(null);
  const [savedNotification, setSavedNotification] = useState<NotificationKey | null>(null);
  const savedNotificationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- security ------------------------------------------------------------
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSavingPassword, setIsSavingPassword] = useState(false);

  // ---- help ----------------------------------------------------------------
  const [helpName, setHelpName] = useState(user?.name || '');
  const [helpEmail, setHelpEmail] = useState(user?.email || '');
  const [helpIssueCategory, setHelpIssueCategory] = useState<HelpIssueCategory>('bug');
  const [helpSummary, setHelpSummary] = useState('');
  const [helpDescription, setHelpDescription] = useState('');
  const [helpAttachContext, setHelpAttachContext] = useState(true);
  const [isSubmittingHelp, setIsSubmittingHelp] = useState(false);

  // ---- danger zone ---------------------------------------------------------
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [isDeletingOrg, setIsDeletingOrg] = useState(false);

  const isEmployee = isEmployeeUser(user);
  // Use permission-based checks for custom roles support
  const canManageSettings = canAccess(user, 'settings.manage') || hasStrictAdminAccess(user);
  const canManageProductivity = canAccess(user, 'productivity.manage') || hasStrictAdminAccess(user);
  const isOrgEditable = canManageOrg && (canManageSettings || hasStrictAdminAccess(user));
  const canEditTimezone = canManageOrg && (hasAdminAccess(user) || canManageSettings || hasStrictAdminAccess(user));
  const isStrictAdminUser = hasStrictAdminAccess(user);
  const canEditEmail = hasStrictAdminAccess(user);
  /*
   * Rostering is a line-management job, not an owner's, so this mirrors the
   * server's own gate exactly — ShiftController::canManage() reads
   * settings.manage first and falls back to hierarchy < 100. Gating the tab on
   * strict admin instead would hide a screen the API would happily serve to a
   * manager, which is the mismatch that makes people think a feature is broken.
   */
  const canManageShifts = canManageSettings || hasAdminAccess(user);

  const visibleTabs = useMemo(() => {
    /*
     * 'privacy' is in the base set on purpose. What is collected about you at
     * work, why, and how to withdraw is the employee's own information — a
     * disclosure only administrators can reach is not a disclosure, and the
     * DPDP notice-and-consent obligation is owed to the person being
     * monitored, not to the person configuring it.
     */
    const allowed = new Set<SettingsTabId>([
      'profile',
      'notifications',
      'appearance',
      'security',
      'privacy',
      'help',
    ]);
    if (isStrictAdminUser) {
      allowed.add('organization');
      allowed.add('billing');
      if (import.meta.env.DEV) {
        allowed.add('development');
      }
    }
    if (canManageSettings) {
      allowed.add('integrations');
      allowed.add('custom-fields');
    }
    if (canManageProductivity) {
      allowed.add('productivity');
    }
    if (canManageShifts) {
      allowed.add('shifts');
    }
    return SETTINGS_TABS.filter((tab) => allowed.has(tab.id));
  }, [canManageProductivity, canManageSettings, canManageShifts, isStrictAdminUser]);

  const allowedTabIds = useMemo(() => new Set(visibleTabs.map((tab) => tab.id)), [visibleTabs]);

  // ---- dirty tracking ------------------------------------------------------
  const profileDirtyCount = useMemo(
    () =>
      countProfileChanges(
        profileBaseline,
        { name: profileName, email: profileEmail, timezone, personal: personalDetailsForm },
        Boolean(profileAvatarFile)
      ),
    [profileBaseline, profileName, profileEmail, timezone, personalDetailsForm, profileAvatarFile]
  );

  const organizationDirtyCount = useMemo(
    () =>
      countOrganizationChanges(
        orgBaseline,
        {
          name: orgName,
          slug: orgSlug,
          officeStartTime,
          lateAfterTime,
          monitoringInterval: orgMonitoringInterval,
          idleTrackSeconds: orgIdleTrackSeconds,
          idleAutoStopSeconds: orgIdleAutoStopSeconds,
          lockAutoStopSeconds: orgLockAutoStopSeconds,
          idleResolutionPolicy: orgIdleResolutionPolicy,
          urlDetailLevel: orgUrlDetailLevel,
          timezone: orgTimezone,
          leaveCategories,
          companyProfile,
        },
        Boolean(orgLogoFile)
      ),
    [orgBaseline, orgName, orgSlug, officeStartTime, lateAfterTime, orgMonitoringInterval, orgIdleTrackSeconds, orgIdleAutoStopSeconds, orgLockAutoStopSeconds, orgIdleResolutionPolicy, orgUrlDetailLevel, orgTimezone, leaveCategories, companyProfile, orgLogoFile]
  );

  const dirtyCount = activeTab === 'profile'
    ? profileDirtyCount
    : activeTab === 'organization'
      ? organizationDirtyCount
      : 0;

  // ---- routing -------------------------------------------------------------
  /*
   * Reading the URL and judging what it named are two steps (paneDeepLink.ts),
   * composed here: requestedPaneFromLocation says what was asked for,
   * resolveInitialPane says what this person is allowed to be shown.
   *
   * Re-runs on allowedTabIds too, because the set is thinner until the user has
   * hydrated. A link to a workspace pane would otherwise be judged against an
   * empty-handed permission set and bounced to Profile for good.
   */
  useEffect(() => {
    const requestedPane = requestedPaneFromLocation(location.pathname, location.search);
    if (requestedPane === null) {
      // Nothing asked for, so leave whatever is on screen — this effect also
      // runs after a tab click, which clears the query string. Only a pane the
      // person may no longer see has to move.
      if (!allowedTabIds.has(activeTab)) {
        setActiveTab(SETTINGS_FALLBACK_PANE);
      }
      return;
    }

    const resolvedPane = resolveInitialPane(requestedPane, allowedTabIds);
    if (activeTab !== resolvedPane) {
      setActiveTab(resolvedPane);
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
    const nextOfficeStart = toTimeInputValue((organization?.settings as any)?.attendance?.office_start_time);
    const nextLateAfter = toTimeInputValue((organization?.settings as any)?.attendance?.late_after_time);
    const nextInterval = String((organization?.settings as any)?.monitoring?.interval_minutes ?? '');
    const orgSettings = organization?.settings as any;
    const nextIdleTrack = readIdleSeconds(orgSettings, 'idle_track_threshold_seconds');
    const nextIdleAutoStop = readIdleSeconds(orgSettings, 'idle_auto_stop_threshold_seconds');
    const nextLockAutoStop = readIdleSeconds(orgSettings, 'lock_auto_stop_threshold_seconds');
    const nextIdlePolicy = readIdleResolutionPolicy(orgSettings?.idle_resolution_policy);
    setOrgUrlDetailLevel(readUrlDetailLevel(orgSettings?.url_detail_level));
    const nextTimezone = resolveTimeZone((organization?.settings as any)?.timezone);
    const nextLeave = readLeaveCategories(organization);
    const nextCompanyProfile = readCompanyProfile(organization);
    setOfficeStartTime(nextOfficeStart);
    setLateAfterTime(nextLateAfter);
    setOrgMonitoringInterval(nextInterval);
    setOrgIdleTrackSeconds(nextIdleTrack);
    setOrgIdleAutoStopSeconds(nextIdleAutoStop);
    setOrgLockAutoStopSeconds(nextLockAutoStop);
    setOrgIdleResolutionPolicy(nextIdlePolicy);
    setOrgTimezone(nextTimezone);
    setLeaveCategories(nextLeave);
    setCompanyProfile(nextCompanyProfile);
    setOrgBaseline({
      name: organization?.name || '',
      slug: organization?.slug || '',
      officeStartTime: nextOfficeStart,
      lateAfterTime: nextLateAfter,
      monitoringInterval: nextInterval,
      idleTrackSeconds: nextIdleTrack,
      idleAutoStopSeconds: nextIdleAutoStop,
      lockAutoStopSeconds: nextLockAutoStop,
      idleResolutionPolicy: nextIdlePolicy,
      urlDetailLevel: readUrlDetailLevel(orgSettings?.url_detail_level),
      timezone: nextTimezone,
      leaveCategories: nextLeave,
      companyProfile: nextCompanyProfile,
    });
  }, [organization]);

  useEffect(() => {
    const load = async () => {
      // Only the first load blanks the page. Later refreshes are triggered by
      // saves — including an instant-save switch — and a full-page spinner on
      // every toggle would be worse than the wait it reports.
      if (!hasLoadedOnce.current) {
        setIsLoading(true);
      }
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

          const nextOfficeStart = toTimeInputValue((fetchedOrg?.settings as any)?.attendance?.office_start_time);
          const nextLateAfter = toTimeInputValue((fetchedOrg?.settings as any)?.attendance?.late_after_time);
          const nextInterval = String((fetchedOrg?.settings as any)?.monitoring?.interval_minutes ?? '');
          const fetchedOrgSettings = fetchedOrg?.settings as any;
          const nextIdleTrack = readIdleSeconds(fetchedOrgSettings, 'idle_track_threshold_seconds');
          const nextIdleAutoStop = readIdleSeconds(fetchedOrgSettings, 'idle_auto_stop_threshold_seconds');
          const nextLockAutoStop = readIdleSeconds(fetchedOrgSettings, 'lock_auto_stop_threshold_seconds');
          const nextIdlePolicy = readIdleResolutionPolicy(fetchedOrgSettings?.idle_resolution_policy);
          setOrgUrlDetailLevel(readUrlDetailLevel(fetchedOrgSettings?.url_detail_level));
          const nextOrgTimezone = resolveTimeZone((fetchedOrg?.settings as any)?.timezone);
          const nextLeave = readLeaveCategories(fetchedOrg);
          const nextCompanyProfile = readCompanyProfile(fetchedOrg);
          const nextUserTimezone = resolveTimeZone(settings.timezone || DEFAULT_APP_TIMEZONE);

          setOfficeStartTime(nextOfficeStart);
          setLateAfterTime(nextLateAfter);
          setOrgMonitoringInterval(nextInterval);
          setOrgIdleTrackSeconds(nextIdleTrack);
          setOrgIdleAutoStopSeconds(nextIdleAutoStop);
          setOrgLockAutoStopSeconds(nextLockAutoStop);
          setOrgIdleResolutionPolicy(nextIdlePolicy);
          setOrgTimezone(nextOrgTimezone);
          setLeaveCategories(nextLeave);
          setCompanyProfile(nextCompanyProfile);
          setTimezone(nextUserTimezone);
          setNotifications(readNotifications(settings.notifications));
          setOrgBaseline({
            name: fetchedOrg?.name || '',
            slug: fetchedOrg?.slug || '',
            officeStartTime: nextOfficeStart,
            lateAfterTime: nextLateAfter,
            monitoringInterval: nextInterval,
            idleTrackSeconds: nextIdleTrack,
            idleAutoStopSeconds: nextIdleAutoStop,
            lockAutoStopSeconds: nextLockAutoStop,
            idleResolutionPolicy: nextIdlePolicy,
            urlDetailLevel: readUrlDetailLevel(fetchedOrgSettings?.url_detail_level),
            timezone: nextOrgTimezone,
            leaveCategories: nextLeave,
            companyProfile: nextCompanyProfile,
          });

          // Populate personal details from employee_profile if available
          const employeeProfile = payload.employee_profile;
          const nextPersonal = employeeProfile
            ? {
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
                blood_group: (employeeProfile as any).blood_group || '',
                permanent_address_line: (employeeProfile as any).permanent_address_line || '',
                permanent_city: (employeeProfile as any).permanent_city || '',
                permanent_state: (employeeProfile as any).permanent_state || '',
                permanent_postal_code: (employeeProfile as any).permanent_postal_code || '',
                emergency_contact_name: employeeProfile.emergency_contact_name || '',
                emergency_contact_number: employeeProfile.emergency_contact_number || '',
                emergency_contact_relationship: employeeProfile.emergency_contact_relationship || '',
              }
            : createEmptyPersonalDetailsForm();

          if (employeeProfile) {
            setPersonalDetailsForm(nextPersonal);
          }

          setProfileBaseline({
            name: fetchedUser?.name || '',
            email: fetchedUser?.email || '',
            timezone: nextUserTimezone,
            personal: nextPersonal,
          });
        } else {
          setCanManageOrg(Boolean(hasAdminAccess(user) && !isEmployee));
        }

        if (billingResult.status === 'fulfilled') {
          setBillingSnapshot((billingResult.value.data as BillingSnapshot) || null);
        } else {
          setBillingSnapshot(null);
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
        hasLoadedOnce.current = true;
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
        setPersonalDetailsForm((prev) => {
          const merged: PersonalDetailsForm = {
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
            blood_group: about.blood_group ?? prev.blood_group ?? '',
            permanent_address_line: about.permanent_address_line ?? prev.permanent_address_line ?? '',
            permanent_city: about.permanent_city ?? prev.permanent_city ?? '',
            permanent_state: about.permanent_state ?? prev.permanent_state ?? '',
            permanent_postal_code: about.permanent_postal_code ?? prev.permanent_postal_code ?? '',
            emergency_contact_name: about.emergency_contact_name ?? prev.emergency_contact_name ?? '',
            emergency_contact_number: about.emergency_contact_number ?? prev.emergency_contact_number ?? '',
            emergency_contact_relationship: about.emergency_contact_relationship ?? prev.emergency_contact_relationship ?? '',
          };
          // The dock must not light up just because the server answered, so the
          // baseline moves with the value that arrived.
          setProfileBaseline((base) => ({ ...base, personal: merged }));
          return merged;
        });
      } catch {
        // Keep existing form data on error instead of resetting to empty
      } finally {
        setIsLoadingPersonalDetails(false);
      }
    };

    void loadPersonalDetails();
  }, [user?.id]);

  useEffect(() => () => {
    if (savedNotificationTimer.current) {
      clearTimeout(savedNotificationTimer.current);
    }
  }, []);

  // ---- tab switching -------------------------------------------------------
  const handleTabChange = useCallback((nextTab: SettingsTabId) => {
    if (nextTab === activeTab) {
      return;
    }
    if (dirtyCount > 0) {
      const confirmed = window.confirm(
        `You have ${dirtyCount} unsaved change${dirtyCount === 1 ? '' : 's'}. Leave without saving?`
      );
      if (!confirmed) {
        return;
      }
    }
    setActiveTab(nextTab);
    setError('');
    setFieldErrors({});
    if (location.search) {
      navigate(location.pathname, { replace: true });
    }
  }, [activeTab, dirtyCount, location.pathname, location.search, navigate]);

  // ---- profile -------------------------------------------------------------
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
    setFieldErrors({});

    // Client-side validation
    const validation = validatePersonalDetails();
    if (!validation.valid) {
      setFieldErrors(validation.errors);
      setError('Please fix the highlighted fields.');
      return;
    }

    setIsSavingProfile(true);
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
      const nextPersonal = savedProfile
        ? {
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
            blood_group: (savedProfile as any).blood_group || '',
            permanent_address_line: (savedProfile as any).permanent_address_line || '',
            permanent_city: (savedProfile as any).permanent_city || '',
            permanent_state: (savedProfile as any).permanent_state || '',
            permanent_postal_code: (savedProfile as any).permanent_postal_code || '',
            emergency_contact_name: savedProfile.emergency_contact_name || '',
            emergency_contact_number: savedProfile.emergency_contact_number || '',
            emergency_contact_relationship: savedProfile.emergency_contact_relationship || '',
          }
        : personalDetailsForm;

      if (savedProfile) {
        setPersonalDetailsForm(nextPersonal);
      }

      setProfileBaseline({
        name: (updated?.name ?? profileName.trim()) || '',
        email: (updated?.email ?? profileEmail.trim()) || '',
        timezone,
        personal: nextPersonal,
      });

      toast.show({ kind: 'success', message: (res?.data as any)?.message || 'Profile updated' });
    } catch (e: any) {
      const apiErrors = e?.response?.data?.errors;
      if (apiErrors) {
        setFieldErrors(apiErrors);
      }
      setError(e?.response?.data?.message || 'Failed to update profile');
    } finally {
      setIsSavingProfile(false);
    }
  };

  const discardProfile = () => {
    setProfileName(profileBaseline.name);
    setProfileEmail(profileBaseline.email);
    setTimezone(profileBaseline.timezone);
    setPersonalDetailsForm(profileBaseline.personal);
    setProfileAvatarFile(null);
    setProfileAvatarPreview(profileAvatar);
    setFieldErrors({});
    setError('');
  };

  // ---- organization --------------------------------------------------------
  const saveOrganization = async () => {
    setError('');

    /*
     * Refused here rather than left to the server, which accepts this pair and
     * then silently raises auto-stop to the idle threshold
     * (TrackerPolicyResolver). The admin would see their own choice echoed back
     * while the tracker used a different number.
     */
    const idleConflict = validateIdleThresholds(orgIdleTrackSeconds, orgIdleAutoStopSeconds);
    if (idleConflict) {
      setError(idleConflict);
      return;
    }

    setIsSavingOrganization(true);
    try {
      const name = orgName.trim();
      const slug = orgSlug.trim();
      const normalizedLeaveCategories = leaveCategories
        .map((category) => ({
          code: category.code.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_-]/g, ''),
          name: category.name.trim(),
          annual_quota: Number(category.annual_quota || 0),
        }))
        .filter((category) => category.code && category.name && Number.isFinite(category.annual_quota) && category.annual_quota >= 0)
        .slice(0, 15);

      if (isStrictAdminUser && normalizedLeaveCategories.length === 0) {
        setError('Please configure at least one paid leave category.');
        return;
      }

      // Trimmed, with blanks dropped rather than sent as ''. The backend applies
      // only the keys it receives, so omitting an untouched field leaves the
      // stored value alone instead of clearing it.
      const companyProfilePayload = Object.fromEntries(
        Object.entries(companyProfile)
          .map(([key, value]) => [key, String(value ?? '').trim()])
          .filter(([, value]) => value !== '')
      ) as Partial<CompanyProfileForm>;

      const payload = orgLogoFile
        ? (() => {
            const formData = new FormData();
            formData.append('name', name);
            formData.append('slug', slug);
            Object.entries(companyProfilePayload).forEach(([key, value]) => {
              formData.append(key, String(value));
            });
            if (officeStartTime) {
              formData.append('office_start_time', officeStartTime);
            }
            if (lateAfterTime) {
              formData.append('late_after_time', lateAfterTime);
            }
            formData.append('timezone', orgTimezone);
            if (isStrictAdminUser) {
              formData.append('leave_categories_json', JSON.stringify(normalizedLeaveCategories));
              // FormData cannot carry null; '' is read as "clear the org default".
              formData.append('monitoring_interval_minutes', orgMonitoringInterval);
              // Same '' == "clear the org override" convention as the interval.
              formData.append('idle_track_threshold_seconds', orgIdleTrackSeconds);
              formData.append('idle_auto_stop_threshold_seconds', orgIdleAutoStopSeconds);
              formData.append('lock_auto_stop_threshold_seconds', orgLockAutoStopSeconds);
              formData.append('idle_resolution_policy', orgIdleResolutionPolicy);
              formData.append('url_detail_level', orgUrlDetailLevel);
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
            ...companyProfilePayload,
            ...(isStrictAdminUser
              ? {
                  leave_categories: normalizedLeaveCategories,
                  monitoring_interval_minutes: orgMonitoringInterval === '' ? null : Number(orgMonitoringInterval),
                  idle_track_threshold_seconds: orgIdleTrackSeconds === '' ? null : Number(orgIdleTrackSeconds),
                  idle_auto_stop_threshold_seconds: orgIdleAutoStopSeconds === '' ? null : Number(orgIdleAutoStopSeconds),
                  lock_auto_stop_threshold_seconds: orgLockAutoStopSeconds === '' ? null : Number(orgLockAutoStopSeconds),
                  idle_resolution_policy: orgIdleResolutionPolicy,
                  url_detail_level: orgUrlDetailLevel,
                }
              : {}),
          };

      const res = await settingsApi.updateOrganization(payload);

      const updatedOrg = (res.data as any)?.organization || null;
      updateOrganization(updatedOrg);
      const nextLogo = extractOrganizationLogoUrl(updatedOrg);
      setOrgLogo(nextLogo);
      setOrgLogoPreview(nextLogo);
      setOrgLogoFile(null);
      // Re-read the profile off the saved organization rather than echoing what
      // was typed, so the baseline matches what the server actually stored.
      const savedCompanyProfile = readCompanyProfile(updatedOrg);
      setCompanyProfile(savedCompanyProfile);
      setOrgBaseline({
        name,
        slug,
        officeStartTime,
        lateAfterTime,
        monitoringInterval: orgMonitoringInterval,
        idleTrackSeconds: orgIdleTrackSeconds,
        idleAutoStopSeconds: orgIdleAutoStopSeconds,
        lockAutoStopSeconds: orgLockAutoStopSeconds,
        idleResolutionPolicy: orgIdleResolutionPolicy,
        urlDetailLevel: orgUrlDetailLevel,
        timezone: orgTimezone,
        leaveCategories,
        companyProfile: savedCompanyProfile,
      });
      toast.show({ kind: 'success', message: (res.data as any)?.message || 'Organization updated' });
    } catch (e: any) {
      const apiErrors = e?.response?.data?.errors;
      if (apiErrors) {
        setFieldErrors(apiErrors);
      }
      setError(e?.response?.data?.message || 'Failed to update organization');
    } finally {
      setIsSavingOrganization(false);
    }
  };

  const discardOrganization = () => {
    setOrgName(orgBaseline.name);
    setOrgSlug(orgBaseline.slug);
    setOfficeStartTime(orgBaseline.officeStartTime);
    setLateAfterTime(orgBaseline.lateAfterTime);
    setOrgMonitoringInterval(orgBaseline.monitoringInterval);
    setOrgIdleTrackSeconds(orgBaseline.idleTrackSeconds);
    setOrgIdleAutoStopSeconds(orgBaseline.idleAutoStopSeconds);
    setOrgLockAutoStopSeconds(orgBaseline.lockAutoStopSeconds);
    setOrgIdleResolutionPolicy(orgBaseline.idleResolutionPolicy);
    setOrgTimezone(orgBaseline.timezone);
    setLeaveCategories(orgBaseline.leaveCategories);
    setCompanyProfile(orgBaseline.companyProfile);
    setOrgLogoFile(null);
    setOrgLogoPreview(orgLogo);
    setFieldErrors({});
    setError('');
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

  // ---- image pickers -------------------------------------------------------
  const applyAvatarFile = (file: File | null) => {
    if (!file) {
      setProfileAvatarFile(null);
      setProfileAvatarPreview(profileAvatar);
      return;
    }
    if (!file.type.startsWith('image/')) {
      setError('Please upload a valid image file for profile photo.');
      return;
    }
    setError('');
    setProfileAvatarFile(file);
    setProfileAvatarPreview(URL.createObjectURL(file));
  };

  const applyOrganizationLogoFile = (file: File | null) => {
    if (!file) {
      setOrgLogoFile(null);
      setOrgLogoPreview(orgLogo);
      return;
    }
    if (!file.type.startsWith('image/')) {
      setError('Please upload a valid image file for organization logo.');
      return;
    }
    setError('');
    setOrgLogoFile(file);
    setOrgLogoPreview(URL.createObjectURL(file));
  };

  const onProfileAvatarFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    if (file && !file.type.startsWith('image/')) {
      event.target.value = '';
    }
    applyAvatarFile(file);
  };

  const onOrganizationLogoFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    if (file && !file.type.startsWith('image/')) {
      event.target.value = '';
    }
    applyOrganizationLogoFile(file);
  };

  // ---- leave categories ----------------------------------------------------
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

  // ---- notifications (instant save) ---------------------------------------
  const setNotification = async (key: NotificationKey, value: boolean) => {
    const previous = notifications;
    const next = { ...notifications, [key]: value };
    setNotifications(next);
    setSavingNotification(key);
    setError('');

    try {
      await settingsApi.updatePreferences({ notifications: next });
      if (user) {
        updateUser({
          ...user,
          settings: {
            ...(user.settings || {}),
            notifications: next,
          },
        });
      }
      setSavingNotification(null);
      setSavedNotification(key);
      if (savedNotificationTimer.current) {
        clearTimeout(savedNotificationTimer.current);
      }
      savedNotificationTimer.current = setTimeout(() => setSavedNotification(null), 1600);
    } catch (e: any) {
      // The switch is the state of the server, not of an intention — so it goes
      // back if the write failed.
      setNotifications(previous);
      setSavingNotification(null);
      setError(e?.response?.data?.message || 'Could not save that preference. It has been put back.');
    }
  };

  // ---- security ------------------------------------------------------------
  const updatePassword = async () => {
    setError('');
    if (newPassword !== confirmPassword) {
      setError('New password and confirm password do not match.');
      return;
    }
    setIsSavingPassword(true);
    try {
      const res = await settingsApi.updatePassword({
        current_password: currentPassword,
        new_password: newPassword,
        new_password_confirmation: confirmPassword,
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast.show({ kind: 'success', message: (res.data as any)?.message || 'Password updated' });
    } catch (e: any) {
      const apiErrors = e?.response?.data?.errors;
      if (apiErrors) {
        setFieldErrors(apiErrors);
      }
      setError(e?.response?.data?.message || 'Failed to update password');
    } finally {
      setIsSavingPassword(false);
    }
  };

  // ---- help ----------------------------------------------------------------
  const submitHelpTicket = async () => {
    setError('');

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
        ...(helpAttachContext ? { current_path: currentPath } : {}),
      });

      setHelpSummary('');
      setHelpDescription('');
      if (!user) {
        setHelpName('');
      }
      toast.show({ kind: 'success', message: response.data.message || 'Support ticket raised successfully.' });
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Unable to raise support ticket right now.');
    } finally {
      setIsSubmittingHelp(false);
    }
  };

  // ---- save dock wiring ----------------------------------------------------
  const saveActiveTab = useCallback(() => {
    if (activeTab === 'profile') {
      void saveProfile();
    } else if (activeTab === 'organization') {
      void saveOrganization();
    }
  }, [activeTab, saveProfile, saveOrganization]);

  const discardActiveTab = useCallback(() => {
    if (activeTab === 'profile') {
      discardProfile();
    } else if (activeTab === 'organization') {
      discardOrganization();
    }
  }, [activeTab, discardProfile, discardOrganization]);

  const isSavingActiveTab = activeTab === 'profile' ? isSavingProfile : isSavingOrganization;

  // Ctrl/Cmd+S saves whatever the dock is offering, which is the only thing on
  // screen that can be saved.
  useEffect(() => {
    if (dirtyCount === 0) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        saveActiveTab();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dirtyCount, saveActiveTab]);

  // A browser-level guard for the tab-close case, which React cannot intercept.
  useEffect(() => {
    if (dirtyCount === 0) {
      return;
    }
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirtyCount]);

  return {
    // identity & permissions
    user,
    organization,
    canManageOrg,
    canManageSettings,
    canManageProductivity,
    canEditEmail,
    canEditTimezone,
    isOrgEditable,
    isStrictAdminUser,

    // shell
    activeTab,
    handleTabChange,
    visibleTabs,
    isLoading,
    error,
    setError,
    fieldErrors,
    billingPlan,
    billingSnapshot,

    // dock
    dirtyCount,
    saveActiveTab,
    discardActiveTab,
    isSavingActiveTab,

    // profile
    profileName,
    setProfileName,
    profileEmail,
    setProfileEmail,
    profileAvatarPreview,
    profileAvatarFile,
    applyAvatarFile,
    onProfileAvatarFileChange,
    personalDetailsForm,
    setPersonalDetailsForm,
    isLoadingPersonalDetails,
    timezone,
    setTimezone,
    saveProfile,
    isSavingProfile,

    // organization
    orgName,
    setOrgName,
    orgSlug,
    setOrgSlug,
    orgLogoPreview,
    applyOrganizationLogoFile,
    onOrganizationLogoFileChange,
    officeStartTime,
    setOfficeStartTime,
    lateAfterTime,
    setLateAfterTime,
    orgMonitoringInterval,
    setOrgMonitoringInterval,
    orgIdleTrackSeconds,
    setOrgIdleTrackSeconds,
    orgIdleAutoStopSeconds,
    setOrgIdleAutoStopSeconds,
    orgLockAutoStopSeconds,
    setOrgLockAutoStopSeconds,
    orgIdleResolutionPolicy,
    setOrgIdleResolutionPolicy,
    orgUrlDetailLevel,
    setOrgUrlDetailLevel,
    orgTimezone,
    setOrgTimezone,
    leaveCategories,
    updateLeaveCategory,
    addLeaveCategory,
    removeLeaveCategory,
    companyProfile,
    updateCompanyProfileField,
    saveOrganization,
    isSavingOrganization,
    deleteConfirmText,
    setDeleteConfirmText,
    deleteOrganization,
    isDeletingOrg,

    // notifications
    notifications,
    setNotification,
    savingNotification,
    savedNotification,

    // security
    currentPassword,
    setCurrentPassword,
    newPassword,
    setNewPassword,
    confirmPassword,
    setConfirmPassword,
    updatePassword,
    isSavingPassword,

    // help
    helpName,
    setHelpName,
    helpEmail,
    setHelpEmail,
    helpIssueCategory,
    setHelpIssueCategory,
    helpSummary,
    setHelpSummary,
    helpDescription,
    setHelpDescription,
    helpAttachContext,
    setHelpAttachContext,
    submitHelpTicket,
    isSubmittingHelp,
  };
}

export type SettingsController = ReturnType<typeof useSettingsController>;
