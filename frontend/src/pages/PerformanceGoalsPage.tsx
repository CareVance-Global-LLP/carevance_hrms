import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Pencil,
  Plus,
  Target,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import {
  performanceApi,
  type GoalCheckIn,
  type GoalMilestone,
  type GoalScope,
  type PerformanceGoal,
} from '@/services/performanceApi';
import { userApi, groupApi, getApiErrorMessage } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import { hasAdminAccess } from '@/lib/permissions';
import Button from '@/components/ui/Button';
import StatusBadge from '@/components/ui/StatusBadge';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import EmployeeSelect from '@/components/ui/EmployeeSelect';
import { FieldLabel, TextInput, TextareaInput, SelectInput } from '@/components/ui/FormField';
import { FeedbackBanner, PageErrorState, PageLoadingState } from '@/components/ui/PageState';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import PageHeader from '@/components/dashboard/PageHeader';
import MetricCard from '@/components/dashboard/MetricCard';
import SlideOver from '@/features/employees/SlideOver';
import { cn } from '@/utils/cn';

type ScopeTab = 'mine' | 'team' | 'all' | 'company';
type GoalHealth = 'on_track' | 'at_risk' | 'off_track' | 'achieved' | 'cancelled';

const SCOPE_LABELS: Record<GoalScope, string> = {
  individual: 'Individual',
  team: 'Team',
  company: 'Company',
};

/** Who a goal belongs to, as shown on cards and in the tree. */
function goalOwnerLabel(goal: PerformanceGoal): string {
  if (goal.scope === 'company') return 'Company-wide';
  if (goal.scope === 'team') return goal.group?.name ?? 'Team';
  return goal.employee?.name ?? 'Unknown';
}

const CATEGORY_LABELS: Record<PerformanceGoal['category'], string> = {
  development: 'Development',
  performance: 'Performance',
  behavior: 'Behavior',
  project: 'Project',
};

const HEALTH_META: Record<GoalHealth, { label: string; tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral'; bar: string }> = {
  on_track: { label: 'On track', tone: 'success', bar: 'bg-blue-600' },
  at_risk: { label: 'At risk', tone: 'warning', bar: 'bg-amber-500' },
  off_track: { label: 'Off track', tone: 'danger', bar: 'bg-rose-500' },
  achieved: { label: 'Achieved', tone: 'info', bar: 'bg-emerald-500' },
  cancelled: { label: 'Cancelled', tone: 'neutral', bar: 'bg-slate-300' },
};

/**
 * Health is computed, never stored: progress compared against how far
 * through the goal window we are, so it can't go stale.
 */
function goalHealth(goal: PerformanceGoal): GoalHealth {
  if (goal.status === 'cancelled') return 'cancelled';
  if (goal.status === 'completed' || goal.progress_percentage >= 100) return 'achieved';
  const start = new Date(goal.start_date).getTime();
  const end = new Date(goal.end_date).getTime();
  const now = Date.now();
  if (now >= end) return 'off_track';
  const expected = end > start ? ((now - start) / (end - start)) * 100 : 0;
  if (goal.progress_percentage >= expected - 10) return 'on_track';
  if (goal.progress_percentage >= expected - 25) return 'at_risk';
  return 'off_track';
}

function goalMilestones(goal: PerformanceGoal): GoalMilestone[] {
  const raw = goal.target_metrics?.milestones;
  if (!Array.isArray(raw)) return [];
  return raw.filter((m): m is GoalMilestone => Boolean(m) && typeof m === 'object' && typeof (m as GoalMilestone).title === 'string');
}

/** Legacy hand-typed JSON keys (anything other than `milestones`), shown read-only. */
function legacyMetrics(goal: PerformanceGoal): Array<[string, unknown]> {
  if (!goal.target_metrics) return [];
  return Object.entries(goal.target_metrics).filter(([key]) => key !== 'milestones');
}

