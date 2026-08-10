import type { Task } from '@/types';
import { cn } from '@/utils/cn';
import { getAssigneeNames, getInitials } from './taskUtils';

/**
 * Initials rather than a name column. In the list a name would cost ~140px on
 * every row; in the board it would cost a whole line per card. The full names
 * stay reachable through the title attribute and the detail panel.
 */
export default function TaskAvatar({ task, className }: { task: Task; className?: string }) {
  const names = getAssigneeNames(task);

  if (names.length === 0) {
    return (
      <span
        className={cn(
          'grid h-6 w-6 shrink-0 place-items-center rounded-full border border-dashed border-slate-300 text-[9px] font-semibold text-slate-600',
          className
        )}
        title="Unassigned"
      >
        —
      </span>
    );
  }

  return (
    <span
      className={cn(
        'grid h-6 w-6 shrink-0 place-items-center rounded-full border border-blue-200 bg-blue-50 text-[9px] font-semibold text-blue-700',
        className
      )}
      title={names.join(', ')}
    >
      {names.length > 1 ? `+${names.length}` : getInitials(names[0])}
    </span>
  );
}
