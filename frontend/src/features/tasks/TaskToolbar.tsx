import { useState } from 'react';
import { LayoutGrid, List, Plus, Search, SlidersHorizontal } from 'lucide-react';
import Button from '@/components/ui/Button';
import { SelectInput } from '@/components/ui/FormField';
import type { Group, TaskLabel, User } from '@/types';
import { cn } from '@/utils/cn';
import { GROUP_BY_OPTIONS, STATUS_OPTIONS, type TaskGroupBy, type TaskStatus, type TaskView } from './taskConstants';
import type { TaskViewState } from './useTaskViewState';

interface TaskToolbarProps {
  state: TaskViewState;
  onChange: (patch: Partial<TaskViewState>) => void;
  onReset: () => void;
  hasActiveFilters: boolean;
  groups: Group[];
  users: User[];
  labels: TaskLabel[];
  canManageTasks: boolean;
  onNewTask: () => void;
  resultCount: number;
}

export default function TaskToolbar({
  state,
  onChange,
  onReset,
  hasActiveFilters,
  groups,
  users,
  labels,
  canManageTasks,
  onNewTask,
  resultCount,
}: TaskToolbarProps) {
  const [filtersOpen, setFiltersOpen] = useState(hasActiveFilters);

  const activeFilterCount = [
    state.status !== 'all',
    state.department !== 'all',
    state.assignee !== 'all',
    state.label !== 'all',
  ].filter(Boolean).length;

  return (
    // A bare row, not a card. Wrapping the controls in a bordered panel put a
    // second box above a view that is already a bordered table.
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600"
            aria-hidden="true"
          />
          <input
            type="search"
            aria-label="Search tasks"
            placeholder="Search tasks..."
            value={state.search}
            onChange={(event) => onChange({ search: event.target.value })}
            className="min-h-10 w-full rounded-lg border border-slate-200 bg-surface-card pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-600 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-sky-300"
          />
        </div>

        {/* View is a toggle, not a route — the list and the board are peers. */}
        <div className="inline-flex overflow-hidden rounded-lg border border-slate-200" role="group" aria-label="View">
          {(
            [
              { value: 'list' as TaskView, label: 'List', icon: List },
              { value: 'board' as TaskView, label: 'Board', icon: LayoutGrid },
            ]
          ).map((option) => {
            const Icon = option.icon;
            const active = state.view === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={active}
                onClick={() => onChange({ view: option.value })}
                className={cn(
                  'inline-flex min-h-10 items-center gap-1.5 px-3 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300',
                  active ? 'bg-blue-700 text-on-brand' : 'bg-surface-card text-slate-700 hover:bg-slate-50'
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {option.label}
              </button>
            );
          })}
        </div>

        {state.view === 'list' ? (
          <label className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600">
            <span className="hidden sm:inline">Group by</span>
            <SelectInput
              className="w-32"
              aria-label="Group tasks by"
              value={state.groupBy}
              onChange={(event) => onChange({ groupBy: event.target.value as TaskGroupBy })}
            >
              {GROUP_BY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </SelectInput>
          </label>
        ) : null}

        <Button
          variant={filtersOpen || activeFilterCount > 0 ? 'secondary' : 'ghost'}
          size="sm"
          aria-expanded={filtersOpen}
          iconLeft={<SlidersHorizontal className="h-3.5 w-3.5" />}
          onClick={() => setFiltersOpen((current) => !current)}
        >
          Filters
          {activeFilterCount > 0 ? (
            <span className="ml-1 rounded-full bg-blue-700 px-1.5 text-[10px] font-bold text-on-brand">
              {activeFilterCount}
            </span>
          ) : null}
        </Button>

        {canManageTasks ? (
          <Button size="sm" iconLeft={<Plus className="h-4 w-4" />} onClick={onNewTask}>
            New task
          </Button>
        ) : null}
      </div>

      {filtersOpen ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
          <SelectInput
            className="w-36"
            aria-label="Filter by status"
            value={state.status}
            onChange={(event) => onChange({ status: event.target.value as 'all' | TaskStatus })}
          >
            <option value="all">All statuses</option>
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </SelectInput>

          <SelectInput
            className="w-44"
            aria-label="Filter by department"
            value={state.department}
            onChange={(event) => onChange({ department: event.target.value })}
          >
            <option value="all">All departments</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </SelectInput>

          <SelectInput
            className="w-40"
            aria-label="Filter by assignee"
            value={state.assignee}
            onChange={(event) => onChange({ assignee: event.target.value })}
          >
            <option value="all">All assignees</option>
            {users.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </SelectInput>

          <SelectInput
            className="w-36"
            aria-label="Filter by label"
            value={state.label}
            onChange={(event) => onChange({ label: event.target.value })}
          >
            <option value="all">All labels</option>
            {labels.map((label) => (
              <option key={label.id} value={label.id}>
                {label.name}
              </option>
            ))}
          </SelectInput>

          {hasActiveFilters ? (
            <Button variant="ghost" size="sm" onClick={onReset}>
              Clear
            </Button>
          ) : null}

          <span className="ml-auto text-xs text-slate-600" aria-live="polite">
            {resultCount} task{resultCount === 1 ? '' : 's'}
          </span>
        </div>
      ) : null}
    </div>
  );
}
