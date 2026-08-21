import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { FeedbackBanner, PageErrorState, PageLoadingState } from '@/components/ui/PageState';
import { useComposeAction } from '@/hooks/useComposeAction';
import { COMPOSE_KEYS } from '@/lib/commandRegistry';
import { queryKeys } from '@/lib/queryKeys';
import { groupApi, projectApi, taskApi, taskLabelApi, userApi } from '@/services/api';
import type { Task, TaskLabel } from '@/types';
import TaskBoardView from '@/features/tasks/TaskBoardView';
import TaskComposerModal, {
  createTaskFormState,
  taskToFormState,
  type TaskFormState,
} from '@/features/tasks/TaskComposerModal';
import TaskDetailPanel from '@/features/tasks/TaskDetailPanel';
import TaskListView from '@/features/tasks/TaskListView';
import TaskToolbar from '@/features/tasks/TaskToolbar';
import { type TaskStatus } from '@/features/tasks/taskConstants';
import { formatTrackedTime, isOverdue } from '@/features/tasks/taskUtils';
import { useTaskViewState } from '@/features/tasks/useTaskViewState';
import { apiErrorMessage } from '@/lib/apiErrorMessage';

type TaskMutationPayload = Partial<Task> & { assignee_ids?: number[]; label_ids?: number[] };

/**
 * Data, mutations and layout for the task workspace. The views, the composer
 * and the detail drawer live in `features/tasks/` — this file used to hold all
 * of them plus comments, attachments, checklists, dependencies and recurrence
 * in one 1,200-line component.
 */
