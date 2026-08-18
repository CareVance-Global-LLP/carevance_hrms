/**
 * The three-bucket task pipeline the dashboard chart draws.
 *
 * Kept separate from the fetch because the bug it exists to prevent was a
 * mismatch between the two. The dashboard asked for tasks with `timer_only`,
 * which the API defines as `status != 'done'` so that a timer picker only
 * offers startable work — then rendered the result under To Do / In Progress /
 * Done. The Done bucket could never be anything but zero. Measured 18 Aug 2026:
 * 18 completed tasks in the database and no bar for any of them, with the axis
 * scaled to the 36 open tasks instead of the real 54.
 */

export type PipelineBucket = 'To Do' | 'In Progress' | 'Done';

export interface TaskPipelineRow {
  label: PipelineBucket;
  count: number;
}

export interface TaskPipeline {
  rows: TaskPipelineRow[];
  counts: Record<PipelineBucket, number>;
  /** Every task, so the axis and the "n / total" tooltip describe the whole pipeline. */
  total: number;
  /** To Do plus In Progress. What the Focus Board means by "Open Tasks". */
  openCount: number;
}

const BUCKETS: PipelineBucket[] = ['To Do', 'In Progress', 'Done'];

/**
 * Status spellings vary by source — the API returns snake_case, older rows and
 * some clients send spaced or past-tense forms. Match on substrings so a new
 * spelling lands in the right bucket rather than silently becoming a to-do.
 */
const bucketFor = (status: unknown): PipelineBucket => {
  const value = String(status ?? '').toLowerCase();
  if (value.includes('progress')) return 'In Progress';
  if (value.includes('done') || value.includes('complete')) return 'Done';
  return 'To Do';
};

export function buildTaskPipeline(tasks: Array<{ status?: unknown }>): TaskPipeline {
  const counts: Record<PipelineBucket, number> = { 'To Do': 0, 'In Progress': 0, Done: 0 };

  for (const task of tasks ?? []) {
    counts[bucketFor(task?.status)] += 1;
  }

  return {
    rows: BUCKETS.map((label) => ({ label, count: counts[label] })),
    counts,
    total: (tasks ?? []).length,
    openCount: counts['To Do'] + counts['In Progress'],
  };
}
