import { formatCurrency, formatNumber } from '@/lib/formatters';
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

export type BudgetType = 'hours' | 'amount';

/** Why a burn has no percentage. */
export type BurnUnavailable = 'no-budget' | 'no-rate';

/** The share of budget at which the bar turns amber. The seam a configurable
 *  "notify at %" would hang off — every comparable product has one. */
export const BUDGET_WARN_PERCENT = 80;

/** decimal:2 values arrive as strings; '' / null / NaN all mean "unset". */
const toNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** Only a positive number is a usable budget or rate. Guards divide-by-zero. */
const toPositive = (value: unknown): number | null => {
  const parsed = toNumber(value);
  return parsed !== null && parsed > 0 ? parsed : null;
};

/** `"150000.00"` -> `"150000"`, so the edit form does not show trailing zeroes. */
export const decimalToInputValue = (value: unknown): string => {
  const parsed = toNumber(value);
  return parsed === null ? '' : String(parsed);
};

export interface ProjectBurn {
  /** Share of the budget consumed, uncapped. Null when `unavailable` is set. */
  percent: number | null;
  tone: BurnTone;
  trackedSeconds: number;
  budgetType: BudgetType;
  /** Hours when `budgetType` is 'hours', currency when 'amount'. */
  budgetValue: number | null;
  hourlyRate: number | null;
  /** Money spent so far. Only ever set for an amount budget with a rate. */
  spentAmount: number | null;
  /** Why there is no percentage. Null when `percent` is a number. */
  unavailable: BurnUnavailable | null;
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
 *
 * The budget carries a unit. An hours budget is compared against tracked time
 * directly; a money budget has to price that time first, which needs a rate.
 * Without one there is no percentage to show — the budget is still real and
 * still displayed, there is simply nothing to divide it into.
 */
export const getProjectBurn = (project: Project): ProjectBurn => {
  const trackedSeconds = Number(project.tracked_seconds || 0);
  // An older cached response has no budget_type; the column defaults to hours,
  // so anything that is not explicitly 'amount' is read as hours.
  const budgetType: BudgetType = project.budget_type === 'amount' ? 'amount' : 'hours';
  const budgetValue = toPositive(project.budget);
  const hourlyRate = toPositive(project.hourly_rate);

  let percent: number | null = null;
  let spentAmount: number | null = null;
  let unavailable: BurnUnavailable | null = null;

  if (budgetValue === null) {
    unavailable = 'no-budget';
  } else if (budgetType === 'hours') {
    percent = Math.round((trackedSeconds / (budgetValue * 3600)) * 100);
  } else if (hourlyRate === null) {
    unavailable = 'no-rate';
  } else {
    spentAmount = (trackedSeconds / 3600) * hourlyRate;
    percent = Math.round((spentAmount / budgetValue) * 100);
  }

  let tone: BurnTone = 'none';
  if (percent !== null) {
    if (percent > 100) tone = 'over';
    else if (percent >= BUDGET_WARN_PERCENT) tone = 'warn';
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
    budgetType,
    budgetValue,
    hourlyRate,
    spentAmount,
    unavailable,
    elapsedPercent,
    overdue: remainingDays !== null && remainingDays < 0 && project.status === 'active',
  };
};

/** `"1,50,000h"` · `"₹1,50,000"` · `"—"`. The one place the unit is rendered. */
export const formatBudget = (burn: ProjectBurn): string => {
  if (burn.budgetValue === null) return '—';
  return burn.budgetType === 'amount'
    ? formatCurrency(burn.budgetValue)
    : `${formatNumber(burn.budgetValue)}h`;
};

/** The burn bar's accessible label, shared by the ledger row and the card. */
export const describeBurn = (name: string, burn: ProjectBurn): string => {
  if (burn.unavailable === 'no-budget') return `${name}: no budget set`;
  if (burn.unavailable === 'no-rate') {
    return `${name}: budget ${formatBudget(burn)}, no hourly rate set`;
  }
  return `${name}: ${burn.percent}% of budget used`;
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
  // `percent` is unit-normalised, so an hours budget and a money budget rank
  // against each other correctly; anything with no percentage sorts last.
  return copy.sort((a, b) => (getProjectBurn(b).percent ?? -1) - (getProjectBurn(a).percent ?? -1));
};
