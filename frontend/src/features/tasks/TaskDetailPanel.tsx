import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Edit2,
  Eye,
  EyeOff,
  History,
  Paperclip,
  Plus,
  Send,
  Trash2,
} from 'lucide-react';
import Button from '@/components/ui/Button';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import SlideOver from '@/features/employees/SlideOver';
import { SelectInput, TextInput } from '@/components/ui/FormField';
import { taskApi } from '@/services/api';
import type {
  Task,
  TaskActivity,
  TaskAttachment,
  TaskChecklistItem,
  TaskComment,
  TaskDependency,
  TaskRecurrence,
} from '@/types';
import { cn } from '@/utils/cn';
import { getReadableTextColor } from '@/utils/getContrastColor';
import { PRIORITY_META, STATUS_OPTIONS, type TaskStatus } from './taskConstants';
import {
  formatDateLong,
  formatMinutes,
  formatRelativeTime,
  formatTrackedTime,
  getAssigneeLabel,
  getTaskCompletionPercent,
  titleCase,
} from './taskUtils';
import { TaskKey, TaskResolutionChip, TaskTypeChip } from './TaskIdentity';

interface TaskDetailPanelProps {
  task: Task;
  allTasks: Task[];
  canManageTasks: boolean;
  currentUserId?: number;
  onClose: () => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  onChangeStatus: (task: Task, status: TaskStatus) => void;
  notifyError: (message: string, error: unknown) => void;
}

function Section({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: typeof History;
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="border-t border-slate-200 pt-4">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <Icon className="h-4 w-4 text-slate-600" aria-hidden="true" />
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">{label}</p>
      <p className="mt-1 truncate text-sm font-medium text-slate-950" title={value}>
        {value}
      </p>
    </div>
  );
}

/**
 * Everything that used to expand inline underneath a board card now lives in a
 * drawer. The old expansion pushed the whole column down, so opening a task on
 * a busy board moved every other card out from under the cursor.
 */
