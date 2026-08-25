import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import AiAnswerTable, { AI_EXAMPLE_QUESTIONS } from './AiAnswerTable';
import type { AskColumn, AskPlan, AskRow } from '@/services/api';

const columns: AskColumn[] = [
  { key: 'department', label: 'Department', type: 'text' },
  { key: 'avg_net_pay', label: 'Avg net pay', type: 'money', origin: 'curated' },
];

const rows: AskRow[] = [
  { department: 'Engineering', avg_net_pay: '91575.93' },
  { department: 'Marketing', avg_net_pay: '61584.00' },
];

/** The section 1 v2 plan shape: metrics[], group_by[], filters[], having[]. */
const plan: AskPlan = {
  entity: 'payroll',
  mode: 'aggregate',
  metrics: ['avg_net_pay'],
  columns: [],
  group_by: ['department'],
  filters: [],
  having: [],
  sort: null,
  limit: 20,
};

function setup(overrides: Record<string, unknown> = {}) {
  // MemoryRouter because "Open full view" is a react-router Link — a plain
  // anchor would full-page reload out of the SPA.
  return render(
    <MemoryRouter>
      <AiAnswerTable
        columns={columns} rows={rows} notes={[]} truncated={false}
        plan={plan} summary={null} loading={false} {...overrides}
      />
    </MemoryRouter>,
  );
}

