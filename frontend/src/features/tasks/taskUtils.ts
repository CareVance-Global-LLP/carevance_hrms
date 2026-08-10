import type { Task } from '@/types';
import { PRIORITY_META, type TaskGroupBy } from './taskConstants';

export const titleCase = (value?: string | null) =>
  value ? value.replace(/_/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase()) : '';

export const toDate = (value?: string | null) =>
  value ? new Date(value.includes('T') ? value : `${value}T00:00:00`) : null;

export const formatDate = (value?: string | null) => {
  const date = toDate(value);
  return date ? date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '—';
};

export const formatDateLong = (value?: string | null) => {
  const date = toDate(value);
  return date ? date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
};

/** Estimates are stored in minutes. */
export const formatMinutes = (value?: number | null) => {
  const minutes = Number(value || 0);
  if (minutes <= 0) return '—';
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  if (hours && rest) return `${hours}h ${rest}m`;
  if (hours) return `${hours}h`;
  return `${rest}m`;
};

/** Tracked time arrives in seconds. */
export const formatTrackedTime = (value?: number | null) => {
  const seconds = Number(value || 0);
  if (seconds <= 0) return '—';
  return formatMinutes(Math.round(seconds / 60));
};

export const formatRelativeTime = (dateString: string) => {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return '';
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

/**
 * Share of the estimate consumed, clamped for the progress bar. Use
 * `getTaskVariance` where overrun matters — clamping is what made every
 * over-running task on the old reports page look identical to an on-target one.
 */
export const getTaskCompletionPercent = (task: Task) => {
  const estimatedMinutes = Number(task.estimated_time || 0);
  const trackedSeconds = Number(task.time_entries_sum_duration || 0);
  if (estimatedMinutes <= 0 && trackedSeconds <= 0) return 0;
  if (estimatedMinutes <= 0) return trackedSeconds > 0 ? 100 : 0;
  return Math.min(100, Math.round((trackedSeconds / (estimatedMinutes * 60)) * 100));
};

/**
 * Signed deviation from the estimate, uncapped. Negative came in under,
 * positive ran over. `null` when there is nothing to compare against.
 */
export const getTaskVariancePercent = (task: Task): number | null => {
  const estimatedMinutes = Number(task.estimated_time || 0);
  const trackedSeconds = Number(task.time_entries_sum_duration || 0);
  if (estimatedMinutes <= 0 || trackedSeconds <= 0) return null;
  const estimatedSeconds = estimatedMinutes * 60;
  return Math.round(((trackedSeconds - estimatedSeconds) / estimatedSeconds) * 100);
};

export const isOverdue = (task: Task) => {
  if (!task.due_date || task.status === 'done') return false;
  const due = toDate(task.due_date);
  if (!due) return false;
  const endOfDueDay = new Date(due);
  endOfDueDay.setHours(23, 59, 59, 999);
  return endOfDueDay.getTime() < Date.now();
};

export const getAssigneeNames = (task: Task) => {
  if (task.assignees?.length) return task.assignees.map((member) => member.name);
  if (task.assignee?.name) return [task.assignee.name];
  return [];
};

export const getAssigneeLabel = (task: Task) => {
  const names = getAssigneeNames(task);
  if (names.length === 0) return 'Unassigned';
  if (names.length === 1) return names[0];
  return `${names[0]} +${names.length - 1}`;
};

export const getInitials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || '?';

/** Buckets a due date relative to today, for the "Due date" grouping. */
const getDueBucket = (task: Task): { key: string; label: string; order: number } => {
  if (!task.due_date) return { key: 'none', label: 'No due date', order: 5 };
  const due = toDate(task.due_date);
  if (!due) return { key: 'none', label: 'No due date', order: 5 };

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const days = Math.round((due.getTime() - startOfToday.getTime()) / 86_400_000);

  if (days < 0) return { key: 'overdue', label: 'Overdue', order: 0 };
  if (days === 0) return { key: 'today', label: 'Today', order: 1 };
  if (days === 1) return { key: 'tomorrow', label: 'Tomorrow', order: 2 };
  if (days <= 7) return { key: 'week', label: 'This week', order: 3 };
  return { key: 'later', label: 'Later', order: 4 };
};

export interface TaskGroup {
  key: string;
  label: string;
  order: number;
  tasks: Task[];
}

/**
 * One grouping function for both views: the board groups by status, the list
 * groups by whatever the user picked. Keeping it shared is what makes "group by
 * assignee" a workload view and "group by department" a department view for
 * free, instead of four more filter dropdowns.
 */
export const groupTasks = (
  tasks: Task[],
  groupBy: TaskGroupBy,
  statusOrder: Array<{ value: string; label: string }>
): TaskGroup[] => {
  if (groupBy === 'none') {
    return [{ key: 'all', label: 'All tasks', order: 0, tasks }];
  }

  const buckets = new Map<string, TaskGroup>();
  const push = (key: string, label: string, order: number, task: Task) => {
    const existing = buckets.get(key);
    if (existing) {
      existing.tasks.push(task);
      return;
    }
    buckets.set(key, { key, label, order, tasks: [task] });
  };

  tasks.forEach((task) => {
    if (groupBy === 'status') {
      const index = statusOrder.findIndex((option) => option.value === task.status);
      const option = statusOrder[index];
      push(task.status, option?.label ?? titleCase(task.status), index < 0 ? 99 : index, task);
      return;
    }

    if (groupBy === 'assignee') {
      const names = getAssigneeNames(task);
      if (names.length === 0) {
        push('unassigned', 'Unassigned', 99, task);
        return;
      }
      // A task with several assignees belongs in each of their buckets — this
      // is a workload view, and dropping it from all but the first would
      // under-report everyone else's load.
      names.forEach((name) => push(`assignee:${name}`, name, 0, task));
      return;
    }

    if (groupBy === 'priority') {
      const priority = task.priority || 'medium';
      const meta = PRIORITY_META[priority];
      push(priority, meta?.label ?? titleCase(priority), meta?.rank ?? 9, task);
      return;
    }

    if (groupBy === 'department') {
      const name = task.group?.name || 'No department';
      push(`group:${name}`, name, name === 'No department' ? 99 : 0, task);
      return;
    }

    const bucket = getDueBucket(task);
    push(bucket.key, bucket.label, bucket.order, task);
  });

  return Array.from(buckets.values()).sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return a.label.localeCompare(b.label);
  });
};

/** Overdue first, then priority, then soonest due date, then newest. */
export const sortTasks = (tasks: Task[]) =>
  [...tasks].sort((a, b) => {
    const overdueDelta = Number(isOverdue(b)) - Number(isOverdue(a));
    if (overdueDelta !== 0) return overdueDelta;

    const priorityDelta =
      (PRIORITY_META[a.priority || 'medium']?.rank ?? 9) - (PRIORITY_META[b.priority || 'medium']?.rank ?? 9);
    if (priorityDelta !== 0) return priorityDelta;

    const aDue = toDate(a.due_date)?.getTime() ?? Number.POSITIVE_INFINITY;
    const bDue = toDate(b.due_date)?.getTime() ?? Number.POSITIVE_INFINITY;
    if (aDue !== bDue) return aDue - bDue;

    return b.id - a.id;
  });
