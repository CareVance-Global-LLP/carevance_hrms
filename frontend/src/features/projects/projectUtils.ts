import type { Project } from '@/types';

export const PROJECT_COLORS = [
  '#EF4444',
  '#F59E0B',
  '#10B981',
  '#3B82F6',
  '#8B5CF6',
  '#EC4899',
  '#6366F1',
  '#14B8A6',
];

export const formatHours = (seconds?: number | null) => {
  const value = Number(seconds || 0);
  if (value <= 0) return '0h';
  const hours = Math.floor(value / 3600);
  const minutes = Math.round((value % 3600) / 60);
  if (hours && minutes) return `${hours}h ${minutes}m`;
  if (hours) return `${hours}h`;
  return `${minutes}m`;
};

export const formatDeadline = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value.includes('T') ? value : `${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

export const daysUntil = (value?: string | null): number | null => {
  if (!value) return null;
  const date = new Date(value.includes('T') ? value : `${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  return Math.round((date.getTime() - startOfToday.getTime()) / 86_400_000);
};

export type BurnTone = 'good' | 'warn' | 'over' | 'none';

export interface ProjectBurn {
  /** Tracked hours as a share of the budget, uncapped. Null when no budget. */
  percent: number | null;
  tone: BurnTone;
  trackedSeconds: number;
  budgetHours: number | null;
  /**
   * Where "now" sits between the project's creation and its deadline, 0–100.
   * Null when there is no deadline. Drawn as a tick on the same bar so a fill
   * that has run past the tick reads as "burning faster than the calendar".
   */
  elapsedPercent: number | null;
  overdue: boolean;
}

/**
 * A project is a budget, a deadline and hours running against both. The card
 * grid showed a colour block and a status word and hid all three; this is the
 * one computation the ledger row is built on.
 */
export const getProjectBurn = (project: Project): ProjectBurn => {
  const trackedSeconds = Number(project.tracked_seconds || 0);
  const budgetHours = project.budget != null && Number(project.budget) > 0 ? Number(project.budget) : null;

  const percent = budgetHours ? Math.round((trackedSeconds / (budgetHours * 3600)) * 100) : null;

  let tone: BurnTone = 'none';
  if (percent !== null) {
    if (percent > 100) tone = 'over';
    else if (percent >= 80) tone = 'warn';
    else tone = 'good';
  }

  const remainingDays = daysUntil(project.deadline);
  let elapsedPercent: number | null = null;
  if (project.deadline) {
    const start = new Date(project.created_at).getTime();
    const end = new Date(
      project.deadline.includes('T') ? project.deadline : `${project.deadline}T00:00:00`
    ).getTime();
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      elapsedPercent = Math.max(0, Math.min(100, Math.round(((Date.now() - start) / (end - start)) * 100)));
    }
  }

  return {
    percent,
    tone,
    trackedSeconds,
    budgetHours,
    elapsedPercent,
    overdue: remainingDays !== null && remainingDays < 0 && project.status === 'active',
  };
};

export type ProjectSort = 'burn' | 'name' | 'tracked' | 'deadline';

export const sortProjects = (projects: Project[], sort: ProjectSort) => {
  const copy = [...projects];
  if (sort === 'name') return copy.sort((a, b) => a.name.localeCompare(b.name));
  if (sort === 'tracked') return copy.sort((a, b) => Number(b.tracked_seconds || 0) - Number(a.tracked_seconds || 0));
  if (sort === 'deadline') {
    return copy.sort((a, b) => {
      const aDue = a.deadline ? new Date(a.deadline).getTime() : Number.POSITIVE_INFINITY;
      const bDue = b.deadline ? new Date(b.deadline).getTime() : Number.POSITIVE_INFINITY;
      return aDue - bDue;
    });
  }
  // Default: the projects in trouble first — that is what this page is for.
  return copy.sort((a, b) => (getProjectBurn(b).percent ?? -1) - (getProjectBurn(a).percent ?? -1));
};
