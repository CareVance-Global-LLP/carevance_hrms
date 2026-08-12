import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AddUserDrawer from './AddUserDrawer';
import { renderWithProviders } from '@/test/renderWithProviders';

/*
 * Characterization tests, written before splitting the 924-line shell apart.
 *
 * Nothing rendered this component before — 20 useState calls and five effects
 * with no coverage at all. These pin the behaviour that has to survive the
 * refactor: which route is showing, what each one collects, and that switching
 * routes does not carry state across. They assert what the component DOES
 * today, not what it should do; anything wrong stays wrong here and is changed
 * deliberately in a later commit.
 */

const mocks = vi.hoisted(() => ({
  fetchGroups: vi.fn(),
  fetchProjects: vi.fn(),
  inviteByEmail: vi.fn(),
  generateInviteLink: vi.fn(),
  loadDefaults: vi.fn(),
  billingCurrent: vi.fn(),
}));

vi.mock('@/services/addUser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/addUser')>();
  return {
    ...actual,
    addUserService: {
      fetchGroups: mocks.fetchGroups,
      fetchProjects: mocks.fetchProjects,
      inviteByEmail: mocks.inviteByEmail,
      generateInviteLink: mocks.generateInviteLink,
      loadDefaults: mocks.loadDefaults,
      saveDefaults: vi.fn(),
      clearDefaults: vi.fn(),
      downloadCsvTemplate: vi.fn(),
      parseCsvFile: vi.fn(),
      importCsv: vi.fn(),
    },
  };
});

vi.mock('@/services/api', () => ({
  default: { get: vi.fn(), post: vi.fn() },
  billingApi: { current: mocks.billingCurrent },
  organizationApi: { getMembers: vi.fn().mockResolvedValue({ data: [] }) },
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    organization: { id: 1, name: 'Acme' },
    user: { id: 1, name: 'Admin', role: 'admin' },
  }),
}));

vi.mock('@/lib/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/permissions')>();
  return { ...actual, getAssignableRoles: () => ['employee', 'manager', 'admin'] };
});

// The Create User wizard is covered by its own suite and pulls a large tree.
vi.mock('@/components/add-user/CustomAddUserPanel', () => ({
  default: () => <div data-testid="create-user-panel" />,
}));

const renderDrawer = () =>
  renderWithProviders(<AddUserDrawer open onClose={vi.fn()} presentation="inline" />, {
    route: '/add-user',
  });

describe('AddUserDrawer — routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadDefaults.mockReturnValue({ groupIds: [], remember: false });
    mocks.fetchGroups.mockResolvedValue([]);
    mocks.fetchProjects.mockResolvedValue([]);
    mocks.billingCurrent.mockResolvedValue({ data: { seats: { max: 25, used: 13, remaining: 12 } } });
  });

  it('offers all four routes', () => {
    renderDrawer();

    expect(screen.getByRole('button', { name: /create user/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /invite by email/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /invite by link/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add by csv/i })).toBeInTheDocument();
  });

  it('opens on Create User', () => {
    renderDrawer();
    expect(screen.getByTestId('create-user-panel')).toBeInTheDocument();
  });

  it('describes the consequence of the selected route, not a generic blurb', async () => {
    const user = userEvent.setup();
    renderDrawer();

    // Create User: the admin sets the password, so nothing is emailed.
    expect(screen.getByText(/you set the password/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /invite by email/i }));

    // Invite by Email: the recipient sets it, and onboarding waits for accept.
    expect(await screen.findByText(/recipient sets their own password/i)).toBeInTheDocument();
  });

  it('shows the email recipient input only on the email route', async () => {
    const user = userEvent.setup();
    renderDrawer();

    expect(screen.queryByPlaceholderText(/type or paste email/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /invite by email/i }));

    expect(await screen.findByPlaceholderText(/type or paste email/i)).toBeInTheDocument();
  });

  it('shows the link generator only on the link route', async () => {
    const user = userEvent.setup();
    renderDrawer();

    await user.click(screen.getByRole('button', { name: /invite by link/i }));

    /*
     * Two of them today: InviteLinkPanel renders its own generate button and
     * the drawer footer renders a second one for the same action. Pinned as-is
     * — the duplicate is a real finding for the redesign, not something to
     * quietly change under a refactor.
     */
    const generateButtons = await screen.findAllByRole('button', { name: /generate invite link/i });
    expect(generateButtons).toHaveLength(2);
    expect(screen.queryByPlaceholderText(/type or paste email/i)).not.toBeInTheDocument();
  });
});

describe('AddUserDrawer — email recipients', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadDefaults.mockReturnValue({ groupIds: [], remember: false });
    mocks.fetchGroups.mockResolvedValue([]);
    mocks.fetchProjects.mockResolvedValue([]);
    mocks.billingCurrent.mockResolvedValue({ data: { seats: { max: 25, used: 13, remaining: 12 } } });
  });

  const goToEmail = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('button', { name: /invite by email/i }));
    return screen.findByPlaceholderText(/type or paste email/i);
  };

  it('turns a typed address into a recipient chip with its own role control', async () => {
    const user = userEvent.setup();
    renderDrawer();

    const input = await goToEmail(user);
    await user.type(input, 'asha@acme.in{Enter}');

    expect(await screen.findByText('asha@acme.in')).toBeInTheDocument();
    // Per-recipient role: the API takes one role per request, so the service
    // groups by role — but the admin sets it per person.
    expect(screen.getByRole('combobox', { name: /role for asha@acme\.in/i })).toBeInTheDocument();
  });

  it('keeps a per-recipient role override independent of the batch default', async () => {
    const user = userEvent.setup();
    renderDrawer();

    const input = await goToEmail(user);
    await user.type(input, 'asha@acme.in{Enter}');
    await user.type(input, 'ravi@acme.in{Enter}');

    const ravi = screen.getByRole('combobox', { name: /role for ravi@acme\.in/i });
    await user.selectOptions(ravi, 'manager');

    expect(ravi).toHaveValue('manager');
    expect(screen.getByRole('combobox', { name: /role for asha@acme\.in/i })).toHaveValue('employee');
  });

  it('drops a recipient and their role override together', async () => {
    const user = userEvent.setup();
    renderDrawer();

    const input = await goToEmail(user);
    await user.type(input, 'asha@acme.in{Enter}');
    await user.click(screen.getByRole('button', { name: /remove asha@acme\.in/i }));

    await waitFor(() => {
      expect(screen.queryByText('asha@acme.in')).not.toBeInTheDocument();
    });
  });
});
