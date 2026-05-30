import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent, useDraggable, useDroppable } from '@dnd-kit/core';
import { AlertTriangle, Building2, CalendarDays, CheckCircle2, Clock3, Edit2, Eye, EyeOff, GripVertical, History, Image, Paperclip, Plus, Send, TimerReset, Trash2, UserRound, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import MetricCard from '@/components/dashboard/MetricCard';
import Button from '@/components/ui/Button';
import { FeedbackBanner, PageErrorState, PageLoadingState } from '@/components/ui/PageState';
import { FieldLabel, SelectInput, TextInput, TextareaInput } from '@/components/ui/FormField';
import { queryKeys } from '@/lib/queryKeys';
import { groupApi, projectApi, taskApi, taskLabelApi, userApi } from '@/services/api';
import type { Project, Task, TaskActivity, TaskAttachment, TaskChecklistItem, TaskComment, TaskDependency, TaskLabel, TaskRecurrence } from '@/types';
import { cn } from '@/utils/cn';

type SavedTaskStatus = Exclude<Task['status'], 'in_review'>;
type TaskPriority = Task['priority'];
type TaskMutationPayload = Partial<Task> & { assignee_ids?: number[]; label_ids?: number[] };

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
  remind_at: string;
  label_ids: string[];
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
  remind_at: '',
  label_ids: [],
});

const titleCase = (value?: string | null) => value ? value.replace(/_/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase()) : '';
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
const formatRelativeTime = (dateString: string) => {
  const now = Date.now();
  const date = new Date(dateString).getTime();
  const diffMs = now - date;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(dateString).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

const getTaskCompletionPercent = (task: Task) => {
  const estimated = Number(task.estimated_time || 0);
  const tracked = Number(task.time_entries_sum_duration || 0);
  if (estimated <= 0 && tracked <= 0) return 0;
  if (estimated <= 0) return tracked > 0 ? 100 : 0;
  return Math.min(100, Math.round((tracked / (estimated * 60)) * 100));
};

function KanbanColumn({ status, children, accent }: { status: string; children: React.ReactNode; accent: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: `column-${status}` });
  return (
    <div ref={setNodeRef} className={cn('rounded-lg border', isOver ? 'border-sky-400 bg-sky-50/30' : 'border-transparent', 'transition-colors')}>
      {children}
    </div>
  );
}

function DraggableTask({ task, children }: { task: Task; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `task-${task.id}`, data: { task } });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} className={isDragging ? 'opacity-40' : ''}>
      {children}
    </div>
  );
}

