import type { Task } from '@/types';

/**
 * Every status the backend accepts. `in_review` used to be missing from this
 * list even though it exists on the `Task` type — the board rendered three
 * columns, so an `in_review` task appeared in none of them while still being
 * counted by the "tasks in view" metric. It is a real status now.
 */
export type TaskStatus = Task['status'];
export type TaskPriority = Task['priority'];

export interface StatusOption {
  value: TaskStatus;
  label: string;
  /** Column header tint on the board. */
  accent: string;
  /** Status dot in the list. */
  dot: string;
}

export const STATUS_OPTIONS: StatusOption[] = [
  { value: 'todo', label: 'To Do', accent: 'border-slate-200 bg-slate-50', dot: 'border-slate-400' },
  { value: 'in_progress', label: 'In Progress', accent: 'border-amber-200 bg-amber-50/70', dot: 'border-amber-500 bg-amber-500/40' },
  { value: 'in_review', label: 'In Review', accent: 'border-violet-200 bg-violet-50/70', dot: 'border-violet-500 bg-violet-500/60' },
  { value: 'done', label: 'Done', accent: 'border-emerald-200 bg-emerald-50', dot: 'border-emerald-600 bg-emerald-600' },
];

export const STATUS_VALUES: TaskStatus[] = STATUS_OPTIONS.map((option) => option.value);

export const PRIORITY_OPTIONS: TaskPriority[] = ['low', 'medium', 'high', 'urgent'];

/**
 * Priority reads as colour + weight rather than a filled pill, so a dense list
 * stays scannable instead of turning into a wall of chips. Text tones stop at
 * `slate-600` — `slate-400`/`500` both fail AA against white at this size.
 */
export const PRIORITY_META: Record<NonNullable<TaskPriority>, { label: string; className: string; rank: number }> = {
  urgent: { label: 'Urgent', className: 'text-rose-700 font-semibold', rank: 0 },
  high: { label: 'High', className: 'text-amber-700 font-semibold', rank: 1 },
  medium: { label: 'Medium', className: 'text-slate-600', rank: 2 },
  low: { label: 'Low', className: 'text-slate-600', rank: 3 },
};

/** The axes the list can be grouped by. Replaces stacking four dropdowns. */
export type TaskGroupBy = 'status' | 'assignee' | 'priority' | 'department' | 'due' | 'none';

export const GROUP_BY_OPTIONS: Array<{ value: TaskGroupBy; label: string }> = [
  { value: 'status', label: 'Status' },
  { value: 'assignee', label: 'Assignee' },
  { value: 'priority', label: 'Priority' },
  { value: 'department', label: 'Department' },
  { value: 'due', label: 'Due date' },
  { value: 'none', label: 'Nothing' },
];

export type TaskView = 'list' | 'board';