export default function Tasks() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const userLevel = user?.hierarchy_level ?? (user?.role === 'admin' ? 10 : user?.role === 'manager' ? 50 : 100);
  const canManageTasks = userLevel <= 50;

  const { state, update, reset, hasActiveFilters } = useTaskViewState();

  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  /*
   * Prefer whatever the server said over the caller's wording. Several task
   * actions are refused for reasons a retry cannot fix — a circular dependency,
   * an edge that already exists — and every one of them used to surface as
   * "Please try again."
   */
  const notifyError = (message: string, error: unknown) => {
    console.error(message, error);
    setFeedback({ tone: 'error', message: apiErrorMessage(error, message) });
  };

  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [showComposer, setShowComposer] = useState(false);
  const [taskForm, setTaskForm] = useState<TaskFormState>(createTaskFormState());
  const [openTaskId, setOpenTaskId] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Task | null>(null);

  // "Create task" in the command bar lands here with the form already open.
  useComposeAction(COMPOSE_KEYS.task, () => {
    if (canManageTasks) setShowComposer(true);
  });

  const tasksQuery = useQuery({
    queryKey: queryKeys.tasks,
    queryFn: async () => (await taskApi.getAll()).data || [],
    // Was every 5s, unconditionally, for the entire unpaginated task list —
    // 12 full fetches a minute per open tab, including tabs left in the
    // background all day. Tasks do not change that fast, and React Query
    // already refetches on window focus, which covers "I came back to this
    // tab and want it current" far more cheaply.
    refetchInterval: (query) => (document.visibilityState === 'visible' ? 30000 : false),
    refetchOnWindowFocus: true,
  });
  const groupsQuery = useQuery({
    queryKey: queryKeys.groups,
    queryFn: async () => (await groupApi.getAll()).data?.data || [],
  });
  const usersQuery = useQuery({
    queryKey: queryKeys.users({ period: 'all' }),
    queryFn: async () => (await userApi.getAll({ period: 'all' })).data || [],
  });
  const labelsQuery = useQuery({
    queryKey: queryKeys.taskLabels,
    queryFn: async () => (await taskLabelApi.getAll()).data || [],
  });
  const projectsQuery = useQuery({
    queryKey: queryKeys.projects,
    queryFn: async () => {
      const payload: any = (await projectApi.getAll()).data;
      if (Array.isArray(payload)) return payload;
      if (Array.isArray(payload?.data)) return payload.data;
      return [];
    },
  });

  const tasks = tasksQuery.data || [];
  const groups = groupsQuery.data || [];
  const users = usersQuery.data || [];
  const projects = Array.isArray(projectsQuery.data) ? projectsQuery.data : [];
  const labels: TaskLabel[] = labelsQuery.data || [];

  const isManagerWithSingleGroup = userLevel > 10 && userLevel < 100 && groups.length === 1;
  const lockedGroupId = isManagerWithSingleGroup ? String(groups[0].id) : '';

  useEffect(() => {
    if (!lockedGroupId) return;
    setTaskForm((current) =>
      current.group_id === lockedGroupId
        ? current
        : { ...current, group_id: lockedGroupId, project_id: '', assignee_id: '', assignee_ids: [] }
    );
  }, [lockedGroupId]);

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
      setShowComposer(false);
      setEditingTask(null);
      setTaskForm(createTaskFormState(lockedGroupId || (state.department === 'all' ? '' : state.department)));
      await queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
    },
    onError: (error: any) => {
      const fieldError = Object.values(error?.response?.data?.errors || {})
        .flat()
        .find(Boolean);
      setFeedback({
        tone: 'error',
        message: String(fieldError || error?.response?.data?.message || 'Failed to save task.'),
      });
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ taskId, status }: { taskId: number; status: TaskStatus }) =>
      taskApi.updateStatus(taskId, status),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
    },
    onError: (error: unknown) => notifyError('Could not move that task. Please try again.', error),
  });

  const deleteTaskMutation = useMutation({
    mutationFn: async (taskId: number) => taskApi.delete(taskId),
    onSuccess: async () => {
      setFeedback({ tone: 'success', message: 'Task deleted successfully.' });
      setPendingDelete(null);
      setOpenTaskId(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
    },
    onError: (error: unknown) => notifyError('Could not delete that task. Please try again.', error),
  });

  const filteredTasks = useMemo(() => {
    const needle = state.search.trim().toLowerCase();
    return tasks.filter((task) => {
      const haystack = [task.title, task.description, task.group?.name, task.assignee?.name, task.assignee?.email]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      if (needle && !haystack.includes(needle)) return false;
      if (state.status !== 'all' && task.status !== state.status) return false;
      if (state.department !== 'all' && String(task.group_id || '') !== state.department) return false;
      if (state.label !== 'all' && !task.labels?.some((label) => String(label.id) === state.label)) return false;
      if (state.assignee !== 'all') {
        const matches =
          String(task.assignee_id || '') === state.assignee ||
          task.assignees?.some((member) => String(member.id) === state.assignee);
        if (!matches) return false;
      }
      return true;
    });
  }, [tasks, state.search, state.status, state.department, state.assignee, state.label]);

  const summary = useMemo(
    () => ({
      open: filteredTasks.filter((task) => task.status !== 'done').length,
      overdue: filteredTasks.filter(isOverdue).length,
      tracked: filteredTasks.reduce((total, task) => total + Number(task.time_entries_sum_duration || 0), 0),
    }),
    [filteredTasks]
  );

  // The drawer reads from the live list rather than a snapshot, so a task that
  // is polled or edited while open updates in place instead of going stale.
  const openTask = openTaskId === null ? null : tasks.find((task) => task.id === openTaskId) ?? null;

  const startCreate = (status: TaskStatus = 'todo') => {
    setEditingTask(null);
    setTaskForm(createTaskFormState(lockedGroupId || (state.department === 'all' ? '' : state.department), status));
    setShowComposer(true);
  };

  const startEdit = (task: Task) => {
    setEditingTask(task);
    setTaskForm(taskToFormState(task));
    setOpenTaskId(null);
    setShowComposer(true);
  };

  if (
    tasksQuery.isLoading ||
    groupsQuery.isLoading ||
    usersQuery.isLoading ||
    projectsQuery.isLoading ||
    labelsQuery.isLoading
  ) {
    return <PageLoadingState label="Loading tasks..." />;
  }

  if (tasksQuery.isError || groupsQuery.isError || usersQuery.isError || projectsQuery.isError) {
    return (
      <PageErrorState
        message={
          (tasksQuery.error as any)?.response?.data?.message ||
          (groupsQuery.error as any)?.response?.data?.message ||
          (usersQuery.error as any)?.response?.data?.message ||
          (projectsQuery.error as any)?.response?.data?.message ||
          'Failed to load tasks.'
        }
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
    <div className="space-y-4">
      {feedback ? <FeedbackBanner tone={feedback.tone} message={feedback.message} /> : null}

      {/* Three metric cards used to sit here. They cost ~140px of vertical
          space above the list to say what one line of text says just as well —
          and the whole point of this view is seeing tasks, not counters. */}
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h1 className="text-2xl font-semibold tracking-[-0.03em] text-slate-950">Tasks</h1>
        <p className="text-sm text-slate-600">
          <span className="font-medium text-slate-700">{summary.open}</span> open
          {summary.overdue > 0 ? (
            <>
              {' · '}
              <span className="font-medium text-rose-700">{summary.overdue}</span> overdue
            </>
          ) : null}
          {summary.tracked > 0 ? <> · {formatTrackedTime(summary.tracked)} tracked</> : null}
          {hasActiveFilters ? ' · filtered' : null}
        </p>
      </div>

      <TaskToolbar
        state={state}
        onChange={update}
        onReset={reset}
        hasActiveFilters={hasActiveFilters}
        groups={groups}
        users={users}
        labels={labels}
        canManageTasks={canManageTasks}
        onNewTask={() => startCreate()}
        resultCount={filteredTasks.length}
      />

      {state.view === 'list' ? (
        <TaskListView
          tasks={filteredTasks}
          groupBy={state.groupBy}
          canManageTasks={canManageTasks}
          onOpenTask={(task) => setOpenTaskId(task.id)}
          onChangeStatus={(task, status) => updateStatusMutation.mutate({ taskId: task.id, status })}
          onDeleteTask={setPendingDelete}
        />
      ) : (
        <TaskBoardView
          tasks={filteredTasks}
          canManageTasks={canManageTasks}
          onOpenTask={(task) => setOpenTaskId(task.id)}
          onChangeStatus={(task, status) => updateStatusMutation.mutate({ taskId: task.id, status })}
          onAddTask={(status) => startCreate(status)}
        />
      )}

      {openTask ? (
        <TaskDetailPanel
          task={openTask}
          allTasks={tasks}
          canManageTasks={canManageTasks}
          currentUserId={user?.id}
          onClose={() => setOpenTaskId(null)}
          onEdit={startEdit}
          onDelete={setPendingDelete}
          onChangeStatus={(task, status) => updateStatusMutation.mutate({ taskId: task.id, status })}
          notifyError={notifyError}
        />
      ) : null}

      {showComposer && canManageTasks ? (
        <TaskComposerModal
          isEditing={Boolean(editingTask)}
          form={taskForm}
          onChange={(patch) => setTaskForm((current) => ({ ...current, ...patch }))}
          onClose={() => {
            setShowComposer(false);
            setEditingTask(null);
          }}
          onSubmit={(resolvedGroupId) => {
            if (!resolvedGroupId) {
              setFeedback({ tone: 'error', message: 'Select a department before saving this task.' });
              return;
            }
            saveTaskMutation.mutate({
              title: taskForm.title.trim(),
              description: taskForm.description.trim() || undefined,
              group_id: Number(resolvedGroupId),
              project_id: taskForm.project_id ? Number(taskForm.project_id) : null,
              assignee_id: taskForm.assignee_id ? Number(taskForm.assignee_id) : null,
              assignee_ids: taskForm.assignee_ids.map((id) => Number(id)),
              status: taskForm.status,
              type: taskForm.type,
              priority: taskForm.priority,
              due_date: taskForm.due_date || undefined,
              estimated_time: taskForm.estimated_time ? Number(taskForm.estimated_time) : undefined,
              remind_at: taskForm.remind_at || undefined,
              label_ids: taskForm.label_ids.map((id) => Number(id)),
            });
          }}
          isSaving={saveTaskMutation.isPending}
          groups={groups}
          users={users}
          projects={projects}
          labels={labels}
          lockedGroupId={lockedGroupId}
        />
      ) : null}

      <ConfirmDialog
        isOpen={Boolean(pendingDelete)}
        tone="danger"
        title="Delete this task?"
        message={
          pendingDelete
            ? `"${pendingDelete.title}" and its comments, attachments and checklist will be removed. This cannot be undone.`
            : ''
        }
        confirmLabel="Delete task"
        isLoading={deleteTaskMutation.isPending}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) deleteTaskMutation.mutate(pendingDelete.id);
        }}
      />
    </div>
  );
}
