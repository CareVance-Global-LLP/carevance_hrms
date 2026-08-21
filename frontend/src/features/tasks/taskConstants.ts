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

/**
 * What kind of work a task is.
 *
 * Rendered as a small tinted chip rather than another word in the row: on a
 * dense list the type is something you scan for, not something you read. The
 * colours are deliberately outside the priority palette (rose/amber) so a bug
 * chip can never be mistaken for an urgent flag.
 */
export const TYPE_META: Record<NonNullable<Task['type']>, { label: string; className: string }> = {
  task: { label: 'Task', className: 'bg-slate-100 text-slate-700 ring-1 ring-slate-200' },
  bug: { label: 'Bug', className: 'bg-red-50 text-red-700 ring-1 ring-red-200' },
  story: { label: 'Story', className: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200' },
  epic: { label: 'Epic', className: 'bg-violet-50 text-violet-700 ring-1 ring-violet-200' },
};

export const TYPE_OPTIONS = Object.entries(TYPE_META).map(([value, meta]) => ({
  value: value as NonNullable<Task['type']>,
  label: meta.label,
}));

/**
 * How a finished task ended.
 *
 * `done` alone cannot tell shipped from abandoned from duplicate, so a board
 * full of green says nothing about what was actually delivered. Only shown on
 * tasks that are done — a resolution on an open task claims an outcome that has
 * not happened.
 */
export const RESOLUTION_META: Record<NonNullable<Task['resolution']>, { label: string; className: string }> = {
  fixed: { label: 'Fixed', className: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' },
  wont_do: { label: "Won't do", className: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200' },
  duplicate: { label: 'Duplicate', className: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200' },
  cannot_reproduce: { label: 'Cannot reproduce', className: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' },
};

export const RESOLUTION_OPTIONS = Object.entries(RESOLUTION_META).map(([value, meta]) => ({
  value: value as NonNullable<Task['resolution']>,
  label: meta.label,
}));

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
