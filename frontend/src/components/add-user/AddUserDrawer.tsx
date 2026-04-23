import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, UserPlus, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { organizationApi } from '@/services/api';
import { getAssignableRoles } from '@/lib/permissions';
import Button from '@/components/ui/Button';
import { FeedbackBanner, PageEmptyState } from '@/components/ui/PageState';
import { FieldLabel, SelectInput, ToggleInput } from '@/components/ui/FormField';
import EmailTagInput from '@/components/add-user/EmailTagInput';
import RoleSelector from '@/components/add-user/RoleSelector';
import GroupMultiSelect from '@/components/add-user/GroupMultiSelect';
import InviteLinkPanel from '@/components/add-user/InviteLinkPanel';
import CsvUploadPanel from '@/components/add-user/CsvUploadPanel';
import QuickCreateGroupDialog from '@/components/groups/QuickCreateGroupDialog';
import {
  addUserService,
  AdditionalInviteSettings,
  InviteUserRole,
} from '@/services/addUser';

type AddUserTab = 'email' | 'link' | 'csv';

const tabOptions: Array<{ id: AddUserTab; label: string; description: string }> = [
  { id: 'email', label: 'Invite by Email', description: 'Invite multiple people with their roles and access.' },
  { id: 'link', label: 'Invite by Link', description: 'Generate a single-use secure onboarding link for one recipient.' },
  { id: 'csv', label: 'Add by CSV', description: 'Bulk import employees, managers, or admins.' },
];

const extractInviteError = (error: any, fallback: string) => {
  const fieldErrors = error?.response?.data?.errors;
  const firstFieldError = fieldErrors
    ? Object.values(fieldErrors).flat().find(Boolean)
    : null;

  return firstFieldError || error?.response?.data?.message || error?.message || fallback;
};

const defaultSettings: AdditionalInviteSettings = {
  monitoringInterval: 10,
  canEditTime: false,
  attendanceMonitoring: true,
  payrollVisibility: false,
  taskAssignmentAccess: true,
};

