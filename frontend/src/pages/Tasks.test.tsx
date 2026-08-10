import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Tasks from '@/pages/Tasks';
import { renderWithProviders } from '@/test/renderWithProviders';

/** The app renders inside a MemoryRouter, so the URL lives in router state. */
function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location-search">{location.search}</output>;
}

/**
 * `SelectInput` is a button + portalled listbox, not a native `<select>`, so
 * `selectOptions` does not drive it.
 */
async function chooseOption(user: ReturnType<typeof userEvent.setup>, selectLabel: string, optionName: RegExp) {
  await user.click(screen.getByRole('button', { name: selectLabel }));
  await user.click(await screen.findByRole('option', { name: optionName }));
}

const mocks = vi.hoisted(() => ({
  getAllTasks: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
  updateTaskStatus: vi.fn(),
  getAllGroups: vi.fn(),
  getAllUsers: vi.fn(),
  getAllLabels: vi.fn(),
  getAllProjects: vi.fn(),
}));

const authState = vi.hoisted(() => ({
  user: {
    id: 1,
    name: 'Admin User',
    email: 'admin@example.com',
    role: 'admin',
    hierarchy_level: 10,
    organization_id: 1,
    created_at: '',
    updated_at: '',
  },
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: authState.user }),
}));

vi.mock('@/services/api', async () => {
  const actual = await vi.importActual<typeof import('@/services/api')>('@/services/api');
  return {
    ...actual,
    taskApi: {
      getAll: mocks.getAllTasks,
      create: mocks.createTask,
      update: mocks.updateTask,
      delete: mocks.deleteTask,
      updateStatus: mocks.updateTaskStatus,
      // The detail drawer loads these when a task is opened.
      getActivities: vi.fn().mockResolvedValue({ data: [] }),
      getComments: vi.fn().mockResolvedValue({ data: [] }),
      getAttachments: vi.fn().mockResolvedValue({ data: [] }),
      getChecklistItems: vi.fn().mockResolvedValue({ data: [] }),
      getDependencies: vi.fn().mockResolvedValue({ data: [] }),
      getRecurrence: vi.fn().mockResolvedValue({ data: null }),
      watchStatus: vi.fn().mockResolvedValue({ data: { watching: false, watchers_count: 0 } }),
    },
    groupApi: { getAll: mocks.getAllGroups },
    userApi: { getAll: mocks.getAllUsers },
    taskLabelApi: { getAll: mocks.getAllLabels },
    projectApi: { getAll: mocks.getAllProjects },
  };
});

const makeTask = (overrides: Record<string, unknown>) => ({
  id: 1,
  title: 'Task',
  status: 'todo',
  priority: 'medium',
  group_id: 7,
  group: { id: 7, name: 'Engineering' },
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
  ...overrides,
});

