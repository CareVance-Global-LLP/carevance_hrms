import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { GROUP_BY_OPTIONS, STATUS_VALUES, type TaskGroupBy, type TaskStatus, type TaskView } from './taskConstants';

export interface TaskViewState {
  view: TaskView;
  groupBy: TaskGroupBy;
  search: string;
  status: 'all' | TaskStatus;
  department: string;
  assignee: string;
  label: string;
}

const DEFAULTS: TaskViewState = {
  view: 'list',
  groupBy: 'status',
  search: '',
  status: 'all',
  department: 'all',
  assignee: 'all',
  label: 'all',
};

/** Short keys — these end up in a URL people paste to each other. */
const PARAM_KEYS: Record<keyof TaskViewState, string> = {
  view: 'view',
  groupBy: 'group',
  search: 'q',
  status: 'status',
  department: 'dept',
  assignee: 'who',
  label: 'label',
};

const GROUP_BY_VALUES = GROUP_BY_OPTIONS.map((option) => option.value);

/**
 * View, grouping and every filter live in the query string rather than in
 * component state. Two things fall out of that: a filtered board is a link you
 * can send someone, and a refresh (or the back button) no longer wipes what you
 * had set up.
 *
 * Defaults are never written to the URL, so an untouched page stays on a clean
 * `/tasks` instead of accumulating `?view=list&group=status&status=all&…`.
 */
export function useTaskViewState() {
  const [searchParams, setSearchParams] = useSearchParams();

  const state = useMemo<TaskViewState>(() => {
    const rawView = searchParams.get(PARAM_KEYS.view);
    const rawGroupBy = searchParams.get(PARAM_KEYS.groupBy);
    const rawStatus = searchParams.get(PARAM_KEYS.status);

    return {
      view: rawView === 'board' || rawView === 'list' ? rawView : DEFAULTS.view,
      groupBy: GROUP_BY_VALUES.includes(rawGroupBy as TaskGroupBy) ? (rawGroupBy as TaskGroupBy) : DEFAULTS.groupBy,
      search: searchParams.get(PARAM_KEYS.search) ?? DEFAULTS.search,
      status: STATUS_VALUES.includes(rawStatus as TaskStatus) ? (rawStatus as TaskStatus) : DEFAULTS.status,
      department: searchParams.get(PARAM_KEYS.department) ?? DEFAULTS.department,
      assignee: searchParams.get(PARAM_KEYS.assignee) ?? DEFAULTS.assignee,
      label: searchParams.get(PARAM_KEYS.label) ?? DEFAULTS.label,
    };
  }, [searchParams]);

  const update = useCallback(
    (patch: Partial<TaskViewState>) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          (Object.keys(patch) as Array<keyof TaskViewState>).forEach((key) => {
            const value = patch[key];
            const param = PARAM_KEYS[key];
            if (value === undefined || value === null || value === '' || value === DEFAULTS[key]) {
              next.delete(param);
              return;
            }
            next.set(param, String(value));
          });
          return next;
        },
        // Filtering is not navigation — leaving history entries behind would
        // make the back button walk through every keystroke of a search.
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const reset = useCallback(() => {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        Object.values(PARAM_KEYS).forEach((param) => next.delete(param));
        return next;
      },
      { replace: true }
    );
  }, [setSearchParams]);

  const hasActiveFilters =
    state.search.trim() !== '' ||
    state.status !== DEFAULTS.status ||
    state.department !== DEFAULTS.department ||
    state.assignee !== DEFAULTS.assignee ||
    state.label !== DEFAULTS.label;

  return { state, update, reset, hasActiveFilters };
}