const monitoringIntervalOptions: Array<{ value: AdditionalInviteSettings['monitoringInterval']; label: string }> = [
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

  const [activeTab, setActiveTab] = useState<AddUserTab>('email');
  const [emails, setEmails] = useState<string[]>([]);
  const [invalidEmails, setInvalidEmails] = useState<string[]>([]);
  const [role, setRole] = useState<InviteUserRole>('employee');
  const [selectedGroupIds, setSelectedGroupIds] = useState<number[]>(storedDefaults.groupIds);
  const [rememberDefaults, setRememberDefaults] = useState(storedDefaults.remember);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [settings, setSettings] = useState<AdditionalInviteSettings>(defaultSettings);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [inviteUrl, setInviteUrl] = useState('');
  const [linkEmail, setLinkEmail] = useState('');
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvSummary, setCsvSummary] = useState<{ parsedCount: number; successCount: number; errorCount: number } | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);
  const allowedRoles = useMemo(() => getAssignableRoles(user, organization), [organization, user]);

  const groupsQuery = useQuery({
    queryKey: ['add-user-groups'],
    queryFn: addUserService.fetchGroups,
    enabled: open,
  });

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

  const saveDefaultsIfNeeded = () => {
    if (!rememberDefaults) {
      addUserService.clearDefaults();
      return;
    }

    addUserService.saveDefaults({
      remember: true,
      groupIds: selectedGroupIds,
      projectIds: [],
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
        projectIds: [],
        settings,
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
        projectIds: [],
        settings,
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

  const csvMutation = useMutation({
    mutationFn: async () => {
      if (!organization?.id) {
        throw new Error('Organization context is required to import users.');
      }
      if (!csvFile) {
        throw new Error('Select a CSV file first.');
      }
      if (!addUserService.isSupportedImportFile(csvFile.name)) {
        throw new Error('Only CSV and XLSX files are supported.');
      }

      return addUserService.processImportFile(
        csvFile,
        {
          organizationId: organization.id,
          defaultGroupIds: [],
          defaultProjectIds: [],
          settings,
        },
        groupsQuery.data || [],
        []
      );
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
        <div className="absolute inset-0 bg-slate-950/35 backdrop-blur-sm" onClick={onClose} />
      ) : null}
      <aside className={presentation === 'modal' ? 'absolute inset-0 flex items-start justify-center overflow-y-auto p-4 sm:p-6 lg:p-8' : 'relative'}>
        <div className={`flex w-full flex-col gap-6 rounded-[34px] border border-white/80 bg-[linear-gradient(180deg,rgba(248,250,252,0.97),rgba(255,255,255,0.99))] p-4 shadow-[0_40px_120px_-48px_rgba(15,23,42,0.55)] sm:p-6 ${
          presentation === 'modal' ? 'mt-16 max-w-[72rem] sm:mt-20' : ''
        }`}>
          <div className="flex items-start justify-between gap-4 rounded-[30px] border border-white/70 bg-white/85 p-5 shadow-[0_28px_70px_-42px_rgba(15,23,42,0.3)]">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-sky-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">
                <UserPlus className="h-3.5 w-3.5" />
                Add User
              </div>
              <h2 className="mt-3 text-2xl font-semibold tracking-[-0.05em] text-slate-950">Add User</h2>
              <p className="mt-1 max-w-2xl text-sm text-slate-500">
                An invitation email will be sent. The user creates their own account and automatically receives the assigned access level.
              </p>
            </div>
            <Button variant="ghost" className="h-11 w-11 rounded-full p-0" onClick={onClose} aria-label="Close add user drawer">
              <X className="h-5 w-5" />
            </Button>
          </div>

          {feedback ? <FeedbackBanner tone={feedback.tone} message={feedback.message} /> : null}

          {allowedRoles.length === 0 ? (
            <PageEmptyState
              title="Invite permissions unavailable"
              description="Your current role does not allow sending workspace invitations."
            />
          ) : null}

          <div className="grid grid-cols-1 gap-3 rounded-[28px] border border-slate-200/80 bg-slate-50/80 p-3 sm:grid-cols-3">
            {tabOptions.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-[22px] px-4 py-3 text-left transition ${
                  activeTab === tab.id
                    ? 'bg-white text-slate-950 shadow-[0_24px_50px_-36px_rgba(15,23,42,0.28)]'
                    : 'text-slate-500 hover:bg-white/70 hover:text-slate-900'
                }`}
              >
                <p className="text-sm font-semibold">{tab.label}</p>
                <p className="mt-1 text-xs leading-5 text-inherit/80">{tab.description}</p>
              </button>
            ))}
          </div>

          <section className={`space-y-6 rounded-[30px] border border-white/70 bg-white/85 p-5 shadow-[0_28px_70px_-42px_rgba(15,23,42,0.3)] ${
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
                  summary={csvSummary}
                  errorMessage={csvError}
                  onSelectFile={setCsvFile}
                  onDownloadTemplate={addUserService.downloadCsvTemplate}
                />
                <div className="h-px bg-slate-200" />
              </>
            ) : null}

            {activeTab !== 'csv' ? (
              <>
                <RoleSelector value={role} onChange={setRole} allowedRoles={allowedRoles} />
                <div className="h-px bg-slate-200" />
              </>
            ) : null}

            {activeTab !== 'csv' ? (
              <>
                <GroupMultiSelect
                  options={groupsQuery.data || []}
                  selectedIds={selectedGroupIds}
                  onChange={setSelectedGroupIds}
                  isLoading={groupsQuery.isLoading}
                  errorMessage={groupsQuery.isError ? 'Failed to load groups.' : undefined}
                  onCreateNew={() => setShowGroupModal(true)}
                />

                <div className="h-px bg-slate-200" />
              </>
            ) : null}

            <div className="rounded-[26px] border border-slate-200/80 bg-slate-50/70">
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
                      value={settings.monitoringInterval}
                      onChange={(event) => setSettings((current) => ({
                        ...current,
                        monitoringInterval: Number(event.target.value) as AdditionalInviteSettings['monitoringInterval'],
                      }))}
                    >
                      {monitoringIntervalOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </SelectInput>
                  </div>

                  <div className="rounded-[22px] border border-slate-200/80 bg-white/80 px-4 py-3">
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

                  <div className="rounded-[22px] border border-slate-200/80 bg-white/80 px-4 py-3">
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

                  <div className="rounded-[22px] border border-slate-200/80 bg-white/80 px-4 py-3">
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

                  <div className="rounded-[22px] border border-slate-200/80 bg-white/80 px-4 py-3 md:col-span-2">
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

            <label className="flex items-start gap-3 rounded-[22px] border border-slate-200/80 bg-slate-50/70 px-4 py-4 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={rememberDefaults}
                onChange={(event) => setRememberDefaults(event.target.checked)}
                className="mt-1"
              />
              <span>
                <span className="font-semibold text-slate-950">Remember selected groups for next invite</span>
                <span className="mt-1 block text-slate-500">Saved locally in this browser so repeated onboarding stays faster.</span>
              </span>
            </label>

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
              />
            ) : null}

            {groupsQuery.isLoading ? (
              <div className="flex items-center gap-2 rounded-[22px] border border-slate-200/80 bg-slate-50/70 px-4 py-3 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Preparing invite configuration data...
              </div>
            ) : null}

            {membersQuery.isLoading ? (
              <div className="flex items-center gap-2 rounded-[22px] border border-slate-200/80 bg-slate-50/70 px-4 py-3 text-sm text-slate-500">
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

            <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-200 pt-5">
              <Button variant="secondary" onClick={onClose}>Cancel</Button>
              {activeTab === 'email' ? (
                <Button
                  onClick={() => {
                    setFeedback(null);
                    inviteMutation.mutate();
                  }}
                  disabled={!organization?.id || allowedRoles.length === 0 || emails.length === 0 || invalidEmails.length > 0 || duplicateEmails.length > 0 || inviteMutation.isPending || membersQuery.isLoading}
                  iconLeft={<UserPlus className="h-4 w-4" />}
                >
                  {inviteMutation.isPending ? 'Sending...' : 'Send Invite'}
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
              {activeTab === 'csv' ? (
                <Button
                  onClick={() => {
                    setFeedback(null);
                    setCsvError(null);
                    csvMutation.mutate();
                  }}
                  disabled={!organization?.id || allowedRoles.length === 0 || !csvFile || csvMutation.isPending}
                >
                  {csvMutation.isPending ? 'Uploading CSV...' : 'Upload CSV'}
                </Button>
              ) : null}
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
        eyebrow="Group quick add"
        title="Create a group without leaving onboarding"
        description="Add the new department here and it will be selected for this invite immediately."
      />
    </div>
  );
}
