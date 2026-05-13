import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRightLeft, Building2, CalendarDays, CheckCircle2, Clock3, Edit2, Plus, Search, TimerReset, Trash2, UserPlus2, UserRound, Users, Users2, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import MetricCard from '@/components/dashboard/MetricCard';
import QuickCreateGroupDialog from '@/components/groups/QuickCreateGroupDialog';
import Button from '@/components/ui/Button';
import { FeedbackBanner, PageErrorState, PageLoadingState } from '@/components/ui/PageState';
import { FieldLabel, SelectInput, TextInput, TextareaInput } from '@/components/ui/FormField';
import SearchSuggestInput from '@/components/ui/SearchSuggestInput';
import { queryKeys } from '@/lib/queryKeys';
import { buildSearchSuggestions, getSuggestionDisplayValue, matchesSearchFilter, normalizeSearchValue } from '@/lib/searchSuggestions';
import { groupApi, projectApi, taskApi, userApi } from '@/services/api';
import type { Group, Project, Task, User } from '@/types';
import { cn } from '@/utils/cn';

type SavedTaskStatus = Exclude<Task['status'], 'in_review'>;
type TaskPriority = Task['priority'];
type TaskMutationPayload = Partial<Task> & { assignee_ids?: number[] };

type TaskFormState = {
  title: string;
  description: string;
  group_id: string;
  project_id: string;
  assignee_id: string;
  assignee_ids: string[];
  status: SavedTaskStatus;
  priority: TaskPriority;
  due_date: string;
  estimated_time: string;
};

const STATUS_OPTIONS: Array<{ value: SavedTaskStatus; label: string; accent: string }> = [
  { value: 'todo', label: 'To Do', accent: 'border-sky-100 bg-sky-50' },
  { value: 'in_progress', label: 'In Progress', accent: 'border-amber-100 bg-amber-50/70' },
  { value: 'done', label: 'Done', accent: 'border-emerald-100 bg-emerald-50' },
];

const PRIORITY_OPTIONS: TaskPriority[] = ['low', 'medium', 'high', 'urgent'];

const createTaskFormState = (groupId = '', status: SavedTaskStatus = 'todo'): TaskFormState => ({
  title: '',
  description: '',
  group_id: groupId,
  project_id: '',
  assignee_id: '',
  assignee_ids: [],
  status,
  priority: 'medium',
  due_date: '',
  estimated_time: '',
});

const titleCase = (value: string) => value.replace(/_/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
const toDate = (value?: string | null) => value ? new Date(value.includes('T') ? value : `${value}T00:00:00`) : null;
const formatDate = (value?: string | null) => {
  const date = toDate(value);
  return !date || Number.isNaN(date.getTime()) ? 'No date' : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};
const formatMinutes = (value?: number | null) => {
  const minutes = Number(value || 0);
  if (!Number.isFinite(minutes) || minutes <= 0) return 'No estimate';
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours && remainder) return `${hours}h ${remainder}m`;
  if (hours) return `${hours}h`;
  return `${remainder}m`;
};
const formatTrackedTime = (value?: number | null) => {
  const seconds = Number(value || 0);
  if (!Number.isFinite(seconds) || seconds <= 0) return '0m';
  return formatMinutes(Math.round(seconds / 60));
};
const getTaskCompletionPercent = (task: Task) => {
  if (task.status === 'done') {
    return 100;
  }

  const estimateMinutes = Number(task.estimated_time || 0);
  const trackedSeconds = Number(task.time_entries_sum_duration || 0);
  const trackedMinutes = trackedSeconds > 0 ? trackedSeconds / 60 : 0;
  if (estimateMinutes > 0) {
    return Math.max(0, Math.min(99, Math.round((trackedMinutes / estimateMinutes) * 100)));
  }
  return 0;
};

