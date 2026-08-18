import { describe, expect, it } from 'vitest';
import { buildTaskPipeline } from '@/lib/taskPipeline';

describe('buildTaskPipeline', () => {
  it('counts completed tasks instead of dropping them', () => {
    /*
     * The bug this exists to prevent. The dashboard fetched tasks with
     * timer_only, which is `status != 'done'` server-side, then fed the result
     * to a chart labelled To Do / In Progress / Done. Measured 18 Aug 2026:
     * 18 done tasks in the database, a Done bar of zero, and an axis scaled to
     * 36 open tasks rather than the real 54.
     */
    const result = buildTaskPipeline([
      { status: 'todo' },
      { status: 'in_progress' },
      { status: 'done' },
      { status: 'done' },
    ]);

    expect(result.counts['Done']).toBe(2);
    expect(result.total).toBe(4);
  });

  it('scales the total to every task so the axis is not sized to open work only', () => {
    const result = buildTaskPipeline([
      { status: 'todo' },
      { status: 'done' },
      { status: 'done' },
    ]);

    expect(result.total).toBe(3);
  });

  it('recognises the status spellings the API actually returns', () => {
    const result = buildTaskPipeline([
      { status: 'in_progress' },
      { status: 'In Progress' },
      { status: 'completed' },
      { status: 'done' },
      { status: 'todo' },
      { status: 'to_do' },
    ]);

    expect(result.counts['In Progress']).toBe(2);
    expect(result.counts['Done']).toBe(2);
    expect(result.counts['To Do']).toBe(2);
  });

  it('treats an unknown or missing status as To Do rather than losing the task', () => {
    const result = buildTaskPipeline([{ status: null }, {}, { status: 'backlog' }]);

    expect(result.counts['To Do']).toBe(3);
    expect(result.total).toBe(3);
  });

  it('keeps the three buckets present even with no tasks at all', () => {
    const result = buildTaskPipeline([]);

    expect(result.rows.map((row) => row.label)).toEqual(['To Do', 'In Progress', 'Done']);
    expect(result.rows.every((row) => row.count === 0)).toBe(true);
  });

  it('reports open work as to-do plus in-progress, excluding done', () => {
    const result = buildTaskPipeline([
      { status: 'todo' },
      { status: 'in_progress' },
      { status: 'done' },
    ]);

    expect(result.openCount).toBe(2);
  });
});
