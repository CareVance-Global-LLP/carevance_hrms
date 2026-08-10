import { Fragment } from 'react';
import { Trash2 } from 'lucide-react';
import type { Task } from '@/types';
import { cn } from '@/utils/cn';
import { getReadableTextColor } from '@/utils/getContrastColor';
import TaskAvatar from './TaskAvatar';
import { PRIORITY_META, STATUS_OPTIONS, type TaskGroupBy, type TaskStatus } from './taskConstants';
import {
  formatDate,
  formatMinutes,
  formatTrackedTime,
  groupTasks,
  isOverdue,
  sortTasks,
  titleCase,
} from './taskUtils';

interface TaskListViewProps {
  tasks: Task[];
  groupBy: TaskGroupBy;
  canManageTasks: boolean;
  onOpenTask: (task: Task) => void;
  onChangeStatus: (task: Task, status: TaskStatus) => void;
  onDeleteTask: (task: Task) => void;
}

const STATUS_CYCLE: TaskStatus[] = STATUS_OPTIONS.map((option) => option.value);

/**
 * The default view. One row per task at roughly 40px, so the same screen that
 * showed six tasks as board cards shows around thirty here — which is what you
 * want the moment you are scanning rather than dragging.
 *
 * Grouping is the control that replaced four filter dropdowns: group by status
 * and this carries the board's information in a third of the height; group by
 * assignee and it is a workload view.
 */
export default function TaskListView({
  tasks,
  groupBy,
  canManageTasks,
  onOpenTask,
  onChangeStatus,
  onDeleteTask,
}: TaskListViewProps) {
  const groups = groupTasks(tasks, groupBy, STATUS_OPTIONS);

  if (tasks.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
        <p className="text-sm font-medium text-slate-700">No tasks match these filters.</p>
        <p className="mt-1 text-xs text-slate-600">Clear a filter, or create a task to get started.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-surface-card">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">
          Tasks grouped by {groupBy === 'none' ? 'nothing' : groupBy}
        </caption>
        <thead className="sr-only">
          <tr>
            <th scope="col">Status</th>
            <th scope="col">Task</th>
            <th scope="col">Priority</th>
            <th scope="col">Due date</th>
            <th scope="col">Time</th>
            <th scope="col">Assignee</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        {groups.map((group) => (
          <Fragment key={group.key}>
            <tbody>
              <tr>
                <th
                  scope="colgroup"
                  colSpan={7}
                  className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600"
                >
                  {group.label}
                  <span className="ml-2 font-normal normal-case tracking-normal text-slate-600">
                    {group.tasks.length}
                  </span>
                </th>
              </tr>
            </tbody>
            <tbody>
              {sortTasks(group.tasks).map((task) => {
                const priority = PRIORITY_META[task.priority || 'medium'];
                const statusOption = STATUS_OPTIONS.find((option) => option.value === task.status);
                const overdue = isOverdue(task);
                const isDone = task.status === 'done';
                const tracked = task.time_entries_sum_duration ? formatTrackedTime(task.time_entries_sum_duration) : '';
                const estimate = task.estimated_time ? formatMinutes(task.estimated_time) : '';

                return (
                  <tr
                    key={task.id}
                    className="group border-b border-slate-100 transition last:border-b-0 hover:bg-blue-50/50"
                  >
                    {/* Advancing status is the single most common edit, so it is
                        one click on the row rather than a trip to the detail panel. */}
                    <td className="w-9 py-2 pl-3 pr-0 align-middle">
                      <button
                        type="button"
                        disabled={!canManageTasks}
                        aria-label={`Task status: ${statusOption?.label ?? titleCase(task.status)}. Advance status`}
                        title={canManageTasks ? `${statusOption?.label ?? ''} — click to advance` : statusOption?.label}
                        onClick={() => {
                          const index = STATUS_CYCLE.indexOf(task.status);
                          onChangeStatus(task, STATUS_CYCLE[(index + 1) % STATUS_CYCLE.length]);
                        }}
                        className={cn(
                          'h-3.5 w-3.5 rounded-full border-2 transition',
                          statusOption?.dot ?? 'border-slate-400',
                          canManageTasks
                            ? 'cursor-pointer hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300'
                            : 'cursor-default'
                        )}
                      />
                    </td>

                    <td className="w-full py-2 pl-3 pr-2 align-middle">
                      <button
                        type="button"
                        onClick={() => onOpenTask(task)}
                        className="flex w-full items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                      >
                        <span
                          className={cn(
                            'truncate font-medium',
                            isDone ? 'text-slate-600 line-through' : 'text-slate-950'
                          )}
                        >
                          {task.title}
                        </span>
                        {task.labels?.slice(0, 2).map((label) => (
                          <span
                            key={label.id}
                            className="hidden shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold sm:inline"
                            style={{ backgroundColor: label.color, color: getReadableTextColor(label.color) }}
                          >
                            {label.name}
                          </span>
                        ))}
                        {task.group?.name ? (
                          <span className="hidden shrink-0 text-xs text-slate-600 lg:inline">{task.group.name}</span>
                        ) : null}
                      </button>
                    </td>

                    {/* Only priorities that actually mean something. "Medium" is
                        the default and appeared on almost every row, so the
                        column read as noise instead of a signal. */}
                    <td className="hidden whitespace-nowrap px-2 py-2 align-middle text-xs sm:table-cell">
                      {task.priority === 'urgent' || task.priority === 'high' ? (
                        <span className={priority?.className}>{priority?.label}</span>
                      ) : null}
                    </td>

                    <td className="hidden whitespace-nowrap px-2 py-2 align-middle sm:table-cell">
                      {task.due_date ? (
                        <span
                          className={cn(
                            'text-xs tabular-nums',
                            overdue ? 'font-semibold text-rose-700' : 'text-slate-600'
                          )}
                        >
                          {formatDate(task.due_date)}
                          {overdue ? <span className="sr-only">(overdue)</span> : null}
                        </span>
                      ) : null}
                    </td>

                    {/* Only the half that exists. "— / 4h 13m" made every
                        untracked task read like a broken value. */}
                    <td className="hidden whitespace-nowrap px-2 py-2 align-middle text-xs tabular-nums text-slate-600 lg:table-cell">
                      {tracked && estimate ? (
                        `${tracked} / ${estimate}`
                      ) : tracked ? (
                        tracked
                      ) : estimate ? (
                        <span className="text-slate-600">{estimate} est</span>
                      ) : null}
                    </td>

                    <td className="px-2 py-2 align-middle">
                      <TaskAvatar task={task} />
                    </td>

                    <td className="w-9 py-2 pl-0 pr-3 align-middle">
                      {canManageTasks ? (
                        <button
                          type="button"
                          aria-label={`Delete ${task.title}`}
                          onClick={() => onDeleteTask(task)}
                          className="rounded p-1 text-slate-400 opacity-0 transition hover:bg-rose-50 hover:text-rose-700 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 group-hover:opacity-100"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Fragment>
        ))}
      </table>
    </div>
  );
}
