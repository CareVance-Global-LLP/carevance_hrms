import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, UserPlus } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { billingApi, organizationApi } from '@/services/api';
import { getAssignableRoles } from '@/lib/permissions';
import Button from '@/components/ui/Button';
import { FeedbackBanner, PageEmptyState } from '@/components/ui/PageState';
import { FieldLabel, SelectInput, ToggleInput } from '@/components/ui/FormField';
import EmailTagInput from '@/components/add-user/EmailTagInput';
import RoleSelector from '@/components/add-user/RoleSelector';
import GroupMultiSelect from '@/components/add-user/GroupMultiSelect';
import InviteLinkPanel from '@/components/add-user/InviteLinkPanel';
import CsvUploadPanel from '@/components/add-user/CsvUploadPanel';
import CustomAddUserPanel from '@/components/add-user/CustomAddUserPanel';
import QuickCreateGroupDialog from '@/components/groups/QuickCreateGroupDialog';
import { COMMON_TIMEZONES, DEFAULT_APP_TIMEZONE } from '@/lib/timezones';
import {
  addUserService,
  AdditionalInviteSettings,
  CsvParseResult,
  InviteUserRole,
} from '@/services/addUser';


type AddUserTab = 'email' | 'link' | 'csv' | 'custom';

const tabOptions: Array<{ id: AddUserTab; label: string; description: string }> = [
  { id: 'custom', label: 'Create User', description: 'Admin adds user with all details (email, password, personal info, bank details).' },
  { id: 'email', label: 'Invite by Email', description: 'Invite multiple people with their roles and access.' },
  { id: 'link', label: 'Invite by Link', description: 'Generate a single-use secure onboarding link for one recipient.' },
  { id: 'csv', label: 'Add by CSV', description: 'Bulk import employees, managers, or admins.' },
];

/**
 * What actually happens, per mode. All four now open an onboarding journey —
 * directly on create, and on acceptance for the three invite routes.
 */
const ADD_USER_INTRO: Record<AddUserTab, string> = {
  custom:
    'You set the password and the account is ready straight away. Onboarding starts immediately, anchored on the joining date.',
  email:
    'An invitation email goes out. The recipient sets their own password, and onboarding starts once they accept.',
  link: 'You get a single-use link to share yourself — useful when email is unreliable. Onboarding starts once the link is used.',
  csv: 'Every row is invited at once. Each person sets their own password, and onboarding starts as they accept.',
};

const extractInviteError = (error: any, fallback: string) => {
  const fieldErrors = error?.response?.data?.errors;
  const firstFieldError = fieldErrors
    ? Object.values(fieldErrors).flat().find(Boolean)
    : null;

  return firstFieldError || error?.response?.data?.message || error?.message || fallback;
};

const browserTimezone = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined;

/**
 * Furthest joining date the invite forms accept, as `YYYY-MM-DD`.
 *
 * Built from local parts, not `toISOString()`, which converts to UTC first and
 * returns yesterday in IST before 05:30. Matches the two-year ceiling the API
 * and the Create User wizard both enforce.
 */
const maxJoiningDate = (() => {
  const date = new Date();
  date.setFullYear(date.getFullYear() + 2);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
})();

const defaultSettings: AdditionalInviteSettings = {
  // Inherit the organization default unless the inviter explicitly picks one.
  monitoringInterval: null,
  canEditTime: false,
  attendanceMonitoring: true,
  payrollVisibility: false,
  taskAssignmentAccess: true,
  timezone: browserTimezone && COMMON_TIMEZONES.includes(browserTimezone) ? browserTimezone : DEFAULT_APP_TIMEZONE,
};

const monitoringIntervalOptions: Array<{ value: AdditionalInviteSettings['monitoringInterval']; label: string }> = [
  { value: null, label: 'Inherit from organization' },
  { value: 1, label: 'Every 1 minute' },
  { value: 3, label: 'Every 3 minutes' },
  { value: 5, label: 'Every 5 minutes' },
  { value: 10, label: 'Every 10 minutes' },
  { value: 15, label: 'Every 15 minutes' },
  { value: 30, label: 'Every 30 minutes' },
];