export default function TaskDetailPanel({
  task,
  allTasks,
  canManageTasks,
  currentUserId,
  onClose,
  onEdit,
  onDelete,
  onChangeStatus,
  notifyError,
}: TaskDetailPanelProps) {
  const taskId = task.id;

  const [activities, setActivities] = useState<TaskActivity[]>([]);
  const [watchState, setWatchState] = useState<{ watching: boolean; watchers_count: number } | null>(null);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [commentText, setCommentText] = useState('');
  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [checklistItems, setChecklistItems] = useState<TaskChecklistItem[]>([]);
  const [newChecklistTitle, setNewChecklistTitle] = useState('');
  const [dependencies, setDependencies] = useState<TaskDependency[]>([]);
  const [newDependencyTaskId, setNewDependencyTaskId] = useState('');
  const [recurrence, setRecurrence] = useState<TaskRecurrence | null>(null);
  const [showRecurrenceForm, setShowRecurrenceForm] = useState(false);
  const [confirmRemoveRecurrence, setConfirmRemoveRecurrence] = useState(false);
  const [recurrenceForm, setRecurrenceForm] = useState({
    frequency: 'weekly',
    interval_value: 1,
    days_of_week: '',
    day_of_month: '',
    end_date: '',
  });

  useEffect(() => {
    let cancelled = false;

    // Each panel open refetches; `cancelled` stops a slow response from an
    // earlier task painting over the one now on screen.
    const load = <T,>(promise: Promise<{ data: T }>, apply: (value: T) => void, fallback: T) => {
      promise
        .then((response) => {
          if (!cancelled) apply(response.data ?? fallback);
        })
        .catch(() => {
          if (!cancelled) apply(fallback);
        });
    };

    load(taskApi.getActivities(taskId), setActivities, [] as TaskActivity[]);
    load(taskApi.getComments(taskId), setComments, [] as TaskComment[]);
    load(taskApi.getAttachments(taskId), setAttachments, [] as TaskAttachment[]);
    load(taskApi.getChecklistItems(taskId), setChecklistItems, [] as TaskChecklistItem[]);
    load(taskApi.getDependencies(taskId), setDependencies, [] as TaskDependency[]);
    load(taskApi.getRecurrence(taskId), setRecurrence, null as TaskRecurrence | null);
    taskApi
      .watchStatus(taskId)
      .then((response) => {
        if (!cancelled) setWatchState(response.data);
      })
      .catch(() => undefined);

    setShowRecurrenceForm(false);
    setCommentText('');
    setNewChecklistTitle('');
    setNewDependencyTaskId('');

    return () => {
      cancelled = true;
    };
  }, [taskId]);

  const postComment = async () => {
    const content = commentText.trim();
    if (!content) return;
    try {
      const response = await taskApi.createComment(taskId, { content });
      setComments((previous) => [response.data, ...previous]);
      setCommentText('');
    } catch (error) {
      notifyError('Could not post your comment. Please try again.', error);
    }
  };

  const addChecklistItem = async () => {
    const title = newChecklistTitle.trim();
    if (!title) return;
    try {
      const response = await taskApi.createChecklistItem(taskId, { title });
      setChecklistItems((previous) => [...previous, response.data]);
      setNewChecklistTitle('');
    } catch (error) {
      notifyError('Could not add checklist item. Please try again.', error);
    }
  };

  const completionPercent = getTaskCompletionPercent(task);
  const doneCount = checklistItems.filter((item) => item.is_completed).length;

  return (
    <SlideOver
      open
      onClose={onClose}
      title={task.title}
      subtitle={[task.key, task.group?.name || 'No department', getAssigneeLabel(task)].filter(Boolean).join(' · ')}
      footer={
        canManageTasks ? (
          <>
            <Button variant="ghost" iconLeft={<Trash2 className="h-4 w-4" />} onClick={() => onDelete(task)}>
              Delete
            </Button>
            <Button variant="secondary" iconLeft={<Edit2 className="h-4 w-4" />} onClick={() => onEdit(task)}>
              Edit
            </Button>
          </>
        ) : null
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {canManageTasks ? (
            STATUS_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => onChangeStatus(task, option.value)}
                aria-pressed={task.status === option.value}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300',
                  task.status === option.value
                    ? 'border-blue-700 bg-blue-700 text-on-brand'
                    : 'border-slate-200 bg-surface-card text-slate-700 hover:border-slate-300'
                )}
              >
                {option.label}
              </button>
            ))
          ) : (
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
              {titleCase(task.status)}
            </span>
          )}
        </div>

        {task.description ? (
          <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{task.description}</p>
        ) : (
          <p className="text-sm italic text-slate-600">No description.</p>
        )}

        {task.labels?.length ? (
          <div className="flex flex-wrap gap-1.5">
            {task.labels.map((label) => (
              <span
                key={label.id}
                className="rounded-full px-2 py-0.5 text-xs font-semibold"
                style={{ backgroundColor: label.color, color: getReadableTextColor(label.color) }}
              >
                {label.name}
              </span>
            ))}
          </div>
        ) : null}

        {(task.type && task.type !== 'task') || task.resolution || task.parent ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <TaskTypeChip task={task} />
            <TaskResolutionChip task={task} />
            {task.parent ? (
              <span className="text-xs text-slate-600">
                Part of{' '}
                <span className="font-medium text-slate-900">
                  {task.parent.key ? `${task.parent.key} · ` : ''}
                  {task.parent.title}
                </span>
              </span>
            ) : null}
          </div>
        ) : null}

        {task.children?.length ? (
          <div>
            <h3 className="text-sm font-semibold text-slate-700">
              Pieces ({task.children.filter((child) => child.status === 'done').length}/{task.children.length} done)
            </h3>
            <ul className="mt-2 space-y-1">
              {task.children.map((child) => (
                <li key={child.id} className="flex items-center gap-2 text-xs">
                  <TaskKey task={child} />
                  <span className={child.status === 'done' ? 'text-slate-500 line-through' : 'text-slate-800'}>
                    {child.title}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-2">
          <Fact label="Assignee" value={getAssigneeLabel(task)} />
          {/* Who RAISED it, as opposed to who is doing it. Until this existed,
              "why does this task exist?" had no answer anywhere. */}
          <Fact label="Reported by" value={task.creator?.name || 'Unknown'} />
          <Fact label="Due date" value={formatDateLong(task.due_date)} />
          <Fact label="Priority" value={PRIORITY_META[task.priority || 'medium']?.label ?? '—'} />
          <Fact label="Project" value={task.project?.name || 'None'} />
          <Fact label="Estimate" value={formatMinutes(task.estimated_time)} />
          <Fact label="Tracked" value={formatTrackedTime(task.time_entries_sum_duration)} />
        </div>

        {task.estimated_time ? (
          <div>
            <div className="flex items-center justify-between text-xs text-slate-600">
              <span>Estimate consumed</span>
              <span className="tabular-nums">{completionPercent}%</span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className={cn('h-full rounded-full', completionPercent >= 100 ? 'bg-rose-500' : 'bg-blue-600')}
                style={{ width: `${completionPercent}%` }}
              />
            </div>
          </div>
        ) : null}

        <Section
          icon={History}
          title="Activity"
          action={
            watchState?.watching ? (
              <Button
                variant="secondary"
                size="sm"
                iconLeft={<EyeOff className="h-4 w-4" />}
                onClick={async () => {
                  try {
                    const response = await taskApi.unwatch(taskId);
                    setWatchState(response.data);
                  } catch (error) {
                    notifyError('Could not stop watching this task.', error);
                  }
                }}
              >
                Watching ({watchState.watchers_count})
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                iconLeft={<Eye className="h-4 w-4" />}
                onClick={async () => {
                  try {
                    const response = await taskApi.watch(taskId);
                    setWatchState(response.data);
                  } catch (error) {
                    notifyError('Could not watch this task.', error);
                  }
                }}
              >
                Watch
              </Button>
            )
          }
        >
          {activities.length === 0 ? (
            <p className="text-sm text-slate-600">No activity yet.</p>
          ) : (
            <ul className="max-h-48 space-y-2 overflow-y-auto">
              {activities.map((activity) => (
                <li key={activity.id} className="flex items-start gap-2.5 rounded-md bg-slate-50 p-2.5">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-600" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-slate-700">{activity.description}</p>
                    <p className="mt-0.5 text-xs text-slate-600">
                      {activity.actor?.name ?? 'Someone'} · {formatRelativeTime(activity.created_at)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section icon={Send} title="Comments">
          <div className="mb-2.5 flex gap-2">
            <TextInput
              className="flex-1"
              placeholder="Write a comment..."
              aria-label="Write a comment"
              value={commentText}
              onChange={(event) => setCommentText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void postComment();
                }
              }}
            />
            <Button size="sm" disabled={!commentText.trim()} aria-label="Post comment" onClick={() => void postComment()}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
          {comments.length === 0 ? (
            <p className="text-sm text-slate-600">No comments yet.</p>
          ) : (
            <ul className="max-h-48 space-y-2 overflow-y-auto">
              {comments.map((comment) => (
                <li key={comment.id} className="flex items-start justify-between gap-2 rounded-md bg-slate-50 p-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-slate-700">{comment.content}</p>
                    <p className="mt-0.5 text-xs text-slate-600">
                      {comment.user?.name ?? 'Someone'} · {formatRelativeTime(comment.created_at)}
                    </p>
                  </div>
                  {canManageTasks || comment.user_id === currentUserId ? (
                    <button
                      type="button"
                      aria-label="Delete comment"
                      onClick={async () => {
                        try {
                          await taskApi.deleteComment(comment.id);
                          setComments((previous) => previous.filter((item) => item.id !== comment.id));
                        } catch (error) {
                          notifyError('Could not delete comment. Please try again.', error);
                        }
                      }}
                      className="shrink-0 rounded p-1 text-slate-500 transition hover:bg-rose-50 hover:text-rose-700"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section icon={CheckCircle2} title={`Checklist${checklistItems.length ? ` · ${doneCount}/${checklistItems.length}` : ''}`}>
          <ul className="space-y-1">
            {checklistItems.map((item) => (
              <li key={item.id} className="flex items-center gap-2 rounded-md bg-slate-50 px-2.5 py-1.5">
                <input
                  type="checkbox"
                  checked={item.is_completed}
                  aria-label={item.title}
                  onChange={async () => {
                    try {
                      const response = await taskApi.updateChecklistItem(item.id, { is_completed: !item.is_completed });
                      setChecklistItems((previous) =>
                        previous.map((candidate) => (candidate.id === item.id ? response.data : candidate))
                      );
                    } catch (error) {
                      notifyError('Could not update checklist item. Please try again.', error);
                    }
                  }}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600"
                />
                <span className={cn('flex-1 text-sm', item.is_completed ? 'text-slate-600 line-through' : 'text-slate-700')}>
                  {item.title}
                </span>
                <button
                  type="button"
                  aria-label={`Delete checklist item ${item.title}`}
                  onClick={async () => {
                    try {
                      await taskApi.deleteChecklistItem(item.id);
                      setChecklistItems((previous) => previous.filter((candidate) => candidate.id !== item.id));
                    } catch (error) {
                      notifyError('Could not delete checklist item. Please try again.', error);
                    }
                  }}
                  className="rounded p-0.5 text-slate-500 transition hover:text-rose-700"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-1.5 flex gap-2">
            <TextInput
              className="flex-1"
              placeholder="Add checklist item..."
              aria-label="Add checklist item"
              value={newChecklistTitle}
              onChange={(event) => setNewChecklistTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void addChecklistItem();
                }
              }}
            />
            <Button size="sm" disabled={!newChecklistTitle.trim()} aria-label="Add item" onClick={() => void addChecklistItem()}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </Section>

        <Section icon={Paperclip} title="Attachments">
          <ul className="space-y-2">
            {attachments.length === 0 ? (
              <li className="text-sm text-slate-600">No attachments yet.</li>
            ) : (
              attachments.map((attachment) => (
                <li key={attachment.id} className="flex items-center justify-between gap-2 rounded-md bg-slate-50 p-2.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <Paperclip className="h-3.5 w-3.5 shrink-0 text-slate-600" aria-hidden="true" />
                    <span className="truncate text-sm text-slate-700">{attachment.original_filename}</span>
                    {attachment.file_size ? (
                      <span className="shrink-0 text-xs tabular-nums text-slate-600">
                        {(attachment.file_size / 1024).toFixed(1)} KB
                      </span>
                    ) : null}
                  </div>
                  {canManageTasks || attachment.user_id === currentUserId ? (
                    <button
                      type="button"
                      aria-label={`Delete ${attachment.original_filename}`}
                      onClick={async () => {
                        try {
                          await taskApi.deleteAttachment(attachment.id);
                          setAttachments((previous) => previous.filter((candidate) => candidate.id !== attachment.id));
                        } catch (error) {
                          notifyError('Could not delete attachment. Please try again.', error);
                        }
                      }}
                      className="shrink-0 rounded p-1 text-slate-500 transition hover:bg-rose-50 hover:text-rose-700"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </li>
              ))
            )}
          </ul>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              setUploading(true);
              try {
                const formData = new FormData();
                formData.append('file', file);
                const response = await taskApi.createAttachment(taskId, formData);
                setAttachments((previous) => [response.data, ...previous]);
              } catch (error) {
                notifyError('Could not upload the file. Please try again.', error);
              } finally {
                setUploading(false);
                if (fileInputRef.current) fileInputRef.current.value = '';
              }
            }}
          />
          <Button
            variant="secondary"
            size="sm"
            className="mt-2"
            iconLeft={<Plus className="h-4 w-4" />}
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? 'Uploading...' : 'Add file'}
          </Button>
        </Section>

        <Section icon={AlertTriangle} title="Dependencies">
          <ul className="space-y-1">
            {dependencies.length === 0 ? (
              <li className="text-sm text-slate-600">No dependencies.</li>
            ) : (
              dependencies.map((dependency) => (
                <li
                  key={dependency.id}
                  className="flex items-center justify-between gap-2 rounded-md bg-slate-50 px-2.5 py-1.5"
                >
                  <span className="text-sm text-slate-700">
                    Blocked by: {dependency.depends_on_task?.title ?? `Task #${dependency.depends_on_task_id}`}
                  </span>
                  <button
                    type="button"
                    aria-label="Remove dependency"
                    onClick={async () => {
                      try {
                        await taskApi.deleteDependency(dependency.id);
                        setDependencies((previous) => previous.filter((candidate) => candidate.id !== dependency.id));
                      } catch (error) {
                        notifyError('Could not remove dependency. Please try again.', error);
                      }
                    }}
                    className="rounded p-0.5 text-slate-500 transition hover:text-rose-700"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))
            )}
          </ul>
          {canManageTasks ? (
            <div className="mt-1.5 flex gap-2">
              <SelectInput
                className="flex-1"
                aria-label="Select task to depend on"
                value={newDependencyTaskId}
                onChange={(event) => setNewDependencyTaskId(event.target.value)}
              >
                <option value="">Select task to depend on...</option>
                {allTasks
                  .filter(
                    (candidate) =>
                      candidate.id !== taskId &&
                      !dependencies.some((dependency) => dependency.depends_on_task_id === candidate.id)
                  )
                  .map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.title}
                    </option>
                  ))}
              </SelectInput>
              <Button
                size="sm"
                disabled={!newDependencyTaskId}
                aria-label="Add dependency"
                onClick={async () => {
                  try {
                    const response = await taskApi.createDependency(taskId, Number(newDependencyTaskId));
                    setDependencies((previous) => [...previous, response.data]);
                    setNewDependencyTaskId('');
                  } catch (error) {
                    notifyError('Could not add dependency. Please try again.', error);
                  }
                }}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          ) : null}
        </Section>

        <Section icon={Clock3} title="Recurrence">
          {recurrence ? (
            <div className="space-y-2 rounded-md bg-slate-50 p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm text-slate-700">
                  <span className="font-medium">{titleCase(recurrence.frequency)}</span>
                  {recurrence.interval_value > 1 ? <span> every {recurrence.interval_value}</span> : null}
                  {recurrence.days_of_week?.length ? (
                    <span>
                      {' '}
                      on{' '}
                      {recurrence.days_of_week
                        .map((day: number) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day])
                        .join(', ')}
                    </span>
                  ) : null}
                  {recurrence.day_of_month ? <span> on day {recurrence.day_of_month}</span> : null}
                  {recurrence.end_date ? <span> until {formatDateLong(recurrence.end_date)}</span> : null}
                </p>
                <div className="flex shrink-0 items-center gap-2">
                  <label className="flex items-center gap-1.5 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      checked={recurrence.is_active}
                      onChange={async () => {
                        try {
                          const response = await taskApi.updateRecurrence(recurrence.id, {
                            is_active: !recurrence.is_active,
                          });
                          setRecurrence(response.data);
                        } catch (error) {
                          notifyError('Could not update recurrence. Please try again.', error);
                        }
                      }}
                      className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600"
                    />
                    Active
                  </label>
                  <button
                    type="button"
                    aria-label="Remove recurrence rule"
                    onClick={() => setConfirmRemoveRecurrence(true)}
                    className="rounded p-0.5 text-slate-500 transition hover:text-rose-700"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              {recurrence.next_run_date ? (
                <p className="text-xs text-slate-600">Next run: {formatDateLong(recurrence.next_run_date)}</p>
              ) : null}
            </div>
          ) : null}

          {canManageTasks && showRecurrenceForm ? (
            <div className="mt-2 space-y-2 rounded-md border border-slate-200 bg-surface-card p-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">Frequency</label>
                  <SelectInput
                    value={recurrenceForm.frequency}
                    onChange={(event) => setRecurrenceForm((current) => ({ ...current, frequency: event.target.value }))}
                  >
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                  </SelectInput>
                </div>
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">Interval</label>
                  <TextInput
                    type="number"
                    min="1"
                    value={recurrenceForm.interval_value}
                    onChange={(event) =>
                      setRecurrenceForm((current) => ({ ...current, interval_value: Number(event.target.value) || 1 }))
                    }
                  />
                </div>
                {recurrenceForm.frequency === 'weekly' ? (
                  <div>
                    <label className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">
                      Days of week
                    </label>
                    <TextInput
                      placeholder="e.g. 1,3,5 (Mon,Wed,Fri)"
                      value={recurrenceForm.days_of_week}
                      onChange={(event) =>
                        setRecurrenceForm((current) => ({ ...current, days_of_week: event.target.value }))
                      }
                    />
                  </div>
                ) : null}
                {recurrenceForm.frequency === 'monthly' ? (
                  <div>
                    <label className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">
                      Day of month
                    </label>
                    <TextInput
                      type="number"
                      min="1"
                      max="31"
                      value={recurrenceForm.day_of_month}
                      onChange={(event) =>
                        setRecurrenceForm((current) => ({ ...current, day_of_month: event.target.value }))
                      }
                    />
                  </div>
                ) : null}
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">End date</label>
                  <TextInput
                    type="date"
                    value={recurrenceForm.end_date}
                    onChange={(event) => setRecurrenceForm((current) => ({ ...current, end_date: event.target.value }))}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setShowRecurrenceForm(false)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={async () => {
                    try {
                      const payload: {
                        frequency: string;
                        interval_value?: number;
                        days_of_week?: number[];
                        day_of_month?: number;
                        end_date?: string;
                      } = {
                        frequency: recurrenceForm.frequency,
                        interval_value: recurrenceForm.interval_value,
                      };
                      if (recurrenceForm.frequency === 'weekly' && recurrenceForm.days_of_week.trim()) {
                        payload.days_of_week = recurrenceForm.days_of_week
                          .split(',')
                          .map((part) => Number(part.trim()))
                          .filter((value) => !Number.isNaN(value));
                      }
                      if (recurrenceForm.frequency === 'monthly' && recurrenceForm.day_of_month.trim()) {
                        payload.day_of_month = Number(recurrenceForm.day_of_month);
                      }
                      if (recurrenceForm.end_date.trim()) {
                        payload.end_date = recurrenceForm.end_date;
                      }
                      const response = await taskApi.storeRecurrence(taskId, payload);
                      setRecurrence(response.data);
                      setShowRecurrenceForm(false);
                      setRecurrenceForm({
                        frequency: 'weekly',
                        interval_value: 1,
                        days_of_week: '',
                        day_of_month: '',
                        end_date: '',
                      });
                    } catch (error) {
                      notifyError('Could not save recurrence. Please try again.', error);
                    }
                  }}
                >
                  {recurrence ? 'Update' : 'Create'} recurrence
                </Button>
              </div>
            </div>
          ) : null}

          {canManageTasks && !showRecurrenceForm ? (
            <Button
              variant={recurrence ? 'ghost' : 'secondary'}
              size="sm"
              className={recurrence ? 'mt-2' : undefined}
              iconLeft={recurrence ? <Edit2 className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              onClick={() => {
                if (recurrence) {
                  setRecurrenceForm({
                    frequency: recurrence.frequency,
                    interval_value: recurrence.interval_value,
                    days_of_week: recurrence.days_of_week?.join(',') || '',
                    day_of_month: recurrence.day_of_month ? String(recurrence.day_of_month) : '',
                    end_date: recurrence.end_date?.split('T')[0] || '',
                  });
                }
                setShowRecurrenceForm(true);
              }}
            >
              {recurrence ? 'Edit recurrence' : 'Set up recurrence'}
            </Button>
          ) : null}
        </Section>
      </div>

      <ConfirmDialog
        isOpen={confirmRemoveRecurrence}
        tone="danger"
        title="Remove recurrence rule?"
        message="This task will stop repeating. Tasks already created by this rule are not affected."
        confirmLabel="Remove rule"
        onClose={() => setConfirmRemoveRecurrence(false)}
        onConfirm={async () => {
          if (!recurrence) return;
          try {
            await taskApi.deleteRecurrence(recurrence.id);
            setRecurrence(null);
          } catch (error) {
            notifyError('Could not remove recurrence. Please try again.', error);
          } finally {
            setConfirmRemoveRecurrence(false);
          }
        }}
      />
    </SlideOver>
  );
}
