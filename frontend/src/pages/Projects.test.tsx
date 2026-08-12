import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Projects from '@/pages/Projects';
import { renderWithProviders } from '@/test/renderWithProviders';

const apiMocks = vi.hoisted(() => ({
  getProjects: vi.fn(),
  createProject: vi.fn().mockResolvedValue({ data: {} }),
  updateProject: vi.fn().mockResolvedValue({ data: {} }),
  getGroups: vi.fn(),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, name: 'Akash Admin', email: 'akash@example.com', role: 'admin', hierarchy_level: 10, organization_id: 1 },
    organization: { id: 1, name: 'CareVance', slug: 'carevance' },
  }),
}));

vi.mock('@/services/api', async () => {
  const actual = await vi.importActual<typeof import('@/services/api')>('@/services/api');
  return {
    ...actual,
    projectApi: {
      ...actual.projectApi,
      getAll: apiMocks.getProjects,
      create: apiMocks.createProject,
      update: apiMocks.updateProject,
    },
    groupApi: { ...actual.groupApi, getAll: apiMocks.getGroups },
  };
});

const HOUR = 3600;

const project = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  organization_id: 1,
  group_id: 7,
  name: 'Website Redesign',
  description: 'Corporate site overhaul',
  color: '#EF4444',
  status: 'active',
  budget: '150000.00',
  budget_type: 'amount',
  hourly_rate: '1200.00',
  deadline: '2026-12-31',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  tracked_seconds: 10 * HOUR,
  tasks_count: 4,
  ...overrides,
});

/**
 * jsdom does not run form submission from a submit-button click, so the click
 * lands and nothing happens. Login.test.tsx hits the same wall and submits the
 * form directly; same idiom here.
 */
const submitProjectForm = () => {
  const nameInput = screen.getByDisplayValue('Website Redesign');
  fireEvent.submit(nameInput.closest('form') as HTMLFormElement);
};

const renderProjects = async (projects: Array<Record<string, unknown>>) => {
  apiMocks.getProjects.mockResolvedValue({ data: projects });
  renderWithProviders(<Projects />);
  await screen.findByText('Website Redesign');
};

describe('Projects ledger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.getGroups.mockResolvedValue({ data: { data: [{ id: 7, name: 'Engineering' }] } });
  });

  it('renders a money budget as currency, never as hours', async () => {
    await renderProjects([project()]);

    expect(screen.getByText('₹1,50,000')).toBeInTheDocument();
    // The reported bug: a rupee figure rendered with an "h" glued on.
    expect(screen.queryByText('150000h')).not.toBeInTheDocument();
    expect(screen.queryByText('1,50,000h')).not.toBeInTheDocument();
  });

  it('prices tracked hours against a money budget', async () => {
    await renderProjects([project()]);

    // 10h at ₹1,200 = ₹12,000, which is 8% of ₹1,50,000.
    expect(screen.getByText('₹12,000')).toBeInTheDocument();
    expect(screen.getByText('8%')).toBeInTheDocument();
  });

  it('says a rate is needed when a money budget has none', async () => {
    await renderProjects([project({ hourly_rate: null })]);

    expect(screen.getByText('Rate needed')).toBeInTheDocument();
    // The budget is still known, so it is still shown.
    expect(screen.getByText('₹1,50,000')).toBeInTheDocument();
  });

  it('renders an hours budget with thousands separators', async () => {
    await renderProjects([project({ budget: '1500.00', budget_type: 'hours', hourly_rate: null })]);

    expect(screen.getByText('1,500h')).toBeInTheDocument();
  });

  it('says no budget is set when there is none', async () => {
    await renderProjects([project({ budget: null, budget_type: 'hours', hourly_rate: null })]);

    expect(screen.getByText('No budget set')).toBeInTheDocument();
  });
});

describe('Projects budget form', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.getGroups.mockResolvedValue({ data: { data: [{ id: 7, name: 'Engineering' }] } });
  });

  it('prefills the edit form without the decimal cast trailing zeroes', async () => {
    const user = userEvent.setup();
    await renderProjects([project()]);

    await user.click(screen.getByRole('button', { name: /edit website redesign/i }));

    const dialog = await screen.findByText('Edit project');
    expect(dialog).toBeInTheDocument();
    // "150000.00" is what the decimal:2 cast sends; the box must not show it.
    expect(screen.getByDisplayValue('150000')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('150000.00')).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('1200')).toBeInTheDocument();
  });

  it('shows the hourly rate field only for a money budget', async () => {
    const user = userEvent.setup();
    await renderProjects([project()]);

    await user.click(screen.getByRole('button', { name: /edit website redesign/i }));
    await screen.findByText('Edit project');

    const budgetType = screen.getByRole('group', { name: 'Budget type' });
    expect(screen.getByText('Hourly rate')).toBeInTheDocument();

    await user.click(within(budgetType).getByRole('button', { name: 'Hours' }));
    expect(screen.queryByText('Hourly rate')).not.toBeInTheDocument();

    await user.click(within(budgetType).getByRole('button', { name: 'Amount' }));
    expect(screen.getByText('Hourly rate')).toBeInTheDocument();
  });

  it('submits the budget type and rate for a money budget', async () => {
    const user = userEvent.setup();
    await renderProjects([project()]);

    await user.click(screen.getByRole('button', { name: /edit website redesign/i }));
    await screen.findByText('Edit project');
    submitProjectForm();

    await waitFor(() => expect(apiMocks.updateProject).toHaveBeenCalled());
    expect(apiMocks.updateProject.mock.calls[0][1]).toMatchObject({
      budget: 150000,
      budget_type: 'amount',
      hourly_rate: 1200,
    });
  });

  it('clears the rate when the budget is switched back to hours', async () => {
    const user = userEvent.setup();
    await renderProjects([project()]);

    await user.click(screen.getByRole('button', { name: /edit website redesign/i }));
    await screen.findByText('Edit project');

    const budgetType = screen.getByRole('group', { name: 'Budget type' });
    await user.click(within(budgetType).getByRole('button', { name: 'Hours' }));
    submitProjectForm();

    await waitFor(() => expect(apiMocks.updateProject).toHaveBeenCalled());
    // Explicitly null, not undefined — $request->only() skips absent keys, so
    // undefined would leave the stale rate on the row.
    expect(apiMocks.updateProject.mock.calls[0][1]).toMatchObject({
      budget_type: 'hours',
      hourly_rate: null,
    });
  });
});
