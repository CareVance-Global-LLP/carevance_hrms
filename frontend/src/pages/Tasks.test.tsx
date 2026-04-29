import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Tasks from '@/pages/Tasks';
import { renderWithProviders } from '@/test/renderWithProviders';

const mocks = vi.hoisted(() => ({
  getAllTasks: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
  updateTaskStatus: vi.fn(),
  getAllGroups: vi.fn(),
  deleteGroup: vi.fn(),
  getAllUsers: vi.fn(),
  updateUser: vi.fn(),
}));

const authState = vi.hoisted(() => ({
  user: {
    id: 1,
    name: 'Admin User',
    email: 'admin@example.com',
    role: 'admin',
    organization_id: 1,
    is_active: true,
    created_at: '',
    updated_at: '',
  },
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: authState.user,
  }),
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
    },
    groupApi: {
      getAll: mocks.getAllGroups,
      delete: mocks.deleteGroup,
    },
    userApi: {
      getAll: mocks.getAllUsers,
      update: mocks.updateUser,
    },
  };
});

describe('Tasks page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.user = {
      id: 1,
      name: 'Admin User',
      email: 'admin@example.com',
      role: 'admin',
      organization_id: 1,
      is_active: true,
      created_at: '',
      updated_at: '',
    };

    mocks.getAllTasks.mockResolvedValue({
      data: [
        {
          id: 1,
          group_id: 7,
          assignee_id: 3,
          title: 'Build KPI overview',
          description: 'Create the first draft of the KPI overview cards.',
          status: 'todo',
          priority: 'high',
          due_date: '2026-03-20',
          estimated_time: 90,
          created_at: '2026-03-15T08:00:00Z',
          updated_at: '2026-03-15T10:00:00Z',
          group: { id: 7, name: 'Digital Marketing', is_active: true },
          assignee: { id: 3, name: 'Alex Johnson', email: 'alex@example.com', role: 'employee' },
        },
        {
          id: 2,
          group_id: 8,
          assignee_id: null,
          title: 'Prepare onboarding docs',
          description: 'Write the setup notes for new hires.',
          status: 'done',
          priority: 'medium',
          due_date: '2026-03-18',
          estimated_time: 60,
          created_at: '2026-03-12T09:00:00Z',
          updated_at: '2026-03-13T09:00:00Z',
          group: { id: 8, name: 'IT', is_active: true },
          assignee: null,
        },
      ],
    });

    mocks.getAllGroups.mockResolvedValue({
      data: {
        data: [
          {
            id: 7,
            name: 'Digital Marketing',
            is_active: true,
            tasks_count: 1,
            users: [{ id: 3, name: 'Alex Johnson', email: 'alex@example.com', role: 'employee' }],
          },
          {
            id: 8,
            name: 'IT',
            is_active: true,
            tasks_count: 1,
            users: [{ id: 4, name: 'Jordan Miles', email: 'jordan@example.com', role: 'employee' }],
          },
        ],
      },
    });

    mocks.getAllUsers.mockResolvedValue({
      data: [
        {
          id: 3,
          name: 'Alex Johnson',
          email: 'alex@example.com',
          role: 'employee',
          organization_id: 1,
          is_active: true,
          groups: [{ id: 7, name: 'Digital Marketing', is_active: true }],
          created_at: '',
          updated_at: '',
        },
        {
          id: 4,
          name: 'Jordan Miles',
          email: 'jordan@example.com',
          role: 'employee',
          organization_id: 1,
          is_active: true,
          groups: [],
          created_at: '',
          updated_at: '',
        },
      ],
    });

    mocks.updateUser.mockResolvedValue({ data: { id: 4 } });
    mocks.deleteGroup.mockResolvedValue({ data: { success: true } });
  });

  it('shows the quick group action and lets group chips filter the board', async () => {
    const user = userEvent.setup();

    renderWithProviders(<Tasks />);

    expect(await screen.findByRole('button', { name: /new group/i })).toBeInTheDocument();
    expect(screen.getByText('Build KPI overview')).toBeInTheDocument();
    expect(screen.getByText('Prepare onboarding docs')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^digital marketing$/i }));

    expect(screen.getByText('Build KPI overview')).toBeInTheDocument();
    expect(screen.queryByText('Prepare onboarding docs')).not.toBeInTheDocument();
  });

  it('shows group membership controls and adds an existing member into a selected group', async () => {
    const user = userEvent.setup();

    renderWithProviders(<Tasks />);

    expect(await screen.findByText(/see every group and manage members from this page/i)).toBeInTheDocument();
    expect(screen.getByText(/search for a group name to view directory cards/i)).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: /search group directory/i }), 'digital');

    await user.click(screen.getByRole('button', { name: /open add member for digital marketing/i }));
    await user.click(screen.getByRole('checkbox', { name: /jordan miles employee jordan@example.com/i }));
    await user.click(screen.getByRole('button', { name: /add members to digital marketing/i }));

    await waitFor(() => {
      expect(mocks.updateUser).toHaveBeenCalledWith(4, { group_ids: [7] });
    });
  });

  it('filters group directory cards by search and dropdown', async () => {
    const user = userEvent.setup();

    renderWithProviders(<Tasks />);

    expect(await screen.findByText(/see every group and manage members from this page/i)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Digital Marketing' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'IT' })).not.toBeInTheDocument();
    expect(screen.getByText(/groups are hidden by default/i)).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: /search group directory/i }), 'digital');

    expect(screen.getByRole('heading', { name: 'Digital Marketing' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'IT' })).not.toBeInTheDocument();

    await user.clear(screen.getByRole('textbox', { name: /search group directory/i }));
    await user.click(screen.getByRole('button', { name: /filter group directory/i }));
    await user.click(screen.getByRole('option', { name: 'IT' }));

    expect(screen.queryByRole('heading', { name: 'Digital Marketing' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'IT' })).toBeInTheDocument();
  });

  it('removes an employee from the current group when they belong to multiple groups', async () => {
    const user = userEvent.setup();

    mocks.getAllUsers.mockResolvedValueOnce({
      data: [
        {
          id: 3,
          name: 'Alex Johnson',
          email: 'alex@example.com',
          role: 'employee',
          organization_id: 1,
          is_active: true,
          groups: [{ id: 7, name: 'Digital Marketing', is_active: true }],
          created_at: '',
          updated_at: '',
        },
        {
          id: 4,
          name: 'Jordan Miles',
          email: 'jordan@example.com',
          role: 'employee',
          organization_id: 1,
          is_active: true,
          groups: [
            { id: 8, name: 'IT', is_active: true },
            { id: 7, name: 'Digital Marketing', is_active: true },
          ],
          created_at: '',
          updated_at: '',
        },
      ],
    });

    renderWithProviders(<Tasks />);

    expect(await screen.findByText(/see every group and manage members from this page/i)).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: /search group directory/i }), 'it');

    await user.click(screen.getByRole('button', { name: /remove jordan miles from it/i }));

    await waitFor(() => {
      expect(mocks.updateUser).toHaveBeenCalledWith(4, { group_ids: [7] });
    });
  });

  it('allows admins to remove a manager from a group', async () => {
    const user = userEvent.setup();

    mocks.getAllGroups.mockResolvedValueOnce({
      data: {
        data: [
          {
            id: 7,
            name: 'Digital Marketing',
            is_active: true,
            tasks_count: 1,
            users: [
              { id: 3, name: 'Alex Johnson', email: 'alex@example.com', role: 'employee' },
              { id: 5, name: 'Sam Manager', email: 'sam.manager@example.com', role: 'manager' },
            ],
          },
          {
            id: 8,
            name: 'IT',
            is_active: true,
            tasks_count: 1,
            users: [{ id: 4, name: 'Jordan Miles', email: 'jordan@example.com', role: 'employee' }],
          },
        ],
      },
    });

    mocks.getAllUsers.mockResolvedValueOnce({
      data: [
        {
          id: 3,
          name: 'Alex Johnson',
          email: 'alex@example.com',
          role: 'employee',
          organization_id: 1,
          is_active: true,
          groups: [{ id: 7, name: 'Digital Marketing', is_active: true }],
          created_at: '',
          updated_at: '',
        },
        {
          id: 4,
          name: 'Jordan Miles',
          email: 'jordan@example.com',
          role: 'employee',
          organization_id: 1,
          is_active: true,
          groups: [{ id: 8, name: 'IT', is_active: true }],
          created_at: '',
          updated_at: '',
        },
        {
          id: 5,
          name: 'Sam Manager',
          email: 'sam.manager@example.com',
          role: 'manager',
          organization_id: 1,
          is_active: true,
          groups: [
            { id: 7, name: 'Digital Marketing', is_active: true },
            { id: 8, name: 'IT', is_active: true },
          ],
          created_at: '',
          updated_at: '',
        },
      ],
    });

    renderWithProviders(<Tasks />);

    expect(await screen.findByText(/see every group and manage members from this page/i)).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: /search group directory/i }), 'digital');

    const removeButton = screen.getByRole('button', { name: /remove sam manager from digital marketing/i });
    expect(removeButton).toBeEnabled();

    await user.click(removeButton);

    await waitFor(() => {
      expect(mocks.updateUser).toHaveBeenCalledWith(5, { group_ids: [8] });
    });
  });

  it('moves a member into the selected group', async () => {
    const user = userEvent.setup();

    mocks.getAllGroups.mockResolvedValueOnce({
      data: {
        data: [
          {
            id: 3,
            name: 'IT Services',
            is_active: true,
            tasks_count: 1,
            users: [{ id: 11, name: 'Irbaz', email: 'irbaz@test.com', role: 'manager' }],
          },
          {
            id: 2,
            name: 'demo 2',
            is_active: true,
            tasks_count: 1,
            users: [{ id: 11, name: 'Irbaz', email: 'irbaz@test.com', role: 'manager' }],
          },
          {
            id: 4,
            name: 'Digital Marketing',
            is_active: true,
            tasks_count: 0,
            users: [],
          },
        ],
      },
    });

    mocks.getAllUsers.mockResolvedValueOnce({
      data: [
        {
          id: 11,
          name: 'Irbaz',
          email: 'irbaz@test.com',
          role: 'manager',
          organization_id: 1,
          is_active: true,
          groups: [
            { id: 2, name: 'demo 2', is_active: true },
            { id: 3, name: 'IT Services', is_active: true },
          ],
          created_at: '',
          updated_at: '',
        },
      ],
    });

    renderWithProviders(<Tasks />);

    expect(await screen.findByText(/see every group and manage members from this page/i)).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: /search group directory/i }), 'it services');

    await user.click(screen.getByRole('button', { name: /move irbaz to another group/i }));
    await user.click(screen.getByRole('option', { name: 'Digital Marketing' }));
    await user.click(screen.getByRole('button', { name: /^move irbaz$/i }));

    await waitFor(() => {
      expect(mocks.updateUser).toHaveBeenCalledWith(11, { group_ids: [4] });
    });
  });

  it('deletes a group from group directory', async () => {
    const user = userEvent.setup();
    const confirmMock = vi.fn(() => true);
    vi.stubGlobal('confirm', confirmMock);

    renderWithProviders(<Tasks />);

    expect(await screen.findByText(/see every group and manage members from this page/i)).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: /search group directory/i }), 'digital');

    await user.click(screen.getByRole('button', { name: /delete group digital marketing/i }));

    await waitFor(() => {
      expect(mocks.deleteGroup).toHaveBeenCalledWith(7);
    });

    vi.unstubAllGlobals();
  });

  it('hides manager-only create controls for managers', async () => {
    authState.user = {
      id: 9,
      name: 'Manager User',
      email: 'manager@example.com',
      role: 'manager',
      organization_id: 1,
      is_active: true,
      created_at: '',
      updated_at: '',
    };

    renderWithProviders(<Tasks />);

    expect(await screen.findByText('Build KPI overview')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /new group/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /new task/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/see every group and manage members from this page/i)).not.toBeInTheDocument();
  });
});