export default function Tasks() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canManageTasks = user?.role === 'admin' || user?.role === 'manager';
  const canCreateGroups = user?.role === 'admin';
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [groupModalSource, setGroupModalSource] = useState<'workspace' | 'task-form'>('workspace');
  const [searchQuery] = useState('');
  const [statusFilter] = useState<'all' | SavedTaskStatus>('all');
  const [groupFilter, setGroupFilter] = useState('all');
  const [assigneeFilter] = useState('all');
  const [groupDirectoryQuery, setGroupDirectoryQuery] = useState('');
  const [groupDirectoryFilter, setGroupDirectoryFilter] = useState('all');
  const [expandedAddMemberGroupId, setExpandedAddMemberGroupId] = useState<number | null>(null);
  const [memberDrafts, setMemberDrafts] = useState<Record<number, number[]>>({});
  const [memberSearchDrafts, setMemberSearchDrafts] = useState<Record<number, string>>({});
  const [memberSearchSelectionDrafts, setMemberSearchSelectionDrafts] = useState<Record<number, number | null>>({});
  const [memberMoveDrafts, setMemberMoveDrafts] = useState<Record<string, string>>({});
  const [deletingGroupId, setDeletingGroupId] = useState<number | null>(null);
  const [assigneeDropdownOpen, setAssigneeDropdownOpen] = useState(false);
  const [taskForm, setTaskForm] = useState<TaskFormState>(createTaskFormState());

  const tasksQuery = useQuery({
    queryKey: queryKeys.tasks,
    queryFn: async () => (await taskApi.getAll()).data || [],
    refetchInterval: 5000,
  });

  const groupsQuery = useQuery({
    queryKey: queryKeys.groups,
    queryFn: async () => (await groupApi.getAll()).data?.data || [],
  });

  const usersQuery = useQuery({
    queryKey: queryKeys.users({ period: 'all' }),
    queryFn: async () => (await userApi.getAll({ period: 'all' })).data || [],
  });
  const projectsQuery = useQuery({
    queryKey: queryKeys.projects,
    queryFn: async () => (await projectApi.getAll()).data || [],
  });

  const tasks = tasksQuery.data || [];
  const groups = groupsQuery.data || [];
  const users = usersQuery.data || [];
  const projects = projectsQuery.data || [];
  const isManagerWithSingleGroup = user?.role === 'manager' && groups.length === 1;
  const managerGroupId = isManagerWithSingleGroup ? String(groups[0].id) : '';
  const resolvedGroupId = taskForm.group_id || managerGroupId;

  useEffect(() => {
    if (!isManagerWithSingleGroup) return;
    setTaskForm((current) => {
      if (current.group_id === managerGroupId) return current;
      return { ...current, group_id: managerGroupId, project_id: '', assignee_id: '', assignee_ids: [] };
    });
  }, [isManagerWithSingleGroup, managerGroupId]);
  const internalUsers = useMemo(
    () => users.filter((member) => member.role !== 'client'),
    [users]
  );
  const canManageGroupMember = (member: User) => member.role === 'employee' || (member.role === 'manager' && user?.role === 'admin');
  const isEligibleForDirectGroupAdd = (member: User) => canManageGroupMember(member) && (member.groups || []).length === 0;
  const selectedGroupId = resolvedGroupId ? Number(resolvedGroupId) : null;
  const availableAssignees = useMemo(
    () => users.filter((member) => !selectedGroupId || member.groups?.some((group) => group.id === selectedGroupId)),
    [selectedGroupId, users]
  );
  const availableProjects = useMemo(
    () => projects.filter((project) => !selectedGroupId || Number(project.group_id) === Number(selectedGroupId)),
    [projects, selectedGroupId]
  );

  const saveTaskMutation = useMutation({
    mutationFn: async (payload: TaskMutationPayload) => {
      if (editingTask) {
        await taskApi.update(editingTask.id, payload);
        return 'Task updated successfully.';
      }
      await taskApi.create(payload);
      return 'Task created successfully.';
    },
    onSuccess: async (message) => {
      setFeedback({ tone: 'success', message });
      setShowTaskModal(false);
      setEditingTask(null);
      setTaskForm(createTaskFormState(groupFilter === 'all' ? '' : groupFilter));
      await queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
    },
    onError: (error: any) => {
      const fieldError = Object.values(error?.response?.data?.errors || {}).flat().find(Boolean);
      setFeedback({ tone: 'error', message: String(fieldError || error?.response?.data?.message || 'Failed to save task.') });
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ taskId, status }: { taskId: number; status: SavedTaskStatus }) => taskApi.updateStatus(taskId, status),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
    },
  });

  const deleteTaskMutation = useMutation({
    mutationFn: async (taskId: number) => taskApi.delete(taskId),
    onSuccess: async () => {
      setFeedback({ tone: 'success', message: 'Task deleted successfully.' });
      await queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
    },
  });

  const syncMembershipMutation = useMutation({
    mutationFn: async ({ userId, groupIds, successMessage }: { userId: number; groupIds: number[]; successMessage: string }) => {
      await userApi.update(userId, { group_ids: groupIds });
      return successMessage;
    },
    onSuccess: async (message) => {
      setFeedback({ tone: 'success', message });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.groups }),
        queryClient.invalidateQueries({ queryKey: queryKeys.users({ period: 'all' }) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.tasks }),
      ]);
    },
    onError: (error: any) => {
      const fieldError = Object.values(error?.response?.data?.errors || {}).flat().find(Boolean);
      setFeedback({ tone: 'error', message: String(fieldError || error?.response?.data?.message || 'Failed to update group membership.') });
    },
  });

  const addMembersToGroupMutation = useMutation({
    mutationFn: async ({ group, members }: { group: Group; members: User[] }) => {
      await Promise.all(
        members.map((member) => {
          const nextGroupIds = Array.from(new Set([...(member.groups || []).map((currentGroup) => currentGroup.id), group.id]));
          return userApi.update(member.id, { group_ids: nextGroupIds });
        })
      );

      return { group, members };
    },
    onSuccess: async ({ group, members }) => {
      setFeedback({
        tone: 'success',
        message: members.length === 1
          ? `${members[0].name} was added to ${group.name}.`
          : `${members.length} members were added to ${group.name}.`,
      });
      setMemberDrafts((current) => ({ ...current, [group.id]: [] }));
      setMemberSearchDrafts((current) => ({ ...current, [group.id]: '' }));
      setMemberSearchSelectionDrafts((current) => ({ ...current, [group.id]: null }));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.groups }),
        queryClient.invalidateQueries({ queryKey: queryKeys.users({ period: 'all' }) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.tasks }),
      ]);
    },
    onError: (error: any) => {
      const fieldError = Object.values(error?.response?.data?.errors || {}).flat().find(Boolean);
      setFeedback({ tone: 'error', message: String(fieldError || error?.response?.data?.message || 'Failed to add members to the group.') });
    },
  });

  const deleteGroupMutation = useMutation({
    mutationFn: async (group: Group) => {
      await groupApi.delete(group.id);
      return group;
    },
    onMutate: (group) => {
      setDeletingGroupId(group.id);
    },
    onSuccess: async (group) => {
      setFeedback({ tone: 'success', message: `${group.name} was deleted.` });
      setGroupDirectoryFilter((current) => (current === String(group.id) ? 'all' : current));
      setGroupFilter((current) => (current === String(group.id) ? 'all' : current));
      setTaskForm((current) => (
        current.group_id === String(group.id)
          ? { ...current, group_id: '', project_id: '', assignee_id: '', assignee_ids: [] }
          : current
      ));

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.groups }),
        queryClient.invalidateQueries({ queryKey: queryKeys.users({ period: 'all' }) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.tasks }),
      ]);
    },
    onError: (error: any) => {
      const fieldError = Object.values(error?.response?.data?.errors || {}).flat().find(Boolean);
      setFeedback({ tone: 'error', message: String(fieldError || error?.response?.data?.message || 'Failed to delete group.') });
    },
    onSettled: () => {
      setDeletingGroupId(null);
    },
  });

  const isLoading = tasksQuery.isLoading || groupsQuery.isLoading || usersQuery.isLoading || projectsQuery.isLoading;
  const isError = tasksQuery.isError || groupsQuery.isError || usersQuery.isError || projectsQuery.isError;

  const filteredTasks = tasks.filter((task) => {
    const haystack = [task.title, task.description, task.group?.name, task.assignee?.name, task.assignee?.email]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    const matchesSearch = !searchQuery.trim() || haystack.includes(searchQuery.trim().toLowerCase());
    const matchesStatus = statusFilter === 'all' || task.status === statusFilter;
    const matchesGroup = groupFilter === 'all' || String(task.group_id || '') === groupFilter;
    const matchesAssignee = assigneeFilter === 'all' || String(task.assignee_id || '') === assigneeFilter;
    return matchesSearch && matchesStatus && matchesGroup && matchesAssignee;
  });
  const projectProgressRows = useMemo(() => {
    const byProject = new Map<number, { projectName: string; estimateMinutes: number; trackedMinutes: number; tasksCount: number }>();
    filteredTasks.forEach((task) => {
      const projectId = Number(task.project_id || 0);
      if (!projectId) return;
      const existing = byProject.get(projectId) || {
        projectName: task.project?.name || `Project ${projectId}`,
        estimateMinutes: 0,
        trackedMinutes: 0,
        tasksCount: 0,
      };
      existing.estimateMinutes += Number(task.estimated_time || 0);
      existing.trackedMinutes += Number(task.time_entries_sum_duration || 0) / 60;
      existing.tasksCount += 1;
      byProject.set(projectId, existing);
    });
    return Array.from(byProject.values())
      .map((row) => ({
        ...row,
        completionPercent: row.estimateMinutes > 0
          ? Math.max(0, Math.min(100, Math.round((row.trackedMinutes / row.estimateMinutes) * 100)))
          : 0,
      }))
      .sort((a, b) => b.completionPercent - a.completionPercent);
  }, [filteredTasks]);

  const hasDirectorySearch = groupDirectoryQuery.trim().length > 0;
  const hasDirectorySelection = groupDirectoryFilter !== 'all';
  const shouldShowDirectoryResults = hasDirectorySearch || hasDirectorySelection;

  const filteredDirectoryGroups = useMemo(() => {
    if (!shouldShowDirectoryResults) {
      return [];
    }

    const needle = groupDirectoryQuery.trim().toLowerCase();

    return groups.filter((group) => {
      const matchesSelectedGroup = groupDirectoryFilter === 'all' || String(group.id) === groupDirectoryFilter;
      if (!matchesSelectedGroup) return false;

      if (!needle) return true;

      const searchable = [group.name, group.description]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return searchable.includes(needle);
    });
  }, [groupDirectoryFilter, groupDirectoryQuery, groups, shouldShowDirectoryResults]);

  const findUserById = (userId: number) => users.find((candidate) => candidate.id === userId);

  const handleAddMemberToGroup = (group: Group) => {
    const selectedUserIds = memberDrafts[group.id] || [];
    if (selectedUserIds.length === 0) {
      setFeedback({ tone: 'error', message: `Select at least one eligible member to add into ${group.name}.` });
      return;
    }

    const members = selectedUserIds
      .map((userId) => findUserById(userId))
      .filter((member): member is User => Boolean(member) && canManageGroupMember(member));

    if (members.length === 0) {
      setFeedback({ tone: 'error', message: 'Selected team members could not be found.' });
      return;
    }

    addMembersToGroupMutation.mutate({ group, members });
  };

  const handleMoveEmployeeToGroup = (member: User, currentGroup: Group) => {
    const draftKey = `${currentGroup.id}:${member.id}`;
    const selectedTargetId = Number(memberMoveDrafts[draftKey] || 0);
    if (!selectedTargetId || selectedTargetId === currentGroup.id) {
      setFeedback({ tone: 'error', message: 'Choose a different group before moving this employee.' });
      return;
    }

    const targetGroup = groups.find((group) => group.id === selectedTargetId);
    if (!targetGroup) {
      setFeedback({ tone: 'error', message: 'Selected destination group could not be found.' });
      return;
    }

    syncMembershipMutation.mutate({
      userId: member.id,
      groupIds: [targetGroup.id],
      successMessage: `${member.name} was moved to ${targetGroup.name}.`,
    });

    setMemberMoveDrafts((current) => ({ ...current, [draftKey]: '' }));
  };

  const handleRemoveEmployeeFromGroup = (member: User, currentGroup: Group) => {
    const currentGroupIds = (member.groups || []).map((assignedGroup) => assignedGroup.id);
    const nextGroupIds = currentGroupIds.filter((groupId) => groupId !== currentGroup.id);

    if (nextGroupIds.length === 0) {
      setFeedback({
        tone: 'error',
        message: `${member.name} is currently only in ${currentGroup.name}. Move them to another group before removing this membership.`,
      });
      return;
    }

    syncMembershipMutation.mutate({
      userId: member.id,
      groupIds: nextGroupIds,
      successMessage: `${member.name} was removed from ${currentGroup.name}.`,
    });

    const draftKey = `${currentGroup.id}:${member.id}`;
    setMemberMoveDrafts((current) => ({ ...current, [draftKey]: '' }));
  };

  const handleDeleteGroup = (group: Group) => {
    if (!confirm(`Delete "${group.name}"? Members will be detached and tasks in this group will become ungrouped.`)) {
      return;
    }

    deleteGroupMutation.mutate(group);
  };

  if (isLoading) return <PageLoadingState label="Loading task workspace..." />;

  if (isError) {
    return (
      <PageErrorState
        message={(tasksQuery.error as any)?.response?.data?.message || (groupsQuery.error as any)?.response?.data?.message || (usersQuery.error as any)?.response?.data?.message || (projectsQuery.error as any)?.response?.data?.message || 'Failed to load tasks.'}
        onRetry={() => {
          void tasksQuery.refetch();
          void groupsQuery.refetch();
          void usersQuery.refetch();
          void projectsQuery.refetch();
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      {feedback ? <FeedbackBanner tone={feedback.tone} message={feedback.message} /> : null}

      <SurfaceCard className="p-6 sm:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-600">Task workspace</p>
            <h1 className="mt-3 max-w-3xl text-3xl font-semibold tracking-[-0.05em] text-slate-950">Manage tasks by group instead of project.</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">Each task now belongs to a department group, and assignees are limited to users inside that group.</p>
          </div>
          {canManageTasks ? (
            <div className="flex flex-wrap gap-3">
              {canCreateGroups ? (
                <Button
                  variant="secondary"
                  iconLeft={<Building2 className="h-4 w-4" />}
                  onClick={() => {
                    setGroupModalSource('workspace');
                    setShowGroupModal(true);
                  }}
                >
                  New Group
                </Button>
              ) : null}
              <Button iconLeft={<Plus className="h-4 w-4" />} onClick={() => {
                setEditingTask(null);
                setTaskForm(createTaskFormState(groupFilter === 'all' ? '' : groupFilter));
                setShowTaskModal(true);
              }}>New Task</Button>
            </div>
          ) : null}
        </div>
      </SurfaceCard>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Tasks In View" value={filteredTasks.length} hint="After filters" icon={CheckCircle2} accent="sky" />
        <MetricCard label="Completed" value={filteredTasks.filter((task) => task.status === 'done').length} hint="Marked done" icon={CheckCircle2} accent="emerald" />
        <MetricCard label="Overdue" value={filteredTasks.filter((task) => task.due_date && (toDate(task.due_date)?.getTime() || 0) < Date.now() && task.status !== 'done').length} hint="Open past deadline" icon={AlertTriangle} accent="rose" />
        <MetricCard label="Groups In View" value={groups.length} hint="Available departments" icon={Users2} accent="violet" />
      </div>

      {canManageTasks ? (
        <SurfaceCard className="p-5 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-600">Group directory</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-950">See every group and manage members from this page.</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">Add existing members into a group, review who is already inside each department, or move an employee directly to another group without leaving the task workspace.</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Quick rule</p>
              <p className="mt-2">Adding keeps existing memberships. Moving switches active assignment, and remove detaches the employee from this specific group.</p>
            </div>
          </div>

          <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,16rem)_auto] lg:items-end">
              <div>
                <FieldLabel>Search Group</FieldLabel>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <TextInput
                    aria-label="Search group directory"
                    value={groupDirectoryQuery}
                    onChange={(event) => setGroupDirectoryQuery(event.target.value)}
                    placeholder="Search group by name"
                    className="pl-10"
                  />
                </div>
              </div>
              <div>
                <FieldLabel>Group Dropdown</FieldLabel>
                <SelectInput
                  aria-label="Filter group directory"
                  value={groupDirectoryFilter}
                  onChange={(event) => setGroupDirectoryFilter(event.target.value)}
                >
                  <option value="all">All groups</option>
                  {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                </SelectInput>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setGroupDirectoryQuery('');
                  setGroupDirectoryFilter('all');
                }}
              >
                Reset
              </Button>
            </div>
            <p className="mt-3 text-xs text-slate-500">
              {shouldShowDirectoryResults
                ? `Showing ${filteredDirectoryGroups.length} of ${groups.length} group${groups.length === 1 ? '' : 's'}.`
                : 'Groups are hidden by default. Search by name or choose one group from the dropdown.'}
            </p>
          </div>

          {groups.length === 0 ? (
            <div className="mt-5 rounded-lg border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">No groups have been created yet. Create the first group to start organizing users and tasks.</div>
          ) : !shouldShowDirectoryResults ? (
            <div className="mt-5 rounded-lg border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">Search for a group name to view directory cards.</div>
          ) : filteredDirectoryGroups.length === 0 ? (
            <div className="mt-5 rounded-lg border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">No groups match your search right now. Try a different name or reset the group filters.</div>
          ) : (
            <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
              {filteredDirectoryGroups.map((group) => {
                const members = (group.users || [])
                  .map((member) => findUserById(member.id) || null)
                  .filter((member): member is User => Boolean(member) && member.role !== 'client');
                const selectedMemberIds = memberDrafts[group.id] || [];
                const memberSearchQuery = memberSearchDrafts[group.id] || '';
                const selectedSearchMemberId = memberSearchSelectionDrafts[group.id] ?? null;
                const availableMembers = internalUsers.filter((member) => isEligibleForDirectGroupAdd(member));
                const availableMemberSuggestions = buildSearchSuggestions(availableMembers, (member) => ({
                  id: member.id,
                  label: member.name,
                  description: `${member.email} • ${titleCase(member.role)}`,
                  searchValues: [member.name, member.email, member.role],
                  payload: member,
                }));
                const filteredAvailableMembers = availableMembers.filter((member) => {
                  if (selectedSearchMemberId) {
                    return Number(member.id) === Number(selectedSearchMemberId);
                  }

                  return matchesSearchFilter(memberSearchQuery, [member.name, member.email, member.role]);
                });

                return (
                  <div key={group.id} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">{group.name}</h3>
                          <span className={cn('rounded-full px-2.5 py-1 text-xs font-semibold', group.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600')}>
                            {group.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-slate-600">{group.description || 'No group description yet. Use this section to keep people and tasks aligned inside the same department.'}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700">
                          <Users className="h-3.5 w-3.5" />
                          {members.length} member{members.length === 1 ? '' : 's'}
                        </span>
                        <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          {group.tasks_count ?? tasks.filter((task) => task.group_id === group.id).length} task{(group.tasks_count ?? tasks.filter((task) => task.group_id === group.id).length) === 1 ? '' : 's'}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          iconLeft={<Trash2 className="h-4 w-4" />}
                          className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                          aria-label={`Delete group ${group.name}`}
                          disabled={deleteGroupMutation.isPending}
                          onClick={() => handleDeleteGroup(group)}
                        >
                          {deletingGroupId === group.id ? 'Deleting...' : 'Delete Group'}
                        </Button>
                      </div>
                    </div>

                    <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <FieldLabel hint={expandedAddMemberGroupId === group.id ? `${selectedMemberIds.length} selected` : undefined}>
                          Add Existing Member
                        </FieldLabel>
                        <Button
                          size="sm"
                          variant="secondary"
                          iconLeft={<UserPlus2 className="h-4 w-4" />}
                          aria-label={`${expandedAddMemberGroupId === group.id ? 'Close' : 'Open'} add member for ${group.name}`}
                          onClick={() => {
                            setExpandedAddMemberGroupId((current) => (current === group.id ? null : group.id));
                            setMemberDrafts((current) => ({ ...current, [group.id]: current[group.id] || [] }));
                          }}
                        >
                          {expandedAddMemberGroupId === group.id ? 'Close Add Member' : 'Add Member'}
                        </Button>
                      </div>

                      {expandedAddMemberGroupId === group.id ? (
                        <div className="mt-3 flex flex-col gap-3">
                          <div className="min-w-0 flex-1">
                            <SearchSuggestInput
                              aria-label={`Search eligible members for ${group.name}`}
                              value={memberSearchQuery}
                              onValueChange={(value) => {
                                setMemberSearchDrafts((current) => ({ ...current, [group.id]: value }));
                                const selectedMemberName = availableMembers.find((member) => Number(member.id) === Number(selectedSearchMemberId))?.name || '';
                                if (!value.trim() || normalizeSearchValue(value) !== normalizeSearchValue(selectedMemberName)) {
                                  setMemberSearchSelectionDrafts((current) => ({ ...current, [group.id]: null }));
                                }
                              }}
                              onSuggestionSelect={(suggestion) => {
                                const nextMemberId = Number((suggestion.payload as User | undefined)?.id || suggestion.id || 0);
                                setMemberSearchDrafts((current) => ({ ...current, [group.id]: getSuggestionDisplayValue(suggestion) }));
                                setMemberSearchSelectionDrafts((current) => ({
                                  ...current,
                                  [group.id]: Number.isFinite(nextMemberId) && nextMemberId > 0 ? nextMemberId : null,
                                }));
                              }}
                              suggestions={availableMemberSuggestions}
                              placeholder={availableMembers.length === 0 ? 'No unassigned eligible members available' : 'Search eligible members'}
                              className="border-slate-200 bg-white shadow-none focus:bg-white"
                              icon={<Search className="h-4 w-4" />}
                              emptyMessage="No eligible members match this search."
                              disabled={availableMembers.length === 0 || addMembersToGroupMutation.isPending}
                            />
                          </div>
                          {availableMembers.length === 0 ? (
                            <div className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">
                              Only unassigned employees and unassigned managers can be added here. Move existing members from their current group instead.
                            </div>
                          ) : (
                            <div className="max-h-56 space-y-2 overflow-auto pr-1">
                              {filteredAvailableMembers.map((member) => {
                                const checked = selectedMemberIds.includes(member.id);

                                return (
                                  <label
                                    key={member.id}
                                    className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-3 transition ${
                                      checked ? 'border-sky-300 bg-sky-50' : 'border-slate-200 bg-white hover:border-slate-300'
                                    }`}
                                  >
                                    <input
                                      type="checkbox"
                                      className="mt-1"
                                      checked={checked}
                                      onChange={(event) =>
                                        setMemberDrafts((current) => ({
                                          ...current,
                                          [group.id]: event.target.checked
                                            ? [...selectedMemberIds, member.id]
                                            : selectedMemberIds.filter((id) => id !== member.id),
                                        }))
                                      }
                                      disabled={addMembersToGroupMutation.isPending}
                                    />
                                    <div className="min-w-0">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <p className="text-sm font-semibold text-slate-950">{member.name}</p>
                                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">
                                          {titleCase(member.role)}
                                        </span>
                                      </div>
                                      <p className="mt-1 text-xs text-slate-500">{member.email}</p>
                                    </div>
                                  </label>
                                );
                              })}
                              {filteredAvailableMembers.length === 0 ? (
                                <div className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">
                                  No eligible members match this search.
                                </div>
                              ) : null}
                            </div>
                          )}
                          <div className="flex justify-end">
                            <Button
                              size="sm"
                              variant="secondary"
                              iconLeft={<UserPlus2 className="h-4 w-4" />}
                              aria-label={`Add members to ${group.name}`}
                              disabled={selectedMemberIds.length === 0 || addMembersToGroupMutation.isPending}
                              onClick={() => handleAddMemberToGroup(group)}
                            >
                              {addMembersToGroupMutation.isPending
                                ? 'Saving...'
                                : selectedMemberIds.length > 1
                                  ? 'Add Members'
                                  : 'Add Member'}
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </div>

                    <div className="mt-5 space-y-3">
                      {members.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">No members are assigned to this group yet.</div>
                      ) : (
                        members.map((member) => {
                          const moveKey = `${group.id}:${member.id}`;
                          const canManageMembership = member.role === 'employee' || (member.role === 'manager' && user?.role === 'admin');

                          return (
                            <div key={moveKey} className="rounded-lg border border-slate-200 bg-white p-4">
                              <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="font-semibold text-slate-950">{member.name}</p>
                                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">{titleCase(member.role)}</span>
                                  </div>
                                  <p className="mt-1 truncate text-sm text-slate-500">{member.email}</p>
                                  <p className="mt-2 text-xs text-slate-500">
                                    Current group{(member.groups || []).length === 1 ? '' : 's'}: {(member.groups || []).map((assignedGroup) => assignedGroup.name).join(', ') || 'None'}
                                  </p>
                                </div>

                                {canManageMembership ? (
                                  <div className="grid min-w-full gap-3 xl:min-w-[22rem]">
                                    <SelectInput
                                      aria-label={`Move ${member.name} to another group`}
                                      value={memberMoveDrafts[moveKey] || ''}
                                      onChange={(event) => setMemberMoveDrafts((current) => ({ ...current, [moveKey]: event.target.value }))}
                                      disabled={groups.length <= 1 || syncMembershipMutation.isPending}
                                    >
                                      <option value="">{groups.length <= 1 ? 'Create another group first' : 'Move member to another group'}</option>
                                      {groups.filter((targetGroup) => targetGroup.id !== group.id).map((targetGroup) => (
                                        <option key={targetGroup.id} value={targetGroup.id}>
                                          {targetGroup.name}
                                        </option>
                                      ))}
                                    </SelectInput>
                                    <div className="flex flex-wrap gap-2 sm:justify-end">
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        iconLeft={<ArrowRightLeft className="h-4 w-4" />}
                                        aria-label={`Move ${member.name}`}
                                        disabled={!memberMoveDrafts[moveKey] || syncMembershipMutation.isPending}
                                        onClick={() => handleMoveEmployeeToGroup(member, group)}
                                      >
                                        {syncMembershipMutation.isPending ? 'Moving...' : 'Move'}
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        iconLeft={<Trash2 className="h-4 w-4" />}
                                        aria-label={`Remove ${member.name} from ${group.name}`}
                                        className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                                        disabled={(member.groups || []).length <= 1 || syncMembershipMutation.isPending}
                                        onClick={() => handleRemoveEmployeeFromGroup(member, group)}
                                      >
                                        {syncMembershipMutation.isPending ? 'Removing...' : 'Remove'}
                                      </Button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="rounded-full bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600">
                                    {member.role === 'manager'
                                      ? 'Only admins can move or remove managers here.'
                                      : 'Move action is available for employees here.'}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </SurfaceCard>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {STATUS_OPTIONS.map((section) => (
          <SurfaceCard key={section.value} className="overflow-hidden p-0">
            <div className={cn('border-b px-5 py-4', section.accent)}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{section.label}</p>
                  <h2 className="mt-2 text-lg font-semibold text-slate-950">{filteredTasks.filter((task) => task.status === section.value).length} task{filteredTasks.filter((task) => task.status === section.value).length === 1 ? '' : 's'}</h2>
                </div>
                {canManageTasks ? <Button variant="ghost" size="sm" onClick={() => {
                  setEditingTask(null);
                  setTaskForm(createTaskFormState(groupFilter === 'all' ? '' : groupFilter, section.value));
                  setShowTaskModal(true);
                }}>Add Task</Button> : null}
              </div>
            </div>
            <div className="max-h-[38rem] space-y-4 overflow-y-auto p-4">
              {filteredTasks.filter((task) => task.status === section.value).map((task) => (
                <article key={task.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">{titleCase(task.status)}</span>
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">{titleCase(task.priority || 'medium')}</span>
                      </div>
                      <h3 className="mt-3 text-lg font-semibold tracking-[-0.03em] text-slate-950">{task.title}</h3>
                      <p className="mt-2 text-sm leading-6 text-slate-600">{task.description || 'No description yet.'}</p>
                    </div>
                    {canManageTasks ? (
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => {
                          setEditingTask(task);
                          setTaskForm({
                            title: task.title,
                            description: task.description || '',
                            group_id: task.group_id ? String(task.group_id) : '',
                            project_id: task.project_id ? String(task.project_id) : '',
                            assignee_id: task.assignee_id ? String(task.assignee_id) : '',
                            assignee_ids: (task.assignees?.map((member) => String(member.id)) || (task.assignee_id ? [String(task.assignee_id)] : [])),
                            status: (task.status === 'in_review' ? 'todo' : task.status) as SavedTaskStatus,
                            priority: task.priority || 'medium',
                            due_date: task.due_date?.split('T')[0] || '',
                            estimated_time: task.estimated_time ? String(task.estimated_time) : '',
                          });
                          setShowTaskModal(true);
                        }} className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"><Edit2 className="h-4 w-4" /></button>
                        <button type="button" onClick={() => {
                          if (!confirm('Delete this task?')) return;
                          void deleteTaskMutation.mutate(task.id);
                        }} className="rounded-full p-2 text-slate-400 transition hover:bg-rose-100 hover:text-rose-700"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    ) : null}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button type="button" onClick={() => setGroupFilter((current) => current === String(task.group_id || '') ? 'all' : String(task.group_id || ''))} className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700">
                      <Building2 className="h-3.5 w-3.5" />
                      {task.group?.name || 'Ungrouped'}
                    </button>
                  </div>
                  <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <TaskDetail icon={UserRound} label="Assignee" value={task.assignees?.length ? task.assignees.map((member) => member.name).join(', ') : task.assignee?.name || 'Unassigned'} />
                    <TaskDetail icon={CalendarDays} label="Due Date" value={formatDate(task.due_date)} />
                    <TaskDetail icon={TimerReset} label="Estimate" value={formatMinutes(task.estimated_time)} />
                    <TaskDetail icon={Clock3} label="Tracked" value={formatTrackedTime(task.time_entries_sum_duration)} />
                    <TaskDetail icon={CheckCircle2} label="Completion" value={`${getTaskCompletionPercent(task)}%`} />
                    <TaskDetail icon={Clock3} label="Updated" value={formatDate(task.updated_at)} />
                  </div>
                  <div className="mt-3">
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-sky-500 transition-all" style={{ width: `${getTaskCompletionPercent(task)}%` }} />
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-200 pt-4">
                    {task.status !== 'todo' ? <Button variant="ghost" size="sm" onClick={() => void updateStatusMutation.mutate({ taskId: task.id, status: 'todo' })}>Move To Do</Button> : null}
                    {task.status !== 'in_progress' ? <Button variant="ghost" size="sm" onClick={() => void updateStatusMutation.mutate({ taskId: task.id, status: 'in_progress' })}>Start Work</Button> : null}
                    {task.status !== 'done' ? <Button variant="ghost" size="sm" onClick={() => void updateStatusMutation.mutate({ taskId: task.id, status: 'done' })}>Mark Done</Button> : null}
                  </div>
                </article>
              ))}
              {filteredTasks.filter((task) => task.status === section.value).length === 0 ? <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">No tasks in this column.</div> : null}
            </div>
          </SurfaceCard>
        ))}
      </div>

      {showTaskModal ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-white p-6 shadow-sm sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-600">Task composer</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-950">{editingTask ? 'Edit task' : 'Create task'}</h2>
              </div>
              <button type="button" onClick={() => setShowTaskModal(false)} className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"><X className="h-5 w-5" /></button>
            </div>
            <form className="mt-6 space-y-4" onSubmit={(event) => {
              event.preventDefault();
              if (!resolvedGroupId) {
                setFeedback({ tone: 'error', message: 'Select a group before saving this task.' });
                return;
              }
              void saveTaskMutation.mutate({
                title: taskForm.title.trim(),
                description: taskForm.description.trim() || undefined,
                group_id: Number(resolvedGroupId),
                project_id: taskForm.project_id ? Number(taskForm.project_id) : null,
                assignee_id: taskForm.assignee_id ? Number(taskForm.assignee_id) : null,
                assignee_ids: taskForm.assignee_ids.map((id) => Number(id)),
                status: taskForm.status,
                priority: taskForm.priority,
                due_date: taskForm.due_date || undefined,
                estimated_time: taskForm.estimated_time ? Number(taskForm.estimated_time) : undefined,
              });
            }}>
              <div>
                <FieldLabel>Task Title</FieldLabel>
                <TextInput required value={taskForm.title} onChange={(event) => setTaskForm((current) => ({ ...current, title: event.target.value }))} placeholder="Prepare weekly performance review" />
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <div className="mb-1.5 flex items-center justify-between gap-3">
                    <label className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Group</label>
                    {canCreateGroups ? (
                      <button
                        type="button"
                        onClick={() => {
                          setGroupModalSource('task-form');
                          setShowGroupModal(true);
                        }}
                        className="text-xs font-semibold text-sky-600 transition hover:text-sky-700"
                      >
                        + Create new group
                      </button>
                    ) : null}
                  </div>
                  {isManagerWithSingleGroup ? (
                    <div className="min-h-11 w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700">
                      {groups[0]?.name || 'Assigned group'}
                    </div>
                  ) : (
                    <SelectInput required value={taskForm.group_id} onChange={(event) => setTaskForm((current) => ({ ...current, group_id: event.target.value, project_id: '', assignee_id: '', assignee_ids: [] }))}>
                      <option value="">Select group</option>
                      {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                    </SelectInput>
                  )}
                </div>
                <div>
                  <FieldLabel>Project</FieldLabel>
                  <SelectInput value={taskForm.project_id} onChange={(event) => setTaskForm((current) => ({ ...current, project_id: event.target.value }))} disabled={!resolvedGroupId}>
                    <option value="">{!resolvedGroupId ? 'Select group first' : 'No project'}</option>
                    {availableProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                  </SelectInput>
                </div>
                <div>
                  <FieldLabel>Assign To</FieldLabel>
                  <div className="relative">
                    <button
                      type="button"
                      className="flex min-h-11 w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-800 shadow-sm transition hover:border-slate-300 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
                      disabled={!resolvedGroupId}
                      onClick={() => setAssigneeDropdownOpen((current) => !current)}
                    >
                      <span className="truncate">
                        {!resolvedGroupId
                          ? 'Select group first'
                          : taskForm.assignee_ids.length === 0
                            ? 'Unassigned'
                            : `${taskForm.assignee_ids.length} employee${taskForm.assignee_ids.length === 1 ? '' : 's'} selected`}
                      </span>
                      <span className="text-slate-500">{assigneeDropdownOpen ? '▴' : '▾'}</span>
                    </button>
                    {assigneeDropdownOpen && resolvedGroupId ? (
                      <div className="absolute z-30 mt-2 max-h-56 w-full overflow-auto rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
                        {availableAssignees.length === 0 ? (
                          <p className="px-2 py-2 text-xs text-slate-500">No employees available for this group.</p>
                        ) : availableAssignees.map((member) => {
                          const checked = taskForm.assignee_ids.includes(String(member.id));
                          return (
                            <label key={member.id} className={`mb-1 flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm ${checked ? 'bg-sky-50 text-sky-900' : 'text-slate-700 hover:bg-slate-50'}`}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(event) => {
                                  setTaskForm((current) => {
                                    const nextIds = new Set(current.assignee_ids);
                                    if (event.target.checked) nextIds.add(String(member.id));
                                    else nextIds.delete(String(member.id));
                                    const ordered = availableAssignees
                                      .map((item) => String(item.id))
                                      .filter((id) => nextIds.has(id));
                                    return {
                                      ...current,
                                      assignee_ids: ordered,
                                      assignee_id: ordered[0] || '',
                                    };
                                  });
                                }}
                              />
                              <span className="truncate">{member.name}</span>
                            </label>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                  <p className="mt-2 text-xs text-slate-500">{!resolvedGroupId ? 'Select group first' : 'Click employees in dropdown to select multiple assignees.'}</p>
                </div>
                <div>
                  <FieldLabel>Status</FieldLabel>
                  <SelectInput value={taskForm.status} onChange={(event) => setTaskForm((current) => ({ ...current, status: event.target.value as SavedTaskStatus }))}>
                    {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </SelectInput>
                </div>
                <div>
                  <FieldLabel>Priority</FieldLabel>
                  <SelectInput value={taskForm.priority} onChange={(event) => setTaskForm((current) => ({ ...current, priority: event.target.value as TaskPriority }))}>
                    {PRIORITY_OPTIONS.map((priority) => <option key={priority} value={priority}>{titleCase(priority)}</option>)}
                  </SelectInput>
                </div>
                <div>
                  <FieldLabel>Due Date</FieldLabel>
                  <TextInput type="date" value={taskForm.due_date} onChange={(event) => setTaskForm((current) => ({ ...current, due_date: event.target.value }))} />
                </div>
                <div>
                  <FieldLabel>Estimated Time</FieldLabel>
                  <TextInput type="number" min="0" value={taskForm.estimated_time} onChange={(event) => setTaskForm((current) => ({ ...current, estimated_time: event.target.value }))} placeholder="120" />
                </div>
              </div>
              <div>
                <FieldLabel>Description</FieldLabel>
                <TextareaInput rows={5} value={taskForm.description} onChange={(event) => setTaskForm((current) => ({ ...current, description: event.target.value }))} placeholder="Capture acceptance criteria, blockers, links, or the expected outcome." />
              </div>
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <Button variant="secondary" onClick={() => setShowTaskModal(false)}>Cancel</Button>
                <Button type="submit" disabled={saveTaskMutation.isPending || groups.length === 0}>{saveTaskMutation.isPending ? 'Saving...' : editingTask ? 'Update Task' : 'Create Task'}</Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      <QuickCreateGroupDialog
        open={showGroupModal}
        onClose={() => setShowGroupModal(false)}
        onCreated={(group) => {
          if (groupModalSource === 'task-form') {
            setTaskForm((current) => ({ ...current, group_id: String(group.id) }));
          }
        }}
        title="Create a group without leaving tasks"
        description="Add the new department here and it will be available immediately in the task form."
      />

      {projectProgressRows.length > 0 ? (
        <SurfaceCard className="mt-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Project Progress</p>
              <h3 className="mt-1 text-lg font-semibold text-slate-950">Task-wise completion from estimated vs tracked time</h3>
            </div>
          </div>
          <div className="mt-4 space-y-3">
            {projectProgressRows.map((row) => (
              <div key={row.projectName} className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <p className="font-semibold text-slate-900">{row.projectName}</p>
                  <p className="text-slate-600">{row.completionPercent}% complete</p>
                </div>
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${row.completionPercent}%` }} />
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  {formatMinutes(row.estimateMinutes)} estimated, {formatMinutes(Math.round(row.trackedMinutes))} tracked, {row.tasksCount} task{row.tasksCount === 1 ? '' : 's'}
                </p>
              </div>
            ))}
          </div>
        </SurfaceCard>
      ) : null}
    </div>
  );
}

function TaskDetail({ icon: Icon, label, value }: { icon: typeof UserRound; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
        <Icon className="h-3.5 w-3.5" />
        <span>{label}</span>
      </div>
      <p className="mt-2 text-sm font-medium text-slate-950">{value}</p>
    </div>
  );
}