describe('AiAnswerTable', () => {
  it('renders a row per record', () => {
    setup();
    expect(screen.getByText('Engineering')).toBeInTheDocument();
    expect(screen.getByText('Marketing')).toBeInTheDocument();
  });

  it('formats money in rupees with Indian grouping', () => {
    setup();
    expect(screen.getByText('₹91,575.93')).toBeInTheDocument();
  });

  it('says no records rather than showing a zero', () => {
    setup({ rows: [] });
    expect(screen.getByText(/no records match/i)).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('shows metric caveats as footnotes', () => {
    setup({ notes: ['Excludes payroll items not yet processed (net pay 0).'] });
    expect(screen.getByText(/not yet processed/i)).toBeInTheDocument();
  });

  it('says what was truncated instead of cutting silently', () => {
    setup({ truncated: true });
    expect(screen.getByText(/showing the first 20/i)).toBeInTheDocument();
  });

  it('exposes how the number was calculated', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: /how this was calculated/i }));
    expect(screen.getByText(/avg_net_pay/)).toBeInTheDocument();
  });

  it('renders the summary above the table when present', () => {
    setup({ summary: 'Engineering leads on net pay.' });
    expect(screen.getByText('Engineering leads on net pay.')).toBeInTheDocument();
  });

  it('renders no summary slot at all when it failed', () => {
    setup({ summary: null });
    expect(screen.queryByTestId('ai-summary')).not.toBeInTheDocument();
  });

  it('copies the table as CSV', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    // defineProperty, not Object.assign: happy-dom exposes navigator.clipboard
    // as a getter-only accessor, so assigning to it throws.
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    setup();

    await userEvent.click(screen.getByRole('button', { name: /copy as csv/i }));

    expect(writeText).toHaveBeenCalledWith(
      'Department,Avg net pay\nEngineering,91575.93\nMarketing,61584.00',
    );
  });

  it('quotes a cell containing a comma so the CSV does not split', () => {
    // "Sales, EMEA" as a department name would otherwise become two columns.
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    setup({ rows: [{ department: 'Sales, EMEA', avg_net_pay: '100.00' }] });

    return userEvent.click(screen.getByRole('button', { name: /copy as csv/i })).then(() => {
      expect(writeText).toHaveBeenCalledWith('Department,Avg net pay\n"Sales, EMEA",100.00');
    });
  });

  it('copies the raw date, not the formatted one, so a spreadsheet can parse it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    setup({
      columns: [{ key: 'joining_date', label: 'Joining date', type: 'date' }],
      rows: [{ joining_date: '2026-08-24' }],
    });

    await userEvent.click(screen.getByRole('button', { name: /copy as csv/i }));

    expect(writeText).toHaveBeenCalledWith('Joining date\n2026-08-24');
  });

  it('links to the module the data came from', () => {
    setup();
    expect(screen.getByRole('link', { name: /open full view/i })).toHaveAttribute('href', '/payroll');
  });

  it('links a work question to the tasks screen', () => {
    setup({ plan: { ...plan, entity: 'work' } });
    expect(screen.getByRole('link', { name: /open full view/i })).toHaveAttribute('href', '/tasks');
  });

  it('offers no full view for a derived entity with no screen of its own', () => {
    setup({ plan: { ...plan, entity: 'employee_documents' } });
    expect(screen.queryByRole('link', { name: /open full view/i })).not.toBeInTheDocument();
  });

  /* ------------------------------------------------- section 7 wide answers */

  it('renders all ten columns of a wide answer', () => {
    const wide: AskColumn[] = Array.from({ length: 10 }, (_, index) => ({
      key: `c${index}`, label: `Column ${index}`, type: 'number' as const,
    }));
    setup({ columns: wide, rows: [Object.fromEntries(wide.map((c, i) => [c.key, i]))] });

    expect(screen.getAllByRole('columnheader')).toHaveLength(10);
    expect(screen.getByRole('columnheader', { name: 'Column 9' })).toBeInTheDocument();
  });

  it('scrolls a wide table inside its own box rather than widening the overlay', () => {
    setup();
    const scroller = screen.getByTestId('ai-table-scroll');

    expect(scroller.className).toContain('overflow-x-auto');
    // min-w-full, never w-full: w-full squeezes ten columns into slivers
    // instead of letting the box around them scroll.
    expect(within(scroller).getByRole('table').className).toContain('min-w-full');
  });

  it('right-aligns money and numbers and left-aligns text and dates', () => {
    setup({
      columns: [
        { key: 'name', label: 'Employee', type: 'text' },
        { key: 'joining_date', label: 'Joining date', type: 'date' },
        { key: 'net_pay', label: 'Net pay', type: 'money' },
        { key: 'absent_days', label: 'Absent days', type: 'number' },
      ],
      rows: [{ name: 'Priya', joining_date: '2026-08-24', net_pay: '50000.00', absent_days: 4 }],
    });

    expect(screen.getByRole('columnheader', { name: 'Employee' }).className).toContain('text-left');
    expect(screen.getByRole('columnheader', { name: 'Joining date' }).className).toContain('text-left');
    expect(screen.getByRole('columnheader', { name: 'Net pay' }).className).toContain('text-right');
    expect(screen.getByRole('columnheader', { name: 'Absent days' }).className).toContain('text-right');
    expect(screen.getByText('₹50,000.00').className).toContain('text-right');
    expect(screen.getByText('Priya').className).toContain('text-left');
  });

  /* -------------------------------------------------------- section 7 dates */

  it('renders a date as d MMM yyyy', () => {
    setup({
      columns: [{ key: 'joining_date', label: 'Joining date', type: 'date' }],
      rows: [{ joining_date: '2026-08-24' }],
    });
    expect(screen.getByText('24 Aug 2026')).toBeInTheDocument();
  });

  it('does not shift a date across a timezone boundary', () => {
    // new Date('2026-01-01') is UTC midnight, which renders as 31 Dec in every
    // timezone behind UTC. A calendar date is not an instant.
    setup({
      columns: [{ key: 'joining_date', label: 'Joining date', type: 'date' }],
      rows: [{ joining_date: '2026-01-01' }],
    });
    expect(screen.getByText('1 Jan 2026')).toBeInTheDocument();
  });

  it('renders a month-granularity date as MMM yyyy', () => {
    // payroll_items.month_year is a YYYY-MM string; inventing a day for it
    // claims a precision the column does not have.
    setup({
      columns: [{ key: 'month', label: 'Month', type: 'date' }],
      rows: [{ month: '2026-07' }],
    });
    expect(screen.getByText('Jul 2026')).toBeInTheDocument();
  });

  it('leaves a date it cannot parse exactly as it arrived', () => {
    setup({
      columns: [{ key: 'joining_date', label: 'Joining date', type: 'date' }],
      rows: [{ joining_date: 'not a date' }],
    });
    expect(screen.getByText('not a date')).toBeInTheDocument();
  });

  it('renders a null cell as a dash, never as a zero', () => {
    setup({ rows: [{ department: null, avg_net_pay: null }] });
    expect(screen.getAllByText('—')).toHaveLength(2);
  });

  /* ---------------------------------------------------- section 7 footnotes */

  it('renders every note, not only the first', () => {
    setup({
      notes: [
        'Excludes payroll items not yet processed (net pay 0).',
        'Period: 1 Jul 2026 - 31 Jul 2026',
        'avg_net_pay = AVG(net_pay), no exclusions',
      ],
    });

    const footnotes = screen.getByTestId('ai-notes');
    expect(within(footnotes).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByText(/1 Jul 2026/)).toBeInTheDocument();
    expect(screen.getByText(/no exclusions/)).toBeInTheDocument();
  });

  it('keeps duplicate notes rather than collapsing them onto one key', () => {
    setup({ notes: ['Same note', 'Same note'] });
    expect(within(screen.getByTestId('ai-notes')).getAllByRole('listitem')).toHaveLength(2);
  });

  /* ------------------------------------------- section 12 curated v derived */

  it('tells a derived metric apart from a curated one', () => {
    setup({
      columns: [
        { key: 'department', label: 'Department', type: 'text' },
        { key: 'avg_net_pay', label: 'Avg net pay', type: 'money', origin: 'curated' },
        { key: 'avg_gross', label: 'Avg gross', type: 'money', origin: 'derived' },
      ],
      rows: [{ department: 'Engineering', avg_net_pay: '91575.93', avg_gross: '100000.00' }],
    });

    expect(screen.getByTestId('origin-avg_net_pay')).toHaveTextContent(/curated/i);
    expect(screen.getByTestId('origin-avg_gross')).toHaveTextContent(/derived/i);
    // Never colour-only: the two badges say different words.
    expect(screen.getByTestId('origin-avg_net_pay').textContent)
      .not.toEqual(screen.getByTestId('origin-avg_gross').textContent);
  });

  it('marks no origin on a dimension, which is not a definition', () => {
    setup();
    expect(screen.queryByTestId('origin-department')).not.toBeInTheDocument();
  });

  /* --------------------------------------------- section 8 the empty states */

  it('offers example questions before anything has been asked', () => {
    setup({ plan: null, columns: [], rows: [], onExampleClick: vi.fn() });

    expect(screen.queryByText(/no records match/i)).not.toBeInTheDocument();
    AI_EXAMPLE_QUESTIONS.forEach((question) => {
      expect(screen.getByRole('button', { name: question })).toBeInTheDocument();
    });
  });

  it('offers exactly four examples', () => {
    expect(AI_EXAMPLE_QUESTIONS).toHaveLength(4);
  });

  it('runs the example that was clicked', async () => {
    const onExampleClick = vi.fn();
    setup({ plan: null, columns: [], rows: [], onExampleClick });

    await userEvent.click(screen.getByRole('button', { name: AI_EXAMPLE_QUESTIONS[0] }));

    expect(onExampleClick).toHaveBeenCalledWith(AI_EXAMPLE_QUESTIONS[0]);
  });

  it('shows the examples as plain text when nothing can run them', () => {
    setup({ plan: null, columns: [], rows: [], onExampleClick: undefined });

    expect(screen.queryByRole('button', { name: AI_EXAMPLE_QUESTIONS[0] })).not.toBeInTheDocument();
    expect(screen.getByText(AI_EXAMPLE_QUESTIONS[0])).toBeInTheDocument();
  });

  it('does not offer examples once a question has been answered with nothing', () => {
    // "Nothing matched" and "you have not asked yet" are different states, and
    // a hint under a real answer reads as a suggestion that the answer is wrong.
    setup({ rows: [], onExampleClick: vi.fn() });

    expect(screen.getByText(/no records match/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: AI_EXAMPLE_QUESTIONS[0] })).not.toBeInTheDocument();
  });

  it('keeps the plan inspectable when nothing matched', async () => {
    // An empty table beside an unreadable plan is how a wrong period passes for
    // "there are none of those".
    setup({ rows: [], notes: ['Period: 1 Jul 2026 - 31 Jul 2026'] });

    expect(screen.getByText(/1 Jul 2026/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /how this was calculated/i }));
    expect(screen.getByText(/avg_net_pay/)).toBeInTheDocument();
  });

  it('shows no examples and no empty state while the answer is still coming', () => {
    setup({ plan: null, columns: [], rows: [], loading: true, onExampleClick: vi.fn() });

    expect(screen.getByRole('status', { name: /working out the answer/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: AI_EXAMPLE_QUESTIONS[0] })).not.toBeInTheDocument();
  });

  it('renders a prose answer instead of an empty table', () => {
    // "how do I run payroll?" is not a data question. Before the merge the
    // panel refused it with "I can't answer that from your HR data", which is
    // true and useless — a person does not know in advance which kind of
    // question they are about to type.
    render(
      <MemoryRouter>
        <AiAnswerTable
          kind="prose"
          reply={'1. Go to Payroll Dashboard.\n2. Complete the checklist.'}
          sources={[{ label: 'Pre-Payroll Checklist', route: '/pre-payroll-checklist' }]}
          columns={[]}
          rows={[]}
          notes={[]}
          truncated={false}
          plan={null}
          summary={null}
          loading={false}
        />
      </MemoryRouter>
    );

    expect(screen.getByTestId('ai-prose')).toBeInTheDocument();
    expect(screen.getByText(/Go to Payroll Dashboard/)).toBeInTheDocument();

    // The example questions belong to the not-yet-asked state. Showing them
    // under a real answer reads as the system doubting its own reply.
    expect(screen.queryByText(AI_EXAMPLE_QUESTIONS[0])).not.toBeInTheDocument();
  });

  it('says plainly that no query ran behind a prose answer', () => {
    // Somebody who asked for a figure and got a paragraph has to know nothing
    // was measured — otherwise a sentence containing a number reads as a
    // result rather than as product help.
    render(
      <MemoryRouter>
        <AiAnswerTable
          kind="prose"
          reply="Payroll runs from the Payroll Dashboard."
          columns={[]}
          rows={[]}
          notes={[]}
          truncated={false}
          plan={null}
          summary={null}
          loading={false}
        />
      </MemoryRouter>
    );

    expect(screen.getByText(/no data query ran/i)).toBeInTheDocument();
  });

  it('links the pages a prose answer is backed by', () => {
    render(
      <MemoryRouter>
        <AiAnswerTable
          kind="prose"
          reply="Check the blockers first."
          sources={[{ label: 'Pre-Payroll Checklist', route: '/pre-payroll-checklist' }]}
          columns={[]}
          rows={[]}
          notes={[]}
          truncated={false}
          plan={null}
          summary={null}
          loading={false}
        />
      </MemoryRouter>
    );

    const link = screen.getByRole('link', { name: /Pre-Payroll Checklist/ });
    expect(link).toHaveAttribute('href', '/pre-payroll-checklist');
  });
});