function newMilestoneId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `ms-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

interface GoalFormState {
  scope: GoalScope;
  employee_id: number | '';
  group_id: number | '';
  parent_goal_id: number | '';
  title: string;
  description: string;
  category: PerformanceGoal['category'];
  start_date: string;
  end_date: string;
  weight: string;
  status: PerformanceGoal['status'];
  milestones: GoalMilestone[];
}

const emptyForm = (): GoalFormState => ({
  scope: 'individual',
  employee_id: '',
  group_id: '',
  parent_goal_id: '',
  title: '',
  description: '',
  category: 'development',
  start_date: '',
  end_date: '',
  weight: '100',
  status: 'active',
  milestones: [],
});

interface GoalCardProps {
  goal: PerformanceGoal;
  canManage: boolean;
  canUpdateProgress: boolean;
  isSaving: boolean;
  onEdit: (goal: PerformanceGoal) => void;
  onDelete: (goal: PerformanceGoal) => void;
  onCheckIn: (goal: PerformanceGoal, progress: number, note: string) => void;
  onToggleMilestone: (goal: PerformanceGoal, milestoneId: string) => void;
}

function GoalCard({
  goal,
  canManage,
  canUpdateProgress,
  isSaving,
  onEdit,
  onDelete,
  onCheckIn,
  onToggleMilestone,
}: GoalCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [editingProgress, setEditingProgress] = useState(false);
  const [progressDraft, setProgressDraft] = useState(goal.progress_percentage);
  const [noteDraft, setNoteDraft] = useState('');

  const health = goalHealth(goal);
  const meta = HEALTH_META[health];
  const milestones = goalMilestones(goal);
  const doneCount = milestones.filter((m) => m.done).length;
  const legacy = legacyMetrics(goal);

  const checkInsQuery = useQuery({
    queryKey: ['goal-check-ins', goal.id],
    queryFn: () => performanceApi.getCheckIns(goal.id),
    enabled: expanded,
    staleTime: 30_000,
  });
  const checkIns = checkInsQuery.data ?? [];

  return (
    <SurfaceCard className="p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-900">{goal.title}</h3>
            {goal.scope !== 'individual' ? (
              <StatusBadge tone={goal.scope === 'company' ? 'info' : 'neutral'}>{SCOPE_LABELS[goal.scope]}</StatusBadge>
            ) : null}
            <StatusBadge tone="neutral">{CATEGORY_LABELS[goal.category] ?? goal.category}</StatusBadge>
            <span className="text-[11px] font-medium text-slate-500">Weight {goal.weight}%</span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {goalOwnerLabel(goal)} · {formatDate(goal.start_date)} – {formatDate(goal.end_date)}
            {goal.parent ? (
              <span className="ml-2 rounded-full bg-blue-500/10 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                ↑ {goal.parent.title}
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
          {canManage ? (
            <>
              <button
                type="button"
                onClick={() => onEdit(goal)}
                className="rounded-lg p-1.5 text-slate-500 transition hover:bg-blue-500/[0.08] hover:text-blue-700"
                aria-label="Edit goal"
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => onDelete(goal)}
                className="rounded-lg p-1.5 text-slate-500 transition hover:bg-rose-50 hover:text-rose-500"
                aria-label="Delete goal"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
          <div
            className={cn('h-full rounded-full transition-all', meta.bar)}
            style={{ width: `${Math.min(goal.progress_percentage, 100)}%` }}
          />
        </div>
        <span className="min-w-[2.5rem] text-right text-xs font-bold tabular-nums text-slate-700">
          {goal.progress_percentage}%
        </span>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 transition hover:text-slate-800"
        >
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          {milestones.length > 0 ? `${doneCount} of ${milestones.length} milestones` : 'Details'}
        </button>
        {canUpdateProgress && goal.status === 'active' && !editingProgress ? (
          <button
            type="button"
            onClick={() => {
              setProgressDraft(goal.progress_percentage);
              setNoteDraft('');
              setEditingProgress(true);
            }}
            className="text-xs font-semibold text-blue-600 transition hover:text-blue-700"
          >
            Check in →
          </button>
        ) : null}
      </div>

      {editingProgress ? (
        <div className="mt-3 space-y-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
          <TextInput
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            placeholder="What moved since last time? (optional)"
            aria-label="Check-in note"
          />
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="range"
              min={0}
              max={100}
              value={progressDraft}
              onChange={(e) => setProgressDraft(Number(e.target.value))}
              className="min-w-[8rem] flex-1 accent-[#5D969D]"
              aria-label="Progress percentage"
            />
            <span className="w-16 whitespace-nowrap text-right text-xs font-bold tabular-nums text-slate-700">
              {goal.progress_percentage} ▸ {progressDraft}%
            </span>
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="secondary" onClick={() => setEditingProgress(false)} disabled={isSaving}>
                Cancel
              </Button>
              <Button
                size="sm"
                loading={isSaving}
                onClick={() => {
                  onCheckIn(goal, progressDraft, noteDraft.trim());
                  setEditingProgress(false);
                }}
              >
                Check in
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {expanded ? (
        <div className="mt-3 space-y-3 border-t border-dashed border-slate-200 pt-3">
          {goal.description ? <p className="text-sm text-slate-600">{goal.description}</p> : null}

          {milestones.length > 0 ? (
            <div className="space-y-1.5">
              {milestones.map((milestone) => (
                <label
                  key={milestone.id}
                  className={cn(
                    'flex items-center gap-2.5 text-sm',
                    milestone.done ? 'text-slate-500 line-through' : 'text-slate-700',
                    canManage ? 'cursor-pointer' : 'cursor-default'
                  )}
                >
                  <input
                    type="checkbox"
                    checked={milestone.done}
                    disabled={!canManage || isSaving}
                    onChange={() => onToggleMilestone(goal, milestone.id)}
                    className="h-4 w-4 rounded border-slate-300 accent-[#5D969D]"
                  />
                  {milestone.title}
                </label>
              ))}
              {!canManage ? (
                <p className="text-[11px] text-slate-500">Milestones are updated by your manager — use "Update progress" for your own updates.</p>
              ) : null}
            </div>
          ) : null}

          {legacy.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {legacy.map(([key, value]) => (
                <span key={key} className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                  {key}: {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                </span>
              ))}
            </div>
          ) : null}

          {checkIns.length > 0 ? (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Check-in history</p>
              <div className="mt-1.5">
                {checkIns.map((checkIn: GoalCheckIn, index) => (
                  <div key={checkIn.id} className="grid grid-cols-[14px_1fr] gap-x-3">
                    <div className="flex flex-col items-center">
                      <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', index === 0 ? 'bg-blue-600' : 'bg-slate-300')} />
                      {index < checkIns.length - 1 ? <span className="w-0.5 flex-1 bg-slate-100" /> : null}
                    </div>
                    <div className="pb-2.5">
                      <p className="text-sm text-slate-600">
                        {checkIn.note || 'Progress updated'}{' '}
                        <span className="font-semibold text-blue-700">▸ {checkIn.progress_percentage}%</span>
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {checkIn.user?.name ?? 'Unknown'} · {formatDate(checkIn.created_at)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <p className="text-xs text-slate-500">
            Manager: {goal.manager?.name || 'Not assigned'} · Created {formatDate(goal.created_at)}
          </p>
        </div>
      ) : null}
    </SurfaceCard>
  );
}

/** Read-only alignment tree: company goals → their children → grandchildren. */
function AlignmentTree({ goals }: { goals: PerformanceGoal[] }) {
  const childrenOf = (id: number) => goals.filter((g) => g.parent_goal_id === id);
  const companyGoals = goals.filter((g) => g.scope === 'company');
  const orphanTeamGoals = goals.filter(
    (g) => g.scope === 'team' && (!g.parent_goal_id || !goals.some((p) => p.id === g.parent_goal_id))
  );
  const roots = [...companyGoals, ...orphanTeamGoals];

  if (!roots.length) {
    return (
      <SurfaceCard className="p-10 text-center text-slate-500">
        <Target className="mx-auto mb-3 h-12 w-12 text-slate-300" />
        <p className="font-medium text-slate-700">No company or team goals yet</p>
        <p className="mt-1 text-sm">Create a goal with scope "Company" or "Team", then ladder individual goals up to it.</p>
      </SurfaceCard>
    );
  }

  const row = (goal: PerformanceGoal) => {
    const meta = HEALTH_META[goalHealth(goal)];
    return (
      <div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
        <StatusBadge tone={goal.scope === 'company' ? 'info' : goal.scope === 'team' ? 'neutral' : 'success'}>
          {goal.scope === 'individual' ? (goal.employee?.name ?? 'Individual') : SCOPE_LABELS[goal.scope]}
        </StatusBadge>
        <span className={cn('min-w-0 flex-1 truncate text-sm text-slate-800', goal.scope !== 'individual' && 'font-semibold')}>
          {goal.title}
        </span>
        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
          <div className={cn('h-full rounded-full', meta.bar)} style={{ width: `${Math.min(goal.progress_percentage, 100)}%` }} />
        </div>
        <span className="w-9 text-right text-xs font-bold tabular-nums text-slate-600">{goal.progress_percentage}%</span>
      </div>
    );
  };

  return (
    <SurfaceCard className="p-2">
      {roots.map((root) => (
        <div key={root.id}>
          {row(root)}
          {childrenOf(root.id).length ? (
            <div className="mb-1 ml-6 border-l-2 border-slate-100 pl-3">
              {childrenOf(root.id).map((child) => (
                <div key={child.id}>
                  {row(child)}
                  {childrenOf(child.id).length ? (
                    <div className="ml-6 border-l-2 border-slate-100 pl-3">
                      {childrenOf(child.id).map((grandchild) => (
                        <div key={grandchild.id}>{row(grandchild)}</div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </SurfaceCard>
  );
}

export default function PerformanceGoalsPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';
  const canPickEmployees = hasAdminAccess(user);
  const myId = user?.id;

  const [scope, setScope] = useState<ScopeTab>(isAdmin ? 'all' : 'mine');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('active');
  const [banner, setBanner] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<PerformanceGoal | null>(null);
  const [form, setForm] = useState<GoalFormState>(emptyForm());
  const [deleteTarget, setDeleteTarget] = useState<PerformanceGoal | null>(null);
  const [savingGoalId, setSavingGoalId] = useState<number | null>(null);

  const goalsQuery = useQuery({
    queryKey: ['performance-goals'],
    queryFn: () => performanceApi.getGoals(),
  });

  const employeesQuery = useQuery({
    queryKey: ['performance-employee-picker'],
    queryFn: async () => (await userApi.getAll({ simple: true })).data,
    enabled: formOpen && canPickEmployees,
    staleTime: 60_000,
  });
  const employees = (employeesQuery.data ?? []).map((u: any) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role_name ?? u.role ?? null,
  }));

  const groupsQuery = useQuery({
    queryKey: ['performance-groups'],
    queryFn: async () => (await groupApi.getAll()).data.data,
    enabled: formOpen && form.scope === 'team',
    staleTime: 300_000,
  });
  const groups = groupsQuery.data ?? [];

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['performance-goals'] });

  const createMutation = useMutation({
    mutationFn: (data: Partial<PerformanceGoal>) => performanceApi.createGoal(data),
    onSuccess: () => {
      invalidate();
      setFormOpen(false);
      setBanner({ tone: 'success', message: 'Goal created.' });
    },
    onError: (err) => setBanner({ tone: 'error', message: getApiErrorMessage(err, 'Failed to create goal.') }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<PerformanceGoal> }) => performanceApi.updateGoal(id, data),
    onSuccess: (_goal, variables) => {
      invalidate();
      if (formOpen) {
        setFormOpen(false);
        setEditingGoal(null);
        setBanner({ tone: 'success', message: 'Goal updated.' });
      }
      if (savingGoalId === variables.id) setSavingGoalId(null);
    },
    onError: (err, variables) => {
      setBanner({ tone: 'error', message: getApiErrorMessage(err, 'Failed to update goal.') });
      if (savingGoalId === variables.id) setSavingGoalId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => performanceApi.deleteGoal(id),
    onSuccess: () => {
      invalidate();
      setDeleteTarget(null);
      setBanner({ tone: 'success', message: 'Goal deleted.' });
    },
    onError: (err) => setBanner({ tone: 'error', message: getApiErrorMessage(err, 'Failed to delete goal.') }),
  });

  const checkInMutation = useMutation({
    mutationFn: ({ goalId, progress, note }: { goalId: number; progress: number; note: string }) =>
      performanceApi.createCheckIn(goalId, { progress_percentage: progress, note: note || undefined }),
    onSuccess: (_result, variables) => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['goal-check-ins', variables.goalId] });
      if (savingGoalId === variables.goalId) setSavingGoalId(null);
    },
    onError: (err, variables) => {
      setBanner({ tone: 'error', message: getApiErrorMessage(err, 'Failed to record the check-in.') });
      if (savingGoalId === variables.goalId) setSavingGoalId(null);
    },
  });

  const goals = goalsQuery.data ?? [];

  const scopedGoals = useMemo(() => {
    return goals.filter((goal) => {
      if (scope === 'mine') return goal.employee_id === myId;
      if (scope === 'team') return goal.manager_id === myId && goal.employee_id !== myId;
      return true;
    });
  }, [goals, scope, myId]);

  // Parent options for laddering: any team/company goal (except the goal being edited)
  const parentOptions = useMemo(
    () => goals.filter((g) => g.scope !== 'individual' && g.id !== editingGoal?.id),
    [goals, editingGoal]
  );

  const visibleGoals = useMemo(() => {
    return scopedGoals.filter((goal) => {
      if (categoryFilter !== 'all' && goal.category !== categoryFilter) return false;
      if (statusFilter !== 'all' && goal.status !== statusFilter) return false;
      return true;
    });
  }, [scopedGoals, categoryFilter, statusFilter]);

  const kpis = useMemo(() => {
    const active = scopedGoals.filter((g) => g.status === 'active');
    const totalWeight = active.reduce((sum, g) => sum + (g.weight || 0), 0);
    const avgProgress = active.length
      ? totalWeight > 0
        ? Math.round(active.reduce((sum, g) => sum + g.progress_percentage * (g.weight || 0), 0) / totalWeight)
        : Math.round(active.reduce((sum, g) => sum + g.progress_percentage, 0) / active.length)
      : null;
    const behind = active.filter((g) => {
      const health = goalHealth(g);
      return health === 'at_risk' || health === 'off_track';
    }).length;
    const achieved = scopedGoals.filter((g) => goalHealth(g) === 'achieved').length;
    return { active: active.length, avgProgress, behind, achieved };
  }, [scopedGoals]);

  const canManageGoal = (goal: PerformanceGoal) => isAdmin || goal.manager_id === myId;
  const canUpdateGoalProgress = (goal: PerformanceGoal) => canManageGoal(goal) || goal.employee_id === myId;

  const openCreate = () => {
    setEditingGoal(null);
    setForm({ ...emptyForm(), employee_id: canPickEmployees ? '' : (myId ?? '') });
    setFormOpen(true);
  };

  const openEdit = (goal: PerformanceGoal) => {
    setEditingGoal(goal);
    setForm({
      scope: goal.scope,
      employee_id: goal.employee_id ?? '',
      group_id: goal.group_id ?? '',
      parent_goal_id: goal.parent_goal_id ?? '',
      title: goal.title,
      description: goal.description ?? '',
      category: goal.category,
      start_date: goal.start_date.slice(0, 10),
      end_date: goal.end_date.slice(0, 10),
      weight: String(goal.weight),
      status: goal.status,
      milestones: goalMilestones(goal),
    });
    setFormOpen(true);
  };

  const submitForm = () => {
    const milestones = form.milestones.filter((m) => m.title.trim());
    if (editingGoal) {
      // Preserve legacy target_metrics keys alongside the milestones the UI edits
      const preserved = Object.fromEntries(legacyMetrics(editingGoal));
      updateMutation.mutate({
        id: editingGoal.id,
        data: {
          title: form.title,
          description: form.description || null,
          category: form.category,
          start_date: form.start_date,
          end_date: form.end_date,
          weight: parseInt(form.weight, 10) || 100,
          status: form.status,
          parent_goal_id: form.parent_goal_id || null,
          target_metrics: milestones.length || Object.keys(preserved).length ? { ...preserved, milestones } : null,
        },
      });
      return;
    }
    createMutation.mutate({
      scope: form.scope,
      employee_id: form.scope === 'individual' ? form.employee_id || undefined : undefined,
      group_id: form.scope === 'team' ? form.group_id || undefined : undefined,
      parent_goal_id: form.parent_goal_id || undefined,
      title: form.title,
      description: form.description || undefined,
      category: form.category,
      start_date: form.start_date,
      end_date: form.end_date,
      weight: parseInt(form.weight, 10) || 100,
      target_metrics: milestones.length ? { milestones } : undefined,
    });
  };

  const handleCheckIn = (goal: PerformanceGoal, progress: number, note: string) => {
    setSavingGoalId(goal.id);
    checkInMutation.mutate({ goalId: goal.id, progress, note });
  };

  const handleToggleMilestone = (goal: PerformanceGoal, milestoneId: string) => {
    const milestones = goalMilestones(goal).map((m) => (m.id === milestoneId ? { ...m, done: !m.done } : m));
    const doneCount = milestones.filter((m) => m.done).length;
    const preserved = Object.fromEntries(legacyMetrics(goal));
    setSavingGoalId(goal.id);
    updateMutation.mutate({
      id: goal.id,
      data: {
        target_metrics: { ...preserved, milestones },
        // Milestone ticks drive the suggested progress value
        progress_percentage: milestones.length ? Math.round((doneCount / milestones.length) * 100) : goal.progress_percentage,
      },
    });
  };

  const ownerValid =
    form.scope === 'company' ||
    (form.scope === 'team' ? Boolean(form.group_id) : Boolean(form.employee_id));
  const formValid =
    form.title.trim().length > 0 &&
    ownerValid &&
    Boolean(form.start_date) &&
    Boolean(form.end_date) &&
    form.end_date >= form.start_date;

  if (goalsQuery.isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Goals" description="Set goals, track milestones, and keep progress current" />
        <PageLoadingState label="Loading goals..." />
      </div>
    );
  }

  if (goalsQuery.isError) {
    return (
      <div className="space-y-6">
        <PageHeader title="Goals" description="Set goals, track milestones, and keep progress current" />
        <PageErrorState
          message={getApiErrorMessage(goalsQuery.error, 'Could not load performance goals.')}
          onRetry={() => goalsQuery.refetch()}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Goals"
        description="Set goals, track milestones, and keep progress current"
        actions={
          <Button onClick={openCreate} iconLeft={<Plus className="h-4 w-4" />}>
            New goal
          </Button>
        }
      />

      {banner ? (
        <FeedbackBanner tone={banner.tone} message={banner.message} onDismiss={() => setBanner(null)} />
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Active goals" value={kpis.active} icon={Target} accent="sky" />
        <MetricCard
          label="Avg progress"
          value={kpis.avgProgress !== null ? `${kpis.avgProgress}%` : '—'}
          icon={TrendingUp}
          accent="emerald"
          hint="weighted across active goals"
        />
        <MetricCard label="At risk" value={kpis.behind} icon={AlertTriangle} accent="amber" hint="behind schedule" />
        <MetricCard label="Achieved" value={kpis.achieved} icon={CheckCircle2} accent="violet" />
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="inline-flex w-fit rounded-lg bg-slate-100 p-1">
          {(
            [
              { id: 'mine', label: 'My goals' },
              { id: 'team', label: 'My team' },
              ...(isAdmin ? [{ id: 'all', label: 'All goals' }] : []),
              { id: 'company', label: 'Company' },
            ] as Array<{ id: ScopeTab; label: string }>
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setScope(tab.id)}
              className={cn(
                'rounded-md px-3.5 py-1.5 text-sm font-medium transition',
                scope === tab.id ? 'bg-surface-inverse text-on-inverse shadow-sm' : 'text-slate-600 hover:text-slate-900'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {scope !== 'company' ? (
          <div className="flex flex-wrap items-center gap-2">
            <SelectInput value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="w-40" aria-label="Filter by category">
              <option value="all">All categories</option>
              <option value="development">Development</option>
              <option value="performance">Performance</option>
              <option value="behavior">Behavior</option>
              <option value="project">Project</option>
            </SelectInput>
            <SelectInput value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-36" aria-label="Filter by status">
              <option value="active">Active</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
              <option value="all">All statuses</option>
            </SelectInput>
          </div>
        ) : null}
      </div>

      {scope === 'company' ? (
        <AlignmentTree goals={goals} />
      ) : visibleGoals.length === 0 ? (
        <SurfaceCard className="p-10 text-center text-slate-500">
          <Activity className="mx-auto mb-3 h-12 w-12 text-slate-300" />
          <p className="font-medium text-slate-700">
            {scope === 'mine' ? 'No goals for you yet' : scope === 'team' ? 'No goals for your team yet' : 'No goals match the current filters'}
          </p>
          <p className="mt-1 text-sm">Set a goal with milestones so progress has something to move against.</p>
          <Button className="mt-4" onClick={openCreate} iconLeft={<Plus className="h-4 w-4" />}>
            New goal
          </Button>
        </SurfaceCard>
      ) : (
        <div className="space-y-3">
          {visibleGoals.map((goal) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              canManage={canManageGoal(goal)}
              canUpdateProgress={canUpdateGoalProgress(goal)}
              isSaving={savingGoalId === goal.id && (updateMutation.isPending || checkInMutation.isPending)}
              onEdit={openEdit}
              onDelete={setDeleteTarget}
              onCheckIn={handleCheckIn}
              onToggleMilestone={handleToggleMilestone}
            />
          ))}
        </div>
      )}

      {/* Create / edit drawer */}
      <SlideOver
        open={formOpen}
        title={editingGoal ? 'Edit goal' : 'New goal'}
        subtitle={editingGoal ? goalOwnerLabel(editingGoal) : undefined}
        onClose={() => {
          setFormOpen(false);
          setEditingGoal(null);
        }}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setFormOpen(false);
                setEditingGoal(null);
              }}
            >
              Cancel
            </Button>
            <Button onClick={submitForm} disabled={!formValid} loading={createMutation.isPending || updateMutation.isPending}>
              {editingGoal ? 'Save changes' : 'Create goal'}
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <div>
            <FieldLabel>Title</FieldLabel>
            <TextInput
              value={form.title}
              onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
              placeholder="What should be achieved?"
            />
          </div>

          {!editingGoal ? (
            <>
              {canPickEmployees ? (
                <div>
                  <FieldLabel hint={form.scope === 'company' ? 'admins only' : undefined}>Scope</FieldLabel>
                  <SelectInput
                    value={form.scope}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        scope: e.target.value as GoalScope,
                        employee_id: e.target.value === 'individual' ? prev.employee_id : '',
                        group_id: e.target.value === 'team' ? prev.group_id : '',
                      }))
                    }
                    aria-label="Goal scope"
                  >
                    <option value="individual">Individual — one person's goal</option>
                    <option value="team">Team — a department's goal</option>
                    {isAdmin ? <option value="company">Company — an org-wide objective</option> : null}
                  </SelectInput>
                </div>
              ) : null}

              {form.scope === 'individual' ? (
                <div>
                  <FieldLabel>Employee</FieldLabel>
                  {canPickEmployees ? (
                    <>
                      <EmployeeSelect
                        employees={employees}
                        value={form.employee_id}
                        onChange={(value) => setForm((prev) => ({ ...prev, employee_id: value }))}
                        disabled={employeesQuery.isLoading}
                        placeholder={employeesQuery.isLoading ? 'Loading employees...' : 'Choose employee'}
                        ariaLabel="Goal owner"
                      />
                      {employeesQuery.isError ? (
                        <p className="mt-1 text-xs text-rose-600">Could not load the employee list. Close and reopen this panel to retry.</p>
                      ) : null}
                    </>
                  ) : (
                    <TextInput value={user?.name ?? ''} disabled aria-label="Goal owner" />
                  )}
                </div>
              ) : null}

              {form.scope === 'team' ? (
                <div>
                  <FieldLabel>Department</FieldLabel>
                  <SelectInput
                    value={String(form.group_id)}
                    onChange={(e) => setForm((prev) => ({ ...prev, group_id: e.target.value ? Number(e.target.value) : '' }))}
                    aria-label="Department"
                  >
                    <option value="">{groupsQuery.isLoading ? 'Loading departments...' : 'Choose department'}</option>
                    {groups.map((group: any) => (
                      <option key={group.id} value={String(group.id)}>
                        {group.name}
                      </option>
                    ))}
                  </SelectInput>
                </div>
              ) : null}
            </>
          ) : null}

          {form.scope !== 'company' && parentOptions.length ? (
            <div>
              <FieldLabel hint="optional">Ladders up to</FieldLabel>
              <SelectInput
                value={String(form.parent_goal_id)}
                onChange={(e) => setForm((prev) => ({ ...prev, parent_goal_id: e.target.value ? Number(e.target.value) : '' }))}
                aria-label="Parent goal"
              >
                <option value="">No parent goal</option>
                {parentOptions.map((parent) => (
                  <option key={parent.id} value={String(parent.id)}>
                    {SCOPE_LABELS[parent.scope]} · {parent.title}
                  </option>
                ))}
              </SelectInput>
            </div>
          ) : null}

          <div>
            <FieldLabel>Description</FieldLabel>
            <TextareaInput
              rows={3}
              value={form.description}
              onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
              placeholder="Why this goal matters and what done looks like..."
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel>Category</FieldLabel>
              <SelectInput
                value={form.category}
                onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value as GoalFormState['category'] }))}
              >
                <option value="development">Development</option>
                <option value="performance">Performance</option>
                <option value="behavior">Behavior</option>
                <option value="project">Project</option>
              </SelectInput>
            </div>
            <div>
              <FieldLabel hint="share of the review score">Weight %</FieldLabel>
              <TextInput
                type="number"
                min={1}
                max={100}
                value={form.weight}
                onChange={(e) => setForm((prev) => ({ ...prev, weight: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel>Start date</FieldLabel>
              <TextInput
                type="date"
                value={form.start_date}
                onChange={(e) => setForm((prev) => ({ ...prev, start_date: e.target.value }))}
              />
            </div>
            <div>
              <FieldLabel>End date</FieldLabel>
              <TextInput
                type="date"
                value={form.end_date}
                onChange={(e) => setForm((prev) => ({ ...prev, end_date: e.target.value }))}
              />
            </div>
          </div>

          {editingGoal ? (
            <div>
              <FieldLabel>Status</FieldLabel>
              <SelectInput
                value={form.status}
                onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value as GoalFormState['status'] }))}
              >
                <option value="active">Active</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </SelectInput>
            </div>
          ) : null}

          <div>
            <FieldLabel hint="ticking these suggests the progress value">Milestones</FieldLabel>
            <div className="space-y-2">
              {form.milestones.map((milestone, index) => (
                <div key={milestone.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={milestone.done}
                    onChange={() =>
                      setForm((prev) => ({
                        ...prev,
                        milestones: prev.milestones.map((m, i) => (i === index ? { ...m, done: !m.done } : m)),
                      }))
                    }
                    className="h-4 w-4 shrink-0 rounded border-slate-300 accent-[#5D969D]"
                    aria-label={`Milestone ${index + 1} done`}
                  />
                  <TextInput
                    value={milestone.title}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        milestones: prev.milestones.map((m, i) => (i === index ? { ...m, title: e.target.value } : m)),
                      }))
                    }
                    placeholder={`Milestone ${index + 1}`}
                    className="flex-1"
                  />
                  <button
                    type="button"
                    onClick={() => setForm((prev) => ({ ...prev, milestones: prev.milestones.filter((_, i) => i !== index) }))}
                    className="rounded-lg p-2 text-slate-500 transition hover:bg-rose-50 hover:text-rose-500"
                    aria-label={`Remove milestone ${index + 1}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() =>
                setForm((prev) => ({
                  ...prev,
                  milestones: [...prev.milestones, { id: newMilestoneId(), title: '', done: false }],
                }))
              }
              className="mt-2 text-xs font-semibold text-blue-600 transition hover:text-blue-700"
            >
              + Add milestone
            </button>
          </div>
        </div>
      </SlideOver>

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        title="Delete this goal?"
        message={`"${deleteTarget?.title || ''}" and its milestones will be permanently removed.`}
        confirmLabel="Delete goal"
        tone="danger"
        isLoading={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}