export default function Tasks() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const userLevel = user?.hierarchy_level ?? (user?.role === 'admin' ? 10 : user?.role === 'manager' ? 50 : 100);
  const canManageTasks = userLevel <= 50;
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | SavedTaskStatus>('all');
  const [groupFilter, setGroupFilter] = useState('all');
  const [assigneeFilter, setAssigneeFilter] = useState('all');
  const [labelFilter, setLabelFilter] = useState('all');
  const [assigneeDropdownOpen, setAssigneeDropdownOpen] = useState(false);
  const [taskForm, setTaskForm] = useState<TaskFormState>(createTaskFormState());
  const [expandedTaskId, setExpandedTaskId] = useState<number | null>(null);
  const [activities, setActivities] = useState<TaskActivity[]>([]);
  const [watchingStates, setWatchingStates] = useState<Record<number, { watching: boolean; watchers_count: number }>>({});
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [commentText, setCommentText] = useState('');
  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [checklistItems, setChecklistItems] = useState<TaskChecklistItem[]>([]);
  const [newChecklistTitle, setNewChecklistTitle] = useState('');
  const [dependencies, setDependencies] = useState<TaskDependency[]>([]);
  const [newDependencyTaskId, setNewDependencyTaskId] = useState('');
  const [recurrenceData, setRecurrenceData] = useState<TaskRecurrence | null>(null);
  const [showRecurrenceForm, setShowRecurrenceForm] = useState(false);
  const [recurrenceForm, setRecurrenceForm] = useState({ frequency: 'weekly', interval_value: 1, days_of_week: '' as string, day_of_month: '' as string, end_date: '' as string });
  const [activeDragTask, setActiveDragTask] = useState<Task | null>(null);

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
  const availableLabels: TaskLabel[] = labelsQuery.data || [];
  const isManagerWithSingleGroup = userLevel > 10 && userLevel < 100 && groups.length === 1;
  const managerGroupId = isManagerWithSingleGroup ? String(groups[0].id) : '';
  const resolvedGroupId = taskForm.group_id || managerGroupId;

  useEffect(() => {
    if (!isManagerWithSingleGroup) return;
    setTaskForm((current) => {
      if (current.group_id === managerGroupId) return current;
      return { ...current, group_id: managerGroupId, project_id: '', assignee_id: '', assignee_ids: [] };
    });
  }, [isManagerWithSingleGroup, managerGroupId]);
  const selectedGroupId = resolvedGroupId ? Number(resolvedGroupId) : null;
  const availableAssignees = useMemo(
    () => users.filter((member) => !selectedGroupId || member.groups?.some((group) => group.id === selectedGroupId)),
    [selectedGroupId, users]
  );
  const availableProjects = useMemo(
    () => projects.filter((project) => !selectedGroupId || Number(project.group_id) === Number(selectedGroupId)),
    [projects, selectedGroupId]
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
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

  useEffect(() => {
    if (expandedTaskId === null) {
      setActivities([]);
      setComments([]);
      setAttachments([]);
      setChecklistItems([]);
      setDependencies([]);
      setRecurrenceData(null);
      setShowRecurrenceForm(false);
      return;
    }
    taskApi.getActivities(expandedTaskId).then((res) => {
      setActivities(res.data || []);
    }).catch(() => setActivities([]));
    taskApi.watchStatus(expandedTaskId).then((res) => {
      setWatchingStates((prev) => ({ ...prev, [expandedTaskId]: res.data }));
    }).catch(() => {});
    taskApi.getComments(expandedTaskId).then((res) => {
      setComments(res.data || []);
    }).catch(() => setComments([]));
    taskApi.getAttachments(expandedTaskId).then((res) => {
      setAttachments(res.data || []);
    }).catch(() => setAttachments([]));
    taskApi.getChecklistItems(expandedTaskId).then((res) => {
      setChecklistItems(res.data || []);
    }).catch(() => setChecklistItems([]));
    taskApi.getChecklistItems(expandedTaskId).then((res) => {
      setChecklistItems(res.data || []);
    }).catch(() => setChecklistItems([]));
    taskApi.getDependencies(expandedTaskId).then((res) => {
      setDependencies(res.data || []);
    }).catch(() => setDependencies([]));
    taskApi.getRecurrence(expandedTaskId).then((res) => {
      setRecurrenceData(res.data || null);
    }).catch(() => setRecurrenceData(null));
    setShowRecurrenceForm(false);
  }, [expandedTaskId]);

  const watchMutation = useMutation({
    mutationFn: async (taskId: number) => taskApi.watch(taskId),
    onSuccess: (res, taskId) => {
      setWatchingStates((prev) => ({ ...prev, [taskId]: res.data }));
    },
  });

  const unwatchMutation = useMutation({
    mutationFn: async (taskId: number) => taskApi.unwatch(taskId),
    onSuccess: (res, taskId) => {
      setWatchingStates((prev) => ({ ...prev, [taskId]: res.data }));
    },
  });

  const deleteTaskMutation = useMutation({
    mutationFn: async (taskId: number) => taskApi.delete(taskId),
    onSuccess: async () => {
      setFeedback({ tone: 'success', message: 'Task deleted successfully.' });
      await queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
    },
  });


  const isLoading = tasksQuery.isLoading || groupsQuery.isLoading || usersQuery.isLoading || projectsQuery.isLoading || labelsQuery.isLoading;
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
    const matchesLabel = labelFilter === 'all' || (task.labels?.some((l) => String(l.id) === labelFilter) ?? false);
    return matchesSearch && matchesStatus && matchesGroup && matchesAssignee && matchesLabel;
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
            <h1 className="mt-3 max-w-3xl text-3xl font-semibold tracking-[-0.05em] text-slate-950">Manage tasks by department instead of project.</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">Each task now belongs to a department, and assignees are limited to users inside that department.</p>
          </div>
          {canManageTasks ? (
            <div className="flex flex-wrap gap-3">
              <Button iconLeft={<Plus className="h-4 w-4" />} onClick={() => {
                setEditingTask(null);
                setTaskForm(createTaskFormState(groupFilter === 'all' ? '' : groupFilter));
                setShowTaskModal(true);
              }}>New Task</Button>
            </div>
          ) : null}
        </div>
      </SurfaceCard>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <MetricCard label="Tasks In View" value={filteredTasks.length} hint="After filters" icon={CheckCircle2} accent="sky" />
        <MetricCard label="Completed" value={filteredTasks.filter((task) => task.status === 'done').length} hint="Marked done" icon={CheckCircle2} accent="emerald" />
        <MetricCard label="Overdue" value={filteredTasks.filter((task) => task.due_date && (toDate(task.due_date)?.getTime() || 0) < Date.now() && task.status !== 'done').length} hint="Open past deadline" icon={AlertTriangle} accent="rose" />
      </div>

      <SurfaceCard className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-[200px] flex-1">
            <TextInput
              placeholder="Search tasks..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <SelectInput value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'all' | SavedTaskStatus)} className="w-36">
            <option value="all">All Status</option>
            {STATUS_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </SelectInput>
          <SelectInput value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)} className="w-44">
            <option value="all">All Departments</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </SelectInput>
          <SelectInput value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)} className="w-40">
            <option value="all">All Assignees</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </SelectInput>
          <SelectInput value={labelFilter} onChange={(e) => setLabelFilter(e.target.value)} className="w-40">
            <option value="all">All Labels</option>
            {(tasks.flatMap((t) => t.labels ?? []).filter((l, i, arr) => arr.findIndex((x) => x.id === l.id) === i)).map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </SelectInput>
          <Button variant="ghost" size="sm" onClick={() => {
            setSearchQuery('');
            setStatusFilter('all');
            setGroupFilter('all');
            setAssigneeFilter('all');
            setLabelFilter('all');
          }}>Clear</Button>
        </div>
      </SurfaceCard>

      <DndContext
        sensors={sensors}
        onDragStart={(event: DragStartEvent) => {
          const task = event.active.data.current?.task as Task | undefined;
          setActiveDragTask(task ?? null);
        }}
        onDragEnd={(event: DragEndEvent) => {
          setActiveDragTask(null);
          const { active, over } = event;
          if (!over) return;
          const taskId = Number(String(active.id).replace('task-', ''));
          const targetColumn = String(over.id).replace('column-', '');
          const validStatuses: SavedTaskStatus[] = ['todo', 'in_progress', 'done'];
          if (!validStatuses.includes(targetColumn as SavedTaskStatus)) return;
          const task = tasks.find((t) => t.id === taskId);
          if (!task || task.status === targetColumn) return;
          void updateStatusMutation.mutate({ taskId, status: targetColumn as SavedTaskStatus });
        }}
      >
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {STATUS_OPTIONS.map((section) => (
          <KanbanColumn key={section.value} status={section.value} accent={section.accent}>
          <SurfaceCard className="overflow-hidden p-0">
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
                <DraggableTask key={task.id} task={task}>
                <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
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
                            remind_at: task.remind_at?.split('T')[0] || '',
                            label_ids: task.labels?.map((l) => String(l.id)) || [],
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
                      {task.group?.name || 'Unassigned department'}
                    </button>
                    {task.labels?.map((label) => (
                      <span key={label.id} className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold text-white" style={{ backgroundColor: label.color }}>
                        {label.name}
                      </span>
                    ))}
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
                    {canManageTasks && task.status !== 'todo' ? <Button variant="ghost" size="sm" onClick={() => void updateStatusMutation.mutate({ taskId: task.id, status: 'todo' })}>Move To Do</Button> : null}
                    {canManageTasks && task.status !== 'in_progress' ? <Button variant="ghost" size="sm" onClick={() => void updateStatusMutation.mutate({ taskId: task.id, status: 'in_progress' })}>Start Work</Button> : null}
                    {canManageTasks && task.status !== 'done' ? <Button variant="ghost" size="sm" onClick={() => void updateStatusMutation.mutate({ taskId: task.id, status: 'done' })}>Mark Done</Button> : null}
                    <Button
                      variant="ghost"
                      size="sm"
                      iconLeft={expandedTaskId === task.id ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      onClick={() => setExpandedTaskId(expandedTaskId === task.id ? null : task.id)}
                    >
                      {expandedTaskId === task.id ? 'Hide Details' : 'View Details'}
                    </Button>
                  </div>
                  {expandedTaskId === task.id ? (
                    <div className="mt-4 border-t border-slate-200 pt-4">
                      <div className="mb-3 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <History className="h-4 w-4 text-slate-500" />
                          <h4 className="text-sm font-semibold text-slate-700">Activity</h4>
                        </div>
                        <div className="flex items-center gap-2">
                          {watchingStates[task.id]?.watching ? (
                            <Button variant="secondary" size="sm"
                              iconLeft={<EyeOff className="h-4 w-4" />}
                              onClick={() => void unwatchMutation.mutate(task.id)}
                              disabled={unwatchMutation.isPending}
                            >Watching ({watchingStates[task.id]?.watchers_count ?? 0})</Button>
                          ) : (
                            <Button variant="ghost" size="sm"
                              iconLeft={<Eye className="h-4 w-4" />}
                              onClick={() => void watchMutation.mutate(task.id)}
                              disabled={watchMutation.isPending}
                            >Watch</Button>
                          )}
                        </div>
                      </div>
                      <div className="max-h-48 space-y-2 overflow-y-auto">
                        {activities.length === 0 ? (
                          <p className="text-sm text-slate-500">No activity yet.</p>
                        ) : activities.map((act) => (
                          <div key={act.id} className="flex items-start gap-3 rounded-md bg-slate-50 p-2.5">
                            <div className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-sky-400" />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm text-slate-700">{act.description}</p>
                              <p className="mt-0.5 text-xs text-slate-500">
                                {act.actor?.name ?? 'Someone'} &middot; {formatRelativeTime(act.created_at)}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="mt-4 border-t border-slate-200 pt-4">
                        <div className="mb-3 flex items-center gap-2">
                          <Paperclip className="h-4 w-4 text-slate-500" />
                          <h4 className="text-sm font-semibold text-slate-700">Attachments</h4>
                        </div>
                        <div className="space-y-2">
                          {attachments.length === 0 ? (
                            <p className="text-sm text-slate-500">No attachments yet.</p>
                          ) : attachments.map((att) => (
                            <div key={att.id} className="flex items-center justify-between rounded-md bg-slate-50 p-2.5">
                              <div className="flex items-center gap-2 min-w-0">
                                <Image className="h-4 w-4 shrink-0 text-slate-400" />
                                <span className="truncate text-sm text-slate-700">{att.original_filename}</span>
                                <span className="shrink-0 text-xs text-slate-400">
                                  {att.file_size ? `${(att.file_size / 1024).toFixed(1)} KB` : ''}
                                </span>
                              </div>
                              {canManageTasks || att.user_id === user?.id ? (
                                <Button variant="ghost" size="sm"
                                  onClick={async () => {
                                    try {
                                      await taskApi.deleteAttachment(att.id);
                                      setAttachments((prev) => prev.filter((a) => a.id !== att.id));
                                    } catch {}
                                  }}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              ) : null}
                            </div>
                          ))}
                          <div className="mt-2">
                            <input
                              ref={fileInputRef}
                              type="file"
                              className="hidden"
                              onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                setUploading(true);
                                try {
                                  const formData = new FormData();
                                  formData.append('file', file);
                                  const res = await taskApi.createAttachment(expandedTaskId!, formData);
                                  setAttachments((prev) => [res.data, ...prev]);
                                } catch {} finally {
                                  setUploading(false);
                                  if (fileInputRef.current) fileInputRef.current.value = '';
                                }
                              }}
                            />
                            <Button variant="secondary" size="sm"
                              iconLeft={<Plus className="h-4 w-4" />}
                              disabled={uploading}
                              onClick={() => fileInputRef.current?.click()}
                            >
                              {uploading ? 'Uploading...' : 'Add file'}
                            </Button>
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 border-t border-slate-200 pt-4">
                        <div className="mb-3 flex items-center gap-2">
                          <Send className="h-4 w-4 text-slate-500" />
                          <h4 className="text-sm font-semibold text-slate-700">Comments</h4>
                        </div>
                        <div className="mb-3 flex gap-2">
                          <TextInput
                            className="flex-1"
                            placeholder="Write a comment..."
                            value={commentText}
                            onChange={(e) => setCommentText(e.target.value)}
                            onKeyDown={async (e) => {
                              if (e.key === 'Enter' && !e.shiftKey && commentText.trim()) {
                                e.preventDefault();
                                try {
                                  const res = await taskApi.createComment(expandedTaskId!, { content: commentText.trim() });
                                  setComments((prev) => [res.data, ...prev]);
                                  setCommentText('');
                                } catch {}
                              }
                            }}
                          />
                          <Button size="sm"
                            disabled={!commentText.trim()}
                            onClick={async () => {
                              try {
                                const res = await taskApi.createComment(expandedTaskId!, { content: commentText.trim() });
                                setComments((prev) => [res.data, ...prev]);
                                setCommentText('');
                              } catch {}
                            }}
                          >
                            <Send className="h-4 w-4" />
                          </Button>
                        </div>
                        <div className="max-h-48 space-y-2 overflow-y-auto">
                          {comments.length === 0 ? (
                            <p className="text-sm text-slate-500">No comments yet.</p>
                          ) : comments.map((c) => (
                            <div key={c.id} className="flex items-start justify-between gap-2 rounded-md bg-slate-50 p-2.5">
                              <div className="min-w-0 flex-1">
                                <p className="text-sm text-slate-700">{c.content}</p>
                                <p className="mt-0.5 text-xs text-slate-500">
                                  {c.user?.name ?? 'Someone'} &middot; {formatRelativeTime(c.created_at)}
                                </p>
                              </div>
                              {canManageTasks || c.user_id === user?.id ? (
                                <Button variant="ghost" size="sm"
                                  onClick={async () => {
                                    try {
                                      await taskApi.deleteComment(c.id);
                                      setComments((prev) => prev.filter((x) => x.id !== c.id));
                                    } catch {}
                                  }}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="mt-4 border-t border-slate-200 pt-4">
                        <div className="mb-3 flex items-center gap-2">
                          <CheckCircle2 className="h-4 w-4 text-slate-500" />
                          <h4 className="text-sm font-semibold text-slate-700">Checklist</h4>
                        </div>
                        <div className="space-y-1">
                          {checklistItems.length === 0 ? (
                            <p className="text-sm text-slate-500">No checklist items yet.</p>
                          ) : checklistItems.map((item) => (
                            <div key={item.id} className="flex items-center gap-2 rounded-md bg-slate-50 px-2.5 py-1.5">
                              <input
                                type="checkbox"
                                checked={item.is_completed}
                                onChange={async () => {
                                  try {
                                    const res = await taskApi.updateChecklistItem(item.id, { is_completed: !item.is_completed });
                                    setChecklistItems((prev) => prev.map((ci) => ci.id === item.id ? res.data : ci));
                                  } catch {}
                                }}
                                className="h-4 w-4 rounded border-slate-300 text-sky-600"
                              />
                              <span className={cn('flex-1 text-sm', item.is_completed ? 'text-slate-400 line-through' : 'text-slate-700')}>{item.title}</span>
                              <button type="button" onClick={async () => {
                                try {
                                  await taskApi.deleteChecklistItem(item.id);
                                  setChecklistItems((prev) => prev.filter((ci) => ci.id !== item.id));
                                } catch {}
                              }} className="text-slate-400 hover:text-rose-600"><Trash2 className="h-3.5 w-3.5" /></button>
                            </div>
                          ))}
                          <div className="flex gap-2 pt-1">
                            <TextInput
                              className="flex-1"
                              placeholder="Add checklist item..."
                              value={newChecklistTitle}
                              onChange={(e) => setNewChecklistTitle(e.target.value)}
                              onKeyDown={async (e) => {
                                if (e.key === 'Enter' && newChecklistTitle.trim()) {
                                  e.preventDefault();
                                  try {
                                    const res = await taskApi.createChecklistItem(expandedTaskId!, { title: newChecklistTitle.trim() });
                                    setChecklistItems((prev) => [...prev, res.data]);
                                    setNewChecklistTitle('');
                                  } catch {}
                                }
                              }}
                            />
                            <Button size="sm" disabled={!newChecklistTitle.trim()} onClick={async () => {
                              try {
                                const res = await taskApi.createChecklistItem(expandedTaskId!, { title: newChecklistTitle.trim() });
                                setChecklistItems((prev) => [...prev, res.data]);
                                setNewChecklistTitle('');
                              } catch {}
                            }}><Plus className="h-4 w-4" /></Button>
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 border-t border-slate-200 pt-4">
                        <div className="mb-3 flex items-center gap-2">
                          <AlertTriangle className="h-4 w-4 text-slate-500" />
                          <h4 className="text-sm font-semibold text-slate-700">Dependencies</h4>
                        </div>
                        <div className="space-y-1">
                          {dependencies.length === 0 ? (
                            <p className="text-sm text-slate-500">No dependencies.</p>
                          ) : dependencies.map((dep) => (
                            <div key={dep.id} className="flex items-center justify-between gap-2 rounded-md bg-slate-50 px-2.5 py-1.5">
                              <span className="text-sm text-slate-700">
                                Blocked by: {dep.depends_on_task?.title ?? `Task #${dep.depends_on_task_id}`}
                              </span>
                              <button type="button" onClick={async () => {
                                try {
                                  await taskApi.deleteDependency(dep.id);
                                  setDependencies((prev) => prev.filter((d) => d.id !== dep.id));
                                } catch {}
                              }} className="text-slate-400 hover:text-rose-600"><Trash2 className="h-3.5 w-3.5" /></button>
                            </div>
                          ))}
                          {canManageTasks ? (
                            <div className="flex gap-2 pt-1">
                              <SelectInput
                                value={newDependencyTaskId}
                                onChange={(e) => setNewDependencyTaskId(e.target.value)}
                                className="flex-1"
                              >
                                <option value="">Select task to depend on...</option>
                                {tasks.filter((t) => t.id !== expandedTaskId && !dependencies.some((d) => d.depends_on_task_id === t.id)).map((t) => (
                                  <option key={t.id} value={t.id}>{t.title}</option>
                                ))}
                              </SelectInput>
                              <Button size="sm" disabled={!newDependencyTaskId} onClick={async () => {
                                try {
                                  const res = await taskApi.createDependency(expandedTaskId!, Number(newDependencyTaskId));
                                  setDependencies((prev) => [...prev, res.data]);
                                  setNewDependencyTaskId('');
                                } catch {}
                              }}><Plus className="h-4 w-4" /></Button>
                            </div>
                          ) : null}
                        </div>
                      </div>

                      <div className="mt-4 border-t border-slate-200 pt-4">
                        <div className="mb-3 flex items-center gap-2">
                          <Clock3 className="h-4 w-4 text-slate-500" />
                          <h4 className="text-sm font-semibold text-slate-700">Recurrence</h4>
                        </div>
                        {recurrenceData ? (
                          <div className="space-y-2 rounded-md bg-slate-50 p-3">
                            <div className="flex items-center justify-between">
                              <div className="text-sm text-slate-700">
                                <span className="font-medium">{titleCase(recurrenceData.frequency)}</span>
                                {recurrenceData.interval_value > 1 && <span> every {recurrenceData.interval_value}</span>}
                                {recurrenceData.days_of_week?.length ? <span> on {recurrenceData.days_of_week.map((d: number) => ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d]).join(', ')}</span> : null}
                                {recurrenceData.day_of_month ? <span> on day {recurrenceData.day_of_month}</span> : null}
                                {recurrenceData.end_date ? <span> until {formatDate(recurrenceData.end_date)}</span> : null}
                              </div>
                              <div className="flex items-center gap-2">
                                <label className="flex items-center gap-1.5 text-xs text-slate-600">
                                  <input
                                    type="checkbox"
                                    checked={recurrenceData.is_active}
                                    onChange={async () => {
                                      try {
                                        const res = await taskApi.updateRecurrence(recurrenceData.id, { is_active: !recurrenceData.is_active });
                                        setRecurrenceData(res.data);
                                      } catch {}
                                    }}
                                    className="h-3.5 w-3.5 rounded border-slate-300 text-sky-600"
                                  />
                                  Active
                                </label>
                                <button type="button" onClick={async () => {
                                  if (!confirm('Remove this recurrence rule?')) return;
                                  try {
                                    await taskApi.deleteRecurrence(recurrenceData.id);
                                    setRecurrenceData(null);
                                  } catch {}
                                }} className="text-slate-400 hover:text-rose-600"><Trash2 className="h-3.5 w-3.5" /></button>
                              </div>
                            </div>
                            {recurrenceData.next_run_date && (
                              <p className="text-xs text-slate-500">Next run: {formatDate(recurrenceData.next_run_date)}</p>
                            )}
                          </div>
                        ) : null}
                        {canManageTasks && showRecurrenceForm ? (
                          <div className="mt-2 space-y-2 rounded-md border border-slate-200 bg-white p-3">
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Frequency</label>
                                <SelectInput value={recurrenceForm.frequency} onChange={(e) => setRecurrenceForm((cur) => ({ ...cur, frequency: e.target.value }))}>
                                  <option value="daily">Daily</option>
                                  <option value="weekly">Weekly</option>
                                  <option value="monthly">Monthly</option>
                                  <option value="yearly">Yearly</option>
                                </SelectInput>
                              </div>
                              <div>
                                <label className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Interval</label>
                                <TextInput type="number" min="1" value={recurrenceForm.interval_value} onChange={(e) => setRecurrenceForm((cur) => ({ ...cur, interval_value: Number(e.target.value) || 1 }))} />
                              </div>
                              {recurrenceForm.frequency === 'weekly' ? (
                                <div>
                                  <label className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Days of Week</label>
                                  <TextInput placeholder="e.g. 1,3,5 (Mon,Wed,Fri)" value={recurrenceForm.days_of_week} onChange={(e) => setRecurrenceForm((cur) => ({ ...cur, days_of_week: e.target.value }))} />
                                </div>
                              ) : null}
                              {recurrenceForm.frequency === 'monthly' ? (
                                <div>
                                  <label className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Day of Month</label>
                                  <TextInput type="number" min="1" max="31" value={recurrenceForm.day_of_month} onChange={(e) => setRecurrenceForm((cur) => ({ ...cur, day_of_month: e.target.value }))} />
                                </div>
                              ) : null}
                              <div>
                                <label className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">End Date</label>
                                <TextInput type="date" value={recurrenceForm.end_date} onChange={(e) => setRecurrenceForm((cur) => ({ ...cur, end_date: e.target.value }))} />
                              </div>
                            </div>
                            <div className="flex justify-end gap-2">
                              <Button variant="ghost" size="sm" onClick={() => setShowRecurrenceForm(false)}>Cancel</Button>
                              <Button size="sm" onClick={async () => {
                                if (!expandedTaskId) return;
                                try {
                                  const payload: any = {
                                    frequency: recurrenceForm.frequency,
                                    interval_value: recurrenceForm.interval_value,
                                  };
                                  if (recurrenceForm.frequency === 'weekly' && recurrenceForm.days_of_week.trim()) {
                                    payload.days_of_week = recurrenceForm.days_of_week.split(',').map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n));
                                  }
                                  if (recurrenceForm.frequency === 'monthly' && recurrenceForm.day_of_month.trim()) {
                                    payload.day_of_month = Number(recurrenceForm.day_of_month);
                                  }
                                  if (recurrenceForm.end_date.trim()) {
                                    payload.end_date = recurrenceForm.end_date;
                                  }
                                  const res = await taskApi.storeRecurrence(expandedTaskId, payload);
                                  setRecurrenceData(res.data);
                                  setShowRecurrenceForm(false);
                                  setRecurrenceForm({ frequency: 'weekly', interval_value: 1, days_of_week: '', day_of_month: '', end_date: '' });
                                } catch {}
                              }}>
                                {recurrenceData ? 'Update' : 'Create'} Recurrence
                              </Button>
                            </div>
                          </div>
                        ) : null}
                        {!recurrenceData && canManageTasks && !showRecurrenceForm ? (
                          <Button variant="secondary" size="sm" iconLeft={<Plus className="h-4 w-4" />} onClick={() => setShowRecurrenceForm(true)}>
                            Set up recurrence
                          </Button>
                        ) : null}
                        {recurrenceData && canManageTasks && !showRecurrenceForm ? (
                          <Button variant="ghost" size="sm" iconLeft={<Edit2 className="h-4 w-4" />} onClick={() => {
                            setRecurrenceForm({
                              frequency: recurrenceData.frequency,
                              interval_value: recurrenceData.interval_value,
                              days_of_week: recurrenceData.days_of_week?.join(',') || '',
                              day_of_month: recurrenceData.day_of_month ? String(recurrenceData.day_of_month) : '',
                              end_date: recurrenceData.end_date?.split('T')[0] || '',
                            });
                            setShowRecurrenceForm(true);
                          }}>
                            Edit recurrence
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </article>
                </DraggableTask>
              ))}
              {filteredTasks.filter((task) => task.status === section.value).length === 0 ? <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">No tasks in this column.</div> : null}
            </div>
          </SurfaceCard>
          </KanbanColumn>
        ))}
      </div>
      </DndContext>
      <DragOverlay>
        {activeDragTask ? (
          <div className="rounded-lg border border-sky-400 bg-white p-4 shadow-lg opacity-90">
            <p className="text-sm font-semibold">{activeDragTask.title}</p>
          </div>
        ) : null}
      </DragOverlay>

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
                setFeedback({ tone: 'error', message: 'Select a department before saving this task.' });
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
                remind_at: taskForm.remind_at || undefined,
                label_ids: taskForm.label_ids.map((id) => Number(id)),
              });
            }}>
              <div>
                <FieldLabel>Task Title</FieldLabel>
                <TextInput required value={taskForm.title} onChange={(event) => setTaskForm((current) => ({ ...current, title: event.target.value }))} placeholder="Prepare weekly performance review" />
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <div className="mb-1.5 flex items-center justify-between gap-3">
                    <label className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Department</label>
                  </div>
                  {isManagerWithSingleGroup ? (
                    <div className="min-h-11 w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700">
                      {groups[0]?.name || 'Assigned department'}
                    </div>
                  ) : (
                    <SelectInput required value={taskForm.group_id} onChange={(event) => setTaskForm((current) => ({ ...current, group_id: event.target.value, project_id: '', assignee_id: '', assignee_ids: [] }))}>
                      <option value="">Select department</option>
                      {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                    </SelectInput>
                  )}
                </div>
                <div>
                  <FieldLabel>Project</FieldLabel>
                  <SelectInput value={taskForm.project_id} onChange={(event) => setTaskForm((current) => ({ ...current, project_id: event.target.value }))} disabled={!resolvedGroupId}>
                    <option value="">{!resolvedGroupId ? 'Select department first' : 'No project'}</option>
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
                          ? 'Select department first'
                          : taskForm.assignee_ids.length === 0
                            ? 'Unassigned'
                            : `${taskForm.assignee_ids.length} employee${taskForm.assignee_ids.length === 1 ? '' : 's'} selected`}
                      </span>
                      <span className="text-slate-500">{assigneeDropdownOpen ? '▴' : '▾'}</span>
                    </button>
                    {assigneeDropdownOpen && resolvedGroupId ? (
                      <div className="absolute z-30 mt-2 max-h-56 w-full overflow-auto rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
                        {availableAssignees.length === 0 ? (
                          <p className="px-2 py-2 text-xs text-slate-500">No employees available for this department.</p>
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
                  <p className="mt-2 text-xs text-slate-500">{!resolvedGroupId ? 'Select department first' : 'Click employees in dropdown to select multiple assignees.'}</p>
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
                <div>
                  <FieldLabel>Labels</FieldLabel>
                  <div className="flex min-h-11 w-full flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2">
                    {taskForm.label_ids.length === 0 ? (
                      <span className="text-sm text-slate-400">Select labels...</span>
                    ) : taskForm.label_ids.map((id) => {
                      const label = availableLabels.find((l) => String(l.id) === id);
                      return label ? (
                        <span key={id} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold text-white" style={{ backgroundColor: label.color }}>
                          {label.name}
                          <button type="button" onClick={() => setTaskForm((cur) => ({ ...cur, label_ids: cur.label_ids.filter((x) => x !== id) }))}>
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ) : null;
                    })}
                  </div>
                  {availableLabels.length > 0 ? (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {availableLabels.filter((l) => !taskForm.label_ids.includes(String(l.id))).map((label) => (
                        <button type="button" key={label.id}
                          className="rounded-full px-2 py-0.5 text-xs font-semibold text-white opacity-80 hover:opacity-100"
                          style={{ backgroundColor: label.color }}
                          onClick={() => setTaskForm((cur) => ({ ...cur, label_ids: [...cur.label_ids, String(label.id)] }))}
                        >
                          + {label.name}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div>
                  <FieldLabel>Reminder Date</FieldLabel>
                  <TextInput type="date" value={taskForm.remind_at} onChange={(event) => setTaskForm((current) => ({ ...current, remind_at: event.target.value }))} />
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
