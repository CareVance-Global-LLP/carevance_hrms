import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';
import { buildSearchSuggestions, rankSearchSuggestions } from '@/lib/searchSuggestions';
import { cn } from '@/utils/cn';
import useFloatingDropdown from '@/components/ui/useFloatingDropdown';

type TaskOption = {
  id: number;
  title: string;
  status?: string | null;
  priority?: string | null;
  project?: { name?: string | null } | null;
  group?: { name?: string | null } | null;
  assignee?: { name?: string | null } | null;
};

interface TaskSelectProps {
  tasks: TaskOption[];
  value: number | '' | null | undefined;
  onChange: (value: number | '') => void;
  disabled?: boolean;
  includeAllOption?: boolean;
  allOptionLabel?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
}

const formatTaskMeta = (task: TaskOption) => {
  const details = [
    String(task.project?.name || '').trim(),
    String(task.group?.name || '').trim(),
    String(task.assignee?.name || '').trim() ? `Assigned to ${String(task.assignee?.name || '').trim()}` : '',
  ].filter(Boolean);

  if (details.length > 0) {
    return details.join(' • ');
  }

  return String(task.status || '').trim() || 'Task';
};

export default function TaskSelect({
  tasks,
  value,
  onChange,
  disabled = false,
  includeAllOption = false,
  allOptionLabel = 'All tasks',
  placeholder = 'Choose task',
  searchPlaceholder = 'Search task title',
  emptyMessage = 'No task matched the current search.',
}: TaskSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const { panelRef, panelStyle } = useFloatingDropdown(buttonRef, open);

  const normalizedValue = typeof value === 'number' && Number.isFinite(value) ? value : '';
  const selectedTask = tasks.find((task) => task.id === normalizedValue) || null;
  const taskSuggestions = useMemo(
    () => buildSearchSuggestions(tasks, (task) => ({
      id: `task:${task.id}`,
      label: task.title,
      description: formatTaskMeta(task),
      keywords: [task.status, task.priority].filter(Boolean) as string[],
      searchValues: [
        task.title,
        task.project?.name,
        task.group?.name,
        task.assignee?.name,
        task.status,
        task.priority,
      ],
      payload: task,
    })),
    [tasks]
  );
  const filteredTasks = useMemo(() => {
    if (!search.trim()) {
      return tasks;
    }

    return rankSearchSuggestions(taskSuggestions, search, tasks.length)
      .map((suggestion) => suggestion.payload)
      .filter((task): task is TaskOption => Boolean(task));
  }, [search, taskSuggestions, tasks]);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }

      if (
        containerRef.current
        && !containerRef.current.contains(target)
        && panelRef.current
        && !panelRef.current.contains(target)
      ) {
        setOpen(false);
      } else if (containerRef.current && !containerRef.current.contains(target) && !panelRef.current) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  useEffect(() => {
    if (!open) {
      setSearch('');
    }
  }, [open]);

  const triggerLabel = selectedTask
    ? `${selectedTask.title}${formatTaskMeta(selectedTask) ? ` (${formatTaskMeta(selectedTask)})` : ''}`
    : includeAllOption
      ? allOptionLabel
      : placeholder;

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        ref={buttonRef}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          'flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-left text-sm text-slate-900 shadow-sm outline-none transition focus:border-sky-300 focus:bg-white focus:ring-2 focus:ring-sky-300/25 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400',
          open && 'border-sky-300 bg-white ring-2 ring-sky-300/25'
        )}
      >
        <span className={cn('truncate', !selectedTask && !includeAllOption && 'text-slate-400')}>
          {triggerLabel}
        </span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-slate-500 transition', open && 'rotate-180')} />
      </button>

      {open && panelStyle ? createPortal(
        <div
          ref={panelRef}
          style={panelStyle}
          className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"
        >
          <div className="border-b border-slate-100 p-3">
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <Search className="h-4 w-4 text-slate-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={searchPlaceholder}
                className="w-full border-0 bg-transparent p-0 text-sm text-slate-900 outline-none placeholder:text-slate-400"
              />
            </div>
          </div>

          <div className="max-h-72 overflow-auto py-2" role="listbox">
            {includeAllOption ? (
              <button
                type="button"
                role="option"
                aria-selected={normalizedValue === ''}
                onClick={() => {
                  onChange('');
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-sky-50"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900">{allOptionLabel}</p>
                </div>
                {normalizedValue === '' ? <Check className="h-4 w-4 shrink-0 text-sky-600" /> : null}
              </button>
            ) : null}

            {filteredTasks.length === 0 ? (
              <div className="px-4 py-6 text-sm text-slate-500">{emptyMessage}</div>
            ) : (
              filteredTasks.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  role="option"
                  aria-selected={normalizedValue === task.id}
                  onClick={() => {
                    onChange(task.id);
                    setOpen(false);
                  }}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-sky-50"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{task.title}</p>
                    <p className="truncate text-xs text-slate-500">{formatTaskMeta(task)}</p>
                  </div>
                  {normalizedValue === task.id ? <Check className="h-4 w-4 shrink-0 text-sky-600" /> : null}
                </button>
              ))
            )}
          </div>
        </div>,
        document.body
      ) : null}
    </div>
  );
}
