import { Fragment, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Edit2, LayoutGrid, List, Plus, Search, Trash2 } from 'lucide-react';
import { groupApi, projectApi } from '@/services/api';
import { queryKeys } from '@/lib/queryKeys';
import { useComposeAction } from '@/hooks/useComposeAction';
import { COMPOSE_KEYS } from '@/lib/commandRegistry';
import Button from '@/components/ui/Button';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { FeedbackBanner, PageEmptyState, PageErrorState, PageLoadingState } from '@/components/ui/PageState';
import { FieldLabel, SelectInput, TextInput, TextareaInput } from '@/components/ui/FormField';
import ProjectBurnBar from '@/features/projects/ProjectBurnBar';
import {
  PROJECT_COLORS,
  decimalToInputValue,
  describeBurn,
  formatBudget,
  formatDeadline,
  formatHours,
  getProjectBurn,
  sortProjects,
  daysUntil,
  type BudgetType,
  type ProjectSort,
} from '@/features/projects/projectUtils';
import { formatCurrency, formatNumber } from '@/lib/formatters';
import type { Project } from '@/types';
import { cn } from '@/utils/cn';
import { useAuth } from '@/contexts/AuthContext';

/** decimal(10,2) on the column, so this is the largest storable budget. */
const MAX_BUDGET = 99999999.99;

const BUDGET_TYPES: Array<{ value: BudgetType; label: string }> = [
  { value: 'hours', label: 'Hours' },
  { value: 'amount', label: 'Amount' },
];

interface ProjectFormState {
  name: string;
  group_id: string;
  description: string;
  color: string;
  budget: string;
  budget_type: BudgetType;
  hourly_rate: string;
  deadline: string;
  status: string;
}

/**
 * Validation failures come back as `{ message: 'The given data was invalid.',
 * errors: { budget: ['The budget field must not be greater than…'] } }`, so
 * showing `message` alone tells the user only that something is wrong. The
 * field error is the part worth reading — "too many zeroes" is exactly the
 * mistake this form now rejects instead of crashing on.
 */
const extractSaveError = (error: any): string => {
  const fieldErrors = error?.response?.data?.errors;
  const firstFieldError = fieldErrors
    ? Object.values(fieldErrors).flat().find(Boolean)
    : null;

  return (firstFieldError as string) || error?.response?.data?.message || 'Failed to save project.';
};

const emptyForm = (): ProjectFormState => ({
  name: '',
  group_id: '',
  description: '',
  color: PROJECT_COLORS[0],
  budget: '',
  budget_type: 'hours',
  hourly_rate: '',
  deadline: '',
  status: 'active',
});