describe('Tasks page', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.getAllTasks.mockResolvedValue({
      data: [
        makeTask({ id: 1, title: 'Write the migration', status: 'todo', assignee_id: 2, assignee: { id: 2, name: 'Priya Sharma' } }),
        makeTask({ id: 2, title: 'Build the week grid', status: 'in_progress', assignee_id: 3, assignee: { id: 3, name: 'Arjun Kulkarni' } }),
        makeTask({ id: 3, title: 'Check the burn bar', status: 'in_review', assignee_id: 2, assignee: { id: 2, name: 'Priya Sharma' } }),
        makeTask({ id: 4, title: 'Ship the audit', status: 'done', assignee_id: 3, assignee: { id: 3, name: 'Arjun Kulkarni' } }),
      ],
    });
    mocks.getAllGroups.mockResolvedValue({ data: { data: [{ id: 7, name: 'Engineering' }] } });
    mocks.getAllUsers.mockResolvedValue({
      data: [
        { id: 2, name: 'Priya Sharma', groups: [{ id: 7 }] },
        { id: 3, name: 'Arjun Kulkarni', groups: [{ id: 7 }] },
      ],
    });
    mocks.getAllLabels.mockResolvedValue({ data: [] });
    mocks.getAllProjects.mockResolvedValue({ data: [] });
    mocks.deleteTask.mockResolvedValue({ data: {} });
    mocks.updateTaskStatus.mockResolvedValue({ data: {} });
  });

  it('opens on the list view with every status grouped, including In Review', async () => {
    renderWithProviders(<Tasks />, { route: '/tasks' });

    expect(await screen.findByText('Write the migration')).toBeInTheDocument();

    // `in_review` used to be excluded from the board's status list, so a task in
    // that state rendered in no column at all while still being counted.
    expect(screen.getByRole('columnheader', { name: /In Review/i })).toBeInTheDocument();
    expect(screen.getByText('Check the burn bar')).toBeInTheDocument();

    ['To Do', 'In Progress', 'In Review', 'Done'].forEach((label) => {
      expect(screen.getByRole('columnheader', { name: new RegExp(label, 'i') })).toBeInTheDocument();
    });
  });

  it('shows a fourth In Review column when switched to the board', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Tasks />, { route: '/tasks' });

    await screen.findByText('Write the migration');
    await user.click(screen.getByRole('button', { name: 'Board' }));

    await waitFor(() => {
      expect(screen.getByText('In Review')).toBeInTheDocument();
    });
    expect(screen.getByText('Check the burn bar')).toBeInTheDocument();
  });

  it('regroups the list by assignee so it reads as a workload view', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Tasks />, { route: '/tasks' });

    await screen.findByText('Write the migration');
    await chooseOption(user, 'Group tasks by', /^Assignee$/);

    expect(await screen.findByRole('columnheader', { name: /Priya Sharma/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Arjun Kulkarni/ })).toBeInTheDocument();
  });

  it('keeps the search filter in the URL so a filtered view can be shared', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <Tasks />
        <LocationProbe />
      </>,
      { route: '/tasks' }
    );

    await screen.findByText('Write the migration');
    await user.type(screen.getByLabelText('Search tasks'), 'burn');

    await waitFor(() => {
      expect(screen.getByTestId('location-search')).toHaveTextContent('q=burn');
    });
    expect(screen.queryByText('Write the migration')).not.toBeInTheDocument();
    expect(screen.getByText('Check the burn bar')).toBeInTheDocument();
  });

  it('restores view and filters from the URL on load', async () => {
    renderWithProviders(<Tasks />, { route: '/tasks?view=board&status=done' });

    expect(await screen.findByText('Ship the audit')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Board' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('Write the migration')).not.toBeInTheDocument();
  });

  it('confirms deletion in an in-app dialog rather than window.confirm', async () => {
    const user = userEvent.setup();
    // jsdom does not implement window.confirm, so stub it purely to prove the
    // page never reaches for it.
    const nativeConfirm = vi.fn(() => true);
    window.confirm = nativeConfirm;
    renderWithProviders(<Tasks />, { route: '/tasks' });

    await screen.findByText('Write the migration');
    await user.click(screen.getByRole('button', { name: 'Delete Write the migration' }));

    const dialog = await screen.findByText('Delete this task?');
    expect(dialog).toBeInTheDocument();
    expect(nativeConfirm).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Delete task' }));
    await waitFor(() => expect(mocks.deleteTask).toHaveBeenCalledWith(1));
  });

  it('advances a task status from the list without opening the detail panel', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Tasks />, { route: '/tasks' });

    await screen.findByText('Write the migration');
    await user.click(screen.getByRole('button', { name: /Task status: To Do\. Advance status/ }));

    await waitFor(() => expect(mocks.updateTaskStatus).toHaveBeenCalledWith(1, 'in_progress'));
  });

  it('opens the detail drawer instead of expanding the row in place', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Tasks />, { route: '/tasks' });

    await user.click(await screen.findByText('Write the migration'));

    const drawer = await screen.findByRole('dialog', { name: 'Write the migration' });
    expect(within(drawer).getByText('Activity')).toBeInTheDocument();
    expect(within(drawer).getByText('Comments')).toBeInTheDocument();
  });
});
