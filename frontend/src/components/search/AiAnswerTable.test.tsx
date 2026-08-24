import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import AiAnswerTable from './AiAnswerTable';
import type { AskColumn, AskPlan, AskRow } from '@/services/api';

const columns: AskColumn[] = [
  { key: 'department', label: 'Department', type: 'text' },
  { key: 'avg_net_pay', label: 'Avg net pay', type: 'money' },
];

const rows: AskRow[] = [
  { department: 'Engineering', avg_net_pay: '91575.93' },
  { department: 'Marketing', avg_net_pay: '61584.00' },
];

const plan: AskPlan = {
  entity: 'payroll', metric: 'avg_net_pay', group_by: 'department',
  filters: {}, sort: null, limit: 20,
};

function setup(overrides = {}) {
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
    // defineProperty, not Object.assign: happy-dom exposes navigator.clipboard
    // as a getter-only accessor, so assigning to it throws.
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    setup({ rows: [{ department: 'Sales, EMEA', avg_net_pay: '100.00' }] });

    return userEvent.click(screen.getByRole('button', { name: /copy as csv/i })).then(() => {
      expect(writeText).toHaveBeenCalledWith('Department,Avg net pay\n"Sales, EMEA",100.00');
    });
  });

  it('links to the module the data came from', () => {
    setup();
    expect(screen.getByRole('link', { name: /open full view/i })).toHaveAttribute('href', '/payroll');
  });

  it('offers no full view for an entity with no module route', () => {
    setup({ plan: { ...plan, entity: 'work' } });
    expect(screen.getByRole('link', { name: /open full view/i })).toHaveAttribute('href', '/tasks');
  });
});