export default function AddUserDrawer({
  open,
  onClose,
  onCompleted,
  presentation = 'modal',
}: {
  open: boolean;
  onClose: () => void;
  onCompleted?: () => void;
  presentation?: 'modal' | 'inline';
}) {
  const { organization, user } = useAuth();
  const queryClient = useQueryClient();
  const storedDefaults = useMemo(() => addUserService.loadDefaults(), []);

  // ✅ Persist tab in URL search params
  const [searchParams, setSearchParams] = useSearchParams();

  const getInitialTab = (): AddUserTab => {
    const tabFromUrl = searchParams.get('tab') as AddUserTab | null;
    if (tabFromUrl && ['email', 'link', 'csv', 'custom'].includes(tabFromUrl)) {
      return tabFromUrl;
    }
    return 'custom';
  };

  const [activeTab, setActiveTabState] = useState<AddUserTab>(getInitialTab);

  // ✅ Wrapper that updates both state and URL
  const setActiveTab = (tab: AddUserTab) => {
    setActiveTabState(tab);
    setSearchParams({ tab }, { replace: true });
  };

  // ✅ Sync URL on mount (handles browser back/forward)
  useEffect(() => {
    const tabFromUrl = searchParams.get('tab') as AddUserTab | null;
    if (tabFromUrl && ['email', 'link', 'csv', 'custom'].includes(tabFromUrl)) {
      setActiveTabState(tabFromUrl);
    }
  }, [searchParams]);
  const [emails, setEmails] = useState<string[]>([]);
  const [invalidEmails, setInvalidEmails] = useState<string[]>([]);
  const [role, setRole] = useState<InviteUserRole>('employee');
  const [selectedGroupIds, setSelectedGroupIds] = useState<number[]>(storedDefaults.groupIds);
  const selectedProjectIds: number[] = [];
  const [rememberDefaults, setRememberDefaults] = useState(storedDefaults.remember);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [settings, setSettings] = useState<AdditionalInviteSettings>(defaultSettings);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [inviteUrl, setInviteUrl] = useState('');
  const [linkEmail, setLinkEmail] = useState('');
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvPreview, setCsvPreview] = useState<CsvParseResult | null>(null);
  const [csvSummary, setCsvSummary] = useState<{ parsedCount: number; successCount: number; errorCount: number } | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);
  /*
   * Shared by all three invite tabs.
   *
   * Without a joining date the onboarding checklist anchors on whenever the
   * recipient happens to click their link, which puts every pre-boarding item
   * (the first sit at day -14) in the past the moment they arrive.
   */
  const [joiningDate, setJoiningDate] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [expiresInHours, setExpiresInHours] = useState<number>(72);
  const allowedRoles = useMemo(() => getAssignableRoles(user, organization), [organization, user]);

  const groupsQuery = useQuery({
    queryKey: ['add-user-groups'],
    queryFn: addUserService.fetchGroups,
    enabled: open,
  });
  const projectsQuery = useQuery({
    queryKey: ['add-user-projects'],
    queryFn: addUserService.fetchProjects,
    enabled: open,
  });

  /*
   * Seat budget, shown before inviting rather than discovered at acceptance.
   *
   * Seats are deliberately claimed on accept, not on send — a pending invite
   * holds nothing. But that made the budget invisible here, so twenty invites
   * into five free seats meant fifteen people finding out individually, after
   * clicking their link, with an error they could do nothing about. This warns;
   * it does not block, because the accept-time check remains the authority.
   */
  const seatsQuery = useQuery({
    queryKey: ['billing-snapshot'],
    queryFn: async () => (await billingApi.current()).data,
    enabled: open,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const seats = seatsQuery.data?.seats ?? null;
  const seatsRemaining = seats && seats.max > 0 ? Math.max(0, seats.remaining) : null;
  const pendingRecipients = activeTab === 'email'
    ? emails.length
    : activeTab === 'link'
      ? (linkEmail.trim() ? 1 : 0)
      : csvPreview?.rows.length ?? 0;
  const seatShortfall = seatsRemaining !== null && pendingRecipients > seatsRemaining
    ? pendingRecipients - seatsRemaining
    : 0;

  const membersQuery = useQuery({
    queryKey: ['add-user-members', organization?.id],
    enabled: open && Boolean(organization?.id),
    queryFn: async () => {
      if (!organization?.id) {
        return [];
      }

      const response = await organizationApi.getMembers(organization.id);
      return response.data || [];
    },
  });

  useEffect(() => {
    if (!open || presentation !== 'modal') return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose, open, presentation]);

  useEffect(() => {
    if (!open) return;
    setFeedback(null);
    setCsvError(null);
    setCsvSummary(null);
  }, [activeTab, open]);

  useEffect(() => {
    if (allowedRoles.length === 0) {
      return;
    }

    if (!allowedRoles.includes(role)) {
      setRole(allowedRoles[0]);
    }
  }, [allowedRoles, role]);

  useEffect(() => {
    if (role !== 'employee') {
      return;
    }

    setSettings((current) => (
      current.payrollVisibility
        ? { ...current, payrollVisibility: false }
        : current
    ));
  }, [role]);

  const protectedEmailSet = useMemo(() => {
    const next = new Set<string>();

    if (user?.email) {
      next.add(user.email.trim().toLowerCase());
    }

    (membersQuery.data || []).forEach((member: any) => {
      if (member?.email) {
        next.add(String(member.email).trim().toLowerCase());
      }
    });

    return next;
  }, [membersQuery.data, user?.email]);

  const ownEmail = user?.email?.trim().toLowerCase() || '';
  const duplicateEmails = useMemo(
    () => emails.filter((email) => protectedEmailSet.has(email.trim().toLowerCase())),
    [emails, protectedEmailSet]
  );
  const isSelfInviteAttempt = ownEmail !== '' && duplicateEmails.some((email) => email.trim().toLowerCase() === ownEmail);
  const duplicateEmailMessage = duplicateEmails.length === 0
    ? null
    : isSelfInviteAttempt
      ? 'Your current admin account email cannot be invited as another user.'
      : `${duplicateEmails.slice(0, 3).join(', ')} ${duplicateEmails.length === 1 ? 'already belongs' : 'already belong'} to existing user account${duplicateEmails.length === 1 ? '' : 's'}.`;

  const departmentNameFor = (id: number) =>
    (groupsQuery.data || []).find((group) => group.id === id)?.name ?? `#${id}`;

  /**
   * Hand the skipped rows back as a CSV.
   *
   * Row errors used to arrive as a wall of sentences with the row number buried
   * in the prose, and there was nothing to give back to whoever produced the
   * spreadsheet.
   */
  const downloadCsvErrors = () => {
    if (!csvPreview?.errors.length) return;

    const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const content = ['issue', ...csvPreview.errors.map(escape)].join('\n');
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'carevance-import-issues.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  };

  const saveDefaultsIfNeeded = () => {
    if (!rememberDefaults) {
      addUserService.clearDefaults();
      return;
    }

    addUserService.saveDefaults({
      remember: true,
      groupIds: selectedGroupIds,
      projectIds: selectedProjectIds,
    });
  };

  const inviteMutation = useMutation({
    mutationFn: async () => {
      if (!organization?.id) {
        throw new Error('Organization context is required to invite users.');
      }

      return addUserService.inviteByEmail({
        organizationId: organization.id,
        emails,
        role,
        groupIds: selectedGroupIds,
        projectIds: selectedProjectIds,
        settings,
        joiningDate: joiningDate || undefined,
        jobTitle: jobTitle.trim() || undefined,
        expiresInHours,
      });
    },
    onSuccess: async (result) => {
      saveDefaultsIfNeeded();
      setFeedback({
        tone: result.failed.length > 0 ? 'error' : 'success',
        message:
          result.failed.length > 0
            ? `Sent ${result.invitedCount} invite(s). ${result.failed.length} failed.`
            : `Sent ${result.invitedCount} invite(s) successfully.`,
      });
      setEmails([]);
      setInvalidEmails([]);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-dashboard-users'] }),
        queryClient.invalidateQueries({ queryKey: ['employee-workspace-users'] }),
        queryClient.invalidateQueries({ queryKey: ['employee-workspace-members', organization?.id] }),
        queryClient.invalidateQueries({ queryKey: ['add-user-members', organization?.id] }),
        queryClient.invalidateQueries({ queryKey: ['add-user-groups'] }),
      ]);
      onCompleted?.();
    },
    onError: (error: any) => {
      setFeedback({
        tone: 'error',
        message: extractInviteError(error, 'Failed to send invites.'),
      });
    },
  });

  const linkMutation = useMutation({
    mutationFn: async () =>
      addUserService.generateInviteLink({
        organizationId: organization?.id || 0,
        email: linkEmail.trim(),
        role,
        groupIds: selectedGroupIds,
        projectIds: selectedProjectIds,
        settings,
        joiningDate: joiningDate || undefined,
        jobTitle: jobTitle.trim() || undefined,
        expiresInHours,
      }),
    onSuccess: (result) => {
      saveDefaultsIfNeeded();
      setInviteUrl(result.url);
      setFeedback({ tone: 'success', message: 'Secure invite link generated.' });
    },
    onError: (error: any) => {
      setFeedback({ tone: 'error', message: extractInviteError(error, 'Failed to generate invite link.') });
    },
  });

  const copyLinkMutation = useMutation({
    mutationFn: async () => addUserService.copyInviteLink(inviteUrl),
    onSuccess: () => setFeedback({ tone: 'success', message: 'Invite link copied.' }),
    onError: () => setFeedback({ tone: 'error', message: 'Unable to copy invite link.' }),
  });

  /*
   * Parse on select, send on confirm.
   *
   * These were one action: choosing a file parsed it and immediately invited
   * everyone in it. The parser already returns `{ rows, errors }`, so showing
   * that before committing costs nothing and turns the riskiest tab into the
   * one you can check.
   */
  const parseCsvMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!addUserService.isSupportedImportFile(file.name)) {
        throw new Error('Only CSV and XLSX files are supported.');
      }

      return addUserService.parseImportFile(file, groupsQuery.data || [], projectsQuery.data || []);
    },
    onSuccess: (parsed) => {
      setCsvPreview(parsed);
      setCsvSummary(null);
      setCsvError(
        parsed.rows.length === 0
          ? parsed.errors[0] || 'No usable rows found in this file.'
          : null
      );
    },
    onError: (error: any) => {
      const message = extractInviteError(error, 'Could not read this file.');
      setCsvPreview(null);
      setCsvError(message);
    },
  });

  const csvMutation = useMutation({
    mutationFn: async () => {
      if (!organization?.id) {
        throw new Error('Organization context is required to import users.');
      }
      if (!csvPreview) {
        throw new Error('Select a file first.');
      }

      return addUserService.sendParsedRows(csvPreview, {
        organizationId: organization.id,
        defaultGroupIds: [],
        defaultProjectIds: selectedProjectIds,
        settings,
        joiningDate: joiningDate || undefined,
      });
    },
    onSuccess: async ({ parsed, result }) => {
      saveDefaultsIfNeeded();
      setCsvSummary({
        parsedCount: parsed.rows.length,
        successCount: result.invitedCount,
        errorCount: result.failed.length,
      });
      setCsvError(result.failed.length > 0 ? result.failed.map((item) => item.message).join(' ') : null);
      setFeedback({
        tone: result.failed.length > 0 ? 'error' : 'success',
        message:
          result.failed.length > 0
            ? `Imported ${result.invitedCount} row(s) with ${result.failed.length} issue(s).`
            : result.deferredAssignments.length > 0
              ? `Imported ${result.invitedCount} row(s) successfully. ${result.deferredAssignments.join(' ')}`
              : `Imported ${result.invitedCount} row(s) successfully.`,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-dashboard-users'] }),
        queryClient.invalidateQueries({ queryKey: ['employee-workspace-users'] }),
        queryClient.invalidateQueries({ queryKey: ['employee-workspace-members', organization?.id] }),
        queryClient.invalidateQueries({ queryKey: ['add-user-members', organization?.id] }),
      ]);
      onCompleted?.();
    },
    onError: (error: any) => {
      const message = extractInviteError(error, 'Failed to process CSV import.');
      setCsvError(message);
      setFeedback({ tone: 'error', message });
    },
  });

  if (!open) return null;

  return (
    <div className={presentation === 'modal' ? 'fixed inset-0 z-50' : 'relative z-0'}>
      {presentation === 'modal' ? (
        <div className="absolute inset-0 bg-black/35 backdrop-blur-sm" onClick={onClose} />
      ) : null}
      <aside className={presentation === 'modal' ? 'absolute inset-0 flex items-start justify-center overflow-y-auto p-4 sm:p-6 lg:p-8' : 'relative'}>
        <div className={`flex w-full flex-col gap-6 ${
          presentation === 'modal' ? 'rounded-lg border border-slate-200 bg-[linear-gradient(180deg,rgba(248,250,252,0.97),rgba(255,255,255,0.99))] p-4 shadow-sm sm:p-6 mt-16 max-w-[72rem] sm:mt-20' : ''
        }`}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <Link
                to="/employees"
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-600 shadow-sm transition-all hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 hover:shadow mb-3"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to Employees
              </Link>
              <h2 className="text-2xl font-bold tracking-[-0.05em] text-slate-950">Add User</h2>
              {/* Was a single line claiming an invitation email would be sent —
                  shown even on "Create User", where the admin sets the password
                  and no email goes out. It described one of the four modes and
                  contradicted the other three. */}
              <p className="mt-1 max-w-2xl text-sm text-slate-600">
                {ADD_USER_INTRO[activeTab]}
              </p>
            </div>
          </div>

          {feedback ? <FeedbackBanner tone={feedback.tone} message={feedback.message} /> : null}

          {allowedRoles.length === 0 ? (
            <PageEmptyState
              title="Invite permissions unavailable"
              description="Your current role does not allow sending workspace invitations."
            />
          ) : null}

          <div className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2 lg:grid-cols-4">
            {tabOptions.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-lg px-4 py-3 text-left transition ${
                  activeTab === tab.id
                    ? 'bg-white text-slate-950 shadow-sm'
                    : 'text-slate-500 hover:bg-white hover:text-slate-900'
                }`}
              >
                <p className="text-sm font-semibold">{tab.label}</p>
                <p className="mt-1 text-xs leading-5 text-inherit/80">{tab.description}</p>
              </button>
            ))}
          </div>

          <section className={`space-y-6 rounded-lg border border-slate-200 bg-white p-5 shadow-sm ${
            presentation === 'modal' ? 'max-h-[calc(100vh-14rem)] overflow-y-auto' : ''
          }`}>
            {activeTab === 'email' ? (
              <>
                <EmailTagInput
                  emails={emails}
                  invalidEmails={invalidEmails}
                  onChange={setEmails}
                  onInvalidChange={setInvalidEmails}
                />
                {duplicateEmailMessage ? (
                  <FeedbackBanner tone="error" message={duplicateEmailMessage} />
                ) : null}
                <div className="h-px bg-slate-200" />
              </>
            ) : null}

            {activeTab === 'csv' ? (
              <>
                <CsvUploadPanel
                  file={csvFile}
                  preview={csvPreview}
                  isParsing={parseCsvMutation.isPending}
                  isImporting={csvMutation.isPending}
                  summary={csvSummary}
                  errorMessage={csvError}
                  departmentNameFor={departmentNameFor}
                  onSelectFile={(file) => {
                    setCsvFile(file);
                    setCsvPreview(null);
                    setCsvSummary(null);
                    setCsvError(null);
                    if (file) parseCsvMutation.mutate(file);
                  }}
                  onDownloadTemplate={addUserService.downloadCsvTemplate}
                  onConfirmImport={() => csvMutation.mutate()}
                  onDownloadErrors={downloadCsvErrors}
                />
                <div className="h-px bg-slate-200" />
              </>
            ) : null}

            {activeTab === 'custom' ? (
              <>
                <CustomAddUserPanel
                  organizationId={organization?.id || 0}
                  allowedRoles={allowedRoles}
                  onSuccess={() => {
                    setFeedback({ tone: 'success', message: 'User created successfully.' });
                    onCompleted?.();
                  }}
                  onError={(message) => {
                    setFeedback({ tone: 'error', message });
                  }}
                  onCancel={() => {
                    setFeedback(null);
                    setActiveTab('custom');
                  }}
                />
              </>
            ) : null}

            {activeTab !== 'csv' && activeTab !== 'custom' ? (
              <>
                <RoleSelector value={role} onChange={setRole} allowedRoles={allowedRoles} />
                <div className="h-px bg-slate-200" />
              </>
            ) : null}

            {/*
              Joining date, job title and expiry, shared by both invite tabs.
              An invite could previously carry none of them: the checklist
              anchored on whenever the link was clicked, invited people arrived
              with no designation, and every link lasted exactly 72 hours
              because the UI never sent the expiry the API already accepted.
            */}
            {activeTab !== 'csv' && activeTab !== 'custom' ? (
              <>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div>
                    <FieldLabel hint="optional">Joining date</FieldLabel>
                    <input
                      type="date"
                      value={joiningDate}
                      max={maxJoiningDate}
                      onChange={(event) => setJoiningDate(event.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                    />
                    <p className="mt-1 text-xs text-slate-500">
                      {joiningDate ? 'Onboarding anchors on this date.' : 'Defaults to the day they accept.'}
                    </p>
                  </div>
                  <div>
                    <FieldLabel hint="optional">Job title</FieldLabel>
                    <input
                      type="text"
                      value={jobTitle}
                      onChange={(event) => setJobTitle(event.target.value)}
                      placeholder="e.g., Support Analyst"
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                    />
                    <p className="mt-1 text-xs text-slate-500">Saved as their designation.</p>
                  </div>
                  <div>
                    <FieldLabel>Invite expires</FieldLabel>
                    <SelectInput
                      value={String(expiresInHours)}
                      onChange={(event) => setExpiresInHours(Number(event.target.value))}
                    >
                      <option value="24">In 24 hours</option>
                      <option value="72">In 3 days</option>
                      <option value="168">In 7 days</option>
                      <option value="720">In 30 days</option>
                    </SelectInput>
                    <p className="mt-1 text-xs text-slate-500">After this the link stops working.</p>
                  </div>
                </div>

                <div className="h-px bg-slate-200" />
              </>
            ) : null}

            {activeTab !== 'csv' && activeTab !== 'custom' ? (
              <>
                <GroupMultiSelect
                  options={groupsQuery.data || []}
                  selectedIds={selectedGroupIds}
                  onChange={setSelectedGroupIds}
                  isLoading={groupsQuery.isLoading}
                  errorMessage={groupsQuery.isError ? 'Failed to load departments.' : undefined}
                  onCreateNew={() => setShowGroupModal(true)}
                />

                <div className="h-px bg-slate-200" />
              </>
            ) : null}

            {activeTab !== 'csv' && activeTab !== 'custom' ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50">
              <div className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left">
                <div>
                  <p className="text-sm font-semibold text-slate-950">Additional settings</p>
                  <p className="mt-1 text-sm text-slate-500">Optional permissions that fit the current HRMS workflow.</p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 border-t border-slate-200 px-5 py-5 md:grid-cols-2">
                  <div>
                    <FieldLabel>Monitoring Interval</FieldLabel>
                    <SelectInput
                      value={settings.monitoringInterval === null ? '' : settings.monitoringInterval}
                      onChange={(event) => setSettings((current) => ({
                        ...current,
                        // '' is the inherit option: send null so the server
                        // resolves the organization default instead of pinning.
                        monitoringInterval: event.target.value === ''
                          ? null
                          : Number(event.target.value) as AdditionalInviteSettings['monitoringInterval'],
                      }))}
                    >
                      {monitoringIntervalOptions.map((option) => (
                        <option key={option.value ?? 'inherit'} value={option.value ?? ''}>{option.label}</option>
                      ))}
                    </SelectInput>
                  </div>
                  <div>
                    <FieldLabel>Timezone</FieldLabel>
                    <SelectInput
                      value={settings.timezone || ''}
                      onChange={(event) => setSettings((current) => ({ ...current, timezone: event.target.value || undefined }))}
                    >
                      <option value="">Auto-detect on accept</option>
                      {COMMON_TIMEZONES.map((tz) => (
                        <option key={tz} value={tz}>{tz}</option>
                      ))}
                    </SelectInput>
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-950">Can edit time</p>
                        <p className="mt-1 text-sm text-slate-500">Allow manual correction requests and edits.</p>
                      </div>
                      <ToggleInput
                        checked={settings.canEditTime}
                        onChange={(checked) => setSettings((current) => ({ ...current, canEditTime: checked }))}
                      />
                    </div>
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-950">Attendance monitoring</p>
                        <p className="mt-1 text-sm text-slate-500">Include attendance status and check-in monitoring.</p>
                      </div>
                      <ToggleInput
                        checked={settings.attendanceMonitoring}
                        onChange={(checked) => setSettings((current) => ({ ...current, attendanceMonitoring: checked }))}
                      />
                    </div>
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-950">Payroll visibility</p>
                        <p className="mt-1 text-sm text-slate-500">Only useful for admin and manager reporting views.</p>
                      </div>
                      <ToggleInput
                        checked={settings.payrollVisibility}
                        onChange={(checked) => setSettings((current) => ({ ...current, payrollVisibility: checked }))}
                        disabled={role === 'employee'}
                      />
                    </div>
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 md:col-span-2">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-950">Task assignment defaults</p>
                        <p className="mt-1 text-sm text-slate-500">Grant access to task assignment workflows by default.</p>
                      </div>
                      <ToggleInput
                        checked={settings.taskAssignmentAccess}
                        onChange={(checked) => setSettings((current) => ({ ...current, taskAssignmentAccess: checked }))}
                      />
                    </div>
                  </div>
              </div>
            </div>
            ) : null}

            {activeTab !== 'csv' && activeTab !== 'custom' ? (
            <label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={rememberDefaults}
                onChange={(event) => setRememberDefaults(event.target.checked)}
                className="mt-1"
              />
              <span>
                <span className="font-semibold text-slate-950">Remember selected departments for next invite</span>
                <span className="mt-1 block text-slate-500">Saved locally in this browser so repeated onboarding stays faster.</span>
              </span>
            </label>
            ) : null}

            {activeTab === 'link' ? (
              <InviteLinkPanel
                email={linkEmail}
                inviteUrl={inviteUrl}
                onEmailChange={setLinkEmail}
                onGenerate={() => {
                  setFeedback(null);
                  linkMutation.mutate();
                }}
                onCopy={() => copyLinkMutation.mutate()}
                isGenerating={linkMutation.isPending}
                isCopying={copyLinkMutation.isPending}
                role={role}
                expiresInHours={expiresInHours}
              />
            ) : null}

            {groupsQuery.isLoading || projectsQuery.isLoading ? (
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Preparing invite configuration data...
              </div>
            ) : null}

            {membersQuery.isLoading ? (
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Checking existing organization members...
              </div>
            ) : null}

            {!organization?.id ? (
              <PageEmptyState
                title="Organization context missing"
                description="This invite flow needs an active organization before users can be added."
              />
            ) : null}

            {activeTab !== 'custom' && seatShortfall > 0 ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <p className="font-semibold">
                  {seatsRemaining === 0
                    ? 'No seats left'
                    : `Only ${seatsRemaining} seat${seatsRemaining === 1 ? '' : 's'} left`}
                </p>
                <p className="mt-1">
                  You are inviting {pendingRecipients}. Invitations still send, but the last{' '}
                  {seatShortfall} to accept will be turned away until you{' '}
                  <Link to="/settings/billing" className="font-medium underline underline-offset-2">add seats</Link>.
                </p>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-200 pt-5">
              <Button variant="secondary" onClick={() => {
                setFeedback(null);
                setActiveTab('custom');
              }}>Cancel</Button>
              {activeTab === 'email' ? (
                <Button
                  onClick={() => {
                    setFeedback(null);
                    inviteMutation.mutate();
                  }}
                  disabled={!organization?.id || allowedRoles.length === 0 || emails.length === 0 || invalidEmails.length > 0 || duplicateEmails.length > 0 || inviteMutation.isPending || membersQuery.isLoading}
                  iconLeft={<UserPlus className="h-4 w-4" />}
                >
                  {/* The count is the confirmation on a bulk action — this read
                      the same for one recipient and for sixty. */}
                  {inviteMutation.isPending
                    ? `Sending ${emails.length}...`
                    : emails.length > 1 ? `Send ${emails.length} invites` : 'Send invite'}
                </Button>
              ) : null}
              {activeTab === 'link' ? (
                <Button
                  onClick={() => {
                    if (inviteUrl) {
                      copyLinkMutation.mutate();
                      return;
                    }
                    linkMutation.mutate();
                  }}
                  disabled={!organization?.id || allowedRoles.length === 0 || !linkEmail.trim() || linkMutation.isPending || copyLinkMutation.isPending}
                >
                  {inviteUrl ? 'Copy Invite Link' : 'Generate Invite Link'}
                </Button>
              ) : null}
              {/*
                No CSV button here on purpose. The import is confirmed from the
                preview, next to the rows it is about to send — a second button
                down here would be a way to import without having looked.
              */}
            </div>
          </section>
        </div>
      </aside>
      <QuickCreateGroupDialog
        open={showGroupModal}
        onClose={() => setShowGroupModal(false)}
        onCreated={(group) => {
          setSelectedGroupIds((current) => (current.includes(group.id) ? current : [...current, group.id]));
        }}
        eyebrow="Department quick add"
        title="Create a department without leaving onboarding"
        description="Add the new department here and it will be selected for this invite immediately."
      />
    </div>
  );
}
