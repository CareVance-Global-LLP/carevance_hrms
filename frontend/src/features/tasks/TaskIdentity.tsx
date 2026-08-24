import type { Task } from '@/types';
import { RESOLUTION_META, TYPE_META } from './taskConstants';

/**
 * The bits that say *which* task this is, rather than what state it is in.
 *
 * Kept in one file because the key, the type chip and the resolution chip have
 * to look identical in the list, on the board and in the detail panel — three
 * places that previously each rendered their own idea of a task's header. A
 * chip that is a different size on the board than in the list reads as a
 * different kind of thing.
 */

/**
 * The shareable identifier, e.g. `CV-14`.
 *
 * Tabular numerals so a column of keys lines up on the digits instead of
 * wobbling, which is the whole reason to show a key in a list at all.
 */
export function TaskKey({ task, className = '' }: { task: Task; className?: string }) {
  if (!task.key) {
    return null;
  }

  return (
    <span className={`shrink-0 font-mono text-[11px] tabular-nums text-slate-500 ${className}`.trim()}>
      {task.key}
    </span>
  );
}

/**
 * Bug / Story / Epic / Task.
 *
 * A plain `task` renders nothing: it is the default and the overwhelming
 * majority, so chipping it would add noise to every row to say "ordinary".
 * Only the exceptions are worth the ink.
 */
export function TaskTypeChip({ task, className = '' }: { task: Task; className?: string }) {
  const type = task.type;
  if (!type || type === 'task') {
    return null;
  }

  const meta = TYPE_META[type];
  if (!meta) {
    return null;
  }

  return (
    <span
      className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${meta.className} ${className}`.trim()}
    >
      {meta.label}
    </span>
  );
}

/**
 * How a finished task ended.
 *
 * Only rendered when the task is actually done — a resolution on an open task
 * claims an outcome that has not happened yet.
 */
export function TaskResolutionChip({ task, className = '' }: { task: Task; className?: string }) {
  if (task.status !== 'done' || !task.resolution) {
    return null;
  }

  const meta = RESOLUTION_META[task.resolution];
  if (!meta) {
    return null;
  }

  return (
    <span
      className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${meta.className} ${className}`.trim()}
    >
      {meta.label}
    </span>
  );
}