export default function Projects() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const userLevel = user?.hierarchy_level ?? (user?.role === 'admin' ? 10 : user?.role === 'manager' ? 50 : 100);
  const canManageProjects = userLevel < 100;

  const [showModal, setShowModal] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Project | null>(null);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [formData, setFormData] = useState<ProjectFormState>(emptyForm());

  const [view, setView] = useState<'ledger' | 'gallery'>('ledger');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [sort, setSort] = useState<ProjectSort>('burn');

  // "Create project" in the command bar lands here with the form already open.
  useComposeAction(COMPOSE_KEYS.project, () => {
    if (canManageProjects) setShowModal(true);
  });

  const {
    data: projects = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: queryKeys.projects,
    queryFn: async () => {
      const payload: any = (await projectApi.getAll()).data;
      if (Array.isArray(payload)) return payload as Project[];
      if (Array.isArray(payload?.data)) return payload.data as Project[];
      return [] as Project[];
    },
  });

  const groupsQuery = useQuery({
    queryKey: queryKeys.groups,
    queryFn: async () => (await groupApi.getAll()).data?.data || [],
  });
  const groups = groupsQuery.data || [];
  const isManagerWithSingleGroup = userLevel > 10 && userLevel < 100 && groups.length === 1;
  const managerGroupId = isManagerWithSingleGroup ? String(groups[0].id) : '';

  useEffect(() => {
    if (!isManagerWithSingleGroup) return;
    setFormData((current) => (current.group_id === managerGroupId ? current : { ...current, group_id: managerGroupId }));
  }, [isManagerWithSingleGroup, managerGroupId]);

  const saveProjectMutation = useMutation({
    mutationFn: async (data: Partial<Project>) => {
      if (editingProject) {
        await projectApi.update(editingProject.id, data);
        return 'Project updated';
      }
      await projectApi.create(data);
      return 'Project created';
    },
    onSuccess: async (message) => {
      setFeedback({ tone: 'success', message });
      setShowModal(false);
      resetForm();
      await queryClient.invalidateQueries({ queryKey: queryKeys.projects });
    },
    onError: (mutationError: any) => {
      setFeedback({ tone: 'error', message: extractSaveError(mutationError) });
    },
  });

  const deleteProjectMutation = useMutation({
    mutationFn: async (id: number) => {
      await projectApi.delete(id);
    },
    onSuccess: async () => {
      setFeedback({ tone: 'success', message: 'Project deleted' });
      setPendingDelete(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.projects });
    },
    onError: (mutationError: any) => {
      setFeedback({
        tone: 'error',
        message: mutationError?.response?.data?.message || 'Failed to delete project.',
      });
    },
  });

  const resetForm = () => {
    setFormData({ ...emptyForm(), group_id: managerGroupId });
    setEditingProject(null);
  };

  const openEditModal = (project: Project) => {
    setEditingProject(project);
    setFormData({
      name: project.name,
      group_id: project.group_id ? String(project.group_id) : '',
      description: project.description || '',
      color: project.color || PROJECT_COLORS[0],
      // Not `.toString()`: the decimal:2 cast serialises as "150000.00", which
      // is what the edit form used to put in the box.
      budget: decimalToInputValue(project.budget),
      budget_type: project.budget_type === 'amount' ? 'amount' : 'hours',
      hourly_rate: decimalToInputValue(project.hourly_rate),
      deadline: project.deadline?.split('T')[0] || '',
      status: project.status,
    });
    setShowModal(true);
  };

  const visibleProjects = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const filtered = projects.filter((project) => {
      if (statusFilter !== 'all' && project.status !== statusFilter) return false;
      if (!needle) return true;
      return [project.name, project.description, project.group?.name]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(needle);
    });
    return sortProjects(filtered, sort);
  }, [projects, search, statusFilter, sort]);

  const grouped = useMemo(() => {
    const buckets = new Map<string, { label: string; projects: Project[] }>();
    visibleProjects.forEach((project) => {
      const label = project.group?.name || 'No department';
      const bucket = buckets.get(label);
      if (bucket) bucket.projects.push(project);
      else buckets.set(label, { label, projects: [project] });
    });
    return Array.from(buckets.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [visibleProjects]);

  const summary = useMemo(() => {
    const overBudget = visibleProjects.filter((project) => (getProjectBurn(project).percent ?? 0) > 100).length;
    const pastDeadline = visibleProjects.filter((project) => getProjectBurn(project).overdue).length;
    const tracked = visibleProjects.reduce((total, project) => total + Number(project.tracked_seconds || 0), 0);
    return { overBudget, pastDeadline, tracked };
  }, [visibleProjects]);

  if (isLoading || groupsQuery.isLoading) {
    return <PageLoadingState label="Loading projects..." />;
  }

  if (isError || groupsQuery.isError) {
    return (
      <PageErrorState
        message={
          (error as any)?.response?.data?.message ||
          (groupsQuery.error as any)?.response?.data?.message ||
          'Failed to load projects.'
        }
        onRetry={() => refetch()}
      />
    );
  }

  return (
    <div className="space-y-4">
      {feedback ? <FeedbackBanner tone={feedback.tone} message={feedback.message} /> : null}

      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h1 className="text-2xl font-semibold tracking-[-0.03em] text-slate-950">Projects</h1>
        <p className="text-sm text-slate-600">
          <span className="font-medium text-slate-700">{visibleProjects.length}</span> project
          {visibleProjects.length === 1 ? '' : 's'} · {formatHours(summary.tracked)} tracked
          {summary.overBudget > 0 ? (
            <>
              {' · '}
              <span className="font-medium text-rose-700">{summary.overBudget}</span> over budget
            </>
          ) : null}
          {summary.pastDeadline > 0 ? (
            <>
              {' · '}
              <span className="font-medium text-rose-700">{summary.pastDeadline}</span> past deadline
            </>
          ) : null}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600"
            aria-hidden="true"
          />
          <input
            type="search"
            aria-label="Search projects"
            placeholder="Search projects..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="min-h-10 w-full rounded-lg border border-slate-200 bg-surface-card pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-600 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-sky-300"
          />
        </div>

        <div className="inline-flex overflow-hidden rounded-lg border border-slate-200" role="group" aria-label="View">
          {[
            { value: 'ledger' as const, label: 'Ledger', icon: List },
            { value: 'gallery' as const, label: 'Gallery', icon: LayoutGrid },
          ].map((option) => {
            const Icon = option.icon;
            const active = view === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={active}
                onClick={() => setView(option.value)}
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

        <SelectInput
          className="w-36"
          aria-label="Filter by status"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
        >
          <option value="active">Active</option>
          <option value="completed">Completed</option>
          <option value="archived">Archived</option>
          <option value="all">All statuses</option>
        </SelectInput>

        <SelectInput
          className="w-40"
          aria-label="Sort projects"
          value={sort}
          onChange={(event) => setSort(event.target.value as ProjectSort)}
        >
          <option value="burn">Budget burn</option>
          <option value="deadline">Deadline</option>
          <option value="tracked">Hours tracked</option>
          <option value="name">Name</option>
        </SelectInput>

        {canManageProjects ? (
          <Button
            size="sm"
            iconLeft={<Plus className="h-4 w-4" />}
            onClick={() => {
              resetForm();
              setShowModal(true);
            }}
          >
            New project
          </Button>
        ) : null}
      </div>

      {visibleProjects.length === 0 ? (
        <PageEmptyState
          title={projects.length === 0 ? 'No projects yet' : 'No projects match these filters'}
          description={
            projects.length === 0 ? 'Create your first project to get started.' : 'Try a different status or search.'
          }
        />
      ) : view === 'ledger' ? (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-surface-card">
          <table className="w-full min-w-[54rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600">
                <th scope="col" className="px-3 py-2.5">Project</th>
                <th scope="col" className="w-64 px-3 py-2.5">Budget used</th>
                <th scope="col" className="px-3 py-2.5 text-right">Tracked</th>
                <th scope="col" className="px-3 py-2.5 text-right">Budget</th>
                <th scope="col" className="px-3 py-2.5">Deadline</th>
                {canManageProjects ? <th scope="col" className="px-3 py-2.5"><span className="sr-only">Actions</span></th> : null}
              </tr>
            </thead>
            {grouped.map((group) => (
              <Fragment key={group.label}>
                {/* A group header for a single group is a row that says nothing. */}
                {grouped.length > 1 ? (
                  <tbody>
                    <tr>
                      <th
                        scope="colgroup"
                        colSpan={canManageProjects ? 6 : 5}
                        className="border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600"
                      >
                        {group.label}
                        <span className="ml-2 font-normal normal-case tracking-normal">
                          {group.projects.length} project{group.projects.length === 1 ? '' : 's'} ·{' '}
                          {formatHours(group.projects.reduce((total, p) => total + Number(p.tracked_seconds || 0), 0))}
                        </span>
                      </th>
                    </tr>
                  </tbody>
                ) : null}
                <tbody>
                  {group.projects.map((project) => {
                    const burn = getProjectBurn(project);
                    const remaining = daysUntil(project.deadline);

                    return (
                      <tr key={project.id} className="group border-b border-slate-100 transition last:border-0 hover:bg-blue-50/40">
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2.5">
                            <span
                              aria-hidden="true"
                              className="h-6 w-1 shrink-0 rounded-full"
                              style={{ backgroundColor: project.color }}
                            />
                            <div className="min-w-0">
                              <p className="truncate font-medium text-slate-950">{project.name}</p>
                              <p className="truncate text-xs text-slate-600">
                                {project.tasks_count ?? 0} task{(project.tasks_count ?? 0) === 1 ? '' : 's'}
                                {project.description ? ` · ${project.description}` : ''}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <ProjectBurnBar burn={burn} label={describeBurn(project.name, burn)} />
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                          {formatHours(project.tracked_seconds)}
                          {/* Without this the bar shows a percentage of a
                              number the table never states. */}
                          {burn.spentAmount !== null ? (
                            <span className="block text-xs text-slate-500">
                              {formatCurrency(burn.spentAmount)}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">
                          {formatBudget(burn)}
                        </td>
                        <td className="px-3 py-2.5">
                          <span
                            className={cn(
                              'whitespace-nowrap text-xs tabular-nums',
                              burn.overdue ? 'font-semibold text-rose-700' : 'text-slate-600'
                            )}
                          >
                            {formatDeadline(project.deadline)}
                            {burn.overdue && remaining !== null ? ` · ${Math.abs(remaining)}d late` : ''}
                          </span>
                        </td>
                        {canManageProjects ? (
                          <td className="px-3 py-2.5">
                            <div className="flex items-center justify-end gap-1 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100">
                              <button
                                type="button"
                                aria-label={`Edit ${project.name}`}
                                onClick={() => openEditModal(project)}
                                className="rounded p-1 text-slate-600 transition hover:bg-slate-100 hover:text-slate-950"
                              >
                                <Edit2 className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                aria-label={`Delete ${project.name}`}
                                onClick={() => setPendingDelete(project)}
                                className="rounded p-1 text-slate-600 transition hover:bg-rose-50 hover:text-rose-700"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </Fragment>
            ))}
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visibleProjects.map((project) => {
            const burn = getProjectBurn(project);
            return (
              <div key={project.id} className="rounded-lg border border-slate-200 bg-surface-card p-4 transition hover:border-slate-300">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span
                      aria-hidden="true"
                      className="h-8 w-8 shrink-0 rounded-lg"
                      style={{ backgroundColor: project.color }}
                    />
                    <div className="min-w-0">
                      <h3 className="truncate font-semibold text-slate-950">{project.name}</h3>
                      <p className="truncate text-xs capitalize text-slate-600">
                        {project.group?.name ? `${project.group.name} · ` : ''}
                        {project.status.replace('_', ' ')}
                      </p>
                    </div>
                  </div>
                  {canManageProjects ? (
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        aria-label={`Edit ${project.name}`}
                        onClick={() => openEditModal(project)}
                        className="rounded p-1.5 text-slate-600 transition hover:bg-slate-100 hover:text-slate-950"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${project.name}`}
                        onClick={() => setPendingDelete(project)}
                        className="rounded p-1.5 text-slate-600 transition hover:bg-rose-50 hover:text-rose-700"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : null}
                </div>

                <div className="mt-3">
                  <ProjectBurnBar burn={burn} label={describeBurn(project.name, burn)} />
                </div>

                <dl className="mt-3 flex items-center justify-between gap-3 text-xs">
                  <div>
                    <dt className="text-slate-600">Tracked</dt>
                    <dd className="mt-0.5 font-medium tabular-nums text-slate-950">{formatHours(project.tracked_seconds)}</dd>
                  </div>
                  {/* Kept in step with the ledger's Budget column so the two
                      views cannot disagree about what a project costs. */}
                  <div className="text-center">
                    <dt className="text-slate-600">Budget</dt>
                    <dd className="mt-0.5 font-medium tabular-nums text-slate-950">{formatBudget(burn)}</dd>
                  </div>
                  <div className="text-right">
                    <dt className="text-slate-600">Deadline</dt>
                    <dd
                      className={cn(
                        'mt-0.5 font-medium tabular-nums',
                        burn.overdue ? 'text-rose-700' : 'text-slate-950'
                      )}
                    >
                      {formatDeadline(project.deadline)}
                    </dd>
                  </div>
                </dl>
              </div>
            );
          })}
        </div>
      )}

      {showModal && canManageProjects ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-lg bg-surface-card p-6 shadow-modal">
            <h2 className="text-xl font-semibold text-slate-950">{editingProject ? 'Edit project' : 'New project'}</h2>
            <form
              className="mt-5 space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                setFeedback(null);
                saveProjectMutation.mutate({
                  name: formData.name,
                  description: formData.description,
                  color: formData.color,
                  group_id: formData.group_id ? Number(formData.group_id) : undefined,
                  status: formData.status as Project['status'],
                  budget: formData.budget ? parseFloat(formData.budget) : undefined,
                  budget_type: formData.budget_type,
                  // Explicitly null, not undefined: update() reads the payload
                  // with $request->only(), which skips absent keys, so an
                  // undefined here would leave a stale rate on the row.
                  hourly_rate:
                    formData.budget_type === 'amount' && formData.hourly_rate
                      ? parseFloat(formData.hourly_rate)
                      : null,
                  deadline: formData.deadline || undefined,
                });
              }}
            >
              <div>
                <FieldLabel>Name</FieldLabel>
                <TextInput
                  required
                  value={formData.name}
                  onChange={(event) => setFormData({ ...formData, name: event.target.value })}
                />
              </div>

              <div>
                <FieldLabel>Department</FieldLabel>
                {isManagerWithSingleGroup ? (
                  <div className="min-h-11 w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700">
                    {groups[0]?.name || 'Assigned department'}
                  </div>
                ) : (
                  <SelectInput
                    required
                    value={formData.group_id}
                    onChange={(event) => setFormData({ ...formData, group_id: event.target.value })}
                  >
                    <option value="">Select department</option>
                    {groups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                  </SelectInput>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <FieldLabel>Budget</FieldLabel>
                  <div className="flex gap-2">
                    <TextInput
                      type="number"
                      step="0.01"
                      min="0"
                      max={MAX_BUDGET}
                      value={formData.budget}
                      onChange={(event) => setFormData({ ...formData, budget: event.target.value })}
                      placeholder={formData.budget_type === 'amount' ? '150000' : '200'}
                    />
                    <div
                      className="inline-flex shrink-0 overflow-hidden rounded-lg border border-slate-200"
                      role="group"
                      aria-label="Budget type"
                    >
                      {BUDGET_TYPES.map((option) => {
                        const active = formData.budget_type === option.value;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            aria-pressed={active}
                            /* Switching unit keeps the number and reinterprets
                               it — it does not convert. Converting hours to
                               money needs a rate the user may not have given
                               yet, and would silently multiply their figure by
                               a four-digit number. Reinterpreting is visible
                               the instant the preview line below re-renders.
                               The rate is kept in state so toggling back
                               restores it; only the payload nulls it. */
                            onClick={() => setFormData({ ...formData, budget_type: option.value })}
                            className={cn(
                              'inline-flex min-h-10 items-center px-3 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300',
                              active ? 'bg-blue-700 text-on-brand' : 'bg-surface-card text-slate-700 hover:bg-slate-50'
                            )}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  {formData.budget && Number.isFinite(Number(formData.budget)) ? (
                    <p className="mt-1 text-xs text-slate-500">
                      {formData.budget_type === 'amount'
                        ? formatCurrency(Number(formData.budget))
                        : `${formatNumber(Number(formData.budget))} hours`}
                    </p>
                  ) : null}
                </div>
                <div>
                  {/* The column, the model and the validator have always
                      supported a deadline — there was simply no field for it. */}
                  <FieldLabel>Deadline</FieldLabel>
                  <TextInput
                    type="date"
                    value={formData.deadline}
                    onChange={(event) => setFormData({ ...formData, deadline: event.target.value })}
                  />
                </div>
              </div>

              {formData.budget_type === 'amount' ? (
                <div>
                  <FieldLabel hint="Optional">Hourly rate</FieldLabel>
                  <TextInput
                    type="number"
                    step="0.01"
                    min="0"
                    max={MAX_BUDGET}
                    value={formData.hourly_rate}
                    onChange={(event) => setFormData({ ...formData, hourly_rate: event.target.value })}
                    placeholder="1200"
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    Used to value tracked hours against this budget. Without it the budget still
                    shows, but no spend can be measured against it.
                  </p>
                </div>
              ) : null}

              <div>
                <FieldLabel>Status</FieldLabel>
                <SelectInput
                  value={formData.status}
                  onChange={(event) => setFormData({ ...formData, status: event.target.value })}
                >
                  <option value="active">Active</option>
                  <option value="completed">Completed</option>
                  <option value="archived">Archived</option>
                </SelectInput>
              </div>

              <div>
                <FieldLabel>Colour</FieldLabel>
                <div className="flex flex-wrap gap-2">
                  {PROJECT_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      aria-label={`Use colour ${color}`}
                      aria-pressed={formData.color === color}
                      onClick={() => setFormData({ ...formData, color })}
                      className={cn(
                        'h-8 w-8 rounded-lg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300',
                        formData.color === color ? 'ring-2 ring-slate-900 ring-offset-2' : ''
                      )}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>

              <div>
                <FieldLabel>Description</FieldLabel>
                <TextareaInput
                  rows={3}
                  value={formData.description}
                  onChange={(event) => setFormData({ ...formData, description: event.target.value })}
                />
              </div>

              <div className="flex flex-col-reverse gap-3 pt-1 sm:flex-row sm:justify-end">
                <Button variant="secondary" onClick={() => setShowModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saveProjectMutation.isPending}>
                  {saveProjectMutation.isPending ? 'Saving...' : editingProject ? 'Update' : 'Create'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        isOpen={Boolean(pendingDelete)}
        tone="danger"
        title="Delete this project?"
        message={
          pendingDelete
            ? `"${pendingDelete.name}" will be removed. Tasks that belong to it are not deleted, but they lose their project.`
            : ''
        }
        confirmLabel="Delete project"
        isLoading={deleteProjectMutation.isPending}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) deleteProjectMutation.mutate(pendingDelete.id);
        }}
      />

      {summary.overBudget > 0 ? (
        <p className="flex items-center gap-2 text-xs text-slate-600">
          <AlertTriangle className="h-3.5 w-3.5 text-rose-600" aria-hidden="true" />
          A bar that has passed its deadline tick is consuming budget faster than the schedule allows.
        </p>
      ) : null}
    </div>
  );
}
